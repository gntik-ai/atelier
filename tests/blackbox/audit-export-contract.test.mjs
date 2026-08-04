import assert from 'node:assert/strict';
import test from 'node:test';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import { normalizeAuditExportRequest } from '../../apps/control-plane-executor/src/observability-audit-export.mjs';

const NOW_MS = Date.parse('2026-08-04T12:00:00.000Z');
const TENANT_ID = 'ten_c10owner';
const WORKSPACE_ID = 'wrk_c10scope';

function auditRow(index = 1, { tenantId = TENANT_ID, workspaceId = null } = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    action_type: 'api_key.created',
    action_category: 'access_change',
    actor_type: 'tenant_user',
    actor_id: 'user-c10-owner',
    tenant_id: tenantId,
    workspace_id: workspaceId,
    resource_type: 'api_key',
    resource_id: `key-${index}`,
    origin_surface: 'control_api',
    canonical_correlation_id: `corr-c10-${index}`,
    previous_state: null,
    new_state: {
      ...(workspaceId ? { workspaceId } : {}),
      password: 'never-export-this-password',
      secret: 'never-export-this-secret',
      token: 'never-export-this-token'
    },
    outcome: 'succeeded',
    correlation_id: `corr-c10-${index}`,
    created_at: `2026-08-04T11:${String(index % 60).padStart(2, '0')}:00.000Z`,
    cursor_created_at: `2026-08-04T11:${String(index % 60).padStart(2, '0')}:00.000000000Z`,
    prev_hash: index === 1 ? '' : `hash-${index - 1}`,
    row_hash: `hash-${index}`
  };
}

function fakePool({ rows = [auditRow()], workspaceTenantId = TENANT_ID } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const call = { sql: String(sql), params: [...params] };
      calls.push(call);
      if (/\bFROM\s+workspaces\b/i.test(call.sql)) {
        return {
          rows: [{
            id: WORKSPACE_ID,
            tenant_id: workspaceTenantId,
            slug: 'c10-scope',
            display_name: 'C-10 scope',
            status: 'active',
            environment: 'test',
            created_at: '2026-08-04T00:00:00.000Z',
            created_by: 'blackbox'
          }]
        };
      }
      if (/\bFROM\s+plan_audit_events\b/i.test(call.sql)) {
        const requestedLimit = Number(call.params.at(-1));
        return { rows: Number.isInteger(requestedLimit) ? rows.slice(0, requestedLimit) : rows };
      }
      throw new Error(`unexpected public-store query: ${call.sql}`);
    }
  };
}

function auditSqlCalls(pool) {
  return pool.calls.filter(({ sql }) => /\bFROM\s+plan_audit_events\b/i.test(sql));
}

function primaryBuilder(captures = []) {
  function build(scope, context, input) {
    captures.push({ scope, context, input });
    return {
      exportId: `exp-${scope}`,
      queryScope: scope,
      format: input.format,
      maskingProfileId: input.maskingProfileId ?? 'default_masked',
      correlationId: context.correlationId,
      generatedAt: input.generatedAt,
      appliedFilters: input.filters ?? {},
      itemCount: input.records.length,
      maskedItemCount: input.records.length,
      items: input.records.map((record) => ({
        ...record,
        detail: {},
        maskingApplied: true,
        maskedFieldRefs: ['detail'],
        sensitivityCategories: ['blackbox_conservative_mask']
      }))
    };
  }
  return {
    exportTenantAuditRecordsPreview: (context, input) => build('tenant', context, input),
    exportWorkspaceAuditRecordsPreview: (context, input) => build('workspace', context, input)
  };
}

function normalizingPrimaryBuilder(captures = []) {
  return { ...primaryBuilder(captures), normalizeAuditExportRequest };
}

function handlerContext({
  scope = 'tenant',
  body = {},
  pool = fakePool(),
  identityTenantId = TENANT_ID,
  builder,
  includeBuilder = true
} = {}) {
  const ctx = {
    params: scope === 'workspace' ? { workspaceId: WORKSPACE_ID } : { tenantId: TENANT_ID },
    body,
    identity: {
      sub: 'user-c10-owner',
      actorType: 'tenant_owner',
      tenantId: identityTenantId
    },
    callerContext: { correlationId: 'corr-c10-request' },
    nowMs: () => NOW_MS,
    pool
  };
  if (includeBuilder) ctx.auditExportBuilder = builder ?? primaryBuilder();
  return ctx;
}

