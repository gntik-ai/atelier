import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import Ajv from 'ajv';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';

const OPENAPI_PATH = 'apps/control-plane-executor/openapi/control-plane.openapi.json';
const document = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'));
const operation = document.paths['/v1/metrics/workspaces/{workspaceId}/series'].get;
const responseSchema = document.components.schemas.MetricSeriesResponse;
const validateResponse = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false
}).compile(responseSchema);

function parameter(name) {
  return operation.parameters.find((entry) => entry.name === name);
}

function context(fetchImpl) {
  return {
    params: { workspaceId: 'wrk_a' },
    query: { metricKey: 'api_requests', window: '24h' },
    identity: {
      sub: 'owner-a',
      tenantId: 'ten_a',
      actorType: 'tenant_owner',
      roles: ['tenant_owner'],
      scopes: []
    },
    pool: {
      async query() {
        return { rows: [{ id: 'wrk_a', tenant_id: 'ten_a' }] };
      }
    },
    fetchImpl,
    nowMs: () => 1700001000000,
    metric: {}
  };
}

function provider(payload, { ok = true } = {}) {
  return async () => ({
    ok,
    async json() {
      return payload;
    }
  });
}

function assertValidResponse(body) {
  assert.equal(validateResponse(body), true, JSON.stringify(validateResponse.errors));
  assert.deepEqual(
    Object.keys(body).sort(),
    ['metricKey', 'points', 'tenantId', 'unit', 'window', 'workspaceId']
  );
  assert.equal('source' in body, false);
}

test('canonical workspace operation publishes the exact required key and window enums', () => {
  assert.equal(parameter('metricKey').required, true);
  assert.deepEqual(parameter('metricKey').schema.enum, ['api_requests', 'api_errors']);
  assert.equal(parameter('window').required, true);
  assert.deepEqual(parameter('window').schema.enum, ['5m', '1h', '24h', '7d', '30d']);
  assert.equal(
    operation.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/MetricSeriesResponse'
  );
  assert.equal(operation.responses['400'].content['application/json'].schema.$ref, '#/components/schemas/ErrorResponse');
});

test('MetricSeriesResponse is closed and constrains identifiers, enums, and point objects', () => {
  assert.equal(responseSchema.additionalProperties, false);
  assert.deepEqual(
    responseSchema.required,
    ['tenantId', 'workspaceId', 'metricKey', 'window', 'points']
  );
  assert.deepEqual(responseSchema.properties.metricKey.enum, ['api_requests', 'api_errors']);
  assert.deepEqual(responseSchema.properties.window.enum, ['5m', '1h', '24h', '7d', '30d']);
  assert.equal(responseSchema.properties.points.items.additionalProperties, false);
  assert.deepEqual(responseSchema.properties.points.items.required, ['timestamp', 'value']);
});

test('real handler success and every degradation class validate against MetricSeriesResponse', async () => {
  const success = await METRICS_HANDLERS.metricsWorkspaceSeries(context(provider({
    status: 'success',
    data: { result: [{ values: [[1700000000, '1.5']] }] }
  })));
  assert.equal(success.statusCode, 200);
  assertValidResponse(success.body);
  assert.deepEqual(success.body.points, [
    { timestamp: '2023-11-14T22:13:20.000Z', value: 1.5 }
  ]);

  const degradations = [
    async () => {
      throw new Error('unreachable');
    },
    provider({}, { ok: false }),
    async () => ({ ok: true, async json() { throw new SyntaxError('bad JSON'); } }),
    provider({ status: 'error' }),
    provider({ status: 'success', data: {} }),
    provider({ status: 'success', data: { result: [{ values: [['bad-time', 'NaN']] }] } })
  ];

  for (const fetchImpl of degradations) {
    const result = await METRICS_HANDLERS.metricsWorkspaceSeries(context(fetchImpl));
    assert.equal(result.statusCode, 200);
    assertValidResponse(result.body);
    assert.deepEqual(result.body.points, []);
  }
});

test('response schema rejects source and fabricated or malformed points', () => {
  const base = {
    tenantId: 'ten_a',
    workspaceId: 'wrk_a',
    metricKey: 'api_requests',
    window: '24h',
    points: []
  };
  assert.equal(validateResponse({ ...base, source: 'prometheus' }), false);
  assert.equal(validateResponse({ ...base, points: [{ timestamp: 'now', value: '0' }] }), false);
  assert.equal(validateResponse({ ...base, metricKey: 'storage_bytes' }), false);
});
