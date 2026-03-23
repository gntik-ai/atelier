import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { OPENAPI_PATH, collectContractViolations } from '../../scripts/lib/quality-gates.mjs';

test('control-plane OpenAPI document remains structurally valid', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/health']);
  assert.ok(document.paths['/v1/tenants/{tenantId}']);
});

test('control-plane contract enforces versioning and error-contract expectations', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  assert.deepEqual(collectContractViolations(document), []);
});
