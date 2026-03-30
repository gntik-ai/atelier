import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTransition, createOperation } from '../../services/provisioning-orchestrator/src/models/async-operation.mjs';

test('applyTransition sets timeout reason for timed_out', () => {
  const updated = applyTransition({ status: 'running' }, { new_status: 'timed_out' });
  assert.equal(updated.cancellation_reason, 'timeout exceeded');
});

test('applyTransition stores cancelled_by and cancellation_reason for cancelling', () => {
  const updated = applyTransition(
    { status: 'running', cancelled_by: null, cancellation_reason: null },
    { new_status: 'cancelling', cancelled_by: 'actor-1', cancellation_reason: 'manual cancel' }
  );
  assert.equal(updated.cancelled_by, 'actor-1');
  assert.equal(updated.cancellation_reason, 'manual cancel');
});

test('createOperation stores timeout_policy_snapshot', () => {
  const operation = createOperation({
    tenant_id: 'tenant-1',
    actor_id: 'actor-1',
    actor_type: 'tenant_owner',
    operation_type: 'create-workspace',
    timeout_policy_snapshot: { timeout_minutes: 10 }
  });
  assert.deepEqual(operation.timeout_policy_snapshot, { timeout_minutes: 10 });
});
