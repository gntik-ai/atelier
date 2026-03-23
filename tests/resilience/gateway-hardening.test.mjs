import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import { readGatewayPolicyValues } from '../../scripts/lib/gateway-policy.mjs';
import { readPublicRouteCatalog } from '../../scripts/lib/public-api.mjs';
import { readTestingStrategy, readReferenceDataset } from '../../scripts/lib/testing-strategy.mjs';

const document = readJson(OPENAPI_PATH);
const values = readGatewayPolicyValues();
const routeCatalog = readPublicRouteCatalog();
const strategy = readTestingStrategy();
const dataset = readReferenceDataset();

test('gateway hardening contract covers QoS, uniform errors, idempotency, and correlation propagation', () => {
  for (const route of routeCatalog.routes) {
    assert.equal(typeof route.gatewayQosProfile, 'string');
    assert.equal(typeof route.gatewayRequestValidationProfile, 'string');
    assert.equal(route.errorEnvelope, 'ErrorResponse');
    assert.equal(route.correlationIdRequired, true);
    assert.equal(route.correlationIdGeneratedWhenMissing, true);
    assert.equal(route.internalRequestMode, 'validated_attestation');
    assert.ok(route.maxRequestBodyBytes > 0);

    if (route.supportsIdempotencyKey) {
      assert.equal(route.idempotencyReplayHeader, 'X-Idempotency-Replayed');
      assert.equal(route.idempotencyTtlSeconds, 86400);
    }
  }

  assert.equal(values.gatewayPolicy.correlation.generateWhenMissing, true);
  assert.deepEqual(values.gatewayPolicy.errorEnvelope.requiredFields, [
    'status',
    'code',
    'message',
    'detail',
    'requestId',
    'correlationId',
    'timestamp',
    'resource'
  ]);
});

test('openapi exposes gateway resilience responses for public operations', () => {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (path === '/health') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      assert.ok(operation.responses['429'], `${method.toUpperCase()} ${path} missing 429`);
      assert.ok(operation.responses['431'], `${method.toUpperCase()} ${path} missing 431`);
      assert.ok(operation.responses['504'], `${method.toUpperCase()} ${path} missing 504`);

      if (operation.requestBody || ['post', 'put', 'patch', 'delete'].includes(method)) {
        assert.ok(operation.responses['413'], `${method.toUpperCase()} ${path} missing 413`);
      }
    }
  }
});

test('reference testing strategy includes resilience fixtures for invalid headers, oversized bodies, and idempotent retry', () => {
  const scenarioIds = new Set(strategy.cross_domain_matrix.scenarios.map((scenario) => scenario.id));
  const fixtureIds = new Set(dataset.resilience_cases.map((entry) => entry.id));

  for (const scenarioId of ['RS-EVT-002', 'RS-SEC-002', 'RS-DAT-002']) {
    assert.equal(scenarioIds.has(scenarioId), true, `missing scenario ${scenarioId}`);
  }

  for (const fixtureId of ['resilience-invalid-headers', 'resilience-oversized-body', 'resilience-idempotent-retry']) {
    assert.equal(fixtureIds.has(fixtureId), true, `missing resilience fixture ${fixtureId}`);
  }
});
