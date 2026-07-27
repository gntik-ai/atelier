import test from 'node:test';
import assert from 'node:assert/strict';

import { Saga } from '../../apps/control-plane/saga.mjs';

const AWS_ACCESS_KEY_FIXTURE = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const GITHUB_PAT_FIXTURE = ['ghp', '_123456789012345678901234567890123456'].join('');
const OPENAI_KEY_FIXTURE = ['sk', '-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'].join('');

function createSagaDb(runId) {
  const state = {
    operation: {
      operation_id: runId,
      tenant_id: 'tenant-saga',
      actor_id: 'actor-saga',
      actor_type: 'tenant_owner',
      operation_type: 'tenant.create',
      status: 'running',
      error_summary: null,
      cancellation_reason: null,
      cancelled_by: null,
      result: null,
      completed_at: null,
      updated_at: '2026-07-01T00:00:00.000Z'
    },
    transitions: [],
    logs: [],
    sagaStatus: 'running',
    sagaResult: null,
    sagaError: null
  };

  return {
    state,
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, ' ').trim();

      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
        return { rows: [] };
      }
      if (statement.startsWith('UPDATE saga_runs SET status=')) {
        state.sagaStatus = statement.includes("'completed'") ? 'completed'
          : statement.includes("'compensated'") ? 'compensated'
            : 'failed';
        if (statement.includes('result=$2::jsonb')) {
          state.sagaResult = params[1] == null ? null : JSON.parse(params[1]);
        }
        if (statement.includes('error=$2')) {
          state.sagaError = params[1];
        }
        return { rows: [] };
      }
      if (statement === 'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2 FOR UPDATE') {
        return { rows: [{ ...state.operation }] };
      }
      if (statement.startsWith('UPDATE async_operations SET status = $3')) {
        state.operation = {
          ...state.operation,
          status: params[2],
          error_summary: params[3] == null ? null : JSON.parse(params[3]),
          cancellation_reason: params[4],
          cancelled_by: params[5],
          result: params[6] == null ? null : JSON.parse(params[6]),
          completed_at: params[7],
          updated_at: params[8]
        };
        return { rows: [{ ...state.operation }] };
      }
      if (statement.startsWith('INSERT INTO async_operation_transitions')) {
        state.transitions.push({
          previous_status: params[4],
          new_status: params[5],
          transitioned_at: params[6]
        });
        return { rows: [] };
      }
      if (statement.startsWith('INSERT INTO async_operation_log_entries')) {
        state.logs.push({ level: params[2], message: params[3] });
        return { rows: [] };
      }
      if (statement.startsWith('SELECT id, name, compensation FROM saga_steps')) {
        return { rows: [] };
      }

      throw new Error(`Unsupported SQL in saga test: ${statement}`);
    }
  };
}

function attachedSaga(db, runId) {
  const saga = new Saga(db, runId, 'tenant.create');
  saga.op = {
    tenantId: 'tenant-saga',
    actorId: 'actor-saga',
    operationType: 'tenant.create'
  };
  return saga;
}

function asPool(db) {
  let released = false;
  return {
    state: db.state,
    totalCount: 1,
    idleCount: 0,
    get released() {
      return released;
    },
    async connect() {
      return {
        query: db.query.bind(db),
        release() {
          released = true;
        }
      };
    },
    async query(sql, params) {
      if (sql.includes('INSERT INTO async_operation_log_entries')) {
        assert.equal(released, true, 'repository client is released before best-effort logging');
      }
      return db.query(sql, params);
    }
  };
}

test('durable saga completion uses one canonical terminal transition', async () => {
  const runId = '10000000-0000-4000-8000-000000000001';
  const db = asPool(createSagaDb(runId));
  const saga = attachedSaga(db, runId);

  await saga.complete({ summary: 'Tenant created' });

  assert.equal(db.state.sagaStatus, 'completed');
  assert.deepEqual(db.state.sagaResult, { summary: 'Tenant created' });
  assert.equal(db.state.operation.status, 'completed');
  assert.deepEqual(db.state.operation.result, { summary: 'Tenant created' });
  assert.equal(db.state.operation.completed_at, db.state.operation.updated_at);
  assert.equal(db.released, true);
  assert.deepEqual(db.state.transitions.map(({ previous_status, new_status }) => ({ previous_status, new_status })), [
    { previous_status: 'running', new_status: 'completed' }
  ]);
  assert.deepEqual(db.state.logs, [{ level: 'info', message: 'tenant.create completed' }]);
});

test('durable saga scalar completion uses the same JSONB value in both stores', async () => {
  const runId = '10000000-0000-4000-8000-000000000003';
  const db = createSagaDb(runId);
  const saga = attachedSaga(db, runId);

  await saga.complete('Safe scalar summary');

  assert.equal(db.state.sagaResult, 'Safe scalar summary');
  assert.equal(db.state.operation.result, 'Safe scalar summary');
  assert.equal(db.state.operation.status, 'completed');
  assert.deepEqual(db.state.transitions.map(({ previous_status, new_status }) => ({
    previous_status,
    new_status
  })), [{ previous_status: 'running', new_status: 'completed' }]);
});

