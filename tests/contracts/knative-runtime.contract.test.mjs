import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(readFileSync(new URL(
  '../../apps/control-plane-executor/openapi/control-plane.openapi.json', import.meta.url,
), 'utf8'));
const platform = JSON.parse(readFileSync(new URL(
  '../../apps/control-plane-executor/openapi/families/platform.openapi.json', import.meta.url,
), 'utf8'));
const functions = JSON.parse(readFileSync(new URL(
  '../../apps/control-plane-executor/openapi/families/functions.openapi.json', import.meta.url,
), 'utf8'));
const routeCatalog = JSON.parse(readFileSync(new URL(
  '../../packages/internal-contracts/src/public-route-catalog.json', import.meta.url,
), 'utf8'));

test('knative-contract-01: unified, family, and route-catalog status contracts remain generated in sync', () => {
  const path = '/v1/platform/runtime/knative';
  assert.equal(openapi.paths[path].get.operationId, 'getKnativeRuntimeStatus');
  assert.equal(platform.paths[path].get.operationId, 'getKnativeRuntimeStatus');
  const route = routeCatalog.routes.find((entry) => entry.operationId === 'getKnativeRuntimeStatus');
  assert.equal(route.path, path);
  assert.equal(route.method, 'GET');
  assert.equal(route.scope, 'platform');
  assert.equal(route.authRequired, true);
  assert.deepEqual(openapi.components.schemas.KnativeRuntimeStatus.required, [
    'mode', 'owner', 'version', 'compatibility', 'state', 'stage', 'reason', 'lastTransitionAt',
  ]);
});

test('knative-contract-02: every Function Knative mutation publishes disabled/unavailable outcomes', () => {
  const operations = [
    functions.paths['/v1/functions/actions'].post,
    functions.paths['/v1/functions/actions/{resourceId}'].patch,
    functions.paths['/v1/functions/actions/{resourceId}/invocations'].post,
    functions.paths['/v1/functions/actions/{resourceId}/rollback'].post,
  ];
  for (const operation of operations) {
    assert.equal(
      operation.responses['501'].content['application/json'].schema.$ref,
      '#/components/schemas/FunctionsDisabledError',
    );
    assert.equal(
      operation.responses['503'].content['application/json'].schema.$ref,
      '#/components/schemas/KnativeUnavailableError',
    );
  }
  const deletion = functions.paths['/v1/functions/actions/{resourceId}'].delete.responses;
  assert.equal(deletion['501'].content['application/json'].schema.$ref, '#/components/schemas/FunctionsDisabledError');
  assert.equal(deletion['202'].content['application/json'].schema.$ref, '#/components/schemas/FunctionDeletionAccepted');
});

test('knative-contract-03: degraded Function metadata is modeled without cluster owner detail', () => {
  const action = openapi.components.schemas.FunctionAction;
  assert.ok(action.properties.status.enum.includes('unavailable'));
  assert.ok(action.properties.status.enum.includes('deletion_pending'));
  assert.equal(action.properties.runtimeDependency.$ref, '#/components/schemas/FunctionRuntimeDependency');
  const dependency = openapi.components.schemas.FunctionRuntimeDependency;
  assert.equal(dependency.additionalProperties, false);
  assert.deepEqual(Object.keys(dependency.properties).sort(), ['mode', 'ready', 'reason', 'state']);
});