function exportHandler(scope) {
  return scope === 'workspace'
    ? METRICS_HANDLERS.metricsWorkspaceAuditExport
    : METRICS_HANDLERS.metricsTenantAuditExport;
}

async function invokeExport({ scope = 'tenant', body, pool, builder, includeBuilder = true, identityTenantId } = {}) {
  const ctx = handlerContext({ scope, body, pool, builder, includeBuilder, identityTenantId });
  return exportHandler(scope)(ctx);
}

// bbx-c10-001 | fn-observability-audit-export | OpenSpec #### Scenario: Explicit valid export
test('bbx-c10-001 | fn-observability-audit-export | Scenario: Explicit valid export', async (t) => {
  for (const scope of ['tenant', 'workspace']) {
    for (const format of ['jsonl', 'csv']) {
      for (const pageSize of [1, 201, 500, 10000]) {
        await t.test(`bbx-c10-001.${scope}.${format}.${pageSize} preserves the requested SQL limit`, async () => {
          const captures = [];
          const pool = fakePool({ rows: [auditRow(1, { workspaceId: scope === 'workspace' ? WORKSPACE_ID : null })] });
          const result = await invokeExport({
            scope,
            body: { format, pageSize },
            pool,
            builder: primaryBuilder(captures)
          });
          const sqlCalls = auditSqlCalls(pool);

          assert.equal(result.statusCode, 200);
          assert.equal(result.body.format, format);
          assert.equal(sqlCalls.length, 1);
          assert.equal(sqlCalls[0].params.at(-1), pageSize, 'export SQL must not inherit the audit-list cap of 200');
          assert.equal(captures.length, 1);
          assert.equal(captures[0].input.format, format);
          assert.equal(captures[0].input.pageSize, pageSize);
        });
      }
    }
  }
});

// bbx-c10-002 | fn-observability-audit-export | OpenSpec #### Scenario: Omitted pageSize
test('bbx-c10-002 | fn-observability-audit-export | Scenario: Omitted pageSize defaults to 500', async (t) => {
  for (const scope of ['tenant', 'workspace']) {
    await t.test(`bbx-c10-002.${scope} uses 500 in SQL and the export builder`, async () => {
      const captures = [];
      const pool = fakePool();
      const result = await invokeExport({
        scope,
        body: { format: 'jsonl' },
        pool,
        builder: primaryBuilder(captures)
      });
      assert.equal(result.statusCode, 200);
      assert.equal(auditSqlCalls(pool).length, 1);
      assert.equal(auditSqlCalls(pool)[0].params.at(-1), 500);
      assert.equal(captures[0].input.pageSize, 500);
    });
  }
});

// bbx-c10-003 | fn-observability-audit-export | OpenSpec #### Scenario: Missing or invalid format
test('bbx-c10-003 | fn-observability-audit-export | Scenario: Missing or invalid format is rejected before SQL', async (t) => {
  for (const [label, format] of [['missing', undefined], ['unknown', 'yaml'], ['wrong-case', 'JSONL'], ['non-string', 42]]) {
    await t.test(`bbx-c10-003.${label} returns contractual 4xx without audit SQL`, async () => {
      const pool = fakePool();
      const body = { pageSize: 500 };
      if (format !== undefined) body.format = format;
      const result = await invokeExport({ body, pool });
      assert.deepEqual(
        { clientError: result.statusCode >= 400 && result.statusCode < 500, auditSqlCalls: auditSqlCalls(pool).length },
        { clientError: true, auditSqlCalls: 0 }
      );
      assert.equal(typeof result.body?.code, 'string');
    });
  }
});

