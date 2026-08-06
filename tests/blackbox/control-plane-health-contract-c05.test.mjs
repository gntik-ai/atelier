import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createControlPlaneHttpServer } from '../../apps/control-plane/server.mjs';

const HEALTH_CONTRACT = JSON.parse(await readFile(
  new URL('../../packages/internal-contracts/src/observability-health-checks.json', import.meta.url),
  'utf8'
));

const CANONICAL_COMPONENT_IDS = HEALTH_CONTRACT.components.map(({ id }) => id).sort();
const REQUIRED_COMPONENT_FIELDS = HEALTH_CONTRACT.response_contracts.component_probe_result.required_fields;
const REQUIRED_ROLLUP_FIELDS = HEALTH_CONTRACT.response_contracts.platform_probe_rollup.required_fields;
const ALLOWED_STATUSES = Object.fromEntries(
  HEALTH_CONTRACT.probe_types.map(({ id, allowed_statuses: statuses }) => [id, new Set(statuses)])
);

function successfulQuery() {
  return { rows: [{ value: 1 }], rowCount: 1 };
}

async function startFixture(t, { query = successfulQuery, schemaReadiness } = {}) {
  const queries = [];
  const pool = {
    async query(...args) {
      queries.push(args);
      return query(...args);
    }
  };
  const jwtVerifier = {
    async verify() {
      return { sub: 'blackbox-health-probe' };
    }
  };
  const server = createControlPlaneHttpServer({
    pool,
    jwtVerifier,
    logger: { error() {} },
    port: 0,
    ...(schemaReadiness ? { schemaReadiness } : {})
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  return {
    server,
    queries,
    origin: `http://127.0.0.1:${server.address().port}`
  };
}

async function requestJson(fixture, path, { method = 'GET', correlationId } = {}) {
  const headers = { accept: 'application/json', connection: 'close' };
  if (correlationId) headers['x-correlation-id'] = correlationId;
  const response = await fetch(`${fixture.origin}${path}`, { method, headers });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    assert.fail(`${method} ${path} did not return JSON: ${text}`);
  }
  return { response, body, text };
}

function assertIsoTimestamp(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, `${label} must be UTC ISO-8601`);
  assert.equal(Number.isNaN(Date.parse(value)), false, `${label} must be a valid timestamp`);
}

function assertCorrelation(response, body, expected) {
  const header = response.headers.get('x-correlation-id');
  assert.equal(typeof body.correlation_id, 'string');
  assert.ok(body.correlation_id.length > 0);
  assert.equal(header, body.correlation_id);
  if (expected) assert.equal(body.correlation_id, expected);
}

function assertComponentResult(result, probeType) {
  for (const field of REQUIRED_COMPONENT_FIELDS) {
    assert.ok(Object.hasOwn(result, field), `component ${result.component_id ?? '<missing>'} lacks ${field}`);
  }
  assert.equal(result.probe_type, probeType);
  assert.ok(ALLOWED_STATUSES[probeType].has(result.status), `${result.status} is invalid for ${probeType}`);
  assertIsoTimestamp(result.observed_at, `${result.component_id}.observed_at`);
  assert.equal(typeof result.summary, 'string');
  assert.equal(typeof result.correlation_id, 'string');
  assert.ok(result.correlation_id.length > 0);
  assert.equal(typeof result.evidence_freshness_seconds, 'number');
  assert.ok(Number.isFinite(result.evidence_freshness_seconds));
  assert.ok(result.evidence_freshness_seconds >= 0);
}

function assertRollup(result, probeType) {
  for (const field of REQUIRED_ROLLUP_FIELDS) {
    assert.ok(Object.hasOwn(result, field), `rollup lacks ${field}`);
  }
  assert.equal(result.probe_type, probeType);
  assert.ok(ALLOWED_STATUSES[probeType].has(result.status), `${result.status} is invalid for ${probeType}`);
  assertIsoTimestamp(result.observed_at, 'rollup.observed_at');
  assert.ok(Array.isArray(result.component_results));
  assert.equal(result.component_results.length, CANONICAL_COMPONENT_IDS.length);
  assert.deepEqual(result.component_results.map(({ component_id: id }) => id).sort(), CANONICAL_COMPONENT_IDS);
  for (const component of result.component_results) assertComponentResult(component, probeType);
}

