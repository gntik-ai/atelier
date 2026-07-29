import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import * as controlPlaneMetrics from '../../apps/control-plane/metrics-registry.mjs';
import * as executorMetrics from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';

const OWNER = {
  sub: 'owner-a',
  tenantId: 'ten_a',
  workspaceId: null,
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: []
};

function fakePool(workspaces, queries = []) {
  return {
    async query(sql, params) {
      queries.push({ sql, params });
      const workspace = workspaces.get(params?.[0]);
      return { rows: workspace ? [workspace] : [] };
    }
  };
}

function prometheusResponse(values = [[1700000000, '1.25']]) {
  return {
    ok: true,
    async json() {
      return { status: 'success', data: { result: [{ values }] } };
    }
  };
}

function context({
  workspaceId = 'wrk_a',
  tenantId = 'ten_a',
  query = { metricKey: 'api_requests', window: '24h' },
  searchParams,
  fetchImpl = async () => prometheusResponse(),
  nowMs = () => 1700001000000,
  identity = OWNER,
  workspaces,
  metric = {}
} = {}) {
  const rows = workspaces ?? new Map([
    [workspaceId, { id: workspaceId, tenant_id: tenantId, slug: workspaceId }]
  ]);
  return {
    params: { workspaceId },
    query,
    ...(searchParams ? { searchParams } : {}),
    identity,
    pool: fakePool(rows),
    fetchImpl,
    nowMs,
    metric,
    callerContext: { tenantId: identity.tenantId }
  };
}

test('api_requests and api_errors select only their exact allowlisted workspace PromQL', async () => {
  for (const [metricKey, expected] of [
    ['api_requests', 'sum(rate(falcone_http_requests_total{tenant_id="ten_a",workspace_id="wrk_a"}[5m]))'],
    ['api_errors', 'sum(rate(falcone_http_requests_total{tenant_id="ten_a",workspace_id="wrk_a",status=~"5.."}[5m]))']
  ]) {
    let providerUrl;
    const ctx = context({
      query: { metricKey, window: '24h' },
      fetchImpl: async (url) => {
        providerUrl = url;
        return prometheusResponse();
      }
    });

    const result = await METRICS_HANDLERS.metricsWorkspaceSeries(ctx);

    assert.equal(result.statusCode, 200);
    assert.equal(providerUrl.searchParams.get('query'), expected);
    assert.deepEqual(result.body, {
      tenantId: 'ten_a',
      workspaceId: 'wrk_a',
      metricKey,
      window: '24h',
      unit: 'requests_per_second',
      points: [{ timestamp: '2023-11-14T22:13:20.000Z', value: 1.25 }]
    });
    assert.equal('source' in result.body, false);
    assert.equal(ctx.metric.workspaceId, 'wrk_a');
  }
});

test('all supported windows use one end timestamp and the exact bounded range and step', async () => {
  const expected = new Map([
    ['5m', { range: 300, step: 5 }],
    ['1h', { range: 3600, step: 15 }],
    ['24h', { range: 86400, step: 300 }],
    ['7d', { range: 604800, step: 1800 }],
    ['30d', { range: 2592000, step: 7200 }]
  ]);

  for (const [window, timing] of expected) {
    let providerUrl;
    let clockReads = 0;
    const result = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
      query: { metricKey: 'api_requests', window },
      nowMs: () => {
        clockReads += 1;
        return 1700001000999;
      },
      fetchImpl: async (url) => {
        providerUrl = url;
        return prometheusResponse([]);
      }
    }));

    assert.equal(result.statusCode, 200);
    assert.equal(clockReads, 1);
    const start = Number(providerUrl.searchParams.get('start'));
    const end = Number(providerUrl.searchParams.get('end'));
    assert.equal(end, 1700001000);
    assert.equal(end - start, timing.range);
    assert.equal(Number(providerUrl.searchParams.get('step')), timing.step);
  }
});

