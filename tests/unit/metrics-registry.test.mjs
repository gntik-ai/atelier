// add-falcone-metrics-scrape-and-dashboards (#499): the control-plane/executor expose a Prometheus
// /metrics endpoint backed by this zero-dep registry. Pure unit coverage of recording + rendering +
// route normalization (bounded cardinality).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  recordHttp,
  renderMetrics,
  normalizeRoute,
  METRICS_CONTENT_TYPE
} from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';
import * as controlPlaneMetrics from '../../apps/control-plane/metrics-registry.mjs';

const EXECUTOR_REGISTRY_URL = new URL(
  '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs',
  import.meta.url,
);
let isolatedRegistrySequence = 0;

async function importIsolatedExecutorRegistry() {
  const url = new URL(EXECUTOR_REGISTRY_URL);
  isolatedRegistrySequence += 1;
  url.searchParams.set('unit-test', `${process.pid}-${isolatedRegistrySequence}`);
  return import(url.href);
}

function buildMcpPair({
  scope = 'workspace',
  seconds = 0.012,
  tenantId = 'ten-c07',
  workspaceId = 'wrk-c07',
  server = 'srv-c07',
  toolName = 'list_items',
  oauthClient = 'oauth-c07',
  includeOauthClient = true,
  statusClass = 'success',
} = {}) {
  const shared = {
    environment: 'test',
    subsystem: 'mcp',
    metric_scope: scope,
    collection_mode: 'push',
    tenant_id: tenantId,
    ...(scope === 'workspace' ? { workspace_id: workspaceId } : {}),
    server,
    tool_name: toolName,
    ...(includeOauthClient ? { oauth_client: oauthClient } : {}),
    status_class: statusClass,
  };
  return {
    counter: {
      name: 'in_falcone_mcp_tool_invocations_total',
      kind: 'counter',
      value: 1,
      labels: {
        ...shared,
        domain: 'mcp_tool_usage',
        metric_type: 'usage',
        feature_area: 'mcp',
        operation_family: 'execute',
      },
    },
    histogram: {
      name: 'in_falcone_component_operation_duration_seconds',
      kind: 'histogram',
      observedSeconds: seconds,
      labels: { ...shared, operation: 'tool_call' },
    },
  };
}

function countLines(text, predicate) {
  return text.split('\n').filter(predicate).length;
}

function mcpBlocks(text) {
  return text.split('\n').filter((line) => (
    line.includes('in_falcone_mcp_tool_invocations_total')
    || line.includes('in_falcone_component_operation_duration_seconds')
  )).join('\n');
}

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
  assert.match(text, /falcone_http_requests_total\{method="GET",route="\/v1\/tenants",status="200",tenant_id="ten-a"\} 2/);
  assert.match(text, /falcone_http_requests_total\{method="POST",route="\/v1\/tenants",status="500",tenant_id="anonymous"\} 1/);
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

for (const [runtime, registry] of [
  ['control-plane', controlPlaneMetrics],
  ['executor', { recordHttp, renderMetrics }]
]) {
  test(`${runtime} counter conditionally includes only escaped trusted workspace labels`, () => {
    const suffix = runtime === 'control-plane' ? 'cp' : 'exec';
    const route = `/v1/c04/${suffix}`;
    registry.recordHttp({
      method: 'GET',
      route,
      status: 200,
      tenantId: `ten-${suffix}`,
      workspaceId: `wrk-${suffix}"\\\n`,
      durationSeconds: 0.01
    });
    registry.recordHttp({
      method: 'GET',
      route,
      status: 200,
      tenantId: `ten-${suffix}`,
      workspaceId: `wrk-${suffix}-sibling`,
      durationSeconds: 0.01
    });
    registry.recordHttp({
      method: 'GET',
      route: `${route}/tenant-only`,
      status: 200,
      tenantId: `ten-${suffix}`,
      durationSeconds: 0.01
    });
    registry.recordHttp({
      method: 'GET',
      route: `${route}/anonymous`,
      status: 401,
      durationSeconds: 0.01
    });

    const text = registry.renderMetrics();
    const lines = text.split('\n');
    assert.equal(
      lines.find((line) => line.includes(`workspace_id="wrk-${suffix}\\\"`)),
      `falcone_http_requests_total{method="GET",route="${route}",status="200",tenant_id="ten-${suffix}",workspace_id="wrk-${suffix}\\\"\\\\\\n"} 1`
    );
    assert.equal(
      lines.find((line) => line.includes(`workspace_id="wrk-${suffix}-sibling"`)),
      `falcone_http_requests_total{method="GET",route="${route}",status="200",tenant_id="ten-${suffix}",workspace_id="wrk-${suffix}-sibling"} 1`
    );
    const tenantOnly = text.split('\n').find((line) => line.includes(`route="${route}/tenant-only"`));
    const anonymous = text.split('\n').find((line) => line.includes(`route="${route}/anonymous"`));
    assert.ok(tenantOnly);
    assert.ok(anonymous);
    assert.doesNotMatch(tenantOnly, /workspace_id=/);
    assert.doesNotMatch(anonymous, /workspace_id=/);
    assert.match(anonymous, /tenant_id="anonymous"/);
  });
}