// bbx-c10-004 | fn-observability-audit-export | OpenSpec #### Scenario: Invalid pageSize
test('bbx-c10-004 | fn-observability-audit-export | Scenario: Invalid pageSize is rejected before SQL', async (t) => {
  for (const [label, pageSize] of [['zero', 0], ['over-max', 10001], ['fraction', 1.5], ['numeric-string', '500']]) {
    await t.test(`bbx-c10-004.${label} returns contractual 4xx without audit SQL`, async () => {
      const pool = fakePool();
      const result = await invokeExport({ body: { format: 'csv', pageSize }, pool });
      assert.deepEqual(
        { clientError: result.statusCode >= 400 && result.statusCode < 500, auditSqlCalls: auditSqlCalls(pool).length },
        { clientError: true, auditSqlCalls: 0 }
      );
      assert.equal(typeof result.body?.code, 'string');
    });
  }
});

// bbx-c10-005 | fn-observability-audit-export | OpenSpec #### Scenario: Body cannot widen scope
test('bbx-c10-005 | fn-observability-audit-export | Scenario: Body cannot widen resolved tenant or workspace scope', async (t) => {
  for (const scope of ['tenant', 'workspace']) {
    await t.test(`bbx-c10-005.${scope} ignores adversarial body scope`, async () => {
      const captures = [];
      const pool = fakePool({ rows: [auditRow(1, { workspaceId: scope === 'workspace' ? WORKSPACE_ID : null })] });
      const result = await invokeExport({
        scope,
        body: {
          format: 'jsonl',
          pageSize: 201,
          tenantId: 'ten_foreign',
          workspaceId: 'wrk_foreign',
          filters: { tenantId: 'ten_foreign', workspaceId: 'wrk_foreign' }
        },
        pool,
        builder: primaryBuilder(captures)
      });
      const sql = auditSqlCalls(pool)[0];
      assert.equal(result.statusCode, 200);
      assert.equal(sql.params[0], TENANT_ID);
      assert.equal(captures[0].context.tenantId, TENANT_ID);
      assert.equal(captures[0].context.workspaceId ?? null, scope === 'workspace' ? WORKSPACE_ID : null);
      assert.equal(captures[0].input.workspaceId ?? null, scope === 'workspace' ? WORKSPACE_ID : null);
      assert.doesNotMatch(JSON.stringify(result.body), /ten_foreign|wrk_foreign/);
    });
  }
});

// bbx-c10-006 | fn-observability-audit-export | OpenSpec #### Scenario: Fallback parity
test('bbx-c10-006 | fn-observability-audit-export | Scenario: Fallback preserves normalized request and masks conservatively', async () => {
  const scopedRow = auditRow(1, { workspaceId: WORKSPACE_ID });
  const primaryPool = fakePool({ rows: [scopedRow] });
  const fallbackPool = fakePool({ rows: [scopedRow] });
  const primary = await invokeExport({
    scope: 'workspace',
    body: { format: 'csv', pageSize: 201 },
    pool: primaryPool,
    includeBuilder: false
  });
  const fallback = await invokeExport({
    scope: 'workspace',
    body: { format: 'csv', pageSize: 201 },
    pool: fallbackPool,
    builder: null
  });

  assert.equal(primary.statusCode, 200);
  assert.equal(fallback.statusCode, 200);
  assert.deepEqual(
    {
      primary: {
        queryScope: primary.body.queryScope,
        format: primary.body.format,
        maskingProfileId: primary.body.maskingProfileId,
        itemCount: primary.body.itemCount,
        sqlScope: auditSqlCalls(primaryPool)[0].params.slice(0, 2),
        sqlLimit: auditSqlCalls(primaryPool)[0].params.at(-1)
      },
      fallback: {
        queryScope: fallback.body.queryScope,
        format: fallback.body.format,
        maskingProfileId: fallback.body.maskingProfileId,
        itemCount: fallback.body.itemCount,
        sqlScope: auditSqlCalls(fallbackPool)[0].params.slice(0, 2),
        sqlLimit: auditSqlCalls(fallbackPool)[0].params.at(-1)
      }
    },
    {
      primary: { queryScope: 'workspace', format: 'csv', maskingProfileId: 'default_masked', itemCount: 1, sqlScope: [TENANT_ID, WORKSPACE_ID], sqlLimit: 201 },
      fallback: { queryScope: 'workspace', format: 'csv', maskingProfileId: 'default_masked', itemCount: 1, sqlScope: [TENANT_ID, WORKSPACE_ID], sqlLimit: 201 }
    }
  );
  assert.equal(fallback.body.items[0].maskingApplied, true);
  assert.deepEqual(fallback.body.items[0].detail, {});
  assert.doesNotMatch(JSON.stringify(fallback.body), /never-export-this-(?:password|secret|token)/);
});

