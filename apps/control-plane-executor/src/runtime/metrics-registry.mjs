// Zero-dependency Prometheus metrics registry (add-falcone-metrics-scrape-and-dashboards, #499).
//
// In-process counters + a latency histogram for HTTP requests, rendered in the Prometheus text
// exposition format at GET /metrics (scraped by the in-cluster Prometheus). Labels are bounded:
// `route` is the path with id-like segments collapsed to {id} (so cardinality is per-route, not
// per-resource), plus method/status, the tenant when known, and a workspace only after trusted
// identity or canonical resolution. No external deps — the kind runtime images bundle no metrics
// library.

const requestsTotal = new Map();   // JSON [method, route, status, tenant, workspace?] -> count
const durationByRoute = new Map(); // "method|route" -> { buckets:number[], sum, count }
const LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const startedAtMs = Date.now();

// ── MCP business metrics (fix-c07-business-metric-export) ────────────────────────────────────────
// The executor already shapes two signals for every completed MCP tool call (mcp-observability.mjs):
// the usage counter in_falcone_mcp_tool_invocations_total and the mcp/tool_call slice of the
// normalized latency histogram in_falcone_component_operation_duration_seconds. C07 is that those
// descriptors were discarded. This registry records the PAIR as ONE combined entry per canonical
// series and renders both families on the existing /metrics surface — no other catalog family, no
// synthetic/zero samples. The pair is validated and its next state computed detached from published
// state, so a single Map.set is the only publication (no counter-only / histogram-only half-update).
const mcpToolCallEntries = new Map();
const MCP_LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MCP_COUNTER_NAME = 'in_falcone_mcp_tool_invocations_total';
const MCP_DURATION_NAME = 'in_falcone_component_operation_duration_seconds';
const MCP_STATUS_CLASSES = new Set(['success', 'error', 'denied']);
const MCP_SCOPES = new Set(['tenant', 'workspace']);
const MCP_COUNTER_REQUIRED_LABELS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'domain', 'metric_type',
  'feature_area', 'operation_family', 'tenant_id', 'server', 'tool_name', 'status_class',
];
const MCP_HISTOGRAM_REQUIRED_LABELS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'operation', 'tenant_id',
  'server', 'tool_name', 'status_class',
];
const MCP_CONDITIONAL_LABELS = ['workspace_id', 'oauth_client'];
const MCP_COUNTER_FIXED_LABELS = {
  subsystem: 'mcp',
  collection_mode: 'push',
  domain: 'mcp_tool_usage',
  metric_type: 'usage',
  feature_area: 'mcp',
  operation_family: 'execute',
};
const MCP_HISTOGRAM_FIXED_LABELS = {
  subsystem: 'mcp',
  collection_mode: 'push',
  operation: 'tool_call',
};
const MCP_SHARED_LABELS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'tenant_id', 'workspace_id',
  'server', 'tool_name', 'oauth_client', 'status_class',
];

const esc = (v) => String(v ?? '').replace(/[\\"\n]/g, '_');
const escPrometheusLabel = (v) => String(v ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r\n|\r|\n/g, '\\n');

// Render a label object as an escaped Prometheus label list in stable insertion order.
const renderLabels = (labels) => Object.entries(labels)
  .map(([name, value]) => `${name}="${escPrometheusLabel(value)}"`).join(',');

// Collapse id-like path segments so the `route` label is bounded (a UUID, a long token/key, or a
// purely numeric segment becomes {id}). Keeps the structural shape (/v1/tenants/{id}/workspaces).
export function normalizeRoute(path) {
  const norm = (path || '/').split('?')[0].split('/').map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(seg)) return '{id}';
    if (/^[0-9]+$/.test(seg)) return '{id}';
    if (seg.length > 24) return '{id}';
    return seg;
  }).join('/');
  return norm || '/';
}

// Record one handled request. durationSeconds is the wall-clock handler time.
export function recordHttp({ method = 'GET', route = 'unmatched', status = 0, tenantId = '', workspaceId = '', durationSeconds = 0 }) {
  const tenant = tenantId || 'anonymous';
  const workspace = workspaceId == null ? '' : String(workspaceId);
  const rk = JSON.stringify([method, route, status, tenant, workspace]);
  requestsTotal.set(rk, (requestsTotal.get(rk) ?? 0) + 1);

  const dk = `${method}|${route}`;
  let h = durationByRoute.get(dk);
  if (!h) { h = { buckets: new Array(LE.length).fill(0), sum: 0, count: 0 }; durationByRoute.set(dk, h); }
  h.sum += durationSeconds;
  h.count += 1;
  for (let i = 0; i < LE.length; i++) if (durationSeconds <= LE[i]) h.buckets[i] += 1; // cumulative
}

