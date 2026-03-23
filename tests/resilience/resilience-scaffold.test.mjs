import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixtureIndex, readReferenceDataset, readTestingStrategy } from '../../scripts/lib/testing-strategy.mjs';

test('resilience scaffold covers retry and tenant-safe recovery expectations', () => {
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const fixtureIndex = buildFixtureIndex(dataset);
  const scenarios = strategy.cross_domain_matrix.scenarios.filter((scenario) => scenario.level === 'resilience');

  assert.equal(scenarios.length >= 2, true);
  assert.equal(scenarios.some((scenario) => scenario.taxonomy === 'resilience'), true);
  assert.equal(scenarios.some((scenario) => scenario.taxonomy === 'recovery'), true);

  for (const scenario of scenarios) {
    assert.equal(
      scenario.fixtures.some((fixtureId) => fixtureIndex.get(fixtureId)?.section === 'resilience_cases'),
      true,
      `${scenario.id} should reference at least one resilience fixture`
    );
  }

  assert.equal(dataset.resilience_cases.some((entry) => entry.failure_mode === 'timeout'), true);
  assert.equal(dataset.resilience_cases.some((entry) => entry.failure_mode === 'placement_recovery'), true);
  assert.equal(dataset.resilience_cases.some((entry) => entry.failure_mode === 'privilege_escalation'), true);
});
