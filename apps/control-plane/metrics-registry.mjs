// Zero-dependency Prometheus metrics registry (add-falcone-metrics-scrape-and-dashboards, #499).
//
// In-process counters + a latency histogram for HTTP requests, rendered in the Prometheus text
// exposition format at GET /metrics (scraped by the in-cluster Prometheus). Labels are bounded:
// `route` is the path with id-like segments collapsed to {id} (so cardinality is per-route, not
// per-resource), plus method/status and the tenant when known. No external deps — the kind
// runtime images bundle no metrics library.

const requestsTotal = new Map();   // "method|route|status|tenant" -> count
const durationByRoute = new Map(); // "method|route" -> { buckets:number[], sum, count }
const knativeDependencyTotal = new Map(); // bounded capability|operation|mode|state|reason|result
const LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const startedAtMs = Date.now();

const esc = (v) => String(v ?? '').replace(/[\\"\n]/g, '_');

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
export function recordHttp({ method = 'GET', route = 'unmatched', status = 0, tenantId = '', durationSeconds = 0 }) {
  const tenant = tenantId || 'anonymous';
  const rk = `${method}|${route}|${status}|${tenant}`;
  requestsTotal.set(rk, (requestsTotal.get(rk) ?? 0) + 1);

  const dk = `${method}|${route}`;
  let h = durationByRoute.get(dk);
  if (!h) { h = { buckets: new Array(LE.length).fill(0), sum: 0, count: 0 }; durationByRoute.set(dk, h); }
  h.sum += durationSeconds;
  h.count += 1;
  for (let i = 0; i < LE.length; i++) if (durationSeconds <= LE[i]) h.buckets[i] += 1; // cumulative
}

const KNATIVE_CAPABILITIES = new Set(['function', 'mcp']);
const KNATIVE_OPERATIONS = new Set(['deploy', 'update', 'invoke', 'rollback', 'delete', 'cleanup']);
const KNATIVE_MODES = new Set(['managed', 'external', 'disabled']);
const KNATIVE_STATES = new Set(['ready', 'unverified', 'degraded', 'unavailable', 'disabled']);
const KNATIVE_RESULTS = new Set(['unavailable', 'deferred', 'recovered', 'retry_failed']);
const KNATIVE_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

// Record a dependency transition without tenant- or resource-controlled labels. Tenant/workspace
// correlation belongs in the audit record; keeping it out of Prometheus bounds cardinality.
export function recordKnativeDependencyEvent(event = {}) {
  const capability = KNATIVE_CAPABILITIES.has(event.capability) ? event.capability : 'function';
  const operation = KNATIVE_OPERATIONS.has(event.operation) ? event.operation : 'cleanup';
  const mode = KNATIVE_MODES.has(event.mode) ? event.mode : 'disabled';
  const state = KNATIVE_STATES.has(event.state) ? event.state : 'unavailable';
  const reason = KNATIVE_REASON.test(event.reason ?? '') ? event.reason : 'STATUS_UNAVAILABLE';
  const result = KNATIVE_RESULTS.has(event.result) ? event.result : 'unavailable';
  const key = `${capability}|${operation}|${mode}|${state}|${reason}|${result}`;
  knativeDependencyTotal.set(key, (knativeDependencyTotal.get(key) ?? 0) + 1);
}

// Render the full registry in Prometheus text exposition format.
export function renderMetrics() {
  const out = [];
  out.push('# HELP falcone_http_requests_total Total HTTP requests handled.');
  out.push('# TYPE falcone_http_requests_total counter');
  for (const [k, v] of requestsTotal) {
    const [method, route, status, tenant] = k.split('|');
    out.push(`falcone_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${esc(status)}",tenant_id="${esc(tenant)}"} ${v}`);
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
  out.push('# HELP falcone_knative_dependency_events_total Knative availability, deferred cleanup, and recovery events.');
  out.push('# TYPE falcone_knative_dependency_events_total counter');
  for (const [key, value] of knativeDependencyTotal) {
    const [capability, operation, mode, state, reason, result] = key.split('|');
    out.push('falcone_knative_dependency_events_total{'
      + `capability="${esc(capability)}",operation="${esc(operation)}",mode="${esc(mode)}",`
      + `state="${esc(state)}",reason="${esc(reason)}",result="${esc(result)}"} ${value}`);
  }
  return out.join('\n') + '\n';
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
