// Black-box tests for change fix-executor-apikey-cross-tenant-idor (#517, Epic A #512).
//
// Confirmed P0 cross-tenant IDOR: the executor's `POST /v1/workspaces/{workspaceId}/api-keys`
// route issued a key without verifying that {workspaceId} belongs to the authenticated caller's
// tenant. A tenant-A admin (tenant-only JWT, no workspace binding — so the existing credential
// ⇄ path workspace check does not apply) could mint a key scoped to a tenant-B workspace.
//
// These tests drive createControlPlaneServer over its public HTTP interface only. The
// workspace → owning-tenant mapping is supplied via the server's injected resolveWorkspaceTenant
// (in production this reads workspace_databases.tenant_id), exactly as a real deployment wires it.
//
// bbx-xt-idor-01: tenant-A admin token, POST api-keys on a tenant-B workspace → 403 CROSS_TENANT_VIOLATION (no key minted)
// bbx-xt-idor-02: tenant-A admin token, POST api-keys on its OWN workspace      → 201 (unchanged)
// bbx-xt-idor-03: tenant-A admin token, GET (list) api-keys on a tenant-B workspace → 403 CROSS_TENANT_VIOLATION
// bbx-xt-idor-04: tenant-A admin token, POST api-keys on an UNKNOWN workspace   → 404 WORKSPACE_NOT_FOUND (no phantom key)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

const TEN_A = 'tenant_xt_a';
const WS_A = 'ws_xt_a';
const TEN_B = 'tenant_xt_b';
const WS_B = 'ws_xt_b';
const WS_UNKNOWN = 'ws_xt_unprovisioned';

// Owning-tenant registry stub (production: SELECT tenant_id FROM workspace_databases WHERE
// workspace_id = $1). Unknown workspaces resolve to undefined (no provisioned database yet).
const OWNER_BY_WORKSPACE = new Map([[WS_A, TEN_A], [WS_B, TEN_B]]);
async function resolveWorkspaceTenant(workspaceId) {
  return OWNER_BY_WORKSPACE.get(workspaceId);
}

// In-memory api-key store that records whether issueKey was reached, so a 403 can be asserted to
// be a genuine pre-issuance rejection (no key persisted), not a post-hoc filter.
function makeApiKeyStore() {
  const issued = [];
  return {
    issued,
    async ensureSchema() {},
    async issueKey({ tenantId, workspaceId, keyType = 'anon', scopes = [] }) {
      issued.push({ tenantId, workspaceId, keyType });
      const key = `flc_${keyType}_test_${tenantId}_${workspaceId}`;
      return { id: `id_${key}`, key, prefix: key.slice(0, 16), keyType, scopes, createdAt: new Date() };
    },
    async listKeys() { return []; },
    async verifyKey() { return null; },
    async revokeKey() { return { revoked: true }; },
    async rotateKey() { return {}; },
  };
}

// A tenant-only admin identity (verified JWT with a tenant_id claim, admin role, and NO workspace
// binding) for the given tenant. This is the credential class that bypassed the existing
// workspace-binding check.
function adminJwtVerifier(tenantId) {
  return {
    async verify() {
      return { tenantId, workspaceId: undefined, actorId: `admin:${tenantId}`, roleName: 'falcone_app', roles: ['tenant_owner'], scopes: [] };
    },
  };
}

function neverConnectRegistry() {
  return createConnectionRegistry({
    resolveConnection: () => { throw new Error('registry.resolveConnection reached — ownership check should run first'); },
  });
}

async function withServer({ tenantId }, fn) {
  const apiKeyStore = makeApiKeyStore();
  const registry = neverConnectRegistry();
  const server = createControlPlaneServer({
    registry,
    apiKeyStore,
    resolveWorkspaceTenant,
    jwtVerifier: adminJwtVerifier(tenantId),
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, apiKeyStore);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const ADMIN = { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.stub.stub', 'content-type': 'application/json' };

// ---------------------------------------------------------------------------
// bbx-xt-idor-01: cross-tenant issuance is rejected and no key is minted
// ---------------------------------------------------------------------------
test('bbx-xt-idor-01: tenant-A admin minting an api-key in a tenant-B workspace returns 403 CROSS_TENANT_VIOLATION', async () => {
  await withServer({ tenantId: TEN_A }, async (baseUrl, apiKeyStore) => {
    const res = await fetch(`${baseUrl}/v1/workspaces/${WS_B}/api-keys`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ keyType: 'anon' }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN, got ${body.code}`);
    assert.equal(apiKeyStore.issued.length, 0, 'no key may be persisted for a foreign-tenant workspace');
  });
});

// ---------------------------------------------------------------------------
// bbx-xt-idor-02: same-tenant issuance still succeeds (no regression)
// ---------------------------------------------------------------------------
test('bbx-xt-idor-02: tenant-A admin minting an api-key in its OWN workspace returns 201', async () => {
  await withServer({ tenantId: TEN_A }, async (baseUrl, apiKeyStore) => {
    const res = await fetch(`${baseUrl}/v1/workspaces/${WS_A}/api-keys`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ keyType: 'anon' }),
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}`);
    const body = await res.json();
    assert.match(body.key ?? '', /^flc_anon_/, 'a valid anon key should be returned');
    assert.equal(apiKeyStore.issued.length, 1, 'own-workspace issuance must persist the key');
    assert.equal(apiKeyStore.issued[0].tenantId, TEN_A);
  });
});

// ---------------------------------------------------------------------------
// bbx-xt-idor-03: cross-tenant key management (list) is rejected too
// ---------------------------------------------------------------------------
test('bbx-xt-idor-03: tenant-A admin listing api-keys of a tenant-B workspace returns 403 CROSS_TENANT_VIOLATION', async () => {
  await withServer({ tenantId: TEN_A }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/workspaces/${WS_B}/api-keys`, { headers: ADMIN });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN, got ${body.code}`);
  });
});

// ---------------------------------------------------------------------------
// bbx-xt-idor-04: an unprovisioned workspace (no recorded owner) is rejected
// #773 tightened structural writes so unknown workspace ids cannot create phantom resources.
// ---------------------------------------------------------------------------
test('bbx-xt-idor-04: issuance in a workspace with no recorded owner returns 404 and persists no key', async () => {
  await withServer({ tenantId: TEN_A }, async (baseUrl, apiKeyStore) => {
    const res = await fetch(`${baseUrl}/v1/workspaces/${WS_UNKNOWN}/api-keys`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ keyType: 'anon' }),
    });
    assert.equal(res.status, 404, `expected 404, got ${res.status}: ${await res.clone().text()}`);
    assert.equal((await res.json()).code, 'GW_WORKSPACE_NOT_FOUND');
    assert.equal(apiKeyStore.issued.length, 0, 'unknown workspace structural writes must persist nothing');
  });
});
