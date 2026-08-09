/**
 * Public-contract regressions for issue #933 follow-up findings.
 *
 * These tests inspect only Falcone's generated public OpenAPI and published route
 * catalog. The local deterministic suite has no supported public fixture surface
 * for provisioning Keycloak principals, tenant/workspace membership, PostgreSQL
 * Function rows, or Knative Services. Consequently these tests pin what clients
 * can rely on but do not claim that authorization, response serialization, or a
 * Kubernetes call was executed. Those behaviors remain real-stack E2E evidence.
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
const routeCatalog = JSON.parse(readFileSync(
  path.join(REPO_ROOT, 'packages/internal-contracts/src/public-route-catalog.json'),
  'utf8',
)).routes;

const ACTIONS_PATH = '/v1/functions/actions';
const ACTION_PATH = '/v1/functions/actions/{resourceId}';
const INVOCATIONS_PATH = '/v1/functions/actions/{resourceId}/invocations';
const ROLLBACK_PATH = '/v1/functions/actions/{resourceId}/rollback';
const STATUS_PATH = '/v1/platform/runtime/knative';

const FUNCTION_MUTATIONS = [
  ['post', ACTIONS_PATH],
  ['patch', ACTION_PATH],
  ['delete', ACTION_PATH],
  ['post', ROLLBACK_PATH],
];
const ISSUE_CHANGED_FUNCTION_OPERATIONS = [
  ...FUNCTION_MUTATIONS,
  ['post', INVOCATIONS_PATH],
];

const WORKSPACE_MUTATION_AUTHORIZATION = {
  allowedWorkspaceRoles: ['workspace_owner', 'workspace_admin', 'workspace_developer'],
  deniedWorkspaceRoles: ['workspace_viewer'],
  workspaceClaim: 'workspace_id',
  workspaceClaimMatch: 'required',
  dependencyDisclosure: 'after_authorization',
};
const FUNCTION_MUTATION_SUCCESS = {
  status: 202,
  schema: 'GatewayMutationAccepted',
  requiredBodyFields: {
    family: 'functions',
    resourceType: 'function_action',
  },
};
const FUNCTION_RUNTIME_ADAPTERS = ['knative', 'local-control-plane'];

function operation(method, publicPath) {
  const value = openapi.paths?.[publicPath]?.[method.toLowerCase()];
  assert.ok(value, `published OpenAPI must contain ${method.toUpperCase()} ${publicPath}`);
  return value;
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

function assertExactAuthErrorSchema(name, expectedCode) {
  const value = schema(name);
  assert.equal(value.type, 'object');
  assert.equal(value.additionalProperties, false);
  assert.deepEqual(
    [...value.required].sort(),
    ['code', 'correlationId', 'message'],
    `${name} must require only its runtime-emitted fields`,
  );
  assert.deepEqual(Object.keys(value.properties).sort(), ['code', 'correlationId', 'message']);
  assert.deepEqual(value.properties.code, expectedCode);
  assert.deepEqual(value.properties.message, {
    type: 'string',
    minLength: 1,
    maxLength: 128,
  });
  assert.deepEqual(
    value.properties.correlationId,
    openapi.components.parameters.XCorrelationId.schema,
    `${name} must echo the bounded public correlation identifier`,
  );
}

/**
 * bbx-933-function-mutation-auth-09 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Deploy fails explicitly while managed runtime is degraded
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 *
 * Real tokens for two same-tenant workspaces are required to prove the order at
 * runtime. This test pins the public claim-matching and disclosure-order contract.
 */
test('bbx-933-function-mutation-auth-09: Function mutations publish workspace claim authorization before dependency disclosure', () => {
  for (const [method, publicPath] of FUNCTION_MUTATIONS) {
    const apiOperation = operation(method, publicPath);
    const route = catalogRoute(method, publicPath);

    assert.equal(apiOperation['x-scope'], 'workspace');
    assert.equal(route.scope, 'workspace');
    assert.equal(route.workspaceBinding, 'required');
    assert.deepEqual(
      apiOperation['x-workspace-mutation-authorization'],
      WORKSPACE_MUTATION_AUTHORIZATION,
      `${method.toUpperCase()} ${publicPath} must bind mutation authorization to workspace_id`,
    );
    assert.deepEqual(
      route.workspaceMutationAuthorization,
      WORKSPACE_MUTATION_AUTHORIZATION,
      `${method.toUpperCase()} ${publicPath} route metadata must preserve authorization ordering`,
    );
  }
});

