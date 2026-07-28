import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTransition, createOperation } from '../../packages/provisioning-orchestrator/src/models/async-operation.mjs';

test('applyTransition sets timeout reason for timed_out', () => {
  const updated = applyTransition({ status: 'running' }, { new_status: 'timed_out' });
  assert.equal(updated.cancellation_reason, 'timeout exceeded');
  assert.equal(updated.result, null);
  assert.equal(updated.completed_at, updated.updated_at);
});

test('applyTransition stores cancelled_by and cancellation_reason for cancelling', () => {
  const updated = applyTransition(
    { status: 'running', cancelled_by: null, cancellation_reason: null },
    { new_status: 'cancelling', cancelled_by: 'actor-1', cancellation_reason: 'manual cancel' }
  );
  assert.equal(updated.cancelled_by, 'actor-1');
  assert.equal(updated.cancellation_reason, 'manual cancel');
  assert.equal(updated.result, null);
  assert.equal(updated.completed_at, null);
});

test('applyTransition timestamps cancelled terminal state and clears prior result data', () => {
  const updated = applyTransition(
    { status: 'pending', result: { summary: 'stale' }, completed_at: '2026-01-01T00:00:00.000Z' },
    { new_status: 'cancelled' }
  );

  assert.equal(updated.result, null);
  assert.equal(updated.completed_at, updated.updated_at);
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
