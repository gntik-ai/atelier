import test from 'node:test';
import assert from 'node:assert/strict';

let Client;
try {
  ({ Client } = await import('pg'));
} catch {}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const shouldRun = Boolean(Client && databaseUrl);
const maybeTest = shouldRun ? test : test.skip;

import {
  atomicTransitionSystem,
  findOrphanCandidates,
  findStaleCancellingCandidates
} from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

maybeTest('orphan candidate queries return stale operations and system transition is safe', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO operation_policies (operation_type, timeout_minutes, orphan_threshold_minutes, cancelling_timeout_minutes) VALUES ('recoverable-op', 60, 30, 5) ON CONFLICT (operation_type) DO UPDATE SET orphan_threshold_minutes = EXCLUDED.orphan_threshold_minutes, cancelling_timeout_minutes = EXCLUDED.cancelling_timeout_minutes");
    await client.query("INSERT INTO async_operations (operation_id, tenant_id, actor_id, actor_type, operation_type, status, correlation_id, created_at, updated_at, cancelled_by) VALUES ('op-orphan-running', 'tenant-1', 'actor-1', 'tenant_owner', 'recoverable-op', 'running', 'op:tenant-1:abc:12345678', NOW() - interval '2 hours', NOW() - interval '2 hours', NULL), ('op-orphan-pending', 'tenant-1', 'actor-1', 'tenant_owner', 'recoverable-op', 'pending', 'op:tenant-1:def:12345678', NOW() - interval '2 hours', NOW() - interval '2 hours', NULL), ('op-orphan-cancelling', 'tenant-1', 'actor-1', 'tenant_owner', 'recoverable-op', 'cancelling', 'op:tenant-1:ghi:12345678', NOW() - interval '2 hours', NOW() - interval '2 hours', 'actor-1') ON CONFLICT DO NOTHING");
    const orphans = await findOrphanCandidates(client, { nowIso: new Date().toISOString() });
    const staleCancelling = await findStaleCancellingCandidates(client, { nowIso: new Date().toISOString() });
    assert.equal(orphans.some((row) => row.operation_id === 'op-orphan-running'), true);
    assert.equal(orphans.some((row) => row.operation_id === 'op-orphan-pending'), true);
    assert.equal(staleCancelling.some((row) => row.operation_id === 'op-orphan-cancelling'), true);
    const first = await atomicTransitionSystem(client, { operation_id: 'op-orphan-running', tenant_id: 'tenant-1', new_status: 'failed', reason: 'orphaned — no progress detected' });
    assert.equal(first.updatedOperation.status, 'failed');
    await assert.rejects(() => atomicTransitionSystem(client, { operation_id: 'op-orphan-running', tenant_id: 'tenant-1', new_status: 'failed', reason: 'orphaned — no progress detected' }), { code: 'INVALID_TRANSITION' });
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
