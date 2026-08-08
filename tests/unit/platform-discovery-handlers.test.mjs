// Focused unit tests for the C-08 platform discovery + billing read handlers
// (apps/control-plane/platform-discovery-handlers.mjs): the two billing usage reads
// and the three platform discovery reads (route catalog, storage-provider
// introspection, topology regions).
//
// These assert the acceptance behaviour that separates a REAL scoped handler from
// a stub: platform authorization runs before any backend access, billing is
// tenant-filtered by the durable repository, discovery reads project the canonical
// sources without leaking secrets, and every read is side-effect-free. A fake pg
// pool records the SQL each handler runs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PLATFORM_DISCOVERY_HANDLERS, isPlatformActor } from '../../apps/control-plane/platform-discovery-handlers.mjs';
import { validateC08Schema } from '../../apps/control-plane/c08-contracts.mjs';

const PLATFORM = { actorType: 'superadmin', sub: 'admin-1', roles: ['superadmin'], tenantId: null };
const OWNER_A = { actorType: 'tenant_owner', sub: 'owner-a', roles: ['tenant_owner'], tenantId: 'ten_a' };

function fakePool(matchers = []) {
  const calls = [];
  const pool = {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      for (const m of matchers) {
        if (m.match.test(String(sql))) {
          const rows = typeof m.rows === 'function' ? m.rows(String(sql), params) : m.rows;
          return { rows: rows ?? [], rowCount: (rows ?? []).length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return { query: (s, p) => pool.query(s, p), release() {} }; }
  };
  return pool;
}
function mkCtx({ identity = PLATFORM, params = {}, query = {}, pool } = {}) {
  return {
    identity, params, query, pool,
    req: { headers: {} },
    callerContext: { correlationId: 'cor-00000001', actor: { id: identity?.sub, type: identity?.actorType, roles: identity?.roles ?? [] } }
  };
}
const writeRe = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|MERGE|TRUNCATE)\b/i;
function assertNoWrites(pool) {
  assert.deepEqual(pool.calls.filter((c) => writeRe.test(c.sql)).map((w) => w.sql), [], 'read handler must issue no write SQL');
}

test('isPlatformActor: the published platform-team audience can read discovery data', () => {
  assert.equal(isPlatformActor(PLATFORM), true);
  assert.equal(isPlatformActor({ actorType: 'internal' }), true);
  assert.equal(isPlatformActor({ actorType: 'tenant_owner', roles: ['platform_admin'] }), true);
  assert.equal(isPlatformActor({ actorType: 'tenant_owner', roles: ['platform_operator'] }), true);
  assert.equal(isPlatformActor({ actorType: 'tenant_owner', roles: ['platform_auditor'] }), true);
  assert.equal(isPlatformActor(OWNER_A), false);
  assert.equal(isPlatformActor(null), false);
});

test('all five discovery/billing operations deny a non-platform actor before backend access', async () => {
  for (const [name, handler] of Object.entries(PLATFORM_DISCOVERY_HANDLERS)) {
    const pool = fakePool();
    const res = await handler(mkCtx({ identity: OWNER_A, params: { tenantId: 'ten_a' }, pool }));
    assert.equal(res.statusCode, 403, `${name} must forbid a tenant owner`);
    assert.equal(pool.calls.length, 0, `${name} must not touch a backend after denial`);
  }
});

test('getRouteCatalog projects the canonical catalog for a platform actor', async () => {
  const pool = fakePool();
  const res = await PLATFORM_DISCOVERY_HANDLERS.getRouteCatalog(mkCtx({ pool }));
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.body.version === 'string');
  assert.ok(Array.isArray(res.body.items) && res.body.items.length > 0);
  assert.equal(res.body.items.length, 25);
  assert.equal(res.body.page.size, res.body.items.length);
  assert.ok(res.body.page.nextCursor);
  assert.ok(res.body.items.every((i) => i.method && i.path && i.operationId));
  assert.equal(validateC08Schema('RouteCatalogResponse', res.body).valid, true);
  assertNoWrites(pool);
});

