import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeCleanupRepository,
  recoverFunctionCleanupObligations,
  recoverMcpCleanupObligations,
} from '../../apps/control-plane/runtime-cleanup-repository.mjs';

test('runtime-cleanup-01: defer is one atomic idempotent statement scoped by tenant and resource', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        obligation_id: 'cleanup-1', tenant_id: 'tenant-a', workspace_id: 'ws-a',
        resource_id: 'fn-a', runtime_resource_name: 'ksvc-a', correlation_id: 'corr-original',
        status: 'pending', created_at: '2026-08-07T10:00:00.000Z',
      }] };
    },
  };
  const repo = createRuntimeCleanupRepository(pool);
  const result = await repo.deferFunctionDeletion({
    tenantId: 'tenant-a', workspaceId: 'ws-a', resourceId: 'fn-a',
    runtimeResourceName: 'ksvc-a', correlationId: 'corr-retry',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WITH target AS[\s\S]+UPDATE fn_actions[\s\S]+INSERT INTO runtime_cleanup_obligations/);
  assert.match(calls[0].sql, /ON CONFLICT \(resource_type, tenant_id, resource_id, operation\)/);
  assert.deepEqual(calls[0].params, ['tenant-a', 'ws-a', 'fn-a', 'ksvc-a', 'corr-retry']);
  assert.equal(result.correlationId, 'corr-original');
  assert.equal(result.status, 'pending');
});

test('runtime-cleanup-01b: claiming also recovers a worker lease abandoned by a crashed process', async () => {
  let capturedSql = '';
  const repo = createRuntimeCleanupRepository({
    async query(sql) { capturedSql = sql; return { rows: [] }; },
  });
  await repo.claimPendingFunctions();
  assert.match(capturedSql, /status='pending'/);
  assert.match(capturedSql, /status='processing'/);
  assert.match(capturedSql, /INTERVAL '2 minutes'/);
  assert.match(capturedSql, /FOR UPDATE SKIP LOCKED/);
});

test('runtime-cleanup-02: recovery is readiness-gated, tenant-scoped, and idempotently completes', async () => {
  const deleted = [];
  const completed = [];
  const obligation = {
    obligationId: 'cleanup-1', tenantId: 'tenant-a', workspaceId: 'ws-a',
    resourceId: 'fn-a', runtimeResourceName: 'ksvc-a', correlationId: 'corr-a', status: 'pending',
  };
  const repository = {
    claimPendingFunctions: async () => [obligation],
    completeFunctionDeletion: async (value) => { completed.push(value); },
    releaseForRetry: async () => assert.fail('successful recovery must not release for retry'),
  };
  const unavailable = await recoverFunctionCleanupObligations({
    runtime: { status: () => ({ state: 'unavailable' }), canServeWorkloads: () => false }, repository,
    deleteRuntimeResource: async () => { deleted.push('unexpected'); },
  });
  assert.deepEqual(unavailable, { skipped: 'knative_unavailable', recovered: 0, failed: 0 });

  const recovered = await recoverFunctionCleanupObligations({
    runtime: { status: () => ({ state: 'ready' }), canServeWorkloads: () => true }, repository,
    deleteRuntimeResource: async (name, ownership) => { deleted.push({ name, ownership }); },
  });
  assert.deepEqual(recovered, { recovered: 1, failed: 0 });
  assert.deepEqual(deleted, [{
    name: 'ksvc-a',
    ownership: { tenantId: 'tenant-a', functionResourceId: 'fn-a' },
  }]);
  assert.deepEqual(completed, [{ obligationId: 'cleanup-1', tenantId: 'tenant-a', resourceId: 'fn-a' }]);
});

