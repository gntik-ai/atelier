/**
 * Unit tests for cross-tenant function LIST isolation in the kind control-plane
 * workspace-scoped function inventory/actions routes
 * (fix-784-function-list-tenant-scope, issue #784 — CONFIRMED Critical cross-tenant IDOR).
 *
 * Lives in tests/unit/ (run in CI via `pnpm test:unit`) like the other kind control-plane
 * security regressions (sa-revocation-check, oidc-app-client-redirect-allowlist,
 * realm-brute-force-protection); it drives the public FN_HANDLERS interface with a fake pg
 * pool — no internal knowledge assumed.
 *
 * The two workspace-scoped function LIST handlers (GET .../inventory and GET .../actions)
 * previously called store.listFnActions(pool, workspaceId) with NO caller tenant and never
 * resolved/owned the workspace, leaking another tenant's function metadata — including
 * source.inlineCode (the function's source) and tenantId. The by-id siblings
 * (fnActionDetail/fnInvoke) and the export handler already gate on the caller's tenant;
 * these two LIST handlers were the only ones skipping the gate. The fix gates both via the
 * existing ownedWorkspace(ctx, workspaceId) helper (403 for foreign/unknown; superadmin
 * bypass preserved) and adds a tenant predicate to listFnActions (defense-in-depth).
 *
 * Each test is RED on the current (broken) code and GREEN after the fix.
 *
 * bbx-fn-list-scope-01: Tenant B principal reads Tenant A workspace inventory → 403, no leak
 * bbx-fn-list-scope-02: Tenant B principal lists Tenant A workspace actions   → 403, no leak
 * bbx-fn-list-scope-03: Tenant A principal reads its own workspace inventory  → 200 (+source.inlineCode)
 * bbx-fn-list-scope-04: Tenant A principal lists its own workspace actions    → 200
 * bbx-fn-list-scope-05: Superadmin reads any workspace inventory              → 200 (cross-tenant bypass)
 * bbx-fn-list-scope-06: Store-level defense-in-depth — listFnActions tenant predicate
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { listFnActions } from '../../apps/control-plane/tenant-store.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

/** The workspace ws-a is owned by Tenant A (shape mirrors getWorkspace's projected columns). */
const WS_A = {
  id: 'ws-a',
  tenant_id: 'tenant-a',
  slug: 'ws-a',
  display_name: 'A',
  status: 'active',
  environment: 'dev',
  created_at: NOW,
  created_by: null,
};

/** A function action owned by Tenant A in ws-a, with a recognizable secret in its source. */
const FN_A = {
  resource_id: 'fn_aaaaaaaaaaaa',
  tenant_id: 'tenant-a',
  workspace_id: 'ws-a',
  action_name: 'multiplier',
  runtime: 'nodejs:22',
  entrypoint: 'main',
  source_code: 'function main(){/*ACME-SECRET*/}',
  parameters: null,
  memory_mb: 256,
  timeout_ms: 60000,
  version: 1,
  created_at: NOW,
  updated_at: NOW,
};

/**
 * Build a fake pg pool whose query(sql, params) mirrors real DB semantics:
 *  - workspaces ... WHERE id (getWorkspace): return WS_A when params[0]==='ws-a', else no rows.
 *  - fn_actions ... workspace_id (listFnActions): start from seeded rows where
 *    workspace_id===params[0]; if the SQL includes tenant_id, further filter by params[1].
 *  - fn_activations ...: no rows.
 */
function fakePool({ rows = [FN_A] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('workspaces') && sql.includes('id')) {
        return { rows: params[0] === WS_A.id ? [WS_A] : [] };
      }
      if (sql.includes('fn_actions') && sql.includes('workspace_id')) {
        let out = rows.filter((r) => r.workspace_id === params[0]);
        if (sql.includes('tenant_id')) out = out.filter((r) => r.tenant_id === params[1]);
        return { rows: out };
      }
      if (sql.includes('fn_activations')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

/** Identity for Tenant A (owner of ws-a). */
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

/** Superadmin identity (cross-tenant bypass). */
const IDENTITY_SA = {
  sub: 'superadmin-1',
  tenantId: null,
  workspaceId: null,
  actorType: 'superadmin',
  roles: ['superadmin'],
  scopes: [],
};

function ctx(identity, params = {}) {
  return {
    pool: fakePool(),
    params: { workspaceId: 'ws-a', ...params },
    query: {},
    body: {},
    identity,
    callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }), canServeWorkloads: () => true },
  };
}

