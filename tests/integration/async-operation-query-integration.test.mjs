import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureSagaSchema, startSaga } from '../../apps/control-plane/saga.mjs';
import { main as queryAction } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs';
import { main as retryAction } from '../../packages/provisioning-orchestrator/src/actions/async-operation-retry.mjs';
import { main as retryOverrideAction } from '../../packages/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs';
import { createOperation as buildOperation } from '../../packages/provisioning-orchestrator/src/models/async-operation.mjs';
import {
  getOperationResult,
  listOperations
} from '../../packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs';
import {
  atomicTransitionSystem,
  createOperation,
  findById,
  setManualInterventionRequired,
  transitionOperation,
  updateFailureClassification
} from '../../packages/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

let Client;
try {
  const pg = await import('pg');
  Client = pg.Client ?? pg.default?.Client;
} catch {}

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
const maybeTest = Client && connectionString ? test : test.skip;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_DIR = resolve(REPO_ROOT, 'packages/provisioning-orchestrator/src/migrations');
const PRE_079_MIGRATIONS = [
  '073-async-operation-tables.sql',
  '074-async-operation-log-entries.sql',
  '075-idempotency-retry-tables.sql',
  '076-timeout-cancel-recovery.sql',
  '078-retry-semantics-intervention.sql'
];
const MIGRATIONS = [...PRE_079_MIGRATIONS, '079-async-operation-results.sql'];
let schemaSequence = 0;
const AWS_ACCESS_KEY_FIXTURE = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const AWS_SECRET_KEY_FIXTURE = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'ABCD'].join('');
const GITHUB_PAT_FIXTURE = ['ghp', '_123456789012345678901234567890123456'].join('');
const OPENAI_KEY_FIXTURE = ['sk', '-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'].join('');
const STRIPE_KEY_FIXTURE = ['sk', '_test_abcdefghijklmnopqrstuvwxyz012345'].join('');

async function applyMigrations(client, names) {
  for (const name of names) {
    const sql = await readFile(resolve(MIGRATION_DIR, name), 'utf8');
    await client.query(sql);
  }
}

async function withIsolatedSchema(run) {
  const client = new Client({ connectionString });
  await client.connect();
  const schema = `c11_${process.pid}_${schemaSequence += 1}_${randomUUID().replaceAll('-', '')}`;

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    return await run(client, schema);
  } finally {
    await client.query('RESET search_path').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await client.end();
  }
}

function operationInput(tenantId, operationType = 'workspace.create') {
  return buildOperation({
    tenant_id: tenantId,
    actor_id: `actor-${tenantId}`,
    actor_type: 'tenant_owner',
    operation_type: operationType
  });
}

async function persistOperation(client, tenantId, operationType) {
  return createOperation(client, operationInput(tenantId, operationType));
}

async function moveToRunning(client, operation) {
  return transitionOperation(client, {
    operation_id: operation.operation_id,
    tenant_id: operation.tenant_id,
    actor_id: operation.actor_id,
    new_status: 'running'
  });
}

function queryParams(tenantId, queryType, operationId, extra = {}) {
  return {
    __ow_headers: {
      'x-auth-subject': `reader-${tenantId}`,
      'x-actor-type': 'tenant_owner',
      'x-tenant-id': tenantId,
      'x-correlation-id': `request-${tenantId}`
    },
    queryType,
    operationId,
    ...extra
  };
}

function instant(value) {
  return value == null ? null : new Date(value).toISOString();
}