// bbx-c10-007 | fn-observability-audit-export | OpenSpec #### Scenario: Cross-tenant denial ordering
test('bbx-c10-007 | fn-observability-audit-export | Scenario: Cross-tenant denial precedes audit SQL', async (t) => {
  for (const scope of ['tenant', 'workspace']) {
    await t.test(`bbx-c10-007.${scope} denies before querying audit records`, async () => {
      const pool = fakePool();
      const result = await invokeExport({
        scope,
        body: { format: 'jsonl', pageSize: 500 },
        pool,
        identityTenantId: 'ten_attacker'
      });
      assert.equal(result.statusCode, 403);
      assert.equal(result.body.code, 'FORBIDDEN');
      assert.equal(auditSqlCalls(pool).length, 0);
    });
  }
});

// bbx-c10-008 | fn-observability-audit-export | OpenSpec #### Scenario: Contract compatibility
test('bbx-c10-008 | fn-observability-audit-export | Scenario: C-01 manifest projection and masking remain compatible', async () => {
  const pool = fakePool({ rows: [auditRow()] });
  const result = await invokeExport({
    body: { format: 'jsonl', pageSize: 1 },
    pool,
    includeBuilder: false
  });

  assert.equal(result.statusCode, 200);
  for (const field of ['exportId', 'queryScope', 'format', 'maskingProfileId', 'correlationId', 'generatedAt', 'appliedFilters', 'itemCount', 'maskedItemCount', 'items']) {
    assert.ok(Object.hasOwn(result.body, field), `manifest field ${field} must remain present`);
  }
  assert.equal(result.body.itemCount, 1);
  const item = result.body.items[0];
  for (const field of ['eventId', 'eventTimestamp', 'actor', 'scope', 'resource', 'action', 'result', 'correlationId', 'origin', 'detail', 'maskingApplied', 'maskedFieldRefs', 'sensitivityCategories']) {
    assert.ok(Object.hasOwn(item, field), `export projection field ${field} must remain present`);
  }
  assert.equal(item.detail.password, '[MASKED]');
  assert.equal(item.detail.secret, '[MASKED]');
  assert.equal(item.detail.token, '[MASKED]');
  assert.equal(item.maskingApplied, true);
  assert.doesNotMatch(JSON.stringify(result.body), /never-export-this-(?:password|secret|token)/);
});

// bbx-c10-009 | fn-observability-audit-list | OpenSpec #### Scenario: List cap is preserved
test('bbx-c10-009 | fn-observability-audit-list | Scenario: Audit-record list remains capped at 200', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => auditRow(index + 1));
  const pool = fakePool({ rows });
  const result = await METRICS_HANDLERS.metricsTenantAudit({
    params: { tenantId: TENANT_ID },
    searchParams: new URLSearchParams('page%5Bsize%5D=200'),
    body: { pageSize: 10000 },
    identity: { sub: 'user-c10-owner', actorType: 'tenant_owner', tenantId: TENANT_ID },
    pool
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.items.length, 200);
  assert.equal(result.body.page.size, 200);
  assert.equal(result.body.page.hasMore, true);
  assert.equal(auditSqlCalls(pool).length, 1);
  assert.equal(auditSqlCalls(pool)[0].params.at(-1), 201, 'list uses one look-ahead row but never exposes more than 200');
});

