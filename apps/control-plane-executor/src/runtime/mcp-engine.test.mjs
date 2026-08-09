// Unit tests for the MCP control-plane engine (change: add-mcp-control-plane-runtime).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpEngine } from './mcp-engine.mjs';
import { BASE_SCOPE } from '../mcp-official-catalog.mjs';

const A = { tenantId: 'ten-a', workspaceId: 'ws-a', actorId: 'actor-a', roleName: 'falcone_app', scopes: [BASE_SCOPE] };
const B = { tenantId: 'ten-b', workspaceId: 'ws-b', actorId: 'actor-b', roleName: 'falcone_app', scopes: [BASE_SCOPE] };
const TEST_DIGEST = `sha256:${'b'.repeat(64)}`;

// A fake runtime self-call so tool-calls don't need a live HTTP server.
function fakeFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, async json() { return { rows: [], ok: true, url }; } };
  };
  impl.calls = calls;
  return impl;
}

function scriptedFetch({ status = 200, body = { ok: true }, error, jsonError } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (error) throw error;
    return {
      status,
      async json() {
        if (jsonError) throw jsonError;
        return body;
      },
    };
  };
  impl.calls = calls;
  return impl;
}

function engine() {
  return createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST });
}

function fakeStateStore(initialState = null) {
  let state = initialState ? structuredClone(initialState) : null;
  let saves = 0;
  return {
    get saves() { return saves; },
    async ensureSchema() {},
    async loadState() { return state ? structuredClone(state) : null; },
    async saveState(next) {
      state = structuredClone(next);
      saves += 1;
    },
  };
}

function seededPublishedState({
  tenantId = A.tenantId,
  workspaceId = A.workspaceId,
  serverId = 'srv-seeded',
  tool,
} = {}) {
  return {
    registry: {
      servers: {
        [`${tenantId}::${serverId}`]: {
          tenantId,
          serverId,
          activeVersion: 'v1',
          versions: [{ version: 'v1', active: true, tools: [tool] }],
        },
      },
    },
    servers: [{ serverId, name: serverId, source: 'instant', tenantId, workspaceId, draft: null, curated: null }],
    auditLog: [],
    rateWindows: [],
  };
}

async function publishServer(e, {
  identity = A,
  workspaceId = identity.workspaceId,
  name = 'telemetry-fixture',
  source = 'instant',
  resources,
} = {}) {
  const created = await e.executeMcp({
    operation: 'create_server',
    identity,
    workspaceId,
    body: { name, source, ...(resources === undefined ? {} : { resources }) },
  });
  await e.executeMcp({
    operation: 'publish_version',
    identity,
    workspaceId,
    serverId: created.serverId,
    version: 'v1',
    body: { version: 'v1' },
  });
  const view = await e.executeMcp({ operation: 'get_server', identity, workspaceId, serverId: created.serverId });
  return { serverId: created.serverId, view };
}

function transactionalStateStore() {
  let state = null;
  let saves = 0;
  let tail = Promise.resolve();
  const clone = (value) => value ? structuredClone(value) : null;
  return {
    get saves() { return saves; },
    async ensureSchema() {},
    async loadState() { return clone(state); },
    async saveState(next) {
      state = clone(next);
      saves += 1;
    },
    async withStateTransaction(mutator) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        const outcome = await mutator(clone(state) ?? {});
        state = clone(outcome.state);
        saves += 1;
        return outcome.result;
      } finally {
        release();
      }
    },
  };
}

