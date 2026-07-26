// bbx-webhook-db-adapter
//
// Black-box coverage for change add-webhook-engine-kind-runtime (GitHub #643).
//
// The kind control-plane wires the (code-complete) webhook-management action by
// injecting a Postgres-backed `db` adapter built from the runtime pool. The
// security-critical invariant of that adapter is that EVERY tenant-scoped query
// carries a `(tenant_id, workspace_id)` predicate / binds the tenant dimension —
// a `subscription_id` alone must never be sufficient to read or rotate across
// tenant boundaries. These tests drive the adapter against a recording `pool`
// stub (no live Postgres needed) and assert the SQL contract + param binding +
// return mapping. The full lifecycle against real SQL is proven on the kind
// cluster (tasks.md 8.3 / /e2e-issue).
//
// Scenarios:
//   bbx-643-db-01: getWorkspaceSubscriptionCount scopes by (tenant_id, workspace_id) and returns an int
//   bbx-643-db-02: listSubscriptions scopes by (tenant_id, workspace_id) and excludes soft-deleted
//   bbx-c25-db-03: atomic create binds both tenant-scoped rows in one fenced transaction
//   bbx-643-db-04: rotateSecret graces the active secret (tenant-scoped) AND inserts a new active secret
//   bbx-643-db-05: cancelPendingDeliveries only touches this subscription's pending deliveries
//   bbx-643-db-06: getSubscription fetches by id (action layer applies the tenant check)
//   bbx-c25-db-07: encrypted writes share the lifecycle fence and reject a stale key identity
//   bbx-c25-db-08: construction rejects missing or shared runtime/writer pools
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebhookDb } from '../../apps/control-plane/webhook-db.mjs';

