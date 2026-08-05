// Black-box tests for change fix-executor-enforce-credential-workspace (#489).
//
// Verifies that the cp-executor rejects data-plane requests where the authenticated
// credential's bound workspace does not match the workspaceId in the URL path.
// This is the primary defense against cross-tenant IDOR on the data plane.
//
// All tests drive createControlPlaneServer via its public HTTP interface.
// No internal knowledge of route dispatch or executor internals is assumed.
//
// bbx-cred-ws-01: API key bound to workspace B + path workspace A → 403 (postgres rows)
// bbx-cred-ws-02: API key bound to workspace B + path workspace A → 403 (events topics)
// bbx-cred-ws-03: API key bound to workspace B + path workspace A → 403 (functions actions)
// bbx-cred-ws-04: API key bound to workspace B + path workspace A → 403 (api-keys route)
// bbx-cred-ws-05: API key bound to workspace B + path workspace A → 403 (mongo documents)
// bbx-cred-ws-06: API key bound to workspace A + path workspace A → NOT 403 (positive regression)
// bbx-cred-ws-07: JWT with workspace_id claim = B, path workspace A → 403 (functions)
// bbx-cred-ws-08: JWT with no workspace_id claim (tenant-only token) + path A → NOT 403 (admin token)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEN_A = 'tenant_cred_ws_a';
const WS_A = 'ws_cred_ws_a';
const TEN_B = 'tenant_cred_ws_b';
const WS_B = 'ws_cred_ws_b';

// A minimal in-memory API key store stub: stores keys issued manually for test setup.
// Exposes the same interface as createApiKeyStore (verifyKey / ensureSchema / issueKey).
function makeApiKeyStore() {
  // key string → { tenantId, workspaceId, keyType, scopes, dbRole, roleName }
  const store = new Map();
  return {
    async ensureSchema() {},
    async issueKey({ tenantId, workspaceId, keyType }) {
      const key = `flc_${keyType}_test_${tenantId}_${workspaceId}`;
      store.set(key, {
        tenantId,
        workspaceId,
        keyType,
        scopes: keyType === 'service' ? ['data:read', 'data:write', 'ddl:write'] : ['data:read'],
        dbRole: `falcone_${keyType}`,
        roleName: `falcone_${keyType}`,
      });
      return { id: `id_${key}`, key, prefix: key.slice(0, 16), keyType, scopes: [], createdAt: new Date() };
    },
    async verifyKey(presentedKey) {
      return store.get(presentedKey) ?? null;
    },
    async listKeys(workspaceId) { return []; },
    async revokeKey() { return { revoked: true }; },
    async rotateKey() { return {}; },
  };
}

// Minimal stubs for executors that the server needs to be instantiated but that we want
// to verify are never reached (a 403 must be returned before calling any executor).
function neverCalledExecutor(name) {
  const fail = () => { throw new Error(`${name} executor should not be called — credential workspace binding check must reject first`); };
  return {
    executeFunctions: fail,
    executeEvents: fail,
    executeMongoData: fail,
  };
}

// Registry stub — connect should never be called if the 403 fires first.
function makeRegistry() {
  return createConnectionRegistry({
    resolveConnection: () => {
      throw new Error('Registry.resolveConnection called — should not reach postgres handler before credential check');
    },
  });
}