// bbx-c10-010 | fn-observability-audit-export | OpenSpec #### Scenario: Fallback parity
test('bbx-c10-010 | fn-observability-audit-export | Scenario: Primary and forced fallback preserve filters and normalized controls', async () => {
  const captures = [];
  const scopedRow = auditRow(1, { workspaceId: WORKSPACE_ID });
  const primaryPool = fakePool({ rows: [scopedRow] });
  const fallbackPool = fakePool({ rows: [scopedRow] });
  const body = {
    format: 'csv',
    pageSize: 201,
    sort: 'eventTimestamp',
    maskingProfileId: 'default_masked',
    tenantId: 'ten_foreign',
    workspaceId: 'wrk_foreign',
    filters: {
      actorId: 'user-c10-filtered',
      tenantId: 'ten_foreign',
      workspaceId: 'wrk_foreign'
    }
  };

  const primary = await invokeExport({
    scope: 'workspace',
    body,
    pool: primaryPool,
    builder: normalizingPrimaryBuilder(captures)
  });
  const fallback = await invokeExport({
    scope: 'workspace',
    body,
    pool: fallbackPool,
    builder: null
  });
  const primarySql = auditSqlCalls(primaryPool)[0];
  const fallbackSql = auditSqlCalls(fallbackPool)[0];

  assert.equal(primary.statusCode, 200);
  assert.equal(fallback.statusCode, 200);
  assert.equal(captures.length, 1);
  assert.deepEqual(
    {
      format: captures[0].input.format,
      pageSize: captures[0].input.pageSize,
      sort: captures[0].input.sort,
      maskingProfileId: captures[0].input.maskingProfileId,
      filters: captures[0].input.filters
    },
    {
      format: 'csv',
      pageSize: 201,
      sort: 'eventTimestamp',
      maskingProfileId: 'default_masked',
      filters: { actor_id: 'user-c10-filtered' }
    }
  );
  for (const sqlCall of [primarySql, fallbackSql]) {
    assert.deepEqual(sqlCall.params.slice(0, 2), [TENANT_ID, WORKSPACE_ID]);
    assert.equal(sqlCall.params.at(-1), 201);
    assert.ok(sqlCall.params.includes('user-c10-filtered'), 'actorId must be bound as an audit SQL parameter');
    assert.match(sqlCall.sql, /actor_id\s*=\s*\$\d+/i);
    assert.match(sqlCall.sql, /ORDER BY\s+created_at\s+ASC,\s*id\s+ASC/i);
    assert.ok(!sqlCall.params.includes('ten_foreign'));
    assert.ok(!sqlCall.params.includes('wrk_foreign'));
  }
  for (const manifest of [primary.body, fallback.body]) {
    assert.equal(manifest.format, 'csv');
    assert.equal(manifest.maskingProfileId, 'default_masked');
    assert.deepEqual(manifest.appliedFilters, { actor_id: 'user-c10-filtered' });
    assert.notDeepEqual(manifest.appliedFilters, {});
    assert.doesNotMatch(JSON.stringify(manifest), /ten_foreign|wrk_foreign/);
  }
});

// bbx-c10-011 | fn-observability-audit-export | OpenSpec #### Scenario: Invalid pageSize
test('bbx-c10-011 | fn-observability-audit-export | Scenario: Invalid sort and standalone timestamps are rejected before SQL', async (t) => {
  const invalidRequests = [
    ['sort', { sort: 'createdAt' }, 'AUDIT_EXPORT_INVALID_SORT', false],
    ['occurred-after', { filters: { occurredAfter: 'definitely-not-rfc3339' } }, 'AUDIT_EXPORT_INVALID_TIME_WINDOW', false],
    ['occurred-before', { filters: { occurredBefore: '2026-99-99T25:61:61Z' } }, 'AUDIT_EXPORT_INVALID_TIME_WINDOW', false],
    ['over-31-day-window', {
      filters: {
        occurredAfter: '2026-01-01T00:00:00Z',
        occurredBefore: '2026-02-02T00:00:00Z'
      }
    }, 'AUDIT_EXPORT_INVALID_TIME_WINDOW', true]
  ];
  for (const [label, request, expectedCode, forceFallback] of invalidRequests) {
    await t.test(`bbx-c10-011.${label} returns contractual 4xx without audit SQL`, async () => {
      const pool = fakePool();
      const result = await invokeExport({
        body: { format: 'csv', pageSize: 201, ...request },
        pool,
        builder: forceFallback ? null : normalizingPrimaryBuilder()
      });
      assert.deepEqual(
        { clientError: result.statusCode >= 400 && result.statusCode < 500, auditSqlCalls: auditSqlCalls(pool).length },
        { clientError: true, auditSqlCalls: 0 }
      );
      assert.equal(result.body?.code, expectedCode);
    });
  }
});