test('sibling workspaces remain distinct and provider results follow only their exact selector', async () => {
  const workspaces = new Map([
    ['wrk_alpha', { id: 'wrk_alpha', tenant_id: 'ten_a' }],
    ['wrk_beta', { id: 'wrk_beta', tenant_id: 'ten_a' }]
  ]);
  const queries = [];
  const fetchImpl = async (url) => {
    const promQL = url.searchParams.get('query');
    queries.push(promQL);
    return prometheusResponse([[1700000000, promQL.includes('workspace_id="wrk_alpha"') ? '11' : '22']]);
  };

  const alpha = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    workspaceId: 'wrk_alpha',
    workspaces,
    fetchImpl
  }));
  const beta = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    workspaceId: 'wrk_beta',
    workspaces,
    fetchImpl
  }));

  assert.match(queries[0], /workspace_id="wrk_alpha"/);
  assert.doesNotMatch(queries[0], /wrk_beta/);
  assert.match(queries[1], /workspace_id="wrk_beta"/);
  assert.doesNotMatch(queries[1], /wrk_alpha/);
  assert.equal(alpha.body.points[0].value, 11);
  assert.equal(beta.body.points[0].value, 22);
});

test('client scope overrides never replace the resolved control-plane workspace metric context', async () => {
  let promQL;
  const metric = {};
  const ctx = context({
    query: {
      metricKey: 'api_requests',
      window: '24h',
      tenant_id: 'ten_foreign',
      workspace_id: 'wrk_foreign',
      query: 'sum(up)'
    },
    metric,
    fetchImpl: async (url) => {
      promQL = url.searchParams.get('query');
      return prometheusResponse([]);
    }
  });
  ctx.body = { workspaceId: 'wrk_foreign', tenantId: 'ten_foreign' };
  ctx.headers = { 'x-workspace-id': 'wrk_foreign', 'x-tenant-id': 'ten_foreign' };

  const result = await METRICS_HANDLERS.metricsWorkspaceSeries(ctx);

  assert.equal(result.statusCode, 200);
  assert.equal(
    promQL,
    'sum(rate(falcone_http_requests_total{tenant_id="ten_a",workspace_id="wrk_a"}[5m]))'
  );
  assert.equal(metric.workspaceId, 'wrk_a');
  assert.doesNotMatch(promQL, /foreign|sum\(up\)/);
});

test('resolved label metacharacters are escaped as matcher data without destructive normalization', async () => {
  const tenantId = 'ten_a"\\\n';
  const workspaceId = 'wrk_a"\\\n';
  let promQL;
  const result = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    tenantId,
    workspaceId,
    identity: { ...OWNER, tenantId },
    fetchImpl: async (url) => {
      promQL = url.searchParams.get('query');
      return prometheusResponse([]);
    }
  }));

  assert.equal(result.statusCode, 200);
  assert.equal(
    promQL,
    'sum(rate(falcone_http_requests_total{tenant_id="ten_a\\"\\\\\\n",workspace_id="wrk_a\\"\\\\\\n"}[5m]))'
  );
  assert.equal(result.body.tenantId, tenantId);
  assert.equal(result.body.workspaceId, workspaceId);

  const scopeSelector = promQL.match(/\{([^}]+)\}/)?.[1];
  assert.ok(scopeSelector);
  for (const [runtime, registry] of [
    ['control-plane', controlPlaneMetrics],
    ['executor', executorMetrics]
  ]) {
    const route = `/v1/c04/label-round-trip/${runtime}`;
    registry.recordHttp({ route, status: 200, tenantId, workspaceId });
    const produced = registry.renderMetrics()
      .split('\n')
      .find((line) => line.includes(`route="${route}"`));
    assert.ok(produced);
    assert.ok(
      produced.includes(scopeSelector),
      `${runtime} producer labels must round-trip into the reader selector`
    );
  }
});

