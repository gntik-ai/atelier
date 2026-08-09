/**
 * Black-box tests for add-control-mcp-completeness (#642).
 *
 * The first-party control MCP (`POST /v1/mcp/rpc`) was non-functional end-to-end: every tools/call
 * failed `-32001 missing required scope: mcp:invoke` (the base scope was never provisioned), and the
 * catalog paths did not match the served routes. This suite drives the real HTTP surface
 * (createControlPlaneServer + a fake upstream) and asserts the completeness behaviors:
 *
 * bbx-642-autograant-read:   an authenticated principal with NO mcp:invoke scope can call a read tool
 * bbx-642-create-retarget:   create_workspace proxies to the SERVED tenant-scoped route (tenant from credential)
 * bbx-642-config-superadmin: set_mcp_config is superadmin-only; a disabled tool then becomes uncallable
 * bbx-642-authoring:         plan_project returns a deterministic plan without any upstream call
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const TENANT_A = 'ten_acme';

function startUpstream() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: 'wrk_new' }));
    });
  });
  return { server, calls };
}

let cp; let upstream; let baseUrl;

test.before(async () => {
  upstream = startUpstream();
  await new Promise((r) => upstream.server.listen(0, '127.0.0.1', r));
  const cpUrl = `http://127.0.0.1:${upstream.server.address().port}`;
  // No mcpSelfBaseUrl in this harness → the dispatcher falls back to the (fake) control-plane
  // upstream, which records the proxied request. createControlPlaneServer validates the upstream.
  cp = createControlPlaneServer({ registry: {}, controlPlaneUpstream: cpUrl, logger: { error() {} } });
  await new Promise((r) => cp.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${cp.address().port}`;
});

test.after(async () => {
  await new Promise((r) => cp.close(r));
  await new Promise((r) => upstream.server.close(r));
});

// Trust-header identity path (GATEWAY_SHARED_SECRET unset). `scopes`/`roles` optional.
function rpc(message, { scopes, roles, bearer } = {}) {
  return fetch(`${baseUrl}/v1/mcp/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-version': '2026-03-26',
      'x-correlation-id': 'corr-bbx-mcp-completeness',
      'x-tenant-id': TENANT_A,
      'x-auth-subject': 'user:op',
      ...(scopes ? { 'x-actor-scopes': scopes.join(' ') } : {}),
      ...(roles ? { 'x-actor-roles': roles.join(' ') } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(message),
  });
}

test('bbx-642-autograant-read: an authenticated principal with NO mcp:invoke scope can call a read tool', async () => {
  const before = upstream.calls.length;
  const res = await rpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_workspaces', arguments: {} } },
    { bearer: 'tok-1' }, // deliberately NO x-actor-scopes
  );
  const json = await res.json();
  assert.ok(!json.error, `expected no error, got ${JSON.stringify(json.error)}`);
  assert.ok(json.result.content[0].text, 'tool returns content (base scope auto-granted)');
  const call = upstream.calls[before];
  assert.equal(call.method, 'GET');
  assert.equal(call.path, '/v1/workspaces');
});

test('bbx-642-create-retarget: create_workspace proxies to the served tenant-scoped route, tenant from credential', async () => {
  const before = upstream.calls.length;
  const res = await rpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_workspace', arguments: { slug: 'app', environment: 'dev', tenantId: 'SPOOF' } } },
    { scopes: ['mcp:invoke', 'mcp:falcone:workspaces:write'], bearer: 'tok-2' },
  );
  const json = await res.json();
  assert.ok(!json.error, `expected success, got ${JSON.stringify(json.error)}`);
  const call = upstream.calls[before];
  assert.equal(call.method, 'POST');
  // The tenant comes from the credential (x-tenant-id), NOT the spoofed argument.
  assert.equal(call.path, `/v1/tenants/${TENANT_A}/workspaces`);
  assert.ok(!call.path.includes('SPOOF'));
  const sent = JSON.parse(call.body);
  assert.deepEqual(sent, { slug: 'app', environment: 'dev' }, 'spoofed tenantId is stripped from the body');
});

test('bbx-642-config-superadmin: set_mcp_config is superadmin-only and disables a tool', async () => {
  // Non-superadmin is refused.
  const denied = await rpc(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'set_mcp_config', arguments: { disableTools: ['list_buckets'] } } },
    { scopes: ['mcp:invoke'], roles: ['tenant_owner'], bearer: 'tok-3' },
  );
  assert.equal((await denied.json()).error.code, -32002);

  // Superadmin disables list_buckets.
  const ok = await rpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'set_mcp_config', arguments: { disableTools: ['list_buckets'] } } },
    { roles: ['superadmin'], bearer: 'tok-4' },
  );
  assert.ok(!(await ok.json()).error);

  // It is now gone from tools/list and uncallable.
  const list = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { bearer: 'tok-5' })).json();
  assert.ok(!list.result.tools.some((t) => t.name === 'list_buckets'));
  const call = await (await rpc(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_buckets', arguments: {} } },
    { scopes: ['mcp:invoke'], bearer: 'tok-6' },
  )).json();
  assert.equal(call.error.code, -32601);

  // Re-enable so the suite leaves the shared config store clean.
  await rpc(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'set_mcp_config', arguments: { enableTools: ['list_buckets'] } } },
    { roles: ['superadmin'], bearer: 'tok-7' },
  );
});

test('bbx-642-authoring: plan_project returns a deterministic plan with no upstream call', async () => {
  const before = upstream.calls.length;
  const res = await rpc(
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'plan_project', arguments: { workspaces: [{ slug: 'p1', database: { engine: 'postgresql' } }] } } },
    { bearer: 'tok-8' },
  );
  const plan = JSON.parse((await res.json()).result.content[0].text);
  assert.equal(plan.steps[0].tool, 'create_workspace');
  assert.ok(plan.steps.some((s) => s.tool === 'provision_database'));
  assert.equal(upstream.calls.length, before, 'authoring performs no upstream call');
});
