import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeCleanupRepository,
  recoverFunctionCleanupObligations,
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
    deleteRuntimeResource: async (name) => { deleted.push(name); },
  });
  assert.deepEqual(recovered, { recovered: 1, failed: 0 });
  assert.deepEqual(deleted, ['ksvc-a']);
  assert.deepEqual(completed, [{ obligationId: 'cleanup-1', tenantId: 'tenant-a', resourceId: 'fn-a' }]);
});
