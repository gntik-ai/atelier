/**
 * Public HTTP acceptance tests for issue #933.
 *
 * The suite launches the package's documented executable and communicates only
 * through its HTTP API. Runtime readiness is supplied through the documented
 * read-only chart status-file configuration seam; no product module or private
 * store is imported.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const STATUS_FILE = path.join(
  REPO_ROOT,
  'tests/blackbox/fixtures/managed-knative-unavailable.status.json',
);
const SERVER_ENTRYPOINT = path.join(
  REPO_ROOT,
  'apps/control-plane-executor/src/runtime/main.mjs',
);

const TENANT_ID = 'ten_bbx933';
const WORKSPACE_ID = 'wrk_bbx933';

const operatorHeaders = Object.freeze({
  'x-tenant-id': TENANT_ID,
  'x-workspace-id': WORKSPACE_ID,
  'x-user-id': 'usr_bbx933_operator',
  'x-actor-roles': 'platform_operator',
});

const auditorHeaders = Object.freeze({
  'x-tenant-id': TENANT_ID,
  'x-workspace-id': WORKSPACE_ID,
  'x-user-id': 'usr_bbx933_auditor',
  'x-actor-roles': 'platform_auditor',
});

const developerHeaders = Object.freeze({
  'content-type': 'application/json',
  'x-tenant-id': TENANT_ID,
  'x-workspace-id': WORKSPACE_ID,
  'x-user-id': 'usr_bbx933_developer',
  'x-actor-roles': 'tenant_admin,workspace_developer',
});

const functionRequest = Object.freeze({
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  actionName: 'outage-probe',
  source: {
    kind: 'inline_code',
    language: 'javascript',
    inlineCode: 'function main() { return { ok: true }; }',
    entryFile: 'index.js',
  },
  execution: {
    runtime: 'nodejs:20',
    entrypoint: 'main',
    parameters: {},
    environment: {},
    limits: { timeoutSeconds: 30, memoryMb: 128 },
    webAction: {
      enabled: false,
      requireAuthentication: true,
      rawHttpResponse: false,
    },
  },
  activationPolicy: {
    logsAccess: 'workspace_developers',
    resultAccess: 'workspace_developers',
    rerunPolicy: 'manual_only',
    retentionHours: 24,
  },
});

async function reservePort() {
  const socket = net.createServer();
  socket.unref();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const address = socket.address();
  assert(address && typeof address === 'object');
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function launchControlPlane(overrides = {}) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_ENTRYPOINT], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TEST_MODE: 'true',
      PORT: String(port),
      KNATIVE_RUNTIME_MODE: 'managed',
      KNATIVE_RUNTIME_STATUS_FILE: STATUS_FILE,
      MCP_ENABLED: 'false',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`control-plane exited before readiness (${child.exitCode})\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return { baseUrl, child, getOutput: () => output };
      }
    } catch {
      // The public listener has not opened yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  child.kill('SIGTERM');
  throw new Error(`control-plane did not become ready\n${output}`);
}

async function stopControlPlane(runtime) {
  if (runtime.child.exitCode !== null) return;
  runtime.child.kill('SIGTERM');
  const timeout = setTimeout(() => runtime.child.kill('SIGKILL'), 5_000);
  timeout.unref();
  await once(runtime.child, 'exit');
  clearTimeout(timeout);
}

async function json(response) {
  const text = await response.text();
  assert.notEqual(text, '', `expected JSON response for HTTP ${response.status}`);
  return JSON.parse(text);
}

function assertUnavailable(body) {
  assert.equal(body.code, 'KNATIVE_UNAVAILABLE');
  assert.equal(body.message, 'Knative runtime is unavailable.');
  assert.equal(body.mode, 'managed');
  assert.equal(body.state, 'unavailable');
  assert.equal(body.reason, 'WEBHOOK_ENDPOINT_UNAVAILABLE');
  assert.equal(typeof body.correlationId, 'string');
  assert.match(body.correlationId, /\S/);
  assert.deepEqual(
    Object.keys(body).sort(),
    ['code', 'correlationId', 'message', 'mode', 'reason', 'state'].sort(),
    'dependency errors must stay bounded and must not expose cluster or workload metadata',
  );
}

/**
 * bbx-933-runtime-status-01 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 */
