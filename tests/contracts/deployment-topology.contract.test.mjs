import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readDeploymentSmokeMatrix,
  readDeploymentTopology,
  resolveValues
} from '../../scripts/lib/deployment-topology.mjs';

test('deployment topology contract exposes the required descriptors and promotion flow', () => {
  const topology = readDeploymentTopology();

  assert.equal(topology.version, '2026-03-23');
  assert.deepEqual(topology.promotion_strategy.canonical_path, ['dev', 'staging', 'prod']);
  assert.equal(topology.promotion_strategy.sandbox_source, 'prod');
  assert.ok(topology.contracts.deployment_profile_descriptor.required_fields.includes('hostnames'));
  assert.ok(topology.contracts.public_endpoint_descriptor.required_fields.includes('route_prefix'));
  assert.ok(topology.contracts.promotion_plan_descriptor.error_classes.includes('config_drift_detected'));
  assert.ok(topology.contracts.smoke_assertion_descriptor.required_fields.includes('expected_exposure_kind'));
  assert.deepEqual(topology.configuration_policy.helm_value_layers, [
    'common',
    'environment',
    'customer',
    'platform',
    'airgap',
    'localOverride'
  ]);
  assert.deepEqual(topology.packaging_guidance.component_aliases, [
    'apisix',
    'keycloak',
    'postgresql',
    'mongodb',
    'kafka',
    'openwhisk',
    'storage',
    'observability',
    'controlPlane',
    'webConsole'
  ]);
});

test('resolved environment overlays preserve the same public route semantics across platforms', () => {
  const kubernetesValues = resolveValues('staging', 'kubernetes');
  const openshiftValues = resolveValues('staging', 'openshift');

  assert.deepEqual(kubernetesValues.publicSurface.routePrefixes, openshiftValues.publicSurface.routePrefixes);
  assert.deepEqual(kubernetesValues.publicSurface.hostnames, openshiftValues.publicSurface.hostnames);
  assert.equal(kubernetesValues.platform.network.exposureKind, 'Ingress');
  assert.equal(openshiftValues.platform.network.exposureKind, 'Route');
});

test('deployment smoke matrix matches the contract version and scenario expectations', () => {
  const topology = readDeploymentTopology();
  const smokeMatrix = readDeploymentSmokeMatrix();
  const scenarios = smokeMatrix.smoke_scenarios;

  assert.equal(scenarios.length, 8);
  assert.equal(
    scenarios.every((scenario) => ['kubernetes', 'openshift'].includes(scenario.platform)),
    true
  );
  assert.equal(topology.contracts.smoke_assertion_descriptor.version, topology.version);
});
