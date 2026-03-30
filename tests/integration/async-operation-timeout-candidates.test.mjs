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
  findTimedOutCandidates
} from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

maybeTest('findTimedOutCandidates returns expired running operations and atomic transition resolves race', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO operation_policies (operation_type, timeout_minutes, orphan_threshold_minutes, cancelling_timeout_minutes) VALUES ('create-workspace', 60, 30, 5) ON CONFLICT (operation_type) DO UPDATE SET timeout_minutes = EXCLUDED.timeout_minutes");
    await client.query("INSERT INTO async_operations (operation_id, tenant_id, actor_id, actor_type, operation_type, status, correlation_id, created_at, updated_at) VALUES ('op-timeout-old', 'tenant-1', 'actor-1', 'tenant_owner', 'create-workspace', 'running', 'op:tenant-1:abc:12345678', NOW() - interval '2 hours', NOW() - interval '2 hours'), ('op-timeout-new', 'tenant-1', 'actor-1', 'tenant_owner', 'create-workspace', 'running', 'op:tenant-1:def:12345678', NOW() - interval '10 minutes', NOW() - interval '10 minutes') ON CONFLICT DO NOTHING");
    const candidates = await findTimedOutCandidates(client, { nowIso: new Date().toISOString() });
    assert.equal(candidates.some((row) => row.operation_id === 'op-timeout-old'), true);
    assert.equal(candidates.some((row) => row.operation_id === 'op-timeout-new'), false);
    const first = await atomicTransitionSystem(client, { operation_id: 'op-timeout-old', tenant_id: 'tenant-1', new_status: 'timed_out', reason: 'timeout exceeded' });
    assert.equal(first.updatedOperation.status, 'timed_out');
    await assert.rejects(() => atomicTransitionSystem(client, { operation_id: 'op-timeout-old', tenant_id: 'tenant-1', new_status: 'timed_out', reason: 'timeout exceeded' }), { code: 'INVALID_TRANSITION' });
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
