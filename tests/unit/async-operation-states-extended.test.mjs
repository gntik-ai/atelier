import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLABLE_STATES,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
  isTerminal,
  validateTransition
} from '../../packages/provisioning-orchestrator/src/models/async-operation-states.mjs';
import {
  ACTIVE_STATUSES,
  OPERATION_STATUSES,
  STATUS_TRANSITIONS,
  CANCELLABLE_STATUSES,
  TERMINAL_STATUSES
} from '../../packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs';
import { isCancellable } from '../../packages/provisioning-orchestrator/src/models/async-operation.mjs';

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

test('C-12 generated lifecycle facade covers the canonical graph and classifications', () => {
  assert.deepEqual([...TERMINAL_STATES], TERMINAL_STATUSES);
  assert.deepEqual([...CANCELLABLE_STATES], CANCELLABLE_STATUSES);
  assert.deepEqual(VALID_TRANSITIONS, STATUS_TRANSITIONS);
  assert.deepEqual(OPERATION_STATUSES.filter((status) => !isTerminal(status)), ACTIVE_STATUSES);

  for (const [current, targets] of Object.entries(VALID_TRANSITIONS)) {
    for (const next of targets) {
      assert.doesNotThrow(() => validateTransition(current, next));
    }
  }
  for (const terminal of TERMINAL_STATUSES) {
    assert.deepEqual(VALID_TRANSITIONS[terminal], []);
  }
  assert.throws(
    () => validateTransition('cancelling', 'completed'),
    (error) => error.code === 'INVALID_TRANSITION' && error.current === 'cancelling' && error.next === 'completed'
  );
});
