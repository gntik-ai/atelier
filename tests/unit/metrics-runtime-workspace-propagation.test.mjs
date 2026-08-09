import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import {
  renderMetrics as renderExecutorMetrics
} from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';
import {
  createControlPlaneMetricAttribution
} from '../../apps/control-plane/request-metric-scope.mjs';
import {
  recordHttp as recordControlPlaneHttp,
  renderMetrics as renderControlPlaneMetrics
} from '../../apps/control-plane/metrics-registry.mjs';

const TENANT = 'ten_c04_runtime';
const WORKSPACE = 'wrk_c04_runtime';
const FOREIGN_WORKSPACE = 'wrk_c04_foreign';
const SPOOFED_WORKSPACE = 'wrk_c04_spoofed';
const UNRESOLVED_JWT_WORKSPACE = 'wrk_c04_unresolved_jwt';
const GATEWAY_SECRET = 'c04-hermetic-gateway-secret';

test('control-plane image packages the workspace metric attribution runtime dependency', () => {
  const dockerfile = readFileSync(
    new URL('../../apps/control-plane/Dockerfile', import.meta.url),
    'utf8'
  );

  assert.match(
    dockerfile,
    /\bapps\/control-plane\/request-metric-scope\.mjs\b/,
    'server.mjs and metrics-handlers.mjs import request-metric-scope.mjs, so the explicit image COPY list must include it'
  );
});

test('control-plane attributes canonical own-workspace routes across final status classes', async () => {
  const rows = new Map([
    [WORKSPACE, { id: WORKSPACE, tenant_id: TENANT }],
    [FOREIGN_WORKSPACE, { id: FOREIGN_WORKSPACE, tenant_id: 'ten_other' }]
  ]);
  const resolutions = [];
  const getWorkspace = async (_pool, workspaceId) => {
    resolutions.push(workspaceId);
    return rows.get(workspaceId);
  };

  const tenantOnlyJwt = createControlPlaneMetricAttribution({
    method: 'GET',
    getWorkspace
  });
  tenantOnlyJwt.bindAuthenticatedRoute({ tenantId: TENANT }, { workspaceId: WORKSPACE });
  assert.equal(await tenantOnlyJwt.complete(200), true);
  assert.deepEqual(tenantOnlyJwt.metric, {
    method: 'GET',
    route: 'unmatched',
    tenantId: TENANT,
    workspaceId: WORKSPACE
  });

  const workspaceBoundJwt = createControlPlaneMetricAttribution({
    method: 'POST',
    getWorkspace
  });
  workspaceBoundJwt.bindAuthenticatedRoute(
    { tenantId: TENANT, workspaceId: SPOOFED_WORKSPACE },
    { workspaceId: WORKSPACE }
  );
  assert.equal(await workspaceBoundJwt.complete(204), true);
  assert.deepEqual(workspaceBoundJwt.metric, {
    method: 'POST',
    route: 'unmatched',
    tenantId: TENANT,
    workspaceId: WORKSPACE
  });

  const privilegedCrossTenant = createControlPlaneMetricAttribution({
    method: 'GET',
    getWorkspace
  });
  privilegedCrossTenant.bindAuthenticatedRoute(
    { tenantId: 'ten_platform_context', actorType: 'superadmin' },
    { workspaceId: FOREIGN_WORKSPACE }
  );
  assert.equal(await privilegedCrossTenant.complete(200), true);
  assert.deepEqual(privilegedCrossTenant.metric, {
    method: 'GET',
    route: 'unmatched',
    tenantId: 'ten_other',
    workspaceId: FOREIGN_WORKSPACE
  });

  for (const statusCode of [302, 400, 500]) {
    const failedOwnWorkspaceRequest = createControlPlaneMetricAttribution({
      method: 'GET',
      getWorkspace
    });
    failedOwnWorkspaceRequest.bindAuthenticatedRoute(
      { tenantId: TENANT },
      { workspaceId: WORKSPACE }
    );
    assert.equal(await failedOwnWorkspaceRequest.complete(statusCode), true);
    assert.deepEqual(failedOwnWorkspaceRequest.metric, {
      method: 'GET',
      route: 'unmatched',
      tenantId: TENANT,
      workspaceId: WORKSPACE
    });
    if (statusCode === 500) {
      recordControlPlaneHttp({
        ...failedOwnWorkspaceRequest.metric,
        route: '/v1/c04/authorized-error',
        status: statusCode,
        durationSeconds: 0.01
      });
    }
  }

  assert.match(
    renderControlPlaneMetrics(),
    new RegExp(
      `falcone_http_requests_total\\{[^\\n]*route="/v1/c04/authorized-error"[^\\n]*status="500"[^\\n]*`
      + `tenant_id="${TENANT}"[^\\n]*workspace_id="${WORKSPACE}"[^\\n]*\\} 1`
    )
  );

  assert.deepEqual(resolutions, [
    WORKSPACE,
    WORKSPACE,
    FOREIGN_WORKSPACE,
    WORKSPACE,
    WORKSPACE,
    WORKSPACE
  ]);
});

