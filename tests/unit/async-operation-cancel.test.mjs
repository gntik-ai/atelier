import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-cancel.mjs';

function buildParams(operation, extra = {}) {
  const calls = { transition: [], publish: [] };
  const repo = {
    findById: async () => operation,
    findByIdAnyTenant: async () => operation,
    transitionOperation: async (_db, payload) => {
      calls.transition.push(payload);
      return {
        updatedOperation: {
          ...operation,
          status: payload.new_status,
          tenant_id: operation.tenant_id,
          updated_at: '2026-03-30T00:00:00.000Z',
          cancelled_by: payload.cancelled_by,
          cancellation_reason: payload.cancellation_reason
        }
      };
    }
  };
  const events = {
    publishCancelledEvent: async (_producer, op, cancelledBy) => {
      calls.publish.push({ op, cancelledBy });
    }
  };

  return {
    db: {},
    producer: {},
    operation_id: operation.operation_id,
    callerContext: { actor: 'actor-1', tenantId: 'tenant-1', roles: [] },
    repo,
    events,
    ...extra,
    calls
  };
}

test('pending operation is cancelled directly', async () => {
  const params = buildParams({ operation_id: 'op-1', tenant_id: 'tenant-1', status: 'pending' });
  const result = await main(params);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.newStatus, 'cancelled');
  assert.equal(params.calls.transition[0].new_status, 'cancelled');
});

test('running operation moves to cancelling', async () => {
  const params = buildParams({ operation_id: 'op-1', tenant_id: 'tenant-1', status: 'running' });
  const result = await main(params);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.newStatus, 'cancelling');
  assert.equal(params.calls.transition[0].cancelled_by, 'actor-1');
  assert.equal(params.calls.publish[0].cancelledBy, 'actor-1');
});

test('terminal states return 409', async () => {
  for (const status of ['completed', 'failed', 'timed_out', 'cancelled']) {
    const result = await main(buildParams({ operation_id: 'op-1', tenant_id: 'tenant-1', status }));
    assert.equal(result.statusCode, 409);
  }
});

test('cross-tenant actor returns 403', async () => {
  const result = await main(buildParams(
    { operation_id: 'op-1', tenant_id: 'tenant-2', status: 'pending' },
    { callerContext: { actor: 'actor-1', tenantId: 'tenant-1', roles: [] } }
  ));
  assert.equal(result.statusCode, 403);
});

test('superadmin can cancel any tenant operation', async () => {
  const result = await main(buildParams(
    { operation_id: 'op-1', tenant_id: 'tenant-2', status: 'running' },
    { callerContext: { actor: 'root', tenantId: 'tenant-1', roles: ['superadmin'] } }
  ));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.newStatus, 'cancelling');
});
