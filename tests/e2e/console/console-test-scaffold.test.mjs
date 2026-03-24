import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REQUIRED_CONSOLE_STATES,
  REQUIRED_CONSOLE_STATUS_STATES,
  readTestingStrategy
} from '../../../scripts/lib/testing-strategy.mjs';

test('console scaffold defines required actor states and route expectations', () => {
  const strategy = readTestingStrategy();
  const states = strategy.console.states;
  const stateIds = new Set(states.map((state) => state.id));
  const consoleScenarios = strategy.cross_domain_matrix.scenarios.filter((scenario) => scenario.level === 'console_e2e');

  for (const state of [...REQUIRED_CONSOLE_STATES, ...REQUIRED_CONSOLE_STATUS_STATES]) {
    assert.equal(stateIds.has(state), true, `missing console state ${state}`);
  }

  assert.equal(consoleScenarios.length >= 5, true);
  assert.equal(consoleScenarios.some((scenario) => scenario.states?.includes('unauthenticated')), true);
  assert.equal(consoleScenarios.some((scenario) => scenario.states?.includes('tenant_admin')), true);
  assert.equal(consoleScenarios.some((scenario) => scenario.states?.includes('pending_activation')), true);
  assert.equal(consoleScenarios.some((scenario) => scenario.states?.includes('credentials_expired')), true);
  assert.equal(consoleScenarios.some((scenario) => scenario.id === 'CE-CON-005'), true);

  for (const state of states) {
    assert.equal(state.visible_sections.length > 0, true, `${state.id} should expose at least one visible section`);
    assert.equal(state.blocked_sections.length > 0, true, `${state.id} should block at least one section`);
    assert.equal(state.allowed_actions.length > 0, true, `${state.id} should allow at least one action`);
  }
});
