import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOperationLogs,
  getOperationResult,
  listOperations
} from '../../services/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
const hasDatabase = Boolean(connectionString);

async function connectClient() {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function seedSchema(client) {
  await client.query(`
    CREATE TEMP TABLE async_operations (
      operation_id UUID PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      workspace_id TEXT,
      operation_type TEXT NOT NULL,
      status TEXT NOT NULL,
      result JSONB,
      error_summary JSONB,
      correlation_id TEXT,
      idempotency_key TEXT,
      saga_id UUID,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ
    );

    CREATE TEMP TABLE async_operation_log_entries (
      log_entry_id UUID PRIMARY KEY,
      operation_id UUID NOT NULL REFERENCES async_operations(operation_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      metadata JSONB
    );
  `);
}

test('I01/I02/I03 listOperations enforces tenant isolation and allows superadmin cross-tenant reads', { skip: !hasDatabase }, async () => {
  const client = await connectClient();

  try {
    await seedSchema(client);
    await client.query(
      `INSERT INTO async_operations (
        operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type,
        status, result, error_summary, correlation_id, idempotency_key, saga_id, created_at, updated_at, completed_at
      ) VALUES
        ('00000000-0000-4000-8000-000000000001', 'tenant_a', 'usr_1', 'tenant_owner', 'wrk_1', 'workspace.create', 'running', NULL, NULL, 'corr_a', NULL, NULL, NOW(), NOW(), NULL),
        ('00000000-0000-4000-8000-000000000002', 'tenant_b', 'usr_2', 'tenant_owner', 'wrk_2', 'workspace.create', 'completed', '{"summary":"ok"}', NULL, 'corr_b', NULL, NULL, NOW(), NOW(), NOW())`
    );

    const tenantA = await listOperations(client, { tenant_id: 'tenant_a', limit: 20, offset: 0 });
    const superadmin = await listOperations(client, { tenant_id: null, isSuperadmin: true, limit: 20, offset: 0 });

    assert.equal(tenantA.items.length, 1);
    assert.equal(tenantA.items[0].tenant_id, 'tenant_a');
    assert.equal(superadmin.total, 2);

    await assert.rejects(
      () => listOperations(client, { tenant_id: null, isSuperadmin: false }),
      (error) => error.code === 'TENANT_ISOLATION_VIOLATION'
    );
  } finally {
    await client.end();
  }
});

test('I04/I06 listOperations paginates 500 rows within performance budget', { skip: !hasDatabase }, async () => {
  const client = await connectClient();

  try {
    await seedSchema(client);
    await client.query(`
      INSERT INTO async_operations (
        operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type,
        status, result, error_summary, correlation_id, idempotency_key, saga_id, created_at, updated_at, completed_at
      )
      SELECT
        ('00000000-0000-4000-8000-' || LPAD(gs::text, 12, '0'))::uuid,
        'tenant_perf',
        'usr_perf',
        'tenant_owner',
        'wrk_perf',
        'workspace.create',
        CASE WHEN gs % 2 = 0 THEN 'completed' ELSE 'running' END,
        NULL,
        NULL,
        'corr_' || gs,
        NULL,
        NULL,
        NOW() - (gs || ' minutes')::interval,
        NOW() - (gs || ' minutes')::interval,
        NULL
      FROM generate_series(1, 500) AS gs
    `);

    const startedAt = Date.now();
    const page = await listOperations(client, { tenant_id: 'tenant_perf', limit: 10, offset: 20 });
    const durationMs = Date.now() - startedAt;

    assert.equal(page.items.length, 10);
    assert.equal(page.total, 500);
    assert.equal(page.pagination.offset, 20);
    assert.ok(durationMs < 3000, `Expected < 3000ms, got ${durationMs}ms`);
  } finally {
    await client.end();
  }
});

test('I05 getOperationLogs and getOperationResult respect tenant ownership', { skip: !hasDatabase }, async () => {
  const client = await connectClient();

  try {
    await seedSchema(client);
    await client.query(
      `INSERT INTO async_operations (
        operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type,
        status, result, error_summary, correlation_id, idempotency_key, saga_id, created_at, updated_at, completed_at
      ) VALUES
        ('00000000-0000-4000-8000-000000000111', 'tenant_logs', 'usr_logs', 'tenant_owner', 'wrk_logs', 'workspace.create', 'failed', NULL, '{"message":"Falló el aprovisionamiento","retryable":false}', 'corr_logs', NULL, NULL, NOW(), NOW(), NOW())`
    );
    await client.query(
      `INSERT INTO async_operation_log_entries (
        log_entry_id, operation_id, tenant_id, level, message, occurred_at, metadata
      ) VALUES
        ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000111', 'tenant_logs', 'info', 'Inicio', NOW() - interval '1 minute', NULL),
        ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000111', 'tenant_logs', 'error', 'Falló el aprovisionamiento', NOW(), NULL)`
    );

    const visibleLogs = await getOperationLogs(client, {
      operation_id: '00000000-0000-4000-8000-000000000111',
      tenant_id: 'tenant_logs',
      limit: 20,
      offset: 0
    });
    const hiddenLogs = await getOperationLogs(client, {
      operation_id: '00000000-0000-4000-8000-000000000111',
      tenant_id: 'tenant_other',
      limit: 20,
      offset: 0
    });
    const result = await getOperationResult(client, {
      operation_id: '00000000-0000-4000-8000-000000000111',
      tenant_id: 'tenant_logs'
    });

    assert.equal(visibleLogs.total, 2);
    assert.equal(hiddenLogs.total, 0);
    assert.equal(result?.resultType, 'failure');
    assert.equal(result?.failureReason, 'Falló el aprovisionamiento');
  } finally {
    await client.end();
  }
});
