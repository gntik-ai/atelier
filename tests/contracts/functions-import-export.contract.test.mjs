import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { getContextPropagationTarget, getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH, resolveParameters } from '../../scripts/lib/quality-gates.mjs';

test('functions import-export OpenAPI contract exposes bounded export and import routes', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const exportAction = document.paths['/v1/functions/actions/{resourceId}/definition-export'].get;
  const exportPackage = document.paths['/v1/functions/workspaces/{workspaceId}/packages/{packageName}/definition-export'].get;
  const importAction = document.paths['/v1/functions/workspaces/{workspaceId}/definition-imports'].post;
  const importPackage = document.paths['/v1/functions/workspaces/{workspaceId}/package-definition-imports'].post;

  assert.ok(exportAction);
  assert.ok(exportPackage);
  assert.ok(importAction);
  assert.ok(importPackage);

  assert.equal(exportAction['x-resource-type'], 'function_definition_export');
  assert.equal(importAction['x-resource-type'], 'function_definition_import');
  assert.ok(importAction.responses['409'].content['application/json'].schema);
  assert.ok(importAction.responses['422'].content['application/json'].schema);
  assert.ok(document.components.schemas.FunctionDefinitionExportBundle);
  assert.ok(document.components.schemas.FunctionDefinitionImportRequest);
  assert.equal(document.components.schemas.FunctionDefinitionResource.properties.visibility.enum.includes('public'), true);

  const importParameters = resolveParameters(document, importAction);
  assert.equal(importParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(importParameters.some((parameter) => parameter.name === 'workspaceId'), true);
});

test('functions import-export routes are discoverable and authorization propagation stays explicit', () => {
  const exportRoute = getPublicRoute('exportFunctionDefinition');
  const importRoute = getPublicRoute('importFunctionDefinition');
  const projection = getContextPropagationTarget('definition_import_context');

  assert.equal(exportRoute.path, '/v1/functions/actions/{resourceId}/definition-export');
  assert.equal(exportRoute.resourceType, 'function_definition_export');
  assert.equal(importRoute.path, '/v1/functions/workspaces/{workspaceId}/definition-imports');
  assert.equal(importRoute.resourceType, 'function_definition_import');
  assert.equal(importRoute.requiredHeaders.includes('Idempotency-Key'), true);
  assert.ok(projection);
  assert.equal(projection.required_fields.includes('visibility_policy'), true);
  assert.equal(projection.required_fields.includes('import_operation'), true);
});
