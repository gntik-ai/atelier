import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRetryAttempt,
  validateAttemptNumber
} from '../../services/provisioning-orchestrator/src/models/retry-attempt.mjs';

test('createRetryAttempt builds a pending retry attempt with a new correlation id', () => {
  const first = createRetryAttempt({
    operation_id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-a',
    attempt_number: 1,
    actor_id: 'user-1',
    actor_type: 'workspace_admin'
  });
  const second = createRetryAttempt({
    operation_id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-a',
    attempt_number: 2,
    actor_id: 'user-1',
    actor_type: 'workspace_admin'
  });

  assert.equal(first.status, 'pending');
  assert.equal(first.attempt_number, 1);
  assert.notEqual(first.correlation_id, second.correlation_id);
});

test('validateAttemptNumber rejects non-positive values', () => {
  assert.equal(validateAttemptNumber(1), 1);
  assert.throws(() => validateAttemptNumber(0), /attempt_number must be an integer greater than 0/);
  assert.throws(() => createRetryAttempt({
    operation_id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-a',
    attempt_number: 0,
    actor_id: 'user-1',
    actor_type: 'workspace_admin'
  }), /attempt_number must be an integer greater than 0/);
});
