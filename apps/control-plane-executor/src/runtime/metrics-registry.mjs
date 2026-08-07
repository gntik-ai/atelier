// Zero-dependency Prometheus metrics registry (add-falcone-metrics-scrape-and-dashboards, #499).
//
// In-process counters + a latency histogram for HTTP requests, rendered in the Prometheus text
// exposition format at GET /metrics (scraped by the in-cluster Prometheus). Labels are bounded:
// `route` is the path with id-like segments collapsed to {id} (so cardinality is per-route, not
// per-resource), plus method/status and the tenant when known. No external deps — the kind
// runtime images bundle no metrics library.

const requestsTotal = new Map();   // "method|route|status" -> count
const durationByRoute = new Map(); // "method|route" -> { buckets:number[], sum, count }
const mcpDependencyEvents = new Map(); // "operation|outcome|mode|state|reason" -> count
const LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const startedAtMs = Date.now();

const esc = (v) => String(v ?? '').replace(/[\\"\n]/g, '_');

// Collapse id-like path segments so the `route` label is bounded (a UUID, a long token/key, or a
// purely numeric segment becomes {id}). Keeps the structural shape (/v1/tenants/{id}/workspaces).
export function normalizeRoute(path) {
  const raw = (path || '/').split('?')[0];
  if (/^\/v1\/functions\/actions\/[^/]+/.test(raw)) return '/v1/functions/actions/:id';
  if (/^\/v1\/mcp\/workspaces\/[^/]+\/servers\/[^/]+/.test(raw)) return '/v1/mcp/workspaces/:id/servers/:id';
  const norm = raw.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(seg)) return '{id}';
    if (/^[0-9]+$/.test(seg)) return '{id}';
    if (seg.length > 24) return ':id';
    return ':unmatched';
  }).join('/');
  return norm || '/';
}

// Record one handled request. durationSeconds is the wall-clock handler time.
export function recordHttp({ method = 'GET', route = 'unmatched', status = 0, durationSeconds = 0 }) {
  route = normalizeRoute(route);
  const rk = `${method}|${route}|${status}`;
  requestsTotal.set(rk, (requestsTotal.get(rk) ?? 0) + 1);

  const dk = `${method}|${route}`;
  let h = durationByRoute.get(dk);
  if (!h) { h = { buckets: new Array(LE.length).fill(0), sum: 0, count: 0 }; durationByRoute.set(dk, h); }
  h.sum += durationSeconds;
  h.count += 1;
  for (let i = 0; i < LE.length; i++) if (durationSeconds <= LE[i]) h.buckets[i] += 1; // cumulative
}

const MCP_OPERATIONS = new Set(['publish', 'activate', 'invoke', 'delete', 'cleanup']);
const MCP_OUTCOMES = new Set(['unavailable', 'deferred', 'recovered', 'failed']);
const KNATIVE_MODES = new Set(['managed', 'external', 'disabled']);
const KNATIVE_STATES = new Set(['ready', 'unverified', 'degraded', 'unavailable', 'disabled']);
const SAFE_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

// Runtime dependency metrics deliberately exclude tenant/server/correlation identifiers and tool
// inputs. Every label is selected from a fixed enum (reason is the already-bounded Knative reason),
// so an outage cannot create an unbounded Prometheus series set.
export function recordMcpDependency({ operation, outcome, mode, state, reason }) {
  const op = MCP_OPERATIONS.has(operation) ? operation : 'invoke';
  const result = MCP_OUTCOMES.has(outcome) ? outcome : 'failed';
  const runtimeMode = KNATIVE_MODES.has(mode) ? mode : 'disabled';
  const runtimeState = KNATIVE_STATES.has(state) ? state : 'unavailable';
  const boundedReason = SAFE_REASON.test(reason ?? '') ? reason : 'STATUS_UNAVAILABLE';
  const key = `${op}|${result}|${runtimeMode}|${runtimeState}|${boundedReason}`;
  mcpDependencyEvents.set(key, (mcpDependencyEvents.get(key) ?? 0) + 1);
}

// Render the full registry in Prometheus text exposition format.
export function renderMetrics() {
  const out = [];
  out.push('# HELP falcone_http_requests_total Total HTTP requests handled.');
  out.push('# TYPE falcone_http_requests_total counter');
  for (const [k, v] of requestsTotal) {
    const [method, route, status] = k.split('|');
    out.push(`falcone_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${esc(status)}"} ${v}`);
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
  out.push('# HELP falcone_mcp_knative_dependency_events_total Hosted MCP Knative dependency outcomes.');
  out.push('# TYPE falcone_mcp_knative_dependency_events_total counter');
  for (const [k, v] of mcpDependencyEvents) {
    const [operation, outcome, mode, state, reason] = k.split('|');
    out.push(`falcone_mcp_knative_dependency_events_total{operation="${esc(operation)}",outcome="${esc(outcome)}",mode="${esc(mode)}",state="${esc(state)}",reason="${esc(reason)}"} ${v}`);
  }
  out.push('# HELP falcone_process_uptime_seconds Process uptime in seconds.');
  out.push('# TYPE falcone_process_uptime_seconds gauge');
  out.push(`falcone_process_uptime_seconds ${Math.floor((Date.now() - startedAtMs) / 1000)}`);
  return out.join('\n') + '\n';
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
