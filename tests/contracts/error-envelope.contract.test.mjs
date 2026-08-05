import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const canonical = JSON.parse(
  readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8')
).components.schemas;
const workspaceTemplate = JSON.parse(
  readFileSync('packages/openapi-sdk-service/src/capability-modules/base-template.openapi.json', 'utf8')
).components.schemas;

test('workspace SDK template uses the exact canonical ErrorResponse contract', () => {
  for (const schemaName of ['ErrorResponse', 'ErrorDetail', 'ErrorResource']) {
    assert.deepEqual(
      workspaceTemplate[schemaName],
      canonical[schemaName],
      `${schemaName} must not drift between the public control API and generated workspace SDKs`
    );
  }
});

test('canonical ErrorResponse remains closed and correlation-safe', () => {
  assert.equal(canonical.ErrorResponse.additionalProperties, false);
  assert.deepEqual(canonical.ErrorResponse.required, [
    'status', 'code', 'message', 'detail', 'requestId', 'correlationId', 'timestamp', 'resource'
  ]);
  assert.equal(canonical.ErrorResponse.properties.code.pattern, '^GW_[A-Z0-9_]+$');
  assert.equal(canonical.ErrorResponse.properties.requestId.minLength, 8);
  assert.equal(canonical.ErrorResponse.properties.requestId.maxLength, 128);
  assert.equal(canonical.ErrorResponse.properties.correlationId.pattern, '^[A-Za-z0-9._:-]{8,128}$');
  assert.equal(canonical.ErrorResponse.properties.detail.$ref, '#/components/schemas/ErrorDetail');
  assert.equal(canonical.ErrorResponse.properties.resource.$ref, '#/components/schemas/ErrorResource');
  assert.deepEqual(canonical.ErrorResource.required, ['path']);
});

test('Ajv accepts a canonical envelope and rejects the legacy shape', () => {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    formats: {
      'date-time': (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
    }
  });
  const errorResponse = JSON.parse(
    JSON.stringify(canonical.ErrorResponse).replaceAll('#/components/schemas/', '#/$defs/')
  );
  const validate = ajv.compile({
    $ref: '#/$defs/ErrorResponse',
    $defs: {
      ErrorResponse: errorResponse,
      ErrorDetail: canonical.ErrorDetail,
      ErrorResource: canonical.ErrorResource
    }
  });
  const example = {
    status: 404,
    code: 'GW_NOT_FOUND',
    message: 'Resource not found',
    detail: { reason: 'NOT_FOUND' },
    requestId: 'request-contract-001',
    correlationId: 'correlation-contract-001',
    timestamp: '2026-08-05T00:00:00.000Z',
    resource: { path: '/v1/resources/{id}' }
  };
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(validate({ code: 'NO_ROUTE', message: 'No route' }), false);
  assert.ok(validate.errors?.some((entry) => entry.keyword === 'required'));
});
