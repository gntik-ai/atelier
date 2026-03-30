import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperation as buildOperation } from '../../services/provisioning-orchestrator/src/models/async-operation.mjs';
import {
  createOperation,
  findAll,
  findById,
  findByTenant,
  transitionOperation
} from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

function createInMemoryDb() {
  const operations = [];
  const transitions = [];
  const snapshots = [];

  return {
    operations,
    transitions,
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql === 'BEGIN') {
        snapshots.push({ operations: structuredClone(operations), transitions: structuredClone(transitions) });
        return { rows: [] };
      }

      if (normalizedSql === 'COMMIT') {
        snapshots.pop();
        return { rows: [] };
      }

      if (normalizedSql === 'ROLLBACK') {
        const snapshot = snapshots.pop();
        operations.splice(0, operations.length, ...(snapshot?.operations ?? []));
        transitions.splice(0, transitions.length, ...(snapshot?.transitions ?? []));
        return { rows: [] };
      }

      if (normalizedSql.startsWith('INSERT INTO async_operations')) {
        const [operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type, status, error_summary, correlation_id, idempotency_key, saga_id, created_at, updated_at] = params;
        const row = { operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type, status, error_summary, correlation_id, idempotency_key, saga_id, created_at, updated_at };
        operations.push(row);
        return { rows: [structuredClone(row)] };
      }

      if (normalizedSql === 'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2') {
        const row = operations.find((operation) => operation.operation_id === params[0] && operation.tenant_id === params[1]);
        return { rows: row ? [structuredClone(row)] : [] };
      }

      if (normalizedSql === 'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2 FOR UPDATE') {
        const row = operations.find((operation) => operation.operation_id === params[0] && operation.tenant_id === params[1]);
        return { rows: row ? [structuredClone(row)] : [] };
      }

      if (normalizedSql.startsWith('UPDATE async_operations SET status = $3')) {
        const row = operations.find((operation) => operation.operation_id === params[0] && operation.tenant_id === params[1]);
        if (!row) {
          return { rows: [] };
        }
        row.status = params[2];
        row.error_summary = params[3];
        row.updated_at = params[4];
        return { rows: [structuredClone(row)] };
      }

      if (normalizedSql.startsWith('INSERT INTO async_operation_transitions')) {
        const [transition_id, operation_id, tenant_id, actor_id, previous_status, new_status, transitioned_at, metadata] = params;
        transitions.push({ transition_id, operation_id, tenant_id, actor_id, previous_status, new_status, transitioned_at, metadata });
        return { rows: [] };
      }

      if (normalizedSql.startsWith('SELECT COUNT(*)::int AS total FROM async_operations WHERE tenant_id = $1 AND status = $2')) {
        const rows = operations.filter((operation) => operation.tenant_id === params[0] && operation.status === params[1]);
        return { rows: [{ total: rows.length }] };
      }

      if (normalizedSql.startsWith('SELECT COUNT(*)::int AS total FROM async_operations WHERE tenant_id = $1')) {
        const rows = operations.filter((operation) => operation.tenant_id === params[0]);
        return { rows: [{ total: rows.length }] };
      }

      if (normalizedSql.startsWith('SELECT * FROM async_operations WHERE tenant_id = $1 AND status = $2')) {
        const rows = operations.filter((operation) => operation.tenant_id === params[0] && operation.status === params[1]);
        return { rows: structuredClone(rows) };
      }

      if (normalizedSql.startsWith('SELECT * FROM async_operations WHERE tenant_id = $1 ORDER BY created_at DESC')) {
        const rows = operations.filter((operation) => operation.tenant_id === params[0]);
        return { rows: structuredClone(rows) };
      }

      if (normalizedSql === 'SELECT COUNT(*)::int AS total FROM async_operations') {
        return { rows: [{ total: operations.length }] };
      }

      if (normalizedSql.startsWith('SELECT * FROM async_operations ORDER BY created_at DESC')) {
        return { rows: structuredClone(operations) };
      }

      throw new Error(`Unsupported SQL in test double: ${normalizedSql}`);
    }
  };
}

