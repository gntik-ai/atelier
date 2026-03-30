import test from 'node:test';
import assert from 'node:assert/strict';

import { main as createOperationAction } from '../../services/provisioning-orchestrator/src/actions/async-operation-create.mjs';
import { createOperation } from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

function createIdempotencyStore() {
  const state = {
    operations: new Map(),
    idempotencyRecords: new Map(),
    reservations: new Map(),
    sentEvents: []
  };

  function createClient() {
    const tx = {
      active: false,
      stagedOperations: new Map(),
      stagedIdempotencyRecords: new Map(),
      ownedKeys: new Set()
    };

    return {
      async query(sql, params = []) {
        const statement = sql.replace(/\s+/g, ' ').trim();

        if (statement === 'BEGIN') {
          tx.active = true;
          return { rows: [] };
        }

        if (statement === 'COMMIT') {
          for (const [id, row] of tx.stagedOperations.entries()) {
            state.operations.set(id, { ...row });
          }
          for (const [key, row] of tx.stagedIdempotencyRecords.entries()) {
            state.idempotencyRecords.set(key, { ...row });
            state.reservations.get(key)?.resolve();
            state.reservations.delete(key);
          }
          tx.active = false;
          tx.stagedOperations.clear();
          tx.stagedIdempotencyRecords.clear();
          tx.ownedKeys.clear();
          return { rows: [] };
        }

        if (statement === 'ROLLBACK') {
          for (const key of tx.ownedKeys) {
            state.reservations.get(key)?.resolve();
            state.reservations.delete(key);
          }
          tx.active = false;
          tx.stagedOperations.clear();
          tx.stagedIdempotencyRecords.clear();
          tx.ownedKeys.clear();
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
          if (tx.active) {
            tx.stagedOperations.set(row.operation_id, row);
          } else {
            state.operations.set(row.operation_id, row);
          }
          return { rows: [{ ...row }] };
        }

        if (statement === 'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2') {
          const row = tx.stagedOperations.get(params[0]) ?? state.operations.get(params[0]);
          return { rows: row && row.tenant_id === params[1] ? [{ ...row }] : [] };
        }

        if (statement.includes('SELECT * FROM idempotency_key_records')) {
          const key = `${params[0]}::${params[1]}`;
          const row = tx.stagedIdempotencyRecords.get(key) ?? state.idempotencyRecords.get(key);
          if (!row) {
            return { rows: [] };
          }
          return { rows: Date.parse(row.expires_at) > Date.now() ? [{ ...row }] : [] };
        }

        if (statement.includes('INSERT INTO idempotency_key_records')) {
          const key = `${params[1]}::${params[2]}`;
          const existing = state.idempotencyRecords.get(key);
          if (existing && Date.parse(existing.expires_at) > Date.now()) {
            return { rows: [] };
          }

          const reservation = state.reservations.get(key);
          if (reservation && reservation.owner !== tx) {
            await reservation.promise;
            return { rows: [] };
          }

          if (!reservation) {
            let resolve;
            const promise = new Promise((done) => {
              resolve = done;
            });
            state.reservations.set(key, { owner: tx, promise, resolve });
            tx.ownedKeys.add(key);
          }

          const row = {
            record_id: params[0],
            tenant_id: params[1],
            idempotency_key: params[2],
            operation_id: params[3],
            operation_type: params[4],
            params_hash: params[5],
            created_at: params[6],
            expires_at: params[7]
          };
          tx.stagedIdempotencyRecords.set(key, row);
          return { rows: [{ ...row }] };
        }

        throw new Error(`Unsupported SQL in fake db: ${statement}`);
      }
    };
  }

  return { state, createClient };
}

function createProducer(state) {
  return {
    async send(message) {
      state.sentEvents.push(message);
    }
  };
}

function buildParams(tenantId, key) {
  return {
    operation_type: 'create-workspace',
    workspace_id: 'ws-01',
    idempotency_key: key,
    callerContext: {
      tenantId,
      correlationId: `req-${tenantId}`,
      actor: { id: 'user-1', type: 'workspace_admin' }
    }
  };
}

test('concurrent requests with the same key create exactly one operation for a tenant', async () => {
  const store = createIdempotencyStore();
  const producer = createProducer(store.state);

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      createOperationAction(buildParams('tenant-a', 'idem-1'), {
        db: store.createClient(),
        producer,
        log: () => {}
      })
    )
  );

  const operationIds = new Set(responses.map((response) => response.body.operationId));
  assert.equal(operationIds.size, 1);
  assert.equal(store.state.operations.size, 1);
  assert.equal(store.state.idempotencyRecords.size, 1);
  assert.ok(store.state.sentEvents.some((message) => message.topic === 'console.async-operation.deduplicated'));
});

test('same key across tenants remains isolated', async () => {
  const store = createIdempotencyStore();

  const first = await createOperationAction(buildParams('tenant-a', 'idem-1'), {
    db: store.createClient(),
    producer: createProducer(store.state),
    log: () => {}
  });
  const second = await createOperationAction(buildParams('tenant-b', 'idem-1'), {
    db: store.createClient(),
    producer: createProducer(store.state),
    log: () => {}
  });

  assert.notEqual(first.body.operationId, second.body.operationId);
  assert.equal(store.state.operations.size, 2);
  assert.equal(store.state.idempotencyRecords.size, 2);
});
