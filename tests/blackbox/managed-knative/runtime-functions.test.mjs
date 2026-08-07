/**
 * Public-contract acceptance tests for issue #933.
 *
 * The real Function management and runtime-status routes are served by the
 * control-plane listener, whose supported startup contract requires its
 * PostgreSQL principals and other production dependencies. There is no public
 * no-cluster Function seeding seam. These deterministic tests therefore
 * execute Falcone's generated public OpenAPI and published route catalog. They
 * intentionally make no claim that a live Function mutation was performed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');

const openapi = JSON.parse(readFileSync(
  path.join(REPO_ROOT, 'apps/control-plane-executor/openapi/control-plane.openapi.json'),
  'utf8',
));
const routeCatalogDocument = JSON.parse(readFileSync(
  path.join(REPO_ROOT, 'packages/internal-contracts/src/public-route-catalog.json'),
  'utf8',
));
const routeCatalog = routeCatalogDocument.routes;

const STATUS_PATH = '/v1/platform/runtime/knative';
const ACTIONS_PATH = '/v1/functions/actions';
const ACTION_PATH = '/v1/functions/actions/{resourceId}';
const INVOCATIONS_PATH = '/v1/functions/actions/{resourceId}/invocations';
const ROLLBACK_PATH = '/v1/functions/actions/{resourceId}/rollback';
const WORKSPACE_ACTIONS_PATH = '/v1/functions/workspaces/{workspaceId}/actions';

function operation(method, publicPath) {
  const value = openapi.paths?.[publicPath]?.[method.toLowerCase()];
  assert.ok(value, `published OpenAPI must contain ${method.toUpperCase()} ${publicPath}`);
  return value;
}

function schema(name) {
  const value = openapi.components?.schemas?.[name];
  assert.ok(value, `published OpenAPI must contain schema ${name}`);
  return value;
}

function responseSchemaRef(method, publicPath, status) {
  const response = operation(method, publicPath).responses?.[String(status)];
  assert.ok(response, `${method.toUpperCase()} ${publicPath} must publish HTTP ${status}`);
  const ref = response.content?.['application/json']?.schema?.$ref;
  assert.match(ref ?? '', /^#\/components\/schemas\/[A-Za-z][A-Za-z0-9]*$/);
  return ref.slice('#/components/schemas/'.length);
}

function catalogRoute(method, publicPath) {
  const matches = routeCatalog.filter((route) => (
    route.method === method.toUpperCase() && route.path === publicPath
  ));
  assert.equal(
    matches.length,
    1,
    `published route catalog must contain exactly one ${method.toUpperCase()} ${publicPath}`,
  );
  return matches[0];
}

function assertExactObjectSchema(value, propertyNames) {
  assert.equal(value.type, 'object');
  assert.equal(value.additionalProperties, false);
  assert.deepEqual(Object.keys(value.properties).sort(), [...propertyNames].sort());
  assert.deepEqual([...value.required].sort(), [...propertyNames].sort());
}

function assertAuthenticatedPublicRoute(route) {
  assert.equal(route.visibility, 'public');
  assert.equal(route.authRequired, true);
  assert.equal(route.gatewayAuthMode, 'bearer_oidc');
  assert.equal(route.correlationIdRequired, true);
  assert.equal(route.correlationIdGeneratedWhenMissing, true);
}

/**
 * bbx-933-runtime-status-01 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 */
