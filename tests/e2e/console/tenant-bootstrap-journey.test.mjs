import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixtureIndex, readReferenceDataset, readTestingStrategy } from '../../../scripts/lib/testing-strategy.mjs';

test('console journey scaffolding covers signup activation through visible bootstrap resources', () => {
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const fixtures = buildFixtureIndex(dataset);
  const scenario = strategy.cross_domain_matrix.scenarios.find((entry) => entry.id === 'CE-CON-005');

  assert.ok(scenario);
  assert.equal(scenario.level, 'console_e2e');
  assert.equal(scenario.domain, 'console');
  assert.equal(scenario.taxonomy, 'positive');
  assert.equal(scenario.states.includes('pending_activation'), true);
  assert.equal(scenario.states.includes('tenant_admin'), true);

  for (const fixtureId of [
    'user-bootstrap-pending',
    'user-bootstrap-owner',
    'tenant-bootstrap-starter',
    'workspace-bootstrap-default',
    'route-login',
    'route-tenant-dashboard',
    'route-workspace-dashboard',
    'event-signup-activation-approved'
  ]) {
    assert.ok(fixtures.has(fixtureId), `missing fixture ${fixtureId}`);
    assert.ok(scenario.fixtures.includes(fixtureId), `scenario must reference ${fixtureId}`);
  }

  assert.match(scenario.expected, /bootstrap/i);
  assert.match(scenario.expected, /resources/i);
});