test('getRouteCatalog applies filters and an opaque stable cursor', async () => {
  const pool = fakePool();
  const first = await PLATFORM_DISCOVERY_HANDLERS.getRouteCatalog(mkCtx({
    pool, query: { family: 'platform', method: 'GET', sort: 'operationId', 'page[size]': '2' }
  }));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.items.every((item) => item.family === 'platform' && item.method === 'GET'));
  const second = await PLATFORM_DISCOVERY_HANDLERS.getRouteCatalog(mkCtx({
    pool,
    query: {
      family: 'platform', method: 'GET', sort: 'operationId', 'page[size]': '2',
      'page[after]': first.body.page.nextCursor
    }
  }));
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.page.after, first.body.page.nextCursor);
  assert.equal(second.body.items.some((item) => first.body.items.some((prior) => prior.operationId === item.operationId)), false);
  assert.equal(validateC08Schema('RouteCatalogResponse', second.body).valid, true);
  const empty = await PLATFORM_DISCOVERY_HANDLERS.getRouteCatalog(mkCtx({
    pool, query: { search: 'no-such-c08-operation-metadata' }
  }));
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.page.size, 25);
  assert.equal(validateC08Schema('RouteCatalogResponse', empty.body).valid, true);
  assertNoWrites(pool);
});

test('listTopologyRegions returns the canonical supported regions as strings', async () => {
  const pool = fakePool();
  const res = await PLATFORM_DISCOVERY_HANDLERS.listTopologyRegions(mkCtx({ pool }));
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.regions) && res.body.regions.every((r) => typeof r === 'string'));
  assert.equal(validateC08Schema('TopologyRegionsResponse', res.body).valid, true);
  assertNoWrites(pool);
});

test('getStorageProviderIntrospection reports config without leaking secrets', async () => {
  const prev = { ...process.env };
  process.env.STORAGE_S3_ENDPOINT = 'http://falcone-seaweedfs-s3:8333';
  process.env.STORAGE_S3_ACCESS_KEY = 'AKIDEXAMPLEACCESS';
  process.env.STORAGE_S3_SECRET_KEY = 'THE-SECRET-VALUE';
  try {
    const res = await PLATFORM_DISCOVERY_HANDLERS.getStorageProviderIntrospection(mkCtx({}));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.providerType, 'seaweedfs');
    assert.equal(res.body.status, 'ready');
    assert.equal(res.body.configured, true);
    assert.equal(res.body.backendFamily, 's3-compatible');
    assert.equal(res.body.capabilityManifestVersion, 'v2');
    assert.equal(res.body.capabilityBaseline.eligible, true);
    assert.equal(res.body.capabilityDetails.length > 4, true);
    assert.equal(
      res.body.capabilityDetails.some((entry) => entry.capabilityId === 'object.versioning'),
      true
    );
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes('THE-SECRET-VALUE'), 'must not leak the secret key');
    assert.ok(!serialized.includes('AKIDEXAMPLEACCESS'), 'must not leak the access key');
  } finally {
    process.env = prev;
  }
});

test('listTenantBillingUsageRecords forbids non-platform and tenant-filters for a platform actor', async () => {
  const forbidden = await PLATFORM_DISCOVERY_HANDLERS.listTenantBillingUsageRecords(
    mkCtx({ identity: OWNER_A, params: { tenantId: 'ten_a' }, pool: fakePool() })
  );
  assert.equal(forbidden.statusCode, 403);

  const pool = fakePool([
    { match: /FROM tenants/, rows: [{ id: 'ten_a' }] },
    { match: /FROM billing_usage_records/, rows: [{
    id: 'b1', tenant_id: 'ten_a', cycle_id: 'c1', dimensions: [],
    has_degraded_dimensions: false, snapshot_at: '2026-08-08T00:00:00.000Z'
    }] }
  ]);
  const res = await PLATFORM_DISCOVERY_HANDLERS.listTenantBillingUsageRecords(
    mkCtx({ identity: PLATFORM, params: { tenantId: 'ten_a' }, pool })
  );
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.records));
  assert.equal(res.body.records[0].tenantId, 'ten_a');
  assert.equal(res.body.records[0].tenant_id, undefined);
  assert.equal(validateC08Schema('BillingUsageRecordList', res.body).valid, true);
  const billingCall = pool.calls.find((c) => /FROM billing_usage_records/.test(c.sql));
  assert.ok(/WHERE tenant_id = \$1/.test(billingCall.sql), 'tenant-scoped billing query');
  assert.equal(billingCall.params[0], 'ten_a');
  assertNoWrites(pool);
});

