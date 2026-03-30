import test from 'node:test';
import assert from 'node:assert/strict';

let Client;
try {
  ({ Client } = await import('pg'));
} catch {}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const shouldRun = Boolean(Client && databaseUrl);
const maybeTest = shouldRun ? test : test.skip;

import { findTimedOutCandidates } from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

maybeTest('specific operation policies are honored over fallback', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO operation_policies (operation_type, timeout_minutes, orphan_threshold_minutes, cancelling_timeout_minutes) VALUES ('create-workspace', 10, 30, 5), ('enable-service', 5, 30, 5), ('*', 60, 30, 5) ON CONFLICT (operation_type) DO UPDATE SET timeout_minutes = EXCLUDED.timeout_minutes");
    await client.query("INSERT INTO async_operations (operation_id, tenant_id, actor_id, actor_type, operation_type, status, correlation_id, created_at, updated_at) VALUES ('op-policy-a', 'tenant-1', 'actor-1', 'tenant_owner', 'create-workspace', 'running', 'op:tenant-1:abc:12345678', NOW() - interval '8 minutes', NOW() - interval '8 minutes'), ('op-policy-b', 'tenant-1', 'actor-1', 'tenant_owner', 'enable-service', 'running', 'op:tenant-1:def:12345678', NOW() - interval '8 minutes', NOW() - interval '8 minutes'), ('op-policy-c', 'tenant-1', 'actor-1', 'tenant_owner', 'other-op', 'running', 'op:tenant-1:ghi:12345678', NOW() - interval '8 minutes', NOW() - interval '8 minutes') ON CONFLICT DO NOTHING");
    const candidates = await findTimedOutCandidates(client, { nowIso: new Date().toISOString() });
    assert.equal(candidates.some((row) => row.operation_id === 'op-policy-a'), false);
    assert.equal(candidates.some((row) => row.operation_id === 'op-policy-b'), true);
    assert.equal(candidates.some((row) => row.operation_id === 'op-policy-c'), false);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
