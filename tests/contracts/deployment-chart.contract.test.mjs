import test from 'node:test';
import assert from 'node:assert/strict';

import { readRootChart, readRootValues, REQUIRED_COMPONENT_ALIASES, REQUIRED_VALUE_LAYERS } from '../../scripts/lib/deployment-chart.mjs';
import { readDeploymentTopology } from '../../scripts/lib/deployment-topology.mjs';

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