test('listBillingUsageRecords (platform-wide) returns records + pagination for a platform actor', async () => {
  const pool = fakePool([{ match: /FROM billing_usage_records/, rows: [
    { id: 'b1', tenant_id: 'ten_a', cycle_id: 'c1', dimensions: [], has_degraded_dimensions: false },
    { id: 'b2', tenant_id: 'ten_b', cycle_id: 'c1', dimensions: [], has_degraded_dimensions: false }
  ] }]);
  const res = await PLATFORM_DISCOVERY_HANDLERS.listBillingUsageRecords(mkCtx({ pool }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.records.length, 2);
  assert.ok(res.body.pagination && typeof res.body.pagination.limit === 'number');
  assert.equal(validateC08Schema('BillingUsageRecordList', res.body).valid, true);
  assertNoWrites(pool);
});

test('billing reads admit every published platform_team read role', async () => {
  for (const role of ['platform_admin', 'platform_operator', 'platform_auditor']) {
    const identity = { actorType: 'tenant_member', sub: `usr_${role}`, roles: [role], tenantId: null };
    const pool = fakePool([{ match: /FROM billing_usage_records/, rows: [] }]);
    const response = await PLATFORM_DISCOVERY_HANDLERS.listBillingUsageRecords(mkCtx({ identity, pool }));
    assert.equal(response.statusCode, 200, role);
    assert.equal(pool.calls.some((call) => /FROM billing_usage_records/.test(call.sql)), true, role);
  }
});

test('billing handlers honor published page[size]/page[after] and validate tenant identifiers', async () => {
  const rows = [
    { id: '00000000-0000-0000-0000-000000000003', tenant_id: 'ten_a', cycle_id: 'c3', created_at: '2026-08-08T03:00:00.000Z', dimensions: [], has_degraded_dimensions: false },
    { id: '00000000-0000-0000-0000-000000000002', tenant_id: 'ten_a', cycle_id: 'c2', created_at: '2026-08-08T02:00:00.000Z', dimensions: [], has_degraded_dimensions: false },
    { id: '00000000-0000-0000-0000-000000000001', tenant_id: 'ten_a', cycle_id: 'c1', created_at: '2026-08-08T01:00:00.000Z', dimensions: [], has_degraded_dimensions: false }
  ];
  const firstPool = fakePool([{ match: /FROM billing_usage_records/, rows }]);
  const first = await PLATFORM_DISCOVERY_HANDLERS.listBillingUsageRecords(mkCtx({
    pool: firstPool, query: { 'page[size]': '2' }
  }));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.records.length, 2);
  assert.ok(first.body.pagination.nextCursor);
  assert.equal(firstPool.calls[0].params.at(-1), 3, 'repository fetches size + 1 to detect the next page');
  assert.doesNotMatch(firstPool.calls[0].sql, /\bOFFSET\b/i);

  const secondPool = fakePool([{ match: /FROM billing_usage_records/, rows: [rows[2]] }]);
  const second = await PLATFORM_DISCOVERY_HANDLERS.listBillingUsageRecords(mkCtx({
    pool: secondPool,
    query: { 'page[size]': '2', 'page[after]': first.body.pagination.nextCursor }
  }));
  assert.equal(second.statusCode, 200);
  assert.match(secondPool.calls[0].sql, /\(created_at, id\) < \(\$1::timestamptz, \$2::uuid\)/);

  const invalidPool = fakePool();
  const invalid = await PLATFORM_DISCOVERY_HANDLERS.listTenantBillingUsageRecords(mkCtx({
    pool: invalidPool, params: { tenantId: 'tenant-a' }
  }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalidPool.calls.length, 0);

  const missingPool = fakePool([{ match: /FROM tenants/, rows: [] }]);
  const missing = await PLATFORM_DISCOVERY_HANDLERS.listTenantBillingUsageRecords(mkCtx({
    pool: missingPool, params: { tenantId: 'ten_missing' }
  }));
  assert.equal(missing.statusCode, 404);
  assert.equal(missingPool.calls.some((call) => /FROM billing_usage_records/.test(call.sql)), false);
});