test('empty and freshly restarted executor registries expose no MCP sample or metadata line', async () => {
  const first = await importIsolatedExecutorRegistry();
  const second = await importIsolatedExecutorRegistry();

  assert.equal(mcpBlocks(first.renderMetrics()), '');
  first.recordMcpToolCallPair(buildMcpPair());
  assert.notEqual(mcpBlocks(first.renderMetrics()), '');
  assert.equal(mcpBlocks(second.renderMetrics()), '');
});

test('recordMcpToolCallPair atomically aggregates one counter and one histogram observation', async () => {
  const registry = await importIsolatedExecutorRegistry();
  const pair = buildMcpPair({ seconds: 0.012 });
  registry.recordMcpToolCallPair(pair);
  registry.recordMcpToolCallPair(buildMcpPair({ seconds: 0.4 }));
  const text = registry.renderMetrics();

  assert.equal(countLines(text, (line) => line.startsWith('# HELP in_falcone_mcp_tool_invocations_total ')), 1);
  assert.equal(countLines(text, (line) => line === '# TYPE in_falcone_mcp_tool_invocations_total counter'), 1);
  assert.equal(countLines(text, (line) => line.startsWith('# HELP in_falcone_component_operation_duration_seconds ')), 1);
  assert.equal(countLines(text, (line) => line === '# TYPE in_falcone_component_operation_duration_seconds histogram'), 1);
  assert.match(text, /in_falcone_mcp_tool_invocations_total\{[^\n]+\} 2\n/);
  assert.match(text, /in_falcone_component_operation_duration_seconds_bucket\{[^\n]+,le="0\.01"\} 0\n/);
  assert.match(text, /in_falcone_component_operation_duration_seconds_bucket\{[^\n]+,le="0\.025"\} 1\n/);
  assert.match(text, /in_falcone_component_operation_duration_seconds_bucket\{[^\n]+,le="0\.5"\} 2\n/);
  assert.match(text, /in_falcone_component_operation_duration_seconds_bucket\{[^\n]+,le="\+Inf"\} 2\n/);
  assert.match(text, /in_falcone_component_operation_duration_seconds_sum\{[^\n]+\} 0\.41200000000000003\n/);
  assert.match(text, /in_falcone_component_operation_duration_seconds_count\{[^\n]+\} 2\n/);
  assert.ok(text.endsWith('\n'));
  assert.equal(registry.METRICS_CONTENT_TYPE, 'text/plain; version=0.0.4; charset=utf-8');
});

test('MCP histogram renders the exact cumulative contract bucket vector', async () => {
  const registry = await importIsolatedExecutorRegistry();
  const observations = [0, 0.005, 0.006, 0.025, 0.26, 10, 10.1];
  for (const seconds of observations) registry.recordMcpToolCallPair(buildMcpPair({ seconds }));
  const text = registry.renderMetrics();
  const bucketLines = text.split('\n').filter((line) => (
    line.startsWith('in_falcone_component_operation_duration_seconds_bucket{')
  ));
  const rendered = bucketLines.map((line) => {
    const match = /,le="([^"]+)"\} (\d+)$/.exec(line);
    assert.ok(match, `malformed bucket line: ${line}`);
    return [match[1], Number(match[2])];
  });

  assert.deepEqual(rendered, [
    ['0.005', 2], ['0.01', 3], ['0.025', 4], ['0.05', 4], ['0.1', 4], ['0.25', 4],
    ['0.5', 5], ['1', 5], ['2.5', 5], ['5', 5], ['10', 6], ['+Inf', 7],
  ]);
});

