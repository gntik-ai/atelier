/**
 * Public acceptance for add-managed-knative-serving / hosted MCP.
 *
 * bbx-933-mcp-publish-gate: unavailable publish is HTTP 503 before version mutation
 * bbx-933-mcp-rpc-unavailable: owner request is HTTP 200 / JSON-RPC -32005
 * bbx-933-mcp-notification: unavailable notification is 202 empty and invokes nothing
 * bbx-933-mcp-precedence: authentication and tenant-safe lookup precede dependency disclosure
 * bbx-933-mcp-degraded-read: metadata/audit remain scoped and never claim readiness
 * bbx-933-mcp-delete-pending: outage delete is durable/idempotent 202 deletion_pending
 * bbx-933-mcp-disabled-distinct: intentionally absent hosting remains an unregistered route
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createMcpEngine } from '../../apps/control-plane-executor/src/runtime/mcp-engine.mjs';
import { BASE_SCOPE } from '../../apps/control-plane-executor/src/mcp-official-catalog.mjs';

const A = { tenantId: 'tenant-a', workspaceId: 'ws-a', actorId: 'owner-a', scopes: [BASE_SCOPE] };
const DIGEST = `sha256:${'c'.repeat(64)}`;
const OUTAGE = { mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' };
const runtime = { status: () => OUTAGE, canServeWorkloads: () => false };

function stateStore() {
  let state = {};
  let tail = Promise.resolve();
  return {
    async ensureSchema() {},
    async loadState() { return structuredClone(state); },
    async saveState(next) { state = structuredClone(next); },
    async withStateTransaction(mutator) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        const outcome = await mutator(structuredClone(state), { query: async () => ({ rows: [] }) });
        state = structuredClone(outcome.state);
        return outcome.result;
      } finally { release(); }
    },
  };
}

function cleanupRepository() {
  const obligations = new Map();
  return {
    obligations,
    async deferMcpDeletion(input) {
      const key = `${input.tenantId}:${input.resourceId}`;
      if (!obligations.has(key)) obligations.set(key, {
        obligationId: `mcp:${key}:delete`, ...input, status: 'pending',
      });
      return obligations.get(key);
    },
    async completeMcpDeletion() {},
  };
}

function headers(tenantId = A.tenantId, workspaceId = A.workspaceId, correlationId = 'corr-owner-933') {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-workspace-id': workspaceId,
    'x-auth-subject': `${tenantId}-actor`,
    'x-auth-scopes': BASE_SCOPE,
    'x-actor-roles': 'tenant_owner',
    'x-correlation-id': correlationId,
  };
}

let server; let baseUrl; let engine; let activeId; let adjacentId; let draftId; let fetchCalls; let cleanup;

test.before(async () => {
  fetchCalls = [];
  cleanup = cleanupRepository();
  engine = createMcpEngine({
    selfBaseUrl: 'http://executor.local',
    gatewayBaseUrl: 'https://gateway.local',
    runtimeImageDigest: DIGEST,
    store: stateStore(),
    cleanupRepository: cleanup,
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return { status: 200, async json() { return { ok: true }; } };
    },
  });
  draftId = (await engine.executeMcp({
    operation: 'create_server', identity: A, workspaceId: A.workspaceId,
    body: { name: 'draft', source: 'instant' },
  })).serverId;
  activeId = (await engine.executeMcp({
    operation: 'create_server', identity: A, workspaceId: A.workspaceId,
    body: { name: 'active', source: 'instant' },
  })).serverId;
  adjacentId = (await engine.executeMcp({
    operation: 'create_server', identity: { ...A, tenantId: 'tenant-b', workspaceId: 'ws-b' }, workspaceId: 'ws-b',
    body: { name: 'active', source: 'instant' },
  })).serverId;
  await engine.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: activeId, body: { decisions: {} } });
  await engine.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: activeId, version: 'v1', body: { version: 'v1' } });

  server = createControlPlaneServer({ registry: {}, mcpEngine: engine, knativeRuntime: runtime, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => new Promise((resolve) => server.close(resolve)));

const url = (sid, suffix = '') => `${baseUrl}/v1/mcp/workspaces/${A.workspaceId}/servers/${sid}${suffix}`;

test('bbx-933-mcp-publish-gate: publish and activation fail 503 before mutation', async () => {
  const publish = await fetch(url(draftId, '/versions'), {
    method: 'POST', headers: headers(), body: JSON.stringify({ version: 'v1' }),
  });
  assert.equal(publish.status, 503);
  assert.deepEqual(await publish.json(), {
    code: 'KNATIVE_UNAVAILABLE', message: 'Knative runtime is unavailable.', mode: 'managed',
    state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY', correlationId: 'corr-owner-933',
  });
  const unchanged = await engine.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: draftId });
  assert.equal(unchanged.activeVersion, null);

  const activation = await fetch(url(activeId, '/versions/v1/approval'), {
    method: 'POST', headers: headers(), body: '{}',
  });
  assert.equal(activation.status, 503);
});

test('bbx-933-mcp-rpc-unavailable: owner gets exact -32005 and no tool result', async () => {
  const before = fetchCalls.length;
  const response = await fetch(url(activeId, '/rpc'), {
    method: 'POST', headers: headers(A.tenantId, A.workspaceId, 'corr-rpc-933'),
    body: JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'query_items', arguments: { secret: 'never-forward' } } }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0', id: 17,
    error: {
      code: -32005,
      message: 'Hosted MCP runtime is unavailable.',
      data: { code: 'KNATIVE_UNAVAILABLE', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY', correlationId: 'corr-rpc-933' },
    },
  });
  assert.equal(fetchCalls.length, before);
});

test('bbx-933-mcp-notification: notification is 202 empty, invokes nothing, and is audited', async () => {
  const before = fetchCalls.length;
  const response = await fetch(url(activeId, '/rpc'), {
    method: 'POST', headers: headers(A.tenantId, A.workspaceId, 'corr-notify-933'),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'query_items', arguments: {} } }),
  });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
  assert.equal(fetchCalls.length, before);
  const audit = await engine.executeMcp({ operation: 'list_audit', identity: A, workspaceId: A.workspaceId, serverId: activeId });
  const event = audit.items.find((item) => item.correlation_id === 'corr-notify-933');
  assert.equal(event.action.id, 'mcp.runtime_unavailable');
  assert.equal(event.detail.runtime_reason, 'CONTROL_PLANE_NOT_READY');
  assert.ok(!JSON.stringify(event).includes('query_items'));
});

test('bbx-933-mcp-precedence: authentication and foreign lookup conceal dependency state', async () => {
  const unauth = await fetch(url(activeId, '/rpc'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'ping' }),
  });
  assert.equal(unauth.status, 401);
  assert.ok(!JSON.stringify(await unauth.json()).includes('KNATIVE'));

  const foreign = await fetch(url(activeId, '/rpc'), {
    method: 'POST', headers: headers('tenant-b', 'ws-b', 'corr-foreign-933'),
    body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'ping' }),
  });
  assert.equal(foreign.status, 200);
  const body = await foreign.json();
  assert.equal(body.error.code, -32001);
  assert.ok(!JSON.stringify(body).includes('KNATIVE'));
});

test('bbx-933-mcp-degraded-read: metadata and audit remain scoped and honest', async () => {
  const detail = await fetch(url(activeId), { headers: headers() });
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.runtimeReady, false);
  assert.deepEqual(body.runtimeDependency, { mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY', ready: false });
  assert.equal(body.lifecycleStatus, 'active');

  const list = await fetch(`${baseUrl}/v1/mcp/workspaces/${A.workspaceId}/servers`, { headers: headers() });
  assert.equal(list.status, 200);
  const listed = await list.json();
  assert.ok(listed.items.some((item) => item.serverId === activeId && item.name === 'active'));
  assert.ok(!listed.items.some((item) => item.serverId === adjacentId));
  assert.ok(listed.items.every((item) => item.runtimeReady === false));

  const audit = await fetch(url(activeId, '/audit'), { headers: headers() });
  assert.equal(audit.status, 200);
  const auditBody = await audit.json();
  assert.equal(auditBody.runtimeDependency.ready, false);
  assert.ok(auditBody.items.every((event) => event.scope.tenant_id === A.tenantId));
});

test('bbx-933-mcp-delete-pending: repeated outage delete returns the same durable pending outcome', async () => {
  const first = await fetch(url(activeId), { method: 'DELETE', headers: headers(A.tenantId, A.workspaceId, 'corr-delete-original') });
  const replay = await fetch(url(activeId), { method: 'DELETE', headers: headers(A.tenantId, A.workspaceId, 'corr-delete-retry') });
  assert.equal(first.status, 202);
  assert.equal(replay.status, 202);
  const firstBody = await first.json();
  const replayBody = await replay.json();
  assert.equal(firstBody.status, 'deletion_pending');
  assert.equal(firstBody.correlationId, 'corr-delete-original');
  assert.equal(replayBody.correlationId, 'corr-delete-original');
  assert.equal(cleanup.obligations.size, 1);
  const detail = await fetch(url(activeId), { headers: headers() });
  assert.equal((await detail.json()).lifecycleStatus, 'deletion_pending');
});

test('bbx-933-mcp-disabled-distinct: absent hosting remains an unregistered route', async () => {
  const disabled = createControlPlaneServer({ registry: {}, knativeRuntime: runtime, logger: { error() {} } });
  await new Promise((resolve) => disabled.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${disabled.address().port}/v1/mcp/workspaces/ws-a/servers`, { headers: headers() });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'NO_ROUTE');
  } finally { await new Promise((resolve) => disabled.close(resolve)); }
});
