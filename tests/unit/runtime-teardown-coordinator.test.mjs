import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeTeardownCoordinator, createProductionRuntimeAdapter } from '../../apps/control-plane/runtime-teardown-coordinator.mjs';

function harness(runtime) {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const store = {
    listRuntimeOwnership: async () => ({ tenantId: 't1', functions: [{ resourceId: 'f1', ksvcName: 'ksvc-f1' }], mcpState: { servers: [{ serverId: 'm1', tenantId: 't1' }] } }),
    deferAggregateCleanup: async (_pool, value) => calls.push({ defer: value }),
  };
  return { coordinator: createRuntimeTeardownCoordinator({ store, runtime }), pool, calls };
}

test('aggregate teardown is fail-closed and durable when runtime is unavailable', async () => {
  const h = harness();
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.statusCode, 202);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].defer.resources.length, 1);
});

test('aggregate teardown finalizes only after adapter confirms all owned resources absent', async () => {
  const h = harness({ cleanup: async (ownership) => { assert.equal(ownership.mcpState.servers[0].tenantId, 't1'); return { ready: true, pending: [] }; } });
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.finalize, true);
  assert.equal(h.calls.length, 0);
});

test('partial or precondition conflict remains pending', async () => {
  const h = harness({ cleanup: async () => ({ ready: false, pending: [{ resourceId: 'f1', reason: 'precondition_conflict' }] }) });
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.statusCode, 202);
  assert.equal(h.calls[0].defer.resources[0].reason, 'precondition_conflict');
});

test('production adapter deletes every owned function when runtime is ready', async () => {
  const deleted = [];
  const adapter = createProductionRuntimeAdapter({ knativeRuntime: { status: () => ({ mode: 'managed', phase: 'ready' }), canServeWorkloads: () => true }, deleteService: async (...args) => deleted.push(args) });
  const result = await adapter.cleanup({ functions: [{ resourceId: 'f1', tenantId: 't1', ksvcName: 'svc1' }], mcp: [] });
  assert.equal(result.ready, true); assert.deepEqual(deleted[0], ['svc1', { tenantId: 't1', functionResourceId: 'f1' }]);
});

test('production adapter keeps conflicts pending and skips deletion while unavailable', async () => {
  let calls = 0;
  const unavailable = createProductionRuntimeAdapter({ knativeRuntime: { status: () => ({ mode: 'managed', phase: 'unavailable' }), canServeWorkloads: () => false }, deleteService: async () => { calls += 1; } });
  assert.equal((await unavailable.cleanup({ functions: [{ resourceId: 'f1' }], mcp: [] })).ready, false); assert.equal(calls, 0);
  const conflict = createProductionRuntimeAdapter({ knativeRuntime: { status: () => ({ mode: 'managed', phase: 'ready' }), canServeWorkloads: () => true }, deleteService: async () => { throw Object.assign(new Error(), { statusCode: 409 }); } });
  const result = await conflict.cleanup({ functions: [{ resourceId: 'f1' }], mcp: [] });
  assert.equal(result.ready, false); assert.equal(result.pending[0].reason, 'precondition_conflict');
});