/**
 * bbx-933-function-success-contract-10 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 *
 * This is a public serialization contract. A live deployment is still required
 * to prove that the local control plane actually emits this exact response.
 */
test('bbx-933-function-success-contract-10: Function create and update publish one exact 202 success contract', () => {
  for (const [method, publicPath] of [['post', ACTIONS_PATH], ['patch', ACTION_PATH]]) {
    const apiOperation = operation(method, publicPath);
    const route = catalogRoute(method, publicPath);
    const successStatuses = Object.keys(apiOperation.responses)
      .filter((status) => /^2\d\d$/.test(status));

    assert.deepEqual(
      successStatuses,
      ['202'],
      `${method.toUpperCase()} ${publicPath} must have exactly one public success status`,
    );
    assert.equal(responseSchemaRef(method, publicPath, 202), 'GatewayMutationAccepted');
    assert.deepEqual(
      apiOperation['x-runtime-success-contract'],
      FUNCTION_MUTATION_SUCCESS,
      `${method.toUpperCase()} ${publicPath} must bind the generic envelope to Function constants`,
    );
    assert.deepEqual(
      route.runtimeSuccessContract,
      FUNCTION_MUTATION_SUCCESS,
      `${method.toUpperCase()} ${publicPath} route metadata must match runtime success serialization`,
    );
  }

  const accepted = schema('GatewayMutationAccepted');
  assert.ok(accepted.required.includes('family'));
  assert.ok(accepted.required.includes('resourceType'));
});

/**
 * bbx-933-runtime-auth-errors-11 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 * OpenSpec #### Scenario: Adjacent tenant cannot observe or mutate the runtime
 *
 * This verifies the published error envelopes, not live JWT verification. The
 * real-stack suite must prove the matching 401/403 bodies and correlation value.
 */
test('bbx-933-runtime-auth-errors-11: runtime status publishes bounded runtime-aligned 401 and 403 envelopes', () => {
  assert.equal(
    responseSchemaRef('get', STATUS_PATH, 401),
    'KnativeRuntimeAuthenticationError',
    '401 must not claim the gateway-only ErrorResponse envelope',
  );
  assert.equal(
    responseSchemaRef('get', STATUS_PATH, 403),
    'KnativeRuntimeAuthorizationError',
    '403 must not claim the gateway-only ErrorResponse envelope',
  );

  assertExactAuthErrorSchema('KnativeRuntimeAuthenticationError', {
    type: 'string',
    enum: ['INVALID_TOKEN', 'UNAUTHENTICATED'],
  });
  assertExactAuthErrorSchema('KnativeRuntimeAuthorizationError', {
    type: 'string',
    const: 'FORBIDDEN',
  });

  const statusRoute = catalogRoute('get', STATUS_PATH);
  assert.equal(statusRoute.correlationIdRequired, true);
  assert.equal(statusRoute.correlationIdGeneratedWhenMissing, true);
});

/**
 * bbx-933-function-adapters-12 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 *
 * Adapter metadata is public discovery data. Exercising the named Knative/local
 * path itself remains the responsibility of real-stack E2E acceptance.
 */
test('bbx-933-function-adapters-12: issue-changed Function operations no longer advertise OpenWhisk', () => {
  for (const [method, publicPath] of ISSUE_CHANGED_FUNCTION_OPERATIONS) {
    const apiOperation = operation(method, publicPath);
    const route = catalogRoute(method, publicPath);

    assert.deepEqual(
      apiOperation['x-downstream-adapters'],
      FUNCTION_RUNTIME_ADAPTERS,
      `${method.toUpperCase()} ${publicPath} must advertise the Knative/local control-plane path`,
    );
    assert.deepEqual(route.downstreamAdapters, FUNCTION_RUNTIME_ADAPTERS);
    assert.equal(apiOperation['x-downstream-adapters'].includes('openwhisk'), false);
    assert.equal(route.downstreamAdapters.includes('openwhisk'), false);
  }
});
