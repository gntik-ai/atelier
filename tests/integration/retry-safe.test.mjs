import test from 'node:test';
import assert from 'node:assert/strict';

import { createOperation as createOperationModel } from '../../services/provisioning-orchestrator/src/models/async-operation.mjs';
import { createOperation, findByIdAnyTenant } from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';
import { create as createRetryAttempt, findByOperationId } from '../../services/provisioning-orchestrator/src/repositories/retry-attempt-repo.mjs';
import { main as retryAction } from '../../services/provisioning-orchestrator/src/actions/async-operation-retry.mjs';

function createRetryStore() {
  const state = {
    operations: new Map(),
    retryAttempts: new Map(),
    transitions: [],
    events: []
  };

  const client = {
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, ' ').trim();

      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
        return { rows: [] };
      }

      if (statement.includes('INSERT INTO async_operations')) {
        const row = {
          operation_id: params[0],
          tenant_id: params[1],
          actor_id: params[2],
          actor_type: params[3],
          workspace_id: params[4],
          operation_type: params[5],
          status: params[6],
          error_summary: params[7],
          correlation_id: params[8],
          idempotency_key: params[9],
          saga_id: params[10],
          attempt_count: params[11],
          max_retries: params[12],
          created_at: params[13],
          updated_at: params[14]
        };
        state.operations.set(row.operation_id, row);
        return { rows: [{ ...row }] };
      }

      if (statement === 'SELECT * FROM async_operations WHERE operation_id = $1') {
        const row = state.operations.get(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }

      if (statement === 'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2') {
        const row = state.operations.get(params[0]);
        return { rows: row && row.tenant_id === params[1] ? [{ ...row }] : [] };
      }

      if (statement.includes("UPDATE async_operations SET status = 'pending'")) {
        const row = state.operations.get(params[0]);
        if (!row || row.tenant_id !== params[1] || row.status !== 'failed') {
          return { rows: [] };
        }
        const updated = {
          ...row,
          status: 'pending',
          attempt_count: (row.attempt_count ?? 0) + 1,
          correlation_id: params[2],
          error_summary: null,
          updated_at: '2026-03-30T00:02:00.000Z'
        };
        state.operations.set(updated.operation_id, updated);
        return { rows: [{ ...updated }] };
      }

      if (statement.includes('INSERT INTO retry_attempts')) {
        const row = {
          attempt_id: params[0],
          operation_id: params[1],
          tenant_id: params[2],
          attempt_number: params[3],
          correlation_id: params[4],
          actor_id: params[5],
          actor_type: params[6],
          status: params[7],
          created_at: params[8],
          completed_at: params[9],
          metadata: params[10]
        };
        state.retryAttempts.set(`${row.operation_id}:${row.attempt_number}`, row);
        return { rows: [{ ...row }] };
      }

      if (statement.includes('SELECT * FROM retry_attempts')) {
        const rows = [...state.retryAttempts.values()].filter((row) => row.operation_id === params[0] && row.tenant_id === params[1]);
        rows.sort((a, b) => a.attempt_number - b.attempt_number);
        return { rows };
      }

      if (statement.includes('INSERT INTO async_operation_transitions')) {
        state.transitions.push({
          transition_id: params[0],
          operation_id: params[1],
          tenant_id: params[2],
          actor_id: params[3],
          previous_status: params[4],
          new_status: params[5],
          transitioned_at: params[6],
          metadata: params[7]
        });
        return { rows: [] };
      }

      throw new Error(`Unsupported SQL in fake db: ${statement}`);
    }
  };

  return {
    state,
    db: client,
    producer: {
      async send(message) {
        state.events.push(message);
      }
    }
  };
}

test('failed operation can be retried safely and records attempt history', async () => {
  const store = createRetryStore();
  const operation = createOperationModel({
    tenant_id: 'tenant-a',
    actor_id: 'user-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-01',
    operation_type: 'create-workspace',
    correlation_id: 'op:tenant-a:prev:12345678',
    max_retries: 2
  });
  await createOperation(store.db, operation);
  store.state.operations.set(operation.operation_id, {
    ...store.state.operations.get(operation.operation_id),
    status: 'failed',
    error_summary: { code: 'FAIL', message: 'boom', failedStep: 'apply' }
  });

  const response = await retryAction({
    operation_id: operation.operation_id,
    callerContext: { tenantId: 'tenant-a', actor: { id: 'user-2', type: 'workspace_admin' } }
  }, {
    db: store.db,
    producer: store.producer,
    log: () => {}
  });

  const updatedOperation = await findByIdAnyTenant(store.db, { operation_id: operation.operation_id });
  const attempts = await findByOperationId(store.db, { operation_id: operation.operation_id, tenant_id: 'tenant-a' });

  assert.equal(response.statusCode, 200);
  assert.equal(updatedOperation.status, 'pending');
  assert.equal(updatedOperation.attempt_count, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attempt_number, 1);
  assert.ok(store.state.events.some((message) => message.topic === 'console.async-operation.retry-requested'));
});

test('completed operations and cross-tenant access are rejected', async () => {
  const store = createRetryStore();
  const operation = createOperationModel({
    tenant_id: 'tenant-a',
    actor_id: 'user-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-01',
    operation_type: 'create-workspace',
    correlation_id: 'op:tenant-a:prev:12345678',
    max_retries: 1
  });
  await createOperation(store.db, operation);
  store.state.operations.set(operation.operation_id, {
    ...store.state.operations.get(operation.operation_id),
    status: 'completed'
  });

  await assert.rejects(
    () => retryAction({
      operation_id: operation.operation_id,
      callerContext: { tenantId: 'tenant-a', actor: { id: 'user-2', type: 'workspace_admin' } }
    }, { db: store.db, producer: store.producer, log: () => {} }),
    (error) => error.code === 'INVALID_OPERATION_STATE'
  );

  store.state.operations.set(operation.operation_id, {
    ...store.state.operations.get(operation.operation_id),
    status: 'failed'
  });

  await assert.rejects(
    () => retryAction({
      operation_id: operation.operation_id,
      callerContext: { tenantId: 'tenant-b', actor: { id: 'user-3', type: 'workspace_admin' } }
    }, { db: store.db, producer: store.producer, log: () => {} }),
    (error) => error.code === 'FORBIDDEN'
  );
});
