// Black-box tests for change fix-executor-rbac-scope-role-enforcement (#624).
//
// On the kind / APISIX-standalone profile the gateway scope-enforcement plugin is not wired and the
// executor trusted gateway headers, so intra-tenant RBAC was a no-op: a data:read key could WRITE and run
// DDL, and a non-admin role (tenant_developer) could ISSUE API keys. The fix makes the executor enforce
// the verified credential's OWN scopes (API keys) and roles (key management) as defense-in-depth.
//
// All tests drive createControlPlaneServer over its public HTTP interface only.
//
// bbx-624-01: data:read key write (POST documents)        -> 403 (executor not reached)
// bbx-624-02: data:read+data:write key DDL (POST schemas) -> 403 (no ddl:write scope)
// bbx-624-03: SERVICE key (full scopes) write             -> 201 (no regression)
// bbx-624-04: data:read key read (GET documents)          -> 200 (no regression)
// bbx-624-05: tenant_developer issuing api-keys           -> 403 (role unenforced was the bug)
// bbx-624-06: tenant_owner issuing api-keys               -> 201 (admin role allowed)
// bbx-624-07: JWT with EMPTY roles issuing api-keys       -> 403 (#773 structural positive role)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

const TEN = 'tenant_rbac';
const WS = 'ws_rbac';
const TRACE_HEADERS = {
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-rbac-scope',
};

// API keys keyed by presented secret → scope set. Every key is bound to (TEN, WS).
const KEY_SCOPES = {
  flc_service_read: ['data:read'],
  flc_service_nodll: ['data:read', 'data:write'],
  flc_service_full: ['data:read', 'data:write', 'ddl:write'],
};

function makeStores() {
  const issued = [];
  const mongoCalls = [];
  const apiKeyStore = {
    issued,
    async ensureSchema() {},
    async issueKey({ tenantId, workspaceId, keyType = 'service', scopes = [] }) {
      issued.push({ tenantId, workspaceId, keyType });
      const key = `flc_${keyType}_issued`;
      return { id: `id_${key}`, key, prefix: key.slice(0, 16), keyType, scopes, createdAt: new Date() };
    },
    async listKeys() { return []; },
    async verifyKey(presented) {
      const scopes = KEY_SCOPES[presented];
      if (!scopes) return null;
      return { tenantId: TEN, workspaceId: WS, keyType: 'service', roleName: 'falcone_service', dbRole: 'falcone_service', scopes };
    },
  };
  const mongoExecutor = {
    async executeMongoData(params) { mongoCalls.push(params); return { ok: true, document: params.payload?.document ?? {}, items: [] }; },
  };
  return { apiKeyStore, mongoExecutor, mongoCalls };
}

// A registry that throws if any data plan is executed — so a DDL 403 is provably pre-execution.
function neverConnectRegistry() {
  return createConnectionRegistry({ resolveConnection: () => { throw new Error('registry reached — scope check should run first'); } });
}

// Verified JWT identity (tenant-only admin) with the given realm roles.
function rolesJwtVerifier(roles) {
  return { async verify() { return { tenantId: TEN, workspaceId: undefined, credentialWorkspaceId: undefined, actorId: 'jwt:admin', roleName: 'falcone_app', roles, scopes: [] }; } };
}

async function withServer({ jwtVerifier } = {}, fn) {
  const { apiKeyStore, mongoExecutor, mongoCalls } = makeStores();
  const registry = neverConnectRegistry();
  const server = createControlPlaneServer({ registry, apiKeyStore, mongoExecutor, jwtVerifier, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ baseUrl, apiKeyStore, mongoCalls });
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const docs = (ws = WS, db = 'capdb', coll = 'default') => `/v1/mongo/workspaces/${ws}/data/${db}/collections/${coll}/documents`;
const schemas = (db = 'wsdb_app') => `/v1/postgres/databases/${db}/schemas`;
const keys = (ws = WS) => `/v1/workspaces/${ws}/api-keys`;

// ---------------------------------------------------------------------------
// Scope enforcement (API-key credentials)
// ---------------------------------------------------------------------------
test('bbx-624-01: a data:read key cannot write (POST documents) -> 403', async () => {
  await withServer({}, async ({ baseUrl, mongoCalls }) => {
    const res = await fetch(`${baseUrl}${docs()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, apikey: 'flc_service_read', 'content-type': 'application/json' },
      body: JSON.stringify({ document: { x: 1 } }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(mongoCalls.length, 0, 'a denied write must not reach the executor');
  });
});

test('bbx-624-02: a key without ddl:write cannot run DDL (POST schemas) -> 403', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}${schemas()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, apikey: 'flc_service_nodll', 'content-type': 'application/json' },
      body: JSON.stringify({ schemaName: 'probe' }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
  });
});

test('bbx-624-03: a SERVICE key with full scopes can write -> 201 (no regression)', async () => {
  await withServer({}, async ({ baseUrl, mongoCalls }) => {
    const res = await fetch(`${baseUrl}${docs()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, apikey: 'flc_service_full', 'content-type': 'application/json' },
      body: JSON.stringify({ document: { x: 1 } }),
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(mongoCalls.length, 1, 'an in-scope write reaches the executor');
  });
});

test('bbx-624-04: a data:read key can read (GET documents) -> 200 (no regression)', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}${docs()}`, { headers: { ...TRACE_HEADERS, apikey: 'flc_service_read' } });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
  });
});

// ---------------------------------------------------------------------------
// Role enforcement (key management)
// ---------------------------------------------------------------------------
test('bbx-624-05: a tenant_developer cannot issue API keys -> 403', async () => {
  await withServer({ jwtVerifier: rolesJwtVerifier(['tenant_developer']) }, async ({ baseUrl, apiKeyStore }) => {
    const res = await fetch(`${baseUrl}${keys()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, authorization: 'Bearer stub', 'content-type': 'application/json' },
      body: JSON.stringify({ keyType: 'service', scopes: ['data:read'] }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(apiKeyStore.issued.length, 0, 'a denied issuance must not persist a key');
  });
});

test('bbx-624-06: a tenant_owner may issue API keys -> 201', async () => {
  await withServer({ jwtVerifier: rolesJwtVerifier(['tenant_owner']) }, async ({ baseUrl, apiKeyStore }) => {
    const res = await fetch(`${baseUrl}${keys()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, authorization: 'Bearer stub', 'content-type': 'application/json' },
      body: JSON.stringify({ keyType: 'service', scopes: ['data:read'] }),
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(apiKeyStore.issued.length, 1, 'an admin issuance persists the key');
  });
});

test('bbx-624-07: a JWT with empty roles cannot issue API keys -> 403 (#773 structural positive role)', async () => {
  await withServer({ jwtVerifier: rolesJwtVerifier([]) }, async ({ baseUrl, apiKeyStore }) => {
    const res = await fetch(`${baseUrl}${keys()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, authorization: 'Bearer stub', 'content-type': 'application/json' },
      body: JSON.stringify({ keyType: 'service' }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(apiKeyStore.issued.length, 0, 'empty-role structural writes must not persist a key');
  });
});
