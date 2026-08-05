// Console metrics handlers (domain B glue, kind deploy).
//
// The web-console Quotas + Observability pages call /v1/metrics/{tenants|
// workspaces}/{id}/{overview,quotas,usage,series,audit-records,audit-exports},
// but the repo ships NO action for them (discovery: module=NONE; the audit query
// action exists but its defaultLoader returns empty without an injected reader).
// We synthesize the shapes those pages expect from REAL data where it exists:
//   - limits  -> tenant-effective-entitlements / workspace-consumption (real)
//   - usage   -> the currentUsage carried by those same actions
//   - series  -> real workspace request/error rates; legacy tenant series remains tenant-scoped
//   - audit   -> empty (no audit-record store/reader in this deploy)
// Honest: limits are real; usage/series/audit reflect what's actually available.
import { randomUUID } from 'node:crypto';
import * as store from './tenant-store.mjs';
import { canManageTenant } from './tenant-scope.mjs';
import { applyCanonicalWorkspaceMetric } from './request-metric-scope.mjs';
import {
  AUDIT_FILTER_DESCRIPTORS,
  auditRowToRecord,
  encodeAuditCursor,
  normalizeAuditEventQuery,
  queryAuditEvents
} from './audit-store.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const nowIso = (ctx) => new Date(typeof ctx?.nowMs === 'function' ? ctx.nowMs() : Date.now()).toISOString();
const ENTITLEMENTS = '/repo/packages/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs';
const WS_CONSUMPTION = '/repo/packages/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs';
const QUOTA_POSTURE_PRECEDENCE = Object.freeze([
  'hard_limit_reached',
  'soft_limit_exceeded',
  'warning_threshold_reached',
  'evidence_unavailable',
  'evidence_degraded',
  'within_limit',
  'unbounded'
]);
const QUOTA_VISUAL_STATE = Object.freeze({
  hard_limit_reached: 'critical',
  soft_limit_exceeded: 'elevated',
  warning_threshold_reached: 'warning',
  evidence_unavailable: 'degraded',
  evidence_degraded: 'degraded',
  within_limit: 'healthy',
  unbounded: 'unknown'
});

function metricsScope(ctx) {
  return {
    queryScope: ctx.resolvedScope.workspaceId ? 'workspace' : 'tenant',
    tenantId: ctx.resolvedScope.tenantId,
    workspaceId: ctx.resolvedScope.workspaceId ?? null
  };
}

function freshnessFromLimit(limit = {}) {
  if (limit.usageStatus === 'fresh') return 'fresh';
  if (limit.usageStatus === 'degraded') return 'degraded';
  return 'unavailable';
}

function remainingTo(limit, measuredValue) {
  return limit == null ? null : Math.max(0, limit - measuredValue);
}

function quotaDimensionStatus(dimension) {
  if (dimension.policyMode === 'unbounded') return 'unbounded';
  if (dimension.freshnessStatus === 'unavailable') return 'evidence_unavailable';
  if (dimension.hardLimit != null && dimension.measuredValue >= dimension.hardLimit) return 'hard_limit_reached';
  if (dimension.softLimit != null && dimension.measuredValue >= dimension.softLimit) return 'soft_limit_exceeded';
  if (dimension.warningThreshold != null && dimension.measuredValue >= dimension.warningThreshold) return 'warning_threshold_reached';
  if (dimension.freshnessStatus === 'degraded') return 'evidence_degraded';
  return 'within_limit';
}

// Normalized limit row -> posture/overview dimension (shared by quotas + observability).
function dimensionsFromLimits(limits, scope, timestamp) {
  return limits.map((limit) => {
    const configuredLimit = typeof limit.effectiveValue === 'number' ? limit.effectiveValue : null;
    const softLimit = limit.quotaType === 'soft' ? configuredLimit : null;
    const hardLimit = limit.quotaType === 'soft' ? null : configuredLimit;
    const measuredValue = typeof limit.currentUsage === 'number' ? limit.currentUsage : 0;
    const dimension = {
      dimensionId: String(limit.dimensionKey ?? 'unknown_dimension'),
      displayName: String(limit.displayLabel ?? limit.dimensionKey ?? 'Unknown dimension'),
      scope: scope.queryScope,
      measuredValue,
      unit: String(limit.unit ?? 'count'),
      freshnessStatus: freshnessFromLimit(limit),
      policyMode: configuredLimit == null ? 'unbounded' : 'enforced',
      warningThreshold: null,
      softLimit,
      hardLimit,
      remainingToWarning: null,
      remainingToSoftLimit: remainingTo(softLimit, measuredValue),
      remainingToHardLimit: remainingTo(hardLimit, measuredValue),
      usageSnapshotTimestamp: timestamp
    };
    return { ...dimension, status: quotaDimensionStatus(dimension) };
  });
}

