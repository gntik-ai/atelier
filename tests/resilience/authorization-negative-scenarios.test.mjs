import test from 'node:test';
import assert from 'node:assert/strict';

import { readAuthorizationModel } from '../../scripts/lib/authorization-model.mjs';
import { buildFixtureIndex, readReferenceDataset, readTestingStrategy } from '../../scripts/lib/testing-strategy.mjs';

test('authorization baseline covers cross-tenant and privilege-escalation negatives', () => {
  const model = readAuthorizationModel();
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const fixtureIndex = buildFixtureIndex(dataset);
  const categories = new Set(model.negative_scenarios.map((scenario) => scenario.category));
  const resilienceScenario = strategy.cross_domain_matrix.scenarios.find((scenario) => scenario.id === 'RS-SEC-001');

  assert.equal(model.negative_scenarios.length >= 6, true);
  assert.equal(categories.has('cross_tenant'), true);
  assert.equal(categories.has('delegation_escalation'), true);
  assert.equal(categories.has('plan_guardrail'), true);

  assert.ok(resilienceScenario);
  assert.equal(resilienceScenario.taxonomy, 'resilience');
  assert.equal(fixtureIndex.get('resilience-privilege-escalation')?.section, 'resilience_cases');
  assert.equal(dataset.resilience_cases.some((entry) => entry.failure_mode === 'privilege_escalation'), true);
});