test('durable saga drops an unsafe optional result before either durable write', async () => {
  const runId = '10000000-0000-4000-8000-000000000004';
  const db = createSagaDb(runId);
  const saga = attachedSaga(db, runId);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    await saga.complete({
      summary: 'must be omitted with the credential',
      githubPat: GITHUB_PAT_FIXTURE
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(db.state.sagaStatus, 'completed');
  assert.equal(db.state.sagaResult, null);
  assert.equal(db.state.operation.status, 'completed');
  assert.equal(db.state.operation.result, null);
  assert.deepEqual(warnings, ['[control-plane] unsafe saga completion result omitted']);
  assert.doesNotMatch(warnings[0], /ghp_|must be omitted/);
  assert.deepEqual(db.state.transitions.map(({ previous_status, new_status }) => ({
    previous_status,
    new_status
  })), [{ previous_status: 'running', new_status: 'completed' }]);
});

test('durable saga drops accessor-backed results before serialization', async () => {
  const runId = '10000000-0000-4000-8000-000000000005';
  const db = createSagaDb(runId);
  const saga = attachedSaga(db, runId);
  let reads = 0;
  const result = {};
  Object.defineProperty(result, 'value', {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1
        ? 'safe-looking value'
        : OPENAI_KEY_FIXTURE;
    }
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await saga.complete(result);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(reads, 0);
  assert.equal(db.state.sagaResult, null);
  assert.equal(db.state.operation.result, null);
});

test('durable saga drops prototype-affecting result keys from both stores', async () => {
  const runId = '10000000-0000-4000-8000-000000000006';
  const db = createSagaDb(runId);
  const saga = attachedSaga(db, runId);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await saga.complete(JSON.parse(
      '{"__proto__":{"summary":"must not alter the normalized prototype"}}'
    ));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(db.state.sagaStatus, 'completed');
  assert.equal(db.state.sagaResult, null);
  assert.equal(db.state.operation.status, 'completed');
  assert.equal(db.state.operation.result, null);
  assert.deepEqual(warnings, ['[control-plane] unsafe saga completion result omitted']);
});

test('durable saga failure uses one canonical transition with a safe error and null result', async () => {
  const runId = '10000000-0000-4000-8000-000000000002';
  const db = createSagaDb(runId);
  const saga = attachedSaga(db, runId);

  const rawProviderError = `provider rejected ${OPENAI_KEY_FIXTURE}`;
  await saga.fail(new Error(rawProviderError));

  assert.equal(db.state.sagaStatus, 'compensated');
  assert.equal(db.state.sagaError, 'Saga execution failed.');
  assert.doesNotMatch(db.state.sagaError, /sk-proj/);
  assert.equal(db.state.operation.status, 'failed');
  assert.deepEqual(db.state.operation.error_summary, {
    code: 'SAGA_FAILED',
    message: 'Saga execution failed.',
    failedStep: null
  });
  assert.doesNotMatch(JSON.stringify(db.state.operation.error_summary), /sk-proj/);
  assert.equal(db.state.operation.result, null);
  assert.equal(db.state.operation.completed_at, db.state.operation.updated_at);
  assert.deepEqual(db.state.transitions.map(({ previous_status, new_status }) => ({ previous_status, new_status })), [
    { previous_status: 'running', new_status: 'failed' }
  ]);
  assert.deepEqual(db.state.logs, [{ level: 'error', message: 'tenant.create failed' }]);
});

test('durable saga canonicalizes and bounds failure summaries identically', async () => {
  for (const [suffix, error, expectedMessage, expectedCode] of [
    ['trim', Object.assign(new Error('  Safe downstream failure.  '), { code: 'DOWNSTREAM' }),
      'Safe downstream failure.', 'DOWNSTREAM'],
    ['long', Object.assign(new Error('x'.repeat(4097)), { code: 'DOWNSTREAM' }),
      'Saga execution failed.', 'DOWNSTREAM'],
    ['code', Object.assign(new Error('Safe downstream failure.'), {
      code: AWS_ACCESS_KEY_FIXTURE
    }), 'Safe downstream failure.', 'SAGA_FAILED'],
    ['basic', new Error('Basic authentication failed safely.'),
      'Basic authentication failed safely.', 'SAGA_FAILED'],
    ['bearer', new Error('Bearer authentication failed safely.'),
      'Bearer authentication failed safely.', 'SAGA_FAILED']
  ]) {
    const runId = `10000000-0000-4000-8000-0000000000${suffix.length + 10}`;
    const db = createSagaDb(runId);
    const saga = attachedSaga(db, runId);
    await saga.fail(error);

    assert.equal(db.state.sagaError, expectedMessage);
    assert.equal(db.state.operation.error_summary.message, expectedMessage);
    assert.equal(db.state.operation.error_summary.code, expectedCode);
    assert.ok(Buffer.byteLength(db.state.sagaError, 'utf8') <= 4096);
  }
});

test('durable saga ignores Proxy and accessor error fields without invoking traps', async () => {
  let proxyReads = 0;
  const proxiedError = new Proxy(
    { code: 'DOWNSTREAM', message: 'Safe downstream failure.' },
    {
      get() {
        proxyReads += 1;
        throw new Error('Proxy getter must not run');
      }
    }
  );
  const proxyDb = createSagaDb('10000000-0000-4000-8000-000000000007');
  await attachedSaga(proxyDb, '10000000-0000-4000-8000-000000000007').fail(proxiedError);

  let accessorReads = 0;
  const accessorError = {};
  Object.defineProperties(accessorError, {
    code: {
      get() {
        accessorReads += 1;
        return 'DOWNSTREAM';
      }
    },
    message: {
      get() {
        accessorReads += 1;
        return 'Safe downstream failure.';
      }
    }
  });
  const accessorDb = createSagaDb('10000000-0000-4000-8000-000000000008');
  await attachedSaga(accessorDb, '10000000-0000-4000-8000-000000000008').fail(accessorError);

  for (const [reads, db] of [[proxyReads, proxyDb], [accessorReads, accessorDb]]) {
    assert.equal(reads, 0);
    assert.equal(db.state.sagaError, 'Saga execution failed.');
    assert.deepEqual(db.state.operation.error_summary, {
      code: 'SAGA_FAILED',
      message: 'Saga execution failed.',
      failedStep: null
    });
  }
});
