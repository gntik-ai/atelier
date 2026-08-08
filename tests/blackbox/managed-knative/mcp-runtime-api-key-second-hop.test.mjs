/**
 * Issue #933 hosted-runtime second-hop authentication and readiness regressions.
 *
 * bbx-933-mcp-runtime-api-key-second-hop-57 | fn-mcp-hosted-invoke, fn-mcp-hosted-isolation
 *   OpenSpec #### Scenario: Authentication and ownership precede dependency status
 * bbx-933-mcp-runtime-api-base-readiness-58 | fn-mcp-hosted-invoke
 *   OpenSpec #### Scenario: Consumer receives honest unavailable status
 *
 * Both cases launch the production MCP runtime executable and use only public HTTP surfaces. The
 * API-key case points it at a real createControlPlaneServer whose public API-key store boundary
 * records credential verification and whose real PostgreSQL Data API executes a protected row read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TENANT = 'tenant-933-api-key-hop';
const WORKSPACE = 'workspace-933-api-key-hop';
const VALID_KEY = 'flc_bbx933_valid_second_hop_abcdefghijklmnopqrstuvwxyz0123456789';
const REVOKED_KEY = 'flc_bbx933_revoked_second_hop_abcdefghijklmnopqrstuvwxyz012345';
const QUERY_ORDERS_TOOL = {
  name: 'query_orders',
  description: 'Read orders through the credential-bound PostgreSQL Data API.',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  method: 'GET',
  path: '/v1/postgres/workspaces/{workspaceId}/data/app/schemas/public/tables/orders/rows',
  family: 'postgres',
  kind: 'proxy',
  mutates: false,
  scope: null,
};
const MANIFEST = { status: 'published', tools: [QUERY_ORDERS_TOOL] };

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
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

function runtimeEntrypoint() {
  return process.env.BBX_933_MCP_RUNTIME_SECOND_HOP_ENTRYPOINT
    ?? join(REPO_ROOT, 'apps/mcp-runtime/server.mjs');
}

function runtimeEnvironment(port, apiBaseUrl) {
  const env = {
    ...process.env,
    PORT: String(port),
    FALCONE_MCP_WORKSPACE_ID: WORKSPACE,
    FALCONE_MCP_VERSION: 'v1',
    FALCONE_MCP_OPERATION: 'publish',
    FALCONE_MCP_MANIFEST_JSON: JSON.stringify(MANIFEST),
  };
  if (apiBaseUrl === undefined) delete env.FALCONE_API_BASE_URL;
  else env.FALCONE_API_BASE_URL = apiBaseUrl;
  return env;
}

function startRuntime(port, apiBaseUrl) {
  return spawn(process.execPath, [runtimeEntrypoint()], {
    cwd: REPO_ROOT,
    env: runtimeEnvironment(port, apiBaseUrl),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

function callHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `ApiKey ${apiKey}`,
    'x-tenant-id': TENANT,
    'x-workspace-id': WORKSPACE,
    'x-auth-scopes': 'mcp:invoke data:read',
    'x-actor-roles': 'workspace_owner',
  };
}

function toolsCall(id) {
  return JSON.stringify({
    jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: 'query_orders', arguments: {} },
  });
}

test('bbx-933-mcp-runtime-api-key-second-hop-57: API keys are re-verified before a protected PostgreSQL Data API read', async (t) => {
  const verifyCalls = [];
  const workspaceClientCalls = [];
  const protectedDataReadCalls = [];
  const apiKeyStore = {
    async verifyKey(candidate) {
      verifyCalls.push(candidate);
      if (candidate !== VALID_KEY) return null;
      return {
        id: 'api-key-933-valid',
        keyId: 'api-key-933-valid',
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        keyType: 'service',
        dbRole: 'falcone_service',
        roleName: 'falcone_service',
        scopes: ['mcp:invoke', 'data:read'],
      };
    },
  };
  const workspaceClient = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('information_schema.columns')) {
        return { rows: [
          { column_name: 'id', data_type: 'text', udt_name: 'text' },
          { column_name: 'value', data_type: 'text', udt_name: 'text' },
        ] };
      }
      if (statement.includes('pg_index')) return { rows: [{ column_name: 'id' }] };
      if (statement.includes('set_config')) return { rows: [], rowCount: 0 };
      if (statement.includes('FROM "public"."orders" AS base')) {
        protectedDataReadCalls.push(statement);
        return { rows: [{ id: 'row-933', value: 'protected-data-read' }], rowCount: 1 };
      }
      throw new Error(`unexpected PostgreSQL Data API statement: ${statement}`);
    },
  };
  const registry = {
    async withWorkspaceClient(workspaceId, context, operation) {
      workspaceClientCalls.push({ workspaceId, context: structuredClone(context) });
      return operation(workspaceClient);
    },
  };
  const executor = createControlPlaneServer({ registry, apiKeyStore, logger: { error() {} } });
  const executorPort = await listen(executor);

  const runtimePort = await reservePort();
  const runtime = startRuntime(runtimePort, `http://127.0.0.1:${executorPort}`);
  const output = { text: '' };
  t.after(async () => {
    await stopProcess(runtime);
    await new Promise((resolve, reject) => executor.close((error) => error ? reject(error) : resolve()));
  });
  await waitForRuntime(runtime, output);

  const endpoint = `http://127.0.0.1:${runtimePort}/tools/call`;
  const validResponse = await fetch(endpoint, {
    method: 'POST', headers: callHeaders(VALID_KEY), body: toolsCall(93357),
  });
  const validBody = await validResponse.json();
  assert.equal(validResponse.status, 200, JSON.stringify(validBody));
  assert.equal(validBody.result?.isError, false, JSON.stringify(validBody));
  assert.match(JSON.stringify(validBody.result?.content), /row-933/);
  assert.match(JSON.stringify(validBody.result?.content), /protected-data-read/);
  assert.deepEqual(verifyCalls, [VALID_KEY], 'the second hop must verify the exact delegated API key');
  assert.deepEqual(workspaceClientCalls, [{
    workspaceId: WORKSPACE,
    context: { tenantId: TENANT, workspaceId: WORKSPACE, role: 'falcone_service' },
  }], 'the real Data API must open only the credential-bound workspace with the productive dbRole');
  assert.equal(protectedDataReadCalls.length, 1, 'the valid key must execute the real protected PostgreSQL row read');

  const revokedResponse = await fetch(endpoint, {
    method: 'POST', headers: callHeaders(REVOKED_KEY), body: toolsCall(93358),
  });
  const revokedBody = await revokedResponse.json();
  assert.equal(revokedResponse.status, 200, 'JSON-RPC requests retain HTTP 200 transport semantics');
  assert.ok(
    revokedBody.error != null || revokedBody.result?.isError === true,
    `revoked API key produced a successful MCP result: ${JSON.stringify(revokedBody)}`,
  );
  assert.notEqual(revokedBody.result?.isError, false, JSON.stringify(revokedBody));
  assert.deepEqual(verifyCalls, [VALID_KEY, REVOKED_KEY], 'valid and revoked credentials must both reach independent second-hop verification');
  assert.equal(workspaceClientCalls.length, 1, 'the revoked key must not open a workspace database client');
  assert.equal(protectedDataReadCalls.length, 1, 'the revoked key must not execute another protected row read');
});

test('bbx-933-mcp-runtime-api-base-readiness-58: runtime without FALCONE_API_BASE_URL fails readiness explicitly', async (t) => {
  const runtimePort = await reservePort();
  const runtime = startRuntime(runtimePort, undefined);
  const output = { text: '' };
  t.after(() => stopProcess(runtime));
  await waitForRuntime(runtime, output);

  const response = await fetch(`http://127.0.0.1:${runtimePort}/readyz`);
  const body = await response.json();
  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.code, 'MCP_RUNTIME_API_BASE_URL_UNAVAILABLE', JSON.stringify(body));
  assert.notEqual(body.status, 'ready');
});