test('bbx-933-runtime-status-01: operators and auditors receive the same bounded read-only runtime status', async (t) => {
  const runtime = await launchControlPlane();
  t.after(() => stopControlPlane(runtime));

  const expected = {
    mode: 'managed',
    owner: 'falcone',
    version: '1.22.1',
    compatibility: 'compatible',
    state: 'unavailable',
    stage: 'webhook',
    reason: 'WEBHOOK_ENDPOINT_UNAVAILABLE',
    lastTransitionAt: '2026-08-07T12:00:00.000Z',
  };

  for (const headers of [operatorHeaders, auditorHeaders]) {
    const response = await fetch(`${runtime.baseUrl}/v1/platform/runtime/knative`, { headers });
    assert.equal(response.status, 200, runtime.getOutput());
    assert.deepEqual(await json(response), expected);
  }

  const mutation = await fetch(`${runtime.baseUrl}/v1/platform/runtime/knative`, {
    method: 'PUT',
    headers: { ...operatorHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'disabled' }),
  });
  assert.ok(mutation.status === 404 || mutation.status === 405, 'status endpoint must expose no mutation method');

  const afterMutation = await fetch(`${runtime.baseUrl}/v1/platform/runtime/knative`, {
    headers: operatorHeaders,
  });
  assert.equal(afterMutation.status, 200);
  assert.deepEqual(await json(afterMutation), expected);
});

/**
 * bbx-933-runtime-auth-02 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 */
test('bbx-933-runtime-auth-02: runtime status requires an authorized platform identity', async (t) => {
  const runtime = await launchControlPlane();
  t.after(() => stopControlPlane(runtime));

  const unauthenticated = await fetch(`${runtime.baseUrl}/v1/platform/runtime/knative`);
  assert.equal(unauthenticated.status, 401);

  const tenantOnly = await fetch(`${runtime.baseUrl}/v1/platform/runtime/knative`, {
    headers: {
      ...operatorHeaders,
      'x-user-id': 'usr_bbx933_tenant_only',
      'x-actor-roles': 'tenant_admin',
    },
  });
  assert.equal(tenantOnly.status, 403);
});

/**
 * bbx-933-functions-unavailable-03 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Deploy fails explicitly while managed runtime is degraded
 */
test('bbx-933-functions-unavailable-03: Function deploy fails with the exact bounded 503 contract', async (t) => {
  const runtime = await launchControlPlane();
  t.after(() => stopControlPlane(runtime));

  const response = await fetch(`${runtime.baseUrl}/v1/functions/actions`, {
    method: 'POST',
    headers: {
      ...developerHeaders,
      'idempotency-key': 'bbx-933-managed-unavailable-deploy',
    },
    body: JSON.stringify(functionRequest),
  });

  assert.equal(response.status, 503, runtime.getOutput());
  assertUnavailable(await json(response));

  const metadata = await fetch(
    `${runtime.baseUrl}/v1/functions/workspaces/${WORKSPACE_ID}/actions`,
    { headers: developerHeaders },
  );
  assert.equal(metadata.status, 200, 'degraded runtime must not block tenant-scoped metadata reads');
  const inventory = await json(metadata);
  const actions = Array.isArray(inventory) ? inventory : inventory.items ?? inventory.actions ?? [];
  assert.ok(
    !actions.some((action) => action.actionName === functionRequest.actionName),
    'a rejected deploy must not be reported as deployed',
  );
});

/**
 * bbx-933-functions-disabled-04 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Disabled Functions preserve the existing error
 */
test('bbx-933-functions-disabled-04: deliberately disabled Functions preserve 501 precedence', async (t) => {
  const runtime = await launchControlPlane({
    FUNCTIONS_ENABLED: 'false',
    FN_BACKEND: 'off',
  });
  t.after(() => stopControlPlane(runtime));

  const response = await fetch(`${runtime.baseUrl}/v1/functions/actions`, {
    method: 'POST',
    headers: {
      ...developerHeaders,
      'idempotency-key': 'bbx-933-functions-disabled',
    },
    body: JSON.stringify(functionRequest),
  });

  assert.equal(response.status, 501, runtime.getOutput());
  const body = await json(response);
  assert.equal(body.code, 'FUNCTIONS_DISABLED');
  assert.notEqual(body.code, 'KNATIVE_UNAVAILABLE');
});