maybeTest('C-11 migration chain exposes exact idempotent result catalog and repairs the real pre-079 query', async () => {
  await withIsolatedSchema(async (client) => {
    assert.deepEqual(MIGRATIONS, [
      '073-async-operation-tables.sql',
      '074-async-operation-log-entries.sql',
      '075-idempotency-retry-tables.sql',
      '076-timeout-cancel-recovery.sql',
      '078-retry-semantics-intervention.sql',
      '079-async-operation-results.sql'
    ]);

    await applyMigrations(client, PRE_079_MIGRATIONS);
    const operationId = '00000000-0000-4000-8000-000000000079';
    await client.query(
      `INSERT INTO async_operations (
         operation_id, tenant_id, actor_id, actor_type, operation_type, status, correlation_id
       ) VALUES ($1, 'tenant-migration', 'actor-migration', 'tenant_owner',
                 'migration.proof', 'pending', 'corr-migration')`,
      [operationId]
    );

    await assert.rejects(
      () => getOperationResult(client, {
        operation_id: operationId,
        tenant_id: 'tenant-migration'
      }),
      (error) => error.code === '42703'
    );
    await assert.rejects(
      () => queryAction(
        queryParams('tenant-migration', 'result', operationId),
        { db: client, log() {} }
      ),
      (error) => error.code === '42703' && error.statusCode === 500
    );

    await applyMigrations(client, ['079-async-operation-results.sql']);
    const repaired = await getOperationResult(client, {
      operation_id: operationId,
      tenant_id: 'tenant-migration'
    });
    assert.equal(repaired?.resultType, 'pending');
    assert.equal(repaired?.completedAt, null);
    const repairedAction = await queryAction(
      queryParams('tenant-migration', 'result', operationId),
      { db: client, log() {} }
    );
    assert.equal(repairedAction.statusCode, 200);
    assert.equal(repairedAction.body.resultType, 'pending');

    const terminalAt = '2026-07-01T10:00:00.000Z';
    await client.query(
      `UPDATE async_operations
          SET status = 'completed',
              result = '{"summary":"preserved across rerun"}'::jsonb,
              completed_at = $2,
              updated_at = $2
        WHERE operation_id = $1`,
      [operationId, terminalAt]
    );

    await applyMigrations(client, MIGRATIONS);

    const { rows: columns } = await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'async_operations'
          AND column_name IN ('result', 'completed_at')
        ORDER BY column_name`
    );
    assert.deepEqual(columns, [
      {
        column_name: 'completed_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'YES',
        column_default: null
      },
      {
        column_name: 'result',
        data_type: 'jsonb',
        udt_name: 'jsonb',
        is_nullable: 'YES',
        column_default: null
      }
    ]);

    const { rows: resultIndexes } = await client.query(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'async_operations'
          AND indexdef ~* '\\m(result|completed_at)\\M'`
    );
    assert.deepEqual(resultIndexes, []);

    const { rows: preservedRows } = await client.query(
      'SELECT result, completed_at FROM async_operations WHERE operation_id = $1',
      [operationId]
    );
    assert.deepEqual(preservedRows[0].result, { summary: 'preserved across rerun' });
    assert.equal(instant(preservedRows[0].completed_at), terminalAt);
  });
});

