/**
 * Issue #933 public HTTP regressions for the managed hosted-MCP runtime.
 *
 * bbx-933-mcp-workspace-management — fn-mcp-hosted-isolation —
 *   #### Scenario: Same server identity in two tenants remains isolated
 * bbx-933-mcp-workspace-dispatch — fn-mcp-hosted-isolation —
 *   #### Scenario: Authentication and ownership precede dependency status
 * bbx-933-mcp-create-accepted — fn-mcp-server-create —
 *   #### Scenario: Managed Knative preserves hosted MCP isolation and scale-to-zero semantics
 * bbx-933-mcp-hosting-apply — fn-mcp-hosted-publish —
 *   #### Scenario: Idle server scales down and cold-starts
 * bbx-933-mcp-hosted-invoke — fn-mcp-hosted-invoke —
 *   #### Scenario: Idle server scales down and cold-starts
 * bbx-933-mcp-cleanup-precondition — fn-mcp-hosted-cleanup —
 *   #### Scenario: Retried cleanup is safe
 * bbx-933-mcp-central-audit — fn-mcp-runtime-audit —
 *   #### Scenario: Hosted-server outage is correlated without secrets
 *
 * The system is booted through its public server/engine factories and is driven only over HTTP.
 * Injected runtime, hosting, audit, and Kubernetes-shaped adapters are observable dependency
 * boundaries; no product-private state or cleaner implementation is imported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createMcpEngine } from '../../../apps/control-plane-executor/src/runtime/mcp-engine.mjs';
import { BASE_SCOPE } from '../../../apps/control-plane-executor/src/mcp-official-catalog.mjs';

const TENANT = 'tenant-933-a';
const ADJACENT_TENANT = 'tenant-933-b';
const WORKSPACE = 'workspace-933-a';
const ADJACENT_WORKSPACE = 'workspace-933-b';
const DIGEST = `sha256:${'9'.repeat(64)}`;
const READY = { mode: 'managed', state: 'ready', reason: 'READY' };
const OUTAGE = { mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' };
const OWNER = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  actorId: 'owner-933-a',
  scopes: [BASE_SCOPE],
};

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
      } finally {
        release();
      }
    },
  };
}

function authHeaders({
  tenantId = TENANT,
  workspaceId = WORKSPACE,
  correlationId = 'corr-mcp-933-owner',
} = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-workspace-id': workspaceId,
    'x-auth-subject': `owner:${tenantId}:${workspaceId}`,
    'x-auth-scopes': BASE_SCOPE,
    'x-actor-roles': 'workspace_owner',
    'x-correlation-id': correlationId,
  };
}

async function withHarness(fn, {
  runtimeState = READY,
  mcpRuntimeAdapter,
  auditSink,
  fallbackFetch,
} = {}) {
  const statusCalls = [];
  const fallbackCalls = [];
  const runtime = {
    status() { statusCalls.push(Date.now()); return runtimeState; },
    canServeWorkloads() { return runtimeState.state === 'ready'; },
  };
  const engine = createMcpEngine({
    store: stateStore(),
    runtimeImageDigest: DIGEST,
    selfBaseUrl: 'http://registry-only.invalid',
    gatewayBaseUrl: 'https://gateway.invalid',
    mcpRuntimeAdapter,
    auditSink,
    fetchImpl: fallbackFetch ?? (async (url, init) => {
      fallbackCalls.push({ url, init });
      return { status: 200, async json() { return { registryOnly: true }; } };
    }),
  });
  const server = createControlPlaneServer({
    registry: {}, mcpEngine: engine, knativeRuntime: runtime, logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ baseUrl, engine, statusCalls, fallbackCalls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function createDraft(engine, { name = 'orders-933', workspaceId = WORKSPACE } = {}) {
  return engine.executeMcp({
    operation: 'create_server',
    identity: { ...OWNER, workspaceId },
    workspaceId,
    body: {
      name,
      source: 'instant',
      resources: {
        postgres: {
          database: 'app', name: 'public',
          tables: [{ name: 'orders', columns: [{ name: 'id', type: 'bigint' }] }],
        },
      },
    },
  });
}

async function publish(engine, serverId) {
  await engine.executeMcp({
    operation: 'curate_server', identity: OWNER, workspaceId: WORKSPACE, serverId,
    body: { decisions: {} },
  });
  return engine.executeMcp({
    operation: 'publish_version', identity: OWNER, workspaceId: WORKSPACE, serverId,
    version: 'v1', body: { version: 'v1' },
  });
}

const serverUrl = (baseUrl, workspaceId, serverId, suffix = '') =>
  `${baseUrl}/v1/mcp/workspaces/${workspaceId}/servers/${serverId}${suffix}`;

test('bbx-933-mcp-workspace-management: same-tenant wrong-workspace management cannot inspect or mutate a server', async () => {
  await withHarness(async ({ baseUrl, engine, statusCalls }) => {
    const draft = await createDraft(engine, { name: 'draft-933' });
    const active = await createDraft(engine, { name: 'active-933' });
    await publish(engine, active.serverId);
    const adjacent = authHeaders({ workspaceId: ADJACENT_WORKSPACE, correlationId: 'corr-wrong-workspace-management' });
    const requests = [
      ['detail', serverUrl(baseUrl, ADJACENT_WORKSPACE, active.serverId), { headers: adjacent }],
      ['audit', serverUrl(baseUrl, ADJACENT_WORKSPACE, active.serverId, '/audit'), { headers: adjacent }],
      ['publish', serverUrl(baseUrl, ADJACENT_WORKSPACE, draft.serverId, '/versions'), { method: 'POST', headers: adjacent, body: JSON.stringify({ version: 'v1' }) }],
      ['activate', serverUrl(baseUrl, ADJACENT_WORKSPACE, active.serverId, '/versions/v1/approval'), { method: 'POST', headers: adjacent, body: '{}' }],
      ['delete', serverUrl(baseUrl, ADJACENT_WORKSPACE, active.serverId), { method: 'DELETE', headers: adjacent }],
    ];
    const observed = [];
    for (const [label, url, init] of requests) {
      const response = await fetch(url, init);
      const body = await response.json();
      observed.push({ label, status: response.status, disclosedKnative: JSON.stringify(body).includes('KNATIVE') });
    }
    const ownerDetail = await fetch(serverUrl(baseUrl, WORKSPACE, active.serverId), { headers: authHeaders() });
    assert.deepEqual({ observed, statusCalls: statusCalls.length, ownerStatus: ownerDetail.status }, {
      observed: requests.map(([label]) => ({ label, status: 404, disclosedKnative: false })),
      statusCalls: 1,
      ownerStatus: 200,
    }, 'every management operation must hide the wrong-workspace server; only the final owner read may inspect runtime status');
  }, { runtimeState: OUTAGE });
});

test('bbx-933-mcp-workspace-dispatch: same-tenant wrong-workspace REST and RPC dispatch are denied before runtime status', async () => {
  await withHarness(async ({ baseUrl, engine, statusCalls, fallbackCalls }) => {
    const created = await createDraft(engine);
    await publish(engine, created.serverId);
    const adjacent = authHeaders({ workspaceId: ADJACENT_WORKSPACE, correlationId: 'corr-wrong-workspace-dispatch' });

    const tool = await fetch(serverUrl(baseUrl, ADJACENT_WORKSPACE, created.serverId, '/tool-calls'), {
      method: 'POST', headers: adjacent,
      body: JSON.stringify({ name: 'query_orders', arguments: { workspaceId: WORKSPACE } }),
    });
    const toolBody = await tool.json();

    const rpc = await fetch(serverUrl(baseUrl, ADJACENT_WORKSPACE, created.serverId, '/rpc'), {
      method: 'POST', headers: adjacent,
      body: JSON.stringify({ jsonrpc: '2.0', id: 933, method: 'tools/call', params: { name: 'query_orders', arguments: {} } }),
    });
    assert.equal(rpc.status, 200, 'foreign JSON-RPC lookups retain the tenant-safe JSON-RPC transport status');
    const rpcBody = await rpc.json();
    assert.deepEqual({
      toolStatus: tool.status,
      toolDisclosedKnative: JSON.stringify(toolBody).includes('KNATIVE'),
      rpcStatus: rpc.status,
      rpcCode: rpcBody.error?.code,
      rpcDisclosedKnative: JSON.stringify(rpcBody).includes('KNATIVE'),
      statusCalls: statusCalls.length,
      fallbackCalls: fallbackCalls.length,
    }, {
      toolStatus: 404,
      toolDisclosedKnative: false,
      rpcStatus: 200,
      rpcCode: -32001,
      rpcDisclosedKnative: false,
      statusCalls: 0,
      fallbackCalls: 0,
    }, 'REST and JSON-RPC dispatch must resolve exact workspace ownership before status or invocation');
  }, { runtimeState: OUTAGE });
});

test('bbx-933-mcp-create-accepted: create returns exact HTTP 202 GatewayMutationAccepted envelope', async () => {
  await withHarness(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/mcp/workspaces/${WORKSPACE}/servers`, {
      method: 'POST',
      headers: authHeaders({ correlationId: 'corr-mcp-create-933' }),
      body: JSON.stringify({ name: 'created-over-http', source: 'instant' }),
    });
    assert.equal(response.status, 202, `published contract requires 202, got ${response.status}: ${await response.clone().text()}`);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      'acceptedAt', 'correlationId', 'family', 'requestId', 'resourceId', 'resourceType', 'status',
    ]);
    assert.equal(body.family, 'mcp');
    assert.equal(body.resourceType, 'mcp_server');
    assert.match(body.resourceId, /^srv-/);
    assert.ok(['accepted', 'queued'].includes(body.status));
    assert.equal(body.correlationId, 'corr-mcp-create-933');
    assert.ok(!Number.isNaN(Date.parse(body.acceptedAt)), `acceptedAt must be RFC3339: ${body.acceptedAt}`);
    assert.ok(body.requestId.length >= 8);
  });
});

test('bbx-933-mcp-hosting-apply: publish reconciles a tenant/workspace-owned hosted workload', async () => {
  const applyCalls = [];
  const adapter = {
    async apply(input) { applyCalls.push(input); return { status: 'accepted' }; },
  };
  await withHarness(async ({ baseUrl, engine }) => {
    const created = await createDraft(engine);
    await engine.executeMcp({
      operation: 'curate_server', identity: OWNER, workspaceId: WORKSPACE,
      serverId: created.serverId, body: { decisions: {} },
    });
    const response = await fetch(serverUrl(baseUrl, WORKSPACE, created.serverId, '/versions'), {
      method: 'POST', headers: authHeaders({ correlationId: 'corr-mcp-publish-933' }),
      body: JSON.stringify({ version: 'v1' }),
    });
    assert.equal(response.status, 201, `publish public contract regressed: ${response.status} ${await response.clone().text()}`);
    assert.equal(applyCalls.length, 1, 'successful publish must reconcile the hosted Knative workload');
    assert.deepEqual({
      tenantId: applyCalls[0].tenantId,
      workspaceId: applyCalls[0].workspaceId,
      serverId: applyCalls[0].serverId,
      operation: applyCalls[0].operation,
      correlationId: applyCalls[0].correlationId,
    }, {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      serverId: created.serverId,
      operation: 'publish',
      correlationId: 'corr-mcp-publish-933',
    });
    assert.equal(applyCalls[0].runtimeImage, DIGEST);
    assert.equal(typeof applyCalls[0].manifest, 'object');
  }, { mcpRuntimeAdapter: adapter });
});

test('bbx-933-mcp-hosted-invoke: tool call dispatches through the hosted runtime adapter', async () => {
  const invokeCalls = [];
  const adapter = {
    async apply() { return { status: 'accepted' }; },
    async invoke(input) {
      invokeCalls.push(input);
      return { content: [{ type: 'text', text: '{"hosted":true}' }], isError: false };
    },
  };
  await withHarness(async ({ baseUrl, engine, fallbackCalls }) => {
    const created = await createDraft(engine);
    await publish(engine, created.serverId);
    const response = await fetch(serverUrl(baseUrl, WORKSPACE, created.serverId, '/tool-calls'), {
      method: 'POST', headers: authHeaders({ correlationId: 'corr-mcp-invoke-933' }),
      body: JSON.stringify({ name: 'query_orders', arguments: { tenantId: ADJACENT_TENANT, workspaceId: ADJACENT_WORKSPACE } }),
    });
    assert.equal(response.status, 200, `${response.status} ${await response.clone().text()}`);
    assert.equal(invokeCalls.length, 1, 'published tool invocation must cold-start/dispatch through hosted runtime');
    assert.deepEqual({
      tenantId: invokeCalls[0].tenantId,
      workspaceId: invokeCalls[0].workspaceId,
      serverId: invokeCalls[0].serverId,
      correlationId: invokeCalls[0].correlationId,
      roles: invokeCalls[0].roles,
      scopes: invokeCalls[0].scopes,
    }, {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      serverId: created.serverId,
      correlationId: 'corr-mcp-invoke-933',
      roles: ['workspace_owner'],
      scopes: [BASE_SCOPE],
    });
    assert.equal(invokeCalls[0].tool, 'query_orders');
    assert.deepEqual(invokeCalls[0].args, {}, 'caller-smuggled tenant/workspace arguments must be stripped');
    assert.equal(fallbackCalls.length, 0, 'hosted invocation must not fall back to registry-only in-process execution');
    assert.deepEqual(await response.json(), { content: [{ type: 'text', text: '{"hosted":true}' }], isError: false });
  }, { mcpRuntimeAdapter: adapter });
});

test('bbx-933-mcp-cleanup-precondition: replacement conflict keeps deletion pending and replay uses the newly observed identity', async () => {
  let observation = 0;
  const deleteCalls = [];
  const adapter = {
    async listOwned() {
      observation += 1;
      return [{
        kind: 'Service', namespace: 'tenant-933-a', name: 'mcp-orders-933',
        uid: observation === 1 ? 'uid-original' : 'uid-replacement',
        resourceVersion: observation === 1 ? '41' : '42',
      }];
    },
    async deleteOwned(input) {
      deleteCalls.push(input);
      if (deleteCalls.length === 1) return { status: 409, code: 'PRECONDITION_CONFLICT' };
      return { status: 200 };
    },
  };
  await withHarness(async ({ baseUrl, engine }) => {
    const created = await createDraft(engine);
    const endpoint = serverUrl(baseUrl, WORKSPACE, created.serverId);
    const first = await fetch(endpoint, {
      method: 'DELETE', headers: authHeaders({ correlationId: 'corr-mcp-cleanup-first' }),
    });
    assert.equal(first.status, 202, `precondition conflict must remain pending: ${first.status} ${await first.clone().text()}`);
    const firstBody = await first.json();
    assert.equal(firstBody.status, 'deletion_pending');
    assert.deepEqual(
      { uid: deleteCalls[0]?.uid, resourceVersion: deleteCalls[0]?.resourceVersion },
      { uid: 'uid-original', resourceVersion: '41' },
      'delete must use the UID/resourceVersion from the immediately preceding observation',
    );
    const retained = await fetch(endpoint, { headers: authHeaders() });
    assert.equal(retained.status, 200, 'logical server must remain observable while cleanup is pending');
    assert.equal((await retained.json()).lifecycleStatus, 'deletion_pending');

    const replay = await fetch(endpoint, {
      method: 'DELETE', headers: authHeaders({ correlationId: 'corr-mcp-cleanup-replay' }),
    });
    assert.ok([200, 204].includes(replay.status), `successful replay should complete deletion, got ${replay.status}`);
    assert.deepEqual(
      { uid: deleteCalls[1]?.uid, resourceVersion: deleteCalls[1]?.resourceVersion },
      { uid: 'uid-replacement', resourceVersion: '42' },
      'replay must re-list and precondition against the replacement identity',
    );
    const gone = await fetch(endpoint, { headers: authHeaders() });
    assert.equal(gone.status, 404);
  }, { mcpRuntimeAdapter: adapter });
});

test('bbx-933-mcp-central-audit: unavailable event is queryable by workspace/correlation without adjacent-tenant leakage', async () => {
  const records = [];
  const auditSink = async (event) => { records.push(structuredClone(event)); };
  const queryWorkspace = ({ tenantId, workspaceId, correlationId }) => records.filter((event) =>
    event.tenantId === tenantId
    && event.workspaceId === workspaceId
    && event.correlationId === correlationId);

  await withHarness(async ({ baseUrl, engine }) => {
    const created = await createDraft(engine);
    await publish(engine, created.serverId);
    const correlationId = 'corr-mcp-central-audit-933';
    const response = await fetch(serverUrl(baseUrl, WORKSPACE, created.serverId, '/tool-calls'), {
      method: 'POST', headers: authHeaders({ correlationId }),
      body: JSON.stringify({ name: 'query_orders', arguments: { password: 'must-not-be-audited' } }),
    });
    assert.equal(response.status, 503);

    const ownerRecords = queryWorkspace({ tenantId: TENANT, workspaceId: WORKSPACE, correlationId });
    assert.equal(ownerRecords.length, 1, 'central workspace/correlation query must resolve the MCP runtime event');
    assert.equal(ownerRecords[0].actionType, 'mcp.runtime_unavailable');
    assert.ok(!JSON.stringify(ownerRecords[0]).includes('must-not-be-audited'), 'audit record must omit tool arguments and secrets');
    assert.deepEqual(
      queryWorkspace({ tenantId: ADJACENT_TENANT, workspaceId: WORKSPACE, correlationId }),
      [],
      'an adjacent tenant cannot resolve the correlation event',
    );
  }, { runtimeState: OUTAGE, auditSink });
});