test('missing, empty, duplicate, unsupported, legacy, and PromQL-like inputs fail before fetch', async () => {
  const invalidCases = [
    { query: { window: '24h' } },
    { query: { metricKey: 'api_requests' } },
    { query: { metricKey: '', window: '24h' } },
    { query: { metricKey: 'api_requests', window: '' } },
    { query: { metricKey: 'storage_bytes', window: '7d' } },
    { query: { metricKey: 'http_requests_per_second', window: '24h' } },
    { query: { metricKey: 'sum(rate(falcone_http_requests_total[5m]))', window: '24h' } },
    { query: { metricKey: 'api_requests', window: '2h' } },
    {
      query: { metricKey: 'api_errors', window: '24h' },
      searchParams: new URLSearchParams([
        ['metricKey', 'api_requests'],
        ['metricKey', 'api_errors'],
        ['window', '24h']
      ])
    },
    {
      query: { metricKey: 'api_requests', window: '7d' },
      searchParams: new URLSearchParams([
        ['metricKey', 'api_requests'],
        ['window', '24h'],
        ['window', '7d']
      ])
    }
  ];

  for (const invalid of invalidCases) {
    let fetches = 0;
    const metric = { tenantId: 'ten_token_context', workspaceId: '' };
    const invalidContext = context({
      ...invalid,
      metric,
      fetchImpl: async () => {
        fetches += 1;
        return prometheusResponse();
      }
    });
    const result = await METRICS_HANDLERS.metricsWorkspaceSeries(invalidContext);
    assert.equal(result.statusCode, 400, JSON.stringify(invalid.query));
    assert.deepEqual(result.body, {
      code: 'INVALID_METRIC_SERIES_QUERY',
      message: 'metricKey and window must each be supplied exactly once using a supported value'
    });
    assert.equal(fetches, 0);
    assert.deepEqual(metric, { tenantId: 'ten_a', workspaceId: 'wrk_a' });
  }
});

test('provider failures and malformed or unusable payloads return one scoped empty schema', async () => {
  const cases = [
    async () => {
      throw new Error('unreachable provider detail');
    },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, async json() { throw new SyntaxError('invalid JSON'); } }),
    async () => ({ ok: true, async json() { return { status: 'error', error: 'provider detail' }; } }),
    async () => ({ ok: true, async json() { return { status: 'success', data: {} }; } }),
    async () => prometheusResponse([
      ['not-a-time', '1'],
      [1700000000, 'NaN'],
      [1700000001, 'Infinity']
    ])
  ];
  const expected = {
    tenantId: 'ten_a',
    workspaceId: 'wrk_a',
    metricKey: 'api_requests',
    window: '24h',
    unit: 'requests_per_second',
    points: []
  };

  for (const fetchImpl of cases) {
    const result = await METRICS_HANDLERS.metricsWorkspaceSeries(context({ fetchImpl }));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, expected);
    assert.deepEqual(Object.keys(result.body).sort(), Object.keys(expected).sort());
  }
});

test('usable samples preserve provider order and discard invalid samples without fabrication', async () => {
  const result = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    fetchImpl: async () => prometheusResponse([
      [1700000002, '2.5'],
      ['invalid', '4'],
      [null, '5'],
      [1700000000, ''],
      [true, '6'],
      [1700000001, '-1']
    ])
  }));

  assert.deepEqual(result.body.points, [
    { timestamp: '2023-11-14T22:13:22.000Z', value: 2.5 },
    { timestamp: '2023-11-14T22:13:21.000Z', value: -1 }
  ]);
});

test('foreign and unknown workspaces preserve distinct denial/lookup outcomes and never contact Prometheus', async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return prometheusResponse();
  };
  const foreign = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    identity: { ...OWNER, tenantId: 'ten_b' },
    fetchImpl
  }));
  const unknown = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    workspaceId: 'wrk_unknown',
    workspaces: new Map(),
    fetchImpl
  }));

  assert.equal(foreign.statusCode, 403);
  assert.deepEqual(foreign.body, { code: 'FORBIDDEN', message: 'cannot read another tenant’s metrics' });
  assert.equal(unknown.statusCode, 404);
  assert.equal('tenantId' in unknown.body, false);
  assert.equal('points' in unknown.body, false);
  assert.equal(fetches, 0);
});

test('privileged reads attribute the request metric to the resolved owner, not token tenant context', async () => {
  const metric = { tenantId: 'ten_platform_context', workspaceId: '' };
  const result = await METRICS_HANDLERS.metricsWorkspaceSeries(context({
    identity: {
      sub: 'platform-admin',
      tenantId: 'ten_platform_context',
      actorType: 'superadmin',
      roles: ['superadmin']
    },
    metric
  }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(metric, { tenantId: 'ten_a', workspaceId: 'wrk_a' });
});

test('workspace series GET performs only canonical lookup plus provider read and emits no domain audit write', async () => {
  const queries = [];
  const ctx = context();
  ctx.pool = fakePool(new Map([
    ['wrk_a', { id: 'wrk_a', tenant_id: 'ten_a' }]
  ]), queries);

  const result = await METRICS_HANDLERS.metricsWorkspaceSeries(ctx);

  assert.equal(result.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^SELECT id, tenant_id,/);
  assert.doesNotMatch(queries[0].sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});
