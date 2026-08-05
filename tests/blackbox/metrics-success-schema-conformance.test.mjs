import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Ajv from 'ajv';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';

const OPENAPI_PATH = 'apps/control-plane-executor/openapi/control-plane.openapi.json';
const document = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
});

function compileComponent(name) {
  const schema = {
    ...structuredClone(document.components.schemas[name]),
    $defs: structuredClone(document.components.schemas)
  };
  const withLocalRefs = JSON.parse(
    JSON.stringify(schema).replaceAll('#/components/schemas/', '#/$defs/')
  );
  return ajv.compile(withLocalRefs);
}

const validate = Object.fromEntries(
  [
    'QuotaPosture',
    'TenantQuotaUsageOverview',
    'WorkspaceQuotaUsageOverview',
    'UsageSnapshot',
    'AuditRecordCollectionResponse',
    'AuditExportManifest',
    'AuditExportedRecord',
    'MetricSeriesResponse'
  ].map((name) => [name, compileComponent(name)])
);

const TENANT = 'ten_a';
const OTHER_TENANT = 'ten_b';
const WORKSPACE = 'wrk_a';
const NOW = '2026-08-04T08:00:00.000Z';

const OWNER = {
  sub: 'usr_owner_a',
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: []
};

const FOREIGN_OWNER = {
  sub: 'usr_owner_b',
  tenantId: OTHER_TENANT,
  workspaceId: 'wrk_b',
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: []
};

const WORKSPACE_ROW = {
  id: WORKSPACE,
  tenant_id: TENANT,
  slug: 'app-a',
  display_name: 'App A',
  status: 'active',
  environment: 'staging'
};

const TENANT_ROW = {
  id: TENANT,
  slug: 'tenant-a',
  display_name: 'Tenant A',
  status: 'active',
  iam_realm: 'tenant-a',
  created_at: '2026-08-04T00:00:00.000Z',
  created_by: 'blackbox'
};

const AUDIT_ROW = {
  id: 'evt_audit_1',
  action_type: 'workspace.create',
  action_category: 'resource_creation',
  actor_id: OWNER.sub,
  tenant_id: TENANT,
  workspace_id: WORKSPACE,
  previous_state: null,
  new_state: {
    workspaceId: WORKSPACE,
    path: '/v1/tenants/{tenantId}/workspaces',
    method: 'POST',
    status: 201,
    password: 'c01-password-must-not-leak',
    token: 'c01-token-must-not-leak'
  },
  outcome: 'succeeded',
  correlation_id: 'corr_c01_audit_1',
  created_at: NOW,
  prev_hash: 'prev-hash',
  row_hash: 'row-hash'
};

const AUDIT_ERROR_ROW = {
  id: 'evt_audit_error',
  action_type: 'workspace.delete',
  action_category: 'bogus_legacy_category',
  actor_id: null,
  tenant_id: TENANT,
  workspace_id: WORKSPACE,
  previous_state: null,
  new_state: {},
  outcome: 'error',
  correlation_id: null,
  created_at: NOW,
  prev_hash: null,
  row_hash: null
};

const AUDIT_NULL_ROW = {
  id: 'evt_audit_null',
  action_type: null,
  action_category: null,
  actor_id: null,
  tenant_id: TENANT,
  workspace_id: null,
  previous_state: null,
  new_state: null,
  outcome: null,
  correlation_id: null,
  created_at: null,
  prev_hash: null,
  row_hash: null
};

const AUDIT_ROWS = [AUDIT_ROW, AUDIT_ERROR_ROW, AUDIT_NULL_ROW];

const LIMITS = [
  {
    dimensionKey: 'api_requests',
    displayLabel: 'API requests',
    unit: 'request',
    effectiveValue: 10,
    quotaType: 'hard',
    currentUsage: 8,
    usageStatus: 'fresh'
  },
  {
    dimensionKey: 'storage_volume_bytes',
    displayLabel: 'Storage logical volume',
    unit: 'byte',
    effectiveValue: 1000,
    quotaType: 'hard',
    currentUsage: 1000,
    usageStatus: 'degraded'
  },
  {
    dimensionKey: 'function_invocations',
    displayLabel: 'Function invocations',
    unit: 'invocation',
    effectiveValue: 100,
    quotaType: 'hard',
    currentUsage: 40,
    usageStatus: 'degraded'
  }
];

