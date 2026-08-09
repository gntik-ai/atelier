import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const OPENAPI = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8'));
const ERROR_SCHEMA = OPENAPI.components.schemas.ErrorResponse;
const DETAIL_SCHEMA = OPENAPI.components.schemas.ErrorDetail;
const RESOURCE_SCHEMA = OPENAPI.components.schemas.ErrorResource;
const SENSITIVE_TEXT = /(select\s|sqlstate|postgres|stack|https?:\/\/|password|secret|credential|bearer\s|token)/i;

function assertEnvelope(body, status, { path, requestId, correlationId } = {}) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.deepEqual(
    ERROR_SCHEMA.required.filter((field) => !Object.hasOwn(body, field)),
    [],
    'every canonical ErrorResponse field is present'
  );
  assert.deepEqual(
    Object.keys(body).filter((field) => !Object.hasOwn(ERROR_SCHEMA.properties, field)),
    [],
    'no undeclared ErrorResponse field is present'
  );
  assert.equal(body.status, status);
  assert.match(body.code, new RegExp(ERROR_SCHEMA.properties.code.pattern));
  assert.equal(typeof body.message, 'string');
  assert.doesNotMatch(JSON.stringify(body), SENSITIVE_TEXT);
  assert.ok(body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail));
  assert.equal(DETAIL_SCHEMA.type, 'object');
  assert.ok(body.resource && typeof body.resource === 'object' && !Array.isArray(body.resource));
  assert.deepEqual(
    Object.keys(body.resource).filter((field) => !Object.hasOwn(RESOURCE_SCHEMA.properties, field)),
    []
  );
  assert.equal(typeof body.resource.path, 'string');
  if (path) assert.equal(body.resource.path, path);
  for (const [field, schema] of [
    ['requestId', ERROR_SCHEMA.properties.requestId],
    ['correlationId', ERROR_SCHEMA.properties.correlationId]
  ]) {
    assert.equal(typeof body[field], 'string');
    assert.ok(body[field].length >= schema.minLength && body[field].length <= schema.maxLength);
  }
  assert.match(body.correlationId, new RegExp(ERROR_SCHEMA.properties.correlationId.pattern));
  if (requestId) assert.equal(body.requestId, requestId);
  if (correlationId) assert.equal(body.correlationId, correlationId);
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startControlPlaneProcess() {
  const port = await freePort();
  const child = spawn(process.execPath, ['apps/control-plane/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PGHOST: '127.0.0.1',
      PGPORT: '1',
      PGUSER: 'error_contract_test',
      PGPASSWORD: 'error_contract_test',
      PGDATABASE: 'error_contract_test',
      SCHEMA_MIGRATION_TIMEOUT_MS: '60000',
      SCHEMA_MIGRATION_INITIAL_DELAY_MS: '1000',
      SCHEMA_MIGRATION_MAX_DELAY_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 10000;
  while (!output.includes('[control-plane] listening')) {
    if (child.exitCode !== null) throw new Error(`control-plane exited ${child.exitCode}: ${output}`);
    if (Date.now() > deadline) throw new Error(`control-plane did not listen: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('control-plane HTTP boundary normalizes 404/401 errors and leaves success unchanged', { timeout: 15000 }, async () => {
  const { child, base } = await startControlPlaneProcess();
  const requestId = 'req-main-blackbox-001';
  const correlationId = 'corr-main-blackbox-001';
  try {
    const missing = await fetch(`${base}/v1/reproduction/no-such-route`, {
      headers: { 'x-request-id': requestId, 'x-correlation-id': correlationId }
    });
    assert.equal(missing.status, 404);
    assertEnvelope(await missing.json(), 404, {
      path: '/v1/reproduction/no-such-route', requestId, correlationId
    });

    const unauthenticated = await fetch(`${base}/v1/metrics/tenants/tnt_reproduction/quotas`, {
      headers: { 'x-request-id': requestId, 'x-correlation-id': correlationId }
    });
    assert.equal(unauthenticated.status, 401, 'authentication precedes trace and schema-readiness gates');
    assertEnvelope(await unauthenticated.json(), 401, {
      path: '/v1/metrics/tenants/{id}/quotas', requestId, correlationId
    });

    const success = await fetch(`${base}/`);
    assert.equal(success.status, 200);
    const successBody = await success.json();
    assert.equal(successBody.service, 'in-falcone-control-plane');
    assert.equal(typeof successBody.routes, 'number');
    assert.equal(Object.hasOwn(successBody, 'code'), false);
  } finally {
    await stopChild(child);
  }
});

test('executor HTTP boundary normalizes 400/401/403/404/500 and leaves success unchanged', async () => {
  const apiKeyStore = {
    async verifyKey() {
      return {
        tenantId: 'tenant-bound', workspaceId: 'ws-bound', keyType: 'service',
        roleName: 'falcone_app', dbRole: 'falcone_app', scopes: []
      };
    },
    async listKeys() {
      throw Object.assign(new Error('select password from postgres://db.internal'), { code: '42P01' });
    }
  };
  const server = createControlPlaneServer({ registry: {}, apiKeyStore, logger: { error() {} } });
  const base = await listen(server);
  const validIds = {
    'x-request-id': 'req-executor-blackbox-001',
    'x-correlation-id': 'corr-executor-blackbox-001'
  };
  const trusted = {
    ...validIds,
    'x-api-version': '2026-03-26',
    'x-tenant-id': 'tenant-alpha',
    'x-workspace-id': 'ws-alpha',
    'x-auth-subject': 'operator-alpha',
    'x-actor-roles': 'workspace_admin'
  };
  try {
    let response = await fetch(`${base}/not-a-route`, {
      headers: { 'x-request-id': 'short', 'x-correlation-id': 'bad id' }
    });
    assert.equal(response.status, 404);
    let body = await response.json();
    assertEnvelope(body, 404, { path: '/not-a-route' });
    assert.notEqual(body.requestId, 'short');
    assert.notEqual(body.correlationId, 'bad id');

    response = await fetch(`${base}/v1/workspaces/ws-alpha/api-keys`, { headers: validIds });
    assert.equal(response.status, 401);
    assertEnvelope(await response.json(), 401, {
      path: '/v1/workspaces/{id}/api-keys',
      requestId: validIds['x-request-id'],
      correlationId: validIds['x-correlation-id']
    });

    response = await fetch(`${base}/v1/workspaces/ws-other/api-keys`, {
      headers: { ...validIds, 'x-api-version': '2026-03-26', 'x-api-key': 'flc_bound_key' }
    });
    assert.equal(response.status, 403);
    assertEnvelope(await response.json(), 403, { path: '/v1/workspaces/{id}/api-keys' });

    response = await fetch(`${base}/v1/workspaces/ws-alpha/api-keys`, {
      method: 'POST',
      headers: { ...trusted, 'content-type': 'application/json' },
      body: '{not-json'
    });
    assert.equal(response.status, 400);
    body = await response.json();
    assertEnvelope(body, 400, { path: '/v1/workspaces/{id}/api-keys' });
    assert.equal(body.code, 'GW_INVALID_JSON');

    response = await fetch(`${base}/v1/workspaces/ws-alpha/api-keys`, { headers: trusted });
    assert.equal(response.status, 500);
    body = await response.json();
    assertEnvelope(body, 500, { path: '/v1/workspaces/{id}/api-keys' });
    assert.equal(body.message, 'Internal server error');
    assert.deepEqual(body.detail, {});

    response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
