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

test('deployment chart stays internally consistent with packaging guidance', () => {
  const violations = collectDeploymentChartViolations(
    readRootChart(),
    readRootValues(),
    readDeploymentTopology(),
    readWrapperChart()
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
    readWrapperChart()
  );

  assert.ok(violations.some((violation) => violation.includes('Missing wrapper dependency alias storage')));
  assert.ok(violations.some((violation) => violation.includes('deployment.valuesLayers must include airgap')));
});

test('all expected component aliases are present in the root chart dependencies', () => {
  const aliases = readRootChart().dependencies.map((entry) => entry.alias);
  assert.deepEqual(aliases, REQUIRED_COMPONENT_ALIASES);
});
