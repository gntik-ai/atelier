/**
 * Black-box tests for cross-tenant function access isolation in the control-plane
 * Knative function routes (fix-knative-function-tenant-scope, issue #492).
 *
 * Drives the public FN_HANDLERS interface only — no internal knowledge assumed.
 *
 * bbx-fn-scope-01: Tenant B principal reads Tenant A function by resourceId → 404
 * bbx-fn-scope-02: Tenant B principal invokes Tenant A function by resourceId → 404
 * bbx-fn-scope-03: Tenant B principal lists activations of Tenant A function → 404
 * bbx-fn-scope-04: Tenant B principal reads activation by id belonging to Tenant A fn → 404
 * bbx-fn-scope-05: Tenant B principal reads activation logs of Tenant A fn → 404
 * bbx-fn-scope-06: Tenant B principal reads activation result of Tenant A fn → 404
 * bbx-fn-scope-07: Tenant B principal reads versions of Tenant A function → 404
 * bbx-fn-scope-08: Tenant A principal reads its own function → 200 (own-tenant positive case)
 * bbx-fn-scope-09: Superadmin can read any tenant's function → 200 (superadmin bypass)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A function action owned by Tenant A. */
const FN_A = {
  resource_id: 'fn_aaaaaaaaaaaa',
  tenant_id: 'tenant-a',
  workspace_id: 'ws-a',
  action_name: 'multiplier',
  runtime: 'nodejs:22',
  entrypoint: 'main',
  source_code: 'export function main(p){return{product:p.a*p.b};}',
  parameters: null,
  memory_mb: 256,
  timeout_ms: 60000,
  version: 1,
  ksvc_name: 'fn-ws-a-multiplier',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/**
 * Variant of FN_A with no ksvc_name — used in invoke test to avoid hitting
 * the Knative wait path in the pre-fix (RED) state. After the fix the handler
 * returns 404 before reaching any Knative call, so the real FN_A would also work.
 */
const FN_A_NO_KSVC = { ...FN_A, ksvc_name: null };

/** An activation record for Tenant A's function. */
const ACT_A = {
  activation_id: 'act_aaaaaaaaaaaa',
  resource_id: 'fn_aaaaaaaaaaaa',
  workspace_id: 'ws-a',
  status: 'success',
  status_code: 200,
  result: { product: 42 },
  logs: ['hello from tenant-a'],
  duration_ms: 12,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
};

/**
 * Build a fake pg pool that returns FN_A when asked for fn_aaaaaaaaaaaa.
 * Simulates the unscoped query: SELECT * FROM fn_actions WHERE resource_id=$1
 * regardless of caller tenant — this is the CURRENT (broken) behaviour.
 * After the fix, the pool will receive an extra tenant_id predicate and the
 * cross-tenant query will return no rows.
 */
function fakePool({ fnRow = FN_A, actRow = ACT_A } = {}) {
  return {
    async query(sql, params) {
      // fn_actions lookup: return the row regardless of tenant filter
      if (sql.includes('fn_actions') && sql.includes('resource_id')) {
        // After the fix, the query will include a tenant_id predicate.
        // Simulate correct DB behaviour: only return the row if the tenant matches.
        if (sql.includes('tenant_id') && params.length >= 2) {
          const tenantParam = params[1];
          if (fnRow && fnRow.tenant_id === tenantParam) {
            return { rows: [fnRow] };
          }
          return { rows: [] };
        }
        // Unscoped query (pre-fix) — returns the row to any caller.
        return { rows: fnRow ? [fnRow] : [] };
      }
      // fn_activations lookup by activation_id
      if (sql.includes('fn_activations') && sql.includes('activation_id')) {
        return { rows: actRow ? [actRow] : [] };
      }
      // fn_activations list by resource_id
      if (sql.includes('fn_activations') && sql.includes('resource_id')) {
        return { rows: actRow ? [actRow] : [] };
      }
      return { rows: [] };
    }
  };
}

/** Identity for Tenant A (owner of the function). */
const IDENTITY_A = {
  sub: 'user-a-1',
  tenantId: 'tenant-a',
  workspaceId: 'ws-a',
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: [],
};

/** Identity for Tenant B (cross-tenant attacker). */
const IDENTITY_B = {
  sub: 'user-b-1',
  tenantId: 'tenant-b',
  workspaceId: 'ws-b',
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: [],
};

/** Superadmin identity. */
const IDENTITY_SA = {
  sub: 'superadmin-1',
  tenantId: null,
  workspaceId: null,
  actorType: 'superadmin',
  roles: ['superadmin'],
  scopes: [],
};

function ctx(identity, params = {}, body = {}, poolOpts = {}) {
  return {
    pool: fakePool(poolOpts),
    params: { actionId: 'fn_aaaaaaaaaaaa', activationId: 'act_aaaaaaaaaaaa', ...params },
    query: {},
    body,
    identity,
    callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }), canServeWorkloads: () => true },
  };
}

