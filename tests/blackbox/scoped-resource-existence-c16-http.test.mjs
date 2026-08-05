/**
 * C-16 hermetic HTTP regressions for authentication ordering, authoritative
 * scope existence, registry failures, and the canonical C-02 error envelope.
 *
 * Drives only the public createControlPlaneHttpServer constructor and its HTTP
 * surface. No cluster, external network, database, or real credentials are used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTTP_FETCH = globalThis.fetch.bind(globalThis);
const OPENAPI = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8'));
const ERROR_SCHEMA = OPENAPI.components.schemas.ErrorResponse;
const DETAIL_SCHEMA = OPENAPI.components.schemas.ErrorDetail;
const RESOURCE_SCHEMA = OPENAPI.components.schemas.ErrorResource;
const SENSITIVE_TEXT = /(select\s|sqlstate|postgres|stack|https?:\/\/|password|secret|credential|bearer\s|registry unavailable|simulated)/i;

const VALID_BEARER = 'c16-valid-platform-token';
const OWNER_A_BEARER = 'c16-valid-tenant-a-owner-token';
const INVALID_BEARER = 'c16-invalid-token';
const TENANT_A = 'ten_c16_http_a';
const TENANT_B = 'ten_c16_http_b';
const TENANT_UNKNOWN = 'ten_c16_http_unknown';
const TENANT_REGISTRY_FAILURE = 'ten_c16_http_registry_failure';
const WORKSPACE_A = 'wrk_c16_http_a';
const WORKSPACE_B = 'wrk_c16_http_b';
const WORKSPACE_UNKNOWN = 'wrk_c16_http_unknown';
const WORKSPACE_REGISTRY_FAILURE = 'wrk_c16_http_registry_failure';
const OPAQUE_TENANT_TARGET = 'needle';
const OPAQUE_WORKSPACE_TARGET = 'pin';
const SHORT_FOREIGN_TENANT = 'rivet';
const SHORT_UNKNOWN_TENANT = 'mist';
const SHORT_FOREIGN_WORKSPACE = 'peg';
const SHORT_UNKNOWN_WORKSPACE = 'void';
const OUTSIDE_C16_TARGET = 'rune';

const TENANTS = {
  [TENANT_A]: { id: TENANT_A, slug: 'c16-http-a', display_name: 'C-16 HTTP Tenant A', status: 'active' },
  [TENANT_B]: { id: TENANT_B, slug: 'c16-http-b', display_name: 'C-16 HTTP Tenant B', status: 'active' },
  [SHORT_FOREIGN_TENANT]: { id: SHORT_FOREIGN_TENANT, slug: 'short-foreign', display_name: 'Short foreign tenant', status: 'active' }
};

const WORKSPACES = {
  [WORKSPACE_A]: {
    id: WORKSPACE_A,
    tenant_id: TENANT_A,
    slug: 'c16-http-a',
    display_name: 'C-16 HTTP workspace A',
    status: 'active',
    environment: 'test',
    created_at: '2026-08-05T00:00:00.000Z'
  },
  [WORKSPACE_B]: {
    id: WORKSPACE_B,
    tenant_id: TENANT_B,
    slug: 'c16-http-b',
    display_name: 'C-16 HTTP workspace B',
    status: 'active',
    environment: 'test',
    created_at: '2026-08-05T00:00:00.000Z'
  },
  [SHORT_FOREIGN_WORKSPACE]: {
    id: SHORT_FOREIGN_WORKSPACE,
    tenant_id: TENANT_B,
    slug: 'short-foreign',
    display_name: 'Short foreign workspace',
    status: 'active',
    environment: 'test',
    created_at: '2026-08-05T00:00:00.000Z'
  }
};

const ROUTES = [
  {
    id: 'tenant-quotas',
    fn: 'fn-observability-quota-usage',
    method: 'GET',
    template: '/v1/metrics/tenants/{tenantId}/quotas',
    path: ({ tenantId }) => `/v1/metrics/tenants/${tenantId}/quotas`,
    registry: 'tenant'
  },
  {
    id: 'tenant-overview',
    fn: 'fn-observability-quota-usage',
    method: 'GET',
    template: '/v1/metrics/tenants/{tenantId}/overview',
    path: ({ tenantId }) => `/v1/metrics/tenants/${tenantId}/overview`,
    registry: 'tenant'
  },
  {
    id: 'tenant-usage',
    fn: 'fn-observability-quota-usage',
    method: 'GET',
    template: '/v1/metrics/tenants/{tenantId}/usage',
    path: ({ tenantId }) => `/v1/metrics/tenants/${tenantId}/usage`,
    registry: 'tenant'
  },
  {
    id: 'tenant-series',
    fn: 'fn-observability-metric-series',
    method: 'GET',
    template: '/v1/metrics/tenants/{tenantId}/series',
    path: ({ tenantId }) => `/v1/metrics/tenants/${tenantId}/series`,
    registry: 'tenant',
    validSearch: '?metricKey=api_requests&window=24h'
  },
  {
    id: 'tenant-audit',
    fn: 'fn-observability-audit-record-query',
    method: 'GET',
    template: '/v1/metrics/tenants/{tenantId}/audit-records',
    path: ({ tenantId }) => `/v1/metrics/tenants/${tenantId}/audit-records`,
    registry: 'tenant'
  },
  {
    id: 'tenant-audit-export',
    fn: 'fn-observability-audit-export',
    method: 'POST',
    template: '/v1/metrics/tenants/{tenantId}/audit-exports',
    path: ({ tenantId }) => `/v1/metrics/tenants/${tenantId}/audit-exports`,
    registry: 'tenant',
    validBody: JSON.stringify({ format: 'jsonl', pageSize: 1 })
  },
  {
    id: 'workspace-quotas',
    fn: 'fn-observability-quota-usage',
    method: 'GET',
    template: '/v1/metrics/workspaces/{workspaceId}/quotas',
    path: ({ workspaceId }) => `/v1/metrics/workspaces/${workspaceId}/quotas`,
    registry: 'workspace',
    family: 'workspace-metrics'
  },
  {
    id: 'workspace-overview',
    fn: 'fn-observability-quota-usage',
    method: 'GET',
    template: '/v1/metrics/workspaces/{workspaceId}/overview',
    path: ({ workspaceId }) => `/v1/metrics/workspaces/${workspaceId}/overview`,
    registry: 'workspace',
    family: 'workspace-metrics'
  },
  {
    id: 'workspace-usage',
    fn: 'fn-observability-quota-usage',
    method: 'GET',
    template: '/v1/metrics/workspaces/{workspaceId}/usage',
    path: ({ workspaceId }) => `/v1/metrics/workspaces/${workspaceId}/usage`,
    registry: 'workspace',
    family: 'workspace-metrics'
  },
  {
    id: 'workspace-series',
    fn: 'fn-observability-metric-series',
    method: 'GET',
    template: '/v1/metrics/workspaces/{workspaceId}/series',
    path: ({ workspaceId }) => `/v1/metrics/workspaces/${workspaceId}/series`,
    registry: 'workspace',
    family: 'workspace-metrics',
    validSearch: '?metricKey=api_requests&window=24h'
  },
  {
    id: 'workspace-audit',
    fn: 'fn-observability-audit-record-query',
    method: 'GET',
    template: '/v1/metrics/workspaces/{workspaceId}/audit-records',
    path: ({ workspaceId }) => `/v1/metrics/workspaces/${workspaceId}/audit-records`,
    registry: 'workspace',
    family: 'workspace-metrics'
  },
  {
    id: 'workspace-audit-export',
    fn: 'fn-observability-audit-export',
    method: 'POST',
    template: '/v1/metrics/workspaces/{workspaceId}/audit-exports',
    path: ({ workspaceId }) => `/v1/metrics/workspaces/${workspaceId}/audit-exports`,
    registry: 'workspace',
    family: 'workspace-metrics',
    validBody: JSON.stringify({ format: 'jsonl', pageSize: 1 })
  },
  {
    id: 'workspace-storage-usage',
    fn: 'fn-storage-workspace-usage',
    method: 'GET',
    template: '/v1/storage/workspaces/{workspaceId}/usage',
    path: ({ workspaceId }) => `/v1/storage/workspaces/${workspaceId}/usage`,
    registry: 'workspace'
  }
];

const WORKSPACE_METRICS_ROUTES = ROUTES.filter(({ family }) => family === 'workspace-metrics');
const TENANT_METRICS_ROUTES = ROUTES.filter(({ registry }) => registry === 'tenant');
const TENANT_AUDIT_EXPORT_ROUTE = ROUTES.find(({ id }) => id === 'tenant-audit-export');
const WORKSPACE_AUDIT_EXPORT_ROUTE = ROUTES.find(({ id }) => id === 'workspace-audit-export');
const STORAGE_ROUTE = ROUTES.find(({ id }) => id === 'workspace-storage-usage');

function recordingPool() {
  const calls = [];
  const registryFailures = {
    tenant: new Set([TENANT_REGISTRY_FAILURE]),
    workspace: new Set([WORKSPACE_REGISTRY_FAILURE])
  };
  return {
    calls,
    registryFailures,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params: [...params] });

      if (/\bFROM\s+tenants\b/i.test(text)) {
        if (registryFailures.tenant.has(params[0])) {
          throw Object.assign(new Error('simulated tenant registry unavailable'), { code: 'C16_REGISTRY_UNAVAILABLE' });
        }
        const target = TENANTS[params[0]] ?? Object.values(TENANTS).find(({ slug }) => slug === params[0]);
        return { rows: target ? [target] : [] };
      }
      if (/\bFROM\s+workspaces\b/i.test(text)) {
        if (registryFailures.workspace.has(params[0])) {
          throw Object.assign(new Error('simulated workspace registry unavailable'), { code: 'C16_REGISTRY_UNAVAILABLE' });
        }
        const target = WORKSPACES[params[0]] ?? Object.values(WORKSPACES).find(({ slug }) => slug === params[0]);
        return { rows: target ? [target] : [] };
      }
      if (/\bFROM\s+plan_audit_events\b/i.test(text)) return { rows: [] };
      if (/\bINSERT\s+INTO\s+scope_enforcement_denials\b/i.test(text)) return { rows: [] };

      throw new Error(`downstream SQL must not run after terminal C-16 scope result: ${text}`);
    },
    async connect() {
      return {
        query: this.query.bind(this),
        release() {}
      };
    }
  };
}

function recordingVerifier() {
  const calls = [];
  return {
    calls,
    async verify(token) {
      calls.push(token);
      if (token === OWNER_A_BEARER) {
        return {
          payload: {
            sub: 'usr_c16_http_owner_a',
            tenant_id: TENANT_A,
            workspace_id: WORKSPACE_A,
            realm_access: { roles: ['tenant_owner'] },
            scope: ''
          },
          trust: { kind: 'tenant', realm: TENANT_A }
        };
      }
      if (token !== VALID_BEARER) throw new Error('invalid C-16 bearer');
      return {
        payload: {
          sub: 'usr_c16_http_superadmin',
          realm_access: { roles: ['superadmin'] },
          scope: ''
        },
        trust: { kind: 'platform', realm: 'in-falcone-platform' }
      };
    }
  };
}

function registryCalls(pool, registry) {
  const table = registry === 'tenant' ? 'tenants' : 'workspaces';
  return pool.calls.filter(({ sql }) => new RegExp(`\\bFROM\\s+${table}\\b`, 'i').test(sql));
}

function leafSqlCalls(pool) {
  return pool.calls.filter(({ sql }) =>
    !/\bFROM\s+(?:tenants|workspaces)\b/i.test(sql)
    && !/\bINSERT\s+INTO\s+scope_enforcement_denials\b/i.test(sql)
  );
}

function prometheusRouteSamples(metricsText) {
  const samples = [];
  for (const line of String(metricsText).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const metricName = line.match(/^([A-Za-z_:][A-Za-z0-9_:]*)\{/);
    if (!metricName) continue;
    const routeLabel = line.match(/(?:\{|,)route="((?:\\.|[^"\\])*)"(?:,|\})/);
    if (!routeLabel) continue;
    let routeValue = routeLabel[1];
    try {
      routeValue = JSON.parse(`"${routeValue}"`);
    } catch {
      // A route label is expected to use Prometheus' JSON-compatible escaping.
    }
    samples.push({ metric: metricName[1], route: routeValue });
  }
  return samples;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertCanonicalEnvelope(body, status, { rawTarget } = {}) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.deepEqual(
    ERROR_SCHEMA.required.filter((field) => !Object.hasOwn(body, field)),
    [],
    'every canonical ErrorResponse field is present'
  );
  assert.deepEqual(
    Object.keys(body).filter((field) => !Object.hasOwn(ERROR_SCHEMA.properties, field)),
    [],
    'canonical ErrorResponse is closed'
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
  assert.match(body.resource.path, /^\/v1\//, 'resource path remains a normalized public API path');
  if (rawTarget) {
    assert.doesNotMatch(
      JSON.stringify(body.resource),
      new RegExp(escapeRegExp(rawTarget), 'i'),
      'safe error resource must not expose the raw tenant/workspace target'
    );
  }
  assert.match(body.correlationId, new RegExp(ERROR_SCHEMA.properties.correlationId.pattern));
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withProviderProbe(fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('provider/object-store fetch must not run after a terminal C-16 result');
  };
  try {
    const value = await fn();
    return { value, calls };
  } finally {
    globalThis.fetch = original;
  }
}

const pool = recordingPool();
const jwtVerifier = recordingVerifier();
let server;
let baseUrl;

test.before(async () => {
  const module = await import('../../apps/control-plane/server.mjs');
  assert.equal(
    typeof module.createControlPlaneHttpServer,
    'function',
    'apps/control-plane/server.mjs must expose the public hermetic HTTP constructor required by C-16'
  );
  server = await module.createControlPlaneHttpServer({
    pool,
    jwtVerifier,
    logger: { error() {} }
  });
  assert.equal(typeof server?.listen, 'function', 'public constructor returns a Node HTTP server');
  baseUrl = await listen(server);
});

test.after(async () => {
  await close(server);
});

async function requestRoute(route, {
  bearer,
  tenantId = TENANT_UNKNOWN,
  workspaceId = WORKSPACE_UNKNOWN,
  malformedBody = false,
  requestBody
} = {}) {
  const path = `${route.path({ tenantId, workspaceId })}${route.validSearch ?? ''}`;
  const headers = {
    'content-type': 'application/json',
    'x-request-id': `req-c16-${route.id}`,
    'x-correlation-id': `corr-c16-${route.id}`
  };
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  const body = route.method === 'POST'
    ? (malformedBody ? '{not-json' : (requestBody === undefined ? route.validBody : JSON.stringify(requestBody)))
    : undefined;
  const response = await HTTP_FETCH(`${baseUrl}${path}`, {
    method: route.method,
    headers,
    body
  });
  return {
    response,
    path,
    rawTarget: route.registry === 'tenant' ? tenantId : workspaceId
  };
}

// bbx-c16-http-001 | affected fn | OpenSpec #### Scenario: Authentication remains first
for (const route of ROUTES) {
  test(`bbx-c16-http-001.missing.${route.id} | ${route.fn} | Scenario: Authentication remains first`, async () => {
    const sqlBefore = pool.calls.length;
    const verifyBefore = jwtVerifier.calls.length;
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(route, { malformedBody: route.id.endsWith('audit-export') })
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assertCanonicalEnvelope(body, 401, { rawTarget });
    assert.equal(pool.calls.length, sqlBefore, 'missing bearer must precede every registry/store query');
    assert.equal(jwtVerifier.calls.length, verifyBefore, 'missing bearer is rejected before verifier invocation');
    assert.equal(providerCalls, 0, 'missing bearer must precede provider/object-store work');
  });
}

// bbx-c16-http-002 | affected fn | OpenSpec #### Scenario: Authentication remains first
// bbx-c16-http-002.audit-export | fn-observability-audit-export | OpenSpec #### Scenario: Audit-export authentication and scope precede leaf validation
for (const route of ROUTES) {
  test(`bbx-c16-http-002.invalid.${route.id} | ${route.fn} | Scenario: Authentication remains first`, async () => {
    const sqlBefore = pool.calls.length;
    const verifyBefore = jwtVerifier.calls.length;
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(route, {
        bearer: INVALID_BEARER,
        malformedBody: route.id.endsWith('audit-export')
      })
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assertCanonicalEnvelope(body, 401, { rawTarget });
    assert.doesNotMatch(JSON.stringify(body), new RegExp(INVALID_BEARER, 'i'), 'presented bearer value must not be echoed');
    assert.equal(pool.calls.length, sqlBefore, 'invalid bearer must precede every registry/store query');
    assert.equal(jwtVerifier.calls.length, verifyBefore + 1, 'invalid bearer is verified exactly once');
    assert.equal(providerCalls, 0, 'invalid bearer must precede provider/object-store work');
  });
}

// bbx-c16-http-003 | fn-observability-scope-guard | OpenSpec #### Scenario: Tenant not found uses the existing envelope
// bbx-c16-http-003.storage | fn-storage-workspace-usage | OpenSpec #### Scenario: Workspace not found uses the existing envelope
for (const route of ROUTES) {
  const scenario = route.registry === 'tenant'
    ? 'Tenant not found uses the existing envelope'
    : 'Workspace not found uses the existing envelope';
  test(`bbx-c16-http-003.${route.id} | ${route.fn} | Scenario: ${scenario}`, async () => {
    const registryBefore = registryCalls(pool, route.registry).length;
    const sqlBefore = pool.calls.length;
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(route, { bearer: VALID_BEARER })
    );
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.code, route.registry === 'tenant' ? 'GW_TENANT_NOT_FOUND' : 'GW_WORKSPACE_NOT_FOUND');
    assertCanonicalEnvelope(body, 404, { rawTarget });
    assert.equal(registryCalls(pool, route.registry).length, registryBefore + 1);
    assert.equal(pool.calls.length, sqlBefore + 1, 'not-found performs only its authoritative lookup');
    assert.equal(providerCalls, 0, 'not-found must precede provider/object-store work');
  });
}

// bbx-c16-http-004 | fn-observability-scope-guard | OpenSpec #### Scenario: Tenant registry failure is not absence
// bbx-c16-http-004.storage | fn-storage-workspace-usage | OpenSpec #### Scenario: Workspace registry failure is not absence
for (const route of ROUTES) {
  const scenario = route.registry === 'tenant'
    ? 'Tenant registry failure is not absence'
    : 'Workspace registry failure is not absence';
  test(`bbx-c16-http-004.${route.id} | ${route.fn} | Scenario: ${scenario}`, async () => {
    const registryBefore = registryCalls(pool, route.registry).length;
    const sqlBefore = pool.calls.length;
    const targets = route.registry === 'tenant'
      ? { tenantId: TENANT_REGISTRY_FAILURE }
      : { workspaceId: WORKSPACE_REGISTRY_FAILURE };
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(route, { bearer: VALID_BEARER, ...targets })
    );
    const body = await response.json();

    assert.equal(response.status, 500, `registry exception must be server failure, got ${response.status}: ${JSON.stringify(body)}`);
    assertCanonicalEnvelope(body, 500, { rawTarget });
    assert.equal(body.code, 'GW_CONTROL_PLANE_ERROR');
    assert.equal(body.message, 'Internal server error');
    assert.deepEqual(body.detail, {});
    assert.equal(registryCalls(pool, route.registry).length, registryBefore + 1);
    assert.equal(pool.calls.length, sqlBefore + 1, 'registry exception performs no downstream SQL');
    assert.equal(providerCalls, 0, 'registry exception must precede provider/object-store work');
  });
}

// bbx-c16-http-005 | workspace metrics fn matrix | OpenSpec #### Scenario: Existing authorized workspace reaches its handler
test('bbx-c16-http-005.matrix | workspace metrics fn matrix | Scenario: Existing authorized workspace reaches its handler', () => {
  assert.deepEqual(
    WORKSPACE_METRICS_ROUTES.map(({ id }) => id),
    [
      'workspace-quotas',
      'workspace-overview',
      'workspace-usage',
      'workspace-series',
      'workspace-audit',
      'workspace-audit-export'
    ],
    'the HTTP matrix represents all six workspace metrics families'
  );
});

for (const route of WORKSPACE_METRICS_ROUTES) {
  test(`bbx-c16-http-005.${route.id} | ${route.fn} | Scenario: Existing authorized workspace reaches its handler`, async () => {
    const workspaceBefore = registryCalls(pool, 'workspace').length;
    const tenantBefore = registryCalls(pool, 'tenant').length;
    const { value: { response } } = await withProviderProbe(() =>
      requestRoute(route, { bearer: VALID_BEARER, workspaceId: WORKSPACE_A })
    );
    const body = await response.json();

    assert.equal(response.status, 200, `existing ${route.id} target must reach its leaf handler: ${JSON.stringify(body)}`);
    assert.ok(registryCalls(pool, 'workspace').length >= workspaceBefore + 1, 'existing workspace is authoritatively resolved');
    assert.equal(registryCalls(pool, 'tenant').length, tenantBefore, 'workspace metrics must not re-probe getTenant');
  });
}

// bbx-c16-http-006 | workspace metrics fn matrix | OpenSpec #### Scenario: Foreign existing workspace remains forbidden after authoritative ownership resolution
for (const route of WORKSPACE_METRICS_ROUTES) {
  test(`bbx-c16-http-006.${route.id} | ${route.fn} | Scenario: Foreign existing workspace remains forbidden after authoritative ownership resolution`, async () => {
    const leafSqlBefore = leafSqlCalls(pool).length;
    const workspaceBefore = registryCalls(pool, 'workspace').length;
    const tenantBefore = registryCalls(pool, 'tenant').length;
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(route, { bearer: OWNER_A_BEARER, workspaceId: WORKSPACE_B })
    );
    const body = await response.json();

    assert.equal(response.status, 403, `known foreign ${route.id} target must be forbidden: ${JSON.stringify(body)}`);
    assert.equal(body.code, 'GW_FORBIDDEN');
    assertCanonicalEnvelope(body, 403, { rawTarget });
    assert.equal(registryCalls(pool, 'workspace').length, workspaceBefore + 1, 'ownership uses one authoritative workspace lookup');
    assert.equal(registryCalls(pool, 'tenant').length, tenantBefore, 'ownership guard must not re-probe getTenant');
    assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'foreign workspace denial precedes leaf SQL');
    assert.equal(providerCalls, 0, 'foreign workspace denial precedes provider work');
  });
}

// bbx-c16-http-007 | fn-observability-audit-export | OpenSpec #### Scenario: Audit-export authentication and scope precede leaf validation
for (const testCase of [
  {
    id: 'foreign-tenant',
    route: TENANT_AUDIT_EXPORT_ROUTE,
    request: { bearer: OWNER_A_BEARER, tenantId: TENANT_B },
    expectedStatus: 403,
    expectedCode: 'GW_FORBIDDEN',
    registry: 'tenant',
    expectedLookups: 0
  },
  {
    id: 'missing-tenant',
    route: TENANT_AUDIT_EXPORT_ROUTE,
    request: { bearer: VALID_BEARER, tenantId: TENANT_UNKNOWN },
    expectedStatus: 404,
    expectedCode: 'GW_TENANT_NOT_FOUND',
    registry: 'tenant',
    expectedLookups: 1
  },
  {
    id: 'foreign-workspace',
    route: WORKSPACE_AUDIT_EXPORT_ROUTE,
    request: { bearer: OWNER_A_BEARER, workspaceId: WORKSPACE_B },
    expectedStatus: 403,
    expectedCode: 'GW_FORBIDDEN',
    registry: 'workspace',
    expectedLookups: 1
  },
  {
    id: 'missing-workspace',
    route: WORKSPACE_AUDIT_EXPORT_ROUTE,
    request: { bearer: VALID_BEARER, workspaceId: WORKSPACE_UNKNOWN },
    expectedStatus: 404,
    expectedCode: 'GW_WORKSPACE_NOT_FOUND',
    registry: 'workspace',
    expectedLookups: 1
  }
]) {
  test(`bbx-c16-http-007.${testCase.id} | fn-observability-audit-export | Scenario: Audit-export authentication and scope precede leaf validation`, async () => {
    const leafSqlBefore = leafSqlCalls(pool).length;
    const registryBefore = registryCalls(pool, testCase.registry).length;
    const otherRegistry = testCase.registry === 'tenant' ? 'workspace' : 'tenant';
    const otherRegistryBefore = registryCalls(pool, otherRegistry).length;
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(testCase.route, {
        ...testCase.request,
        requestBody: { format: 'parquet', pageSize: 1 }
      })
    );
    const body = await response.json();

    assert.equal(response.status, testCase.expectedStatus, JSON.stringify(body));
    assert.equal(body.code, testCase.expectedCode, 'scope result must precede invalid C-10 format validation');
    assertCanonicalEnvelope(body, testCase.expectedStatus, { rawTarget });
    assert.equal(registryCalls(pool, testCase.registry).length, registryBefore + testCase.expectedLookups);
    assert.equal(registryCalls(pool, otherRegistry).length, otherRegistryBefore, 'scope guard must not query the other registry');
    assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'scope result must precede all leaf SQL');
    assert.equal(providerCalls, 0, 'scope result must precede provider/export work');
  });
}

// bbx-c16-http-008 | fn-storage-tenant-isolation | OpenSpec #### Scenario: Constrained caller receives the same outcome for foreign and unknown workspace
test('bbx-c16-http-008 | fn-storage-tenant-isolation | Scenario: Constrained caller receives the same outcome for foreign and unknown workspace', async () => {
  const outcomes = [];
  for (const workspaceId of [WORKSPACE_B, WORKSPACE_UNKNOWN]) {
    const sqlBefore = pool.calls.length;
    const workspaceBefore = registryCalls(pool, 'workspace').length;
    const tenantBefore = registryCalls(pool, 'tenant').length;
    const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
      requestRoute(STORAGE_ROUTE, { bearer: OWNER_A_BEARER, workspaceId })
    );
    const body = await response.json();

    assert.equal(response.status, 404, JSON.stringify(body));
    assert.equal(body.code, 'GW_WORKSPACE_NOT_FOUND');
    assertCanonicalEnvelope(body, 404, { rawTarget });
    assert.equal(registryCalls(pool, 'workspace').length, workspaceBefore + 1, 'storage ownership uses one authoritative lookup');
    assert.equal(registryCalls(pool, 'tenant').length, tenantBefore, 'storage ownership must not re-probe getTenant');
    assert.equal(pool.calls.length, sqlBefore + 1, 'opaque storage not-found precedes bucket/store SQL');
    assert.equal(providerCalls, 0, 'opaque storage not-found precedes object-store work');
    outcomes.push({
      status: body.status,
      code: body.code,
      message: body.message,
      detail: body.detail,
      resource: body.resource
    });
  }

  assert.deepEqual(outcomes[0], outcomes[1], 'foreign-existing and unknown storage targets expose the same canonical result');
});

// bbx-c16-http-009 | fn-observability-scope-guard | OpenSpec #### Scenario: Scoped error and metrics resources do not expose raw target identifiers
test('bbx-c16-http-009 | fn-observability-scope-guard | Scenario: Scoped error and metrics resources do not expose raw target identifiers', async (t) => {
  assert.equal(ROUTES.length, 13, 'security matrix must include six tenant metrics, six workspace metrics, and storage usage');

  for (const route of ROUTES) {
    await t.test(`${route.id}: unauthenticated 401 uses a safe C-02 resource before registry work`, async () => {
      const targets = route.registry === 'tenant'
        ? { tenantId: OPAQUE_TENANT_TARGET }
        : { workspaceId: OPAQUE_WORKSPACE_TARGET };
      const sqlBefore = pool.calls.length;
      const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
        requestRoute(route, targets)
      );
      const body = await response.json();

      assert.equal(response.status, 401, `${route.id}: ${JSON.stringify(body)}`);
      assertCanonicalEnvelope(body, 401);
      assert.equal(
        body.resource.path,
        route.template.replace(/\{(?:tenantId|workspaceId)\}/, '{id}'),
        `${route.id}: canonical error resource must preserve the established C-02 {id} placeholder`
      );
      assert.doesNotMatch(body.resource.path, new RegExp(escapeRegExp(rawTarget), 'i'));
      assert.equal(pool.calls.length, sqlBefore, 'authentication failure must precede registry and downstream SQL');
      assert.equal(providerCalls, 0, 'authentication failure must precede provider/object-store work');
    });
  }

  for (const route of ROUTES) {
    await t.test(`${route.id}: authenticated missing 404 uses a safe C-02 resource before downstream work`, async () => {
      const targets = route.registry === 'tenant'
        ? { tenantId: OPAQUE_TENANT_TARGET }
        : { workspaceId: OPAQUE_WORKSPACE_TARGET };
      const sqlBefore = pool.calls.length;
      const leafSqlBefore = leafSqlCalls(pool).length;
      const registryBefore = registryCalls(pool, route.registry).length;
      const otherRegistry = route.registry === 'tenant' ? 'workspace' : 'tenant';
      const otherRegistryBefore = registryCalls(pool, otherRegistry).length;
      const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
        requestRoute(route, { bearer: VALID_BEARER, ...targets })
      );
      const body = await response.json();

      assert.equal(response.status, 404, `${route.id}: ${JSON.stringify(body)}`);
      assert.equal(body.code, route.registry === 'tenant' ? 'GW_TENANT_NOT_FOUND' : 'GW_WORKSPACE_NOT_FOUND');
      assertCanonicalEnvelope(body, 404);
      assert.equal(
        body.resource.path,
        route.template.replace(/\{(?:tenantId|workspaceId)\}/, '{id}'),
        `${route.id}: canonical error resource must preserve the established C-02 {id} placeholder`
      );
      assert.doesNotMatch(body.resource.path, new RegExp(escapeRegExp(rawTarget), 'i'));
      assert.equal(registryCalls(pool, route.registry).length, registryBefore + 1, 'missing target performs one authoritative lookup');
      assert.equal(registryCalls(pool, otherRegistry).length, otherRegistryBefore, 'missing target must not probe the other registry');
      assert.equal(pool.calls.length, sqlBefore + 1, 'missing target must precede downstream SQL');
      assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'missing target must precede leaf SQL');
      assert.equal(providerCalls, 0, 'missing target must precede provider/object-store work');
    });
  }

  pool.registryFailures.tenant.add(OPAQUE_TENANT_TARGET);
  pool.registryFailures.workspace.add(OPAQUE_WORKSPACE_TARGET);
  try {
    for (const route of ROUTES) {
      await t.test(`${route.id}: authoritative registry 500 uses a safe C-02 resource before downstream work`, async () => {
        const targets = route.registry === 'tenant'
          ? { tenantId: OPAQUE_TENANT_TARGET }
          : { workspaceId: OPAQUE_WORKSPACE_TARGET };
        const sqlBefore = pool.calls.length;
        const leafSqlBefore = leafSqlCalls(pool).length;
        const registryBefore = registryCalls(pool, route.registry).length;
        const otherRegistry = route.registry === 'tenant' ? 'workspace' : 'tenant';
        const otherRegistryBefore = registryCalls(pool, otherRegistry).length;
        const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
          requestRoute(route, { bearer: VALID_BEARER, ...targets })
        );
        const body = await response.json();

        assert.equal(response.status, 500, `${route.id}: ${JSON.stringify(body)}`);
        assert.equal(body.code, 'GW_CONTROL_PLANE_ERROR');
        assertCanonicalEnvelope(body, 500);
        assert.equal(
          body.resource.path,
          route.template.replace(/\{(?:tenantId|workspaceId)\}/, '{id}'),
          `${route.id}: canonical error resource must preserve the established C-02 {id} placeholder`
        );
        assert.doesNotMatch(body.resource.path, new RegExp(escapeRegExp(rawTarget), 'i'));
        assert.equal(registryCalls(pool, route.registry).length, registryBefore + 1, 'registry failure performs one authoritative lookup');
        assert.equal(registryCalls(pool, otherRegistry).length, otherRegistryBefore, 'registry failure must not probe the other registry');
        assert.equal(pool.calls.length, sqlBefore + 1, 'registry failure must precede downstream SQL');
        assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'registry failure must precede leaf SQL');
        assert.equal(providerCalls, 0, 'registry failure must precede provider/object-store work');
      });
    }
  } finally {
    pool.registryFailures.tenant.delete(OPAQUE_TENANT_TARGET);
    pool.registryFailures.workspace.delete(OPAQUE_WORKSPACE_TARGET);
  }

  const metricsResponse = await HTTP_FETCH(`${baseUrl}/metrics`, {
    headers: { accept: 'text/plain' }
  });
  assert.equal(metricsResponse.status, 200, 'public metrics scrape must succeed');
  const metricsText = await metricsResponse.text();
  const routeSamples = prometheusRouteSamples(metricsText);
  const counterRouteSamples = routeSamples.filter(({ metric }) => metric.endsWith('_total'));
  const histogramRouteSamples = routeSamples.filter(({ metric }) => metric.endsWith('_bucket'));

  await t.test('all HTTP counter route labels use registered semantic routes without opaque targets', () => {
    assert.ok(counterRouteSamples.length > 0, 'metrics scrape must expose HTTP counter route label values');
    const leakedCounterLabels = [...new Set(counterRouteSamples
      .map(({ route }) => route)
      .filter((route) => route.includes(`/${OPAQUE_TENANT_TARGET}/`) || route.includes(`/${OPAQUE_WORKSPACE_TARGET}/`)))];
    assert.deepEqual(leakedCounterLabels, [], 'counter route label values must not expose either opaque target');
    const missingCounterTemplates = ROUTES
      .filter((route) => !counterRouteSamples.some(({ route: label }) => label === route.template))
      .map(({ template }) => template);
    assert.deepEqual(missingCounterTemplates, [], 'each scoped operation must publish its registered semantic counter route');
  });

  await t.test('all HTTP histogram route labels use registered semantic routes without opaque targets', () => {
    assert.ok(histogramRouteSamples.length > 0, 'metrics scrape must expose HTTP histogram route label values');
    const leakedHistogramLabels = [...new Set(histogramRouteSamples
      .map(({ route }) => route)
      .filter((route) => route.includes(`/${OPAQUE_TENANT_TARGET}/`) || route.includes(`/${OPAQUE_WORKSPACE_TARGET}/`)))];
    assert.deepEqual(leakedHistogramLabels, [], 'histogram route label values must not expose either opaque target');
    const missingHistogramTemplates = ROUTES
      .filter((route) => !histogramRouteSamples.some(({ route: label }) => label === route.template))
      .map(({ template }) => template);
    assert.deepEqual(missingHistogramTemplates, [], 'each scoped operation must publish its registered semantic histogram route');
  });
});

// bbx-c16-http-010 | fn-observability-scope-guard | OpenSpec #### Scenario: Constrained callers cannot distinguish foreign and unknown scoped resources
test('bbx-c16-http-010 | fn-observability-scope-guard | Scenario: Constrained callers cannot distinguish foreign and unknown scoped resources', async (t) => {
  assert.equal(TENANT_METRICS_ROUTES.length, 6, 'tenant 403 matrix must include all six tenant metrics operations');
  assert.equal(WORKSPACE_METRICS_ROUTES.length, 6, 'workspace 403 matrix must include all six workspace metrics operations');

  for (const route of TENANT_METRICS_ROUTES) {
    await t.test(`${route.id}: short foreign-existing and unknown tenants are identical opaque 403 results`, async () => {
      const outcomes = [];
      for (const tenantId of [SHORT_FOREIGN_TENANT, SHORT_UNKNOWN_TENANT]) {
        const tenantBefore = registryCalls(pool, 'tenant').length;
        const workspaceBefore = registryCalls(pool, 'workspace').length;
        const leafSqlBefore = leafSqlCalls(pool).length;
        const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
          requestRoute(route, { bearer: OWNER_A_BEARER, tenantId })
        );
        const body = await response.json();

        assert.equal(response.status, 403, `${route.id}: ${JSON.stringify(body)}`);
        assert.equal(body.code, 'GW_FORBIDDEN');
        assertCanonicalEnvelope(body, 403);
        assert.equal(body.resource.path, route.template.replace('{tenantId}', '{id}'));
        assert.doesNotMatch(body.resource.path, new RegExp(escapeRegExp(rawTarget), 'i'));
        assert.equal(registryCalls(pool, 'tenant').length, tenantBefore, 'tenant authorization denial must not probe existence');
        assert.equal(registryCalls(pool, 'workspace').length, workspaceBefore, 'tenant authorization denial must not probe workspaces');
        assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'tenant authorization denial must precede leaf SQL');
        assert.equal(providerCalls, 0, 'tenant authorization denial must precede provider/export work');
        outcomes.push({
          status: body.status,
          code: body.code,
          message: body.message,
          detail: body.detail,
          resource: body.resource
        });
      }
      assert.deepEqual(outcomes[0], outcomes[1], 'foreign-existing and unknown tenant targets must be indistinguishable');
    });
  }

  for (const route of WORKSPACE_METRICS_ROUTES) {
    await t.test(`${route.id}: short known-foreign workspace is a safe terminal 403`, async () => {
      const workspaceBefore = registryCalls(pool, 'workspace').length;
      const tenantBefore = registryCalls(pool, 'tenant').length;
      const leafSqlBefore = leafSqlCalls(pool).length;
      const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
        requestRoute(route, { bearer: OWNER_A_BEARER, workspaceId: SHORT_FOREIGN_WORKSPACE })
      );
      const body = await response.json();

      assert.equal(response.status, 403, `${route.id}: ${JSON.stringify(body)}`);
      assert.equal(body.code, 'GW_FORBIDDEN');
      assertCanonicalEnvelope(body, 403);
      assert.equal(body.resource.path, route.template.replace('{workspaceId}', '{id}'));
      assert.doesNotMatch(body.resource.path, new RegExp(escapeRegExp(rawTarget), 'i'));
      assert.equal(registryCalls(pool, 'workspace').length, workspaceBefore + 1, 'ownership uses one authoritative workspace lookup');
      assert.equal(registryCalls(pool, 'tenant').length, tenantBefore, 'workspace ownership must not re-probe the tenant registry');
      assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'workspace authorization denial must precede leaf SQL');
      assert.equal(providerCalls, 0, 'workspace authorization denial must precede provider/export work');
    });
  }

  await t.test('storage short foreign-existing and unknown workspaces are identical opaque 404 results', async () => {
    const outcomes = [];
    for (const workspaceId of [SHORT_FOREIGN_WORKSPACE, SHORT_UNKNOWN_WORKSPACE]) {
      const workspaceBefore = registryCalls(pool, 'workspace').length;
      const tenantBefore = registryCalls(pool, 'tenant').length;
      const leafSqlBefore = leafSqlCalls(pool).length;
      const { value: { response, rawTarget }, calls: providerCalls } = await withProviderProbe(() =>
        requestRoute(STORAGE_ROUTE, { bearer: OWNER_A_BEARER, workspaceId })
      );
      const body = await response.json();

      assert.equal(response.status, 404, JSON.stringify(body));
      assert.equal(body.code, 'GW_WORKSPACE_NOT_FOUND');
      assertCanonicalEnvelope(body, 404);
      assert.equal(body.resource.path, STORAGE_ROUTE.template.replace('{workspaceId}', '{id}'));
      assert.doesNotMatch(body.resource.path, new RegExp(escapeRegExp(rawTarget), 'i'));
      assert.equal(registryCalls(pool, 'workspace').length, workspaceBefore + 1, 'storage ownership uses one authoritative workspace lookup');
      assert.equal(registryCalls(pool, 'tenant').length, tenantBefore, 'storage ownership must not re-probe the tenant registry');
      assert.equal(leafSqlCalls(pool).length, leafSqlBefore, 'opaque storage result must precede bucket/store SQL');
      assert.equal(providerCalls, 0, 'opaque storage result must precede object-store work');
      outcomes.push({
        status: body.status,
        code: body.code,
        message: body.message,
        detail: body.detail,
        resource: body.resource
      });
    }
    assert.deepEqual(outcomes[0], outcomes[1], 'foreign-existing and unknown storage targets must be indistinguishable');
  });

  await t.test('outside-C16 registered route retains its concrete short-ID baseline', async () => {
    assert.ok(OPENAPI.paths['/v1/workspaces/{workspaceId}/service-accounts']?.get, 'compatibility seam must remain registered');
    const sqlBefore = pool.calls.length;
    const outsidePath = `/v1/workspaces/${OUTSIDE_C16_TARGET}/service-accounts`;
    const response = await HTTP_FETCH(`${baseUrl}${outsidePath}`, {
      headers: {
        'x-request-id': 'req-c16-outside-control',
        'x-correlation-id': 'corr-c16-outside-control'
      }
    });

    const body = await response.json();

    assert.equal(response.status, 401, JSON.stringify(body));
    assertCanonicalEnvelope(body, 401);
    assert.equal(body.resource.path, outsidePath, 'outside-C16 route must retain its concrete non-id-like baseline');
    assert.equal(body.resource.path.includes('{workspaceId}'), false, 'C16 semantic override must not widen to unrelated routes');
    assert.equal(pool.calls.length, sqlBefore, 'outside-C16 authentication control must precede store work');
  });

  const metricsResponse = await HTTP_FETCH(`${baseUrl}/metrics`, {
    headers: { accept: 'text/plain' }
  });
  assert.equal(metricsResponse.status, 200, 'public metrics scrape must succeed after the complete 403/404 corpus');
  const routeSamples = prometheusRouteSamples(await metricsResponse.text());
  const counterRouteSamples = routeSamples.filter(({ metric }) => metric.endsWith('_total'));
  const histogramRouteSamples = routeSamples.filter(({ metric }) => metric.endsWith('_bucket'));
  const registeredC16Templates = new Set(ROUTES.map(({ template }) => template));
  const shortTargets = [
    OPAQUE_TENANT_TARGET,
    OPAQUE_WORKSPACE_TARGET,
    SHORT_FOREIGN_TENANT,
    SHORT_UNKNOWN_TENANT,
    SHORT_FOREIGN_WORKSPACE,
    SHORT_UNKNOWN_WORKSPACE
  ];
  const isC16ScopedLabel = (label) =>
    label.startsWith('/v1/metrics/tenants/')
    || label.startsWith('/v1/metrics/workspaces/')
    || label.startsWith('/v1/storage/workspaces/');

  for (const [kind, samples] of [['counter', counterRouteSamples], ['histogram', histogramRouteSamples]]) {
    await t.test(`final ${kind} route labels contain only the 13 registered templates`, () => {
      assert.ok(samples.length > 0, `${kind} route samples must be exposed`);
      const scopedLabels = [...new Set(samples.map(({ route }) => route).filter(isC16ScopedLabel))];
      const leakedLabels = scopedLabels.filter((label) =>
        shortTargets.some((target) => label.includes(`/${target}/`))
      );
      assert.deepEqual(leakedLabels, [], `${kind} labels must not expose any short target`);
      assert.deepEqual(
        scopedLabels.filter((label) => !registeredC16Templates.has(label)),
        [],
        `${kind} scoped labels must be bounded to registered C16 templates`
      );
      assert.deepEqual(
        [...registeredC16Templates].filter((template) => !scopedLabels.includes(template)),
        [],
        `${kind} labels must cover every registered C16 template`
      );
      assert.ok(samples.some(({ route }) => route === `/v1/workspaces/${OUTSIDE_C16_TARGET}/service-accounts`), `${kind} compatibility route must retain its concrete baseline`);
      assert.equal(samples.some(({ route }) => route === '/v1/workspaces/{workspaceId}/service-accounts'), false, `${kind} compatibility route must not receive a C16 semantic override`);
    });
  }
});