// bbx-c05-001 | fn-observability-health-runtime | OpenSpec #### Scenario: Liveness is process-only
test('C-05 /livez remains process-only and the same listener survives PostgreSQL failure', async (t) => {
  const databaseFailure = new Error('postgresql://admin:raw-password@private-db/falcone SELECT secret');
  const fixture = await startFixture(t, { query: async () => { throw databaseFailure; } });
  const pid = process.pid;
  const listenerAddress = fixture.server.address();

  const first = await requestJson(fixture, '/livez');
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.deepEqual(first.body, { status: 'live' });
  assert.ok(first.response.headers.get('x-correlation-id'));
  assert.equal(fixture.queries.length, 0, 'liveness must not query PostgreSQL');

  const second = await requestJson(fixture, '/livez');
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.body, { status: 'live' });
  assert.ok(second.response.headers.get('x-correlation-id'));
  assert.equal(process.pid, pid);
  assert.deepEqual(fixture.server.address(), listenerAddress);
  assert.equal(fixture.queries.length, 0, 'repeated liveness must remain process-only');
});

// bbx-c05-002 | fn-observability-health-runtime | OpenSpec #### Scenario: Canonical routes are reachable
test('C-05 aggregate live, ready, and health routes expose the seven-component contract', async (t) => {
  const fixture = await startFixture(t);
  const routes = [
    ['/internal/live', 'liveness'],
    ['/internal/ready', 'readiness'],
    ['/internal/health', 'health']
  ];

  for (const [path, probeType] of routes) {
    const { response, body } = await requestJson(fixture, path);
    assert.equal(response.status, 200, `${path} must be reachable`);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assertRollup(body, probeType);
    assertCorrelation(response, body);
  }
});

// bbx-c05-003 | fn-observability-health-runtime | OpenSpec #### Scenario: Missing optional component adapter; #### Scenario: Correlated read-only audit
test('C-05 component routes distinguish process, PostgreSQL, and unavailable adapters', async (t) => {
  const fixture = await startFixture(t);
  const propagatedCorrelation = 'bbx-c05-client-correlation-003';

  const controlPlaneLive = await requestJson(fixture, '/internal/live/components/control_plane', {
    correlationId: propagatedCorrelation
  });
  assert.equal(controlPlaneLive.response.status, 200);
  assertComponentResult(controlPlaneLive.body, 'liveness');
  assert.equal(controlPlaneLive.body.component_id, 'control_plane');
  assert.equal(controlPlaneLive.body.status, 'live');
  assertCorrelation(controlPlaneLive.response, controlPlaneLive.body, propagatedCorrelation);
  assert.equal(fixture.queries.length, 0, 'control-plane liveness must not touch PostgreSQL');

  for (const [path, probeType] of [
    ['/internal/ready/components/control_plane', 'readiness'],
    ['/internal/health/components/control_plane', 'health'],
    ['/internal/live/components/postgresql', 'liveness']
  ]) {
    const { response, body } = await requestJson(fixture, path);
    assert.equal(response.status, 200, `${path} must be reachable`);
    assertComponentResult(body, probeType);
    assertCorrelation(response, body);
  }

  for (const [path, probeType, expectedStatus] of [
    ['/internal/ready/components/postgresql', 'readiness', 'ready'],
    ['/internal/health/components/postgresql', 'health', 'healthy']
  ]) {
    const before = fixture.queries.length;
    const { response, body } = await requestJson(fixture, path);
    assert.equal(response.status, 200);
    assertComponentResult(body, probeType);
    assert.equal(body.component_id, 'postgresql');
    assert.equal(body.status, expectedStatus);
    assertCorrelation(response, body);
    assert.ok(fixture.queries.length > before, `${path} must evaluate PostgreSQL`);
  }

  for (const [path, probeType] of [
    ['/internal/live/components/kafka', 'liveness'],
    ['/internal/ready/components/kafka', 'readiness'],
    ['/internal/health/components/kafka', 'health']
  ]) {
    const { response, body } = await requestJson(fixture, path);
    assert.equal(response.status, 200);
    assertComponentResult(body, probeType);
    assert.equal(body.component_id, 'kafka');
    assert.equal(body.status, 'unknown', `${path} must not fabricate healthy/ready evidence`);
    assertCorrelation(response, body);
  }
});

