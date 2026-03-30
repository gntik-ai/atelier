import test from 'node:test';
import assert from 'node:assert/strict';
import { isTerminal, validateTransition } from '../../services/provisioning-orchestrator/src/models/async-operation-states.mjs';

test('validateTransition allows valid lifecycle moves', () => {
  assert.doesNotThrow(() => validateTransition('pending', 'running'));
  assert.doesNotThrow(() => validateTransition('running', 'completed'));
  assert.doesNotThrow(() => validateTransition('running', 'failed'));
});

test('validateTransition rejects invalid lifecycle moves', () => {
  for (const [from, to] of [['pending', 'completed'], ['completed', 'running'], ['failed', 'running'], ['running', 'pending']]) {
    assert.throws(() => validateTransition(from, to), (error) => error.code === 'INVALID_TRANSITION');
  }
});

test('isTerminal identifies terminal states', () => {
  assert.equal(isTerminal('pending'), false);
  assert.equal(isTerminal('running'), false);
  assert.equal(isTerminal('completed'), true);
  assert.equal(isTerminal('failed'), true);
});