test('full loop: create (instant) → curate → publish → get (endpoint+tools+version) → call → audit', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'Acme', source: 'instant' } });
  assert.equal(created.status, 'draft');
  const sid = created.serverId;
  assert.ok(sid);

  await e.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { decisions: {} } });
  const pub = await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  assert.equal(pub.requiresReview, false);
  assert.equal(pub.activeVersion, 'v1');

  const view = await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.equal(view.status, 'published');
  assert.equal(view.version, 'v1');
  assert.ok(view.endpoint.includes(sid));
  assert.ok(view.tools.length > 0);

  const readTool = view.tools.find((t) => !t.mutates);
  assert.ok(readTool, 'expected a read tool in the published manifest');
  const call = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: readTool.name, arguments: { workspaceId: A.workspaceId } } });
  assert.ok(Array.isArray(call.content));

  const audit = await e.executeMcp({ operation: 'list_audit', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.ok(audit.items.length >= 1);
  for (const ev of audit.items) assert.equal(ev.scope.tenant_id, 'ten-a');
});

test('cross-tenant: B cannot get / call / audit A\'s server (404)', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'A-srv', source: 'instant' } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });

  await assert.rejects(() => e.executeMcp({ operation: 'get_server', identity: B, workspaceId: B.workspaceId, serverId: sid }), (err) => err.statusCode === 404);
  await assert.rejects(() => e.executeMcp({ operation: 'call_tool', identity: B, workspaceId: B.workspaceId, serverId: sid, body: { name: 'x' } }), (err) => err.statusCode === 404);
  await assert.rejects(() => e.executeMcp({ operation: 'list_audit', identity: B, workspaceId: B.workspaceId, serverId: sid }), (err) => err.statusCode === 404);

  // A's server never appears in B's list.
  const bList = await e.executeMcp({ operation: 'list_servers', identity: B, workspaceId: B.workspaceId });
  assert.equal(bList.items.some((s) => s.serverId === sid), false);
});

test('version pinning: a tool-description change is held for review, then served after approval', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'Pinned', source: 'official' } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });

  // v2 changes a tool description via a real curation decision → requiresReview, NOT served.
  const firstTool = (await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid })).tools[0].name;
  const pub2 = await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v2', body: { version: 'v2', curation: { decisions: { [firstTool]: { description: 'CHANGED for v2' } } } } });
  assert.equal(pub2.requiresReview, true);
  assert.equal(pub2.activeVersion, 'v1'); // still serving v1

  // approve → v2 serves.
  const approved = await e.executeMcp({ operation: 'approve_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v2' });
  assert.equal(approved.activeVersion, 'v2');
});

test('quota: server-count limit is enforced (429 QUOTA_EXCEEDED with dimension)', async () => {
  const e = createMcpEngine({ fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST, plan: { maxServersPerTenant: 1, maxToolsPerServer: 50, toolCallsPerMinutePerServer: 600, toolCallsPerMinutePerOAuthClient: 300, mode: 'enforced' } });
  await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'one', source: 'instant' } });
  await assert.rejects(
    () => e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'two', source: 'instant' } }),
    (err) => err.statusCode === 429 && err.code === 'QUOTA_EXCEEDED' && err.dimension === 'servers_per_tenant',
  );
});

test('delete removes the server (subsequent get → 404)', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'tmp', source: 'instant' } });
  const sid = created.serverId;
  const del = await e.executeMcp({ operation: 'delete_server', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.equal(del.deleted, true);
  await assert.rejects(() => e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid }), (err) => err.statusCode === 404);
});

test('durable store: a published MCP server survives engine restart', async () => {
  const store = fakeStateStore();
  const e1 = createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST, store });
  const created = await e1.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'durable', source: 'instant' } });
  const sid = created.serverId;
  await e1.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { decisions: {} } });
  await e1.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  assert.ok(store.saves >= 3);

  const e2 = createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST, store });
  const view = await e2.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.equal(view.status, 'published');
  assert.equal(view.activeVersion, 'v1');
  assert.ok(view.tools.length > 0);
});