test('runtime-cleanup-02b: ownership mismatch retains logical state and the durable retry', async () => {
  const released = [];
  let completions = 0;
  const obligation = {
    obligationId: 'cleanup-1', tenantId: 'tenant-a', workspaceId: 'ws-a',
    resourceId: 'fn-a', runtimeResourceName: 'ksvc-a', correlationId: 'corr-a',
  };
  const result = await recoverFunctionCleanupObligations({
    runtime: { status: () => ({ state: 'ready' }), canServeWorkloads: () => true },
    repository: {
      claimPendingFunctions: async () => [obligation],
      completeFunctionDeletion: async () => { completions += 1; },
      releaseForRetry: async (value) => released.push(value),
    },
    deleteRuntimeResource: async (_name, ownership) => {
      assert.deepEqual(ownership, { tenantId: 'tenant-a', functionResourceId: 'fn-a' });
      throw Object.assign(new Error('retained'), {
        code: 'FN_RUNTIME_OWNERSHIP_MISMATCH', statusCode: 409, retained: true,
      });
    },
  });
  assert.deepEqual(result, { recovered: 0, failed: 1 });
  assert.equal(completions, 0);
  assert.deepEqual(released, [{
    obligationId: obligation.obligationId,
    tenantId: obligation.tenantId,
    errorCode: 'RUNTIME_DELETE_FAILED',
  }]);
});

test('runtime-cleanup-03: MCP defer uses the caller transaction and preserves the first correlation on retry', async () => {
  const calls = [];
  const transactionClient = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        obligation_id: 'mcp:tenant-a:srv-a:delete', tenant_id: 'tenant-a', workspace_id: 'ws-a',
        resource_id: 'srv-a', runtime_resource_name: 'mcp-srv-a', correlation_id: 'corr-original', status: 'pending',
      }] };
    },
  };
  const repo = createRuntimeCleanupRepository({ query: async () => assert.fail('must use transaction client') });
  const result = await repo.deferMcpDeletion({
    tenantId: 'tenant-a', workspaceId: 'ws-a', resourceId: 'srv-a',
    runtimeResourceName: 'mcp-srv-a', correlationId: 'corr-retry',
  }, transactionClient);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO runtime_cleanup_obligations/);
  assert.match(calls[0].sql, /ON CONFLICT \(resource_type, tenant_id, resource_id, operation\)/);
  assert.equal(result.correlationId, 'corr-original');
});

test('runtime-cleanup-04: MCP recovery deletes owned resources then atomically completes logical state', async () => {
  const order = [];
  const obligation = {
    obligationId: 'mcp:tenant-a:srv-a:delete', tenantId: 'tenant-a', workspaceId: 'ws-a',
    resourceId: 'srv-a', runtimeResourceName: 'mcp-srv-a', correlationId: 'corr-a', status: 'processing',
  };
  const result = await recoverMcpCleanupObligations({
    runtime: { status: () => ({ state: 'ready' }), canServeWorkloads: () => true },
    repository: {
      claimPendingMcps: async () => [obligation],
      releaseForRetry: async () => assert.fail('successful cleanup must not be released'),
    },
    deleteOwnedRuntimeResources: async (value) => { order.push(['runtime', value.resourceId]); },
    completeDeferredDeletion: async (value) => { order.push(['state', value.resourceId]); },
  });
  assert.deepEqual(result, { recovered: 1, failed: 0 });
  assert.deepEqual(order, [['runtime', 'srv-a'], ['state', 'srv-a']]);
});

test('runtime-cleanup-05: failed/retried MCP cleanup remains pending and never completes state', async () => {
  const released = [];
  const obligation = { obligationId: 'mcp:a:srv:delete', tenantId: 'a', resourceId: 'srv' };
  const result = await recoverMcpCleanupObligations({
    runtime: { status: () => ({ state: 'ready' }), canServeWorkloads: () => true },
    repository: {
      claimPendingMcps: async () => [obligation],
      releaseForRetry: async (value) => released.push(value),
    },
    deleteOwnedRuntimeResources: async () => { throw new Error('temporary API outage'); },
    completeDeferredDeletion: async () => assert.fail('state cannot complete while resources remain'),
  });
  assert.deepEqual(result, { recovered: 0, failed: 1 });
  assert.deepEqual(released, [{ obligationId: obligation.obligationId, tenantId: 'a', errorCode: 'RUNTIME_DELETE_FAILED' }]);
});