// bbx-c05-004 | fn-observability-health-runtime | OpenSpec #### Scenario: Required dependency failure; #### Scenario: Sanitized response
test('C-05 PostgreSQL failure is fail-closed while process liveness stays live', async (t) => {
  const rawFailure = [
    'postgresql://operator:super-secret@db.internal.example/falcone',
    'SELECT password, token FROM private_credentials'
  ].join(' ');
  const fixture = await startFixture(t, { query: async () => { throw new Error(rawFailure); } });

  const live = await requestJson(fixture, '/livez');
  assert.equal(live.response.status, 200);
  assert.deepEqual(live.body, { status: 'live' });
  assert.equal(fixture.queries.length, 0);

  const legacyReady = await requestJson(fixture, '/readyz');
  assert.equal(legacyReady.response.status, 503);

  for (const [path, probeType, expectedStatus] of [
    ['/internal/ready', 'readiness', 'not_ready'],
    ['/internal/health', 'health', 'unavailable']
  ]) {
    const { response, body, text } = await requestJson(fixture, path);
    assert.equal(response.status, 200, 'internal operational responses use domain status in JSON');
    assertRollup(body, probeType);
    assert.equal(body.status, expectedStatus);
    const postgresql = body.component_results.find(({ component_id: id }) => id === 'postgresql');
    assert.ok(postgresql);
    assert.equal(postgresql.status, expectedStatus);
    for (const forbidden of ['super-secret', 'db.internal.example', 'SELECT password', 'private_credentials']) {
      assert.equal(text.includes(forbidden), false, `response leaked ${forbidden}`);
    }
  }
});

// bbx-c05-005 | fn-observability-health-runtime | OpenSpec #### Scenario: Sanitized response
test('C-05 unknown component IDs return stable sanitized 404 responses without identifier cardinality', async (t) => {
  const fixture = await startFixture(t);
  const arbitraryIds = [
    'tenant-a-secret-resource-123456',
    'tenant-b-secret-resource-987654'
  ];
  const errors = [];

  for (const arbitraryId of arbitraryIds) {
    const result = await requestJson(fixture, `/internal/health/components/${arbitraryId}`, {
      correlationId: 'bbx-c05-stable-not-found'
    });
    assert.equal(result.response.status, 404);
    assert.equal(result.text.includes(arbitraryId), false, 'response must not reflect an arbitrary component ID');
    assert.equal(result.body.resource?.path?.includes(arbitraryId) ?? false, false);
    assert.equal(typeof result.body.code, 'string');
    assert.equal(typeof result.body.message, 'string');
    errors.push(result.body);
  }

  assert.equal(errors[0].status, errors[1].status);
  assert.equal(errors[0].code, errors[1].code);
  assert.equal(errors[0].message, errors[1].message);

  const shortCorrelation = await requestJson(fixture, '/internal/health/components/no-such-component', {
    correlationId: 'a'
  });
  const headerCorrelation = shortCorrelation.response.headers.get('x-correlation-id');
  assert.notEqual(headerCorrelation, 'a');
  assert.equal(shortCorrelation.body.correlationId, headerCorrelation);
});

// bbx-c05-006 | fn-observability-health-runtime | OpenSpec #### Scenario: Canonical routes are reachable
test('C-05 legacy healthz and readyz retain database and schema-readiness semantics', async (t) => {
  const healthy = await startFixture(t);
  const health = await requestJson(healthy, '/healthz');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { status: 'ok' });
  assert.ok(healthy.queries.length > 0, '/healthz must retain its database liveness check');

  const ready = await requestJson(healthy, '/readyz');
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { status: 'ok' });

  let schemaReady = false;
  const schemaReadiness = {
    isReady: () => schemaReady,
    responseForReadyProbe: () => schemaReady ? null : {
      statusCode: 503,
      body: { status: 'schema_not_ready' }
    },
    responseForMappedRoute: () => schemaReady ? null : {
      statusCode: 503,
      body: { status: 'schema_not_ready' }
    }
  };
  const gated = await startFixture(t, { schemaReadiness });
  const healthWhileGated = await requestJson(gated, '/healthz');
  assert.equal(healthWhileGated.response.status, 200, 'schema bootstrap must not redefine database liveness');
  const notReady = await requestJson(gated, '/readyz');
  assert.equal(notReady.response.status, 503);
  schemaReady = true;
  const readyAfterBootstrap = await requestJson(gated, '/readyz');
  assert.equal(readyAfterBootstrap.response.status, 200);
  assert.deepEqual(readyAfterBootstrap.body, { status: 'ok' });
});

// bbx-c05-007 | fn-observability-health-runtime | OpenSpec #### Scenario: Canonical routes are reachable
test('C-05 probe routes never serve non-GET requests as successful probes', async (t) => {
  const fixture = await startFixture(t);
  const paths = [
    '/livez',
    '/readyz',
    '/healthz',
    '/internal/live',
    '/internal/ready',
    '/internal/health',
    '/internal/live/components/control_plane',
    '/internal/ready/components/postgresql',
    '/internal/health/components/kafka'
  ];

  for (const path of paths) {
    const { response } = await requestJson(fixture, path, { method: 'POST' });
    assert.equal(response.status >= 200 && response.status < 300, false, `POST ${path} must not succeed`);
  }
});