test('MCP labels render in canonical order and escape every Prometheus line-breaking character', async () => {
  const registry = await importIsolatedExecutorRegistry();
  const dangerous = 'canonical\\server"line\nnext\r\nlast';
  registry.recordMcpToolCallPair(buildMcpPair({
    server: dangerous,
    toolName: `tool-${dangerous}`,
    oauthClient: `client-${dangerous}`,
  }));
  const text = registry.renderMetrics();
  const counterLine = text.split('\n').find((line) => (
    line.startsWith('in_falcone_mcp_tool_invocations_total{')
  ));

  assert.equal(
    counterLine,
    'in_falcone_mcp_tool_invocations_total{environment="test",subsystem="mcp",metric_scope="workspace",collection_mode="push",domain="mcp_tool_usage",metric_type="usage",feature_area="mcp",operation_family="execute",tenant_id="ten-c07",server="canonical\\\\server\\"line\\nnext\\nlast",tool_name="tool-canonical\\\\server\\"line\\nnext\\nlast",status_class="success",workspace_id="wrk-c07",oauth_client="client-canonical\\\\server\\"line\\nnext\\nlast"} 1',
  );
  assert.equal(text.includes('\r'), false);
  assert.equal(countLines(text, (line) => line.startsWith('# HELP in_falcone_')), 2);
  assert.equal(countLines(text, (line) => line.startsWith('# TYPE in_falcone_')), 2);
  assert.equal(countLines(text, (line) => line.startsWith('in_falcone_mcp_tool_invocations_total{')), 1);
});

test('MCP pair validation rejects every descriptor-policy drift without changing either family', async () => {
  const registry = await importIsolatedExecutorRegistry();
  registry.recordMcpToolCallPair(buildMcpPair());
  const before = mcpBlocks(registry.renderMetrics());
  const invalidCases = [
    ['counter name', (pair) => { pair.counter.name = 'in_falcone_other_total'; }],
    ['histogram name', (pair) => { pair.histogram.name = 'in_falcone_other_seconds'; }],
    ['counter kind', (pair) => { pair.counter.kind = 'gauge'; }],
    ['histogram kind', (pair) => { pair.histogram.kind = 'summary'; }],
    ['counter value zero', (pair) => { pair.counter.value = 0; }],
    ['counter value string', (pair) => { pair.counter.value = '1'; }],
    ['counter extra label', (pair) => { pair.counter.labels.request_id = 'unbounded'; }],
    ['histogram extra label', (pair) => { pair.histogram.labels.raw_path = '/caller/path'; }],
    ['counter missing label', (pair) => { delete pair.counter.labels.tenant_id; }],
    ['histogram missing label', (pair) => { delete pair.histogram.labels.server; }],
    ['counter fixed label', (pair) => { pair.counter.labels.domain = 'other'; }],
    ['histogram fixed label', (pair) => { pair.histogram.labels.operation = 'other'; }],
    ['platform scope', (pair) => {
      pair.counter.labels.metric_scope = 'platform';
      pair.histogram.labels.metric_scope = 'platform';
    }],
    ['unknown status', (pair) => {
      pair.counter.labels.status_class = 'timeout';
      pair.histogram.labels.status_class = 'timeout';
    }],
    ['empty tenant', (pair) => {
      pair.counter.labels.tenant_id = '';
      pair.histogram.labels.tenant_id = '';
    }],
    ['empty server', (pair) => {
      pair.counter.labels.server = '';
      pair.histogram.labels.server = '';
    }],
    ['empty tool', (pair) => {
      pair.counter.labels.tool_name = '';
      pair.histogram.labels.tool_name = '';
    }],
    ['empty oauth', (pair) => {
      pair.counter.labels.oauth_client = '';
      pair.histogram.labels.oauth_client = '';
    }],
    ['workspace missing id', (pair) => {
      delete pair.counter.labels.workspace_id;
      delete pair.histogram.labels.workspace_id;
    }],
    ['tenant with workspace id', (pair) => {
      pair.counter.labels.metric_scope = 'tenant';
      pair.histogram.labels.metric_scope = 'tenant';
    }],
    ['pair label mismatch', (pair) => { pair.histogram.labels.tool_name = 'different-tool'; }],
    ['NaN observation', (pair) => { pair.histogram.observedSeconds = Number.NaN; }],
    ['infinite observation', (pair) => { pair.histogram.observedSeconds = Number.POSITIVE_INFINITY; }],
    ['negative observation', (pair) => { pair.histogram.observedSeconds = -0.001; }],
    ['string observation', (pair) => { pair.histogram.observedSeconds = '0.001'; }],
  ];

  for (const [name, mutate] of invalidCases) {
    const pair = buildMcpPair();
    mutate(pair);
    assert.throws(() => registry.recordMcpToolCallPair(pair), undefined, name);
    assert.equal(mcpBlocks(registry.renderMetrics()), before, `${name} mutated MCP output`);
  }
});

