// Server-level identity precedence for Bearer JWTs: a verified JWT authenticates admin
// requests (e.g. API-key issuance) WITHOUT the gateway injecting x-tenant-id, derives the
// tenant from token claims (spoofed x-tenant-id ignored), and an invalid JWT fails closed.
// Uses an injected stub verifier — no crypto/registry/DB here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const registry = { withWorkspaceClient() { throw new Error('registry must not be reached'); } };

// Stub verifier: only "good.jwt.token" is valid → tenant from claims, not headers.
const jwtVerifier = {
  async verify(token) {
    if (token === 'good.jwt.token') {
      return { tenantId: 'ten-jwt', workspaceId: 'ws-jwt', actorId: 'admin-1', roleName: 'falcone_app', roles: ['tenant_admin'], scopes: [] };
    }
    throw new Error('invalid token');
  },
};
// Stub key store that echoes the tenant it was asked to issue for.
const apiKeyStore = {
  async issueKey({ tenantId, workspaceId, keyType }) { return { id: 'k1', key: 'flc_anon_xxx', tenantId, workspaceId, keyType }; },
  async listKeys(ws) { return [{ id: 'k1', workspace_id: ws }]; },
};

let server; let base;
before(async () => {
  server = createControlPlaneServer({ registry, apiKeyStore, jwtVerifier, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

const keys = (ws) => `${base}/v1/workspaces/${ws}/api-keys`;
const traceHeaders = {
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-c03-unit-jwt-identity',
};

test('a verified Bearer JWT authenticates issuance (no gateway header injection needed)', async () => {
  const res = await fetch(keys('ws-jwt'), {
    method: 'POST', headers: { ...traceHeaders, 'content-type': 'application/json', authorization: 'Bearer good.jwt.token' },
    body: JSON.stringify({ keyType: 'anon' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).tenantId, 'ten-jwt'); // tenant came from the token
});

test('JWT claims win over a spoofed x-tenant-id header', async () => {
  const res = await fetch(keys('ws-jwt'), {
    method: 'POST',
    headers: { ...traceHeaders, 'content-type': 'application/json', authorization: 'Bearer good.jwt.token', 'x-tenant-id': 'victim-tenant' },
    body: JSON.stringify({ keyType: 'service' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).tenantId, 'ten-jwt'); // NOT victim-tenant
});

test('an invalid Bearer JWT fails closed (401) even with x-tenant-id present', async () => {
  const res = await fetch(keys('ws-jwt'), {
    headers: { ...traceHeaders, authorization: 'Bearer forged', 'x-tenant-id': 'ten-admin' },
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'GW_UNAUTHENTICATED');
});

test('no credential → gateway-injected x-tenant-id header still trusted (Helm/OIDC path)', async () => {
  const res = await fetch(keys('ws-admin'), {
    headers: { ...traceHeaders, 'x-tenant-id': 'ten-admin', 'x-auth-subject': 'admin-1' },
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).items));
});
