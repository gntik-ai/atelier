import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readRootChart,
  readRootValues,
  REQUIRED_COMPONENT_ALIASES,
  REQUIRED_VALUE_LAYERS,
  RECOMMENDED_DEPLOYMENT_PROFILES,
  OPTIONAL_LOADBALANCER_VALUES_PATH
} from '../../scripts/lib/deployment-chart.mjs';
import { readDeploymentTopology } from '../../scripts/lib/deployment-topology.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';
import { readYaml } from '../../scripts/lib/quality-gates.mjs';

test('deployment chart contract exposes aliased wrapper dependencies for every required component', () => {
  const dependencies = readRootChart().dependencies;

  assert.equal(dependencies.every((entry) => entry.name === 'component-wrapper'), true);
  assert.deepEqual(dependencies.map((entry) => entry.alias), REQUIRED_COMPONENT_ALIASES);
  assert.equal(dependencies.every((entry) => entry.repository === 'file://./charts/component-wrapper'), true);
});

test('chart values layers and topology packaging guidance stay aligned', () => {
  const values = readRootValues();
  const topology = readDeploymentTopology();

  assert.deepEqual(Object.keys(values.deployment.valuesLayers), REQUIRED_VALUE_LAYERS);
  assert.deepEqual(topology.configuration_policy.helm_value_layers, REQUIRED_VALUE_LAYERS);
  assert.deepEqual(topology.configuration_policy.optional_helm_value_layers, ['profile']);
  assert.deepEqual(topology.packaging_guidance.component_aliases, REQUIRED_COMPONENT_ALIASES);
  assert.deepEqual(topology.packaging_guidance.deployment_profiles, RECOMMENDED_DEPLOYMENT_PROFILES);
  assert.equal(topology.packaging_guidance.profile_values_path, 'charts/in-atelier/values/profiles/{profile}.yaml');
  assert.ok(topology.packaging_guidance.supported_install_modes.includes('component_only'));
});

test('deployment contract carries profile, exposure, and upgrade defaults', () => {
  const values = readRootValues();
  const loadBalancerValues = readYaml(OPTIONAL_LOADBALANCER_VALUES_PATH);

  assert.equal(values.deployment.profile, 'standard');
  assert.deepEqual(values.deployment.recommendedProfiles.supported, RECOMMENDED_DEPLOYMENT_PROFILES);
  assert.equal(values.publicSurface.tls.mode, 'clusterManaged');
  assert.equal(loadBalancerValues.platform.network.exposureKind, 'LoadBalancer');
  assert.equal(loadBalancerValues.publicSurface.tls.mode, 'external');
  assert.deepEqual(values.deployment.upgrade.supportedPreviousVersions, ['0.2.0']);
});

test('bootstrap contract keeps one-shot catalogs and upgrade reconciliation explicit', () => {
  const values = readRootValues();
  const topology = readDeploymentTopology();
  const domainModel = readDomainModel();

  assert.equal(values.bootstrap.enabled, true);
  assert.deepEqual(values.bootstrap.secretResolution.supportedStrategies, ['kubernetesSecret', 'env', 'externalRef']);
  assert.deepEqual(topology.bootstrap_policy.one_shot_resources, [
    'superadmin',
    'platform_realm',
    'governance_catalog',
    'internal_namespaces'
  ]);
  assert.deepEqual(topology.bootstrap_policy.reconcile_each_upgrade, ['apisix_routes', 'bootstrap_payload_config']);
  assert.deepEqual(values.bootstrap.oneShot.governanceCatalog.plans, domainModel.governance_catalogs.plans);
  assert.deepEqual(values.bootstrap.oneShot.governanceCatalog.quotaPolicies, domainModel.governance_catalogs.quota_policies);
  assert.deepEqual(
    values.bootstrap.oneShot.governanceCatalog.deploymentProfiles,
    domainModel.governance_catalogs.deployment_profiles
  );
  assert.deepEqual(
    values.bootstrap.reconcile.apisix.routes.map((route) => route.uri),
    ['/control-plane/*', '/auth/*', '/realtime/*', '/*']
  );
});
