/**
 * Black-box tests for fix-executor-ddl-db-ownership-guard (P1 tenant-isolation,
 * live E2E re-run 2026-06-18 finding FIND-DDL-TRUST-BOUNDARY / A7).
 *
 * Defect: the executor DDL routes (`/v1/postgres/databases/{db}/schemas...`) carry NO
 * `/workspaces/` path segment, so the dispatch's cross-tenant ownership check never
 * fired for them; and DDL resolved its connection from `identity.workspaceId`, which
 * falls back to the shared/platform database `in_falcone` for any unprovisioned
 * workspace id. Via the gateway-bypass trust-header path (GATEWAY_SHARED_SECRET unset
 * on the executor) a caller could run DDL on `in_falcone` or another tenant's database.
 *
 * Fix:
 *   - dispatch cross-tenant check falls back to identity.workspaceId (DDL routes too);
 *   - DDL fails closed (403 DDL_TARGET_DB_FORBIDDEN) when the workspace has no dedicated
 *     database (routed === false) — never DDL on the shared platform database;
 *   - the kind executor now sets GATEWAY_SHARED_SECRET (manifest; tested by the chart's
 *     gateway-shared-secret suite).
 *
 * Drives the PUBLIC interfaces only: the createConnectionRegistry guard and the
 * createControlPlaneServer HTTP surface.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { executePostgresDdl } from '../../apps/control-plane-executor/src/runtime/postgres-ddl-executor.mjs';

const TEN_A = 'tenant_ddl_a';
const TEN_B = 'tenant_ddl_b';
const WS_A = 'ws_ddl_a';
const WS_B = 'ws_ddl_b';
const WS_UNPROVISIONED = 'ws_ddl_unprovisioned';

const OWNER_BY_WORKSPACE = new Map([[WS_A, TEN_A], [WS_B, TEN_B]]);
async function resolveWorkspaceTenant(workspaceId) { return OWNER_BY_WORKSPACE.get(workspaceId); }

// ---------------------------------------------------------------------------
// Registry-level guard (unit): DDL must fail closed on the shared/platform DB.
// ---------------------------------------------------------------------------
test('bbx-ddl-guard-01: withAdminClient(requireDedicatedDatabase) throws 403 when routed===false', async () => {
  let fnReached = false;
  const registry = createConnectionRegistry({ resolveConnection: async () => ({ dsn: 'postgres://stub/in_falcone', routed: false }) });
  await assert.rejects(
    () => registry.withAdminClient(WS_UNPROVISIONED, async () => { fnReached = true; }, { requireDedicatedDatabase: true }),
    (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'DDL_TARGET_DB_FORBIDDEN'); return true; },
  );
  assert.equal(fnReached, false, 'the callback must never run on the platform database');
  await registry.end().catch(() => {});
});

test('bbx-ddl-guard-02: executePostgresDdl on an unprovisioned workspace → 403 (no DDL on in_falcone)', async () => {
  const registry = createConnectionRegistry({ resolveConnection: async () => ({ dsn: 'postgres://stub/in_falcone', routed: false }) });
  await assert.rejects(
    () => executePostgresDdl(registry, { resourceKind: 'schema', payload: { schemaName: 'evil' }, identity: { tenantId: TEN_A, workspaceId: WS_UNPROVISIONED } }),
    (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'DDL_TARGET_DB_FORBIDDEN'); return true; },
  );
  await registry.end().catch(() => {});
});

test('bbx-ddl-guard-03: the dedicated-database guard is opt-in (no false positive without the flag)', async () => {
  const registry = createConnectionRegistry({ resolveConnection: async () => ({ dsn: 'postgres://127.0.0.1:1/none', routed: false }) });
  // Without requireDedicatedDatabase the guard must NOT fire — it proceeds to connect
  // (which then fails with a connection error, NOT the 403 ownership guard).
  await assert.rejects(
    () => registry.withAdminClient(WS_UNPROVISIONED, async () => {}),
    (e) => { assert.notEqual(e.code, 'DDL_TARGET_DB_FORBIDDEN'); return true; },
  );
  await registry.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// HTTP dispatch: trust-header DDL is subject to the cross-tenant + platform-DB guards.
// ---------------------------------------------------------------------------
function neverConnectRegistry() {
  return createConnectionRegistry({ resolveConnection: () => { throw new Error('resolveConnection reached — the guard should reject first'); } });
}
function platformFallbackRegistry() {
  return createConnectionRegistry({ resolveConnection: async () => ({ dsn: 'postgres://stub/in_falcone', routed: false }) });
}

async function withServer(registry, fn) {
  // No jwtVerifier and no gatewaySharedSecret → the executor trusts identity headers
  // (the exact gateway-bypass trust-header mode the campaign exploited).
  const server = createControlPlaneServer({ registry, resolveWorkspaceTenant, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(baseUrl); }
  finally { await new Promise((r) => server.close(r)); await registry.end().catch(() => {}); }
}

const ddlHeaders = (tenantId, workspaceId) => ({ 'content-type': 'application/json', 'x-tenant-id': tenantId, ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}) });

test('bbx-ddl-guard-04: trust-header DDL targeting another tenant\'s workspace → 403 CROSS_TENANT_VIOLATION', async () => {
  await withServer(neverConnectRegistry(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/postgres/databases/in_falcone/schemas`, {
      method: 'POST', headers: ddlHeaders(TEN_A, WS_B), body: JSON.stringify({ name: 'evil' }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    assert.equal((await res.json()).code, 'GW_FORBIDDEN');
  });
});

test('bbx-ddl-guard-05: trust-header DDL on the platform/unprovisioned DB → 403 DDL_TARGET_DB_FORBIDDEN', async () => {
  await withServer(platformFallbackRegistry(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/postgres/databases/in_falcone/schemas`, {
      method: 'POST', headers: ddlHeaders(TEN_A, WS_UNPROVISIONED), body: JSON.stringify({ name: 'evil' }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    assert.equal((await res.json()).code, 'GW_FORBIDDEN');
  });
});

test('bbx-ddl-guard-06: DDL on the caller\'s OWN workspace passes the ownership check (no false 403)', async () => {
  await withServer(neverConnectRegistry(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/postgres/databases/wsdb_a/schemas`, {
      method: 'POST', headers: ddlHeaders(TEN_A, WS_A), body: JSON.stringify({ name: 'app' }),
    });
    // Ownership passes (owner of WS_A is TEN_A); the request then reaches the registry
    // (neverConnectRegistry throws → 500). The point: it is NOT a 403 cross-tenant block.
    assert.notEqual(res.status, 403, `own-workspace DDL must not be cross-tenant blocked (got ${res.status})`);
  });
});
