import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTransition } from '../../services/provisioning-orchestrator/src/models/async-operation-states.mjs';
import { isCancellable } from '../../services/provisioning-orchestrator/src/models/async-operation.mjs';

test('extended transitions are accepted', () => {
  assert.doesNotThrow(() => validateTransition('running', 'timed_out'));
  assert.doesNotThrow(() => validateTransition('running', 'cancelling'));
  assert.doesNotThrow(() => validateTransition('pending', 'cancelled'));
  assert.doesNotThrow(() => validateTransition('cancelling', 'cancelled'));
  assert.doesNotThrow(() => validateTransition('cancelling', 'failed'));
});

test('invalid extended transitions are rejected', () => {
  for (const pair of [
    ['timed_out', 'running'],
    ['timed_out', 'completed'],
    ['cancelled', 'running'],
    ['cancelling', 'running'],
    ['cancelling', 'completed']
  ]) {
    assert.throws(() => validateTransition(pair[0], pair[1]), { code: 'INVALID_TRANSITION' });
  }
});

test('isCancellable only returns true for pending and running', () => {
  assert.equal(isCancellable('pending'), true);
  assert.equal(isCancellable('running'), true);
  for (const status of ['completed', 'failed', 'timed_out', 'cancelled', 'cancelling']) {
    assert.equal(isCancellable(status), false);
  }
});