function overallPosture(dimensions) {
  if (dimensions.length === 0) return 'evidence_unavailable';
  return QUOTA_POSTURE_PRECEDENCE.find((status) => dimensions.some((dimension) => dimension.status === status))
    ?? 'evidence_unavailable';
}

function dimensionIdsWithStatus(dimensions, status) {
  return dimensions.filter((dimension) => dimension.status === status).map((dimension) => dimension.dimensionId);
}

async function tenantLimits(ctx, tenantId) {
  const client = await ctx.pool.connect();
  try {
    const mod = await import(ENTITLEMENTS);
    const res = await mod.main({ tenantId, include: 'consumption', callerContext: ctx.callerContext }, { db: client });
    return res?.body?.quantitativeLimits ?? [];
  } catch {
    // finding F4: the metrics route already authorizes the caller (auth + tenant-scoping; a
    // foreign tenant is denied 403 at the route layer). The inner entitlements action enforces a
    // STRICTER actor-type allow-list, so an authorized same-tenant non-owner (e.g. tenant_admin)
    // tripped FORBIDDEN, and a missing quota relation tripped 42P01 — either bubbled to a 500.
    // Degrade gracefully to an empty, evidence-unavailable posture, exactly like
    // workspaceLimits, so the page renders without claiming the tenant is healthy.
    return [];
  } finally {
    client.release();
  }
}

async function workspaceLimits(ctx, workspaceId) {
  const client = await ctx.pool.connect();
  try {
    const ws = await store.getWorkspace(client, workspaceId);
    if (!ws) return [];
    const mod = await import(WS_CONSUMPTION);
    const res = await mod.main({ tenantId: ws.tenant_id, workspaceId, callerContext: ctx.callerContext }, { db: client });
    return (res?.body?.dimensions ?? []).map((d) => ({
      dimensionKey: d.dimensionKey,
      displayLabel: d.displayLabel,
      unit: d.unit,
      effectiveValue: typeof d.workspaceLimit === 'number' ? d.workspaceLimit : d.tenantEffectiveValue,
      quotaType: 'hard',
      currentUsage: d.currentUsage,
      usageStatus: d.usageStatus
    }));
  } catch {
    return [];
  } finally {
    client.release();
  }
}

// Limits accessor by authorized scope. The injection seam is for public-interface
// black-box tests; guarded() always resolves and authorizes the scope before this runs.
async function limitsFor(ctx) {
  try {
    if (typeof ctx.loadLimits === 'function') {
      const scope = metricsScope(ctx);
      return await ctx.loadLimits(scope.workspaceId
        ? { tenantId: scope.tenantId, workspaceId: scope.workspaceId }
        : { tenantId: scope.tenantId });
    }
    return ctx.resolvedScope.workspaceId
      ? await workspaceLimits(ctx, ctx.resolvedScope.workspaceId)
      : await tenantLimits(ctx, ctx.resolvedScope.tenantId);
  } catch {
    return [];
  }
}

