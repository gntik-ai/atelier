// Identity precedence in the control-plane executor: a presented API key is AUTHORITATIVE
// over request identity headers, and an invalid key fails closed (no header fallback). This
// guards the no-JWT api-key gateway route against header spoofing (apikey + spoofed
// x-tenant-id must NOT grant the spoofed tenant). Pure node:http test with a stub api-key
// store — exercised through the api-key management routes, so no registry/DB is touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const registry = { withWorkspaceClient() { throw new Error('registry must not be reached'); } };

// Stub store: one valid anon key bound to tenant ten-key / workspace ws-key.
const VALID_KEY = 'flc_anon_validkey000000000000000000';
const apiKeyStore = {
  async verifyKey(key) {
    if (key === VALID_KEY) {
      return { tenantId: 'ten-key', workspaceId: 'ws-key', keyType: 'anon', roleName: 'falcone_app', dbRole: 'falcone_anon', scopes: [] };
    }
    return undefined;
  },
  async listKeys(workspaceId) { return [{ id: 'k1', workspace_id: workspaceId, key_type: 'anon' }]; },
};

let server;
let base;
before(async () => {
  server = createControlPlaneServer({ registry, apiKeyStore, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

const keysPath = (ws) => `/v1/workspaces/${ws}/api-keys`;

test('a valid API key is authoritative — a spoofed x-tenant-id header cannot override it', async () => {
  // GET api-keys with a valid anon key AND a spoofed admin tenant header. The key resolves to
  // an api-key identity (dbRole set) → key management is forbidden for api keys → 403.
  // If the spoofed header won instead, this would be treated as an admin JWT identity → 200.
  const res = await fetch(`${base}${keysPath('ws-attacker')}`, {
    headers: { apikey: VALID_KEY, 'x-tenant-id': 'victim-tenant', 'x-workspace-id': 'victim-ws' },
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'GW_FORBIDDEN');
});

test('an invalid API key fails closed (401) even when x-tenant-id is present', async () => {
  const res = await fetch(`${base}${keysPath('ws-x')}`, {
    headers: { apikey: 'flc_anon_bogus', 'x-tenant-id': 'ten-admin' },
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'GW_UNAUTHENTICATED');
});

test('no API key → gateway-injected JWT identity headers are trusted (admin path preserved)', async () => {
  const res = await fetch(`${base}${keysPath('ws-admin')}`, {
    headers: { 'x-tenant-id': 'ten-admin', 'x-auth-subject': 'user-1' },
  });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(Array.isArray(out.items));
});

test('Authorization: ApiKey form is also authoritative', async () => {
  const res = await fetch(`${base}${keysPath('ws-attacker')}`, {
    headers: { authorization: `ApiKey ${VALID_KEY}`, 'x-tenant-id': 'victim-tenant' },
  });
  assert.equal(res.status, 403);
});