// ===========================================================================
// bbx-fn-scope-01: Tenant B reads Tenant A function by resourceId → 404
// ===========================================================================
test('bbx-fn-scope-01: fnActionDetail cross-tenant lookup by resourceId returns 404', async () => {
  const result = await FN_HANDLERS.fnActionDetail(ctx(IDENTITY_B));
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant fn access, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.ok(result.body?.code, 'response must include an error code');
  // Must not leak any function data
  assert.ok(!result.body?.sourceCode && !result.body?.source,
    'cross-tenant response must not contain source code');
});

// ===========================================================================
// bbx-fn-scope-02: Tenant B invokes Tenant A function by resourceId → 404
// Use FN_A_NO_KSVC so the pre-fix path fails fast (no Knative wait timeout).
// After the fix, the tenant check fires before any Knative call anyway.
// ===========================================================================
test('bbx-fn-scope-02: fnInvoke cross-tenant lookup by resourceId returns 404', async () => {
  const result = await FN_HANDLERS.fnInvoke(
    ctx(IDENTITY_B, {}, { parameters: { a: 6, b: 7 } }, { fnRow: FN_A_NO_KSVC })
  );
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant fn invoke, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
});

// ===========================================================================
// bbx-fn-scope-03: Tenant B lists activations of Tenant A function → 404
// ===========================================================================
test('bbx-fn-scope-03: fnActivations cross-tenant lookup by resourceId returns 404', async () => {
  const result = await FN_HANDLERS.fnActivations(ctx(IDENTITY_B));
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant fn activations, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
});

// ===========================================================================
// bbx-fn-scope-04: Tenant B reads single activation belonging to Tenant A fn → 404
// ===========================================================================
test('bbx-fn-scope-04: fnActivation cross-tenant read returns 404', async () => {
  const result = await FN_HANDLERS.fnActivation(ctx(IDENTITY_B));
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant activation read, got ${result.statusCode}`);
});

// ===========================================================================
// bbx-fn-scope-05: Tenant B reads activation logs belonging to Tenant A fn → 404
// ===========================================================================
test('bbx-fn-scope-05: fnActivationLogs cross-tenant read returns 404', async () => {
  const result = await FN_HANDLERS.fnActivationLogs(ctx(IDENTITY_B));
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant activation logs, got ${result.statusCode}`);
});

// ===========================================================================
// bbx-fn-scope-06: Tenant B reads activation result belonging to Tenant A fn → 404
// ===========================================================================
test('bbx-fn-scope-06: fnActivationResult cross-tenant read returns 404', async () => {
  const result = await FN_HANDLERS.fnActivationResult(ctx(IDENTITY_B));
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant activation result, got ${result.statusCode}`);
});

// ===========================================================================
// bbx-fn-scope-07: Tenant B reads versions of Tenant A function → 404
// ===========================================================================
test('bbx-fn-scope-07: fnVersions cross-tenant lookup returns 404', async () => {
  const result = await FN_HANDLERS.fnVersions(ctx(IDENTITY_B));
  assert.equal(result.statusCode, 404,
    `expected 404 for cross-tenant fn versions, got ${result.statusCode}`);
});

// ===========================================================================
// bbx-fn-scope-08: Tenant A reads its own function → 200 (positive case)
// ===========================================================================
test('bbx-fn-scope-08: fnActionDetail own-tenant access returns 200', async () => {
  const result = await FN_HANDLERS.fnActionDetail(ctx(IDENTITY_A));
  assert.equal(result.statusCode, 200,
    `expected 200 for own-tenant fn access, got ${result.statusCode}`);
  assert.equal(result.body?.resourceId, 'fn_aaaaaaaaaaaa', 'must return the function resource');
});

// ===========================================================================
// bbx-fn-scope-09: Superadmin can read any tenant's function → 200 (bypass)
// ===========================================================================
test('bbx-fn-scope-09: fnActionDetail superadmin can read any tenant function (cross-tenant bypass)', async () => {
  const result = await FN_HANDLERS.fnActionDetail(ctx(IDENTITY_SA));
  assert.equal(result.statusCode, 200,
    `expected 200 for superadmin fn access, got ${result.statusCode}`);
  assert.equal(result.body?.resourceId, 'fn_aaaaaaaaaaaa', 'superadmin must receive the function resource');
});