function fakePool() {
  const query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM tenants')) {
      return { rows: params[0] === TENANT ? [TENANT_ROW] : [] };
    }
    if (text.includes('FROM workspaces')) {
      return { rows: params[0] === WORKSPACE ? [WORKSPACE_ROW] : [] };
    }
    if (text.includes('FROM plan_audit_events')) {
      return { rows: AUDIT_ROWS };
    }
    return { rows: [] };
  };
  return {
    query,
    async connect() {
      return { query, release() {} };
    }
  };
}

function context(options = {}) {
  const {
  identity = OWNER,
  params,
  query = {},
  body = {},
  loadLimits,
  fetchImpl,
  auditExportBuilder
  } = options;
  const ctx = {
    pool: fakePool(),
    identity,
    params,
    query,
    body,
    loadLimits,
    fetchImpl,
    nowMs: () => Date.parse(NOW),
    callerContext: {
      actor: { id: identity.sub, type: identity.actorType, tenantId: identity.tenantId },
      correlationId: 'corr_c01_request_1',
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId
    }
  };
  if (Object.hasOwn(options, 'auditExportBuilder')) ctx.auditExportBuilder = auditExportBuilder;
  return ctx;
}

function dimension(body, dimensionId) {
  const value = body.dimensions.find((candidate) => candidate.dimensionId === dimensionId);
  assert.ok(value, `missing ${dimensionId} in ${body.queryScope} response`);
  return value;
}

function assertSchema(schemaName, body, label) {
  assert.equal(validate[schemaName](body), true, `${label}: ${JSON.stringify(validate[schemaName].errors)}`);
}

// bbx-c01-control | fn-observability-metric-series | OpenSpec #### Scenario: Contract surface is unchanged
test('bbx-c01-control: canonical workspace series validates and the closed schema rejects drift', async () => {
  const response = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    params: { workspaceId: WORKSPACE },
    query: { metricKey: 'api_requests', window: '24h' },
    body: {},
    loadLimits: undefined,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { status: 'success', data: { result: [] } };
      }
    })
  }));
  response.body.points = [];

  assert.equal(response.statusCode, 200);
  assert.equal(validate.MetricSeriesResponse(response.body), true, JSON.stringify(validate.MetricSeriesResponse.errors));
  assert.equal(validate.MetricSeriesResponse({ ...response.body, source: 'legacy' }), false);
});

