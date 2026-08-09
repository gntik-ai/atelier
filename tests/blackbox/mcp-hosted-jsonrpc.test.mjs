/**
 * Black-box tests for add-mcp-jsonrpc-protocol (#608).
 *
 * A HOSTED per-workspace MCP server (created → curated → published via the management API) is now
 * reachable over the STANDARD MCP wire protocol (JSON-RPC 2.0 over HTTP POST) at
 * `POST /v1/mcp/workspaces/{ws}/servers/{sid}/rpc`, so an external MCP client can `initialize` →
 * `tools/list` → `tools/call`. Previously the only surface was the internal REST `tool-calls` route.
 *
 * Driven through the real HTTP surface (createControlPlaneServer with an injected mcpEngine). The
 * engine self-call uses a capturing fake fetch so a `tools/call` is observed hitting the real
 * executor route (not the executor index). The tenant/workspace are ALWAYS credential-derived
 * (identity headers / server context), NEVER taken from the JSON-RPC message.
 *
 * bbx-608-initialize:    initialize → protocolVersion + serverInfo {name}
 * bbx-608-tools-list:    tools/list → published tools, each with an inputSchema
 * bbx-608-tools-call:    tools/call a read tool → content; self-call hit the real /v1/... route
 * bbx-608-ping:          ping → {}
 * bbx-608-unknown:       an unknown method → JSON-RPC error -32601
 * bbx-608-notification:  notifications/initialized (no id) → HTTP 202, no JSON-RPC body
 * bbx-608-unauth:        no identity → HTTP 401 (route is authenticated)
 * bbx-608-cross-tenant:  tenant B initialize on tenant A's server → JSON-RPC error (404, not leaked)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createMcpEngine } from '../../apps/control-plane-executor/src/runtime/mcp-engine.mjs';
import { BASE_SCOPE } from '../../apps/control-plane-executor/src/mcp-official-catalog.mjs';

const A = { tenantId: 'ten-a', workspaceId: 'ws-a', actorId: 'actor-a', roleName: 'falcone_app', scopes: [BASE_SCOPE] };
const SELF = 'http://exec.local';
const TEST_DIGEST = `sha256:${'b'.repeat(64)}`;
const PG = { database: 'app', name: 'public', tables: [{ name: 'orders', columns: [{ name: 'id', type: 'bigint' }, { name: 'total', type: 'numeric' }] }] };

// Capturing self-call fake: the root `/` returns the executor INDEX (the bug symptom), a real
// `/v1/...` route returns a route-specific 200. Lets us assert a tools/call hit a real route.
function captureFetch() {
  const calls = [];
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method });
    if (path === '/' || path === '') return { status: 200, async json() { return { service: 'in-falcone-control-plane' }; } };
    return { status: 200, async json() { return { ok: true, routed: path }; } };
  };
  impl.calls = calls;
  return impl;
}

let cp; let baseUrl; let fetchImpl; let serverId;

test.before(async () => {
  fetchImpl = captureFetch();
  const engine = createMcpEngine({ selfBaseUrl: SELF, gatewayBaseUrl: 'https://gw.local', fetchImpl, runtimeImageDigest: TEST_DIGEST });
  // Publish an instant postgres server for tenant A / ws-a (create → curate → publish v1).
  const created = await engine.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'orders-mcp', source: 'instant', resources: { postgres: PG } } });
  serverId = created.serverId;
  await engine.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId, body: { decisions: {} } });
  await engine.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId, version: 'v1', body: { version: 'v1' } });

  cp = createControlPlaneServer({ registry: {}, mcpEngine: engine, logger: { error() {} } });
  await new Promise((r) => cp.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${cp.address().port}`;
});

test.after(async () => { await new Promise((r) => cp.close(r)); });

// JSON-RPC POST against a hosted server's /rpc endpoint with gateway-injected trusted identity.
function rpc(message, { tenantId = A.tenantId, workspaceId = A.workspaceId, sid = serverId, auth = true, scopes = [BASE_SCOPE] } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) {
    headers['x-api-version'] = '2026-03-26';
    headers['x-correlation-id'] = 'corr-bbx-hosted-mcp';
    headers['x-tenant-id'] = tenantId;
    headers['x-workspace-id'] = workspaceId;
    headers['x-auth-subject'] = 'user:agent';
    headers['x-auth-scopes'] = scopes.join(' ');
  }
  return fetch(`${baseUrl}/v1/mcp/workspaces/${workspaceId}/servers/${sid}/rpc`, {
    method: 'POST', headers, body: JSON.stringify(message),
  });
}

test('bbx-608-initialize: initialize returns protocolVersion + serverInfo', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 1);
  assert.match(body.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.result.serverInfo.name, 'orders-mcp');
  assert.ok(body.result.capabilities.tools);
});

test('bbx-608-tools-list: tools/list returns published tools with inputSchema', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.result.tools) && body.result.tools.length > 0);
  const query = body.result.tools.find((t) => t.name === 'query_orders');
  assert.ok(query, 'expected the generated query_orders tool');
  assert.equal(typeof query.inputSchema, 'object');
  assert.equal(query.inputSchema.type, 'object');
});

test('bbx-608-tools-call: a read tool call returns content and hit the real executor route', async () => {
  const before = fetchImpl.calls.length;
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query_orders', arguments: {} } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, 3);
  assert.ok(Array.isArray(body.result.content) && body.result.content.length > 0);
  assert.equal(body.result.isError, false);
  // The self-call hit a real /v1/... route (the credential-bound workspace), not the executor index.
  const newCalls = fetchImpl.calls.slice(before);
  assert.ok(newCalls.some((cl) => cl.path.startsWith('/v1/') && cl.path.includes(A.workspaceId)));
  assert.ok(!newCalls.some((cl) => cl.path === '/'));
});

test('bbx-608-ping: ping returns an empty result', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 4, method: 'ping' });
  const body = await res.json();
  assert.deepEqual(body.result, {});
});

test('bbx-608-unknown: an unknown method returns JSON-RPC -32601', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.error.code, -32601);
});

test('bbx-608-notification: a notification (no id) yields 202 and no JSON-RPC body', async () => {
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
});

test('bbx-608-unauth: no identity → HTTP 401', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 7, method: 'initialize' }, { auth: false });
  assert.equal(res.status, 401);
});

test('bbx-608-cross-tenant: another tenant cannot initialize tenant A\'s server', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 8, method: 'initialize' }, { tenantId: 'ten-b', workspaceId: 'ws-a' });
  assert.equal(res.status, 200);
  const body = await res.json();
  // Server is invisible to tenant B → JSON-RPC error, no serverInfo leaked.
  assert.ok(body.error, 'expected a JSON-RPC error for a cross-tenant server lookup');
  assert.equal(body.result, undefined);
});
