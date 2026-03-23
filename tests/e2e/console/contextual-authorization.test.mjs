import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixtureIndex, readReferenceDataset, readTestingStrategy } from '../../../scripts/lib/testing-strategy.mjs';

test('console strategy covers workspace-scoped authorization boundaries', () => {
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const fixtureIndex = buildFixtureIndex(dataset);
  const workspaceAdminState = strategy.console.states.find((state) => state.id === 'workspace_admin');
  const scenario = strategy.cross_domain_matrix.scenarios.find((entry) => entry.id === 'CE-SEC-002');

  assert.ok(workspaceAdminState);
  assert.deepEqual(
    workspaceAdminState.visible_sections,
    ['workspace-dashboard', 'workspace-settings', 'workspace-members']
  );
  assert.equal(workspaceAdminState.blocked_sections.includes('platform-overview'), true);
  assert.equal(workspaceAdminState.allowed_actions.includes('deploy-workspace-app'), true);

  assert.ok(scenario);
  assert.deepEqual(scenario.states, ['workspace_admin']);
  assert.equal(fixtureIndex.get('route-workspace-dashboard')?.section, 'console_routes');
  assert.equal(fixtureIndex.get('user-workspace-admin-alpha')?.section, 'users');
});