// bbx-c01-success | fn-observability-quota-usage | OpenSpec #### Scenario: Populated tenant and workspace reads validate
// bbx-c01-degraded-dimension | fn-observability-quota-usage | OpenSpec #### Scenario: Degraded usage dimensions are marked, not zeroed
test('bbx-c01-success: real quota, overview and usage handlers conform for tenant and workspace', async () => {
  const loadLimits = async ({ tenantId, workspaceId }) => {
    assert.equal(tenantId, TENANT);
    assert.equal(workspaceId === undefined || workspaceId === WORKSPACE, true);
    return LIMITS;
  };
  const scopes = [
    {
      label: 'tenant',
      params: { tenantId: TENANT },
      quotaHandler: 'metricsTenantQuotas',
      overviewHandler: 'metricsTenantOverview',
      overviewSchema: 'TenantQuotaUsageOverview',
      usageHandler: 'metricsTenantUsage',
      workspaceId: null
    },
    {
      label: 'workspace',
      params: { workspaceId: WORKSPACE },
      quotaHandler: 'metricsWorkspaceQuotas',
      overviewHandler: 'metricsWorkspaceOverview',
      overviewSchema: 'WorkspaceQuotaUsageOverview',
      usageHandler: 'metricsWorkspaceUsage',
      workspaceId: WORKSPACE
    }
  ];

  for (const scope of scopes) {
    const quotaResponse = await METRICS_HANDLERS[scope.quotaHandler](context({ params: scope.params, loadLimits }));
    assert.equal(quotaResponse.statusCode, 200, `${scope.label} quota status`);
    assertSchema('QuotaPosture', quotaResponse.body, `${scope.label} quota`);
    assert.equal(quotaResponse.body.tenantId, TENANT);
    assert.equal(quotaResponse.body.workspaceId, scope.workspaceId);
    // The published quota policy orders hard breaches ahead of degraded evidence.
    assert.equal(quotaResponse.body.overallStatus, 'hard_limit_reached');
    assert.deepEqual(quotaResponse.body.degradedDimensions, [
      'storage_volume_bytes',
      'function_invocations'
    ]);
    assert.deepEqual(quotaResponse.body.hardLimitBreaches, ['storage_volume_bytes']);
    assert.equal(dimension(quotaResponse.body, 'api_requests').freshnessStatus, 'fresh');
    const degradedQuota = dimension(quotaResponse.body, 'storage_volume_bytes');
    assert.equal(degradedQuota.freshnessStatus, 'degraded');
    assert.equal(degradedQuota.status, 'hard_limit_reached');
    const evidenceDegradedQuota = dimension(quotaResponse.body, 'function_invocations');
    assert.equal(evidenceDegradedQuota.freshnessStatus, 'degraded');
    assert.equal(evidenceDegradedQuota.status, 'evidence_degraded');

    const overviewResponse = await METRICS_HANDLERS[scope.overviewHandler](context({ params: scope.params, loadLimits }));
    assert.equal(overviewResponse.statusCode, 200, `${scope.label} overview status`);
    assertSchema(scope.overviewSchema, overviewResponse.body, `${scope.label} overview`);
    assert.equal(overviewResponse.body.tenantId, TENANT);
    assert.equal(overviewResponse.body.workspaceId, scope.workspaceId);
    assert.equal(overviewResponse.body.overallPosture, 'hard_limit_reached');
    assert.deepEqual(overviewResponse.body.hardLimitDimensions, ['storage_volume_bytes']);
    const degradedOverview = dimension(overviewResponse.body, 'storage_volume_bytes');
    assert.equal(degradedOverview.freshnessStatus, 'degraded');
    assert.equal(degradedOverview.posture, 'hard_limit_reached');
    assert.equal(degradedOverview.visualState, 'critical');
    const evidenceDegradedOverview = dimension(overviewResponse.body, 'function_invocations');
    assert.equal(evidenceDegradedOverview.freshnessStatus, 'degraded');
    assert.equal(evidenceDegradedOverview.posture, 'evidence_degraded');
    assert.equal(evidenceDegradedOverview.visualState, 'degraded');

    const usageResponse = await METRICS_HANDLERS[scope.usageHandler](context({ params: scope.params, loadLimits }));
    assert.equal(usageResponse.statusCode, 200, `${scope.label} usage status`);
    assertSchema('UsageSnapshot', usageResponse.body, `${scope.label} usage`);
    assert.equal(usageResponse.body.tenantId, TENANT);
    assert.equal(usageResponse.body.workspaceId, scope.workspaceId);
    assert.equal(dimension(usageResponse.body, 'storage_volume_bytes').freshnessStatus, 'degraded');
    assert.equal(dimension(usageResponse.body, 'function_invocations').freshnessStatus, 'degraded');
    assert.deepEqual(usageResponse.body.degradedDimensions, [
      'storage_volume_bytes',
      'function_invocations'
    ]);
    assert.deepEqual(usageResponse.body.calculationCycle.degradedDimensions, [
      'storage_volume_bytes',
      'function_invocations'
    ]);
  }

});

// bbx-c01-unavailable | fn-observability-quota-usage | OpenSpec #### Scenario: Unresolved evidence is reported honestly
test('bbx-c01-degraded: unavailable limit sources still return honest schema-valid successes', async () => {
  const unavailable = async () => [];

  const quotas = await METRICS_HANDLERS.metricsTenantQuotas(context({
    params: { tenantId: TENANT },
    loadLimits: unavailable
  }));
  assert.equal(quotas.statusCode, 200);
  assertSchema('QuotaPosture', quotas.body, 'tenant unavailable quota');
  assert.equal(quotas.body.overallStatus, 'evidence_unavailable');
  assert.notEqual(quotas.body.overallStatus, 'within_limit');

  const overview = await METRICS_HANDLERS.metricsTenantOverview(context({
    params: { tenantId: TENANT },
    loadLimits: unavailable
  }));
  assert.equal(overview.statusCode, 200);
  assertSchema('TenantQuotaUsageOverview', overview.body, 'tenant unavailable overview');
  assert.equal(overview.body.overallPosture, 'evidence_unavailable');
  assert.equal(JSON.stringify(overview.body).includes('"healthy"'), false);

  const usage = await METRICS_HANDLERS.metricsTenantUsage(context({
    params: { tenantId: TENANT },
    loadLimits: unavailable
  }));
  assert.equal(usage.statusCode, 200);
  assertSchema('UsageSnapshot', usage.body, 'tenant unavailable usage');
  assert.deepEqual(usage.body.dimensions, []);
  assert.deepEqual(usage.body.degradedDimensions, []);
  assert.deepEqual(usage.body.calculationCycle.degradedDimensions, []);
});

