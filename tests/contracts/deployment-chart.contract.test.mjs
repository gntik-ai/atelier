import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readRootChart,
  readRootValues,
  REQUIRED_COMPONENT_ALIASES,
  REQUIRED_VALUE_LAYERS
} from '../../scripts/lib/deployment-chart.mjs';
import { readDeploymentTopology } from '../../scripts/lib/deployment-topology.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';

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
  assert.deepEqual(topology.packaging_guidance.component_aliases, REQUIRED_COMPONENT_ALIASES);
  assert.ok(topology.packaging_guidance.supported_install_modes.includes('component_only'));
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