test('durable store: stale replica writes preserve another replica server', async () => {
  const store = transactionalStateStore();
  const stale = createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST, store });
  const peer = createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST, store });

  // Simulate a replica that has already loaded an empty snapshot before a peer writes.
  const initiallyEmpty = await stale.executeMcp({ operation: 'list_servers', identity: A, workspaceId: A.workspaceId });
  assert.deepEqual(initiallyEmpty.items, []);

  const peerServer = await peer.executeMcp({ operation: 'create_server', identity: B, workspaceId: B.workspaceId, body: { name: 'peer', source: 'instant' } });
  const staleServer = await stale.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'stale', source: 'instant' } });

  const verifier = createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST, store });
  const aList = await verifier.executeMcp({ operation: 'list_servers', identity: A, workspaceId: A.workspaceId });
  const bList = await verifier.executeMcp({ operation: 'list_servers', identity: B, workspaceId: B.workspaceId });
  assert.equal(aList.items.some((s) => s.serverId === staleServer.serverId), true);
  assert.equal(bList.items.some((s) => s.serverId === peerServer.serverId), true);
  assert.ok(store.saves >= 2);
});

test('hosted JSON-RPC refuses mutating official tools without caller write scope and does not fetch', async () => {
  const fetchImpl = fakeFetch();
  const e = createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl, runtimeImageDigest: TEST_DIGEST });
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'official', source: 'official' } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });

  const before = fetchImpl.calls.length;
  const out = await e.executeMcpRpc({
    identity: { ...A, scopes: [BASE_SCOPE] },
    workspaceId: A.workspaceId,
    serverId: sid,
    message: {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'create_workspace', arguments: { slug: 'blocked' } },
    },
  });

  assert.equal(out.id, 42);
  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /mcp:falcone:workspaces:write/);
  assert.equal(fetchImpl.calls.length, before, 'missing write scope must not issue the upstream POST');
});

test('C07: management call submits one canonical counter/histogram pair and keeps metadata internal', async () => {
  const fetchImpl = scriptedFetch({ body: { error: 'denied-looking result text is still a 2xx success' } });
  const submissions = [];
  let now = 1_000;
  const identity = { ...A, actorId: 'generic-human-subject', verifiedOAuthClientId: 'oauth-client-verified' };
  const e = createMcpEngine({
    selfBaseUrl: 'http://cp.local',
    gatewayBaseUrl: 'https://gw.local',
    fetchImpl,
    runtimeImageDigest: TEST_DIGEST,
    metricsSink: (pair) => submissions.push(pair),
    clock: () => { now += 10; return now; },
  });
  const { serverId, view } = await publishServer(e, { identity });
  const toolName = view.tools.find((tool) => !tool.mutates).name;

  const out = await e.executeMcp({
    operation: 'call_tool',
    identity,
    workspaceId: 'caller-workspace-hint',
    serverId,
    body: { name: toolName, arguments: { tenantId: 'ten-evil', workspaceId: 'ws-evil', secret: 'do-not-label' } },
  });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(submissions.length, 1);
  assert.deepEqual(Object.keys(submissions[0]).sort(), ['counter', 'histogram']);
  const { counter, histogram } = submissions[0];
  assert.equal(counter.name, 'in_falcone_mcp_tool_invocations_total');
  assert.equal(counter.kind, 'counter');
  assert.equal(histogram.name, 'in_falcone_component_operation_duration_seconds');
  assert.equal(histogram.kind, 'histogram');
  for (const labels of [counter.labels, histogram.labels]) {
    assert.equal(labels.tenant_id, A.tenantId);
    assert.equal(labels.workspace_id, A.workspaceId);
    assert.equal(labels.server, serverId);
    assert.equal(labels.tool_name, toolName);
    assert.equal(labels.oauth_client, 'oauth-client-verified');
    assert.equal(labels.status_class, 'success');
    assert.equal(labels.metric_scope, 'workspace');
    assert.equal(Object.values(labels).includes('ten-evil'), false);
    assert.equal(Object.values(labels).includes('ws-evil'), false);
    assert.equal(Object.values(labels).includes('do-not-label'), false);
  }
  assert.equal(histogram.observedSeconds, 0.01);
  assert.equal(out.result.status, 200);
  assert.equal('outcomeClass' in out, false);
  assert.equal('canonicalToolName' in out, false);
  assert.equal('outcomeClass' in out.result, false);
  assert.equal('canonicalToolName' in out.result, false);
});