test('bbx-933-runtime-status-01: published runtime status is bounded and read-only', () => {
  const statusOperation = operation('get', STATUS_PATH);
  const statusRoute = catalogRoute('get', STATUS_PATH);
  const statusSchema = schema(responseSchemaRef('get', STATUS_PATH, 200));

  assertExactObjectSchema(statusSchema, [
    'mode',
    'owner',
    'version',
    'compatibility',
    'state',
    'stage',
    'reason',
    'lastTransitionAt',
  ]);
  assert.deepEqual(statusSchema.properties.mode.enum, ['managed', 'external', 'disabled']);
  assert.deepEqual(
    statusSchema.properties.compatibility.enum,
    ['compatible', 'incompatible', 'unverified'],
  );
  assert.deepEqual(
    statusSchema.properties.state.enum,
    ['ready', 'unverified', 'degraded', 'unavailable', 'disabled'],
  );
  assert.equal(statusSchema.properties.reason.pattern, '^[A-Z][A-Z0-9_]{0,63}$');

  assert.equal(statusOperation['x-scope'], 'platform');
  assert.equal(statusOperation['x-resource-type'], 'knative_runtime_status');
  assert.equal(statusRoute.scope, 'platform');
  assert.equal(statusRoute.tenantBinding, 'none');
  assert.equal(statusRoute.workspaceBinding, 'none');
  assert.equal(statusRoute.supportsIdempotencyKey, false);

  for (const method of ['post', 'put', 'patch', 'delete']) {
    assert.equal(
      openapi.paths[STATUS_PATH][method],
      undefined,
      `runtime status must not publish ${method.toUpperCase()} mutation`,
    );
    assert.equal(
      routeCatalog.some((route) => route.path === STATUS_PATH && route.method === method.toUpperCase()),
      false,
      `route catalog must not publish ${method.toUpperCase()} runtime mutation`,
    );
  }
});

/**
 * bbx-933-runtime-auth-02 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 */
test('bbx-933-runtime-auth-02: published runtime status requires platform authentication and authorization', () => {
  const statusOperation = operation('get', STATUS_PATH);
  const statusRoute = catalogRoute('get', STATUS_PATH);

  assert.deepEqual(statusOperation.security, [{ bearerAuth: [] }]);
  assert.equal(responseSchemaRef('get', STATUS_PATH, 401), 'ErrorResponse');
  assert.equal(responseSchemaRef('get', STATUS_PATH, 403), 'ErrorResponse');
  assert.match(statusOperation.responses['200'].description, /operator or auditor/i);
  assert.match(statusOperation.responses['403'].description, /operator.*auditor.*administrator/i);

  assertAuthenticatedPublicRoute(statusRoute);
  assert.deepEqual(statusRoute.audiences, ['platform_team', 'superadmin']);
  assert.equal(statusRoute.operationId, 'getKnativeRuntimeStatus');
});

/**
 * bbx-933-functions-unavailable-03 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Deploy fails explicitly while managed runtime is degraded
 */
test('bbx-933-functions-unavailable-03: public Function deploy contract exposes the exact bounded 503', () => {
  const createOperation = operation('post', ACTIONS_PATH);
  const createRoute = catalogRoute('post', ACTIONS_PATH);
  const unavailableSchemaName = responseSchemaRef('post', ACTIONS_PATH, 503);
  const unavailableSchema = schema(unavailableSchemaName);

  assert.equal(unavailableSchemaName, 'KnativeUnavailableError');
  assertExactObjectSchema(unavailableSchema, [
    'code',
    'message',
    'mode',
    'state',
    'reason',
    'correlationId',
  ]);
  assert.equal(unavailableSchema.properties.code.const, 'KNATIVE_UNAVAILABLE');
  assert.equal(unavailableSchema.properties.message.const, 'Knative runtime is unavailable.');
  assert.deepEqual(unavailableSchema.properties.mode.enum, ['managed', 'external', 'disabled']);
  assert.deepEqual(
    unavailableSchema.properties.state.enum,
    ['unverified', 'degraded', 'unavailable', 'disabled'],
  );
  assert.equal(unavailableSchema.properties.reason.pattern, '^[A-Z][A-Z0-9_]{0,63}$');
  assert.equal(unavailableSchema.properties.correlationId.minLength, 1);
  assert.equal(unavailableSchema.properties.correlationId.maxLength, 128);
  assert.match(createOperation.responses['503'].description, /no Function or runtime mutation/i);

  assertAuthenticatedPublicRoute(createRoute);
  assert.equal(createRoute.supportsIdempotencyKey, true);
  assert.ok(createRoute.requiredHeaders.includes('Idempotency-Key'));

  const detailRead = operation('get', ACTION_PATH);
  const collectionRead = operation('get', WORKSPACE_ACTIONS_PATH);
  assert.equal(detailRead.responses['503'], undefined, 'metadata reads must not be runtime-gated');
  assert.equal(collectionRead.responses['503'], undefined, 'metadata reads must not be runtime-gated');
  assert.ok(schema('FunctionAction').properties.runtimeDependency);
  assert.ok(schema('FunctionAction').properties.status.enum.includes('unavailable'));
  assert.ok(schema('FunctionAction').properties.status.enum.includes('deletion_pending'));
});

