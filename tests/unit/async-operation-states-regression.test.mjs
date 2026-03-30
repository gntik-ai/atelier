import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMINAL_STATES, validateTransition } from '../../services/provisioning-orchestrator/src/models/async-operation-states.mjs';

test('original transitions still work', () => {
  assert.doesNotThrow(() => validateTransition('pending', 'running'));
  assert.doesNotThrow(() => validateTransition('running', 'completed'));
  assert.doesNotThrow(() => validateTransition('running', 'failed'));
});

test('terminal states still include completed and failed', () => {
  assert.equal(TERMINAL_STATES.has('completed'), true);
  assert.equal(TERMINAL_STATES.has('failed'), true);
});
