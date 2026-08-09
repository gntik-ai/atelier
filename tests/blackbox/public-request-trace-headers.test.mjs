/**
 * C-03 hermetic public HTTP regressions for API version enforcement and
 * end-to-end correlation continuity.
 *
 * Drives the public control-plane and executor HTTP constructors and parses the
 * configured APISIX routes. No cluster, external network, database, or real
 * credentials are used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const API_VERSION = '2026-03-26';
const VALID_BEARER = 'c03-valid-test-token';
const QUOTAS_PATH = '/v1/metrics/tenants/tenant-c03/quotas';
const EXECUTOR_PREFLIGHT_PATH = '/v1/postgres/workspaces/ws-c03/data/db-c03/schemas/public/tables/items/rows';
const EXECUTOR_SSE_PREFLIGHTS = [
  {
    routeId: '2016-rt',
    path: '/v1/realtime/workspaces/ws-c03/data/db-c03/collections/items/changes'
  },
  {
    routeId: '2016-rt',
    path: '/v1/realtime/workspaces/ws-c03/data/db-c03/schemas/public/tables/items/changes'
  },
  {
    routeId: '2017-flows',
    path: '/v1/flows/workspaces/ws-c03/executions/ten%3Aws-c03%3Aflow%3Arun-c03/events'
  }
];
const UNKNOWN_PUBLIC_PATH = '/v1/reproduction/c03-no-such-route';
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PUBLIC_CORS_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'x-api-version',
  'x-correlation-id',
  'idempotency-key',
  'x-requested-with',
  'apikey',
  'x-api-key',
  'last-event-id',
  'x-request-id',
  'range',
  'if-match',
  'if-none-match',
  'x-origin-surface'
];
const PUBLIC_CORS_EXPOSE_HEADERS = [
  'x-correlation-id',
  'x-idempotency-replayed',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'content-range',
  'accept-ranges'
];

function recordingPool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params: [...params] });
      if (/\bFROM\s+tenants\b/i.test(text) && params[0] === 'tenant-c03') {
        return {
          rows: [{
            id: 'tenant-c03',
            slug: 'tenant-c03',
            display_name: 'C-03 Tenant',
            status: 'active',
            iam_realm: 'tenant-c03',
            created_at: '2026-08-08T00:00:00.000Z',
            created_by: 'blackbox-c03'
          }]
        };
      }
      return { rows: [] };
    }
  };
}

function recordingVerifier() {
  const calls = [];
  return {
    calls,
    async verify(token) {
      calls.push(token);
      assert.equal(token, VALID_BEARER);
      return {
        payload: {
          sub: 'user-c03',
          tenant_id: 'tenant-c03',
          realm_access: { roles: ['tenant_admin'] },
          scope: 'metrics:read'
        },
        trust: { kind: 'platform' }
      };
    }
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function assertSafeCorrelation(response, body, { expected, rejected } = {}) {
  const header = response.headers.get('x-correlation-id');
  assert.ok(header, 'the public response exposes X-Correlation-Id');
  assert.match(header, CORRELATION_PATTERN);
  if (expected !== undefined) assert.equal(header, expected);
  if (rejected !== undefined) assert.notEqual(header, rejected);
  if (body && Object.hasOwn(body, 'correlationId')) {
    assert.equal(body.correlationId, header, 'error body and response header use one correlation identifier');
  }
}

async function readJson(response) {
  const body = await response.json();
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  return body;
}

const pool = recordingPool();
const jwtVerifier = recordingVerifier();
let server;
let baseUrl;
let executorServer;
let executorBaseUrl;
let gatewayServer;
let gatewayBaseUrl;

function matchesGatewayUri(pattern, pathname) {
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1));
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, (character) => `\\${character}`)
    .replace(/\\\{[A-Za-z0-9_]+\\\}/g, '[^/]+');
  return new RegExp(`^${expression}/?$`).test(pathname);
}

function gatewayVariable(name, req, pathname) {
  if (name === 'uri') return pathname;
  if (name.startsWith('http_')) return String(req.headers[name.slice(5).replaceAll('_', '-')] ?? '');
  throw new Error(`unsupported APISIX test variable: ${name}`);
}

function matchesGatewayVars(route, req, pathname) {
  return (route.vars ?? []).every(([name, operator, expected]) => {
    assert.equal(operator, '~~', `APISIX test router must model route ${route.id} operator ${operator}`);
    return new RegExp(expected).test(gatewayVariable(name, req, pathname));
  });
}

function selectConfiguredRoute(routes, req, pathname) {
  return routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => (!route.methods || route.methods.includes(req.method)))
    .filter(({ route }) => matchesGatewayUri(String(route.uri), pathname))
    .filter(({ route }) => matchesGatewayVars(route, req, pathname))
    .sort((left, right) =>
      Number(right.route.priority ?? 0) - Number(left.route.priority ?? 0) || left.index - right.index
    )[0]?.route;
}

function configuredUpstreamKind(route) {
  const node = Object.keys(route?.upstream?.nodes ?? {})[0] ?? '';
  if (node.includes('control-plane-executor')) return 'executor';
  if (node.includes('control-plane')) return 'control-plane';
  return 'unsupported';
}

function resolveConfiguredGatewayCorrelation(route, req) {
  const pre = route.plugins?.['serverless-pre-function'];
  const post = route.plugins?.['serverless-post-function'];
  assert.equal(pre?.phase, 'rewrite', `APISIX route ${route.id} resolves correlation before limit-count`);
  assert.equal(post?.phase, 'header_filter', `APISIX route ${route.id} finalizes correlation after limit-count`);
  const preSource = (pre.functions ?? []).join('\n');
  const postSource = (post.functions ?? []).join('\n');
  assert.match(preSource, /\^\[A-Za-z0-9\._:-\]\{8,128\}\$/);
  assert.match(preSource, /ngx\.var\.request_id/);
  assert.match(preSource, /if raw == nil/);
  assert.match(postSource, /ngx\.header\["X-Correlation-Id"\]/);
  assert.match(postSource, /ctx\.c03_correlation_id or ngx\.var\.request_id/);
  const raw = req.headers['x-correlation-id'];
  return typeof raw === 'string' && CORRELATION_PATTERN.test(raw) ? raw : randomUUID();
}

function createConfiguredGateway({ controlPlaneBaseUrl, executorBaseUrl }) {
  const config = YAML.parse(readFileSync('deploy/kind/apisix/apisix.yaml', 'utf8'));
  const productRoutes = config.routes.filter((route) => String(route.uri).startsWith('/v1/'));
  assert.ok(productRoutes.length > 0);
  for (const route of productRoutes) {
    assert.equal(route.plugins?.cors?._meta?.disable, true, `APISIX route ${route.id} must pass OPTIONS to its runtime`);
  }
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://configured-gateway.test');
    const route = selectConfiguredRoute(config.routes, req, requestUrl.pathname);
    const upstreamKind = configuredUpstreamKind(route);
    const upstreamBaseUrl = upstreamKind === 'executor'
      ? executorBaseUrl
      : upstreamKind === 'control-plane' ? controlPlaneBaseUrl : null;
    if (!route || !upstreamBaseUrl) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'TEST_GATEWAY_UPSTREAM_UNAVAILABLE', routeId: route?.id ?? null }));
      return;
    }
    if (route.plugins?.['limit-count'] && req.headers['x-c03-test-limit-count'] === 'exhausted') {
      const correlationId = resolveConfiguredGatewayCorrelation(route, req);
      res.writeHead(Number(route.plugins['limit-count'].rejected_code ?? 429), {
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
        'x-c03-gateway-route-id': String(route.id),
        'x-c03-gateway-upstream': upstreamKind
      });
      res.end(JSON.stringify({ code: 'TEST_GATEWAY_RATE_LIMITED' }));
      return;
    }
    const target = new URL(req.url, upstreamBaseUrl);
    const upstream = http.request(target, { method: req.method, headers: req.headers }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, {
        ...upstreamResponse.headers,
        'x-c03-gateway-route-id': String(route.id),
        'x-c03-gateway-upstream': upstreamKind
      });
      upstreamResponse.pipe(res);
    });
    upstream.on('error', (error) => res.destroy(error));
    req.pipe(upstream);
  });
}

test.before(async () => {
  const module = await import('../../apps/control-plane/server.mjs');
  assert.equal(
    typeof module.createControlPlaneHttpServer,
    'function',
    'control-plane exposes its public hermetic HTTP constructor'
  );
  server = await module.createControlPlaneHttpServer({
    pool,
    jwtVerifier,
    logger: { error() {} }
  });
  baseUrl = await listen(server);
  const executorModule = await import('../../apps/control-plane-executor/src/runtime/server.mjs');
  executorServer = executorModule.createControlPlaneServer({
    registry: { withWorkspaceClient() { throw new Error('preflight must not reach the registry'); } },
    controlPlaneUpstream: baseUrl,
    realtimeExecutor: {},
    pgRealtimeExecutor: {},
    flowMonitoringExecutor: {},
    logger: { error() {} }
  });
  executorBaseUrl = await listen(executorServer);
  gatewayServer = createConfiguredGateway({ controlPlaneBaseUrl: baseUrl, executorBaseUrl });
  gatewayBaseUrl = await listen(gatewayServer);
});

test.beforeEach(() => {
  pool.calls.length = 0;
  jwtVerifier.calls.length = 0;
});

test.after(async () => {
  await close(gatewayServer);
  await close(executorServer);
  await close(server);
});

// bbx-c03-auth-precedence | fn-public-request-trace-headers | OpenSpec #### Scenario: Authentication retains precedence
test('bbx-c03-auth-precedence: anonymous protected request remains 401 and receives a safe correlation', async () => {
  const response = await fetch(`${baseUrl}${QUOTAS_PATH}`);
  const body = await readJson(response);

  assert.equal(response.status, 401);
  assert.notEqual(body.code, 'GW_API_VERSION_REQUIRED');
  assert.notEqual(body.code, 'GW_UNSUPPORTED_API_VERSION');
  assert.notEqual(body.code, 'GW_INVALID_CORRELATION_ID');
  assertSafeCorrelation(response, body);
  assert.equal(jwtVerifier.calls.length, 0, 'missing bearer is rejected without invoking token verification');
  assert.equal(pool.calls.length, 0, 'authentication failure performs no domain work');
});

// bbx-c03-version-required | fn-public-request-trace-headers | OpenSpec #### Scenario: Missing version is rejected without domain work
// bbx-c03-correlation-generated-error | fn-public-request-trace-headers | OpenSpec #### Scenario: Error body and response header agree
test('bbx-c03-version-required: authenticated request without API version is rejected before domain work', async () => {
  const response = await fetch(`${gatewayBaseUrl}${QUOTAS_PATH}`, {
    headers: { authorization: `Bearer ${VALID_BEARER}` }
  });
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.code, 'GW_API_VERSION_REQUIRED');
  assertSafeCorrelation(response, body);
  assert.deepEqual(jwtVerifier.calls, [VALID_BEARER], 'authentication retains precedence over header validation');
  assert.equal(pool.calls.length, 0, 'missing version is rejected before domain work');
});

// bbx-c03-version-unsupported | fn-public-request-trace-headers | OpenSpec #### Scenario: Unsupported or ambiguous version is rejected
test('bbx-c03-version-unsupported: unsupported and comma-combined API versions are canonical 400 errors', async (t) => {
  for (const [label, version] of [
    ['unsupported', '2025-01-01'],
    ['comma-combined', `${API_VERSION}, ${API_VERSION}`]
  ]) {
    await t.test(label, async () => {
      pool.calls.length = 0;
      const response = await fetch(`${baseUrl}${QUOTAS_PATH}`, {
        headers: {
          authorization: `Bearer ${VALID_BEARER}`,
          'x-api-version': version
        }
      });
      const body = await readJson(response);

      assert.equal(response.status, 400);
      assert.equal(body.code, 'GW_UNSUPPORTED_API_VERSION');
      assert.doesNotMatch(JSON.stringify(body), new RegExp(version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assertSafeCorrelation(response, body);
      assert.equal(pool.calls.length, 0, `${label} version is rejected before domain work`);
    });
  }
});

// bbx-c03-correlation-success | fn-public-request-trace-headers | OpenSpec #### Scenario: Success echoes caller correlation
test('bbx-c03-correlation-success: valid caller correlation is preserved on success', async () => {
  const correlationId = 'corr-c03-success-001';
  const response = await fetch(`${baseUrl}${QUOTAS_PATH}`, {
    headers: {
      authorization: `Bearer ${VALID_BEARER}`,
      'x-api-version': API_VERSION,
      'x-correlation-id': correlationId
    }
  });

  assert.equal(response.status, 200);
  assertSafeCorrelation(response, null, { expected: correlationId });
  assert.ok(await response.json(), 'success body remains available');
});

// bbx-c03-correlation-error | fn-public-request-trace-headers | OpenSpec #### Scenario: Error body and response header agree
test('bbx-c03-correlation-error: valid caller correlation is preserved on a public error', async () => {
  const correlationId = 'corr-c03-error-001';
  const response = await fetch(`${baseUrl}${UNKNOWN_PUBLIC_PATH}`, {
    headers: {
      authorization: `Bearer ${VALID_BEARER}`,
      'x-api-version': API_VERSION,
      'x-correlation-id': correlationId
    }
  });
  const body = await readJson(response);

  assert.equal(response.status, 404, 'unknown public route retains its existing not-found outcome');
  assertSafeCorrelation(response, body, { expected: correlationId });
});

// bbx-c03-correlation-invalid | fn-public-request-trace-headers | OpenSpec #### Scenario: Invalid correlation uses a safe rejection identifier
test('bbx-c03-correlation-invalid: malformed correlation is rejected using a different safe identifier', async () => {
  const malformedCorrelation = 'bad correlation value';
  const response = await fetch(`${baseUrl}${QUOTAS_PATH}`, {
    headers: {
      authorization: `Bearer ${VALID_BEARER}`,
      'x-api-version': API_VERSION,
      'x-correlation-id': malformedCorrelation
    }
  });
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.code, 'GW_INVALID_CORRELATION_ID');
  assert.doesNotMatch(JSON.stringify(body), /bad correlation value/);
  assertSafeCorrelation(response, body, { rejected: malformedCorrelation });
  assert.equal(pool.calls.length, 0, 'invalid correlation is rejected before domain work');
});

// bbx-c03-preflight-exempt | fn-public-request-trace-headers | OpenSpec #### Scenario: Preflight remains anonymous
test('bbx-c03-preflight-exempt: anonymous preflight succeeds and advertises trace headers', async () => {
  const response = await fetch(`${gatewayBaseUrl}${QUOTAS_PATH}`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://console.example.test',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,x-api-version,x-correlation-id'
    }
  });

  assert.ok(response.status >= 200 && response.status < 300, `preflight status ${response.status}`);
  assert.equal(response.headers.get('x-c03-gateway-route-id'), '2010');
  assert.equal(response.headers.get('x-c03-gateway-upstream'), 'control-plane');
  const allowed = response.headers.get('access-control-allow-headers')?.toLowerCase() ?? '';
  const exposed = response.headers.get('access-control-expose-headers')?.toLowerCase() ?? '';
  assert.match(allowed, /(?:^|[,\s])x-api-version(?:$|[,\s])/);
  assert.match(allowed, /(?:^|[,\s])x-correlation-id(?:$|[,\s])/);
  assert.match(exposed, /(?:^|[,\s])x-correlation-id(?:$|[,\s])/);
  assert.match(response.headers.get('x-correlation-id') ?? '', /^[A-Za-z0-9._:-]{8,128}$/);
  assert.equal(jwtVerifier.calls.length, 0);
  assert.equal(pool.calls.length, 0);
});

test('bbx-c03-api-key-preflight: configured APISIX selection sends header-only preflight to executor', async () => {
  const response = await fetch(`${gatewayBaseUrl}${EXECUTOR_PREFLIGHT_PATH}`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://external-app.example.test',
      'access-control-request-method': 'GET',
      'access-control-request-headers': PUBLIC_CORS_REQUEST_HEADERS.join(',')
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('x-c03-gateway-route-id'), '2005-key-preflight');
  assert.equal(response.headers.get('x-c03-gateway-upstream'), 'executor');
  const allowed = new Set(
    (response.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map((value) => value.trim())
  );
  for (const header of PUBLIC_CORS_REQUEST_HEADERS) {
    assert.ok(allowed.has(header), `executor preflight must allow ${header}`);
  }
  const exposed = new Set(
    (response.headers.get('access-control-expose-headers') ?? '').toLowerCase().split(',').map((value) => value.trim())
  );
  for (const header of PUBLIC_CORS_EXPOSE_HEADERS) {
    assert.ok(exposed.has(header), `executor response must expose ${header}`);
  }
  assert.match(response.headers.get('x-correlation-id') ?? '', CORRELATION_PATTERN);
  assert.equal(jwtVerifier.calls.length, 0, 'preflight remains anonymous');
  assert.equal(pool.calls.length, 0, 'executor preflight never falls through to the control-plane');
});

test('bbx-c03-sse-preflight: configured gateway admits registered realtime and flow streams', async () => {
  for (const { routeId, path } of EXECUTOR_SSE_PREFLIGHTS) {
    const response = await fetch(`${gatewayBaseUrl}${path}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://console.example.test',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-api-version,x-correlation-id,last-event-id'
      }
    });

    assert.equal(response.status, 204, path);
    assert.equal(response.headers.get('x-c03-gateway-route-id'), routeId, path);
    assert.equal(response.headers.get('x-c03-gateway-upstream'), 'executor', path);
    const allowed = new Set(
      (response.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map((value) => value.trim())
    );
    for (const header of ['x-api-version', 'x-correlation-id', 'last-event-id']) {
      assert.ok(allowed.has(header), `${path} must allow ${header}`);
    }
    assert.match(response.headers.get('x-correlation-id') ?? '', CORRELATION_PATTERN, path);
  }
  assert.equal(jwtVerifier.calls.length, 0, 'stream preflight remains anonymous');
  assert.equal(pool.calls.length, 0, 'stream preflight performs no control-plane domain work');
});

test('bbx-c03-gateway-rate-limit: APISIX-owned 429 returns one safe correlation', async (t) => {
  for (const [label, supplied, expected] of [
    ['omitted', undefined, undefined],
    ['valid', 'corr-c03-rate-limit-valid', 'corr-c03-rate-limit-valid'],
    ['invalid', 'bad correlation value', undefined]
  ]) {
    await t.test(label, async () => {
      const headers = {
        apikey: 'flc_c03_rate_limit_key',
        'x-api-version': API_VERSION,
        'x-c03-test-limit-count': 'exhausted'
      };
      if (supplied !== undefined) headers['x-correlation-id'] = supplied;
      const response = await fetch(`${gatewayBaseUrl}${EXECUTOR_PREFLIGHT_PATH}`, { headers });

      assert.equal(response.status, 429);
      assert.equal(response.headers.get('x-c03-gateway-route-id'), '2005-key');
      assert.equal(response.headers.get('x-c03-gateway-upstream'), 'executor');
      assertSafeCorrelation(response, null, { expected, rejected: label === 'invalid' ? supplied : undefined });
    });
  }
  assert.equal(jwtVerifier.calls.length, 0, 'gateway rate rejection never reaches authentication');
  assert.equal(pool.calls.length, 0, 'gateway rate rejection never reaches domain work');
});

test('bbx-c03-preflight-unpublished: anonymous preflight does not publish an unknown route', async () => {
  const response = await fetch(`${baseUrl}/v1/c03-no-such-route`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://console.example.test',
      'access-control-request-method': 'GET'
    }
  });
  const body = await readJson(response);

  assert.equal(response.status, 404);
  assert.equal(body.code, 'GW_NO_ROUTE');
  assertSafeCorrelation(response, body);
  assert.equal(jwtVerifier.calls.length, 0);
  assert.equal(pool.calls.length, 0);
});

// bbx-c03-health-exempt | fn-public-request-trace-headers | OpenSpec #### Scenario: Preflight remains anonymous
test('bbx-c03-health-exempt: health endpoint does not require public trace headers', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await readJson(response);

  assert.notEqual(response.status, 400);
  assert.notEqual(body.code, 'GW_API_VERSION_REQUIRED');
  assert.notEqual(body.code, 'GW_UNSUPPORTED_API_VERSION');
  assert.notEqual(body.code, 'GW_INVALID_CORRELATION_ID');
  assert.equal(jwtVerifier.calls.length, 0);
});

// bbx-c03-schema-gate-order | fn-public-request-trace-headers | OpenSpec #### Scenario: Authentication retains precedence
// bbx-c03-schema-gate-version | fn-public-request-trace-headers | OpenSpec #### Scenario: Missing version is rejected without domain work
test('bbx-c03-schema-gate: authentication and trace validation precede mapped-route readiness', async (t) => {
  const { createControlPlaneHttpServer } = await import('../../apps/control-plane/server.mjs');
  const gatedPool = recordingPool();
  const gatedVerifier = recordingVerifier();
  const gatedServer = createControlPlaneHttpServer({
    pool: gatedPool,
    jwtVerifier: gatedVerifier,
    logger: { error() {} },
    schemaReadiness: {
      responseForReadyProbe: () => ({ statusCode: 503, body: { status: 'schema_not_ready' } }),
      responseForMappedRoute: () => ({
        statusCode: 503,
        body: { code: 'SCHEMA_NOT_READY', message: 'Control-plane schema is not ready' }
      })
    }
  });
  const gatedBaseUrl = await listen(gatedServer);
  t.after(() => close(gatedServer));

  const anonymousResponse = await fetch(`${gatedBaseUrl}${QUOTAS_PATH}`);
  const anonymousBody = await readJson(anonymousResponse);
  assert.equal(anonymousResponse.status, 401);
  assertSafeCorrelation(anonymousResponse, anonymousBody);

  const missingVersionResponse = await fetch(`${gatedBaseUrl}${QUOTAS_PATH}`, {
    headers: { authorization: `Bearer ${VALID_BEARER}` }
  });
  const missingVersionBody = await readJson(missingVersionResponse);
  assert.equal(missingVersionResponse.status, 400);
  assert.equal(missingVersionBody.code, 'GW_API_VERSION_REQUIRED');
  assertSafeCorrelation(missingVersionResponse, missingVersionBody);

  const correlationId = 'corr-c03-schema-gate';
  const gatedResponse = await fetch(`${gatedBaseUrl}${QUOTAS_PATH}`, {
    headers: {
      authorization: `Bearer ${VALID_BEARER}`,
      'x-api-version': API_VERSION,
      'x-correlation-id': correlationId
    }
  });
  const gatedBody = await readJson(gatedResponse);
  assert.equal(gatedResponse.status, 503);
  assertSafeCorrelation(gatedResponse, gatedBody, { expected: correlationId });
  assert.equal(gatedPool.calls.length, 0, 'schema-not-ready handling performs no domain work');
});