// ---- quotas posture (Quotas page) ------------------------------------------
async function quotas(ctx) {
  const scope = metricsScope(ctx);
  const evaluatedAt = nowIso(ctx);
  const dimensions = dimensionsFromLimits(await limitsFor(ctx), scope, evaluatedAt);
  const overallStatus = overallPosture(dimensions);
  const hardLimitBreaches = dimensionIdsWithStatus(dimensions, 'hard_limit_reached');
  const softLimitBreaches = dimensionIdsWithStatus(dimensions, 'soft_limit_exceeded');
  const warningDimensions = dimensionIdsWithStatus(dimensions, 'warning_threshold_reached');
  const degradedDimensions = dimensions
    .filter((dimension) => dimension.freshnessStatus !== 'fresh')
    .map((dimension) => dimension.dimensionId);
  const scopeId = scope.workspaceId ?? scope.tenantId;

  return ok(200, {
    postureId: `posture_${scope.queryScope}_${scopeId}_${Date.parse(evaluatedAt)}`,
    ...scope,
    evaluatedAt,
    usageSnapshotTimestamp: evaluatedAt,
    observationWindow: { startedAt: evaluatedAt, endedAt: evaluatedAt },
    dimensions,
    overallStatus,
    degradedDimensions,
    hardLimitBreaches,
    softLimitBreaches,
    warningDimensions,
    evaluationAudit: {
      evaluationId: `evaluation_${scope.queryScope}_${scopeId}_${Date.parse(evaluatedAt)}`,
      queryScope: scope.queryScope,
      overallStatus,
      hardLimitBreaches,
      softLimitBreaches,
      warningDimensions,
      evaluatedAt
    }
  });
}

function quotaUsageDimensionView(dimension) {
  const denominator = dimension.hardLimit ?? dimension.softLimit;
  return {
    dimensionId: dimension.dimensionId,
    displayName: dimension.displayName,
    scope: dimension.scope,
    currentUsage: dimension.measuredValue,
    unit: dimension.unit,
    warningThreshold: dimension.warningThreshold,
    softLimit: dimension.softLimit,
    hardLimit: dimension.hardLimit,
    usagePercentage: denominator != null && denominator > 0
      ? Number(((dimension.measuredValue / denominator) * 100).toFixed(1))
      : null,
    posture: dimension.status,
    visualState: QUOTA_VISUAL_STATE[dimension.status] ?? 'unknown',
    freshnessStatus: dimension.freshnessStatus,
    lastUpdatedAt: dimension.usageSnapshotTimestamp,
    blockingState: dimension.status === 'hard_limit_reached' ? 'breached' : 'advisory',
    blockingReasonCode: null
  };
}

function overviewAccessAudit(ctx, scope, generatedAt) {
  const workspace = scope.queryScope === 'workspace';
  return {
    eventType: 'quota.overview.read',
    queryScope: scope.queryScope,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    permissionId: workspace ? 'workspace.overview.read' : 'tenant.overview.read',
    routeOperationId: workspace ? 'getWorkspaceQuotaUsageOverview' : 'getTenantQuotaUsageOverview',
    requestedBy: String(ctx.identity?.sub ?? 'unknown'),
    generatedAt
  };
}

// ---- overview (Quotas + Observability) — carries posture AND dimensions ----
async function overview(ctx) {
  const scope = metricsScope(ctx);
  const generatedAt = nowIso(ctx);
  const quotaDimensions = dimensionsFromLimits(await limitsFor(ctx), scope, generatedAt);
  const dimensions = quotaDimensions.map(quotaUsageDimensionView);
  const scopeId = scope.workspaceId ?? scope.tenantId;
  const response = {
    overviewId: `overview_${scope.queryScope}_${scopeId}_${Date.parse(generatedAt)}`,
    ...scope,
    generatedAt,
    policiesConfigured: quotaDimensions.some((dimension) => dimension.policyMode === 'enforced'),
    dimensions,
    overallPosture: overallPosture(quotaDimensions),
    warningDimensions: dimensionIdsWithStatus(quotaDimensions, 'warning_threshold_reached'),
    softLimitDimensions: dimensionIdsWithStatus(quotaDimensions, 'soft_limit_exceeded'),
    hardLimitDimensions: dimensionIdsWithStatus(quotaDimensions, 'hard_limit_reached'),
    accessAudit: overviewAccessAudit(ctx, scope, generatedAt)
  };

  if (scope.queryScope === 'tenant') {
    const reasonSummary = 'Provisioning state is not available from the metrics limit source.';
    response.provisioningState = {
      state: 'degraded',
      visualState: 'degraded',
      components: [{
        componentName: 'tenant_provisioning',
        status: 'degraded',
        reason: reasonSummary,
        lastCheckedAt: generatedAt
      }],
      degradedComponents: ['tenant_provisioning'],
      lastCheckedAt: generatedAt,
      reasonSummary
    };
  }
  return ok(200, response);
}