test('C07: JSON-RPC tools/call converges on the same seam and submits exactly once', async () => {
  const fetchImpl = scriptedFetch();
  const submissions = [];
  const e = createMcpEngine({
    selfBaseUrl: 'http://cp.local',
    fetchImpl,
    runtimeImageDigest: TEST_DIGEST,
    metricsSink: (pair) => submissions.push(pair),
  });
  const { serverId, view } = await publishServer(e);
  const toolName = view.tools.find((tool) => !tool.mutates).name;

  const out = await e.executeMcpRpc({
    identity: { ...A, oauthClientId: 'unverified-client-id' },
    workspaceId: A.workspaceId,
    serverId,
    message: { jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: toolName, arguments: {} } },
  });

  assert.equal(out.id, 77);
  assert.equal(out.result.isError, false);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(submissions.length, 1, 'JSON-RPC wrapper must not submit a second pair');
  assert.equal('oauth_client' in submissions[0].counter.labels, false, 'unverified client and generic actorId are omitted');
  assert.equal('oauth_client' in submissions[0].histogram.labels, false);
});

test('C07 outcomes: missing BASE_SCOPE and missing declared mutating scope are denied without fetch', async () => {
  {
    const fetchImpl = scriptedFetch();
    const submissions = [];
    const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, metricsSink: (pair) => submissions.push(pair) });
    const { serverId, view } = await publishServer(e);
    const toolName = view.tools.find((tool) => !tool.mutates).name;
    const out = await e.executeMcp({ operation: 'call_tool', identity: { ...A, scopes: [] }, workspaceId: A.workspaceId, serverId, body: { name: toolName } });
    assert.equal(out.result.isError, true);
    assert.match(out.result.content[0].text, /missing required scope/);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].counter.labels.status_class, 'denied');
    assert.equal(fetchImpl.calls.length, 0);
  }

  {
    const fetchImpl = scriptedFetch();
    const submissions = [];
    const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, metricsSink: (pair) => submissions.push(pair) });
    const { serverId } = await publishServer(e, { source: 'official' });
    const out = await e.executeMcp({
      operation: 'call_tool',
      identity: { ...A, scopes: [BASE_SCOPE] },
      workspaceId: A.workspaceId,
      serverId,
      body: { name: 'create_workspace', arguments: { slug: 'blocked' } },
    });
    assert.equal(out.result.isError, true);
    assert.match(out.result.content[0].text, /requires scope/);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].counter.labels.status_class, 'denied');
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('C07 outcomes: mutating manifest without scope is an accounted engine error', async () => {
  const tool = { name: 'legacy_mutation', description: 'legacy', mutates: true, scope: null, method: 'POST', path: '/v1/legacy', source: null };
  const store = fakeStateStore(seededPublishedState({ tool }));
  const fetchImpl = scriptedFetch();
  const submissions = [];
  const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, store, metricsSink: (pair) => submissions.push(pair) });

  const out = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: 'srv-seeded', body: { name: tool.name } });

  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /missing an explicit required scope/);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].counter.labels.status_class, 'error');
  assert.equal(fetchImpl.calls.length, 0);
});

test('C07 outcomes: call-shape validation failure is error and never reaches the backend', async () => {
  const fetchImpl = scriptedFetch();
  const submissions = [];
  const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, metricsSink: (pair) => submissions.push(pair) });
  const { serverId } = await publishServer(e, { resources: { storage: [{ name: 'docs', id: 'bucket-docs' }] } });

  const out = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId, body: { name: 'get_object_docs', arguments: {} } });

  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /object key is required/);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].counter.labels.status_class, 'error');
  assert.equal(fetchImpl.calls.length, 0);
});

