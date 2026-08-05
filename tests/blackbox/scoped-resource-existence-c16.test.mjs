/**
 * C-16 black-box regression: scoped reads must resolve the target registry row
 * before invoking metrics, audit, export, bucket, or object-store dependencies.
 *
 * Drives only the public METRICS_HANDLERS and STORAGE_HANDLERS exports. All
 * infrastructure dependencies are deterministic public-interface test doubles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const TENANT_A = 'ten_c16_a';
const TENANT_B = 'ten_c16_b';
const TENANT_UNKNOWN = 'ten_c16_unknown';
const WORKSPACE_A_EMPTY = 'wrk_c16_a_empty';
const WORKSPACE_B = 'wrk_c16_b';
const WORKSPACE_UNKNOWN = 'wrk_c16_unknown';

const TENANTS = {
  [TENANT_A]: {
    id: TENANT_A,
    slug: 'c16-a',
    display_name: 'C-16 Tenant A',
    status: 'active'
  },
  [TENANT_B]: {
    id: TENANT_B,
    slug: 'c16-b',
    display_name: 'C-16 Tenant B',
    status: 'active'
  }
};

const WORKSPACES = {
  [WORKSPACE_A_EMPTY]: {
    id: WORKSPACE_A_EMPTY,
    tenant_id: TENANT_A,
    slug: 'c16-a-empty',
    display_name: 'C-16 empty workspace A',
    status: 'active',
    environment: 'test',
    created_at: '2026-08-05T00:00:00.000Z'
  },
  [WORKSPACE_B]: {
    id: WORKSPACE_B,
    tenant_id: TENANT_B,
    slug: 'c16-b',
    display_name: 'C-16 workspace B',
    status: 'active',
    environment: 'test',
    created_at: '2026-08-05T00:00:00.000Z'
  }
};

const OWNER_A = {
  sub: 'usr_c16_owner_a',
  tenantId: TENANT_A,
  workspaceId: WORKSPACE_A_EMPTY,
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: []
};
const SUPERADMIN = {
  sub: 'usr_c16_superadmin',
  tenantId: null,
  workspaceId: null,
  actorType: 'superadmin',
  roles: ['superadmin'],
  scopes: []
};
const INTERNAL = {
  sub: 'svc_c16_internal',
  tenantId: null,
  workspaceId: null,
  actorType: 'internal',
  roles: ['internal'],
  scopes: []
};

const TENANT_HANDLER_CASES = [
  { name: 'metricsTenantQuotas', fn: 'fn-observability-quota-usage' },
  { name: 'metricsTenantOverview', fn: 'fn-observability-quota-usage' },
  { name: 'metricsTenantUsage', fn: 'fn-observability-quota-usage' },
  { name: 'metricsTenantSeries', fn: 'fn-observability-metric-series' },
  { name: 'metricsTenantAudit', fn: 'fn-observability-audit-record-query' },
  { name: 'metricsTenantAuditExport', fn: 'fn-observability-audit-export' }
];

const WORKSPACE_HANDLER_CASES = [
  { name: 'metricsWorkspaceQuotas', fn: 'fn-observability-quota-usage' },
  { name: 'metricsWorkspaceOverview', fn: 'fn-observability-quota-usage' },
  { name: 'metricsWorkspaceUsage', fn: 'fn-observability-quota-usage' },
  { name: 'metricsWorkspaceSeries', fn: 'fn-observability-metric-series' },
  { name: 'metricsWorkspaceAudit', fn: 'fn-observability-audit-record-query' },
  { name: 'metricsWorkspaceAuditExport', fn: 'fn-observability-audit-export' }
];

function registryPool({ tenants = TENANTS, workspaces = WORKSPACES } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params: [...params] });

      if (/\bFROM\s+tenants\b/i.test(text)) {
        const target = tenants[params[0]] ?? Object.values(tenants).find(({ slug }) => slug === params[0]);
        return { rows: target ? [target] : [] };
      }
      if (/\bFROM\s+workspaces\b/i.test(text)) {
        const target = workspaces[params[0]] ?? Object.values(workspaces).find(({ slug }) => slug === params[0]);
        return { rows: target ? [target] : [] };
      }
      if (/\bFROM\s+workspace_buckets\b/i.test(text)) return { rows: [] };
      if (/\bFROM\s+plan_audit_events\b/i.test(text)) return { rows: [] };

      throw new Error(`unexpected public-store query: ${text}`);
    },
    async connect() {
      return {
        query: this.query.bind(this),
        release() {}
      };
    }
  };
}

function failingRegistryPool(registry) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params: [...params] });

      if (registry === 'tenant' && /\bFROM\s+tenants\b/i.test(text)) {
        throw Object.assign(new Error('simulated tenant registry failure'), { code: 'C16_REGISTRY_UNAVAILABLE' });
      }
      if (registry === 'workspace' && /\bFROM\s+workspaces\b/i.test(text)) {
        throw Object.assign(new Error('simulated workspace registry failure'), { code: 'C16_REGISTRY_UNAVAILABLE' });
      }
      if (/\bFROM\s+tenants\b/i.test(text)) return { rows: [TENANTS[TENANT_A]] };
      if (/\bFROM\s+workspaces\b/i.test(text)) return { rows: [WORKSPACES[WORKSPACE_A_EMPTY]] };
      if (/\bFROM\s+workspace_buckets\b/i.test(text)) return { rows: [] };
      if (/\bFROM\s+plan_audit_events\b/i.test(text)) return { rows: [] };

      throw new Error(`unexpected public-store query: ${text}`);
    },
    async connect() {
      return {
        query: this.query.bind(this),
        release() {}
      };
    }
  };
}

function tenantContext(identity, tenantId, overrides = {}) {
  const counters = {
    limits: 0,
    prometheus: 0,
    export: 0,
    s3: 0
  };
  const pool = overrides.pool ?? registryPool();
  const ctx = {
    pool,
    params: { tenantId },
    query: {},
    body: { format: 'jsonl', pageSize: 1 },
    identity,
    callerContext: {
      actor: { id: identity.sub, type: identity.actorType, tenantId: identity.tenantId },
      correlationId: 'corr_c16',
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId
    },
    nowMs: () => Date.parse('2026-08-05T00:00:00.000Z'),
    async loadLimits() {
      counters.limits += 1;
      return [];
    },
    async fetchImpl() {
      counters.prometheus += 1;
      return {
        ok: true,
        async json() {
          return { status: 'success', data: { result: [] } };
        }
      };
    },
    auditExportBuilder: {
      exportTenantAuditRecordsPreview(context, input) {
        counters.export += 1;
        return {
          exportId: 'exp_c16',
          queryScope: 'tenant',
          format: input.format,
          maskingProfileId: 'default_masked',
          correlationId: context.correlationId,
          generatedAt: input.generatedAt,
          appliedFilters: input.filters ?? {},
          itemCount: 0,
          maskedItemCount: 0,
          items: []
        };
      }
    },
    ...overrides
  };
  return { ctx, pool, counters };
}

function workspaceMetricsContext(identity, workspaceId, overrides = {}) {
  const counters = {
    limits: 0,
    prometheus: 0,
    export: 0
  };
  const pool = overrides.pool ?? registryPool();
  const ctx = {
    pool,
    params: { workspaceId },
    query: {},
    body: { format: 'jsonl', pageSize: 1 },
    identity,
    callerContext: {
      actor: { id: identity.sub, type: identity.actorType, tenantId: identity.tenantId },
      correlationId: 'corr_c16_workspace_metrics',
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId
    },
    nowMs: () => Date.parse('2026-08-05T00:00:00.000Z'),
    async loadLimits() {
      counters.limits += 1;
      return [];
    },
    async fetchImpl() {
      counters.prometheus += 1;
      return {
        ok: true,
        async json() {
          return { status: 'success', data: { result: [] } };
        }
      };
    },
    auditExportBuilder: {
      exportWorkspaceAuditRecordsPreview(context, input) {
        counters.export += 1;
        return {
          exportId: 'exp_c16_workspace',
          queryScope: 'workspace',
          format: input.format,
          maskingProfileId: 'default_masked',
          correlationId: context.correlationId,
          generatedAt: input.generatedAt,
          appliedFilters: input.filters ?? {},
          itemCount: 0,
          maskedItemCount: 0,
          items: []
        };
      }
    },
    ...overrides
  };
  return { ctx, pool, counters };
}

function auditCalls(pool) {
  return pool.calls.filter(({ sql }) => /\bFROM\s+plan_audit_events\b/i.test(sql));
}

function bucketCalls(pool) {
  return pool.calls.filter(({ sql }) => /\bFROM\s+workspace_buckets\b/i.test(sql));
}

function registryCalls(pool, registry) {
  const table = registry === 'tenant' ? 'tenants' : 'workspaces';
  return pool.calls.filter(({ sql }) => new RegExp(`\\bFROM\\s+${table}\\b`, 'i').test(sql));
}

function storageContext(identity, workspaceId, overrides = {}) {
  const pool = overrides.pool ?? registryPool();
  const counters = { s3: 0 };
  const ctx = {
    pool,
    params: { workspaceId },
    query: {},
    body: {},
    identity,
    callerContext: {
      actor: { id: identity.sub, type: identity.actorType, tenantId: identity.tenantId },
      correlationId: 'corr_c16',
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId
    },
    async fetchImpl() {
      counters.s3 += 1;
      throw new Error('storage usage must not fetch S3 without a registered bucket');
    },
    ...overrides
  };
  return { ctx, pool, counters };
}

async function withGlobalFetchProbe(counters, counterName, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    counters[counterName] += 1;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async json() {
        return { status: 'success', data: { result: [] } };
      },
      async text() {
        return '<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>';
      }
    };
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// bbx-c16-001 | fn-observability-scope-guard | OpenSpec #### Scenario: Authorized privileged caller addresses an unknown tenant
for (const identity of [SUPERADMIN, INTERNAL]) {
  for (const handlerCase of TENANT_HANDLER_CASES) {
    test(`bbx-c16-001.${identity.actorType}.${handlerCase.name} | ${handlerCase.fn} | Scenario: Authorized privileged caller addresses an unknown tenant`, async () => {
      const { ctx, pool, counters } = tenantContext(identity, TENANT_UNKNOWN);
      const result = await withGlobalFetchProbe(counters, 'prometheus', () => METRICS_HANDLERS[handlerCase.name](ctx));

      assert.equal(result.statusCode, 404, `${handlerCase.name}: expected 404, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.code, 'TENANT_NOT_FOUND');
      assert.equal(registryCalls(pool, 'tenant').length, 1, 'authorized unknown target performs one authoritative lookup');
      assert.deepEqual(counters, { limits: 0, prometheus: 0, export: 0, s3: 0 });
      assert.equal(auditCalls(pool).length, 0, 'terminal tenant result must precede audit SQL');
    });
  }
}

// bbx-c16-002 | fn-observability-scope-guard | OpenSpec #### Scenario: Foreign existing tenant remains forbidden without probing; #### Scenario: Unrelated unknown tenant is indistinguishable from foreign existing
for (const target of [TENANT_B, TENANT_UNKNOWN]) {
  for (const handlerCase of TENANT_HANDLER_CASES) {
    const scenario = target === TENANT_B
      ? 'Foreign existing tenant remains forbidden without probing'
      : 'Unrelated unknown tenant is indistinguishable from foreign existing';
    test(`bbx-c16-002.${target}.${handlerCase.name} | ${handlerCase.fn} | Scenario: ${scenario}`, async () => {
      const { ctx, pool, counters } = tenantContext(OWNER_A, target);
      const result = await withGlobalFetchProbe(counters, 'prometheus', () => METRICS_HANDLERS[handlerCase.name](ctx));

      assert.equal(result.statusCode, 403, `${handlerCase.name}: expected opaque 403, got ${result.statusCode}`);
      assert.equal(result.body.code, 'FORBIDDEN');
      assert.equal(registryCalls(pool, 'tenant').length, 0, 'authorization denial must not probe tenant existence');
      assert.deepEqual(counters, { limits: 0, prometheus: 0, export: 0, s3: 0 });
      assert.equal(auditCalls(pool).length, 0, 'authorization denial must precede audit SQL');
    });
  }
}

// bbx-c16-003 | fn-observability-scope-guard | OpenSpec #### Scenario: Existing authorized tenant reaches its handler
for (const [identity, target] of [[OWNER_A, TENANT_A], [SUPERADMIN, TENANT_B], [INTERNAL, TENANT_B]]) {
  for (const handlerCase of TENANT_HANDLER_CASES) {
    test(`bbx-c16-003.${identity.actorType}.${handlerCase.name} | ${handlerCase.fn} | Scenario: Existing authorized tenant reaches its handler`, async () => {
      const { ctx, counters } = tenantContext(identity, target);
      const result = await withGlobalFetchProbe(counters, 'prometheus', () => METRICS_HANDLERS[handlerCase.name](ctx));
      assert.equal(result.statusCode, 200, `${handlerCase.name}: expected existing target to remain readable, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
    });
  }
}

// bbx-c16-004 | fn-storage-workspace-usage | OpenSpec #### Scenario: Privileged caller addresses unknown workspace storage
for (const identity of [SUPERADMIN, INTERNAL]) {
  test(`bbx-c16-004.${identity.actorType} | fn-storage-workspace-usage | Scenario: Privileged caller addresses unknown workspace storage`, async () => {
    const { ctx, pool, counters } = storageContext(identity, WORKSPACE_UNKNOWN);
    const result = await withGlobalFetchProbe(counters, 's3', () => STORAGE_HANDLERS.storageWorkspaceUsage(ctx));

    assert.equal(result.statusCode, 404, `expected 404, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.code, 'WORKSPACE_NOT_FOUND');
    assert.equal(registryCalls(pool, 'workspace').length, 1, 'unknown workspace performs one authoritative lookup');
    assert.equal(bucketCalls(pool).length, 0, 'terminal workspace result must precede workspace_buckets lookup');
    assert.equal(counters.s3, 0, 'terminal workspace result must precede S3 fetch');
  });
}

// bbx-c16-005 | fn-storage-tenant-isolation | OpenSpec #### Scenario: Constrained caller receives opaque not found for foreign workspace; #### Scenario: Constrained caller receives the same outcome for unknown workspace
for (const target of [WORKSPACE_B, WORKSPACE_UNKNOWN]) {
  const scenario = target === WORKSPACE_B
    ? 'Constrained caller receives opaque not found for foreign workspace'
    : 'Constrained caller receives the same outcome for unknown workspace';
  test(`bbx-c16-005.${target} | fn-storage-tenant-isolation | Scenario: ${scenario}`, async () => {
    const { ctx, pool, counters } = storageContext(OWNER_A, target);
    const result = await withGlobalFetchProbe(counters, 's3', () => STORAGE_HANDLERS.storageWorkspaceUsage(ctx));

    assert.equal(result.statusCode, 404, `expected opaque 404, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.code, 'WORKSPACE_NOT_FOUND');
    assert.equal(registryCalls(pool, 'workspace').length, 1, 'ownership is resolved exactly once');
    assert.equal(bucketCalls(pool).length, 0, 'terminal workspace result must precede workspace_buckets lookup');
    assert.equal(counters.s3, 0, 'terminal workspace result must precede S3 fetch');
  });
}

// bbx-c16-006 | fn-storage-workspace-usage | OpenSpec #### Scenario: Existing workspace with no storage remains a truthful zero usage success
for (const identity of [OWNER_A, SUPERADMIN, INTERNAL]) {
  test(`bbx-c16-006.${identity.actorType} | fn-storage-workspace-usage | Scenario: Existing workspace with no storage remains a truthful zero usage success`, async () => {
    const { ctx, pool, counters } = storageContext(identity, WORKSPACE_A_EMPTY);
    const result = await withGlobalFetchProbe(counters, 's3', () => STORAGE_HANDLERS.storageWorkspaceUsage(ctx));

    assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.collectionStatus, 'complete');
    assert.equal(registryCalls(pool, 'workspace').length, 1, 'existing workspace is resolved exactly once');
    assert.equal(bucketCalls(pool).length, 1, 'existing workspace must perform one bucket lookup');
    assert.equal(counters.s3, 0, 'zero-bucket workspace must not fetch S3');
  });
}

// bbx-c16-009 | fn-observability-scope-guard | OpenSpec #### Scenario: Workspace registry failure is not absence
test('bbx-c16-009.metricsWorkspaceQuotas | fn-observability-quota-usage | Scenario: Workspace registry failure is not absence', async () => {
  assert.deepEqual(
    WORKSPACE_HANDLER_CASES.map(({ name }) => name),
    [
      'metricsWorkspaceQuotas',
      'metricsWorkspaceOverview',
      'metricsWorkspaceUsage',
      'metricsWorkspaceSeries',
      'metricsWorkspaceAudit',
      'metricsWorkspaceAuditExport'
    ],
    'representative handler belongs to the complete public workspace metrics family'
  );
  for (const { name } of WORKSPACE_HANDLER_CASES) {
    assert.equal(typeof METRICS_HANDLERS[name], 'function', `${name} must remain on the public handler surface`);
  }

  const pool = failingRegistryPool('workspace');
  const { ctx, counters } = workspaceMetricsContext(SUPERADMIN, WORKSPACE_A_EMPTY, { pool });
  const outcome = await withGlobalFetchProbe(counters, 'prometheus', () =>
    Promise.allSettled([METRICS_HANDLERS.metricsWorkspaceQuotas(ctx)]).then(([result]) => result)
  );

  assert.equal(
    outcome.status,
    'rejected',
    `workspace registry failure must propagate, got ${outcome.value?.statusCode}: ${JSON.stringify(outcome.value?.body)}`
  );
  assert.equal(outcome.reason?.code, 'C16_REGISTRY_UNAVAILABLE');
  assert.notEqual(outcome.reason?.statusCode, 404, 'registry failure must not become handler not-found');
  assert.notEqual(outcome.reason?.code, 'WORKSPACE_NOT_FOUND', 'registry failure must not become WORKSPACE_NOT_FOUND');
  assert.equal(registryCalls(pool, 'workspace').length, 1, 'shared workspace guard performs exactly one authoritative lookup');
  assert.equal(registryCalls(pool, 'tenant').length, 0, 'shared workspace guard must not re-probe the tenant registry');
  assert.deepEqual(counters, { limits: 0, prometheus: 0, export: 0 });
  assert.equal(auditCalls(pool).length, 0, 'registry failure must precede audit SQL');
});

// bbx-c16-007 | fn-observability-scope-guard | OpenSpec #### Scenario: Tenant registry failure is not absence
for (const handlerCase of TENANT_HANDLER_CASES) {
  test(`bbx-c16-007.${handlerCase.name} | ${handlerCase.fn} | Scenario: Tenant registry failure is not absence`, async () => {
    const pool = failingRegistryPool('tenant');
    const { ctx, counters } = tenantContext(SUPERADMIN, TENANT_A, { pool });
    const outcome = await withGlobalFetchProbe(counters, 'prometheus', () =>
      Promise.allSettled([METRICS_HANDLERS[handlerCase.name](ctx)]).then(([result]) => result)
    );

    assert.equal(
      outcome.status,
      'rejected',
      `${handlerCase.name}: registry failure must propagate, got ${outcome.value?.statusCode}: ${JSON.stringify(outcome.value?.body)}`
    );
    assert.notEqual(outcome.reason?.statusCode, 404, 'registry failure must not become handler not-found');
    assert.notEqual(outcome.reason?.code, 'TENANT_NOT_FOUND', 'registry failure must not become TENANT_NOT_FOUND');
    assert.equal(registryCalls(pool, 'tenant').length, 1, 'authorized request performs one authoritative lookup');
    assert.deepEqual(counters, { limits: 0, prometheus: 0, export: 0, s3: 0 });
    assert.equal(auditCalls(pool).length, 0, 'registry failure must precede audit SQL');
  });
}

// bbx-c16-008 | fn-storage-workspace-usage | OpenSpec #### Scenario: Workspace registry failure is not absence
for (const identity of [OWNER_A, SUPERADMIN, INTERNAL]) {
  test(`bbx-c16-008.${identity.actorType} | fn-storage-workspace-usage | Scenario: Workspace registry failure is not absence`, async () => {
    const pool = failingRegistryPool('workspace');
    const { ctx, counters } = storageContext(identity, WORKSPACE_A_EMPTY, { pool });
    const outcome = await withGlobalFetchProbe(counters, 's3', () =>
      Promise.allSettled([STORAGE_HANDLERS.storageWorkspaceUsage(ctx)]).then(([result]) => result)
    );

    assert.equal(
      outcome.status,
      'rejected',
      `registry failure must propagate, got ${outcome.value?.statusCode}: ${JSON.stringify(outcome.value?.body)}`
    );
    assert.notEqual(outcome.reason?.statusCode, 404, 'registry failure must not become handler not-found');
    assert.notEqual(outcome.reason?.code, 'WORKSPACE_NOT_FOUND', 'registry failure must not become WORKSPACE_NOT_FOUND');
    assert.equal(registryCalls(pool, 'workspace').length, 1, 'request performs one authoritative workspace lookup');
    assert.equal(bucketCalls(pool).length, 0, 'registry failure must precede workspace_buckets lookup');
    assert.equal(counters.s3, 0, 'registry failure must precede S3 fetch');
  });
}