maybeTest('C-11 repository lifecycle stores safe terminal data and preserves terminal invariants', async () => {
  await withIsolatedSchema(async (client) => {
    await applyMigrations(client, MIGRATIONS);

    const completed = await persistOperation(client, 'tenant-lifecycle', 'workspace.create');
    assert.equal(completed.status, 'pending');
    assert.equal(completed.result, null);
    assert.equal(completed.completed_at, null);

    const running = await moveToRunning(client, completed);
    assert.equal(running.updatedOperation.result, null);
    assert.equal(running.updatedOperation.completed_at, null);

    const completion = await transitionOperation(client, {
      operation_id: completed.operation_id,
      tenant_id: completed.tenant_id,
      actor_id: completed.actor_id,
      new_status: 'completed',
      result: { summary: 'Workspace provisioned', counts: { databases: 1 } }
    });
    assert.deepEqual(completion.updatedOperation.result, {
      summary: 'Workspace provisioned',
      counts: { databases: 1 }
    });
    assert.equal(
      instant(completion.updatedOperation.completed_at),
      instant(completion.updatedOperation.updated_at)
    );

    const failed = await persistOperation(client, 'tenant-lifecycle', 'workspace.delete');
    await moveToRunning(client, failed);
    const failure = await transitionOperation(client, {
      operation_id: failed.operation_id,
      tenant_id: failed.tenant_id,
      actor_id: failed.actor_id,
      new_status: 'failed',
      error_summary: {
        code: 'DELETE_FAILED',
        message: 'Workspace deletion failed cleanly.',
        failedStep: 'delete'
      },
      result: { summary: 'partial output must not persist' }
    });
    assert.equal(failure.updatedOperation.result, null);
    assert.equal(instant(failure.updatedOperation.completed_at), instant(failure.updatedOperation.updated_at));

    const prototypeSafe = await persistOperation(
      client,
      'tenant-lifecycle',
      'workspace.prototype-safe'
    );
    await moveToRunning(client, prototypeSafe);
    let inheritedHookCalls = 0;
    Object.prototype.toPostgres = () => {
      inheritedHookCalls += 1;
      return '{"password":"must-not-persist"}';
    };
    try {
      await transitionOperation(client, {
        operation_id: prototypeSafe.operation_id,
        tenant_id: prototypeSafe.tenant_id,
        actor_id: prototypeSafe.actor_id,
        new_status: 'failed',
        error_summary: {
          code: 'PROTOTYPE_SAFE',
          message: 'Failure data remains canonical.',
          failedStep: 'verify'
        }
      });
    } finally {
      delete Object.prototype.toPostgres;
    }
    assert.equal(inheritedHookCalls, 0);
    const { rows: prototypeSafeRows } = await client.query(
      `SELECT ao.error_summary, transition.metadata
         FROM async_operations ao
         JOIN async_operation_transitions transition
           ON transition.operation_id = ao.operation_id
          AND transition.new_status = 'failed'
        WHERE ao.operation_id = $1`,
      [prototypeSafe.operation_id]
    );
    assert.deepEqual(prototypeSafeRows[0].error_summary, {
      code: 'PROTOTYPE_SAFE',
      message: 'Failure data remains canonical.',
      failedStep: 'verify'
    });
    assert.doesNotMatch(
      JSON.stringify(prototypeSafeRows[0].metadata),
      /must-not-persist|password/
    );

    const systemPrototypeSafe = await persistOperation(
      client,
      'tenant-lifecycle',
      'workspace.system-prototype-safe'
    );
    await moveToRunning(client, systemPrototypeSafe);
    Object.prototype.toPostgres = () => {
      inheritedHookCalls += 1;
      return '{"password":"must-not-persist"}';
    };
    try {
      await atomicTransitionSystem(client, {
        operation_id: systemPrototypeSafe.operation_id,
        tenant_id: systemPrototypeSafe.tenant_id,
        new_status: 'failed',
        reason: 'Recovery failed cleanly.'
      });
    } finally {
      delete Object.prototype.toPostgres;
    }
    assert.equal(inheritedHookCalls, 0);
    const { rows: systemPrototypeSafeRows } = await client.query(
      `SELECT error_summary
         FROM async_operations
        WHERE operation_id = $1`,
      [systemPrototypeSafe.operation_id]
    );
    assert.deepEqual(systemPrototypeSafeRows[0].error_summary, {
      code: 'ASYNC_OPERATION_RECOVERED',
      message: 'Recovery failed cleanly.',
      failedStep: 'system-recovery'
    });

    const failedTerminalAt = instant(failure.updatedOperation.completed_at);
    await updateFailureClassification(client, failed.operation_id, {
      failureCategory: 'transient',
      failureErrorCode: 'DELETE_FAILED',
      failureDescription: 'Retry deletion.',
      failureSuggestedActions: ['Retry the operation']
    }, failed.tenant_id);
    const classified = await findById(client, {
      operation_id: failed.operation_id,
      tenant_id: failed.tenant_id
    });
    assert.equal(classified.result, null);
    assert.equal(instant(classified.completed_at), failedTerminalAt);
    await setManualInterventionRequired(client, failed.operation_id, true, failed.tenant_id);
    const flagged = await findById(client, {
      operation_id: failed.operation_id,
      tenant_id: failed.tenant_id
    });
    assert.equal(flagged.result, null);
    assert.equal(instant(flagged.completed_at), failedTerminalAt);

    const timedOut = await persistOperation(client, 'tenant-lifecycle', 'workspace.timeout');
    await moveToRunning(client, timedOut);
    const timeout = await atomicTransitionSystem(client, {
      operation_id: timedOut.operation_id,
      tenant_id: timedOut.tenant_id,
      new_status: 'timed_out',
      reason: 'timeout exceeded'
    });
    assert.equal(timeout.updatedOperation.result, null);
    assert.equal(instant(timeout.updatedOperation.completed_at), instant(timeout.updatedOperation.updated_at));

    const cancelled = await persistOperation(client, 'tenant-lifecycle', 'workspace.cancel');
    const cancellation = await transitionOperation(client, {
      operation_id: cancelled.operation_id,
      tenant_id: cancelled.tenant_id,
      actor_id: cancelled.actor_id,
      new_status: 'cancelled'
    });
    assert.equal(cancellation.updatedOperation.result, null);
    assert.equal(
      instant(cancellation.updatedOperation.completed_at),
      instant(cancellation.updatedOperation.updated_at)
    );

    const cancelling = await persistOperation(client, 'tenant-lifecycle', 'workspace.cancel-running');
    await moveToRunning(client, cancelling);
    const cancellationRequested = await transitionOperation(client, {
      operation_id: cancelling.operation_id,
      tenant_id: cancelling.tenant_id,
      actor_id: cancelling.actor_id,
      new_status: 'cancelling',
      cancellation_reason: 'operator request',
      cancelled_by: cancelling.actor_id
    });
    assert.equal(cancellationRequested.updatedOperation.result, null);
    assert.equal(cancellationRequested.updatedOperation.completed_at, null);

    const unsafe = await persistOperation(client, 'tenant-lifecycle', 'workspace.unsafe');
    await moveToRunning(client, unsafe);
    await assert.rejects(
      () => transitionOperation(client, {
        operation_id: unsafe.operation_id,
        tenant_id: unsafe.tenant_id,
        actor_id: unsafe.actor_id,
        new_status: 'completed',
        result: {
          summary: 'postgres://admin:secret@db.internal/workspace',
          accessToken: 'token-value'
        }
      }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
    );
    const afterUnsafe = await findById(client, {
      operation_id: unsafe.operation_id,
      tenant_id: unsafe.tenant_id
    });
    assert.equal(afterUnsafe.status, 'running');
    assert.equal(afterUnsafe.result, null);
    assert.equal(afterUnsafe.completed_at, null);

    const circular = {};
    circular.self = circular;
    await assert.rejects(
      () => transitionOperation(client, {
        operation_id: unsafe.operation_id,
        tenant_id: unsafe.tenant_id,
        actor_id: unsafe.actor_id,
        new_status: 'completed',
        result: circular
      }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
    );
  });
});

maybeTest('C-11 real PostgreSQL round-trips every safe JSONB result shape', async () => {
  await withIsolatedSchema(async (client) => {
    await applyMigrations(client, MIGRATIONS);

    const safeResults = [
      'Safe scalar summary',
      42,
      false,
      ['safe', 2, true],
      {
        summary: 'Basic authentication and Bearer authentication documentation are safe. ✅ 😀',
        counts: { created: 2 },
        ['completed😀']: true
      }
    ];

    for (const [index, safeResult] of safeResults.entries()) {
      const operation = await persistOperation(
        client,
        'tenant-jsonb',
        `workspace.jsonb.${index}`
      );
      await moveToRunning(client, operation);
      const transition = await transitionOperation(client, {
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id,
        actor_id: operation.actor_id,
        new_status: 'completed',
        result: safeResult
      });

      assert.deepEqual(transition.updatedOperation.result, safeResult);
      const stored = await findById(client, {
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id
      });
      assert.equal(stored.status, 'completed');
      assert.deepEqual(stored.result, safeResult);
      assert.notEqual(stored.completed_at, null);
    }
  });
});

maybeTest('C-11 real PostgreSQL rejects credential aliases and values without terminalizing', async () => {
  await withIsolatedSchema(async (client) => {
    await applyMigrations(client, MIGRATIONS);
    const operation = await persistOperation(client, 'tenant-safe-boundary', 'workspace.safe-boundary');
    await moveToRunning(client, operation);

    const unsafeResults = [
      { value: GITHUB_PAT_FIXTURE },
      { value: OPENAI_KEY_FIXTURE },
      { value: STRIPE_KEY_FIXTURE },
      { value: AWS_ACCESS_KEY_FIXTURE },
      { auth: 'not-stored-even-when-the-value-is-benign' },
      { authHeader: 'not-stored-even-when-the-value-is-benign' },
      { secretAccessKey: AWS_SECRET_KEY_FIXTURE },
      { secretKey: 'not-stored-even-when-the-value-is-benign' },
      { clientSecretValue: 'not-stored-even-when-the-value-is-benign' },
      { credentialMaterialId: 'not-stored-even-when-the-value-is-benign' },
      { passwordValue: 'not-stored-even-when-the-value-is-benign' },
      { apiKeyValue: 'not-stored-even-when-the-value-is-benign' },
      { accessTokenValue: 'not-stored-even-when-the-value-is-benign' },
      { privateKeyValue: 'not-stored-even-when-the-value-is-benign' },
      { authorizationHeader: 'not-stored-even-when-the-value-is-benign' },
      { passwd: 'not-stored-even-when-the-value-is-benign' },
      { pwd: 'not-stored-even-when-the-value-is-benign' },
      { passphrase: 'not-stored-even-when-the-value-is-benign' },
      { accessKeyId: 'not-stored-even-when-the-value-is-benign' },
      { githubPat: 'not-stored-even-when-the-value-is-benign' },
      { value: 'https://operator:password@example.invalid/resource' },
      { value: '/srv/control-plane/config.json' },
      { value: '/app/private/config.json' },
      { value: '/repo/.env' },
      { value: '/workspace/runtime.json' },
      { value: '/run/secrets/database-password' },
      { value: 'path=/srv/control-plane/config.json' },
      { value: 'file:///etc/passwd' },
      { value: 'Basic YTpi' },
      { value: 'Basic dXNlcjpwYXNz' },
      { value: 'Bearer authentication' },
      { value: 'Bearer abcdefghijklmnopqrst' },
      { value: 'Bearer abcdefghijklmnop1234' },
      { value: 'Authorization: Bearer token was issued to the caller.' },
      { value: 'Provider rejected Bearer abcdefghijklmnopqrst during handshake.' },
      JSON.parse('{"__proto__":{"summary":"must not alter the normalized prototype"}}'),
      JSON.parse('{"constructor":{"summary":"must not affect object construction"}}'),
      JSON.parse('{"prototype":{"summary":"must not affect a prototype"}}'),
      { value: 'contains\u0000nul' },
      { value: 'contains lone surrogate \uD800' },
      { ['contains\u0000nul']: 'safe value' },
      { ['contains lone high surrogate \uD800']: 'safe value' },
      { ['contains lone low surrogate \uDC00']: 'safe value' },
      {
        summary: 'Traceback (most recent call last):\n'
          + '  File "worker.py", line 12, in execute\n'
          + '    raise RuntimeError("boom")\n'
          + 'RuntimeError: boom'
      },
      { summary: 'failure in packages/provisioning-orchestrator/src/private-worker.mjs:42' },
      { summary: { nested: 'not a response-contract string' } }
    ];

    for (const unsafeResult of unsafeResults) {
      await assert.rejects(
        () => transitionOperation(client, {
          operation_id: operation.operation_id,
          tenant_id: operation.tenant_id,
          actor_id: operation.actor_id,
          new_status: 'completed',
          result: unsafeResult
        }),
        (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
      );
      const unchanged = await findById(client, {
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id
      });
      assert.equal(unchanged.status, 'running');
      assert.equal(unchanged.result, null);
      assert.equal(unchanged.completed_at, null);
    }
  });
});

maybeTest('C-11 real PostgreSQL defensively projects legacy values and completion timestamps', async () => {
  await withIsolatedSchema(async (client) => {
    await applyMigrations(client, MIGRATIONS);
    const staleAt = '2026-07-02T10:00:00.000Z';

    const malformed = await persistOperation(client, 'tenant-projection', 'workspace.malformed');
    await client.query(
      `UPDATE async_operations
          SET status = 'completed',
              result = '{"summary":{"nested":"legacy"}}'::jsonb,
              completed_at = $2,
              updated_at = $2
        WHERE operation_id = $1`,
      [malformed.operation_id, staleAt]
    );
    const malformedProjection = await getOperationResult(client, {
      operation_id: malformed.operation_id,
      tenant_id: malformed.tenant_id
    });
    assert.equal(malformedProjection.summary, null);
    assert.equal(instant(malformedProjection.completedAt), staleAt);

    for (const status of ['pending', 'running', 'cancelling']) {
      const operation = await persistOperation(
        client,
        'tenant-projection',
        `workspace.nonterminal.${status}`
      );
      await client.query(
        `UPDATE async_operations
            SET status = $2,
                error_summary = '{"message":"stale failure","retryable":true}'::jsonb,
                completed_at = $3,
                updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, status, staleAt]
      );
      const projection = await getOperationResult(client, {
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id
      });
      assert.equal(projection.resultType, 'pending');
      assert.equal(projection.failureReason, null);
      assert.equal(projection.retryable, null);
      assert.equal(projection.completedAt, null);
    }

    for (const status of ['completed', 'failed', 'timed_out', 'cancelled']) {
      const operation = await persistOperation(
        client,
        'tenant-projection',
        `workspace.terminal.${status}`
      );
      await client.query(
        `UPDATE async_operations
            SET status = $2,
                error_summary = CASE
                  WHEN $2 = 'failed' THEN '{"message":"visible failure","retryable":true}'::jsonb
                  ELSE '{"message":"stale failure","retryable":true}'::jsonb
                END,
                completed_at = NULL,
                updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, status, staleAt]
      );
      const projection = await getOperationResult(client, {
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id
      });
      assert.equal(
        projection.resultType,
        status === 'completed' ? 'success' : status === 'failed' ? 'failure' : 'pending'
      );
      assert.equal(instant(projection.completedAt), staleAt);
      assert.equal(projection.failureReason, status === 'failed' ? 'visible failure' : null);
      assert.equal(projection.retryable, status === 'failed' ? true : null);
    }
  });
});

maybeTest('C-11 real query action preserves completed, failed, pending, legacy, audit and isolation behavior', async () => {
  await withIsolatedSchema(async (client) => {
    await applyMigrations(client, MIGRATIONS);

    const completed = await persistOperation(client, 'tenant-query', 'workspace.create');
    await moveToRunning(client, completed);
    const completedTransition = await transitionOperation(client, {
      operation_id: completed.operation_id,
      tenant_id: completed.tenant_id,
      actor_id: completed.actor_id,
      new_status: 'completed',
      result: { summary: 'Visible safe summary', internalCount: 3 }
    });

    const failed = await persistOperation(client, 'tenant-query', 'workspace.delete');
    await moveToRunning(client, failed);
    const failedTransition = await transitionOperation(client, {
      operation_id: failed.operation_id,
      tenant_id: failed.tenant_id,
      actor_id: failed.actor_id,
      new_status: 'failed',
      error_summary: {
        code: 'DELETE_FAILED',
        message: 'Workspace deletion failed.',
        failedStep: 'delete'
      }
    });

    const pending = await persistOperation(client, 'tenant-query', 'workspace.pending');
    const legacy = await persistOperation(client, 'tenant-query', 'workspace.legacy');
    const legacyUpdatedAt = '2026-06-15T12:34:56.000Z';
    await client.query(
      `UPDATE async_operations
          SET status = 'completed',
              result = '{"summary":"Legacy summary"}'::jsonb,
              completed_at = NULL,
              updated_at = $2
        WHERE operation_id = $1`,
      [legacy.operation_id, legacyUpdatedAt]
    );
    await client.query(
      `INSERT INTO async_operation_log_entries (operation_id, tenant_id, level, message)
       VALUES ($1, $2, 'info', 'Workspace provisioning completed')`,
      [completed.operation_id, completed.tenant_id]
    );

    const auditMessages = [];
    const structuredLogs = [];
    const producer = {
      async send(message) {
        auditMessages.push(message);
      }
    };
    const response = await queryAction(
      queryParams('tenant-query', 'result', completed.operation_id),
      {
        db: client,
        producer,
        log(message) {
          structuredLogs.push(JSON.parse(message));
        }
      }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['X-Correlation-Id'], completed.correlation_id);
    assert.deepEqual(response.body, {
      queryType: 'result',
      operationId: completed.operation_id,
      status: 'completed',
      resultType: 'success',
      summary: 'Visible safe summary',
      failureReason: null,
      retryable: null,
      completedAt: completedTransition.updatedOperation.completed_at
    });
    assert.equal(Object.hasOwn(response.body, 'result'), false);
    assert.equal(auditMessages.length, 1);
    assert.equal(auditMessages[0].topic, 'console.async-operation.accessed');
    assert.deepEqual(JSON.parse(auditMessages[0].messages[0].value), {
      actorId: 'reader-tenant-query',
      tenantId: 'tenant-query',
      operationId: completed.operation_id,
      queryType: 'result',
      timestamp: JSON.parse(auditMessages[0].messages[0].value).timestamp
    });
    assert.equal(structuredLogs[0].event, 'async_operation_query_completed');
    assert.equal(structuredLogs[0].queryType, 'result');
    assert.equal(
      structuredLogs[0].metrics.some((item) => item.metric === 'async_operation_query_total'),
      true
    );
    assert.doesNotMatch(JSON.stringify({ auditMessages, structuredLogs }), /Visible safe summary|internalCount/);

    const failedResponse = await queryAction(
      queryParams('tenant-query', 'result', failed.operation_id),
      { db: client, log() {} }
    );
    assert.deepEqual(failedResponse.body, {
      queryType: 'result',
      operationId: failed.operation_id,
      status: 'failed',
      resultType: 'failure',
      summary: null,
      failureReason: 'Workspace deletion failed.',
      retryable: null,
      completedAt: failedTransition.updatedOperation.completed_at
    });

    const pendingResponse = await queryAction(
      queryParams('tenant-query', 'result', pending.operation_id),
      { db: client, log() {} }
    );
    assert.deepEqual(pendingResponse.body, {
      queryType: 'result',
      operationId: pending.operation_id,
      status: 'pending',
      resultType: 'pending',
      summary: null,
      failureReason: null,
      retryable: null,
      completedAt: null
    });

    const legacyResponse = await queryAction(
      queryParams('tenant-query', 'result', legacy.operation_id),
      { db: client, log() {} }
    );
    assert.equal(legacyResponse.body.summary, 'Legacy summary');
    assert.equal(instant(legacyResponse.body.completedAt), legacyUpdatedAt);

    const detailResponse = await queryAction(
      queryParams('tenant-query', 'detail', completed.operation_id),
      { db: client, log() {} }
    );
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.body.queryType, 'detail');

    const logsResponse = await queryAction(
      queryParams('tenant-query', 'logs', completed.operation_id, {
        pagination: { limit: 20, offset: 0 }
      }),
      { db: client, log() {} }
    );
    assert.equal(logsResponse.statusCode, 200);
    assert.equal(logsResponse.body.entries.length, 1);

    await assert.rejects(
      () => queryAction(
        queryParams('tenant-other', 'result', completed.operation_id),
        { db: client, log() {} }
      ),
      (error) => error.code === 'NOT_FOUND' && error.statusCode === 404
    );
    await assert.rejects(
      () => queryAction(
        queryParams('tenant-query', 'result', 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
        { db: client, log() {} }
      ),
      (error) => error.code === 'NOT_FOUND' && error.statusCode === 404
    );

    const tenantPage = await listOperations(client, {
      tenant_id: 'tenant-query',
      limit: 20,
      offset: 0
    });
    assert.equal(tenantPage.total, 4);
    await assert.rejects(
      () => listOperations(client, { tenant_id: null, isSuperadmin: false }),
      (error) => error.code === 'TENANT_ISOLATION_VIOLATION'
    );
  });
});

maybeTest('C-11 retry writers and durable saga terminal mirrors use canonical lifecycle data', async () => {
  await withIsolatedSchema(async (client) => {
    await applyMigrations(client, MIGRATIONS);
    const producer = { async send() {} };

    const ordinary = await persistOperation(client, 'tenant-retry', 'workspace.retry');
    await moveToRunning(client, ordinary);
    await transitionOperation(client, {
      operation_id: ordinary.operation_id,
      tenant_id: ordinary.tenant_id,
      actor_id: ordinary.actor_id,
      new_status: 'failed',
      error_summary: { code: 'RETRYABLE', message: 'Retry is safe.', failedStep: 'apply' }
    });
    await client.query(
      `UPDATE async_operations
          SET result = '{"summary":"stale"}'::jsonb,
              completed_at = NOW()
        WHERE operation_id = $1`,
      [ordinary.operation_id]
    );

    const ordinaryResponse = await retryAction({
      operation_id: ordinary.operation_id,
      callerContext: {
        tenantId: ordinary.tenant_id,
        actor: { id: 'retry-actor', type: 'tenant_owner' }
      }
    }, {
      db: client,
      producer,
      log() {}
    });
    assert.equal(ordinaryResponse.statusCode, 200);
    const ordinaryAfter = await findById(client, {
      operation_id: ordinary.operation_id,
      tenant_id: ordinary.tenant_id
    });
    assert.equal(ordinaryAfter.status, 'pending');
    assert.equal(ordinaryAfter.result, null);
    assert.equal(ordinaryAfter.completed_at, null);

    const overridden = await persistOperation(client, 'tenant-retry', 'workspace.override');
    await moveToRunning(client, overridden);
    await transitionOperation(client, {
      operation_id: overridden.operation_id,
      tenant_id: overridden.tenant_id,
      actor_id: overridden.actor_id,
      new_status: 'failed',
      error_summary: { code: 'INTERVENTION', message: 'Operator review required.', failedStep: 'apply' }
    });
    await client.query(
      `UPDATE async_operations
          SET manual_intervention_required = TRUE,
              result = '{"summary":"stale override"}'::jsonb,
              completed_at = NOW()
        WHERE operation_id = $1`,
      [overridden.operation_id]
    );
    const flagId = randomUUID();
    await client.query(
      `INSERT INTO manual_intervention_flags (
         flag_id, operation_id, tenant_id, actor_id, reason, attempt_count_at_flag,
         last_error_code, last_error_summary
       ) VALUES ($1, $2, $3, $4, 'operator review', 0, 'INTERVENTION', 'Review required')`,
      [flagId, overridden.operation_id, overridden.tenant_id, overridden.actor_id]
    );

    const overrideResponse = await retryOverrideAction({
      operation_id: overridden.operation_id,
      tenant_id: overridden.tenant_id,
      justification: 'Reviewed and approved for a supervised retry.',
      callerContext: { actor: { id: 'superadmin-1', type: 'superadmin' } }
    }, {
      db: client,
      producer,
      log() {}
    });
    assert.equal(overrideResponse.statusCode, 200);
    const overrideAfter = await findById(client, {
      operation_id: overridden.operation_id,
      tenant_id: overridden.tenant_id
    });
    assert.equal(overrideAfter.status, 'pending');
    assert.equal(overrideAfter.result, null);
    assert.equal(overrideAfter.completed_at, null);

    await ensureSagaSchema(client);
    const completedSaga = await startSaga(client, 'tenant.create', { slug: 'saga-complete' }, {
      tenantId: 'tenant-saga',
      actorId: 'actor-saga',
      actorType: 'tenant_owner'
    });
    await completedSaga.complete({ summary: 'Saga completed safely' });
    const completedSagaOperation = await findById(client, {
      operation_id: completedSaga.runId,
      tenant_id: 'tenant-saga'
    });
    assert.equal(completedSagaOperation.status, 'completed');
    assert.deepEqual(completedSagaOperation.result, { summary: 'Saga completed safely' });
    assert.equal(
      instant(completedSagaOperation.completed_at),
      instant(completedSagaOperation.updated_at)
    );
    const { rows: completedSagaRuns } = await client.query(
      'SELECT status, result FROM saga_runs WHERE id = $1',
      [completedSaga.runId]
    );
    assert.deepEqual(completedSagaRuns, [{
      status: 'completed',
      result: { summary: 'Saga completed safely' }
    }]);

    const { rows: completedTransitions } = await client.query(
      `SELECT previous_status, new_status
         FROM async_operation_transitions
        WHERE operation_id = $1
          AND new_status = 'completed'`,
      [completedSaga.runId]
    );
    assert.deepEqual(completedTransitions, [{ previous_status: 'running', new_status: 'completed' }]);

    const scalarSaga = await startSaga(client, 'tenant.create', { slug: 'saga-scalar' }, {
      tenantId: 'tenant-saga',
      actorId: 'actor-saga',
      actorType: 'tenant_owner'
    });
    await scalarSaga.complete('Safe scalar summary');
    const scalarSagaOperation = await findById(client, {
      operation_id: scalarSaga.runId,
      tenant_id: 'tenant-saga'
    });
    const { rows: scalarSagaRuns } = await client.query(
      'SELECT status, result FROM saga_runs WHERE id = $1',
      [scalarSaga.runId]
    );
    assert.equal(scalarSagaOperation.status, 'completed');
    assert.equal(scalarSagaOperation.result, 'Safe scalar summary');
    assert.deepEqual(scalarSagaRuns, [{
      status: 'completed',
      result: 'Safe scalar summary'
    }]);

    const unsafeSaga = await startSaga(client, 'tenant.create', { slug: 'saga-unsafe' }, {
      tenantId: 'tenant-saga',
      actorId: 'actor-saga',
      actorType: 'tenant_owner'
    });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      await unsafeSaga.complete({
        summary: 'must be omitted with the credential',
        githubPat: GITHUB_PAT_FIXTURE
      });
    } finally {
      console.warn = originalWarn;
    }
    const unsafeSagaOperation = await findById(client, {
      operation_id: unsafeSaga.runId,
      tenant_id: 'tenant-saga'
    });
    const { rows: unsafeSagaRuns } = await client.query(
      'SELECT status, result FROM saga_runs WHERE id = $1',
      [unsafeSaga.runId]
    );
    assert.equal(unsafeSagaOperation.status, 'completed');
    assert.equal(unsafeSagaOperation.result, null);
    assert.deepEqual(unsafeSagaRuns, [{ status: 'completed', result: null }]);
    assert.deepEqual(warnings, ['[control-plane] unsafe saga completion result omitted']);
    assert.doesNotMatch(warnings[0], /ghp_|must be omitted/);
    const { rows: unsafeSagaTransitions } = await client.query(
      `SELECT previous_status, new_status
         FROM async_operation_transitions
        WHERE operation_id = $1
          AND new_status = 'completed'`,
      [unsafeSaga.runId]
    );
    assert.deepEqual(
      unsafeSagaTransitions,
      [{ previous_status: 'running', new_status: 'completed' }]
    );

    const failedSaga = await startSaga(client, 'tenant.create', { slug: 'saga-fail' }, {
      tenantId: 'tenant-saga',
      actorId: 'actor-saga',
      actorType: 'tenant_owner'
    });
    const rawProviderError = `provider rejected ${OPENAI_KEY_FIXTURE}`;
    await failedSaga.fail(new Error(rawProviderError));
    const failedSagaOperation = await findById(client, {
      operation_id: failedSaga.runId,
      tenant_id: 'tenant-saga'
    });
    assert.equal(failedSagaOperation.status, 'failed');
    assert.equal(failedSagaOperation.result, null);
    assert.equal(
      instant(failedSagaOperation.completed_at),
      instant(failedSagaOperation.updated_at)
    );
    assert.equal(failedSagaOperation.error_summary.message, 'Saga execution failed.');
    assert.doesNotMatch(JSON.stringify(failedSagaOperation.error_summary), /sk-proj/);
    const { rows: failedSagaRuns } = await client.query(
      'SELECT status, error FROM saga_runs WHERE id = $1',
      [failedSaga.runId]
    );
    assert.deepEqual(failedSagaRuns, [{
      status: 'compensated',
      error: 'Saga execution failed.'
    }]);
    assert.doesNotMatch(JSON.stringify(failedSagaRuns), /sk-proj/);

    const { rows: failedTransitions } = await client.query(
      `SELECT previous_status, new_status
         FROM async_operation_transitions
        WHERE operation_id = $1
          AND new_status = 'failed'`,
      [failedSaga.runId]
    );
    assert.deepEqual(failedTransitions, [{ previous_status: 'running', new_status: 'failed' }]);
  });
});
