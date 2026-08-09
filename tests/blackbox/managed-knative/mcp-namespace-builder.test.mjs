/**
 * Public hosted-MCP manifest-builder regressions for Falcone issue #933.
 *
 * The tests import only the module's exported builder and assert its observable
 * result. They do not inspect Kubernetes adapter state or implementation details.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCustomServerDeployment } from '../../../apps/control-plane-executor/src/mcp-custom-hosting.mjs';

const VALID_IMAGE = `ghcr.io/falcone-blackbox/mcp-server@sha256:${'a'.repeat(64)}`;
const BASE_INPUT = Object.freeze({
  tenantId: 'tenant-933-raw',
  serverId: 'namespace-builder-933',
  image: VALID_IMAGE,
  allowedRegistries: ['ghcr.io'],
});

function violationMentionsNamespace(violation) {
  if (typeof violation === 'string') return /namespace/i.test(violation);
  if (violation === null || typeof violation !== 'object') return false;
  return [violation.code, violation.field, violation.message, violation.path]
    .some((value) => typeof value === 'string' && /namespace/i.test(value));
}

/**
 * bbx-933-mcp-namespace-builder-49 | fn-mcp-hosted-isolation
 * OpenSpec #### Scenario: Same server identity in two tenants remains isolated
 */
test('bbx-933-mcp-namespace-builder-49: missing authoritative namespace fails closed without using raw tenantId', () => {
  const { manifest, violations } = buildCustomServerDeployment(BASE_INPUT);

  assert.ok(
    violations.some(violationMentionsNamespace),
    `missing authoritative namespace must be rejected, received violations: ${JSON.stringify(violations)}`,
  );
  assert.notEqual(
    manifest?.metadata?.namespace,
    BASE_INPUT.tenantId,
    'raw tenantId must never be used as the Kubernetes namespace fallback',
  );
});

/**
 * bbx-933-mcp-namespace-builder-50 | fn-mcp-hosted-isolation
 * OpenSpec #### Scenario: Direct or cross-namespace ingress remains denied
 */
test('bbx-933-mcp-namespace-builder-50: explicit DNS-valid authoritative namespace is accepted exactly', () => {
  const namespace = 'runtime-tenant-933-a';
  const { manifest, violations } = buildCustomServerDeployment({
    ...BASE_INPUT,
    namespace,
  });

  assert.deepEqual(violations, [], `valid explicit namespace was rejected: ${JSON.stringify(violations)}`);
  assert.equal(manifest?.metadata?.namespace, namespace);
});

/**
 * bbx-933-mcp-namespace-builder-51 | fn-mcp-hosted-isolation
 * OpenSpec #### Scenario: Direct or cross-namespace ingress remains denied
 */
test('bbx-933-mcp-namespace-builder-51: explicit DNS-invalid namespace fails closed without a manifest', () => {
  const { manifest, violations } = buildCustomServerDeployment({
    ...BASE_INPUT,
    namespace: 'Runtime_Tenant/933',
  });

  assert.ok(
    violations.some(violationMentionsNamespace),
    `DNS-invalid namespace must be rejected, received violations: ${JSON.stringify(violations)}`,
  );
  assert.equal(manifest, null, 'DNS-invalid namespace must not produce a Kubernetes manifest');
});
