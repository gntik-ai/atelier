// Regression coverage for #773 on the control-plane executor JWT/header path.
//
// The dispatcher must deny structural writes by API-key credentials and non-admin/no-role identities
// before any side-effecting executor/store is reached, must enforce explicit workspaceIds for
// workspace-scoped admin roles, and must reject unknown workspaces instead of phantom-creating
// provider/MCP/Event records.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const TENANT = 'ten-a';
const WS = 'ws-a';
const WS_OTHER = 'ws-other';
const WS_UNKNOWN = 'ws-missing';
const SERVICE_KEY = 'flc_service_structural_write_gate';

function makeFakes() {
  const calls = [];
  return {
    calls,
    apiKeyStore: {
      async verifyKey(key) {
        if (key !== SERVICE_KEY) return null;
        return {
          tenantId: TENANT,
          workspaceId: WS,
          keyType: 'service',
          roleName: 'falcone_service',
          dbRole: 'falcone_service',
          scopes: ['data:read', 'data:write', 'ddl:write'],
        };
      },
    },
    mongoExecutor: {
      async executeMongoData(params) {
        calls.push({ family: 'mongo', params });
        return { ok: true, document: params.payload?.document ?? {} };
      },
    },
    llmExecutor: {
      async setProvider(workspaceId, config) {
        calls.push({ family: 'llm', workspaceId, config });
        return { workspaceId, providerType: config.providerType ?? 'mock' };
      },
      async getProvider() { return { providerType: 'mock' }; },
      async removeProvider(workspaceId, tenantId) {
        calls.push({ family: 'llm-remove', workspaceId, tenantId });
        return { removed: true };
      },
    },
    embeddingExecutor: {
      async deployProvider(workspaceId, config) {
        calls.push({ family: 'embedding', workspaceId, config });
        return { workspaceId, providerType: config.providerType ?? 'mock' };
      },
      store: {
        async getProvider() { return { providerType: 'mock' }; },
        async removeProvider(workspaceId, tenantId) {
          calls.push({ family: 'embedding-remove', workspaceId, tenantId });
          return { removed: true };
        },
      },
    },
    mappingStore: {
      async deployMapping(workspaceId, config) {
        calls.push({ family: 'mapping', workspaceId, config });
        return { workspaceId, ...config };
      },
      async getMappings() { return [{ targetColumn: 'embedding' }]; },
      async getMapping() { return { targetColumn: 'embedding' }; },
      async removeMapping(workspaceId, config) {
        calls.push({ family: 'mapping-remove', workspaceId, config });
        return { removed: true };
      },
    },
    mcpEngine: {
      async executeMcp(params) {
        calls.push({ family: 'mcp', params });
        return { serverId: 'srv-a', status: 'draft' };
      },
    },
    eventsExecutor: {
      async executeEvents(params) {
        calls.push({ family: 'events', params });
        return params.operation === 'publish'
          ? { topic: params.topic, published: 1 }
          : { topic: params.topic ?? params.payload?.name ?? 'orders', created: true };
      },
    },
  };
}

const IDENTITIES = {
  viewer: { tenantId: TENANT, actorId: 'viewer', roleName: 'falcone_app', roles: ['tenant_viewer'], scopes: [], workspaceIds: [WS] },
  developer: { tenantId: TENANT, actorId: 'dev', roleName: 'falcone_app', roles: ['tenant_developer'], scopes: [], workspaceIds: [WS] },
  no_roles: { tenantId: TENANT, actorId: 'noroles', roleName: 'falcone_app', roles: [], scopes: [], workspaceIds: [WS] },
  owner: { tenantId: TENANT, actorId: 'owner', roleName: 'falcone_app', roles: ['tenant_owner'], scopes: [] },
  wsadmin_other: { tenantId: TENANT, actorId: 'wsadmin', roleName: 'falcone_app', roles: ['workspace_admin'], scopes: [], workspaceIds: [WS_OTHER] },
};

function jwtVerifier() {
  return {
    async verify(token, pathWorkspaceId) {
      const identity = IDENTITIES[token];
      if (!identity) throw new Error('unknown token');
      return { ...identity, workspaceId: pathWorkspaceId };
    },
  };
}

function resolveWorkspaceTenant(workspaceId) {
  if (workspaceId === WS || workspaceId === WS_OTHER) return TENANT;
  return undefined;
}

