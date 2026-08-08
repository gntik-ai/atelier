import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpRuntimeAdapter } from '../../apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs';

const manifest = { status: 'published', tools: [{ name: 'query_orders', description: 'Query orders.' }] };
const resolveRuntimeNamespace = ({ tenantId }) => `runtime-${tenantId}`;

test('adapter create and conflict patch ownership', async () => {
  const calls = [];
  const adapter = createMcpRuntimeAdapter({
    apiBase: 'https://k',
    token: 't',
    ca: 'test-ca',
    resolveRuntimeNamespace,
    runtimeImage: 'img',
    runtimeImageDigest: 'sha256:abc',
    runtimeApiBaseUrl: 'http://falcone-control-plane-executor.platform.svc.cluster.local:8080',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') return { status: 409, ok: false };
      if (init.method === 'GET') {
        return {
          status: 200,
          json: async () => ({
            metadata: {
              labels: { 'in-falcone.io/tenant': 't', 'in-falcone.io/mcp-server': 's' },
              resourceVersion: '9',
            },
          }),
        };
      }
      return { status: 200, ok: true };
    },
  });

  await adapter.apply({
    tenantId: 't', workspaceId: 'w', serverId: 's', version: 'v2', operation: 'approve', manifest,
  });
  assert.equal(calls[0].init.method, 'POST');
  const policyCreate = calls.find(({ url, init }) => init.method === 'POST' && String(url).endsWith('/networkpolicies'));
  assert.ok(policyCreate);
  const policy = JSON.parse(policyCreate.init.body);
  assert.deepEqual(policy.spec.ingress[0].ports, [
    { protocol: 'TCP', port: 8012 },
    { protocol: 'TCP', port: 8112 },
  ]);
  const serviceCreate = calls.find(({ url, init }) => init.method === 'POST' && String(url).endsWith('/services'));
  assert.ok(serviceCreate);
  const created = JSON.parse(serviceCreate.init.body);
  assert.match(created.spec.template.spec.containers[0].image, /sha256:abc/);
  assert.deepEqual(
    Object.fromEntries(created.spec.template.spec.containers[0].env.map(({ name, value }) => [name, value])),
    {
      FALCONE_MCP_WORKSPACE_ID: 'w',
      FALCONE_MCP_VERSION: 'v2',
      FALCONE_MCP_OPERATION: 'approve',
      FALCONE_MCP_MANIFEST_JSON: JSON.stringify(manifest),
      FALCONE_API_BASE_URL: 'http://falcone-control-plane-executor.platform.svc.cluster.local:8080',
    },
  );
  const servicePatch = calls.find(({ url, init }) => init.method === 'PATCH' && String(url).includes('/services/'));
  assert.ok(servicePatch);
  const patched = JSON.parse(servicePatch.init.body);
  assert.equal(patched.metadata.annotations['in-falcone.io/mcp-version'], 'v2');
  assert.equal(patched.metadata.annotations['in-falcone.io/mcp-operation'], 'approve');
});

test('adapter refuses foreign conflict, incomplete deployment contracts, and unavailable configuration', async () => {
  const adapter = createMcpRuntimeAdapter({
    apiBase: 'https://k',
    token: 't',
    ca: 'test-ca',
    resolveRuntimeNamespace,
    runtimeImage: 'img',
    runtimeApiBaseUrl: 'http://falcone-control-plane-executor.platform.svc.cluster.local:8080',
    fetchImpl: async (_url, init) => init.method === 'POST'
      ? { status: 409, ok: false }
      : { status: 200, json: async () => ({ metadata: { labels: {} } }) },
  });
  await assert.rejects(() => adapter.apply({
    tenantId: 't', workspaceId: 'w', serverId: 's', version: 'v1', operation: 'publish', manifest,
  }));
  await assert.rejects(
    () => adapter.apply({ tenantId: 't', workspaceId: 'w', serverId: 's' }),
    (error) => error.code === 'MCP_RUNTIME_CONTRACT_INVALID',
  );
  await assert.rejects(
    () => createMcpRuntimeAdapter({
      apiBase: 'https://k', token: 't', ca: 'test-ca', resolveRuntimeNamespace,
      runtimeImage: 'img', runtimeApiBaseUrl: 'http://executor.invalid/path',
    }).apply({
      tenantId: 't', workspaceId: 'w', serverId: 's', version: 'v1', operation: 'publish', manifest,
    }),
    (error) => error.code === 'MCP_RUNTIME_API_BASE_URL_INVALID' && error.statusCode === 503,
  );
  await assert.rejects(() => createMcpRuntimeAdapter({}).apply({ tenantId: 't', serverId: 's' }));
});

test('adapter invoke sends trusted JSON-RPC context, strips ownership arguments, and propagates errors', async () => {
  const calls = [];
  let responseBody = { jsonrpc: '2.0', id: 'corr-1', result: { content: [], isError: false } };
  let status = 200;
  const adapter = createMcpRuntimeAdapter({
    resolveRuntimeNamespace,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status, ok: status >= 200 && status < 300, json: async () => responseBody };
    },
  });
  const result = await adapter.invoke({
    tenantId: 't', workspaceId: 'w', serverId: 's', version: 'v2', tool: 'query_orders',
    args: { query: 'kept', tenantId: 'smuggled', tenant_id: 'smuggled', workspaceId: 'wrong', workspace_id: 'wrong' },
    roles: ['workspace_owner'], scopes: ['mcp:invoke'], correlationId: 'corr-1',
    authorization: 'Bearer delegated-caller-token',
  });
  assert.deepEqual(result, { content: [], isError: false });
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('x-tenant-id'), 't');
  assert.equal(headers.get('x-workspace-id'), 'w');
  assert.equal(headers.get('x-actor-roles'), 'workspace_owner');
  assert.equal(headers.get('x-auth-scopes'), 'mcp:invoke');
  assert.equal(headers.get('x-correlation-id'), 'corr-1');
  assert.equal(headers.get('authorization'), 'Bearer delegated-caller-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    jsonrpc: '2.0', id: 'corr-1', method: 'tools/call',
    params: { name: 'query_orders', arguments: { query: 'kept' } },
  });

  responseBody = { jsonrpc: '2.0', id: 'corr-1', error: { code: -32601, message: 'unknown tool' } };
  await assert.rejects(
    () => adapter.invoke({
      tenantId: 't', workspaceId: 'w', serverId: 's', tool: 'missing', args: {},
      correlationId: 'corr-1', authorization: 'Bearer delegated-caller-token',
    }),
    (error) => error.code === 'MCP_RUNTIME_RPC_ERROR' && error.rpcCode === -32601,
  );

  status = 503;
  await assert.rejects(
    () => adapter.invoke({
      tenantId: 't', workspaceId: 'w', serverId: 's', tool: 'x', args: {},
      authorization: 'Bearer delegated-caller-token',
    }),
    (error) => error.code === 'MCP_RUNTIME_INVOKE_FAILED' && error.statusCode === 503,
  );

  await assert.rejects(
    () => adapter.invoke({ tenantId: 't', workspaceId: 'w', serverId: 's', tool: 'x', args: {} }),
    (error) => error.code === 'MCP_RUNTIME_DELEGATED_CREDENTIAL_REQUIRED' && error.statusCode === 401,
  );
});
