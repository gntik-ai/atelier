import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginFunctionAuditIntent,
  finalizeFunctionAuditIntent,
  recoverFunctionAuditIntents
} from '../../apps/control-plane/audit-store.mjs';
import {
  recordDispatchedRouteAudit,
  recordRouteAudit
} from '../../apps/control-plane/audit-writer.mjs';
import {
  ensureFunctionAuditTopic,
  flushFunctionAuditOutbox
} from '../../apps/control-plane/function-audit-outbox.mjs';
import { checkFunctionQuota } from '../../apps/control-plane/function-quota.mjs';

function auditPool() {
  const calls = [];
  const client = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/SELECT row_hash FROM plan_audit_events/.test(sql)) return { rows: [] };
      if (/INSERT INTO plan_audit_events/.test(sql)) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client, query: client.query.bind(client) };
}

test('function rollback failure commits audit + Kafka outbox before strict writer resolves', async () => {
  const pool = auditPool();
  const result = await recordRouteAudit(
    pool,
    { method: 'POST', path: '/v1/functions/actions/{actionId}/rollback', localHandler: 'fnRollback' },
    {
      identity: { sub: 'usr_owner' },
      resolvedScope: { tenantId: 'ten_a', workspaceId: 'wrk_a' },
      auditDetail: { functionId: 'fn_a', targetVersionId: 'fnv_old', subsystem: 'openwhisk' }
    },
    { statusCode: 502 },
    'cor_function_failure',
    console,
    { strict: true }
  );
  assert.ok(result);
  const auditInsert = pool.calls.findIndex((call) => /INSERT INTO plan_audit_events/.test(call.sql));
  const outboxInsert = pool.calls.findIndex((call) => /INSERT INTO function_audit_outbox/.test(call.sql));
  const commit = pool.calls.findIndex((call) => call.sql === 'COMMIT');
  assert.ok(auditInsert >= 0 && outboxInsert > auditInsert && commit > outboxInsert);
  const payload = JSON.parse(pool.calls[outboxInsert].params[3]);
  assert.equal(payload.actionType, 'function.rolled_back');
  assert.equal(payload.outcome, 'error');
  assert.equal(payload.workspaceId, 'wrk_a');
  assert.equal(payload.detail.targetVersionId, 'fnv_old');
});

test('strict function audit propagates storage failure instead of silently suppressing evidence', async () => {
  const client = {
    query: async (sql) => {
      if (/INSERT INTO plan_audit_events/.test(sql)) throw new Error('audit store unavailable');
      return { rows: [] };
    },
    release() {}
  };
  const pool = { query: client.query, connect: async () => client };
  await assert.rejects(
    () => recordRouteAudit(
      pool,
      { method: 'DELETE', path: '/v1/functions/actions/{actionId}', localHandler: 'fnDelete' },
      {
        identity: { sub: 'usr_owner' },
        resolvedScope: { tenantId: 'ten_a', workspaceId: 'wrk_a' },
        auditDetail: { functionId: 'fn_a' }
      },
      { statusCode: 202 },
      'cor_function_delete',
      console,
      { strict: true }
    ),
    (error) => error.statusCode === 503 && error.code === 'FUNCTION_AUDIT_UNAVAILABLE'
  );
});

test('outbox publisher marks success and retains Kafka failures for retry', async () => {
  const makePool = () => {
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (/SELECT event_id/.test(sql)) return { rows: [{
          event_id: '11111111-1111-1111-1111-111111111111',
          topic: 'function.audit.events', event_key: 'ten_a:wrk_a',
          payload: { auditRecordId: '11111111-1111-1111-1111-111111111111' }, attempts: 0
        }] };
        return { rows: [] };
      },
      release() {}
    };
    return { pool: { connect: async () => client, query: client.query.bind(client) }, calls };
  };
  const success = makePool();
  const sent = [];
  const published = await flushFunctionAuditOutbox(success.pool, {
    producer: { send: async (message) => sent.push(message) },
    now: () => new Date('2026-08-08T00:00:00.000Z')
  });
  assert.deepEqual(published, { claimed: 1, published: 1, deferred: 0, recovered: 0 });
  assert.equal(sent[0].topic, 'function.audit.events');
  assert.ok(success.calls.some((call) => /SET published_at/.test(call.sql)));

  const failure = makePool();
  const deferred = await flushFunctionAuditOutbox(failure.pool, {
    producer: { send: async () => { throw new Error('broker unavailable'); } },
    now: () => new Date('2026-08-08T00:00:00.000Z')
  });
  assert.deepEqual(deferred, { claimed: 1, published: 0, deferred: 1, recovered: 0 });
  const retry = failure.calls.find((call) => /SET attempts = attempts \+ 1, next_attempt_at/.test(call.sql));
  assert.ok(retry);
  assert.equal(retry.params[2], 'broker unavailable');
});