test('tenant labels omit workspace and optional OAuth while workspace requires both descriptors', async () => {
  const registry = await importIsolatedExecutorRegistry();
  registry.recordMcpToolCallPair(buildMcpPair({ scope: 'tenant', includeOauthClient: false }));
  const tenantText = registry.renderMetrics();
  const tenantSamples = tenantText.split('\n').filter((line) => line.startsWith('in_falcone_'));
  assert.ok(tenantSamples.length > 0);
  assert.equal(tenantSamples.some((line) => line.includes('workspace_id=')), false);
  assert.equal(tenantSamples.some((line) => line.includes('oauth_client=')), false);

  const invalid = buildMcpPair({ scope: 'workspace' });
  delete invalid.histogram.labels.workspace_id;
  const before = mcpBlocks(registry.renderMetrics());
  assert.throws(() => registry.recordMcpToolCallPair(invalid), /workspace_id/);
  assert.equal(mcpBlocks(registry.renderMetrics()), before);
});

test('overflow during detached histogram calculation leaves the combined pair byte-for-byte intact', async () => {
  const registry = await importIsolatedExecutorRegistry();
  const pair = buildMcpPair({ seconds: Number.MAX_VALUE });
  registry.recordMcpToolCallPair(pair);
  const before = mcpBlocks(registry.renderMetrics());

  assert.throws(() => registry.recordMcpToolCallPair(pair), /sum must remain finite/);
  assert.equal(mcpBlocks(registry.renderMetrics()), before);
});

test('MCP exposes only pair mutations and publishes combined state through one final Map.set', async () => {
  const registry = await importIsolatedExecutorRegistry();
  assert.deepEqual(
    Object.keys(registry).filter((name) => name.startsWith('recordMcp')).sort(),
    ['recordMcpToolCallPair'],
  );

  const source = readFileSync(EXECUTOR_REGISTRY_URL, 'utf8');
  assert.equal((source.match(/mcpToolCallEntries\.set\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /recordMcp(?:Counter|Histogram)/);
  assert.match(source, /mcpToolCallEntries\.set\(key, nextEntry\);\n\}/);
});

test('all five legacy sample families remain byte-for-byte compatible after MCP activity', async () => {
  const registry = await importIsolatedExecutorRegistry();
  registry.recordHttp({
    method: 'GET',
    route: '/v1/c07/legacy',
    status: 200,
    tenantId: 'ten-legacy',
    durationSeconds: 0.012,
  });
  const normalizeUptime = (text) => text.split('\n')
    .filter((line) => line.startsWith('# HELP falcone_')
      || line.startsWith('# TYPE falcone_')
      || line.startsWith('falcone_'))
    .map((line) => line.replace(/^falcone_process_uptime_seconds \d+$/, 'falcone_process_uptime_seconds <uptime>'))
    .join('\n');
  const before = normalizeUptime(registry.renderMetrics());
  registry.recordMcpToolCallPair(buildMcpPair());
  const after = normalizeUptime(registry.renderMetrics());
  const sampleNames = new Set(after.split('\n')
    .filter((line) => line.startsWith('falcone_'))
    .map((line) => /^([^\s{]+)/.exec(line)?.[1]));

  assert.equal(after, before);
  assert.deepEqual([...sampleNames].sort(), [
    'falcone_http_request_duration_seconds_bucket',
    'falcone_http_request_duration_seconds_count',
    'falcone_http_request_duration_seconds_sum',
    'falcone_http_requests_total',
    'falcone_process_uptime_seconds',
  ]);
});