async function withServer(fn) {
  const fakes = makeFakes();
  const server = createControlPlaneServer({
    registry: {},
    apiKeyStore: fakes.apiKeyStore,
    jwtVerifier: jwtVerifier(),
    resolveWorkspaceTenant,
    mongoExecutor: fakes.mongoExecutor,
    llmExecutor: fakes.llmExecutor,
    embeddingExecutor: fakes.embeddingExecutor,
    mappingStore: fakes.mappingStore,
    mcpEngine: fakes.mcpEngine,
    eventsExecutor: fakes.eventsExecutor,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ baseUrl, calls: fakes.calls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-api-version': '2026-03-26',
    'x-correlation-id': 'corr-bbx-structural-role',
  };
}

function apiKeyHeaders() {
  return {
    apikey: SERVICE_KEY,
    'content-type': 'application/json',
    'x-api-version': '2026-03-26',
    'x-correlation-id': 'corr-bbx-structural-apikey',
  };
}

async function jsonFetch(baseUrl, path, { method = 'PUT', token = 'viewer', body = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

async function apiKeyJsonFetch(baseUrl, path, { method = 'PUT', body = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: apiKeyHeaders(),
    body: JSON.stringify(body),
  });
}

test('executor structural writes deny viewer/developer before LLM, embedding, MCP, and Events side effects', async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const cases = [
      { token: 'viewer', method: 'PUT', path: `/v1/workspaces/${WS}/llm-provider`, body: { providerType: 'mock' } },
      { token: 'developer', method: 'PUT', path: `/v1/workspaces/${WS}/embedding-provider`, body: { providerType: 'mock' } },
      { token: 'developer', method: 'PUT', path: `/v1/postgres/workspaces/${WS}/data/appdb/schemas/public/tables/docs/embedding-mapping`, body: { sourceColumn: 'body', targetColumn: 'embedding' } },
      { token: 'viewer', method: 'POST', path: `/v1/mcp/workspaces/${WS}/servers`, body: { name: 'blocked' } },
      { token: 'developer', method: 'POST', path: `/v1/events/workspaces/${WS}/topics`, body: { topic: 'orders' } },
      { token: 'developer', method: 'POST', path: `/v1/events/workspaces/${WS}/topics/orders/publish`, body: { value: { id: 1 } } },
    ];

    for (const entry of cases) {
      const res = await jsonFetch(baseUrl, entry.path, entry);
      assert.equal(res.status, 403, `${entry.method} ${entry.path} should be 403, got ${res.status}: ${await res.clone().text()}`);
      assert.equal((await res.json()).code, 'GW_FORBIDDEN');
    }
    assert.deepEqual(calls, [], 'denied structural writes must not reach any side-effecting executor');
  });
});

test('executor structural writes deny API keys and no-role JWTs before side effects', async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const apiKeyLlm = await apiKeyJsonFetch(baseUrl, `/v1/workspaces/${WS}/llm-provider`, {
      method: 'PUT',
      body: { providerType: 'mock' },
    });
    assert.equal(apiKeyLlm.status, 403, `API-key LLM config write should be 403, got ${apiKeyLlm.status}: ${await apiKeyLlm.clone().text()}`);
    assert.equal((await apiKeyLlm.json()).code, 'GW_FORBIDDEN');

    const apiKeyMcp = await apiKeyJsonFetch(baseUrl, `/v1/mcp/workspaces/${WS}/servers`, {
      method: 'POST',
      body: { name: 'blocked' },
    });
    assert.equal(apiKeyMcp.status, 403, `API-key MCP create should be 403, got ${apiKeyMcp.status}: ${await apiKeyMcp.clone().text()}`);
    assert.equal((await apiKeyMcp.json()).code, 'GW_FORBIDDEN');

    const noRoleJwt = await jsonFetch(baseUrl, `/v1/workspaces/${WS}/llm-provider`, {
      token: 'no_roles',
      body: { providerType: 'mock' },
    });
    assert.equal(noRoleJwt.status, 403, `empty-role JWT structural write should be 403, got ${noRoleJwt.status}: ${await noRoleJwt.clone().text()}`);
    assert.equal((await noRoleJwt.json()).code, 'GW_FORBIDDEN');

    assert.deepEqual(calls, [], 'denied API-key/no-role structural writes must not reach side-effecting executors');
  });
});

test('executor API-key non-structural data write remains governed by data:write scope', async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const res = await apiKeyJsonFetch(baseUrl, `/v1/mongo/workspaces/${WS}/data/appdb/collections/docs/documents`, {
      method: 'POST',
      body: { document: { ok: true } },
    });
    assert.equal(res.status, 201, `API-key data write should still succeed, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].family, 'mongo');
    assert.equal(calls[0].params.identity.dbRole, 'falcone_service');
  });
});

test('executor structural writes enforce workspaceIds and reject unknown workspaces without phantom writes', async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const scopedOut = await jsonFetch(baseUrl, `/v1/workspaces/${WS}/llm-provider`, {
      token: 'wsadmin_other',
      body: { providerType: 'mock' },
    });
    assert.equal(scopedOut.status, 403, `workspaceIds miss should be 403, got ${scopedOut.status}: ${await scopedOut.clone().text()}`);
    assert.equal((await scopedOut.json()).code, 'GW_FORBIDDEN');

    const unknown = await jsonFetch(baseUrl, `/v1/workspaces/${WS_UNKNOWN}/llm-provider`, {
      token: 'owner',
      body: { providerType: 'mock' },
    });
    assert.equal(unknown.status, 404, `unknown workspace should be 404, got ${unknown.status}: ${await unknown.clone().text()}`);
    assert.equal((await unknown.json()).code, 'GW_WORKSPACE_NOT_FOUND');
    assert.deepEqual(calls, [], 'workspace-scope and unknown-workspace denials must not create provider records');
  });
});

test('executor structural writes still allow an owner on a known workspace', async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const res = await jsonFetch(baseUrl, `/v1/workspaces/${WS}/llm-provider`, {
      token: 'owner',
      body: { providerType: 'mock' },
    });
    assert.equal(res.status, 200, `owner write should succeed, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].family, 'llm');
    assert.equal(calls[0].workspaceId, WS);
  });
});
