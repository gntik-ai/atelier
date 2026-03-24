import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readDeploymentSmokeMatrix,
  readDeploymentTopology,
  resolveValues
} from '../../scripts/lib/deployment-topology.mjs';

test('deployment topology contract exposes the required descriptors and promotion flow', () => {
  const topology = readDeploymentTopology();

  assert.equal(topology.version, '2026-03-24');
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
  assert.deepEqual(topology.configuration_policy.optional_helm_value_layers, ['profile']);
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
  assert.deepEqual(topology.packaging_guidance.deployment_profiles, ['all-in-one', 'standard', 'ha']);
  assert.equal(topology.packaging_guidance.profile_values_path, 'charts/in-atelier/values/profiles/{profile}.yaml');
});

test('resolved environment overlays preserve the same public route semantics across platforms', () => {
  const kubernetesValues = resolveValues('staging', 'kubernetes');
  const openshiftValues = resolveValues('staging', 'openshift');

  assert.deepEqual(kubernetesValues.publicSurface.routePrefixes, openshiftValues.publicSurface.routePrefixes);
  assert.deepEqual(kubernetesValues.publicSurface.hostnames, openshiftValues.publicSurface.hostnames);
  assert.equal(kubernetesValues.platform.network.exposureKind, 'Ingress');
  assert.equal(openshiftValues.platform.network.exposureKind, 'Route');
  assert.equal(kubernetesValues.bootstrap.enabled, true);
  assert.equal(openshiftValues.bootstrap.enabled, true);
});

test('deployment topology bootstrap policy documents secret resolution and restore guardrails', () => {
  const topology = readDeploymentTopology();

  assert.equal(topology.bootstrap_policy.controller_kind, 'post_install_upgrade_job');
  assert.equal(topology.bootstrap_policy.lock_resource_kind, 'ConfigMap');
  assert.equal(topology.bootstrap_policy.marker_resource_kind, 'ConfigMap');
  assert.deepEqual(topology.bootstrap_policy.supported_secret_strategies, ['kubernetesSecret', 'env', 'externalRef']);
  assert.deepEqual(topology.bootstrap_policy.one_shot_resources, [
    'superadmin',
    'platform_realm',
    'governance_catalog',
    'internal_namespaces'
  ]);
  assert.deepEqual(topology.bootstrap_policy.reconcile_each_upgrade, ['apisix_routes', 'bootstrap_payload_config']);
  assert.equal(topology.bootstrap_policy.restore_behaviour.length >= 4, true);
  assert.equal(
    topology.bootstrap_policy.restore_behaviour.some((rule) => rule.includes('client, client-scope, and tenant realm template identifiers')),
    true
  );
  assert.equal(
    topology.configuration_policy.secret_rules.some((rule) => rule.includes('Bootstrap credentials resolve')),
    true
  );
  assert.equal(
    topology.configuration_policy.secret_rules.some((rule) => rule.includes('tenant realm template')),
    true
  );
});

test('deployment topology publishes exposure and upgrade guardrails', () => {
  const topology = readDeploymentTopology();

  assert.deepEqual(topology.exposure_matrix.supported_tls_modes, ['clusterManaged', 'external']);
  assert.deepEqual(topology.exposure_matrix.kubernetes.supported_exposure_kinds, ['Ingress', 'LoadBalancer']);
  assert.deepEqual(topology.exposure_matrix.openshift.supported_exposure_kinds, ['Route']);
  assert.equal(topology.upgrade_guardrails.in_place_supported, true);
  assert.equal(topology.upgrade_guardrails.values_key, 'deployment.upgrade.currentVersion');
  assert.deepEqual(topology.upgrade_guardrails.supported_previous_versions, ['0.2.0']);
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
