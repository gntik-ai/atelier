import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransition,
  createOperation,
  isValidCorrelationId
} from '../../services/provisioning-orchestrator/src/models/async-operation.mjs';

test('createOperation returns a pending async operation with required metadata', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-1',
    operation_type: 'WF-CON-001'
  });

  assert.equal(operation.status, 'pending');
  assert.equal(operation.error_summary, null);
  assert.equal(operation.tenant_id, 'tenant-a');
  assert.equal(operation.actor_id, 'actor-1');
  assert.equal(operation.actor_type, 'workspace_admin');
  assert.equal(operation.workspace_id, 'ws-1');
  assert.equal(operation.operation_type, 'WF-CON-001');
  assert.equal(operation.idempotency_key, null);
  assert.equal(operation.saga_id, null);
  assert.equal(typeof operation.operation_id, 'string');
  assert.equal(operation.created_at, operation.updated_at);
  assert.equal(isValidCorrelationId(operation.correlation_id), true);
});

test('createOperation validates required fields and actor type', () => {
  for (const field of ['tenant_id', 'actor_id', 'actor_type', 'operation_type']) {
    const payload = {
      tenant_id: 'tenant-a',
      actor_id: 'actor-1',
      actor_type: 'workspace_admin',
      operation_type: 'WF-CON-001'
    };
    delete payload[field];

    assert.throws(() => createOperation(payload), (error) => error.code === 'VALIDATION_ERROR' && error.field === field);
  }

  assert.throws(
    () => createOperation({ tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'robot', operation_type: 'WF-CON-001' }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'actor_type'
  );
});

test('applyTransition updates timestamps and enforces failed error summary shape', async () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001'
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const running = applyTransition(operation, { new_status: 'running' });
  assert.equal(running.status, 'running');
  assert.notEqual(running.updated_at, operation.updated_at);
  assert.equal(running.error_summary, null);

  const failed = applyTransition(running, {
    new_status: 'failed',
    error_summary: { code: 'STEP_FAILED', message: 'Provisioning step failed cleanly.', failedStep: 'bind-resource' }
  });
  assert.deepEqual(failed.error_summary, {
    code: 'STEP_FAILED',
    message: 'Provisioning step failed cleanly.',
    failedStep: 'bind-resource'
  });

  assert.throws(
    () => applyTransition(running, { new_status: 'failed' }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary'
  );
});

test('applyTransition rejects invalid transitions and does not mutate original operation', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001',
    correlation_id: 'custom-correlation-id'
  });

  assert.equal(operation.correlation_id, 'custom-correlation-id');
  assert.throws(() => applyTransition(operation, { new_status: 'completed' }), (error) => error.code === 'INVALID_TRANSITION');
  assert.equal(operation.status, 'pending');
});

test('applyTransition rejects sensitive error messages', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001'
  });
  const running = applyTransition(operation, { new_status: 'running' });

  assert.throws(
    () => applyTransition(running, {
      new_status: 'failed',
      error_summary: { code: 'STEP_FAILED', message: 'postgres://user:pass@db.internal/app' }
    }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary.message'
  );
});
