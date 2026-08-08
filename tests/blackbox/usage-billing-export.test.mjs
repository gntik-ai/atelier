/**
 * Black-box tests for change add-usage-billing-export (GitHub #256).
 *
 * Drives only the PUBLIC exported surface of the billing-export service:
 *   - emitter.mjs       :: createUsageRecord, publishUsageEvent,
 *                          emitBillingAuditEvent, createBillingAdapter,
 *                          processCycleCompletion
 *   - query-handler.mjs :: main (backing GET /v1/platform/billing/usage[/{tenantId}])
 *
 * Dependencies are injected (fake pg `db`, fake Kafka producer, fake audit
 * client). The fake db simulates the INSERT ... ON CONFLICT DO NOTHING RETURNING
 * idempotency contract: the FIRST insert for a (cycleId, tenantId) pair returns
 * the row (created=true); any REPLAY returns no row (created=false).
 *
 * Scenario coverage (tasks 1.1–1.7):
 *   bbx-billing-cycle-produces-records  : 1.1  one record per processedScopes tenant
 *   bbx-billing-idempotency             : 1.2  replay (cycleId,tenantId) → no duplicate
 *   bbx-billing-topic-publish           : 1.3  console.billing.usage once per new record
 *   bbx-billing-audit-event             : 1.4  billing_boundary_change on first create only
 *   bbx-billing-query-platform-admin    : 1.5  platform-admin → 200 paginated records
 *   bbx-billing-query-unauthorized      : 1.6  non-admin → 403 (handler-level auth)
 *   bbx-billing-query-tenant-scoped     : 1.7  tenant path → only that tenant's rows
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUsageRecord,
  publishUsageEvent,
  emitBillingAuditEvent,
  createBillingAdapter,
  processCycleCompletion,
  BILLING_USAGE_TOPIC
} from '../../packages/billing-export/src/emitter.mjs';
import { main as queryUsageRecords } from '../../packages/billing-export/src/query-handler.mjs';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * Fake pg client implementing the (cycleId, tenant_id) idempotency contract.
 * Records every SQL string + params it receives. INSERT against an already
 * stored pair returns zero rows (simulating ON CONFLICT DO NOTHING RETURNING).
 */
