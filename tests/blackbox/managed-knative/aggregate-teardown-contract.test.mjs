/**
 * Public aggregate-teardown contract regressions for issue #933.
 *
 * These tests intentionally inspect only generated public discovery artifacts.
 * A real-stack suite must separately prove the Knative deletions and durable
 * state transitions; this file does not infer datastore behavior from source.
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
const routes = JSON.parse(readFileSync(
  path.join(REPO_ROOT, 'packages/internal-contracts/src/public-route-catalog.json'),
  'utf8',
)).routes;

const TENANT_PURGE = ['post', '/v1/tenants/{tenantId}/purge'];
const WORKSPACE_TEARDOWN = ['delete', '/v1/workspaces/{workspaceId}'];
const AGGREGATE_RUNTIME_TEARDOWN = {
  ownedCapabilities: ['functions', 'hosted_mcp'],
  ownershipVerification: 'required_before_delete',
  readyCompletion: 'only_after_owned_resources_absent',
  unavailableStatus: 'cleanup_pending',
  retainOwnershipMetadata: true,
  durableObligations: 'owner_scoped',
  retry: 'idempotent_after_readiness',
  adjacentTenantEffect: 'none',
};

function operation(method, publicPath) {
  const value = openapi.paths?.[publicPath]?.[method];
  assert.ok(value, `published OpenAPI must contain ${method.toUpperCase()} ${publicPath}`);
  return value;
}

function catalogRoute(method, publicPath) {
  const matches = routes.filter((route) => (
    route.method === method.toUpperCase() && route.path === publicPath
  ));
  assert.equal(matches.length, 1, `route catalog must contain one ${method.toUpperCase()} ${publicPath}`);
  return matches[0];
}

/**
 * bbx-933-aggregate-teardown-21 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Tenant teardown leaves no function workloads
 * OpenSpec #### Scenario: Tenant deprovision removes the complete MCP footprint
 */
test('bbx-933-aggregate-teardown-21: ready tenant/workspace teardown publishes owner-verified completion semantics', () => {
  for (const [method, publicPath] of [TENANT_PURGE, WORKSPACE_TEARDOWN]) {
    const apiOperation = operation(method, publicPath);
    const route = catalogRoute(method, publicPath);

    assert.deepEqual(
      apiOperation['x-runtime-aggregate-teardown'],
      AGGREGATE_RUNTIME_TEARDOWN,
      `${method.toUpperCase()} ${publicPath} must not claim completion before owned Function and MCP resources are absent`,
    );
    assert.deepEqual(
      route.runtimeAggregateTeardown,
      AGGREGATE_RUNTIME_TEARDOWN,
      `${method.toUpperCase()} ${publicPath} discovery must preserve the aggregate teardown boundary`,
    );
  }
});

/**
 * bbx-933-aggregate-teardown-22 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Teardown is deferred safely during an outage
 * OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 * OpenSpec #### Scenario: Retried cleanup is safe
 */
test('bbx-933-aggregate-teardown-22: outage and recovery contract stays pending, durable, isolated, and idempotent', () => {
  for (const [method, publicPath] of [TENANT_PURGE, WORKSPACE_TEARDOWN]) {
    const apiOperation = operation(method, publicPath);
    const accepted = apiOperation.responses?.['202'];
    assert.ok(accepted, `${method.toUpperCase()} ${publicPath} must publish HTTP 202`);
    assert.match(
      accepted.description,
      /cleanup.pending|pending.cleanup/i,
      `${method.toUpperCase()} ${publicPath} must describe the honest pending-cleanup outcome`,
    );

    const policy = apiOperation['x-runtime-aggregate-teardown'];
    assert.equal(policy?.unavailableStatus, 'cleanup_pending');
    assert.equal(policy?.retainOwnershipMetadata, true);
    assert.equal(policy?.durableObligations, 'owner_scoped');
    assert.equal(policy?.retry, 'idempotent_after_readiness');
    assert.equal(policy?.adjacentTenantEffect, 'none');
  }
});
