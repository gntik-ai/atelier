import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDeploymentChartViolations,
  readRootChart,
  readRootValues,
  readWrapperChart,
  REQUIRED_COMPONENT_ALIASES
} from '../../scripts/lib/deployment-chart.mjs';
import { readDeploymentTopology } from '../../scripts/lib/deployment-topology.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';

test('deployment chart stays internally consistent with packaging guidance', () => {
  const violations = collectDeploymentChartViolations(
    readRootChart(),
    readRootValues(),
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.deepEqual(violations, []);
});

test('deployment chart validation detects missing dependency aliases and values layers', () => {
  const brokenChart = structuredClone(readRootChart());
  brokenChart.dependencies = brokenChart.dependencies.filter((entry) => entry.alias !== 'storage');

  const brokenValues = structuredClone(readRootValues());
  delete brokenValues.deployment.valuesLayers.airgap;

  const violations = collectDeploymentChartViolations(
    brokenChart,
    brokenValues,
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.ok(violations.some((violation) => violation.includes('Missing wrapper dependency alias storage')));
  assert.ok(violations.some((violation) => violation.includes('deployment.valuesLayers must include airgap')));
});

test('deployment chart validation detects bootstrap catalog drift and invalid secret strategies', () => {
  const brokenValues = structuredClone(readRootValues());
  brokenValues.bootstrap.secretResolution.supportedStrategies = ['kubernetesSecret', 'env'];
  brokenValues.bootstrap.oneShot.governanceCatalog.plans = brokenValues.bootstrap.oneShot.governanceCatalog.plans.slice(1);

  const violations = collectDeploymentChartViolations(
    readRootChart(),
    brokenValues,
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.ok(violations.some((violation) => violation.includes('bootstrap.secretResolution.supportedStrategies')));
  assert.ok(violations.some((violation) => violation.includes('governanceCatalog.plans')));
});

test('all expected component aliases are present in the root chart dependencies', () => {
  const aliases = readRootChart().dependencies.map((entry) => entry.alias);
  assert.deepEqual(aliases, REQUIRED_COMPONENT_ALIASES);
});