// bbx-c01-audit | fn-observability-audit-projection | OpenSpec #### Scenario: Stored error and unknown outcomes map into the enum
test('bbx-c01-audit: real list and export handlers share schema-valid legacy-row projection', async () => {
  const listCases = [
    ['tenant audit', 'metricsTenantAudit', { tenantId: TENANT }],
    ['workspace audit', 'metricsWorkspaceAudit', { workspaceId: WORKSPACE }]
  ];

  for (const [label, handlerName, params] of listCases) {
    const response = await METRICS_HANDLERS[handlerName](context({ params }));
    assert.equal(response.statusCode, 200, `${label} status`);
    assertSchema('AuditRecordCollectionResponse', response.body, label);
    assert.equal(response.body.page.hasMore, false);
    assert.equal(Object.hasOwn(response.body.page, 'nextCursor'), false);
    const errorRecord = response.body.items.find((item) => item.eventId === AUDIT_ERROR_ROW.id);
    const nullRecord = response.body.items.find((item) => item.eventId === AUDIT_NULL_ROW.id);
    assert.equal(errorRecord.result.outcome, 'failed');
    assert.equal(errorRecord.action.category, 'configuration_change');
    assert.equal(nullRecord.result.outcome, 'partial');
    for (const record of [errorRecord, nullRecord]) {
      assert.ok(record.correlationId);
      assert.ok(record.origin.emittingService);
      assert.notEqual(record.actor.actorType, 'platform_user');
    }
  }

  const exportCases = [
    ['tenant export', 'metricsTenantAuditExport', { tenantId: TENANT }],
    ['workspace export', 'metricsWorkspaceAuditExport', { workspaceId: WORKSPACE }]
  ];
  const builderModes = [
    ['primary', undefined],
    ['fallback', null]
  ];
  for (const [builderLabel, auditExportBuilder] of builderModes) {
    for (const format of ['jsonl', 'csv']) {
      for (const [label, handlerName, params] of exportCases) {
        const requestContext = {
          params,
          body: { format, filters: {} }
        };
        if (builderLabel === 'fallback') requestContext.auditExportBuilder = auditExportBuilder;
        const response = await METRICS_HANDLERS[handlerName](context(requestContext));
        const caseLabel = `${label} ${format} ${builderLabel}`;
        assert.equal(response.statusCode, 200, `${caseLabel} status`);
        assertSchema('AuditExportManifest', response.body, caseLabel);
        assert.equal(response.body.format, format);
        assert.ok(response.body.maskingProfileId);
        assert.equal(response.body.itemCount, response.body.items.length);
        for (const item of response.body.items) {
          assertSchema('AuditExportedRecord', item, `${caseLabel} item ${item.eventId}`);
          assert.equal(typeof item.maskingApplied, 'boolean');
          assert.ok(Array.isArray(item.maskedFieldRefs));
          assert.ok(Array.isArray(item.sensitivityCategories));
        }
        const sensitiveItem = response.body.items.find((item) => item.eventId === AUDIT_ROW.id);
        assert.equal(sensitiveItem.maskingApplied, true);
        assert.ok(sensitiveItem.maskedFieldRefs.length > 0);
        assert.ok(sensitiveItem.sensitivityCategories.length > 0);
        if (builderLabel === 'primary') {
          assert.equal(sensitiveItem.detail.password, '[MASKED]');
          assert.ok(sensitiveItem.maskedFieldRefs.includes('detail.password'));
        } else {
          assert.deepEqual(sensitiveItem.detail, {});
          assert.deepEqual(sensitiveItem.maskedFieldRefs, ['detail']);
        }
        assert.equal(JSON.stringify(response.body).includes('c01-password-must-not-leak'), false);
        assert.equal(JSON.stringify(response.body).includes('c01-token-must-not-leak'), false);
      }
    }
  }
});

// bbx-c01-isolation | fn-observability-scope-guard | OpenSpec #### Scenario: Cross-tenant or unknown-workspace read fails closed
test('bbx-c01-isolation: rejected scopes do not invoke the injected limit reader', async () => {
  let calls = 0;
  const loadLimits = async () => {
    calls += 1;
    return LIMITS;
  };

  const foreign = await METRICS_HANDLERS.metricsTenantQuotas(context({
    identity: FOREIGN_OWNER,
    params: { tenantId: TENANT },
    loadLimits
  }));
  assert.equal(foreign.statusCode, 403);

  const unknown = await METRICS_HANDLERS.metricsWorkspaceQuotas(context({
    params: { workspaceId: 'wrk_unknown' },
    loadLimits
  }));
  assert.equal(unknown.statusCode, 404);
  assert.equal(calls, 0);
});
