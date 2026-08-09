/**
 * Black-box tests for add-platform-mcp-http-route (#607).
 *
 * The platform (first-party) MCP server (`apps/control-plane-executor/src/mcp-official-server.mjs`) exposes
 * ~9 Falcone management tools as JSON-RPC but previously had NO HTTP route, so an MCP client could
 * not reach it. This wires `POST /v1/mcp/rpc` on the executor: it dispatches the JSON-RPC message to
 * the official handler with a control-plane client bound to the caller's own credential.
 *
 * Driven through the real HTTP surface (createControlPlaneServer + a fake control-plane upstream).
 * No database is required — the route only needs an identity and the upstream client.
 *
 * bbx-607-initialize:        initialize → protocolVersion + serverInfo (no scope required)
 * bbx-607-tools-list:        tools/list → the official tool catalog (no scope required)
 * bbx-607-call-read:         a read tool (base scope) → proxies to the control-plane, forwards the bearer
 * bbx-607-call-mutate-scope: a mutating tool without its scope → JSON-RPC error -32002 (no upstream call)
 * bbx-607-unauthenticated:   no identity → HTTP 401 (route is authenticated)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const TENANT_A = 'ten_acme';

// A fake control-plane upstream: records every request and returns canned JSON.
function startUpstream() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        apiVersion: req.headers['x-api-version'],
        correlationId: req.headers['x-correlation-id'],
        body
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [{ id: 'wrk_1', name: 'app-staging' }] }));
    });
  });
  return { server, calls };
}

let cp; let cpUrl; let upstream; let baseUrl;

test.before(async () => {
  upstream = startUpstream();
  await new Promise((r) => upstream.server.listen(0, '127.0.0.1', r));
  cpUrl = `http://127.0.0.1:${upstream.server.address().port}`;

  // A stub registry satisfies the constructor; the MCP route never touches it.
  cp = createControlPlaneServer({ registry: {}, controlPlaneUpstream: cpUrl, logger: { error() {} } });
  await new Promise((r) => cp.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${cp.address().port}`;
});

test.after(async () => {
  await new Promise((r) => cp.close(r));
  await new Promise((r) => upstream.server.close(r));
});

// Gateway-injected trusted identity headers (the dev trust-header path; GATEWAY_SHARED_SECRET unset).
function rpc(message, { scopes = [], bearer } = {}) {
  return fetch(`${baseUrl}/v1/mcp/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-version': '2026-03-26',
      'x-correlation-id': 'corr-bbx-platform-mcp',
      'x-tenant-id': TENANT_A,
      'x-auth-subject': 'user:platform-admin',
      ...(scopes.length ? { 'x-actor-scopes': scopes.join(' ') } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(message),
  });
}

test('bbx-607-initialize: initialize returns protocolVersion + serverInfo', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.id, 1);
  assert.ok(json.result.protocolVersion, 'has a protocol version');
  assert.equal(json.result.serverInfo.name, 'falcone-official-mcp');
});

test('bbx-607-tools-list: tools/list returns the official tool catalog', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const json = await res.json();
  assert.ok(Array.isArray(json.result.tools) && json.result.tools.length >= 1, 'non-empty tool list');
  assert.ok(json.result.tools.some((t) => t.name === 'list_workspaces'), 'includes list_workspaces');
});

test('bbx-607-call-read: a read tool with the base scope proxies to the control-plane, forwarding the bearer', async () => {
  const before = upstream.calls.length;
  const res = await rpc(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_workspaces', arguments: {} } },
    { scopes: ['mcp:invoke'], bearer: 'tok-abc' },
  );
  const json = await res.json();
  assert.ok(json.result?.content?.[0]?.text, 'tool returns content');
  assert.match(json.result.content[0].text, /wrk_1/, 'content carries the upstream response');
  const call = upstream.calls[before];
  assert.equal(call.method, 'GET');
  assert.equal(call.path, '/v1/workspaces');
  assert.equal(call.authorization, 'Bearer tok-abc', 'caller bearer forwarded to the control-plane');
  assert.equal(call.apiVersion, '2026-03-26', 'internal MCP call pins the public API version');
  assert.equal(call.correlationId, 'corr-bbx-platform-mcp', 'internal MCP call preserves request correlation');
});

test('bbx-607-call-mutate-scope: a mutating tool without its scope is refused (no upstream call)', async () => {
  const before = upstream.calls.length;
  const res = await rpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_workspace', arguments: { name: 'x' } } },
    { scopes: ['mcp:invoke'] }, // base scope only, NOT the per-tool mutating scope
  );
  const json = await res.json();
  assert.ok(json.error, 'JSON-RPC error envelope');
  assert.equal(json.error.code, -32002, 'mutating-scope-required error');
  assert.equal(upstream.calls.length, before, 'no upstream call was made');
});

test('bbx-607-unauthenticated: no trusted identity → HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/v1/mcp/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'initialize' }),
  });
  assert.equal(res.status, 401);
});
