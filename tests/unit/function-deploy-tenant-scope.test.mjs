/**
 * Unit tests for cross-tenant function DEPLOY/UPDATE isolation in the kind control-plane
 * workspace-scoped function deploy route (fix-869-function-deploy-tenant-scope, issue #869 —
 * CONFIRMED Critical cross-tenant IDOR, the WRITE twin of #784 which fixed the LIST/read side).
 *
 * Lives in tests/unit/ (run in CI via `pnpm test:unit`) alongside function-list-tenant-scope.test.mjs;
 * it drives the public FN_HANDLERS interface with a fake pg pool — no internal knowledge assumed.
 *
 * fnDeploy (serves POST /v1/functions/actions create AND PATCH /v1/functions/actions/{actionId}
 * update) previously resolved the body `workspaceId` with a plain store.getWorkspace(...) call and
 * NO ownership gate, then tagged the fn_actions row with the TARGET workspace's tenant_id and
 * deployed attacker code into the victim's Knative namespace. A tenant-B caller could create — or
 * via the upsert's ON CONFLICT ... DO UPDATE, OVERWRITE — a function inside tenant A's workspace.
 * The fix gates the resolved workspace via the existing ownedWorkspace(ctx, workspaceId) helper
 * (403 for foreign/unknown workspace, no existence oracle; superadmin bypass preserved) BEFORE any
 * write or Knative deploy — the same pattern used by fnInventory/fnListActions (#784).
 *
 * Each test is RED on the current (broken) code and GREEN after the fix.
 *
 * bbx-fn-deploy-scope-01: Tenant B POST-creates into Tenant A's workspace     → 403, no write, no deploy
 * bbx-fn-deploy-scope-02: Tenant B PATCH-updates into Tenant A's workspace    → 403, no write, no deploy
 * bbx-fn-deploy-scope-03: Tenant A POST-creates into its own workspace        → 201, write + deploy happen
 * bbx-fn-deploy-scope-04: Superadmin POST-creates into Tenant A's workspace   → 201 (cross-tenant bypass)
 * bbx-fn-deploy-scope-05: Tenant B POST targets an unknown workspace          → 403 (uniform, no oracle)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

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

/** The workspace ws-b is owned by Tenant B (the attacker's own workspace, unused as a target here). */
const WS_B = {
  id: 'ws-b',
  tenant_id: 'tenant-b',
  slug: 'ws-b',
  display_name: 'B',
  status: 'active',
  environment: 'dev',
  created_at: NOW,
  created_by: null,
};

/**
 * Build a fake pg pool whose query(sql, params) mirrors real DB semantics for the fnDeploy →
 * store.upsertFnAction write path:
 *  - workspaces ... WHERE id (getWorkspace / ownedWorkspace): ws-a/ws-b resolve, else no rows.
 *  - SELECT * FROM fn_actions WHERE workspace_id=$1 AND action_name=$2 (upsertFnAction's
 *    existing-row lookup): always empty — every deploy under test is a fresh create.
 *  - INSERT INTO fn_actions ... RETURNING * : captures the write into `inserts` and returns a row
 *    with a resource_id so the handler can complete.
 *  - fn_action_versions (listFnActionVersions / snapshotFnActionVersion): always empty rows, so
 *    upsertFnAction's version-snapshot side calls complete as no-ops.
 */
function fakePool(inserts) {
  return {
    async query(sql, params) {
      if (sql.includes('workspaces') && sql.includes('id')) {
        if (params[0] === WS_A.id) return { rows: [WS_A] };
        if (params[0] === WS_B.id) return { rows: [WS_B] };
        return { rows: [] };
      }
      if (sql.includes('SELECT') && sql.includes('fn_actions') && sql.includes('action_name')) {
        // upsertFnAction's existing-row lookup (workspace_id + action_name) — no prior rows.
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO fn_actions')) {
        const [resourceId, workspaceId, tenantId, actionName, runtime, entrypoint, sourceCode,
          parameters, memoryMb, timeoutMs, ksvcName, createdBy] = params;
        inserts.push({ resourceId, workspaceId, tenantId, actionName, sourceCode });
        return {
          rows: [{
            resource_id: resourceId, workspace_id: workspaceId, tenant_id: tenantId,
            action_name: actionName, runtime, entrypoint, source_code: sourceCode,
            parameters, memory_mb: memoryMb, timeout_ms: timeoutMs, ksvc_name: ksvcName,
            created_by: createdBy, version: 1, created_at: NOW, updated_at: NOW,
          }],
        };
      }
      if (sql.includes('fn_action_versions')) {
        // listFnActionVersions SELECT and snapshotFnActionVersion INSERT/UPDATE ... RETURNING *:
        // returning no rows makes snapshotFnActionVersion short-circuit (`if (!version) return null`).
        return { rows: [] };
      }
      return { rows: [] };
    },
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

/** Identity for Tenant B (cross-tenant attacker; owns ws-b, targets ws-a). */
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

/** Builds a ctx for fnDeploy: `inserts` is the array the fake pool records writes into, `deploys`
 *  records (name, code) tuples via the injected deployKnativeService stub, `params` sets
 *  ctx.params (e.g. { actionId } for the PATCH update path). */
function ctx(identity, body, { inserts = [], deploys = [], params = {} } = {}) {
  return {
    pool: fakePool(inserts),
    params,
    query: {},
    body,
    identity,
    callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }), canServeWorkloads: () => true },
    deployKnativeService: async (name, code) => { deploys.push({ name, code }); return { revision: 'rev-1' }; },
  };
}