// ===========================================================================
// bbx-fn-list-scope-01: Tenant B reads Tenant A workspace inventory → 403, no leak
// ===========================================================================
test('bbx-fn-list-scope-01: fnInventory cross-tenant LIST returns 403 with no foreign data', async () => {
  const result = await FN_HANDLERS.fnInventory(ctx(IDENTITY_B, { workspaceId: 'ws-a' }));
  assert.equal(result.statusCode, 403,
    `expected 403 for cross-tenant inventory, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.ok(result.body?.code, 'response must include an error code');
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes('ACME-SECRET'), 'cross-tenant response must not leak source code');
  assert.ok(!serialized.includes('tenant-a'), "cross-tenant response must not leak the owner's tenantId");
});

// ===========================================================================
// bbx-fn-list-scope-02: Tenant B lists Tenant A workspace actions → 403, no leak
// ===========================================================================
test('bbx-fn-list-scope-02: fnListActions cross-tenant LIST returns 403 with no foreign data', async () => {
  const result = await FN_HANDLERS.fnListActions(ctx(IDENTITY_B, { workspaceId: 'ws-a' }));
  assert.equal(result.statusCode, 403,
    `expected 403 for cross-tenant actions list, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.ok(result.body?.code, 'response must include an error code');
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes('ACME-SECRET'), 'cross-tenant response must not leak source code');
  assert.ok(!serialized.includes('tenant-a'), "cross-tenant response must not leak the owner's tenantId");
});

// ===========================================================================
// bbx-fn-list-scope-03: Tenant A reads its own workspace inventory → 200 (+ source.inlineCode)
// ===========================================================================
test('bbx-fn-list-scope-03: fnInventory own-tenant LIST returns 200 with the caller functions', async () => {
  const result = await FN_HANDLERS.fnInventory(ctx(IDENTITY_A, { workspaceId: 'ws-a' }));
  assert.equal(result.statusCode, 200,
    `expected 200 for own-tenant inventory, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(result.body?.actions?.[0]?.resourceId, 'fn_aaaaaaaaaaaa', 'must return the seeded action');
  assert.ok(result.body?.actions?.[0]?.source?.inlineCode?.includes('ACME-SECRET'),
    'own-tenant caller sees its own source.inlineCode');
});

// ===========================================================================
// bbx-fn-list-scope-04: Tenant A lists its own workspace actions → 200
// ===========================================================================
test('bbx-fn-list-scope-04: fnListActions own-tenant LIST returns 200 with the caller functions', async () => {
  const result = await FN_HANDLERS.fnListActions(ctx(IDENTITY_A, { workspaceId: 'ws-a' }));
  assert.equal(result.statusCode, 200,
    `expected 200 for own-tenant actions list, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(result.body?.items?.[0]?.resourceId, 'fn_aaaaaaaaaaaa', 'must return the seeded action');
});

// ===========================================================================
// bbx-fn-list-scope-05: Superadmin reads any workspace inventory → 200 (cross-tenant bypass)
// ===========================================================================
test('bbx-fn-list-scope-05: fnInventory superadmin can read any workspace (cross-tenant bypass)', async () => {
  const result = await FN_HANDLERS.fnInventory(ctx(IDENTITY_SA, { workspaceId: 'ws-a' }));
  assert.equal(result.statusCode, 200,
    `expected 200 for superadmin inventory, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(result.body?.actions?.[0]?.resourceId, 'fn_aaaaaaaaaaaa',
    'superadmin must receive the workspace actions');
});

// ===========================================================================
// bbx-fn-list-scope-06: Store-level defense-in-depth — listFnActions tenant predicate
// ===========================================================================
test('bbx-fn-list-scope-06: listFnActions filters by tenant when a tenantId is supplied', async () => {
  const pool = fakePool();
  const foreign = await listFnActions(pool, 'ws-a', 'tenant-b');
  assert.deepEqual(foreign, [], 'a foreign tenant predicate must return no rows');
  const own = await listFnActions(pool, 'ws-a', 'tenant-a');
  assert.equal(own.length, 1, 'the owning tenant predicate must return the seeded row');
  assert.equal(own[0].resource_id, 'fn_aaaaaaaaaaaa', 'the owning tenant gets its own action');
});