test('repository creates operations and enforces tenant isolation on findById', async () => {
  const db = createInMemoryDb();
  const operation = buildOperation({ tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'workspace_admin', operation_type: 'WF-CON-001' });

  const created = await createOperation(db, operation);
  const found = await findById(db, { operation_id: created.operation_id, tenant_id: 'tenant-a' });
  const missing = await findById(db, { operation_id: created.operation_id, tenant_id: 'tenant-b' });

  assert.equal(found.operation_id, created.operation_id);
  assert.equal(missing, null);
  await assert.rejects(() => createOperation(db, { ...operation, tenant_id: '' }), (error) => error.code === 'VALIDATION_ERROR');
});

test('repository transitions atomically and stores transition metadata', async () => {
  const db = createInMemoryDb();
  const operation = await createOperation(db, buildOperation({ tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'workspace_admin', operation_type: 'WF-CON-001' }));

  const runningResult = await transitionOperation(db, {
    operation_id: operation.operation_id,
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    new_status: 'running'
  });

  const failedResult = await transitionOperation(db, {
    operation_id: operation.operation_id,
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    new_status: 'failed',
    error_summary: { code: 'STEP_FAILED', message: 'Provisioning step failed cleanly.', failedStep: 'bind-resource' }
  });

  assert.equal(runningResult.updatedOperation.status, 'running');
  assert.equal(failedResult.updatedOperation.status, 'failed');
  assert.equal(db.transitions.length, 2);
  assert.equal(db.transitions[0].previous_status, 'pending');
  assert.equal(db.transitions[0].new_status, 'running');
  assert.equal(db.transitions[1].previous_status, 'running');
  assert.equal(db.transitions[1].tenant_id, 'tenant-a');
  assert.equal(db.transitions[1].actor_id, 'actor-1');
  assert.deepEqual(failedResult.updatedOperation.error_summary, {
    code: 'STEP_FAILED',
    message: 'Provisioning step failed cleanly.',
    failedStep: 'bind-resource'
  });
});

test('repository rejects invalid transitions without corrupting persisted state', async () => {
  const db = createInMemoryDb();
  const operation = await createOperation(db, buildOperation({ tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'workspace_admin', operation_type: 'WF-CON-001' }));
  await transitionOperation(db, { operation_id: operation.operation_id, tenant_id: 'tenant-a', actor_id: 'actor-1', new_status: 'running' });
  await transitionOperation(db, { operation_id: operation.operation_id, tenant_id: 'tenant-a', actor_id: 'actor-1', new_status: 'completed' });

  await assert.rejects(
    () => transitionOperation(db, { operation_id: operation.operation_id, tenant_id: 'tenant-a', actor_id: 'actor-1', new_status: 'running' }),
    (error) => error.code === 'INVALID_TRANSITION'
  );

  const stored = await findById(db, { operation_id: operation.operation_id, tenant_id: 'tenant-a' });
  assert.equal(stored.status, 'completed');
  assert.equal(db.transitions.length, 2);
});

test('repository findByTenant and findAll provide tenant-scoped and superadmin views', async () => {
  const db = createInMemoryDb();
  await createOperation(db, buildOperation({ tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'workspace_admin', operation_type: 'WF-CON-001' }));
  await createOperation(db, buildOperation({ tenant_id: 'tenant-b', actor_id: 'actor-2', actor_type: 'superadmin', operation_type: 'WF-CON-002' }));

  const tenantA = await findByTenant(db, { tenant_id: 'tenant-a' });
  const all = await findAll(db, {});

  assert.equal(tenantA.total, 1);
  assert.equal(tenantA.items[0].tenant_id, 'tenant-a');
  assert.equal(all.total, 2);
  assert.deepEqual(new Set(all.items.map((item) => item.tenant_id)), new Set(['tenant-a', 'tenant-b']));
});