// ===========================================================================
// bbx-fn-deploy-scope-01: Tenant B POST-creates into Tenant A's workspace → 403, no write, no deploy
// ===========================================================================
test('bbx-fn-deploy-scope-01: fnDeploy cross-tenant CREATE (POST) returns 403 with no write and no deploy', async () => {
  const inserts = [];
  const deploys = [];
  const body = { workspaceId: 'ws-a', actionName: 'evil', source: { inlineCode: 'function main(){/*MARKER-EVIL*/}' } };
  const result = await FN_HANDLERS.fnDeploy(ctx(IDENTITY_B, body, { inserts, deploys }));
  assert.equal(result.statusCode, 403,
    `expected 403 for cross-tenant deploy, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.ok(result.body?.code, 'response must include an error code');
  assert.equal(inserts.length, 0, 'must not write an fn_actions row for a foreign workspace');
  assert.equal(deploys.length, 0, 'must not deploy a Knative service for a foreign workspace');
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes('tenant-a'), "cross-tenant response must not leak the owner's tenantId");
});

// ===========================================================================
// bbx-fn-deploy-scope-02: Tenant B PATCH-updates into Tenant A's workspace → 403, no write, no deploy
// ===========================================================================
test('bbx-fn-deploy-scope-02: fnDeploy cross-tenant UPDATE (PATCH) returns 403 with no write and no deploy', async () => {
  const inserts = [];
  const deploys = [];
  const body = { workspaceId: 'ws-a', actionName: 'evil', source: { inlineCode: 'MARKER-EVIL' } };
  const result = await FN_HANDLERS.fnDeploy(ctx(IDENTITY_B, body, { inserts, deploys, params: { actionId: 'fn_aaaaaaaaaaaa' } }));
  assert.equal(result.statusCode, 403,
    `expected 403 for cross-tenant update, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.ok(result.body?.code, 'response must include an error code');
  assert.equal(inserts.length, 0, 'must not write an fn_actions row for a foreign workspace');
  assert.equal(deploys.length, 0, 'must not deploy a Knative service for a foreign workspace');
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes('tenant-a'), "cross-tenant response must not leak the owner's tenantId");
});

// ===========================================================================
// bbx-fn-deploy-scope-03: Tenant A POST-creates into its own workspace → 201, write + deploy happen
// ===========================================================================
test('bbx-fn-deploy-scope-03: fnDeploy own-tenant CREATE succeeds (not vacuous) and deploys', async () => {
  const inserts = [];
  const deploys = [];
  const body = { workspaceId: 'ws-a', actionName: 'good', source: { inlineCode: 'function main(){/*MARKER-GOOD*/}' } };
  const result = await FN_HANDLERS.fnDeploy(ctx(IDENTITY_A, body, { inserts, deploys }));
  assert.equal(result.statusCode, 201,
    `expected 201 for own-tenant create, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(inserts.length, 1, 'must write exactly one fn_actions row for the owning tenant');
  assert.equal(inserts[0].tenantId, 'tenant-a', 'the written row must be tagged with the caller tenant');
  assert.equal(inserts[0].workspaceId, 'ws-a');
  assert.equal(deploys.length, 1, 'must deploy the Knative service for the owning tenant');
});

// ===========================================================================
// bbx-fn-deploy-scope-04: Superadmin POST-creates into Tenant A's workspace → 201 (cross-tenant bypass)
// ===========================================================================
test('bbx-fn-deploy-scope-04: fnDeploy superadmin cross-tenant CREATE succeeds (bypass preserved)', async () => {
  const inserts = [];
  const deploys = [];
  const body = { workspaceId: 'ws-a', actionName: 'admin-tool', source: { inlineCode: 'function main(){/*MARKER-ADMIN*/}' } };
  const result = await FN_HANDLERS.fnDeploy(ctx(IDENTITY_SA, body, { inserts, deploys }));
  assert.equal(result.statusCode, 201,
    `expected 201 for superadmin create, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(inserts.length, 1, 'must write exactly one fn_actions row for the superadmin');
  assert.equal(inserts[0].tenantId, 'tenant-a', 'the written row must be tagged with the target workspace tenant');
  assert.equal(deploys.length, 1, 'must deploy the Knative service for the superadmin');
});

// ===========================================================================
// bbx-fn-deploy-scope-05: Tenant B POST targets an unknown workspace → 403 (uniform, no oracle)
// ===========================================================================
test('bbx-fn-deploy-scope-05: fnDeploy targeting an unknown workspace returns the same 403 (no existence oracle)', async () => {
  const inserts = [];
  const deploys = [];
  const body = { workspaceId: 'ws-missing', actionName: 'evil', source: { inlineCode: 'MARKER-EVIL' } };
  const result = await FN_HANDLERS.fnDeploy(ctx(IDENTITY_B, body, { inserts, deploys }));
  assert.equal(result.statusCode, 403,
    `expected uniform 403 for an unknown workspace, got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  assert.equal(inserts.length, 0, 'must not write an fn_actions row for an unknown workspace');
  assert.equal(deploys.length, 0, 'must not deploy a Knative service for an unknown workspace');
});