test('control-plane completes metric scope once and never re-probes a handler-terminal workspace', async () => {
  let resolutions = 0;
  const getWorkspace = async () => {
    resolutions += 1;
    return { id: WORKSPACE, tenant_id: TENANT };
  };

  const missing = createControlPlaneMetricAttribution({ method: 'GET', getWorkspace });
  missing.bindAuthenticatedRoute(
    { tenantId: TENANT, actorType: 'superadmin' },
    { workspaceId: WORKSPACE }
  );
  missing.markWorkspaceResolutionAttempted();
  assert.equal(await missing.complete(404), false);
  assert.equal(await missing.complete(404), false, 'res.finish shares the first completion');
  assert.equal(resolutions, 0, 'a terminal authoritative handler lookup is never re-probed');
  assert.equal(missing.metric.workspaceId, '', 'the unverified path id never becomes a label');

  const registryFailure = createControlPlaneMetricAttribution({ method: 'GET', getWorkspace });
  registryFailure.bindAuthenticatedRoute(
    { tenantId: TENANT, actorType: 'superadmin' },
    { workspaceId: WORKSPACE }
  );
  registryFailure.markWorkspaceResolutionAttempted();
  assert.equal(await registryFailure.complete(500), false);
  assert.equal(await registryFailure.complete(500), false);
  assert.equal(resolutions, 0, 'a failed authoritative lookup is never retried by telemetry');

  const resolvedValidationFailure = createControlPlaneMetricAttribution({ method: 'POST', getWorkspace });
  resolvedValidationFailure.bindAuthenticatedRoute(
    { tenantId: TENANT },
    { workspaceId: WORKSPACE }
  );
  resolvedValidationFailure.markWorkspaceResolutionAttempted();
  assert.equal(
    await resolvedValidationFailure.complete(400, { tenantId: TENANT, workspaceId: WORKSPACE }),
    true,
    'an authorized handler-provided scope remains attributable after validation fails'
  );
  assert.deepEqual(resolvedValidationFailure.metric, {
    method: 'POST',
    route: 'unmatched',
    tenantId: TENANT,
    workspaceId: WORKSPACE
  });
  assert.equal(resolutions, 0);

  const fallback = createControlPlaneMetricAttribution({ method: 'GET', getWorkspace });
  fallback.bindAuthenticatedRoute({ tenantId: TENANT }, { workspaceId: WORKSPACE });
  assert.equal(await fallback.complete(500), true);
  assert.equal(await fallback.complete(500), true);
  assert.equal(resolutions, 1, 'legacy authorized failures retain one best-effort C-04 lookup');
});

test('control-plane omits workspace labels for denials, spoofed headers, and non-workspace routes', async () => {
  let resolutions = 0;
  const getWorkspace = async (_pool, workspaceId) => {
    resolutions += 1;
    if (workspaceId === FOREIGN_WORKSPACE) {
      return { id: FOREIGN_WORKSPACE, tenant_id: 'ten_other' };
    }
    return { id: WORKSPACE, tenant_id: TENANT };
  };

  const rejectedForeign = createControlPlaneMetricAttribution({
    method: 'GET',
    getWorkspace
  });
  rejectedForeign.bindAuthenticatedRoute({ tenantId: TENANT }, { workspaceId: FOREIGN_WORKSPACE });
  assert.equal(await rejectedForeign.complete(403), false);
  assert.equal(rejectedForeign.metric.workspaceId, '');
  assert.equal(rejectedForeign.metric.tenantId, TENANT);

  const rejectedSameTenantRole = createControlPlaneMetricAttribution({
    method: 'GET',
    getWorkspace
  });
  rejectedSameTenantRole.bindAuthenticatedRoute(
    { tenantId: TENANT, actorType: 'tenant_developer' },
    { workspaceId: WORKSPACE }
  );
  assert.equal(await rejectedSameTenantRole.complete(403), false);
  assert.equal(rejectedSameTenantRole.metric.workspaceId, '');
  assert.equal(rejectedSameTenantRole.metric.tenantId, TENANT);

  const spoofedHeader = createControlPlaneMetricAttribution({ method: 'GET', getWorkspace });
  spoofedHeader.bindAuthenticatedRoute(
    { tenantId: TENANT, workspaceId: SPOOFED_WORKSPACE },
    {}
  );
  assert.equal(await spoofedHeader.complete(200), false);
  assert.equal(spoofedHeader.metric.workspaceId, '');

  const tenantOnlyRoute = createControlPlaneMetricAttribution({ method: 'GET', getWorkspace });
  tenantOnlyRoute.bindAuthenticatedRoute(
    { tenantId: TENANT, workspaceId: WORKSPACE },
    { tenantId: TENANT }
  );
  assert.equal(await tenantOnlyRoute.complete(200), false);
  assert.equal(tenantOnlyRoute.metric.workspaceId, '');

  const unmatched = createControlPlaneMetricAttribution({ method: 'GET', getWorkspace });
  assert.equal(await unmatched.complete(404), false);
  assert.equal(unmatched.metric.workspaceId, '');
  assert.equal(unmatched.metric.tenantId, '');
  assert.equal(resolutions, 0);
});

