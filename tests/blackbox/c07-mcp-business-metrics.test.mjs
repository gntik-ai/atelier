import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

import { createMcpEngine } from '../../apps/control-plane-executor/src/runtime/mcp-engine.mjs';
import { createControlPlaneServer as createControlPlaneHttpServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { deriveIdentityFromClaims } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const API_VERSION = '2026-03-26';
const TENANT_A = 'bbx-c07-tenant-a';
const TENANT_B = 'bbx-c07-tenant-b';
const WORKSPACE_A = 'bbx-c07-workspace-a';
const WORKSPACE_B = 'bbx-c07-workspace-b';
const SUCCESS_CLIENT = 'oauth\\client"escaped';
const ERROR_CLIENT = 'bbx-c07-oauth-error';
const DENIED_CLIENT = 'bbx-c07-oauth-denied';
const FOREIGN_CLIENT = 'bbx-c07-oauth-foreign';
const BASE_SCOPE = 'mcp:invoke';
const FORGED_TENANT = 'bbx-c07-forged-tenant';
const FORGED_WORKSPACE = 'bbx-c07-forged-workspace';
const UNKNOWN_TOOL = 'bbx-c07-unknown-tool-do-not-export';
const RAW_ARGUMENT = 'bbx-c07-raw-argument-do-not-export';
const BACKEND_ERROR = 'bbx-c07-backend-error-do-not-export';

const COUNTER = 'in_falcone_mcp_tool_invocations_total';
const HISTOGRAM = 'in_falcone_component_operation_duration_seconds';
const BUCKETS = ['0.005', '0.01', '0.025', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '10', '+Inf'];
const LEGACY_SAMPLES = [
  'falcone_http_request_duration_seconds_bucket',
  'falcone_http_request_duration_seconds_count',
  'falcone_http_request_duration_seconds_sum',
  'falcone_http_requests_total',
  'falcone_process_uptime_seconds',
];
const COUNTER_LABEL_KEYS = [
  'collection_mode', 'domain', 'environment', 'feature_area', 'metric_scope', 'metric_type',
  'oauth_client', 'operation_family', 'server', 'status_class', 'subsystem', 'tenant_id',
  'tool_name', 'workspace_id',
];
const HISTOGRAM_LABEL_KEYS = [
  'collection_mode', 'environment', 'metric_scope', 'oauth_client', 'operation', 'server',
  'status_class', 'subsystem', 'tenant_id', 'tool_name', 'workspace_id',
];
const FORBIDDEN_LABEL_KEYS = new Set([
  'api_key_id', 'authorization_header', 'email', 'object_key', 'raw_path', 'raw_query',
  'request_id', 'session_id', 'tenant_slug', 'user_id', 'workspace_slug',
]);

let fixture;

function decodeLabelValue(value) {
  let decoded = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '\\') {
      decoded += value[i];
      continue;
    }
    i += 1;
    if (i >= value.length) throw new Error('unterminated Prometheus label escape');
    decoded += value[i] === 'n' ? '\n' : value[i];
  }
  return decoded;
}

function parseLabels(raw = '') {
  if (!raw) return {};
  const labels = {};
  let offset = 0;
  const part = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"(?:,|$)/y;
  while (offset < raw.length) {
    part.lastIndex = offset;
    const match = part.exec(raw);
    if (!match) throw new Error(`malformed Prometheus label set near: ${raw.slice(offset)}`);
    if (Object.hasOwn(labels, match[1])) throw new Error(`duplicate Prometheus label: ${match[1]}`);
    labels[match[1]] = decodeLabelValue(match[2]);
    offset = part.lastIndex;
  }
  return labels;
}

function parsePrometheus(document) {
  assert.ok(document.endsWith('\n'), 'Prometheus exposition must end with a newline');
  const samples = [];
  for (const line of document.split('\n')) {
    if (!line || line.startsWith('# ')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)$/.exec(line);
    assert.ok(match, `malformed Prometheus sample: ${line}`);
    const value = Number(match[3]);
    assert.ok(Number.isFinite(value), `Prometheus sample must be finite: ${line}`);
    samples.push({ name: match[1], labels: parseLabels(match[2]), value, line });
  }
  return samples;
}

function metadataCount(document, kind, family, metricType) {
  const expected = kind === 'HELP'
    ? `# HELP ${family} `
    : `# TYPE ${family} ${metricType}`;
  return document.split('\n').filter((line) => (
    kind === 'HELP' ? line.startsWith(expected) : line === expected
  )).length;
}