// bbx-c10-012 | fn-observability-audit-export | OpenSpec #### Scenario: Invalid pageSize
test('bbx-c10-012 | fn-observability-audit-export | Scenario: Shared enum and non-empty filters are rejected before SQL', async (t) => {
  const invalidFilters = [
    ['subsystem-enum', { subsystem: 'billing' }],
    ['action-category-enum', { actionCategory: 'credential_dump' }],
    ['outcome-enum', { outcome: 'successful' }],
    ['actor-type-enum', { actorType: 'root' }],
    ['origin-surface-enum', { originSurface: 'browser' }],
    ['action-id-empty', { actionId: '' }],
    ['actor-id-empty', { actorId: '' }],
    ['resource-type-empty', { resourceType: '' }],
    ['resource-id-empty', { resourceId: '' }],
    ['correlation-id-empty', { correlationId: '' }]
  ];
  for (const [label, filters] of invalidFilters) {
    await t.test(`bbx-c10-012.${label} returns contractual 4xx without audit SQL`, async () => {
      const pool = fakePool();
      const result = await invokeExport({
        body: { format: 'jsonl', pageSize: 201, filters },
        pool,
        builder: normalizingPrimaryBuilder()
      });
      assert.deepEqual(
        { clientError: result.statusCode >= 400 && result.statusCode < 500, auditSqlCalls: auditSqlCalls(pool).length },
        { clientError: true, auditSqlCalls: 0 }
      );
      assert.equal(typeof result.body?.code, 'string');
    });
  }
});

// bbx-c10-013 | fn-observability-audit-export | OpenSpec #### Scenario: Fallback parity
test('bbx-c10-013 | fn-observability-audit-export | Scenario: Forced fallback propagates the complete canonical filter vocabulary', async () => {
  const pool = fakePool({ rows: [auditRow(1, { workspaceId: WORKSPACE_ID })] });
  const filters = {
    occurredAfter: '2026-08-01T00:00:00Z',
    occurredBefore: '2026-08-04T12:00:00Z',
    subsystem: 'iam',
    actionCategory: 'access_control_modification',
    actionId: 'iam.user.create',
    outcome: 'succeeded',
    actorType: 'tenant_user',
    actorId: 'user-c10-filtered',
    resourceType: 'user',
    resourceId: 'usr-c10-filtered',
    originSurface: 'control_api',
    correlationId: 'corr-c10-filtered'
  };
  const expectedCanonicalFilters = {
    occurred_after: filters.occurredAfter,
    occurred_before: filters.occurredBefore,
    subsystem: filters.subsystem,
    action_category: filters.actionCategory,
    action_id: filters.actionId,
    outcome: filters.outcome,
    actor_type: filters.actorType,
    actor_id: filters.actorId,
    resource_type: filters.resourceType,
    resource_id: filters.resourceId,
    origin_surface: filters.originSurface,
    correlation_id: filters.correlationId
  };

  const result = await invokeExport({
    scope: 'workspace',
    body: {
      format: 'csv',
      pageSize: 201,
      sort: 'eventTimestamp',
      maskingProfileId: 'default_masked',
      tenantId: 'ten_foreign',
      workspaceId: 'wrk_foreign',
      filters: { ...filters, tenantId: 'ten_foreign', workspaceId: 'wrk_foreign' }
    },
    pool,
    builder: null
  });
  const sqlCall = auditSqlCalls(pool)[0];
  const expectedParams = [
    TENANT_ID,
    WORKSPACE_ID,
    ...Object.values(expectedCanonicalFilters),
    201
  ];
  const whereSql = sqlCall.sql.slice(sqlCall.sql.indexOf(' WHERE '), sqlCall.sql.indexOf(' ORDER BY '));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(sqlCall.params, expectedParams);
  for (let parameter = 3; parameter <= 14; parameter += 1) {
    assert.match(whereSql, new RegExp(`\\$${parameter}(?!\\d)`), `filter parameter $${parameter} must be used by a WHERE predicate`);
  }
  assert.match(whereSql, /created_at\s*>=\s*\$3::timestamptz/i);
  assert.match(whereSql, /created_at\s*<=\s*\$4::timestamptz/i);
  assert.match(whereSql, /action_type\s*=\s*\$7/i);
  assert.match(whereSql, /actor_id\s*=\s*\$10/i);
  assert.match(sqlCall.sql, /ORDER BY\s+created_at\s+ASC,\s*id\s+ASC/i);
  assert.ok(!sqlCall.params.includes('ten_foreign'));
  assert.ok(!sqlCall.params.includes('wrk_foreign'));

  assert.equal(result.body.queryScope, 'workspace');
  assert.equal(result.body.format, 'csv');
  assert.equal(result.body.maskingProfileId, 'default_masked');
  assert.deepEqual(result.body.appliedFilters, expectedCanonicalFilters);
  assert.equal(result.body.items[0].maskingApplied, true);
  assert.deepEqual(result.body.items[0].detail, {});
  assert.doesNotMatch(JSON.stringify(result.body), /never-export-this-(?:password|secret|token)|ten_foreign|wrk_foreign/);
});

