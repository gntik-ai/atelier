import { queryAuditEvents, auditRowToRecord } from './audit-store.mjs';
import {
  resolveTenantAccess,
  resolveWorkspaceAccess,
  canAuditAcrossPlatform
} from './c08-authz.mjs';
import { validateC08Schema } from './c08-contracts.mjs';

const ok = (body) => ({ statusCode: 200, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const WINDOWS = new Set(['5m', '1h', '24h']);
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? 'http://falcone-observability:9090';

function contractual(schema, body) {
  const result = validateC08Schema(schema, body);
  if (!result.valid) {
    throw Object.assign(new Error(`C-08 ${schema} projection violates OpenAPI`), {
      code: 'C08_OUTPUT_CONTRACT_VIOLATION', validationErrors: result.errors
    });
  }
  return ok(body);
}

function queryValue(ctx, name) {
  if (ctx.searchParams?.get) return ctx.searchParams.get(name);
  const value = ctx.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestedWindow(ctx) {
  const value = queryValue(ctx, 'window');
  return WINDOWS.has(value) ? value : null;
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function parseMaxItems(value) {
  if (value == null) return 25;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 200 ? number : null;
}

async function loadCorrelationBuilder() {
  for (const candidate of [
    '/repo/apps/control-plane-executor/src/observability-audit-correlation.mjs',
    new URL('../control-plane-executor/src/observability-audit-correlation.mjs', import.meta.url).href
  ]) {
    try {
      const module = await import(candidate);
      if (module.buildAuditCorrelationTrace) return module.buildAuditCorrelationTrace;
    } catch { /* try checkout/image alternative */ }
  }
  throw Object.assign(new Error('audit correlation adapter is unavailable'), { code: 'AUDIT_CORRELATION_ADAPTER_UNAVAILABLE' });
}

async function correlationHandler(ctx, scopeId) {
  const access = scopeId === 'tenant'
    ? await resolveTenantAccess(ctx, {
        roles: ['tenant_owner', 'tenant_admin'], platformPredicate: canAuditAcrossPlatform
      })
    : await resolveWorkspaceAccess(ctx, {
        roles: ['workspace_owner', 'workspace_admin', 'workspace_operator', 'workspace_auditor'],
        tenantRoles: [], platformPredicate: canAuditAcrossPlatform
      });
  if (access.error) return access.error;
  const correlationId = String(ctx.params?.correlationId ?? '');
  if (!correlationId || correlationId.length > 255) return err(400, 'INVALID_CORRELATION_ID', 'correlationId is required');
  const includeRecords = parseBoolean(queryValue(ctx, 'includeRecords'), true);
  const includeEvidence = parseBoolean(queryValue(ctx, 'includeEvidence'), true);
  const maxItems = parseMaxItems(queryValue(ctx, 'maxItems'));
  if (includeRecords == null || includeEvidence == null || maxItems == null) {
    return err(400, 'INVALID_QUERY', 'includeRecords/includeEvidence/maxItems are invalid');
  }
  const rows = await queryAuditEvents(ctx.pool, {
    tenantId: access.tenantId,
    workspaceId: scopeId === 'workspace' ? access.workspaceId : null,
    queryScope: scopeId,
    filters: { correlation_id: correlationId },
    sort: 'eventTimestamp',
    limit: maxItems
  });
  if (!rows.length) return err(404, 'AUDIT_CORRELATION_NOT_FOUND', `correlation ${correlationId} not found`);
  const auditRecords = rows.map(auditRowToRecord);
  const buildAuditCorrelationTrace = ctx.buildAuditCorrelationTrace ?? await loadCorrelationBuilder();
  const body = buildAuditCorrelationTrace(scopeId, {
    actor: ctx.callerContext?.actor,
    tenantId: access.tenantId,
    workspaceId: scopeId === 'workspace' ? access.workspaceId : undefined,
    routeTenantId: scopeId === 'tenant' ? access.tenantId : undefined,
    routeWorkspaceId: scopeId === 'workspace' ? access.workspaceId : undefined,
    routeCorrelationId: correlationId
  }, {
    tenantId: access.tenantId,
    workspaceId: scopeId === 'workspace' ? access.workspaceId : undefined,
    correlationId,
    includeRecords,
    includeEvidence,
    maxItems,
    auditRecords,
    downstreamEvents: []
  });
  return contractual('AuditCorrelationTrace', body);
}

function escapePrometheusLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, '\\n');
}

async function queryPrometheus(ctx, query) {
  if (typeof ctx.prometheusQuery === 'function') {
    const injected = await ctx.prometheusQuery(query);
    if (Array.isArray(injected)) return injected;
    if (Array.isArray(injected?.data?.result)) return injected.data.result;
    if (Array.isArray(injected?.result)) return injected.result;
    throw Object.assign(new Error('injected Prometheus result is malformed'), { code: 'METRICS_DEPENDENCY_INVALID' });
  }
  const url = new URL('/api/v1/query', PROMETHEUS_URL);
  url.searchParams.set('query', query);
  let response;
  try {
    response = await (ctx.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(4_000) });
  } catch (cause) {
    throw Object.assign(new Error('Prometheus is unreachable'), { code: 'METRICS_DEPENDENCY_UNAVAILABLE', cause });
  }
  if (!response.ok) throw Object.assign(new Error(`Prometheus returned ${response.status}`), { code: 'METRICS_DEPENDENCY_UNAVAILABLE' });
  const payload = await response.json();
  if (payload?.status !== 'success' || !Array.isArray(payload?.data?.result)) {
    throw Object.assign(new Error('Prometheus returned an invalid response'), { code: 'METRICS_DEPENDENCY_INVALID' });
  }
  return payload.data.result;
}

function numericSample(series) {
  const value = series?.[0]?.value?.[1];
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function eventDashboardBuilder() {
  for (const candidate of [
    '/repo/packages/event-gateway/src/kafka-integrations.mjs',
    new URL('../../packages/event-gateway/src/kafka-integrations.mjs', import.meta.url).href
  ]) {
    try {
      const module = await import(candidate);
      if (module.buildWorkspaceEventDashboard) return module.buildWorkspaceEventDashboard;
    } catch { /* try alternative */ }
  }
  throw Object.assign(new Error('event dashboard adapter is unavailable'), { code: 'EVENT_DASHBOARD_ADAPTER_UNAVAILABLE' });
}

const METRIC_ROLES = [
  'workspace_owner', 'workspace_admin', 'workspace_operator', 'workspace_viewer', 'workspace_developer'
];

async function metricsAccess(ctx) {
  return resolveWorkspaceAccess(ctx, {
    roles: METRIC_ROLES,
    tenantRoles: ['tenant_owner', 'tenant_admin']
  });
}

async function getWorkspaceEventDashboards(ctx) {
  const access = await metricsAccess(ctx);
  if (access.error) return access.error;
  const window = requestedWindow(ctx);
  if (!window) return err(400, 'INVALID_WINDOW', 'window must be one of 5m, 1h, 24h');
  const builder = ctx.buildWorkspaceEventDashboard ?? await eventDashboardBuilder();
  const template = builder({ workspaceId: access.workspaceId });
  let samples;
  try { samples = await Promise.all(template.widgets.map((widget) => queryPrometheus(ctx, widget.query))); }
  catch (error) { return err(503, error.code ?? 'METRICS_DEPENDENCY_UNAVAILABLE', 'workspace event metrics are unavailable'); }
  const widgets = template.widgets.map((widget, index) => ({ ...widget, seriesCount: samples[index].length }));
  return contractual('WorkspaceEventDashboardResponse', {
    workspaceId: access.workspaceId,
    window,
    sampledAt: new Date().toISOString(),
    widgets,
    coverage: {
      topicMetrics: samples[0].length + samples[1].length,
      bridges: samples[2].length,
      functionTriggers: samples[3].length,
      auditSeries: samples[4].length
    }
  });
}

const GATEWAY_QUERIES = Object.freeze({
  websocketActive: (l) => `sum(in_falcone_event_gateway_active_ws_connections{${l}})`,
  sseActive: (l) => `sum(in_falcone_event_gateway_active_sse_streams{${l}})`,
  acceptedPerMinute: (l, w) => `sum(rate(in_falcone_event_gateway_publish_total{${l},outcome="accepted"}[${w}])) * 60`,
  rejectedPerMinute: (l, w) => `sum(rate(in_falcone_event_gateway_publish_total{${l},outcome="rejected"}[${w}])) * 60`,
  publishP95Ms: (l, w) => `histogram_quantile(0.95, sum(rate(in_falcone_event_gateway_publish_duration_ms_bucket{${l}}[${w}])) by (le))`,
  lagP95Ms: (l, w) => `histogram_quantile(0.95, sum(rate(in_falcone_event_gateway_consumer_lag_ms_bucket{${l}}[${w}])) by (le))`,
  maxMessagesBehind: (l) => `max(in_falcone_event_gateway_consumer_lag_messages{${l}})`,
  deniedPerMinute: (l, w) => `sum(rate(in_falcone_event_gateway_authz_denied_total{${l}}[${w}])) * 60`,
  backpressurePerMinute: (l, w) => `sum(rate(in_falcone_event_gateway_backpressure_rejections_total{${l}}[${w}])) * 60`,
  replayAccepted: (l, w) => `sum(rate(in_falcone_event_gateway_replay_total{${l},outcome="accepted"}[${w}])) * 60`,
  replayDenied: (l, w) => `sum(rate(in_falcone_event_gateway_replay_total{${l},outcome="denied"}[${w}])) * 60`,
  reconnects: (l, w) => `sum(rate(in_falcone_event_gateway_reconnect_total{${l}}[${w}])) * 60`,
  orderingViolations: (l) => `sum(in_falcone_event_gateway_relative_order_violations_total{${l}})`
});

async function getWorkspaceGatewayStreamMetrics(ctx) {
  const access = await metricsAccess(ctx);
  if (access.error) return access.error;
  const window = requestedWindow(ctx);
  if (!window) return err(400, 'INVALID_WINDOW', 'window must be one of 5m, 1h, 24h');
  const labels = `tenant_id="${escapePrometheusLabel(access.tenantId)}",workspace_id="${escapePrometheusLabel(access.workspaceId)}"`;
  const entries = Object.entries(GATEWAY_QUERIES);
  let results;
  try { results = await Promise.all(entries.map(([, build]) => queryPrometheus(ctx, build(labels, window)))); }
  catch (error) { return err(503, error.code ?? 'METRICS_DEPENDENCY_UNAVAILABLE', 'gateway stream metrics are unavailable'); }
  const values = Object.fromEntries(entries.map(([name], index) => [name, numericSample(results[index])]));
  if (Object.values(values).some((value) => value == null)) {
    return err(503, 'METRICS_SERIES_UNAVAILABLE', 'one or more required gateway metric series are unavailable');
  }
  return contractual('GatewayStreamMetricsResponse', {
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    window,
    sampledAt: new Date().toISOString(),
    connections: { websocketActive: Math.trunc(values.websocketActive), sseActive: Math.trunc(values.sseActive) },
    publishes: {
      acceptedPerMinute: values.acceptedPerMinute,
      rejectedPerMinute: values.rejectedPerMinute,
      publishP95Ms: values.publishP95Ms
    },
    lag: { p95Ms: values.lagP95Ms, maxMessagesBehind: Math.trunc(values.maxMessagesBehind) },
    authz: {
      deniedPerMinute: values.deniedPerMinute,
      backpressureRejectionsPerMinute: values.backpressurePerMinute
    },
    replay: { acceptedPerMinute: values.replayAccepted, deniedPerMinute: values.replayDenied },
    resilience: {
      reconnectsPerMinute: values.reconnects,
      relativeOrderViolations: Math.trunc(values.orderingViolations)
    },
    source: { metricsPath: '/apisix/prometheus/metrics', seriesPrefix: 'in_falcone_event_gateway_' }
  });
}

async function getWorkspaceKafkaTopicMetrics(ctx) {
  const access = await metricsAccess(ctx);
  if (access.error) return access.error;
  const window = requestedWindow(ctx);
  if (!window) return err(400, 'INVALID_WINDOW', 'window must be one of 5m, 1h, 24h');
  const topics = await (ctx.topicStore ?? (await import('./tenant-store.mjs'))).listTopicsForWorkspace(ctx.pool, access.workspaceId);
  let configByName;
  try {
    if (ctx.describeTopicConfigs) configByName = await ctx.describeTopicConfigs(topics.map((topic) => topic.physical_topic_name));
    else {
      const { describeTopicConfigsStrict } = await import('./kafka-handlers.mjs');
      configByName = await describeTopicConfigsStrict(topics.map((topic) => topic.physical_topic_name));
    }
  } catch {
    return err(503, 'KAFKA_CONFIG_DEPENDENCY_UNAVAILABLE', 'Kafka topic configuration is unavailable');
  }
  const samples = [];
  for (const topic of topics) {
    const labels = `tenant_id="${escapePrometheusLabel(access.tenantId)}",workspace_id="${escapePrometheusLabel(access.workspaceId)}",topic_ref="${escapePrometheusLabel(topic.id)}"`;
    let values;
    try {
      const result = await Promise.all([
        queryPrometheus(ctx, `sum(rate(in_falcone_event_gateway_publish_total{${labels},outcome="accepted"}[${window}])) * 60`),
        queryPrometheus(ctx, `max(in_falcone_kafka_consumer_lag_messages{${labels}})`),
        queryPrometheus(ctx, `count(in_falcone_event_bridge_delivery_lag_messages{${labels}})`),
        queryPrometheus(ctx, `count(in_falcone_openwhisk_kafka_trigger_invocations_total{${labels}})`)
      ]);
      values = result.map(numericSample);
    } catch {
      return err(503, 'METRICS_DEPENDENCY_UNAVAILABLE', 'Kafka topic metrics are unavailable');
    }
    if (values.some((value) => value == null)) {
      return err(503, 'METRICS_SERIES_UNAVAILABLE', `required metric series are unavailable for ${topic.id}`);
    }
    const config = configByName.get?.(topic.physical_topic_name) ?? configByName[topic.physical_topic_name];
    if (!config) return err(503, 'KAFKA_TOPIC_CONFIG_UNAVAILABLE', `Kafka config is unavailable for ${topic.id}`);
    samples.push({
      topicRef: topic.id,
      acceptedPerMinute: values[0],
      maxMessagesBehind: Math.trunc(values[1]),
      retentionHours: config.retentionHours,
      compactionEnabled: config.compactionEnabled,
      bridgeCount: Math.trunc(values[2]),
      functionTriggerCount: Math.trunc(values[3])
    });
  }
  return contractual('KafkaTopicMetricsResponse', {
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    window,
    sampledAt: new Date().toISOString(),
    topics: samples
  });
}

export const C08_OBSERVABILITY_HANDLERS = Object.freeze({
  getTenantAuditCorrelation: (ctx) => correlationHandler(ctx, 'tenant'),
  getWorkspaceAuditCorrelation: (ctx) => correlationHandler(ctx, 'workspace'),
  getWorkspaceEventDashboards,
  getWorkspaceGatewayStreamMetrics,
  getWorkspaceKafkaTopicMetrics
});