// ---- usage snapshot (Observability) — currentUsage per dimension -----------
async function usage(ctx) {
  const limits = await limitsFor(ctx);
  const scope = metricsScope(ctx);
  const snapshotTimestamp = nowIso(ctx);
  const dimensions = limits.map((limit) => ({
    dimensionId: String(limit.dimensionKey ?? 'unknown_dimension'),
    displayName: String(limit.displayLabel ?? limit.dimensionKey ?? 'Unknown dimension'),
    value: typeof limit.currentUsage === 'number' ? limit.currentUsage : 0,
    unit: String(limit.unit ?? 'count'),
    scope: scope.queryScope,
    freshnessStatus: freshnessFromLimit(limit),
    sourceMode: 'control_plane_inventory',
    sourceRef: String(limit.dimensionKey ?? 'unknown_dimension'),
    observedAt: snapshotTimestamp
  }));
  const degradedDimensions = dimensions
    .filter((dimension) => dimension.freshnessStatus !== 'fresh')
    .map((dimension) => dimension.dimensionId);
  const scopeId = scope.workspaceId ?? scope.tenantId;

  return ok(200, {
    snapshotId: `snapshot_${scope.queryScope}_${scopeId}_${Date.parse(snapshotTimestamp)}`,
    ...scope,
    snapshotTimestamp,
    observationWindow: { startedAt: snapshotTimestamp, endedAt: snapshotTimestamp },
    dimensions,
    degradedDimensions,
    calculationCycle: {
      cycleId: `cycle_${scope.queryScope}_${scopeId}_${Date.parse(snapshotTimestamp)}`,
      cadenceSeconds: 1,
      processedScopes: [scope.queryScope],
      degradedDimensions,
      snapshotTimestamp
    }
  });
}
// ---- series (Observability) — real per-tenant time series from Prometheus ---
// Backs the Observability page with the in-cluster Prometheus (#499): queries the tenant's HTTP
// request rate (from the falcone_http_requests_total counter the control-plane/executor now
// expose) over the last hour. Falls back to empty points (never errors) if Prometheus is
// unreachable, so the page degrades gracefully.
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? 'http://falcone-observability:9090';
async function tenantSeries(ctx) {
  const tenantId = String(ctx.params?.tenantId ?? ctx.identity?.tenantId ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const metricKey = ctx.query?.metric ?? 'http_requests_per_second';
  const promQL = `sum(rate(falcone_http_requests_total{tenant_id="${tenantId}"}[5m]))`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 3600;
  try {
    const u = new URL('/api/v1/query_range', PROMETHEUS_URL);
    u.searchParams.set('query', promQL);
    u.searchParams.set('start', String(start));
    u.searchParams.set('end', String(end));
    u.searchParams.set('step', '60');
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return ok(200, { metricKey, points: [], source: 'prometheus_unavailable' });
    const data = await res.json();
    const points = (data?.data?.result?.[0]?.values ?? []).map(([t, v]) => ({ timestamp: new Date(t * 1000).toISOString(), value: Number(v) }));
    return ok(200, { metricKey, points, source: 'prometheus' });
  } catch {
    return ok(200, { metricKey, points: [], source: 'prometheus_unreachable' });
  }
}

const WORKSPACE_SERIES_METRICS = Object.freeze({
  api_requests: ({ tenantId, workspaceId }) =>
    `sum(rate(falcone_http_requests_total{tenant_id="${tenantId}",workspace_id="${workspaceId}"}[5m]))`,
  api_errors: ({ tenantId, workspaceId }) =>
    `sum(rate(falcone_http_requests_total{tenant_id="${tenantId}",workspace_id="${workspaceId}",status=~"5.."}[5m]))`
});
const WORKSPACE_SERIES_WINDOWS = Object.freeze({
  '5m': { rangeSeconds: 300, stepSeconds: 5 },
  '1h': { rangeSeconds: 3600, stepSeconds: 15 },
  '24h': { rangeSeconds: 86400, stepSeconds: 300 },
  '7d': { rangeSeconds: 604800, stepSeconds: 1800 },
  '30d': { rangeSeconds: 2592000, stepSeconds: 7200 }
});

function queryValues(ctx, name) {
  if (ctx.searchParams instanceof URLSearchParams) return ctx.searchParams.getAll(name);
  const value = ctx.query?.[name];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function exactWorkspaceSeriesInput(ctx, name, allowlist) {
  const values = queryValues(ctx, name);
  if (values.length !== 1 || typeof values[0] !== 'string' || !allowlist.has(values[0])) {
    return null;
  }
  return values[0];
}

function escapePrometheusLabel(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function emptyWorkspaceSeries({ tenantId, workspaceId, metricKey, window }) {
  return {
    tenantId,
    workspaceId,
    metricKey,
    window,
    unit: 'requests_per_second',
    points: []
  };
}

function finiteProviderNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usablePrometheusPoints(payload) {
  if (payload?.status !== 'success' || !Array.isArray(payload?.data?.result)) return [];
  const values = payload.data.result[0]?.values;
  if (!Array.isArray(values)) return [];

  const points = [];
  for (const sample of values) {
    if (!Array.isArray(sample) || sample.length < 2) continue;
    const timestampSeconds = finiteProviderNumber(sample[0]);
    const value = finiteProviderNumber(sample[1]);
    if (timestampSeconds === null || value === null) continue;
    const date = new Date(timestampSeconds * 1000);
    if (!Number.isFinite(date.getTime())) continue;
    points.push({ timestamp: date.toISOString(), value });
  }
  return points;
}

async function workspaceSeries(ctx) {
  const metricKey = exactWorkspaceSeriesInput(ctx, 'metricKey', new Set(Object.keys(WORKSPACE_SERIES_METRICS)));
  const window = exactWorkspaceSeriesInput(ctx, 'window', new Set(Object.keys(WORKSPACE_SERIES_WINDOWS)));
  if (!metricKey || !window) {
    return err(
      400,
      'INVALID_METRIC_SERIES_QUERY',
      'metricKey and window must each be supplied exactly once using a supported value'
    );
  }

  const tenantId = ctx.resolvedScope.tenantId;
  const workspaceId = ctx.resolvedScope.workspaceId;
  const escapedScope = {
    tenantId: escapePrometheusLabel(tenantId),
    workspaceId: escapePrometheusLabel(workspaceId)
  };
  const promQL = WORKSPACE_SERIES_METRICS[metricKey](escapedScope);
  const { rangeSeconds, stepSeconds } = WORKSPACE_SERIES_WINDOWS[window];
  const end = Math.floor((ctx.nowMs?.() ?? Date.now()) / 1000);
  const response = emptyWorkspaceSeries({ tenantId, workspaceId, metricKey, window });

  try {
    const u = new URL('/api/v1/query_range', PROMETHEUS_URL);
    u.searchParams.set('query', promQL);
    u.searchParams.set('start', String(end - rangeSeconds));
    u.searchParams.set('end', String(end));
    u.searchParams.set('step', String(stepSeconds));
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return ok(200, response);
    const points = usablePrometheusPoints(await res.json());
    return ok(200, { ...response, points });
  } catch {
    return ok(200, response);
  }
}
const AVAILABLE_AUDIT_FILTERS = Object.freeze(AUDIT_FILTER_DESCRIPTORS.map((descriptor) => Object.freeze({
  id: descriptor.id,
  param: descriptor.param,
  label: descriptor.label,
  type: descriptor.type,
  ...(descriptor.allowedValues ? { allowedValues: descriptor.allowedValues } : {})
})));
const AUDIT_QUERY_PARAMETERS = Object.freeze([
  'page[size]',
  'page[after]',
  'sort',
  ...AUDIT_FILTER_DESCRIPTORS.map(({ param }) => param)
]);

function rawAuditQuery(ctx) {
  if (!ctx.searchParams || typeof ctx.searchParams.getAll !== 'function') return ctx.query ?? {};
  const query = {};
  for (const param of AUDIT_QUERY_PARAMETERS) {
    const values = ctx.searchParams.getAll(param);
    if (values.length === 1) query[param] = values[0];
    else if (values.length > 1) query[param] = values;
  }
  return query;
}

function canonicalAuditRecord(record) {
  return {
    eventId: record.eventId,
    eventTimestamp: record.eventTimestamp,
    actor: record.actor,
    scope: record.scope,
    resource: record.resource,
    action: record.action,
    result: record.result,
    correlationId: record.correlationId,
    origin: record.origin
  };
}

function auditCollection(items, queryScope, filters, page) {
  return {
    items,
    page,
    queryScope,
    appliedFilters: filters,
    availableFilters: AVAILABLE_AUDIT_FILTERS,
    consoleHints: {
      scopeId: queryScope,
      defaultColumns: ['eventTimestamp', 'action', 'actor', 'result'],
      savedPresets: [],
      states: {}
    }
  };
}

// ---- audit records (Observability) — read the action-audit store (#557) ----
// Reads plan_audit_events (the WRITER side, audit-store.mjs), scoped to the path's
// owning tenant (and workspace, for the workspace route). guarded() has already
// resolved + authorized the scope tenant, so this only ever returns own-tenant
// records. Invalid controls fail before the store; a valid unmatched filter is a
// normal empty success rather than a fallback to the unfiltered set.
async function auditRecords(ctx) {
  const scope = ctx.resolvedScope;
  const queryScope = ctx.params.workspaceId ? 'workspace' : 'tenant';
  let query;
  try {
    query = normalizeAuditEventQuery(rawAuditQuery(ctx), {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId ?? null,
      queryScope
    });
  } catch (error) {
    return err(400, error?.code ?? 'AUDIT_QUERY_INVALID', error?.message ?? 'invalid audit-record query');
  }

  const rows = await queryAuditEvents(ctx.pool, {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId ?? null,
    pageSize: query.pageSize,
    sort: query.sort,
    cursorPosition: query.cursorPosition,
    filters: query.filters
  });
  const hasMore = rows.length > query.pageSize;
  const pageRows = rows.slice(0, query.pageSize);
  const items = pageRows
    .map((row) => canonicalAuditRecord(auditRowToRecord(row)));
  const page = { size: items.length, hasMore };
  if (hasMore && items.length > 0) {
    const last = pageRows.at(-1);
    page.nextCursor = encodeAuditCursor({
      position: { createdAt: last.cursor_created_at, id: String(last.id) },
      fingerprint: query.fingerprint
    });
  }
  return ok(200, auditCollection(items, queryScope, query.filters, page));
}
// ---- audit export (Observability) — REAL masked export (#683) ---------------
// Upgrades the former 202 no-op ack to a real export: query the tamper-evident audit store
// (queryAuditEvents) scoped to the resolved tenant/workspace, then build a MASKED export manifest
// with the product preview builder (apps/control-plane-executor observability-audit-export — masks sensitive
// detail fields). The guarded() wrapper has already authorized the caller for this scope, so the
// records returned never cross a tenant/workspace boundary. The builder is lazily loaded (it lives
// under /repo in the image, alongside packages/internal-contracts which it imports) so this module
// still imports cleanly in the blackbox harness; if it cannot be resolved, we fall back to the
// already-imported per-row mapper + a manifest assembled inline (records are still tenant-scoped).
let _auditExportPreview = null;
async function loadAuditExportPreview() {
  if (_auditExportPreview) return _auditExportPreview;
  const candidates = [
    '/repo/apps/control-plane-executor/src/observability-audit-export.mjs',
    new URL('../control-plane-executor/src/observability-audit-export.mjs', import.meta.url).href
  ];
  for (const c of candidates) {
    try { const m = await import(c); if (m?.exportTenantAuditRecordsPreview) { _auditExportPreview = m; return m; } }
    catch { /* try next */ }
  }
  return null;
}

async function auditExport(ctx) {
  // Resolve the scope (tenant from the path, or the workspace's owning tenant). guarded() has
  // already verified the caller may read this scope, so this only derives the ids for the query.
  const scope = ctx.resolvedScope ?? await resolveScopeTenant(ctx);
  if (scope.error) return scope.error;
  const tenantId = scope.tenantId;
  const workspaceId = scope.workspaceId ?? null;
  const builder = Object.hasOwn(ctx, 'auditExportBuilder') ? ctx.auditExportBuilder : await loadAuditExportPreview();
  const format = ctx.body?.format;
  if (format !== 'jsonl' && format !== 'csv') return err(400, 'AUDIT_EXPORT_INVALID_FORMAT', 'format must be jsonl or csv');
  const rawLimit = ctx.body?.pageSize;
  const limit = rawLimit === undefined ? 500 : rawLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) return err(400, 'AUDIT_EXPORT_LIMIT_EXCEEDED', 'pageSize must be an integer from 1 through 10000');
  const maskingProfileId = ctx.body?.maskingProfileId ?? 'default_masked';
  if (maskingProfileId !== 'default_masked') return err(400, 'AUDIT_EXPORT_UNKNOWN_MASKING_PROFILE', 'maskingProfileId must be default_masked');
  const context = { actor: { id: String(ctx.identity?.sub ?? 'unknown') }, correlationId: String(ctx.callerContext?.correlationId ?? randomUUID()), tenantId, workspaceId };
  const queryInput = Object.fromEntries([
    ['sort', ctx.body?.sort],
    ...AUDIT_FILTER_DESCRIPTORS.map((descriptor) => [
      descriptor.param,
      ctx.body?.filters?.[descriptor.key] ?? ctx.body?.filters?.[descriptor.id]
    ])
  ].filter(([, value]) => value !== undefined && value !== null));
  let query;
  try {
    query = normalizeAuditEventQuery(queryInput, {
      tenantId,
      workspaceId,
      queryScope: workspaceId ? 'workspace' : 'tenant'
    });
  } catch (e) {
    const code = e?.code === 'AUDIT_QUERY_INVALID_SORT'
      ? 'AUDIT_EXPORT_INVALID_SORT'
      : e?.code === 'AUDIT_QUERY_INVALID_TIME_WINDOW'
        ? 'AUDIT_EXPORT_INVALID_TIME_WINDOW'
        : 'AUDIT_EXPORT_INVALID_FILTER';
    return err(400, code, e?.message ?? 'audit export query is invalid');
  }
  if (query.filters.occurred_after && query.filters.occurred_before) {
    const windowMs = Date.parse(query.filters.occurred_before) - Date.parse(query.filters.occurred_after);
    if (windowMs > 31 * 24 * 60 * 60 * 1000) {
      return err(400, 'AUDIT_EXPORT_INVALID_TIME_WINDOW', 'audit export time window cannot exceed 31 days');
    }
  }
  const rawInput = {
    format,
    pageSize: limit,
    maskingProfileId,
    sort: query.sort,
    filters: query.filters
  };
  let normalized = rawInput;
  if (builder?.normalizeAuditExportRequest) {
    try { normalized = builder.normalizeAuditExportRequest(workspaceId ? 'workspace' : 'tenant', context, { ...rawInput, ...(workspaceId ? { workspaceId } : { tenantId }) }); }
    catch (e) { if (e?.code?.startsWith?.('AUDIT_EXPORT_')) return err(400, e.code, e.message); throw e; }
  }
  let rows = [];
  const safeFilters = normalized.filters;
  try { rows = await queryAuditEvents(ctx.pool, { tenantId, workspaceId, limit: normalized.pageSize, maxLimit: 10000, filters: safeFilters, sort: normalized.sort }); }
  catch (e) { return err(500, 'AUDIT_EXPORT_QUERY_FAILED', 'audit export query failed'); }
  const records = rows.map(auditRowToRecord);
  if (builder) {
    try {
      const input = {
        records,
        format: normalized.format?.id ?? format,
        maskingProfileId: normalized.maskingProfile?.id ?? maskingProfileId,
        pageSize: normalized.pageSize,
        generatedAt: nowIso(ctx),
        filters: safeFilters,
        sort: normalized.sort
      };
      const manifest = workspaceId
        ? builder.exportWorkspaceAuditRecordsPreview(context, { ...input, workspaceId })
        : builder.exportTenantAuditRecordsPreview(context, { ...input, tenantId });
      return ok(200, manifest);
    } catch (e) {
      if (e?.code?.startsWith?.('AUDIT_EXPORT_')) return err(400, e.code, e.message);
      console.error(`[metrics] audit export builder failed: ${String(e?.message ?? e)}`);
      return err(500, 'AUDIT_EXPORT_BUILD_FAILED', 'audit export build failed');
    }
  }
  // Inline fallback manifest (records already tenant/workspace-scoped via queryAuditEvents).
  // Only reachable if apps/control-plane-executor (which holds the masking profile) is absent from the
  // image. Without the profile we cannot reproduce its per-field masking, so we conservatively
  // redact the entire `detail` field — the only field the primary path masks — guaranteeing this
  // fallback never exposes MORE sensitive data than the profile-masked path.
  const maskedItems = records.map((record) => ({
    ...canonicalAuditRecord(record),
    detail: {},
    maskingApplied: true,
    maskedFieldRefs: ['detail'],
    sensitivityCategories: ['fallback_full_detail_redaction']
  }));
  return ok(200, {
    exportId: `exp_${randomUUID()}`,
    queryScope: workspaceId ? 'workspace' : 'tenant',
    format: normalized.format?.id ?? format,
    maskingProfileId: normalized.maskingProfile?.id ?? maskingProfileId,
    correlationId: String(ctx.callerContext?.correlationId ?? randomUUID()),
    generatedAt: nowIso(ctx),
    appliedFilters: safeFilters,
    itemCount: maskedItems.length,
    maskedItemCount: maskedItems.length,
    items: maskedItems
  });
}

// ---- own-tenant authorization (P0 ISO-METRICS) -----------------------------
// Every metrics route is `auth: authenticated`, so without this guard ANY verified
// caller could read ANY tenant's metrics by id (and a non-existent id returned a
// 200). Resolve the path scope to its owning tenant and apply the same own-tenant
// guard b-handlers uses for tenant/workspace management: tenant owners/admins may
// read only their own tenant; superadmin/internal may read any.
async function resolveScopeTenant(ctx) {
  if (ctx.params.workspaceId) {
    ctx.markWorkspaceScopeResolutionAttempted?.();
    const ws = await store.getWorkspace(ctx.pool, ctx.params.workspaceId);
    if (!ws) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
    return { tenantId: ws.tenant_id, workspaceId: ws.id };
  }
  return { tenantId: ctx.params.tenantId };
}
function guarded(handler) {
  return async (ctx) => {
    const scope = await resolveScopeTenant(ctx);
    if (scope.error) return scope.error;
    if (!canManageTenant(ctx.identity, scope.tenantId)) {
      return err(403, 'FORBIDDEN', 'cannot read another tenant’s metrics');
    }
    // C-16: confirm the addressed tenant actually exists in the authoritative registry BEFORE
    // any limits/provider/audit/export work, so a fabricated healthy 200 is never returned for a
    // tenant that does not exist. The lookup runs ONLY for tenant paths and ONLY AFTER the
    // canManageTenant decision above: a constrained caller must not be able to enumerate tenant
    // existence (a foreign-existing and an unrelated-unknown tenant both stop at the same opaque
    // 403 with no registry read). Workspace paths already resolved — and thereby confirmed — their
    // scope via store.getWorkspace in resolveScopeTenant, so they are not re-probed here. A
    // datastore fault propagates (rejects) to the canonical C-02 server-failure path; only an
    // absent row is TENANT_NOT_FOUND.
    if (!ctx.params.workspaceId) {
      const tenant = await store.getTenant(ctx.pool, scope.tenantId);
      if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${scope.tenantId} not found`);
      scope.tenantId = tenant.id;
    }
    ctx.resolvedScope = scope;
    // Scope is canonical and authorized at this point. Attach it before parameter/provider work
    // so the all-request and 5xx workspace series retain authorized 4xx/5xx outcomes too.
    if (ctx.metric) {
      if (scope.workspaceId) applyCanonicalWorkspaceMetric(ctx.metric, scope);
      else ctx.metric.tenantId = scope.tenantId;
    }
    return handler(ctx);
  };
}

// Tenant + workspace share the same handlers (scope inferred from the path params).
export const METRICS_HANDLERS = {
  metricsTenantQuotas: guarded(quotas), metricsWorkspaceQuotas: guarded(quotas),
  metricsTenantOverview: guarded(overview), metricsWorkspaceOverview: guarded(overview),
  metricsTenantUsage: guarded(usage), metricsWorkspaceUsage: guarded(usage),
  metricsTenantSeries: guarded(tenantSeries), metricsWorkspaceSeries: guarded(workspaceSeries),
  metricsTenantAudit: guarded(auditRecords), metricsWorkspaceAudit: guarded(auditRecords),
  metricsTenantAuditExport: guarded(auditExport), metricsWorkspaceAuditExport: guarded(auditExport)
};