test('C07 outcomes: non-2xx is error without changing the legacy caller-visible result shape', async () => {
  const fetchImpl = scriptedFetch({ status: 503, body: { ok: true, message: 'success-looking body' } });
  const submissions = [];
  const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, metricsSink: (pair) => submissions.push(pair) });
  const { serverId, view } = await publishServer(e);
  const toolName = view.tools.find((tool) => !tool.mutates).name;

  const out = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId, body: { name: toolName } });

  assert.deepEqual(out.result, {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, message: 'success-looking body' }) }],
    status: 503,
  });
  assert.equal('isError' in out.result, false, 'non-2xx did not expose isError before C07');
  assert.equal('outcomeClass' in out.result, false);
  assert.equal('canonicalToolName' in out.result, false);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].counter.labels.status_class, 'error');
});

test('C07 outcomes: backend unavailability is error; a 2xx success stays success regardless of body text', async () => {
  {
    const fetchImpl = scriptedFetch({ error: new Error('connection refused') });
    const submissions = [];
    const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, metricsSink: (pair) => submissions.push(pair) });
    const { serverId, view } = await publishServer(e);
    const toolName = view.tools.find((tool) => !tool.mutates).name;
    const out = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId, body: { name: toolName } });
    assert.equal(out.result.isError, true);
    assert.match(out.result.content[0].text, /backend unavailable: connection refused/);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].counter.labels.status_class, 'error');
    assert.equal(fetchImpl.calls.length, 1);
  }

  {
    const fetchImpl = scriptedFetch({ status: 204, body: 'error denied failed' });
    const submissions = [];
    const e = createMcpEngine({ fetchImpl, runtimeImageDigest: TEST_DIGEST, metricsSink: (pair) => submissions.push(pair) });
    const { serverId, view } = await publishServer(e);
    const toolName = view.tools.find((tool) => !tool.mutates).name;
    const out = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId, body: { name: toolName } });
    assert.equal(out.result.status, 204);
    assert.equal('isError' in out.result, false);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].counter.labels.status_class, 'success');
  }
});

test('C07 boundary: unknown tool has null internal outcome, valid public/audit results, and no submission', async () => {
  const shaperInputs = [];
  const submissions = [];
  const e = createMcpEngine({
    fetchImpl: scriptedFetch(),
    runtimeImageDigest: TEST_DIGEST,
    metricsSink: (pair) => submissions.push(pair),
    telemetryShaper: (input) => { shaperInputs.push(input); throw new Error('must not shape unknown tools'); },
  });
  const { serverId } = await publishServer(e);

  const out = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId, body: { name: 'caller_raw_unknown_name' } });

  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /unknown tool/);
  assert.equal('outcomeClass' in out.result, false);
  assert.equal('canonicalToolName' in out.result, false);
  assert.equal(shaperInputs.length, 0);
  assert.equal(submissions.length, 0);
  const audit = await e.executeMcp({ operation: 'list_audit', identity: A, workspaceId: A.workspaceId, serverId });
  assert.equal(audit.items.length >= 1, true);
  assert.equal(typeof audit.items.at(-1).detail, 'object');
});

