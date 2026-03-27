import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH, resolveParameters } from '../../scripts/lib/quality-gates.mjs';

test('functions versioning OpenAPI contract exposes lifecycle version and rollback routes', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const listVersions = document.paths['/v1/functions/actions/{resourceId}/versions'].get;
  const getVersion = document.paths['/v1/functions/actions/{resourceId}/versions/{versionId}'].get;
  const rollback = document.paths['/v1/functions/actions/{resourceId}/rollback'].post;
  const listVersionsParameters = resolveParameters(document, listVersions);
  const getVersionParameters = resolveParameters(document, getVersion);
  const rollbackParameters = resolveParameters(document, rollback);

  assert.ok(listVersions);
  assert.ok(getVersion);
  assert.ok(rollback);

  assert.equal(listVersions['x-resource-type'], 'function_version');
  assert.equal(getVersion['x-resource-type'], 'function_version');
  assert.equal(rollback['x-resource-type'], 'function_rollback');
  assert.equal(listVersionsParameters.some((parameter) => parameter.name === 'resourceId'), true);
  assert.equal(getVersionParameters.some((parameter) => parameter.name === 'versionId'), true);
  assert.equal(rollbackParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(rollbackParameters.some((parameter) => parameter.name === 'resourceId'), true);
  assert.ok(rollback.responses['202'].content['application/json'].schema.properties.requestedVersionId);
  assert.ok(rollback.requestBody.content['application/json'].schema.properties.versionId);

  assert.ok(document.components.schemas.FunctionVersion);
  assert.ok(document.components.schemas.FunctionVersionCollection);
  assert.ok(document.components.schemas.FunctionRollbackWriteRequest);
  assert.ok(document.components.schemas.FunctionRollbackAccepted);
  assert.ok(document.components.schemas.FunctionAction.properties.activeVersionId);
  assert.ok(document.components.schemas.FunctionAction.properties.versionCount);
  assert.ok(document.components.schemas.FunctionAction.properties.rollbackAvailable);
});

test('functions versioning routes are discoverable through the generated public route catalog', () => {
  const listVersions = getPublicRoute('listFunctionVersions');
  const getVersion = getPublicRoute('getFunctionVersion');
  const rollback = getPublicRoute('rollbackFunctionAction');

  assert.equal(listVersions.family, 'functions');
  assert.equal(listVersions.path, '/v1/functions/actions/{resourceId}/versions');
  assert.equal(listVersions.resourceType, 'function_version');
  assert.equal(listVersions.requiredHeaders.includes('X-API-Version'), true);

  assert.equal(getVersion.family, 'functions');
  assert.equal(getVersion.path, '/v1/functions/actions/{resourceId}/versions/{versionId}');
  assert.equal(getVersion.resourceType, 'function_version');

  assert.equal(rollback.family, 'functions');
  assert.equal(rollback.path, '/v1/functions/actions/{resourceId}/rollback');
  assert.equal(rollback.resourceType, 'function_rollback');
  assert.equal(rollback.supportsIdempotencyKey, true);
  assert.equal(rollback.requiredHeaders.includes('Idempotency-Key'), true);
});
