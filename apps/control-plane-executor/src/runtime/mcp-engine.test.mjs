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

function engine() {
  return createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST });
}

function fakeStateStore() {
  let state = null;
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
  const applyCalls = [];
  const e = createMcpEngine({
    selfBaseUrl: 'http://cp.local',
    gatewayBaseUrl: 'https://gw.local',
    fetchImpl: fakeFetch(),
    runtimeImageDigest: TEST_DIGEST,
    mcpRuntimeAdapter: {
      async apply(input) {
        applyCalls.push(structuredClone(input));
        return { status: 'accepted' };
      },
    },
  });
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'Pinned', source: 'official' } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].operation, 'publish');
  assert.equal(applyCalls[0].version, 'v1');

  // v2 changes a tool description via a real curation decision → requiresReview, NOT served.
  const firstTool = (await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid })).tools[0].name;
  const pub2 = await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v2', body: { version: 'v2', curation: { decisions: { [firstTool]: { description: 'CHANGED for v2' } } } } });
  assert.equal(pub2.requiresReview, true);
  assert.equal(pub2.activeVersion, 'v1'); // still serving v1
  assert.equal(applyCalls.length, 1, 'a review-held publish must not reconcile');

  // approve → v2 serves.
  const approved = await e.executeMcp({
    operation: 'approve_version', identity: A, workspaceId: A.workspaceId, serverId: sid,
    version: 'v2', correlationId: 'corr-unit-approve-v2',
  });
  assert.equal(approved.activeVersion, 'v2');
  assert.equal(applyCalls.length, 2);
  assert.equal(applyCalls[1].operation, 'approve');
  assert.equal(applyCalls[1].version, 'v2');
  assert.equal(applyCalls[1].correlationId, 'corr-unit-approve-v2');
  assert.equal(applyCalls[1].manifest.tools.find((tool) => tool.name === firstTool).description, 'CHANGED for v2');
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

test('outage teardown: tenant and capability operations atomically retain idempotent MCP cleanup obligations', async () => {
  const store = transactionalStateStore();
  const obligations = new Map();
  const cleanupRepository = {
    async deferMcpDeletion(input) {
      const k = `${input.tenantId}:${input.resourceId}`;
      if (!obligations.has(k)) obligations.set(k, { obligationId: `mcp:${k}:delete`, ...input, status: 'pending' });
      return obligations.get(k);
    },
    async completeMcpDeletion() {},
  };
  const e = createMcpEngine({ store, cleanupRepository, fetchImpl: fakeFetch(), runtimeImageDigest: TEST_DIGEST });
  const a = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'same-name', source: 'instant' } });
  const b = await e.executeMcp({ operation: 'create_server', identity: B, workspaceId: B.workspaceId, body: { name: 'same-name', source: 'instant' } });

  const tenantPending = await e.deferTenantTeardown({
    tenantId: A.tenantId, workspaceId: A.workspaceId, correlationId: 'corr-tenant-original',
    runtime: { mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' },
  });
  assert.equal(tenantPending.items.length, 1);
  assert.equal(tenantPending.items[0].serverId, a.serverId);
  assert.equal((await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: a.serverId })).lifecycleStatus, 'deletion_pending');
  assert.equal((await e.executeMcp({ operation: 'get_server', identity: B, workspaceId: B.workspaceId, serverId: b.serverId })).lifecycleStatus, 'active');

  const tenantRetry = await e.deferTenantTeardown({
    tenantId: A.tenantId, workspaceId: A.workspaceId, correlationId: 'corr-tenant-retry',
    runtime: { mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' },
  });
  assert.equal(tenantRetry.items[0].correlationId, 'corr-tenant-original');
  assert.equal(obligations.size, 1);

  const capabilityPending = await e.deferCapabilityDisable({
    correlationId: 'corr-disable', runtime: { mode: 'disabled', state: 'disabled', reason: 'RUNTIME_DISABLED' },
  });
  assert.equal(capabilityPending.items.length, 2);
  assert.equal(obligations.size, 2);
  assert.equal((await e.executeMcp({ operation: 'get_server', identity: B, workspaceId: B.workspaceId, serverId: b.serverId })).lifecycleStatus, 'deletion_pending');
});