test('function audit topic bootstrap creates a missing topic and preserves an existing topic', async () => {
  const creates = [];
  const missing = {
    listTopics: async () => [],
    createTopics: async (input) => { creates.push(input); return true; }
  };
  assert.deepEqual(await ensureFunctionAuditTopic(missing, {
    numPartitions: 3, replicationFactor: 1, retentionMs: '86400000'
  }), { topic: 'function.audit.events', created: true });
  assert.deepEqual(creates[0], {
    waitForLeaders: true,
    topics: [{
      topic: 'function.audit.events', numPartitions: 3, replicationFactor: 1,
      configEntries: [{ name: 'retention.ms', value: '86400000' }]
    }]
  });

  let unexpectedCreate = false;
  const existing = {
    listTopics: async () => ['function.audit.events'],
    createTopics: async () => { unexpectedCreate = true; }
  };
  assert.deepEqual(await ensureFunctionAuditTopic(existing), {
    topic: 'function.audit.events', created: false
  });
  assert.equal(unexpectedCreate, false);
});

test('pre-effect intent survives audit failure and recovery creates retryable evidence', async () => {
  const state = { intent: null, audit: null, outbox: null, failAuditOnce: true };
  const query = async (sql, params = []) => {
    const text = String(sql);
    if (/INSERT INTO function_audit_intents/.test(text)) {
      state.intent = {
        intent_id: params[0], action_type: params[1], actor_id: params[2], tenant_id: params[3],
        workspace_id: params[4], correlation_id: params[5], detail: JSON.parse(params[6]),
        recovery_due_at: params[7], finalized_at: null
      };
      return { rows: [state.intent] };
    }
    if (/SELECT \* FROM function_audit_intents/.test(text)) {
      return { rows: state.intent && !state.intent.finalized_at ? [state.intent] : [] };
    }
    if (/SELECT row_hash FROM plan_audit_events/.test(text)) return { rows: [] };
    if (/INSERT INTO plan_audit_events/.test(text)) {
      if (state.failAuditOnce) { state.failAuditOnce = false; throw new Error('audit unavailable'); }
      state.audit = { id: params[0], outcome: params[6] };
      return { rows: [state.audit] };
    }
    if (/INSERT INTO function_audit_outbox/.test(text)) {
      state.outbox = { eventId: params[0], topic: params[1], payload: JSON.parse(params[3]) };
      return { rows: [] };
    }
    if (/UPDATE function_audit_intents/.test(text)) {
      state.intent.finalized_at = new Date().toISOString();
      state.intent.audit_event_id = params[1];
      return { rows: [] };
    }
    return { rows: [] };
  };
  const client = { query, release() {} };
  const pool = { query, connect: async () => client };
  const intent = await beginFunctionAuditIntent(pool, {
    actionType: 'function.rolled_back', actorId: 'usr_owner', tenantId: 'ten_a', workspaceId: 'wrk_a',
    correlationId: 'cor_rollback', detail: { functionId: 'fn_a', targetVersionId: 'fnv_old' },
    recoveryDueAt: new Date(0).toISOString()
  });
  const effects = ['knative-deployed'];
  await assert.rejects(() => finalizeFunctionAuditIntent(pool, intent, {
    outcome: 'succeeded', status: 202
  }), /audit unavailable/);
  assert.deepEqual(effects, ['knative-deployed']);
  assert.equal(state.intent.finalized_at, null);
  assert.equal(state.outbox, null);

  assert.equal(await recoverFunctionAuditIntents(pool, { now: new Date(), limit: 10 }), 1);
  assert.equal(state.intent.audit_event_id, intent.intent_id);
  assert.equal(state.audit.outcome, 'error');
  assert.equal(state.outbox.topic, 'function.audit.events');
  assert.equal(state.outbox.payload.outcome, 'error');
  assert.equal(state.outbox.payload.detail.recovered, true);
});

test('dispatcher never duplicates an audit intent already finalized by the Function handler', async () => {
  let writes = 0;
  const db = {
    query: async () => { writes += 1; return { rows: [] }; },
    connect: async () => {
      writes += 1;
      throw new Error('duplicate audit transaction must not start');
    }
  };
  const result = await recordDispatchedRouteAudit(
    db,
    { method: 'POST', path: '/v1/functions/actions/{actionId}/rollback', localHandler: 'fnRollback' },
    {
      functionAuditHandled: true,
      resolvedScope: { tenantId: 'ten_a', workspaceId: 'wrk_a' },
      identity: { sub: 'usr_owner' }
    },
    { statusCode: 202 },
    'cor_rollback'
  );
  assert.equal(result, null);
  assert.equal(writes, 0);
});

test('function quota resolves canonical max_functions and evaluates hard limits', async () => {
  const load = async () => ({
    resolveEffectiveLimit: async (_pool, tenantId, dimension) => {
      assert.equal(tenantId, 'ten_a');
      assert.equal(dimension, 'max_functions');
      return { effectiveLimit: 50, effectiveCeiling: 50, quotaType: 'hard', graceMargin: 0, source: 'plan' };
    },
    evaluateQuotaDecision: ({ effectiveLimit, currentUsage }) => ({
      allowed: currentUsage < effectiveLimit,
      decision: currentUsage < effectiveLimit ? 'allowed' : 'hard_blocked',
      effectiveLimit,
      effectiveCeiling: effectiveLimit,
      quotaType: 'hard', graceMargin: 0, currentUsage
    })
  });
  assert.equal((await checkFunctionQuota({}, 'ten_a', 49, { load })).allowed, true);
  const blocked = await checkFunctionQuota({}, 'ten_a', 50, { load });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.dimensionKey, 'max_functions');
  assert.equal(blocked.source, 'plan');
});
