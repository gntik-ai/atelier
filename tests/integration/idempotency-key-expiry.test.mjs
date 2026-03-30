import test from 'node:test';
import assert from 'node:assert/strict';

import { main as createOperationAction } from '../../services/provisioning-orchestrator/src/actions/async-operation-create.mjs';

function createExpiryStore() {
  const state = {
    operations: new Map(),
    idempotencyRecords: new Map()
  };

  const db = {
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

      if (statement === 'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2') {
        const row = state.operations.get(params[0]);
        return { rows: row && row.tenant_id === params[1] ? [{ ...row }] : [] };
      }

      if (statement.includes('SELECT * FROM idempotency_key_records')) {
        const row = state.idempotencyRecords.get(`${params[0]}::${params[1]}`);
        return { rows: row && Date.parse(row.expires_at) > Date.now() ? [{ ...row }] : [] };
      }

      if (statement.includes('INSERT INTO idempotency_key_records')) {
        const key = `${params[1]}::${params[2]}`;
        const existing = state.idempotencyRecords.get(key);
        const next = {
          record_id: params[0],
          tenant_id: params[1],
          idempotency_key: params[2],
          operation_id: params[3],
          operation_type: params[4],
          params_hash: params[5],
          created_at: params[6],
          expires_at: params[7]
        };
        if (!existing || Date.parse(existing.expires_at) <= Date.now()) {
          state.idempotencyRecords.set(key, next);
          return { rows: [{ ...next }] };
        }
        return { rows: [] };
      }

      throw new Error(`Unsupported SQL in fake db: ${statement}`);
    }
  };

  return {
    state,
    db,
    producer: { async send() {} }
  };
}

function buildParams(key) {
  return {
    operation_type: 'create-workspace',
    workspace_id: 'ws-01',
    idempotency_key: key,
    callerContext: {
      tenantId: 'tenant-a',
      correlationId: 'req-1',
      actor: { id: 'user-1', type: 'workspace_admin' }
    }
  };
}

test('expired key is treated as absent and a new operation is created', async () => {
  const store = createExpiryStore();
  store.state.idempotencyRecords.set('tenant-a::idem-1', {
    record_id: 'old-record',
    tenant_id: 'tenant-a',
    idempotency_key: 'idem-1',
    operation_id: 'old-operation',
    operation_type: 'create-workspace',
    params_hash: 'old-hash',
    created_at: '2026-03-28T00:00:00.000Z',
    expires_at: '2026-03-28T01:00:00.000Z'
  });

  const response = await createOperationAction(buildParams('idem-1'), {
    db: store.db,
    producer: store.producer,
    log: () => {}
  });

  assert.equal(response.body.idempotent, false);
  assert.notEqual(response.body.operationId, 'old-operation');
});

test('active key is deduplicated while still inside the TTL window', async () => {
  const store = createExpiryStore();
  store.state.operations.set('existing-operation', {
    operation_id: 'existing-operation',
    tenant_id: 'tenant-a',
    actor_id: 'user-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-01',
    operation_type: 'create-workspace',
    status: 'pending',
    error_summary: null,
    correlation_id: 'op:tenant-a:prev:12345678',
    idempotency_key: 'idem-2',
    saga_id: null,
    attempt_count: 0,
    max_retries: null,
    created_at: '2026-03-30T00:00:00.000Z',
    updated_at: '2026-03-30T00:00:00.000Z'
  });
  store.state.idempotencyRecords.set('tenant-a::idem-2', {
    record_id: 'active-record',
    tenant_id: 'tenant-a',
    idempotency_key: 'idem-2',
    operation_id: 'existing-operation',
    operation_type: 'create-workspace',
    params_hash: '96c90b745e79c8524d88a58717f3c34f4e32e47f5522f87f4e69c1bc53c3fd03',
    created_at: '2026-03-30T00:00:00.000Z',
    expires_at: '2999-03-30T01:00:00.000Z'
  });

  const response = await createOperationAction(buildParams('idem-2'), {
    db: store.db,
    producer: store.producer,
    log: () => {}
  });

  assert.equal(response.body.idempotent, true);
  assert.equal(response.body.operationId, 'existing-operation');
});