async function withExecutorServer(fn) {
  const apiKeyStore = {
    async listKeys(workspaceId) {
      return [{ id: `key-for-${workspaceId}` }];
    }
  };
  const resolveWorkspaceTenant = async (workspaceId) => {
    if (workspaceId === WORKSPACE) return TENANT;
    if (workspaceId === FOREIGN_WORKSPACE) return 'ten_other';
    return undefined;
  };
  const server = createControlPlaneServer({
    registry: {},
    apiKeyStore,
    gatewaySharedSecret: GATEWAY_SECRET,
    resolveWorkspaceTenant,
    logger: { error() {} }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function trustedHeaders(tenantId = TENANT, extra = {}) {
  return {
    'x-api-version': '2026-03-26',
    'x-correlation-id': 'corr-c03-unit-metrics-runtime',
    'x-gateway-auth': GATEWAY_SECRET,
    'x-tenant-id': tenantId,
    'x-auth-subject': 'user-c04',
    ...extra
  };
}

async function invokeExecutorRequest(server, { path, headers }) {
  const requestHandler = server.listeners('request')[0];
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = path;
  req.headers = headers;

  const res = new EventEmitter();
  res.statusCode = 200;
  let body = '';
  res.writeHead = (statusCode) => {
    res.statusCode = statusCode;
  };
  res.end = (chunk = '') => {
    body += String(chunk);
    res.emit('finish');
  };

  await requestHandler(req, res);
  return { statusCode: res.statusCode, body };
}

test('executor public probes omit workspace labels from every identity input', async () => {
  let resolverCalls = 0;
  const apiKeyStore = {
    async verifyKey(key) {
      if (key !== 'flc_c04_probe') return undefined;
      return {
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        keyType: 'anon',
        roleName: 'falcone_app',
        dbRole: 'falcone_anon',
        scopes: []
      };
    }
  };
  const server = createControlPlaneServer({
    registry: {},
    apiKeyStore,
    gatewaySharedSecret: GATEWAY_SECRET,
    resolveWorkspaceTenant: async () => {
      resolverCalls += 1;
      return 'ten_other';
    },
    logger: { error() {} }
  });

  const probes = [
    {
      path: '/healthz',
      headers: trustedHeaders(TENANT, { 'x-workspace-id': UNRESOLVED_JWT_WORKSPACE })
    },
    {
      path: '/readyz',
      headers: trustedHeaders(TENANT, { 'x-workspace-id': FOREIGN_WORKSPACE })
    },
    {
      path: '/healthz',
      headers: { authorization: 'ApiKey flc_c04_probe' }
    }
  ];
  for (const probe of probes) {
    const response = await invokeExecutorRequest(server, probe);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
  }

  const legacyServer = createControlPlaneServer({
    registry: {},
    logger: { error() {} }
  });
  const legacy = await invokeExecutorRequest(legacyServer, {
    path: '/readyz',
    headers: { 'x-tenant-id': TENANT, 'x-workspace-id': SPOOFED_WORKSPACE }
  });
  assert.equal(legacy.statusCode, 200);
  assert.deepEqual(JSON.parse(legacy.body), { status: 'ok' });
  assert.equal(resolverCalls, 0);

  const probeLines = renderExecutorMetrics().split('\n').filter((line) =>
    line.startsWith('falcone_http_requests_total{')
    && (line.includes('route="/healthz"') || line.includes('route="/readyz"'))
  );
  assert.equal(
    probeLines.reduce((total, line) => total + Number(line.split(' ').at(-1)), 0),
    4
  );
  for (const line of probeLines) assert.doesNotMatch(line, /workspace_id=/);
});

test('executor records canonical workspace only after its existing ownership check', async () => {
  await withExecutorServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/workspaces/${WORKSPACE}/api-keys`, {
      headers: trustedHeaders()
    });
    assert.equal(response.status, 200);

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    const line = metrics.split('\n').find((candidate) =>
      candidate.startsWith('falcone_http_requests_total{')
      && candidate.includes(`tenant_id="${TENANT}"`)
      && candidate.includes(`workspace_id="${WORKSPACE}"`)
    );
    assert.ok(line, metrics);
    assert.match(line, /route="\/v1\/workspaces\/wrk_c04_runtime\/api-keys"/);
  });
});

test('executor never labels spoofed, foreign, unresolved, or membership-denied workspace input', async () => {
  await withExecutorServer(async (baseUrl) => {
    const spoofed = await fetch(`${baseUrl}/v1/workspaces/${WORKSPACE}/api-keys`, {
      headers: {
        'x-api-version': '2026-03-26',
        'x-correlation-id': 'corr-c03-unit-metrics-spoofed',
        'x-gateway-auth': 'wrong-secret',
        'x-tenant-id': TENANT,
        'x-workspace-id': SPOOFED_WORKSPACE
      }
    });
    assert.equal(spoofed.status, 401);

    const foreign = await fetch(`${baseUrl}/v1/workspaces/${FOREIGN_WORKSPACE}/api-keys`, {
      headers: trustedHeaders()
    });
    assert.equal(foreign.status, 403);

    const unknown = await fetch(`${baseUrl}/v1/workspaces/${UNRESOLVED_JWT_WORKSPACE}/api-keys`, {
      headers: trustedHeaders(TENANT, {
        'x-workspace-id': UNRESOLVED_JWT_WORKSPACE
      })
    });
    assert.equal(unknown.status, 200);

    const membershipDenied = await fetch(`${baseUrl}/v1/workspaces/${WORKSPACE}/api-keys`, {
      method: 'POST',
      headers: trustedHeaders(TENANT, {
        'content-type': 'application/json',
        'x-actor-roles': 'workspace_admin',
        'x-actor-workspace-ids': FOREIGN_WORKSPACE
      }),
      body: JSON.stringify({ keyType: 'anon' })
    });
    assert.equal(membershipDenied.status, 403);

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    assert.doesNotMatch(metrics, new RegExp(`workspace_id="${SPOOFED_WORKSPACE}"`));
    assert.doesNotMatch(metrics, new RegExp(`workspace_id="${FOREIGN_WORKSPACE}"`));
    assert.doesNotMatch(metrics, new RegExp(`workspace_id="${UNRESOLVED_JWT_WORKSPACE}"`));
    const membershipDeniedLine = metrics.split('\n').find((candidate) =>
      candidate.startsWith('falcone_http_requests_total{')
      && candidate.includes(`route="/v1/workspaces/${WORKSPACE}/api-keys"`)
      && candidate.includes('status="403"')
    );
    assert.ok(membershipDeniedLine, metrics);
    assert.doesNotMatch(membershipDeniedLine, /workspace_id=/);
  });
});

test('executor never promotes a tenant-only JWT path fallback into a trusted workspace label', async () => {
  const apiKeyStore = {
    async listKeys(workspaceId) {
      return [{ id: `key-for-${workspaceId}` }];
    }
  };
  const jwtVerifier = {
    async verify(_token, pathWorkspaceId) {
      return {
        tenantId: TENANT,
        workspaceId: pathWorkspaceId,
        credentialWorkspaceId: undefined,
        actorId: 'tenant-only-user',
        roleName: 'falcone_app',
        roles: ['tenant_admin'],
        scopes: []
      };
    }
  };
  const server = createControlPlaneServer({
    registry: {},
    apiKeyStore,
    jwtVerifier,
    resolveWorkspaceTenant: async () => undefined,
    logger: { error() {} }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/v1/workspaces/${UNRESOLVED_JWT_WORKSPACE}/api-keys`, {
      headers: {
        'x-api-version': '2026-03-26',
        'x-correlation-id': 'corr-c03-unit-metrics-jwt',
        authorization: 'Bearer tenant.only.jwt'
      }
    });
    assert.equal(response.status, 200);

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    assert.doesNotMatch(metrics, new RegExp(`workspace_id="${UNRESOLVED_JWT_WORKSPACE}"`));
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
});