function makeFakeDb() {
  const store = new Map(); // key `${cycle_id}::${tenant_id}` -> row
  const calls = [];
  let idSeq = 0;
  return {
    store,
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      const sql = String(text);
      if (/insert\s+into\s+billing_usage_records/i.test(sql)) {
        const [cycleId, tenantId, snapshotAt, dimensions, hasDegraded] = params;
        const key = `${cycleId}::${tenantId}`;
        if (store.has(key)) {
          // ON CONFLICT DO NOTHING → RETURNING yields nothing
          return { rows: [], rowCount: 0 };
        }
        const row = {
          id: `00000000-0000-0000-0000-${String(++idSeq).padStart(12, '0')}`,
          cycle_id: cycleId,
          tenant_id: tenantId,
          snapshot_at: snapshotAt,
          dimensions: typeof dimensions === 'string' ? JSON.parse(dimensions) : dimensions,
          has_degraded_dimensions: Boolean(hasDegraded),
          created_at: '2026-06-09T00:00:00.000Z'
        };
        store.set(key, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/select\b[\s\S]*from\s+billing_usage_records/i.test(sql)) {
        let rows = [...store.values()];
        // Tenant-scoped filter: parameterized tenant_id predicate
        if (/where[\s\S]*tenant_id\s*=\s*\$/i.test(sql)) {
          const tenantId = params[0];
          rows = rows.filter((r) => r.tenant_id === tenantId);
        }
        // Deterministic keyset ordering equivalent to ORDER BY created_at DESC, id DESC.
        rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        if (/\(created_at, id\)\s*</i.test(sql)) {
          const tenantScoped = /tenant_id\s*=\s*\$1/i.test(sql);
          const cursorAt = params[tenantScoped ? 1 : 0];
          const cursorId = params[tenantScoped ? 2 : 1];
          rows = rows.filter((row) => row.created_at < cursorAt || (row.created_at === cursorAt && row.id < cursorId));
        }
        const limit = [...params].reverse().find((p) => typeof p === 'number' && p > 0) ?? rows.length;
        return { rows: rows.slice(0, limit), rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function makeFakeProducer() {
  return {
    sent: [],
    connected: false,
    async connect() { this.connected = true; },
    async send(payload) { this.sent.push(payload); },
    async disconnect() { this.connected = false; }
  };
}

function makeFakeAuditClient() {
  return {
    events: [],
    async emit(event) { this.events.push(event); }
  };
}

/** Build the consumption-snapshot output shape for a tenant. */
function snapshotFor(tenantId, { degraded = false } = {}) {
  return {
    tenantId,
    snapshotAt: '2026-06-09T00:00:00.000Z',
    dimensions: [
      {
        dimensionKey: 'api_calls',
        displayLabel: 'API calls',
        unit: 'count',
        currentUsage: 1000,
        usageStatus: degraded ? 'unknown' : 'ok',
        usageUnknownReason: degraded ? 'snapshot_source_unavailable' : null
      },
      {
        dimensionKey: 'storage_bytes',
        displayLabel: 'Storage',
        unit: 'bytes',
        currentUsage: 5000,
        usageStatus: 'ok',
        usageUnknownReason: null
      }
    ]
  };
}

const CYCLE = {
  cycleId: 'cyc-2026-06',
  snapshotTimestamp: '2026-06-09T00:00:00.000Z',
  processedScopes: ['tenant-a', 'tenant-b'],
  degradedDimensions: []
};

function makeCycleDeps(db, producer, auditClient, opts = {}) {
  return {
    db,
    producer,
    auditClient,
    billingAdapter: opts.billingAdapter ?? createBillingAdapter({}),
    resolveSnapshot: opts.resolveSnapshot ?? (async (tenantId) => snapshotFor(tenantId))
  };
}

// ---------------------------------------------------------------------------
// 1.2 createUsageRecord idempotency contract (the testable core)
// ---------------------------------------------------------------------------
test('bbx-billing-idempotency: first create returns created=true, replay returns created=false with no duplicate', async () => {
  const db = makeFakeDb();
  const first = await createUsageRecord(db, {
    cycleId: 'cyc-1',
    tenantId: 'tenant-a',
    dimensions: snapshotFor('tenant-a').dimensions,
    snapshotTimestamp: '2026-06-09T00:00:00.000Z',
    hasDegradedDimensions: false
  });
  assert.equal(first.created, true);
  assert.ok(first.record);
  assert.equal(first.record.cycle_id, 'cyc-1');
  assert.equal(first.record.tenant_id, 'tenant-a');

  const replay = await createUsageRecord(db, {
    cycleId: 'cyc-1',
    tenantId: 'tenant-a',
    dimensions: snapshotFor('tenant-a').dimensions,
    snapshotTimestamp: '2026-06-09T00:00:00.000Z',
    hasDegradedDimensions: false
  });
  assert.equal(replay.created, false);
  assert.equal(db.store.size, 1, 'replay must not create a duplicate row');

  // ON CONFLICT (cycle_id, tenant_id) DO NOTHING must be present in the insert SQL
  const insert = db.calls.find((c) => /insert\s+into\s+billing_usage_records/i.test(c.text));
  assert.match(insert.text, /on\s+conflict\s*\(\s*cycle_id\s*,\s*tenant_id\s*\)\s*do\s+nothing/i);
});

test('bbx-billing-idempotency: distinct cycleIds for same tenant produce separate records', async () => {
  const db = makeFakeDb();
  const a = await createUsageRecord(db, { cycleId: 'cyc-1', tenantId: 'tenant-a', dimensions: [], snapshotTimestamp: 'T', hasDegradedDimensions: false });
  const b = await createUsageRecord(db, { cycleId: 'cyc-2', tenantId: 'tenant-a', dimensions: [], snapshotTimestamp: 'T', hasDegradedDimensions: false });
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.equal(db.store.size, 2);
});

// ---------------------------------------------------------------------------
// 1.3 publishUsageEvent only when created
// ---------------------------------------------------------------------------
test('bbx-billing-topic-publish: publishUsageEvent emits to console.billing.usage when created=true', async () => {
  const producer = makeFakeProducer();
  const record = {
    id: 'rec_1', cycle_id: 'cyc-1', tenant_id: 'tenant-a',
    snapshot_at: '2026-06-09T00:00:00.000Z',
    dimensions: snapshotFor('tenant-a').dimensions,
    has_degraded_dimensions: false
  };
  await publishUsageEvent(producer, { record, created: true });
  assert.equal(producer.sent.length, 1);
  assert.equal(producer.sent[0].topic, BILLING_USAGE_TOPIC);
  assert.equal(BILLING_USAGE_TOPIC, 'console.billing.usage');
  const payload = JSON.parse(producer.sent[0].messages[0].value);
  assert.equal(payload.cycleId, 'cyc-1');
  assert.equal(payload.tenant_id ?? payload.tenantId, 'tenant-a');
  assert.ok(payload.dimensions, 'payload includes dimension map');
  assert.ok(payload.snapshot_at ?? payload.snapshotTimestamp, 'payload includes snapshot timestamp');
});

test('bbx-billing-topic-publish: publishUsageEvent does NOT emit when created=false', async () => {
  const producer = makeFakeProducer();
  await publishUsageEvent(producer, { record: { id: 'x', cycle_id: 'c', tenant_id: 't' }, created: false });
  assert.equal(producer.sent.length, 0);
});

// ---------------------------------------------------------------------------
// 1.4 emitBillingAuditEvent only when created
// ---------------------------------------------------------------------------
test('bbx-billing-audit-event: billing_boundary_change emitted on first create only', async () => {
  const auditClient = makeFakeAuditClient();
  const record = { id: 'rec_1', cycle_id: 'cyc-1', tenant_id: 'tenant-a' };

  await emitBillingAuditEvent(auditClient, { record, created: true });
  assert.equal(auditClient.events.length, 1);
  const ev = auditClient.events[0];
  assert.equal(ev.action_category ?? ev.actionCategory, 'billing_boundary_change');
  assert.equal(ev.subsystem_id ?? ev.subsystemId, 'quota_metering');
  assert.equal(ev.tenant_id ?? ev.tenantId, 'tenant-a');
  assert.equal((ev.detail ?? {}).cycleId ?? ev.cycleId, 'cyc-1');

  await emitBillingAuditEvent(auditClient, { record, created: false });
  assert.equal(auditClient.events.length, 1, 'no audit event on replay');
});

// ---------------------------------------------------------------------------
// 1.5 pluggable billing adapter
// ---------------------------------------------------------------------------
test('bbx-billing-adapter: default adapter onUsageRecord is a no-op and does not throw', async () => {
  const adapter = createBillingAdapter({});
  assert.equal(typeof adapter.onUsageRecord, 'function');
  await assert.doesNotReject(() => adapter.onUsageRecord({ id: 'rec_1' }));
});

// ---------------------------------------------------------------------------
// 1.1 cycle completion → one record per tenant; full pipeline
// ---------------------------------------------------------------------------
test('bbx-billing-cycle-produces-records: completed cycle creates one usage record per processedScopes tenant', async () => {
  const db = makeFakeDb();
  const producer = makeFakeProducer();
  const auditClient = makeFakeAuditClient();
  const deps = makeCycleDeps(db, producer, auditClient);

  const result = await processCycleCompletion(CYCLE, deps);

  assert.equal(db.store.size, 2, 'one record per tenant in processedScopes');
  assert.equal(result.created, 2);
  const tenants = [...db.store.values()].map((r) => r.tenant_id).sort();
  assert.deepEqual(tenants, ['tenant-a', 'tenant-b']);
  for (const row of db.store.values()) {
    assert.equal(row.cycle_id, CYCLE.cycleId);
    assert.equal(row.snapshot_at, CYCLE.snapshotTimestamp);
    assert.ok(Array.isArray(row.dimensions) ? row.dimensions.length === 2 : Object.keys(row.dimensions).length >= 1);
  }
});

test('bbx-billing-topic-publish: cycle publishes console.billing.usage once per NEW record and not on replay', async () => {
  const db = makeFakeDb();
  const producer = makeFakeProducer();
  const auditClient = makeFakeAuditClient();
  const deps = makeCycleDeps(db, producer, auditClient);

  await processCycleCompletion(CYCLE, deps);
  assert.equal(producer.sent.length, 2, 'one message per new record');
  for (const sent of producer.sent) assert.equal(sent.topic, BILLING_USAGE_TOPIC);

  // Replay the same cycle → no new messages, no new records.
  await processCycleCompletion(CYCLE, deps);
  assert.equal(db.store.size, 2, 'replay creates no new record');
  assert.equal(producer.sent.length, 2, 'replay publishes no new message');
});

test('bbx-billing-audit-event: cycle emits billing_boundary_change per new record, none on replay', async () => {
  const db = makeFakeDb();
  const producer = makeFakeProducer();
  const auditClient = makeFakeAuditClient();
  const deps = makeCycleDeps(db, producer, auditClient);

  await processCycleCompletion(CYCLE, deps);
  assert.equal(auditClient.events.length, 2);
  for (const ev of auditClient.events) {
    assert.equal(ev.action_category ?? ev.actionCategory, 'billing_boundary_change');
    assert.equal(ev.subsystem_id ?? ev.subsystemId, 'quota_metering');
  }

  await processCycleCompletion(CYCLE, deps);
  assert.equal(auditClient.events.length, 2, 'replay emits no audit event');
});

// ---------------------------------------------------------------------------
// 1.6 degraded dimensions
// ---------------------------------------------------------------------------
test('bbx-billing-degraded-dims: degraded dimension sets has_degraded_dimensions and includes degraded keys in payload', async () => {
  const db = makeFakeDb();
  const producer = makeFakeProducer();
  const auditClient = makeFakeAuditClient();
  const deps = makeCycleDeps(db, producer, auditClient, {
    resolveSnapshot: async (tenantId) => snapshotFor(tenantId, { degraded: tenantId === 'tenant-a' })
  });

  await processCycleCompletion(CYCLE, deps);
  const degradedRow = db.store.get(`${CYCLE.cycleId}::tenant-a`);
  const cleanRow = db.store.get(`${CYCLE.cycleId}::tenant-b`);
  assert.equal(degradedRow.has_degraded_dimensions, true);
  assert.equal(cleanRow.has_degraded_dimensions, false);

  const degradedMsg = producer.sent.find((m) => {
    const v = JSON.parse(m.messages[0].value);
    return (v.tenant_id ?? v.tenantId) === 'tenant-a';
  });
  const payload = JSON.parse(degradedMsg.messages[0].value);
  assert.equal(payload.has_degraded_dimensions ?? payload.hasDegradedDimensions, true);
  assert.ok(
    Array.isArray(payload.degradedDimensions ?? payload.degraded_dimensions),
    'payload carries degraded-dimension keys'
  );
  assert.ok((payload.degradedDimensions ?? payload.degraded_dimensions).includes('api_calls'));
});

// ---------------------------------------------------------------------------
// 1.5 query handler — platform admin
// ---------------------------------------------------------------------------
async function seedRecords(db) {
  await createUsageRecord(db, { cycleId: 'cyc-1', tenantId: 'tenant-a', dimensions: [], snapshotTimestamp: 'T', hasDegradedDimensions: false });
  await createUsageRecord(db, { cycleId: 'cyc-1', tenantId: 'tenant-b', dimensions: [], snapshotTimestamp: 'T', hasDegradedDimensions: false });
  await createUsageRecord(db, { cycleId: 'cyc-2', tenantId: 'tenant-a', dimensions: [], snapshotTimestamp: 'T', hasDegradedDimensions: false });
}

test('bbx-billing-query-platform-admin: platform-admin GET /v1/platform/billing/usage → 200 paginated records', async () => {
  const db = makeFakeDb();
  await seedRecords(db);
  const res = await queryUsageRecords(
    { callerContext: { actor: { id: 'op1', type: 'superadmin', roles: ['superadmin'] } }, pageSize: 2 },
    { db }
  );
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.records));
  assert.equal(res.body.records.length, 2, 'limit respected');
  assert.equal(res.body.pagination?.limit ?? res.body.limit, 2);
  assert.ok(res.body.pagination.nextCursor, 'a full page exposes an opaque next cursor');

  const next = await queryUsageRecords(
    {
      callerContext: { actor: { id: 'op1', type: 'superadmin', roles: ['superadmin'] } },
      pageSize: 2,
      pageAfter: res.body.pagination.nextCursor
    },
    { db }
  );
  assert.equal(next.body.records.length, 1);
  assert.equal(next.body.records.some((row) => res.body.records.some((prior) => prior.id === row.id)), false);
  assert.ok(!db.calls.some((call) => /\bOFFSET\b/i.test(call.text)), 'cursor paging never uses SQL OFFSET');
});

test('bbx-billing-query-cursor-scope: malformed and cross-tenant cursors fail before SQL', async () => {
  const db = makeFakeDb();
  await seedRecords(db);
  const callerContext = { actor: { id: 'op1', type: 'superadmin', roles: ['superadmin'] } };
  await assert.rejects(
    () => queryUsageRecords({ callerContext, tenantId: 'tenant-a', pageAfter: 'not-a-cursor' }, { db }),
    (error) => error.statusCode === 400 && error.code === 'INVALID_PAGE_CURSOR'
  );
  const platform = await queryUsageRecords({ callerContext, pageSize: 1 }, { db });
  const callsBefore = db.calls.length;
  await assert.rejects(
    () => queryUsageRecords({ callerContext, tenantId: 'tenant-a', pageAfter: platform.body.pagination.nextCursor }, { db }),
    (error) => error.statusCode === 400 && error.code === 'INVALID_PAGE_CURSOR'
  );
  assert.equal(db.calls.length, callsBefore, 'cross-scope cursor is rejected before a query');
});

test('bbx-billing-query-unauthorized: non-platform-admin actor → 403 with no record data', async () => {
  const db = makeFakeDb();
  await seedRecords(db);
  await assert.rejects(
    () => queryUsageRecords(
      { callerContext: { actor: { id: 'u1', type: 'tenant_owner', tenantId: 'tenant-a', roles: ['tenant_admin'] } } },
      { db }
    ),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.ok(!err.records, 'no record data leaked on 403');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 1.7 tenant-scoped query
// ---------------------------------------------------------------------------
test('bbx-billing-query-tenant-scoped: GET /v1/platform/billing/usage/{tenantId} returns only that tenant rows', async () => {
  const db = makeFakeDb();
  await seedRecords(db);
  const res = await queryUsageRecords(
    { callerContext: { actor: { id: 'op1', type: 'superadmin', roles: ['superadmin'] } }, tenantId: 'tenant-a' },
    { db }
  );
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.records.length >= 1);
  for (const rec of res.body.records) {
    assert.equal(rec.tenant_id ?? rec.tenantId, 'tenant-a', 'no cross-tenant rows in tenant-scoped query');
  }
  // Cross-tenant probe: tenant-b rows must NOT appear
  assert.ok(!res.body.records.some((r) => (r.tenant_id ?? r.tenantId) === 'tenant-b'));
});