function validateMcpLabels(labels, requiredLabels, fixedLabels) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new TypeError('MCP telemetry labels must be an object.');
  }

  const actualKeys = Object.keys(labels);
  const allowedKeys = new Set([...requiredLabels, ...MCP_CONDITIONAL_LABELS]);
  for (const key of actualKeys) {
    if (!allowedKeys.has(key)) throw new Error(`Unexpected MCP label: ${key}.`);
  }
  for (const key of requiredLabels) {
    if (!Object.hasOwn(labels, key)) throw new Error(`Missing required MCP label: ${key}.`);
  }
  for (const key of actualKeys) {
    if (typeof labels[key] !== 'string') throw new TypeError(`MCP label ${key} must be a string.`);
  }
  for (const [key, value] of Object.entries(fixedLabels)) {
    if (labels[key] !== value) throw new Error(`MCP label ${key} must equal ${value}.`);
  }
  if (!MCP_SCOPES.has(labels.metric_scope)) {
    throw new Error('MCP metric_scope must be tenant or workspace.');
  }
  if (!MCP_STATUS_CLASSES.has(labels.status_class)) {
    throw new Error('MCP status_class must be success, error, or denied.');
  }
  for (const key of ['tenant_id', 'server', 'tool_name']) {
    if (labels[key].length === 0) throw new Error(`MCP label ${key} must be non-empty.`);
  }

  const hasWorkspace = Object.hasOwn(labels, 'workspace_id');
  if (labels.metric_scope === 'workspace' && (!hasWorkspace || labels.workspace_id.length === 0)) {
    throw new Error('MCP workspace scope requires a non-empty workspace_id.');
  }
  if (labels.metric_scope === 'tenant' && hasWorkspace) {
    throw new Error('MCP tenant scope must omit workspace_id.');
  }
  if (Object.hasOwn(labels, 'oauth_client') && labels.oauth_client.length === 0) {
    throw new Error('MCP oauth_client must be non-empty when present.');
  }

  const orderedKeys = [...requiredLabels];
  if (hasWorkspace) orderedKeys.push('workspace_id');
  if (Object.hasOwn(labels, 'oauth_client')) orderedKeys.push('oauth_client');
  return Object.fromEntries(orderedKeys.map((key) => [key, labels[key]]));
}

function validateMcpDescriptor(descriptor, expectedName, expectedKind, requiredLabels, fixedLabels) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('MCP telemetry descriptor must be an object.');
  }
  if (descriptor.name !== expectedName) throw new Error(`Unexpected MCP metric name: ${descriptor.name}.`);
  if (descriptor.kind !== expectedKind) {
    throw new Error(`MCP metric ${expectedName} must have kind ${expectedKind}.`);
  }
  return validateMcpLabels(descriptor.labels, requiredLabels, fixedLabels);
}

function mcpSeriesKey(labels) {
  return JSON.stringify(MCP_SHARED_LABELS.map((key) => labels[key] ?? null));
}

// Record one completed MCP invocation as an immutable counter/histogram pair. All descriptor and
// policy validation happens before published state is read. The detached next entry is complete
// before the final Map.set, and no fallible recording work follows that single publication.
export function recordMcpToolCallPair({ counter, histogram } = {}) {
  const counterLabels = validateMcpDescriptor(
    counter,
    MCP_COUNTER_NAME,
    'counter',
    MCP_COUNTER_REQUIRED_LABELS,
    MCP_COUNTER_FIXED_LABELS,
  );
  const histogramLabels = validateMcpDescriptor(
    histogram,
    MCP_DURATION_NAME,
    'histogram',
    MCP_HISTOGRAM_REQUIRED_LABELS,
    MCP_HISTOGRAM_FIXED_LABELS,
  );
  if (counter.value !== 1) throw new Error('MCP counter value must equal 1.');
  if (typeof histogram.observedSeconds !== 'number'
    || !Number.isFinite(histogram.observedSeconds)
    || histogram.observedSeconds < 0) {
    throw new Error('MCP histogram observedSeconds must be finite and non-negative.');
  }
  for (const key of MCP_SHARED_LABELS) {
    if ((counterLabels[key] ?? null) !== (histogramLabels[key] ?? null)) {
      throw new Error(`MCP counter and histogram labels disagree on ${key}.`);
    }
  }

  const key = mcpSeriesKey(counterLabels);
  const current = mcpToolCallEntries.get(key);
  const nextCounterValue = (current?.counterValue ?? 0) + 1;
  const nextHistogramCount = (current?.histogramCount ?? 0) + 1;
  const nextHistogramSum = (current?.histogramSum ?? 0) + histogram.observedSeconds;
  if (!Number.isSafeInteger(nextCounterValue) || !Number.isSafeInteger(nextHistogramCount)) {
    throw new Error('MCP aggregate count exceeds the safe integer range.');
  }
  if (!Number.isFinite(nextHistogramSum)) throw new Error('MCP histogram sum must remain finite.');

  const nextBucketCounts = current
    ? current.bucketCounts.slice()
    : new Array(MCP_LATENCY_BUCKETS.length).fill(0);
  for (let index = 0; index < MCP_LATENCY_BUCKETS.length; index += 1) {
    if (histogram.observedSeconds <= MCP_LATENCY_BUCKETS[index]) nextBucketCounts[index] += 1;
  }
  const nextEntry = {
    counterLabels: { ...counterLabels },
    histogramLabels: { ...histogramLabels },
    counterValue: nextCounterValue,
    bucketCounts: nextBucketCounts,
    histogramSum: nextHistogramSum,
    histogramCount: nextHistogramCount,
  };

  mcpToolCallEntries.set(key, nextEntry);
}

