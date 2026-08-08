// add-falcone-metrics-scrape-and-dashboards (#499): the control-plane/executor expose a Prometheus
// /metrics endpoint backed by this zero-dep registry. Pure unit coverage of recording + rendering +
// route normalization (bounded cardinality).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHttp, renderMetrics, normalizeRoute, METRICS_CONTENT_TYPE } from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';

test('normalizeRoute collapses id-like segments so the label is bounded', () => {
  assert.equal(normalizeRoute('/v1/tenants/3f9c2b1a-0000-4a5b-8c7d-aaaaaaaaaaaa/workspaces'), '/v1/tenants/{id}/workspaces');
  assert.equal(normalizeRoute('/v1/storage/buckets/12345/objects/67890'), '/v1/storage/buckets/{id}/objects/{id}');
  assert.equal(normalizeRoute('/v1/postgres/databases/in_falcone/schemas'), '/v1/postgres/databases/in_falcone/schemas');
});

test('recordHttp + renderMetrics emit counter + histogram in Prometheus text format', () => {
  recordHttp({ method: 'GET', route: '/v1/tenants', status: 200, tenantId: 'ten-a', durationSeconds: 0.012 });
  recordHttp({ method: 'GET', route: '/v1/tenants', status: 200, tenantId: 'ten-a', durationSeconds: 0.4 });
  recordHttp({ method: 'POST', route: '/v1/tenants', status: 500, tenantId: '', durationSeconds: 1.2 });
  const text = renderMetrics();

  assert.match(text, /# TYPE falcone_http_requests_total counter/);
  assert.match(text, /falcone_http_requests_total\{method="GET",route="\/v1\/tenants",status="200"\} 2/);
  assert.match(text, /falcone_http_requests_total\{method="POST",route="\/v1\/tenants",status="500"\} 1/);
  assert.match(text, /# TYPE falcone_http_request_duration_seconds histogram/);
  assert.match(text, /falcone_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/tenants",le="\+Inf"\} 2/);
  assert.match(text, /falcone_http_request_duration_seconds_count\{method="GET",route="\/v1\/tenants"\} 2/);
  assert.match(text, /falcone_process_uptime_seconds \d+/);
});

test('histogram buckets are cumulative (le ordering holds)', () => {
  // The GET /v1/tenants observations were 0.012s and 0.4s → le=0.025 has 1, le=0.5 has 2.
  const text = renderMetrics();
  const le025 = text.match(/falcone_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/tenants",le="0\.025"\} (\d+)/);
  const le05 = text.match(/falcone_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/tenants",le="0\.5"\} (\d+)/);
  assert.ok(Number(le025[1]) <= Number(le05[1]), 'cumulative buckets non-decreasing');
});

test('exposes the Prometheus text content-type', () => {
  assert.match(METRICS_CONTENT_TYPE, /text\/plain/);
});
