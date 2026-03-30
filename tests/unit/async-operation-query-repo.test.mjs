import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOperationById,
  getOperationLogs,
  getOperationResult,
  listOperations
} from '../../services/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs';

function createMockDb(responses) {
  const queue = [...responses];
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = queue.shift() ?? { rows: [] };
      return typeof next === 'function' ? next(sql, params) : next;
    }
  };
}

test('U01/U02/U04/U12 listOperations filters by tenant, supports status filter, pagination and caps limit', async () => {
  const db = createMockDb([
    { rows: [{ total: 2 }] },
    {
      rows: [
        { operation_id: 'op_1', tenant_id: 'tenant_a', status: 'running' },
        { operation_id: 'op_2', tenant_id: 'tenant_a', status: 'running' }
      ]
    }
  ]);

  const result = await listOperations(db, {
    tenant_id: 'tenant_a',
    status: 'running',
    limit: 500,
    offset: 10
  });

  assert.equal(result.total, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.pagination.limit, 100);
  assert.equal(result.pagination.offset, 10);
  assert.match(db.calls[0].sql, /tenant_id = \$1/);
  assert.match(db.calls[0].sql, /status = \$2/);
  assert.deepEqual(db.calls[1].params.slice(-2), [100, 10]);
});

test('U03 listOperations rejects missing tenant scope for non-superadmin', async () => {
  const db = createMockDb([]);

  await assert.rejects(
    () => listOperations(db, { tenant_id: null }),
    (error) => error.code === 'TENANT_ISOLATION_VIOLATION'
  );
});

test('U05/U06 getOperationById returns operation when tenant matches and null otherwise', async () => {
  const matchingDb = createMockDb([{ rows: [{ operation_id: 'op_1', tenant_id: 'tenant_a' }] }]);
  const missingDb = createMockDb([{ rows: [] }]);

  assert.deepEqual(
    await getOperationById(matchingDb, { operation_id: 'op_1', tenant_id: 'tenant_a' }),
    { operation_id: 'op_1', tenant_id: 'tenant_a' }
  );
  assert.equal(await getOperationById(missingDb, { operation_id: 'op_1', tenant_id: 'tenant_b' }), null);
});

test('U07/U08 getOperationLogs returns entries in order and empty results when no entries exist', async () => {
  const populatedDb = createMockDb([
    { rows: [{ total: 2 }] },
    {
      rows: [
        { log_entry_id: 'log_1', level: 'info', message: 'Inicio', occurred_at: '2026-03-30T10:00:00.000Z' },
        { log_entry_id: 'log_2', level: 'warning', message: 'Reintento', occurred_at: '2026-03-30T10:01:00.000Z' }
      ]
    }
  ]);
  const emptyDb = createMockDb([{ rows: [{ total: 0 }] }, { rows: [] }]);

  const populated = await getOperationLogs(populatedDb, {
    operation_id: 'op_1',
    tenant_id: 'tenant_a',
    limit: 20,
    offset: 0
  });
  const empty = await getOperationLogs(emptyDb, {
    operation_id: 'op_2',
    tenant_id: 'tenant_a'
  });

  assert.equal(populated.entries[0].message, 'Inicio');
  assert.equal(populated.entries[1].message, 'Reintento');
  assert.deepEqual(empty, {
    entries: [],
    total: 0,
    pagination: { limit: 20, offset: 0 }
  });
});

test('U09/U10/U11 getOperationResult derives result projections for completed, failed and running states', async () => {
  const completedDb = createMockDb([
    {
      rows: [
        {
          operation_id: 'op_1',
          status: 'completed',
          result: { summary: 'Workspace aprovisionado' },
          error_summary: null,
          updated_at: '2026-03-30T12:00:00.000Z',
          completed_at: '2026-03-30T12:00:00.000Z'
        }
      ]
    }
  ]);
  const failedDb = createMockDb([
    {
      rows: [
        {
          operation_id: 'op_2',
          status: 'failed',
          result: null,
          error_summary: { message: 'La cuota fue superada', retryable: true },
          updated_at: '2026-03-30T12:05:00.000Z',
          completed_at: null
        }
      ]
    }
  ]);
  const runningDb = createMockDb([
    {
      rows: [
        {
          operation_id: 'op_3',
          status: 'running',
          result: null,
          error_summary: null,
          updated_at: '2026-03-30T12:10:00.000Z',
          completed_at: null
        }
      ]
    }
  ]);

  assert.deepEqual(await getOperationResult(completedDb, { operation_id: 'op_1', tenant_id: 'tenant_a' }), {
    operation_id: 'op_1',
    status: 'completed',
    resultType: 'success',
    summary: 'Workspace aprovisionado',
    failureReason: null,
    retryable: null,
    completedAt: '2026-03-30T12:00:00.000Z'
  });
  assert.deepEqual(await getOperationResult(failedDb, { operation_id: 'op_2', tenant_id: 'tenant_a' }), {
    operation_id: 'op_2',
    status: 'failed',
    resultType: 'failure',
    summary: null,
    failureReason: 'La cuota fue superada',
    retryable: true,
    completedAt: '2026-03-30T12:05:00.000Z'
  });
  assert.deepEqual(await getOperationResult(runningDb, { operation_id: 'op_3', tenant_id: 'tenant_a' }), {
    operation_id: 'op_3',
    status: 'running',
    resultType: 'pending',
    summary: null,
    failureReason: null,
    retryable: null,
    completedAt: null
  });
});