test('C07 boundary: unauthenticated, foreign, inactive, and pre-boundary rate-limit failures emit nothing', async () => {
  const submissions = [];
  const sink = (pair) => submissions.push(pair);
  const e = createMcpEngine({ fetchImpl: scriptedFetch(), runtimeImageDigest: TEST_DIGEST, metricsSink: sink });
  const { serverId, view } = await publishServer(e);
  const toolName = view.tools.find((tool) => !tool.mutates).name;

  await assert.rejects(
    () => e.executeMcp({ operation: 'call_tool', identity: {}, workspaceId: A.workspaceId, serverId, body: { name: toolName } }),
    (err) => err.statusCode === 401,
  );
  await assert.rejects(
    () => e.executeMcp({ operation: 'call_tool', identity: B, workspaceId: B.workspaceId, serverId, body: { name: toolName } }),
    (err) => err.statusCode === 404,
  );

  const inactive = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'inactive', source: 'instant' } });
  await assert.rejects(
    () => e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: inactive.serverId, body: { name: toolName } }),
    (err) => err.statusCode === 409,
  );
  assert.equal(submissions.length, 0);

  const rateSubmissions = [];
  const rateEngine = createMcpEngine({
    fetchImpl: scriptedFetch(),
    runtimeImageDigest: TEST_DIGEST,
    metricsSink: (pair) => rateSubmissions.push(pair),
    plan: { maxServersPerTenant: 10, maxToolsPerServer: 100, toolCallsPerMinutePerServer: 0, toolCallsPerMinutePerOAuthClient: 100, mode: 'enforced' },
  });
  const rateFixture = await publishServer(rateEngine);
  const rateTool = rateFixture.view.tools.find((tool) => !tool.mutates).name;
  await assert.rejects(
    () => rateEngine.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: rateFixture.serverId, body: { name: rateTool } }),
    (err) => err.statusCode === 429,
  );
  assert.equal(rateSubmissions.length, 0);
});

test('C07 best effort: null/throwing sink and throwing shaper do not alter success/error or audit and never retry', async () => {
  const tool = { name: 'stable_read', description: 'stable', mutates: false, scope: null, method: 'GET', path: '/v1/stable', source: null };

  for (const status of [200, 503]) {
    const state = seededPublishedState({ tool });
    const control = createMcpEngine({
      fetchImpl: scriptedFetch({ status, body: { stable: true } }),
      runtimeImageDigest: TEST_DIGEST,
      store: fakeStateStore(state),
      metricsSink: null,
    });
    const expected = await control.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: 'srv-seeded', body: { name: tool.name } });

    let sinkCalls = 0;
    const throwing = createMcpEngine({
      fetchImpl: scriptedFetch({ status, body: { stable: true } }),
      runtimeImageDigest: TEST_DIGEST,
      store: fakeStateStore(state),
      metricsSink: () => { sinkCalls += 1; throw new Error('sink failed'); },
    });
    const actual = await throwing.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: 'srv-seeded', body: { name: tool.name } });
    assert.deepEqual(actual, expected);
    assert.equal(sinkCalls, 1, `sink must not retry status ${status}`);
    const audit = await throwing.executeMcp({ operation: 'list_audit', identity: A, workspaceId: A.workspaceId, serverId: 'srv-seeded' });
    assert.equal(audit.items.length, 1);
    assert.equal(typeof audit.items[0].detail, 'object');
    assert.equal(audit.items[0].detail.message, 'mcp.tool_call', 'sink failure must not erase structured audit detail');
  }

  let shaperCalls = 0;
  let sinkCalls = 0;
  const shapingFailure = createMcpEngine({
    fetchImpl: scriptedFetch({ body: { stable: true } }),
    runtimeImageDigest: TEST_DIGEST,
    store: fakeStateStore(seededPublishedState({ tool })),
    telemetryShaper: () => { shaperCalls += 1; throw new Error('shape failed'); },
    metricsSink: () => { sinkCalls += 1; },
  });
  const out = await shapingFailure.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: 'srv-seeded', body: { name: tool.name } });
  assert.equal(out.result.status, 200);
  assert.equal(shaperCalls, 1);
  assert.equal(sinkCalls, 0);
  const audit = await shapingFailure.executeMcp({ operation: 'list_audit', identity: A, workspaceId: A.workspaceId, serverId: 'srv-seeded' });
  assert.equal(audit.items.length, 1);
  assert.equal(audit.items[0].detail.message, 'mcp.tool_call');
  assert.equal(audit.items[0].detail.server, 'srv-seeded');
  assert.equal(audit.items[0].detail.tool, tool.name);
  assert.equal(audit.items[0].detail.oauth_client, A.actorId);
  assert.equal(audit.items[0].detail.status, 'success');
});
