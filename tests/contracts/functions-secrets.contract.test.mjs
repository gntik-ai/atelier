import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH, resolveParameters } from '../../scripts/lib/quality-gates.mjs';

test('functions OpenAPI contract extends action schemas with workspace secret references', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const actionSchema = document.components.schemas.FunctionAction;
  const actionWriteSchema = document.components.schemas.FunctionActionWriteRequest;
  const createSecret = document.paths['/v1/functions/workspaces/{workspaceId}/secrets'].post;
  const updateSecret = document.paths['/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'].put;

  assert.equal(actionSchema.properties.secretReferences.type, 'array');
  assert.equal(actionSchema.properties.unresolvedSecretRefs.type, 'integer');
  assert.equal(actionWriteSchema.properties.secretReferences.type, 'array');
  assert.equal(document.paths['/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'].put.operationId, 'updateFunctionWorkspaceSecret');
  assert.equal(resolveParameters(document, createSecret).some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(resolveParameters(document, updateSecret).some((parameter) => parameter.name === 'Idempotency-Key'), true);
});

test('function secret routes are discoverable through the generated public route catalog', () => {
  const createSecret = getPublicRoute('createFunctionWorkspaceSecret');
  const updateSecret = getPublicRoute('updateFunctionWorkspaceSecret');

  assert.equal(createSecret.supportsIdempotencyKey, true);
  assert.equal(updateSecret.supportsIdempotencyKey, true);
  assert.equal(createSecret.requiredHeaders.includes('Idempotency-Key'), true);
  assert.equal(updateSecret.requiredHeaders.includes('Idempotency-Key'), true);
});