// A pool stub that records every query and returns a caller-supplied response.
function recordingPool(responder) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params: params ?? [] });
      const supplied = responder ? responder(text, params, calls.length - 1) : null;
      if (supplied) return supplied;
      if (/falcone_webhook_key_write_current_id/i.test(text)) {
        return { rows: [{ current_key_id: 'wk1:test-id' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}
const has = (sql, ...needles) => needles.every((n) => new RegExp(n, 'i').test(sql));

test('bbx-643-db-01: getWorkspaceSubscriptionCount scopes by tenant + workspace and returns an int', async () => {
  const pool = recordingPool((sql) => has(sql, 'count') ? { rows: [{ count: 3 }] } : null);
  const db = buildWebhookDb(pool, { writePool: recordingPool() });
  const n = await db.getWorkspaceSubscriptionCount('tenant-a', 'ws-a');
  assert.equal(n, 3);
  const q = pool.calls.find(({ text }) => has(text, 'from\\s+webhook_subscriptions'));
  assert.ok(has(q.text, 'from\\s+webhook_subscriptions'), 'queries webhook_subscriptions');
  assert.ok(has(q.text, 'tenant_id') && has(q.text, 'workspace_id'), 'predicate carries tenant + workspace');
  assert.deepEqual(q.params, ['tenant-a', 'ws-a']);
  assert.ok(
    pool.calls.some(({ text }) => /set_config\('app\.tenant_id'/i.test(text)),
    'establishes transaction-local RLS scope',
  );
});

test('bbx-643-db-02: listSubscriptions scopes by tenant + workspace and excludes soft-deleted', async () => {
  const pool = recordingPool(() => ({ rows: [{ id: 's1', tenant_id: 'tenant-a', workspace_id: 'ws-a' }] }));
  const db = buildWebhookDb(pool, { writePool: recordingPool() });
  const rows = await db.listSubscriptions({ tenantId: 'tenant-a', workspaceId: 'ws-a' }, {});
  assert.equal(rows.length, 1);
  const q = pool.calls.find(({ text }) => has(text, 'from\\s+webhook_subscriptions'));
  assert.ok(has(q.text, 'from\\s+webhook_subscriptions'));
  assert.ok(has(q.text, 'tenant_id') && has(q.text, 'workspace_id'), 'tenant + workspace predicate');
  assert.ok(has(q.text, 'deleted_at'), 'excludes soft-deleted rows');
  assert.ok(q.params.includes('tenant-a') && q.params.includes('ws-a'));
});

function subscriptionRecord() {
  return {
    id: 'sub-1',
    tenant_id: 'tenant-a',
    workspace_id: 'ws-a',
    target_url: 'https://example.invalid/hook',
    event_types: ['document.created'],
    status: 'active',
    consecutive_failures: 0,
    max_consecutive_failures: 5,
    description: null,
    created_by: 'actor-a',
    created_at: '2026-07-24T00:00:00.000Z',
    updated_at: '2026-07-24T00:00:00.000Z',
    metadata: {},
  };
}

test('bbx-c25-db-03: subscription and secret insert atomically in one fenced transaction', async () => {
  const pool = recordingPool();
  const db = buildWebhookDb(recordingPool(), { writePool: pool });
  const record = subscriptionRecord();
  await db.insertSubscriptionWithSecret(
    record,
    { cipher: 'CIPHER', iv: 'IV' },
    'wk1:test-id',
  );
  const subscription = pool.calls.find((call) => has(call.text, 'insert\\s+into\\s+webhook_subscriptions'));
  const secret = pool.calls.find((call) => has(call.text, 'insert\\s+into\\s+webhook_signing_secrets'));
  assert.ok(subscription, 'inserts the parent subscription row');
  assert.ok(secret, 'inserts the encrypted signing-secret row');
  for (const v of ['sub-1', 'CIPHER', 'IV', 'tenant-a', 'ws-a', 'wk1:test-id']) {
    assert.ok(
      subscription.params.includes(v) || secret.params.includes(v),
      `binds ${v}`,
    );
  }
  const statements = pool.calls.map(({ text }) => text.replace(/\s+/g, ' ').trim());
  const effectiveRole = statements.findIndex((sql) => /SET LOCAL ROLE falcone_webhook_key_writer/i.test(sql));
  const sharedLock = statements.findIndex((sql) => /pg_advisory_xact_lock_shared/i.test(sql));
  const identityCheck = statements.findIndex((sql) => /falcone_webhook_key_write_current_id/i.test(sql));
  const tenantContext = statements.findIndex((sql) => /set_config\('app\.tenant_id'/i.test(sql));
  const parentInsert = statements.findIndex((sql) => /INSERT INTO webhook_subscriptions/i.test(sql));
  const secretInsert = statements.findIndex((sql) => /INSERT INTO webhook_signing_secrets/i.test(sql));
  assert.equal(statements[0], 'BEGIN');
  assert.ok(
    effectiveRole > 0
      && sharedLock > effectiveRole
      && identityCheck > sharedLock
      && tenantContext > identityCheck
      && parentInsert > tenantContext
      && secretInsert > parentInsert,
  );
  assert.equal(statements.at(-1), 'COMMIT');
});

test('bbx-c25-db-03b: secret insert failure rolls the parent back and exposes no SQL detail', async () => {
  const pool = recordingPool((sql) => {
    if (/INSERT\s+INTO\s+webhook_signing_secrets/i.test(sql)) {
      throw Object.assign(new Error('raw constraint and opaque values'), { code: '23514' });
    }
    return null;
  });
  const db = buildWebhookDb(recordingPool(), { writePool: pool });

  await assert.rejects(
    db.insertSubscriptionWithSecret(
      subscriptionRecord(),
      { cipher: 'CIPHER-MUST-NOT-ESCAPE', iv: 'IV-MUST-NOT-ESCAPE' },
      'wk1:test-id',
    ),
    (caught) => {
      assert.equal(caught.code, 'WEBHOOK_SECRET_WRITE_FAILED');
      assert.equal(caught.message, 'Webhook signing secret could not be stored');
      assert.doesNotMatch(caught.message, /23514|constraint|CIPHER|IV|test-id/);
      return true;
    },
  );
  assert.equal(pool.calls.filter(({ text }) => /^\s*BEGIN\s*$/i.test(text)).length, 1);
  assert.equal(pool.calls.filter(({ text }) => /INSERT\s+INTO\s+webhook_subscriptions/i.test(text)).length, 1);
  assert.equal(pool.calls.filter(({ text }) => /^\s*ROLLBACK\s*$/i.test(text)).length, 1);
  assert.equal(pool.calls.filter(({ text }) => /^\s*COMMIT\s*$/i.test(text)).length, 0);
});

test('bbx-643-db-04: rotateSecret graces the active secret (tenant-scoped) then inserts a new active secret', async () => {
  const pool = recordingPool();
  const db = buildWebhookDb(recordingPool(), { writePool: pool });
  await db.rotateSecret('sub-1', { cipher: 'NEWC', iv: 'NEWIV' }, '2026-07-01T00:00:00.000Z', 'tenant-a', 'ws-a', 'wk1:test-id');
  assert.ok(pool.calls.length >= 2, 'rotate issues at least an update + an insert');
  const grace = pool.calls.find((c) => /update\s+webhook_signing_secrets/i.test(c.text));
  const insert = pool.calls.find((c) => /insert\s+into\s+webhook_signing_secrets/i.test(c.text));
  assert.ok(grace, 'graces the existing active secret');
  assert.ok(has(grace.text, 'grace') && has(grace.text, 'tenant_id') && has(grace.text, 'workspace_id'),
    'grace update is tenant-scoped');
  assert.ok(grace.params.includes('sub-1') && grace.params.includes('tenant-a') && grace.params.includes('ws-a'));
  assert.ok(insert, 'inserts the new active secret');
  for (const v of ['sub-1', 'NEWC', 'NEWIV', 'tenant-a', 'ws-a', 'wk1:test-id']) assert.ok(insert.params.includes(v), `insert binds ${v}`);
  assert.equal(pool.calls.filter(({ text }) => /^\s*BEGIN\s*$/i.test(text)).length, 1);
  assert.equal(pool.calls.filter(({ text }) => /^\s*COMMIT\s*$/i.test(text)).length, 1);
  assert.equal(pool.calls.filter(({ text }) => /pg_advisory_xact_lock_shared/i.test(text)).length, 1);
  assert.ok(
    pool.calls.findIndex(({ text }) => /pg_advisory_xact_lock_shared/i.test(text))
      < pool.calls.findIndex(({ text }) => /UPDATE\s+webhook_signing_secrets/i.test(text)),
    'shared lifecycle fence is acquired before either rotation write',
  );
});

test('bbx-643-db-05: cancelPendingDeliveries only affects this subscription pending deliveries', async () => {
  const pool = recordingPool();
  const db = buildWebhookDb(pool, { writePool: recordingPool() });
  await db.cancelPendingDeliveries('sub-1', 'tenant-a', 'ws-a');
  const q = pool.calls.find(({ text }) => has(text, 'update\\s+webhook_deliveries'));
  assert.ok(has(q.text, 'update\\s+webhook_deliveries'));
  assert.ok(
    has(q.text, 'subscription_id')
      && has(q.text, 'tenant_id')
      && has(q.text, 'workspace_id')
      && has(q.text, 'pending'),
    'targets this subscription and tenant/workspace pending rows',
  );
  assert.deepEqual(q.params, ['sub-1', 'tenant-a', 'ws-a']);
});

test('bbx-643-db-06: getSubscription fetches by id and tenant/workspace scope', async () => {
  const pool = recordingPool(() => ({ rows: [{ id: 'sub-1', tenant_id: 'tenant-a', workspace_id: 'ws-a' }] }));
  const db = buildWebhookDb(pool, { writePool: recordingPool() });
  const row = await db.getSubscription('sub-1', 'tenant-a', 'ws-a');
  assert.equal(row.id, 'sub-1');
  const q = pool.calls.find(({ text }) => has(text, 'from\\s+webhook_subscriptions'));
  assert.ok(
    has(q.text, 'from\\s+webhook_subscriptions')
      && has(q.text, 'id')
      && has(q.text, 'tenant_id')
      && has(q.text, 'workspace_id'),
  );
  assert.deepEqual(q.params, ['sub-1', 'tenant-a', 'ws-a']);
});

test('bbx-c25-db-07: stale key identity rolls back before either create insert with a bounded error', async () => {
  const pool = recordingPool((sql) => (
    /falcone_webhook_key_write_current_id/i.test(sql)
      ? { rows: [{ current_key_id: 'wk1:current-id' }], rowCount: 1 }
      : null
  ));
  const db = buildWebhookDb(recordingPool(), { writePool: pool });

  await assert.rejects(
    db.insertSubscriptionWithSecret(
      { ...subscriptionRecord(), id: 'sub-stale' },
      { cipher: 'CIPHER-MUST-NOT-BE-WRITTEN', iv: 'IV-MUST-NOT-BE-WRITTEN' },
      'wk1:stale-id',
    ),
    (caught) => {
      assert.equal(caught.code, 'WEBHOOK_KEY_UNAVAILABLE');
      assert.equal(caught.message, 'Webhook key lifecycle is not ready');
      assert.doesNotMatch(caught.message, /stale-id|tenant-a|ws-a|CIPHER|IV/);
      return true;
    },
  );

  assert.equal(
    pool.calls.some(({ text }) => /INSERT\s+INTO\s+webhook_(subscriptions|signing_secrets)/i.test(text)),
    false,
    'identity mismatch must fail before either INSERT',
  );
  assert.equal(pool.calls.filter(({ text }) => /^\s*ROLLBACK\s*$/i.test(text)).length, 1);
  assert.equal(pool.calls.filter(({ text }) => /^\s*COMMIT\s*$/i.test(text)).length, 0);
});

test('bbx-c25-db-08: construction rejects missing and shared writer pools before queries', () => {
  const runtimePool = recordingPool();
  assert.throws(
    () => buildWebhookDb(runtimePool),
    {
      code: 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED',
      message: 'Webhook database principal configuration is incomplete',
    },
  );
  assert.throws(
    () => buildWebhookDb(runtimePool, { writePool: runtimePool }),
    {
      code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID',
      message: 'Webhook database principal boundary is invalid',
    },
  );
  assert.equal(runtimePool.calls.length, 0, 'configuration rejection precedes persistence');
});