// bbx-c10-014 | fn-observability-audit-export | OpenSpec #### Scenario: Fallback parity
test('bbx-c10-014 | fn-observability-audit-export | Scenario: Builder failures never become successful fallback manifests', async (t) => {
  const cases = [
    {
      label: 'tenant-operational-without-normalizer',
      scope: 'tenant',
      normalize: false,
      thrownCode: 'MASKING_RUNTIME_FAILED',
      thrownMessage: 'internal masking runtime detail 17',
      expectedStatus: 500,
      expectedCode: 'AUDIT_EXPORT_BUILD_FAILED'
    },
    {
      label: 'workspace-operational-with-normalizer',
      scope: 'workspace',
      normalize: true,
      thrownCode: 'MASKING_RUNTIME_FAILED',
      thrownMessage: 'internal masking runtime detail 23',
      expectedStatus: 500,
      expectedCode: 'AUDIT_EXPORT_BUILD_FAILED'
    },
    {
      label: 'tenant-contractual-with-normalizer',
      scope: 'tenant',
      normalize: true,
      thrownCode: 'AUDIT_EXPORT_INVALID_TIME_WINDOW',
      thrownMessage: 'audit export time window exceeds the configured maximum.',
      expectedStatus: 400,
      expectedCode: 'AUDIT_EXPORT_INVALID_TIME_WINDOW'
    }
  ];

  for (const scenario of cases) {
    await t.test(`bbx-c10-014.${scenario.label} returns a coded error without fallback`, async () => {
      const pool = fakePool({
        rows: [auditRow(1, { workspaceId: scenario.scope === 'workspace' ? WORKSPACE_ID : null })]
      });
      const thrown = Object.assign(new Error(scenario.thrownMessage), { code: scenario.thrownCode });
      const builder = {
        ...(scenario.normalize ? { normalizeAuditExportRequest } : {}),
        exportTenantAuditRecordsPreview() { throw thrown; },
        exportWorkspaceAuditRecordsPreview() { throw thrown; }
      };
      const result = await invokeExport({
        scope: scenario.scope,
        body: { format: 'jsonl', pageSize: 1, maskingProfileId: 'default_masked' },
        pool,
        builder
      });

      assert.deepEqual(
        {
          statusCode: result.statusCode,
          code: result.body?.code,
          auditSqlCalls: auditSqlCalls(pool).length
        },
        {
          statusCode: scenario.expectedStatus,
          code: scenario.expectedCode,
          auditSqlCalls: 1
        }
      );
      assert.equal(Object.hasOwn(result.body, 'exportId'), false);
      assert.equal(Object.hasOwn(result.body, 'items'), false);
      if (scenario.expectedStatus >= 500) {
        assert.doesNotMatch(JSON.stringify(result.body), /MASKING_RUNTIME_FAILED|internal masking runtime detail/i);
      }
    });
  }
});