function mcpSamples(document) {
  return parsePrometheus(document).filter(({ name }) => name.startsWith('in_falcone_'));
}

function legacySampleNames(document) {
  return [...new Set(parsePrometheus(document)
    .map(({ name }) => name)
    .filter((name) => name.startsWith('falcone_')))].sort();
}

function hasLabels(sample, expected) {
  return Object.entries(expected).every(([key, value]) => sample.labels[key] === value);
}

function onlySample(document, name, expectedLabels) {
  const matches = parsePrometheus(document).filter((sample) => (
    sample.name === name && hasLabels(sample, expectedLabels)
  ));
  assert.equal(matches.length, 1, `expected one ${name} sample for ${JSON.stringify(expectedLabels)}`);
  return matches[0];
}

function counterLabels({ serverId, toolName, oauthClient, statusClass }) {
  return {
    collection_mode: 'push',
    domain: 'mcp_tool_usage',
    feature_area: 'mcp',
    metric_scope: 'workspace',
    metric_type: 'usage',
    oauth_client: oauthClient,
    operation_family: 'execute',
    server: serverId,
    status_class: statusClass,
    subsystem: 'mcp',
    tenant_id: TENANT_A,
    tool_name: toolName,
    workspace_id: WORKSPACE_A,
  };
}

function histogramLabels({ serverId, toolName, oauthClient, statusClass }) {
  return {
    collection_mode: 'push',
    metric_scope: 'workspace',
    oauth_client: oauthClient,
    operation: 'tool_call',
    server: serverId,
    status_class: statusClass,
    subsystem: 'mcp',
    tenant_id: TENANT_A,
    tool_name: toolName,
    workspace_id: WORKSPACE_A,
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
}

async function startPublicFixture() {
  const verifiedClaimFixtures = new Map([
    ['tenant-a-success-token', {
      tenant_id: TENANT_A, workspace_id: WORKSPACE_A, workspace_ids: [WORKSPACE_A],
      sub: SUCCESS_CLIENT, azp: SUCCESS_CLIENT,
      realm_access: { roles: ['tenant_admin'] }, scope: BASE_SCOPE,
    }],
    ['tenant-a-error-token', {
      tenant_id: TENANT_A, workspace_id: WORKSPACE_A, workspace_ids: [WORKSPACE_A],
      sub: ERROR_CLIENT, azp: ERROR_CLIENT,
      realm_access: { roles: ['tenant_admin'] }, scope: BASE_SCOPE,
    }],
    ['tenant-a-denied-token', {
      tenant_id: TENANT_A, workspace_id: WORKSPACE_A, workspace_ids: [WORKSPACE_A],
      sub: DENIED_CLIENT, azp: DENIED_CLIENT,
      realm_access: { roles: ['tenant_admin'] }, scope: BASE_SCOPE,
    }],
    ['tenant-b-token', {
      tenant_id: TENANT_B, workspace_id: WORKSPACE_B, workspace_ids: [WORKSPACE_B],
      sub: FOREIGN_CLIENT, azp: FOREIGN_CLIENT,
      realm_access: { roles: ['tenant_admin'] }, scope: BASE_SCOPE,
    }],
  ]);
  const jwtVerifier = {
    async verify(token) {
      const claims = verifiedClaimFixtures.get(token);
      return claims ? deriveIdentityFromClaims(structuredClone(claims)) : undefined;
    },
  };
  let clockMs = 1_000;
  const mcpEngine = createMcpEngine({
    runtimeImageDigest: `sha256:${'c'.repeat(64)}`,
    metricsEnvironment: 'test',
    clock: () => {
      clockMs += 5;
      return clockMs;
    },
    fetchImpl: async (_url, init) => {
      if (init?.headers?.['x-auth-subject'] === ERROR_CLIENT) throw new Error(BACKEND_ERROR);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const server = createControlPlaneHttpServer({
    registry: {},
    mcpEngine,
    jwtVerifier,
    logger: { error() {} },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(path, {
    method = 'GET', token = 'tenant-a-success-token', body, hints = false, expectedStatus,
  } = {}) {
    const headers = {
      authorization: `Bearer ${token}`,
      'x-api-version': API_VERSION,
      'x-correlation-id': randomUUID(),
    };
    if (hints) {
      headers['x-tenant-id'] = FORGED_TENANT;
      headers['x-workspace-id'] = FORGED_WORKSPACE;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = randomUUID();
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed = null;
    if (text) parsed = JSON.parse(text);
    if (expectedStatus !== undefined) {
      assert.equal(response.status, expectedStatus, `${method} ${path}: ${text}`);
    }
    return { status: response.status, body: parsed, text };
  }

  async function scrape() {
    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();
    assert.equal(response.status, 200);
    return { contentType: response.headers.get('content-type'), text };
  }

  async function publishOfficialServer(name) {
    const root = `/v1/mcp/workspaces/${WORKSPACE_A}/servers`;
    const created = await request(root, {
      method: 'POST',
      body: { name, source: 'official', tenantId: FORGED_TENANT, workspaceId: FORGED_WORKSPACE },
      hints: true,
      expectedStatus: 201,
    });
    const serverId = created.body.serverId;
    await request(`${root}/${serverId}/curations`, { method: 'POST', body: {}, expectedStatus: 200 });
    await request(`${root}/${serverId}/versions`, {
      method: 'POST', body: { version: 'v1' }, expectedStatus: 201,
    });
    const detail = await request(`${root}/${serverId}`, { expectedStatus: 200 });
    return { root, serverId, detail: detail.body };
  }

  try {
    const initial = await scrape();
    const primary = await publishOfficialServer('bbx-c07-primary');
    const foreignOnly = await publishOfficialServer('bbx-c07-foreign-only');
    const readTool = primary.detail.tools.find((tool) => !tool.mutates);
    const deniedTool = primary.detail.tools.find((tool) => tool.mutates && tool.scope);
    assert.ok(readTool, 'public server detail must expose a canonical read tool');
    assert.ok(deniedTool, 'public server detail must expose a scoped canonical mutating tool');
    const idle = await scrape();

    const successBody = {
      name: readTool.name,
      arguments: {
        tenantId: FORGED_TENANT,
        workspaceId: FORGED_WORKSPACE,
        raw: RAW_ARGUMENT,
      },
    };
    const management = await request(`${primary.root}/${primary.serverId}/tool-calls`, {
      method: 'POST', body: successBody, hints: true, expectedStatus: 200,
    });
    const afterManagement = await scrape();

    const jsonRpc = await request(`${primary.root}/${primary.serverId}/rpc`, {
      method: 'POST',
      body: {
        jsonrpc: '2.0', id: 'bbx-c07-rpc', method: 'tools/call',
        params: { name: readTool.name, arguments: successBody.arguments },
      },
      hints: true,
      expectedStatus: 200,
    });
    const afterJsonRpc = await scrape();

    const error = await request(`${primary.root}/${primary.serverId}/tool-calls`, {
      method: 'POST', token: 'tenant-a-error-token', body: successBody, expectedStatus: 200,
    });
    const denied = await request(`${primary.root}/${primary.serverId}/tool-calls`, {
      method: 'POST',
      token: 'tenant-a-denied-token',
      body: { name: deniedTool.name, arguments: { raw: RAW_ARGUMENT } },
      expectedStatus: 200,
    });
    const afterOutcomes = await scrape();

    const unknown = await request(`${primary.root}/${primary.serverId}/tool-calls`, {
      method: 'POST',
      body: { name: UNKNOWN_TOOL, arguments: { tenantId: FORGED_TENANT, raw: RAW_ARGUMENT } },
      hints: true,
      expectedStatus: 200,
    });
    const foreign = await request(
      `/v1/mcp/workspaces/${WORKSPACE_B}/servers/${foreignOnly.serverId}/tool-calls`,
      {
        method: 'POST',
        token: 'tenant-b-token',
        body: {
          name: readTool.name,
          arguments: { tenantId: TENANT_A, workspaceId: WORKSPACE_A, raw: RAW_ARGUMENT },
        },
        hints: true,
        expectedStatus: 404,
      },
    );
    const afterRejected = await scrape();

    return {
      server,
      initial,
      idle,
      primary,
      foreignOnly,
      readTool,
      deniedTool,
      management,
      jsonRpc,
      error,
      denied,
      unknown,
      foreign,
      afterManagement,
      afterJsonRpc,
      afterOutcomes,
      afterRejected,
    };
  } catch (error) {
    await closeServer(server);
    throw error;
  }
}

before(async () => {
  fixture = await startPublicFixture();
});

after(async () => {
  await closeServer(fixture?.server);
});

// bbx-c07-001 | fn-observability-metrics-exposition
// OpenSpec #### Scenario: MCP is enabled but idle
// OpenSpec #### Scenario: Scrape occurs before MCP activity
test('[bbx-c07-001] idle executor exports no synthetic MCP samples and preserves legacy output', () => {
  assert.deepEqual(mcpSamples(fixture.initial.text), []);
  assert.deepEqual(mcpSamples(fixture.idle.text), []);
  assert.equal(fixture.idle.contentType, 'text/plain; version=0.0.4; charset=utf-8');
  assert.deepEqual(legacySampleNames(fixture.idle.text), LEGACY_SAMPLES);
});

// bbx-c07-002 | fn-observability-metrics-exposition
// OpenSpec #### Scenario: Successful MCP tool invocation
// OpenSpec #### Scenario: Management operation completes once
// OpenSpec #### Scenario: Verified workspace invocation is attributed
test('[bbx-c07-002] one management tool-call records one verified success pair', () => {
  assert.equal(fixture.management.body.result?.isError, undefined);
  const expectedCounter = counterLabels({
    serverId: fixture.primary.serverId,
    toolName: fixture.readTool.name,
    oauthClient: SUCCESS_CLIENT,
    statusClass: 'success',
  });
  const expectedHistogram = histogramLabels({
    serverId: fixture.primary.serverId,
    toolName: fixture.readTool.name,
    oauthClient: SUCCESS_CLIENT,
    statusClass: 'success',
  });
  const counter = onlySample(fixture.afterManagement.text, COUNTER, expectedCounter);
  const count = onlySample(fixture.afterManagement.text, `${HISTOGRAM}_count`, expectedHistogram);
  assert.equal(counter.value, 1);
  assert.equal(count.value, 1);
  assert.equal(counter.labels.environment, 'test');
  assert.equal(count.labels.environment, counter.labels.environment);
  assert.deepEqual(Object.keys(counter.labels).sort(), COUNTER_LABEL_KEYS);
  assert.deepEqual(Object.keys(count.labels).sort(), HISTOGRAM_LABEL_KEYS);
  assert.equal(fixture.afterManagement.text.includes(FORGED_TENANT), false);
  assert.equal(fixture.afterManagement.text.includes(FORGED_WORKSPACE), false);
  assert.equal(fixture.afterManagement.text.includes(RAW_ARGUMENT), false);
});

// bbx-c07-003 | fn-observability-metrics-exposition
// OpenSpec #### Scenario: JSON-RPC tools/call completes once
// OpenSpec #### Scenario: Multiple invocations remain monotonic within one process
test('[bbx-c07-003] JSON-RPC delegates to the shared seam without transport double counting', () => {
  assert.equal(fixture.jsonRpc.body.jsonrpc, '2.0');
  assert.equal(fixture.jsonRpc.body.result?.isError, false);
  const expectedCounter = counterLabels({
    serverId: fixture.primary.serverId,
    toolName: fixture.readTool.name,
    oauthClient: SUCCESS_CLIENT,
    statusClass: 'success',
  });
  const expectedHistogram = histogramLabels({
    serverId: fixture.primary.serverId,
    toolName: fixture.readTool.name,
    oauthClient: SUCCESS_CLIENT,
    statusClass: 'success',
  });
  assert.equal(onlySample(fixture.afterJsonRpc.text, COUNTER, expectedCounter).value, 2);
  assert.equal(onlySample(fixture.afterJsonRpc.text, `${HISTOGRAM}_count`, expectedHistogram).value, 2);
});

// bbx-c07-004 | fn-observability-metrics-exposition
// OpenSpec #### Scenario: Known tool completes with an error
// OpenSpec #### Scenario: Known tool returns an observable denial
test('[bbx-c07-004] known-tool error and observable denial each record one pair', () => {
  assert.equal(fixture.error.body.result?.isError, true);
  assert.equal(fixture.denied.body.result?.isError, true);
  for (const expected of [
    { oauthClient: ERROR_CLIENT, toolName: fixture.readTool.name, statusClass: 'error' },
    { oauthClient: DENIED_CLIENT, toolName: fixture.deniedTool.name, statusClass: 'denied' },
  ]) {
    const tuple = { serverId: fixture.primary.serverId, ...expected };
    assert.equal(onlySample(fixture.afterOutcomes.text, COUNTER, counterLabels(tuple)).value, 1);
    assert.equal(onlySample(fixture.afterOutcomes.text, `${HISTOGRAM}_count`, histogramLabels(tuple)).value, 1);
  }
  assert.equal(fixture.afterOutcomes.text.includes(BACKEND_ERROR), false);
  assert.equal(fixture.afterOutcomes.text.includes(RAW_ARGUMENT), false);
  assert.equal(fixture.afterOutcomes.text.includes('missing required scope'), false);
});

// bbx-c07-005 | fn-observability-metrics-exposition
// OpenSpec #### Scenario: Request fails before canonical invocation attribution
// OpenSpec #### Scenario: Unknown tool-name flood is attempted
// OpenSpec #### Scenario: Caller attempts cross-tenant attribution
test('[bbx-c07-005] unknown and foreign calls cannot create or steer MCP series', () => {
  assert.equal(fixture.unknown.body.result?.isError, true);
  assert.equal(fixture.foreign.body.code, 'GW_MCP_SERVER_NOT_FOUND');
  const before = mcpSamples(fixture.afterOutcomes.text);
  const after = mcpSamples(fixture.afterRejected.text);
  assert.deepEqual(after, before, 'pre-attribution rejections must not mutate MCP metrics');
  const mcpText = after.map(({ line }) => line).join('\n');
  for (const forbidden of [
    UNKNOWN_TOOL, fixture.foreignOnly.serverId, TENANT_B, WORKSPACE_B, FOREIGN_CLIENT,
    FORGED_TENANT, FORGED_WORKSPACE, RAW_ARGUMENT,
  ]) {
    assert.equal(mcpText.includes(forbidden), false, `${forbidden} leaked into MCP metrics`);
  }
});

// bbx-c07-006 | fn-observability-metrics-exposition
// OpenSpec #### Scenario: Counter family is rendered
// OpenSpec #### Scenario: Histogram family is rendered
// OpenSpec #### Scenario: Label contains exposition metacharacters
// OpenSpec #### Scenario: Combined document is parsed
// OpenSpec #### Scenario: New and legacy families share the existing endpoint
test('[bbx-c07-006] populated scrape is valid deterministic Prometheus exposition', () => {
  const document = fixture.afterOutcomes.text;
  const samples = parsePrometheus(document);
  assert.equal(fixture.afterOutcomes.contentType, 'text/plain; version=0.0.4; charset=utf-8');
  assert.equal(metadataCount(document, 'HELP', COUNTER), 1);
  assert.equal(metadataCount(document, 'TYPE', COUNTER, 'counter'), 1);
  assert.equal(metadataCount(document, 'HELP', HISTOGRAM), 1);
  assert.equal(metadataCount(document, 'TYPE', HISTOGRAM, 'histogram'), 1);

  const unexpectedFamilies = mcpSamples(document)
    .filter(({ name }) => name !== COUNTER && !name.startsWith(`${HISTOGRAM}_`));
  assert.deepEqual(unexpectedFamilies, []);
  assert.deepEqual(legacySampleNames(document), LEGACY_SAMPLES);

  const expected = histogramLabels({
    serverId: fixture.primary.serverId,
    toolName: fixture.readTool.name,
    oauthClient: SUCCESS_CLIENT,
    statusClass: 'success',
  });
  const buckets = samples.filter(({ name, labels }) => (
    name === `${HISTOGRAM}_bucket` && hasLabels({ labels }, expected)
  ));
  assert.deepEqual(buckets.map(({ labels }) => labels.le), BUCKETS);
  assert.equal(buckets.length, BUCKETS.length);
  for (let i = 1; i < buckets.length; i += 1) {
    assert.ok(buckets[i].value >= buckets[i - 1].value, 'histogram buckets must be cumulative');
  }
  const sum = onlySample(document, `${HISTOGRAM}_sum`, expected);
  const count = onlySample(document, `${HISTOGRAM}_count`, expected);
  assert.ok(sum.value >= 0);
  assert.ok(Number.isInteger(count.value));
  assert.equal(buckets.at(-1).value, count.value);
  assert.equal(count.labels.oauth_client, SUCCESS_CLIENT, 'escaped label must round-trip as one value');

  for (const sample of mcpSamples(document)) {
    for (const key of Object.keys(sample.labels)) {
      assert.equal(FORBIDDEN_LABEL_KEYS.has(key), false, `forbidden label key ${key}`);
    }
  }
});