/**
 * bbx-933-functions-external-04 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Invoke fails explicitly with an external incompatibility
 */
test('bbx-933-functions-external-04: public invoke contract represents external incompatibility without activation success', () => {
  const invokeOperation = operation('post', INVOCATIONS_PATH);
  const invokeRoute = catalogRoute('post', INVOCATIONS_PATH);
  const unavailableSchemaName = responseSchemaRef('post', INVOCATIONS_PATH, 503);
  const unavailableSchema = schema(unavailableSchemaName);
  const statusSchema = schema('KnativeRuntimeStatus');

  assert.equal(unavailableSchemaName, 'KnativeUnavailableError');
  assert.ok(unavailableSchema.properties.mode.enum.includes('external'));
  assert.ok(unavailableSchema.properties.state.enum.includes('unverified'));
  assert.ok(unavailableSchema.properties.state.enum.includes('unavailable'));
  assert.ok(statusSchema.properties.compatibility.enum.includes('incompatible'));
  assert.match(invokeOperation.responses['503'].description, /no invocation or successful activation/i);

  assertAuthenticatedPublicRoute(invokeRoute);
  assert.equal(invokeRoute.resourceType, 'function_invocation');
  assert.equal(invokeRoute.scope, 'workspace');
});

/**
 * bbx-933-functions-disabled-05 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Disabled Functions preserve the existing error
 */
test('bbx-933-functions-disabled-05: disabled runtime remains distinct from transient unavailability in the public contract', () => {
  const statusSchema = schema('KnativeRuntimeStatus');
  const disabledSchemaName = responseSchemaRef('post', ACTIONS_PATH, 501);
  const unavailableSchemaName = responseSchemaRef('post', ACTIONS_PATH, 503);
  const disabledSchema = schema(disabledSchemaName);

  assert.ok(statusSchema.properties.mode.enum.includes('disabled'));
  assert.ok(statusSchema.properties.state.enum.includes('disabled'));
  assert.equal(disabledSchemaName, 'FunctionsDisabledError');
  assert.notEqual(disabledSchemaName, unavailableSchemaName);
  assert.equal(disabledSchema.properties.code.const, 'FUNCTIONS_DISABLED');
  assert.equal(disabledSchema.properties.message.const, 'Functions capability is disabled.');
  assert.notEqual(disabledSchema.properties.code.const, 'KNATIVE_UNAVAILABLE');
});

/**
 * bbx-933-functions-capability-disabled-06 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Disabled Functions preserve the existing error
 */
test('bbx-933-functions-capability-disabled-06: every public Function workload mutation preserves the 501 contract', () => {
  const functionWorkloadOperations = [
    ['post', ACTIONS_PATH],
    ['patch', ACTION_PATH],
    ['delete', ACTION_PATH],
    ['post', INVOCATIONS_PATH],
    ['post', ROLLBACK_PATH],
  ];

  for (const [method, publicPath] of functionWorkloadOperations) {
    assert.equal(
      responseSchemaRef(method, publicPath, 501),
      'FunctionsDisabledError',
      `${method.toUpperCase()} ${publicPath} must retain FUNCTIONS_DISABLED`,
    );
    assert.deepEqual(operation(method, publicPath).security, [{ bearerAuth: [] }]);
  }

  const disabledSchema = schema('FunctionsDisabledError');
  assertExactObjectSchema(disabledSchema, ['code', 'message', 'correlationId']);
  assert.equal(disabledSchema.properties.code.const, 'FUNCTIONS_DISABLED');
  assert.equal(disabledSchema.properties.correlationId.maxLength, 128);
  assert.equal(disabledSchema.properties.mode, undefined);
  assert.equal(disabledSchema.properties.state, undefined);
  assert.equal(disabledSchema.properties.reason, undefined);
});
