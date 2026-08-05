// Black-box tests for change fix-gateway-authn-and-strip-tenant-headers (#488).
//
// Verifies that the executor rejects requests that carry ONLY client-supplied
// x-tenant-id/x-workspace-id headers with no credential and no gateway trust
// signal — the core of the unauthenticated cross-tenant impersonation vulnerability.
//
// All tests drive createControlPlaneServer via its public HTTP interface.
// No internal knowledge of route dispatch or executor internals is assumed.
//
// bbx-gw-authn-01: spoofed x-tenant-id + x-workspace-id, NO credential, NO trust signal
//                  → 401 UNAUTHENTICATED (was: 201 — minted a key for that tenant)
// bbx-gw-authn-02: spoofed x-tenant-id + x-workspace-id, NO credential, NO trust signal
//                  on postgres data-plane route → 401 (was: data-plane accepted)
// bbx-gw-authn-03: x-tenant-id + x-workspace-id WITH valid gateway trust signal
//                  → request proceeds (gateway path — NOT 401)
// bbx-gw-authn-04: valid API key WITH spoofed x-tenant-id header → key wins, proceeds (not 401)
// bbx-gw-authn-05: ONLY x-tenant-id header, no x-workspace-id, no credential, no trust → 401
// bbx-gw-authn-06: gateway trust signal present but WRONG value → 401 (fail-closed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEN_A = 'tenant_gw_a';
const WS_A = 'ws_gw_a';
const GATEWAY_SECRET = 'test-gateway-secret-abc123';

function makeApiKeyStore() {
  const store = new Map();
  return {
    async ensureSchema() {},
    async issueKey({ tenantId, workspaceId, keyType }) {
      const key = `flc_${keyType}_gw_${tenantId}_${workspaceId}`;
      store.set(key, {
        tenantId,
        workspaceId,
        keyType,
        scopes: ['data:read', 'data:write'],
        dbRole: `falcone_${keyType}`,
        roleName: `falcone_${keyType}`,
      });
      return { id: `id_${key}`, key, prefix: key.slice(0, 16), keyType, scopes: [], createdAt: new Date() };
    },
    async verifyKey(presentedKey) {
      return store.get(presentedKey) ?? null;
    },
    async listKeys() { return []; },
    async revokeKey() { return { revoked: true }; },
    async rotateKey() { return {}; },
  };
}

function makeRegistry() {
  return createConnectionRegistry({
    resolveConnection: () => {
      throw new Error('Registry.resolveConnection called — should not reach executor before auth check');
    },
  });
}