// Render the full registry in Prometheus text exposition format.
export function renderMetrics() {
  const out = [];
  out.push('# HELP falcone_http_requests_total Total HTTP requests handled.');
  out.push('# TYPE falcone_http_requests_total counter');
  for (const [k, v] of requestsTotal) {
    const [method, route, status, tenant, workspace] = JSON.parse(k);
    const workspaceLabel = workspace ? `,workspace_id="${escPrometheusLabel(workspace)}"` : '';
    out.push(`falcone_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${esc(status)}",tenant_id="${escPrometheusLabel(tenant)}"${workspaceLabel}} ${v}`);
  }
  out.push('# HELP falcone_http_request_duration_seconds HTTP request latency in seconds.');
  out.push('# TYPE falcone_http_request_duration_seconds histogram');
  for (const [k, h] of durationByRoute) {
    const [method, route] = k.split('|');
    const lbl = `method="${esc(method)}",route="${esc(route)}"`;
    for (let i = 0; i < LE.length; i++) out.push(`falcone_http_request_duration_seconds_bucket{${lbl},le="${LE[i]}"} ${h.buckets[i]}`);
    out.push(`falcone_http_request_duration_seconds_bucket{${lbl},le="+Inf"} ${h.count}`);
    out.push(`falcone_http_request_duration_seconds_sum{${lbl}} ${h.sum}`);
    out.push(`falcone_http_request_duration_seconds_count{${lbl}} ${h.count}`);
  }
  out.push('# HELP falcone_process_uptime_seconds Process uptime in seconds.');
  out.push('# TYPE falcone_process_uptime_seconds gauge');
  out.push(`falcone_process_uptime_seconds ${Math.floor((Date.now() - startedAtMs) / 1000)}`);
  if (mcpToolCallEntries.size > 0) {
    out.push('# HELP in_falcone_mcp_tool_invocations_total MCP tool-invocation volume by tenant, workspace, server, tool, OAuth client, and status class.');
    out.push('# TYPE in_falcone_mcp_tool_invocations_total counter');
    const entries = [...mcpToolCallEntries.entries()]
      .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0));
    for (const [, entry] of entries) {
      out.push(`in_falcone_mcp_tool_invocations_total{${renderLabels(entry.counterLabels)}} ${entry.counterValue}`);
    }
    out.push('# HELP in_falcone_component_operation_duration_seconds Normalized component operation latency in seconds.');
    out.push('# TYPE in_falcone_component_operation_duration_seconds histogram');
    for (const [, entry] of entries) {
      const base = renderLabels(entry.histogramLabels);
      for (let index = 0; index < MCP_LATENCY_BUCKETS.length; index += 1) {
        out.push(`in_falcone_component_operation_duration_seconds_bucket{${base},le="${MCP_LATENCY_BUCKETS[index]}"} ${entry.bucketCounts[index]}`);
      }
      out.push(`in_falcone_component_operation_duration_seconds_bucket{${base},le="+Inf"} ${entry.histogramCount}`);
      out.push(`in_falcone_component_operation_duration_seconds_sum{${base}} ${entry.histogramSum}`);
      out.push(`in_falcone_component_operation_duration_seconds_count{${base}} ${entry.histogramCount}`);
    }
  }
  return out.join('\n') + '\n';
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
