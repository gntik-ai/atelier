import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH, resolveParameters } from '../../scripts/lib/quality-gates.mjs';

test('workspace secret OpenAPI contract exposes governed secret routes and write-only secret values', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const listSecrets = document.paths['/v1/functions/workspaces/{workspaceId}/secrets'].get;
  const createSecret = document.paths['/v1/functions/workspaces/{workspaceId}/secrets'].post;
  const getSecret = document.paths['/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'].get;
  const updateSecret = document.paths['/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'].put;
  const deleteSecret = document.paths['/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'].delete;

  for (const operation of [listSecrets, createSecret, getSecret, updateSecret, deleteSecret]) {
    assert.ok(operation);
    assert.equal(operation['x-resource-type'], 'function_workspace_secret');
  }

  assert.equal(document.components.schemas.FunctionWorkspaceSecretWriteRequest.properties.secretValue.writeOnly, true);
  assert.equal(Object.hasOwn(document.components.schemas.FunctionWorkspaceSecret.properties, 'secretValue'), false);
  assert.equal(createSecret.responses['201'].content['application/json'].schema.type, 'object');
  assert.equal(Object.hasOwn(createSecret.responses['201'].content['application/json'].schema.properties, 'secretValue'), false);
  assert.equal(resolveParameters(document, createSecret).some((parameter) => parameter.name === 'workspaceId'), true);
  assert.equal(resolveParameters(document, updateSecret).some((parameter) => parameter.name === 'workspaceId'), true);
  assert.equal(resolveParameters(document, deleteSecret).some((parameter) => parameter.name === 'workspaceId'), true);

  const allResponseSchemas = JSON.stringify({
    listSecrets: listSecrets.responses,
    createSecret: createSecret.responses,
    getSecret: getSecret.responses,
    updateSecret: updateSecret.responses,
    deleteSecret: deleteSecret.responses,
    schemas: document.components.schemas.FunctionWorkspaceSecret
  });
  assert.equal(allResponseSchemas.includes('secretValue'), false);
});

test('workspace secret routes are discoverable through the generated public route catalog', () => {
  const listSecrets = getPublicRoute('listFunctionWorkspaceSecrets');
  const createSecret = getPublicRoute('createFunctionWorkspaceSecret');
  const getSecret = getPublicRoute('getFunctionWorkspaceSecret');
  const updateSecret = getPublicRoute('updateFunctionWorkspaceSecret');
  const deleteSecret = getPublicRoute('deleteFunctionWorkspaceSecret');

  assert.equal(listSecrets.path, '/v1/functions/workspaces/{workspaceId}/secrets');
  assert.equal(createSecret.path, '/v1/functions/workspaces/{workspaceId}/secrets');
  assert.equal(getSecret.path, '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}');
  assert.equal(updateSecret.path, '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}');
  assert.equal(deleteSecret.path, '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}');
  assert.equal(createSecret.supportsIdempotencyKey, true);
  assert.equal(updateSecret.supportsIdempotencyKey, true);
  assert.equal(listSecrets.resourceType, 'function_workspace_secret');
  assert.equal(getSecret.resourceType, 'function_workspace_secret');
});