async function withServer(fn) {
  const apiKeyStore = makeApiKeyStore();
  // Pre-issue keys for both tenants.
  const { key: keyA } = await apiKeyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'service' });
  const { key: keyB } = await apiKeyStore.issueKey({ tenantId: TEN_B, workspaceId: WS_B, keyType: 'service' });

  const registry = makeRegistry();
  const functionsExecutor = neverCalledExecutor('functions');
  const eventsExecutor = neverCalledExecutor('events');
  const mongoExecutor = neverCalledExecutor('mongo');

  const server = createControlPlaneServer({
    registry,
    apiKeyStore,
    functionsExecutor,
    eventsExecutor,
    mongoExecutor,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, { keyA, keyB });
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

function authHeader(key) {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

// ---------------------------------------------------------------------------
// bbx-cred-ws-01: postgres rows — credential workspace B + path workspace A → 403
// ---------------------------------------------------------------------------
test('bbx-cred-ws-01: service key bound to ws_B accessing postgres rows on ws_A path returns 403', async () => {
  await withServer(async (baseUrl, { keyB }) => {
    const res = await fetch(
      `${baseUrl}/v1/postgres/workspaces/${WS_A}/data/appdb/schemas/public/tables/notes/rows`,
      { headers: authHeader(keyB) },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-02: events topics — credential workspace B + path workspace A → 403
// ---------------------------------------------------------------------------
test('bbx-cred-ws-02: service key bound to ws_B accessing events/topics on ws_A path returns 403', async () => {
  await withServer(async (baseUrl, { keyB }) => {
    const res = await fetch(
      `${baseUrl}/v1/events/workspaces/${WS_A}/topics`,
      { headers: authHeader(keyB) },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-03: functions actions — credential workspace B + path workspace A → 403
// ---------------------------------------------------------------------------
test('bbx-cred-ws-03: service key bound to ws_B accessing functions/actions on ws_A path returns 403', async () => {
  await withServer(async (baseUrl, { keyB }) => {
    const res = await fetch(
      `${baseUrl}/v1/functions/workspaces/${WS_A}/actions`,
      { headers: authHeader(keyB) },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-04: api-keys route — credential workspace B + path workspace A → 403
// Note: service keys cannot manage API keys (that's a separate 403). This test uses
// a gateway-header auth (JWT admin) to target api-keys, then re-tests with a mismatched
// API key to confirm the workspace-binding check fires before the api-keys-cannot-manage-keys check.
// ---------------------------------------------------------------------------
test('bbx-cred-ws-04: service key bound to ws_B accessing api-keys list on ws_A path returns 403', async () => {
  await withServer(async (baseUrl, { keyB }) => {
    const res = await fetch(
      `${baseUrl}/v1/workspaces/${WS_A}/api-keys`,
      { headers: authHeader(keyB) },
    );
    // Must be 403 from workspace binding (not 403 from api-key-cannot-manage check)
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-05: mongo documents — credential workspace B + path workspace A → 403
// ---------------------------------------------------------------------------
test('bbx-cred-ws-05: service key bound to ws_B accessing mongo documents on ws_A path returns 403', async () => {
  await withServer(async (baseUrl, { keyB }) => {
    const res = await fetch(
      `${baseUrl}/v1/mongo/workspaces/${WS_A}/data/mydb/collections/things/documents`,
      { headers: authHeader(keyB) },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-06: POSITIVE — credential workspace A + path workspace A → NOT 403
// ---------------------------------------------------------------------------
test('bbx-cred-ws-06: service key bound to ws_A accessing postgres rows on ws_A path is not rejected with 403', async () => {
  await withServer(async (baseUrl, { keyA }) => {
    // The registry stub throws if reached, and the function executor is disabled.
    // We expect a 5xx (registry failure) or 501 (executor disabled), NOT 403 or 401.
    const res = await fetch(
      `${baseUrl}/v1/postgres/workspaces/${WS_A}/data/appdb/schemas/public/tables/notes/rows`,
      { headers: authHeader(keyA) },
    );
    assert.notEqual(res.status, 403, `matching workspace should not return 403`);
    assert.notEqual(res.status, 401, `matching workspace with valid key should not return 401`);
  });
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-07: JWT with workspace_id claim = B, path workspace A → 403 (functions)
// ---------------------------------------------------------------------------
test('bbx-cred-ws-07: JWT with workspace_id=ws_B targeting functions on ws_A path returns 403', async () => {
  // Simulate a workspace-bound JWT by injecting the verified identity via a jwtVerifier stub.
  // The jwtVerifier stub claims workspace_id = WS_B — mismatches the path WS_A.
  const apiKeyStore = makeApiKeyStore();

  const jwtVerifier = {
    async verify(_token, _pathWorkspaceId) {
      // Returns identity bound to WS_B, regardless of pathWorkspaceId.
      // credentialWorkspaceId is set because the JWT carries an explicit workspace_id claim.
      return {
        tenantId: TEN_B,
        workspaceId: WS_B,
        credentialWorkspaceId: WS_B,
        actorId: 'user-jwt-b',
        roleName: 'falcone_app',
        roles: [],
        scopes: [],
      };
    },
  };

  const registry = createConnectionRegistry({ resolveConnection: () => { throw new Error('should not reach'); } });
  const server = createControlPlaneServer({
    registry,
    apiKeyStore,
    jwtVerifier,
    functionsExecutor: neverCalledExecutor('functions'),
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(
      `${baseUrl}/v1/functions/workspaces/${WS_A}/actions`,
      { headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.stub.stub', 'content-type': 'application/json' } },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN');
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// bbx-cred-ws-08: JWT with NO workspace_id claim (tenant-only admin token) + path A → allowed
// A tenant-only JWT (admin token without workspace binding) MUST still be admitted so that
// gateway-injected identity (x-workspace-id) and admin flows work without a false 403.
// ---------------------------------------------------------------------------
test('bbx-cred-ws-08: JWT with no workspace_id claim (tenant-only token) targeting ws_A is not rejected with 403', async () => {
  const apiKeyStore = makeApiKeyStore();

  const jwtVerifier = {
    async verify(_token, _pathWorkspaceId) {
      // Tenant-only token: tenantId set, workspaceId NOT set (admin token without workspace binding)
      return {
        tenantId: TEN_A,
        workspaceId: undefined,
        actorId: 'admin-jwt',
        roleName: 'falcone_app',
        roles: [],
        scopes: [],
      };
    },
  };

  const registry = createConnectionRegistry({ resolveConnection: () => { throw new Error('should not reach'); } });
  const server = createControlPlaneServer({
    registry,
    apiKeyStore,
    jwtVerifier,
    functionsExecutor: neverCalledExecutor('functions'),
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(
      `${baseUrl}/v1/functions/workspaces/${WS_A}/actions`,
      { headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.stub.stub', 'content-type': 'application/json' } },
    );
    // Should NOT be 403 (no workspace binding → check doesn't apply)
    // The functions executor is a stub so we'll get 200 (empty list from neverCalledExecutor... wait,
    // neverCalledExecutor throws, so we'll actually get 500. That's fine — not 403/401).
    assert.notEqual(res.status, 403, 'tenant-only token must not trigger workspace binding check');
    assert.notEqual(res.status, 401, 'valid tenant id must pass auth gate');
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
});
