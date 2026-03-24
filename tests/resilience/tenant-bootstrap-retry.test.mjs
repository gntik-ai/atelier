import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixtureIndex, readReferenceDataset, readTestingStrategy } from '../../scripts/lib/testing-strategy.mjs';

test('resilience scaffolding covers partial bootstrap retry without duplicated side effects', () => {
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const fixtures = buildFixtureIndex(dataset);
  const scenario = strategy.cross_domain_matrix.scenarios.find((entry) => entry.id === 'RS-DAT-004');

  assert.ok(scenario);
  assert.equal(scenario.level, 'resilience');
  assert.equal(scenario.domain, 'data');
  assert.equal(scenario.taxonomy, 'recovery');

  for (const fixtureId of [
    'resilience-partial-bootstrap',
    'event-tenant-provision-requested',
    'tenant-bootstrap-starter',
    'workspace-bootstrap-default'
  ]) {
    assert.ok(fixtures.has(fixtureId), `missing fixture ${fixtureId}`);
    assert.ok(scenario.fixtures.includes(fixtureId), `scenario must reference ${fixtureId}`);
  }

  assert.equal(fixtures.get('resilience-partial-bootstrap').value.failure_mode, 'partial_bootstrap_failure');
  assert.match(scenario.expected, /idempotent/i);
  assert.match(scenario.expected, /skip/i);
  assert.match(scenario.expected, /retr/i);
});
