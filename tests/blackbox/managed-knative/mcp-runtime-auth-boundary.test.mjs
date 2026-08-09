/**
 * Issue #933 direct hosted-runtime authentication regression.
 *
 * bbx-933-mcp-runtime-direct-auth-56 | fn-mcp-hosted-invoke, fn-mcp-hosted-isolation
 *   OpenSpec #### Scenario: Authentication and ownership precede dependency status
 *
 * The production MCP runtime is launched as its public executable and driven only through HTTP.
 * Its downstream control-plane dependency is an isolated HTTP fixture which records whether a
 * request crossed the authorization boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORKSPACE = 'workspace-933-direct-auth';
const TENANT = 'tenant-933-direct-auth';
const VALID_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYngtOTMzLWNvbnN1bWVyIiwidGVuYW50X2lkIjoidGVuYW50LTkzMy1kaXJlY3QtYXV0aCIsIndvcmtzcGFjZV9pZCI6IndvcmtzcGFjZS05MzMtZGlyZWN0LWF1dGgifQ.bbx933-valid-signature';
const MANIFEST = {
  status: 'published',
  tools: [{
    name: 'list_workspaces',
    description: 'List the caller-visible workspaces.',
    inputSchema: { type: 'object', properties: {} },
  }],
};

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function reservePort() {
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

function waitForRuntime(child, output) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP runtime did not become ready: ${output.text}`)), 5_000);
    const inspect = () => {
      if (!/mcp-runtime listening on/i.test(output.text)) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', (chunk) => { output.text += chunk; inspect(); });
    child.stderr.on('data', (chunk) => { output.text += chunk; inspect(); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`MCP runtime exited before readiness (${code}): ${output.text}`));
    });
  });
}

function runtimeHeaders({ authorization } = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': TENANT,
    'x-workspace-id': WORKSPACE,
    'x-auth-scopes': 'mcp:invoke workspaces:read',
    'x-actor-roles': 'workspace_owner,platform_admin',
    ...(authorization ? { authorization } : {}),
  };
}

function toolsCall(id) {
  return JSON.stringify({
    jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: 'list_workspaces', arguments: {} },
  });
}

test('bbx-933-mcp-runtime-direct-auth-56: forged x-* identity cannot invoke the runtime without a delegated credential', async (t) => {
  const upstreamCalls = [];
  const upstream = createServer((request, response) => {
    upstreamCalls.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    const authorized = request.headers.authorization === `Bearer ${VALID_TOKEN}`;
    response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
    response.end(JSON.stringify(authorized
      ? { items: [{ id: WORKSPACE, tenantId: TENANT }] }
      : { code: 'UNAUTHENTICATED' }));
  });
  const upstreamPort = await listen(upstream);

  const runtimePort = await reservePort();
  const runtimeEntrypoint = process.env.BBX_933_MCP_RUNTIME_ENTRYPOINT
    ?? join(REPO_ROOT, 'apps/mcp-runtime/server.mjs');
  const child = spawn(process.execPath, [runtimeEntrypoint], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(runtimePort),
      FALCONE_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      FALCONE_MCP_WORKSPACE_ID: WORKSPACE,
      FALCONE_MCP_VERSION: 'v1',
      FALCONE_MCP_OPERATION: 'publish',
      FALCONE_MCP_MANIFEST_JSON: JSON.stringify(MANIFEST),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    await stopProcess(child);
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  });
  const output = { text: '' };
  await waitForRuntime(child, output);

  const endpoint = `http://127.0.0.1:${runtimePort}/tools/call`;
  const forged = await fetch(endpoint, {
    method: 'POST',
    headers: runtimeHeaders(),
    body: toolsCall(93356),
  });
  const forgedBody = await forged.json();
  assert.equal(
    forged.status,
    401,
    `unsigned x-* tenant/workspace/scopes/roles forged a successful runtime identity: ${JSON.stringify(forgedBody)}`,
  );
  assert.match(String(forgedBody.code ?? forgedBody.error?.message ?? ''), /UNAUTH|CREDENTIAL/i);
  assert.equal(upstreamCalls.length, 0, 'an unauthenticated direct runtime call must stop before the upstream boundary');

  const authorized = await fetch(endpoint, {
    method: 'POST',
    headers: runtimeHeaders({ authorization: `Bearer ${VALID_TOKEN}` }),
    body: toolsCall(93357),
  });
  const authorizedBody = await authorized.json();
  assert.equal(authorized.status, 200, JSON.stringify(authorizedBody));
  assert.equal(authorizedBody.result?.isError, false, JSON.stringify(authorizedBody));
  assert.equal(upstreamCalls.length, 1, 'a valid delegated credential must retain the authorized upstream path');
  assert.equal(upstreamCalls[0].authorization, `Bearer ${VALID_TOKEN}`);
});