// Builds a server with GATEWAY_SHARED_SECRET configured.
async function withSecuredServer(fn) {
  const apiKeyStore = makeApiKeyStore();
  const { key: keyA } = await apiKeyStore.issueKey({ tenantId: TEN_A, workspaceId: WS_A, keyType: 'service' });
  const registry = makeRegistry();

  const server = createControlPlaneServer({
    registry,
    apiKeyStore,
    gatewaySharedSecret: GATEWAY_SECRET,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, { keyA });
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const keysPath = (ws) => `/v1/workspaces/${ws}/api-keys`;
const postgresPath = (ws) => `/v1/postgres/workspaces/${ws}/data/appdb/schemas/public/tables/notes/rows`;

// ---------------------------------------------------------------------------
// bbx-gw-authn-01: spoofed tenant headers + NO credential + NO trust signal → 401
// This is the exact attack vector from the live evidence: minting an API key
// for an arbitrary tenant by sending x-tenant-id without any Authorization.
// ---------------------------------------------------------------------------
test('bbx-gw-authn-01: spoofed x-tenant-id + x-workspace-id with no credential returns 401', async () => {
  await withSecuredServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${keysPath(WS_A)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': TEN_A,
        'x-workspace-id': WS_A,
        // NO Authorization, NO x-gateway-auth
      },
      body: JSON.stringify({ keyType: 'service' }),
    });
    assert.equal(res.status, 401, `expected 401 for header-only identity without trust signal, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_UNAUTHENTICATED', `expected GW_UNAUTHENTICATED code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-gw-authn-02: same attack on postgres data-plane route → 401
// ---------------------------------------------------------------------------
test('bbx-gw-authn-02: spoofed tenant headers on postgres data-plane with no credential returns 401', async () => {
  await withSecuredServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${postgresPath(WS_A)}`, {
      headers: {
        'x-tenant-id': TEN_A,
        'x-workspace-id': WS_A,
        // NO Authorization, NO x-gateway-auth
      },
    });
    assert.equal(res.status, 401, `expected 401 for header-only identity without trust signal, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_UNAUTHENTICATED', `expected GW_UNAUTHENTICATED code, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-gw-authn-03: tenant headers WITH correct gateway trust signal → NOT 401
// This is the legitimate gateway path: the gateway authenticates the user,
// strips client headers, injects identity headers, and adds x-gateway-auth.
// ---------------------------------------------------------------------------
test('bbx-gw-authn-03: x-tenant-id + x-workspace-id with valid x-gateway-auth trust signal is not rejected with 401', async () => {
  await withSecuredServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${keysPath(WS_A)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': TEN_A,
        'x-workspace-id': WS_A,
        'x-gateway-auth': GATEWAY_SECRET,
      },
      body: JSON.stringify({ keyType: 'service' }),
    });
    // The API-key store is live; we reach the handler (apiKeyStore.issueKey). May succeed (201)
    // or fail with a store-related error, but must NOT be 401.
    assert.notEqual(res.status, 401, `gateway path with trust signal must not return 401, got ${res.status}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-gw-authn-04: valid API key WITH spoofed x-tenant-id → key wins, NOT 401
// API-key authentication is authoritative; the header-only-identity gate
// must not interfere when a real credential is present.
// ---------------------------------------------------------------------------
test('bbx-gw-authn-04: valid API key with spoofed x-tenant-id header is not rejected with 401', async () => {
  await withSecuredServer(async (baseUrl, { keyA }) => {
    const res = await fetch(`${baseUrl}${postgresPath(WS_A)}`, {
      headers: {
        authorization: `Bearer ${keyA}`,
        'x-tenant-id': 'attacker-tenant',
        'x-workspace-id': 'attacker-workspace',
        // NO x-gateway-auth — key is the credential
      },
    });
    // The registry stub throws so we get 500, but NOT 401 (the key authenticated us).
    assert.notEqual(res.status, 401, `API-key request must not be rejected with 401, got ${res.status}`);
    assert.notEqual(res.status, 403, `API-key bound to correct workspace must not be rejected with 403, got ${res.status}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-gw-authn-05: only x-tenant-id (no workspace-id), no credential, no trust → 401
// ---------------------------------------------------------------------------
test('bbx-gw-authn-05: only x-tenant-id header with no credential returns 401', async () => {
  await withSecuredServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${postgresPath(WS_A)}`, {
      headers: {
        'x-tenant-id': TEN_A,
        // NO x-workspace-id, NO Authorization, NO x-gateway-auth
      },
    });
    assert.equal(res.status, 401, `expected 401 for header-only identity, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_UNAUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
// bbx-gw-authn-06: gateway trust signal present but WRONG value → 401 (fail-closed)
// ---------------------------------------------------------------------------
test('bbx-gw-authn-06: x-gateway-auth with wrong secret returns 401', async () => {
  await withSecuredServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${keysPath(WS_A)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': TEN_A,
        'x-workspace-id': WS_A,
        'x-gateway-auth': 'wrong-secret',
      },
      body: JSON.stringify({ keyType: 'service' }),
    });
    assert.equal(res.status, 401, `expected 401 for wrong gateway secret, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_UNAUTHENTICATED');
  });
});
