/**
 * Issue #933 independently reported Hosted MCP regressions.
 *
 * bbx-933-mcp-plural-workspace-binding-27 | fn-mcp-hosted-isolation
 *   OpenSpec #### Scenario: Authentication and ownership precede dependency status
 *   OpenSpec #### Scenario: Same server identity in two tenants remains isolated
 * bbx-933-mcp-cleaner-production-list-28 | fn-mcp-hosted-cleanup
 *   OpenSpec #### Scenario: Retried cleanup is safe
 * bbx-933-mcp-cleaner-fail-closed-29 | fn-mcp-hosted-cleanup
 *   OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 * bbx-933-mcp-cleaner-precondition-errors-30 | fn-mcp-hosted-cleanup
 *   OpenSpec #### Scenario: Retried cleanup is safe
 * bbx-933-mcp-cleanup-api-retention-31 | fn-mcp-hosted-cleanup
 *   OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 * bbx-933-mcp-runtime-wire-context-32 | fn-mcp-hosted-invoke
 *   OpenSpec #### Scenario: Idle server scales down and cold-starts
 *   OpenSpec #### Scenario: Hosted-server outage is correlated without secrets
 * bbx-933-mcp-review-reconcile-33 | fn-mcp-hosted-publish
 *   OpenSpec #### Scenario: Managed Knative preserves hosted MCP isolation and scale-to-zero semantics
 * bbx-933-mcp-kube-ca-34 | fn-mcp-hosted-publish, fn-mcp-hosted-cleanup
 *   OpenSpec #### Scenario: Managed Knative preserves hosted MCP isolation and scale-to-zero semantics
 * bbx-933-mcp-runtime-namespace-map-35 | fn-mcp-hosted-isolation, fn-mcp-hosted-cleanup
 *   OpenSpec #### Scenario: Same server identity in two tenants remains isolated
 * bbx-933-mcp-cluster-local-isolation-36 | fn-mcp-hosted-isolation
 *   OpenSpec #### Scenario: Managed Knative preserves hosted MCP isolation and scale-to-zero semantics
 *
 * These tests use only exported runtime factories and the public HTTP API. Kubernetes is represented
 * at the production adapter's documented HTTP boundary; no cluster or external network is contacted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createMcpEngine } from '../../../apps/control-plane-executor/src/runtime/mcp-engine.mjs';
import { createMcpRuntimeAdapter } from '../../../apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs';
import { createMcpRuntimeCleaner } from '../../../apps/control-plane-executor/src/runtime/mcp-runtime-cleaner.mjs';
import { BASE_SCOPE } from '../../../apps/control-plane-executor/src/mcp-official-catalog.mjs';

const TENANT = 'tenant-933-a';
const WORKSPACE = 'workspace-933-a';
const ADJACENT_WORKSPACE = 'workspace-933-b';
const SERVER_ID = 'srv-cleanup-933';
const DIGEST = `sha256:${'9'.repeat(64)}`;
const READY = { mode: 'managed', state: 'ready', reason: 'READY' };
const OUTAGE = { mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' };
const OWNER = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  actorId: 'owner-933-a',
  roles: ['workspace_owner'],
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
  workspaceId = WORKSPACE,
  correlationId = 'corr-mcp-followup-owner',
  pluralWorkspaceIds,
} = {}) {
  const headers = {
    'content-type': 'application/json',
    'x-tenant-id': TENANT,
    'x-auth-subject': `owner:${TENANT}:${workspaceId}`,
    'x-auth-scopes': BASE_SCOPE,
    'x-actor-roles': 'workspace_owner',
    'x-correlation-id': correlationId,
  };
  if (workspaceId != null) headers['x-workspace-id'] = workspaceId;
  if (pluralWorkspaceIds != null) {
    headers['x-actor-workspace-ids'] = Array.isArray(pluralWorkspaceIds)
      ? pluralWorkspaceIds.join(',')
      : pluralWorkspaceIds;
  }
  return headers;
}

async function withHarness(fn, {
  runtimeState = READY,
  mcpRuntimeAdapter,
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

async function createDraft(engine, { name = 'orders-followup-933' } = {}) {
  return engine.executeMcp({
    operation: 'create_server', identity: OWNER, workspaceId: WORKSPACE,
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

async function curate(engine, serverId, decisions = {}) {
  return engine.executeMcp({
    operation: 'curate_server', identity: OWNER, workspaceId: WORKSPACE, serverId,
    body: { decisions },
  });
}

async function publish(engine, serverId, version = 'v1') {
  return engine.executeMcp({
    operation: 'publish_version', identity: OWNER, workspaceId: WORKSPACE, serverId, version,
    body: { version },
  });
}

const serverUrl = (baseUrl, serverId, suffix = '') =>
  `${baseUrl}/v1/mcp/workspaces/${WORKSPACE}/servers/${serverId}${suffix}`;

test('bbx-933-mcp-plural-workspace-binding-27: plural-only workspace-B identity cannot address workspace-A MCP routes', async () => {
  const invokeCalls = [];
  const adapter = {
    async apply() { return { status: 'accepted' }; },
    async invoke(input) { invokeCalls.push(input); return { content: [], isError: false }; },
  };
  await withHarness(async ({ baseUrl, engine, statusCalls, fallbackCalls }) => {
    const created = await createDraft(engine);
    await curate(engine, created.serverId);
    await publish(engine, created.serverId);

    const singularOwner = authHeaders({ correlationId: 'corr-mcp-singular-baseline' });
    const ownerList = await fetch(`${baseUrl}/v1/mcp/workspaces/${WORKSPACE}/servers`, { headers: singularOwner });
    const ownerDetail = await fetch(serverUrl(baseUrl, created.serverId), { headers: singularOwner });
    assert.equal(ownerList.status, 200, 'the existing singular verified workspace claim remains valid');
    assert.equal(ownerDetail.status, 200, 'the existing singular verified workspace claim remains valid');

    const statusCallsBeforeProbe = statusCalls.length;
    const pluralOnlyAdjacent = authHeaders({
      workspaceId: null,
      pluralWorkspaceIds: [ADJACENT_WORKSPACE],
      correlationId: 'corr-mcp-plural-wrong-workspace',
    });
    const probes = [
      ['list', `${baseUrl}/v1/mcp/workspaces/${WORKSPACE}/servers`, { headers: pluralOnlyAdjacent }],
      ['detail', serverUrl(baseUrl, created.serverId), { headers: pluralOnlyAdjacent }],
      ['audit', serverUrl(baseUrl, created.serverId, '/audit'), { headers: pluralOnlyAdjacent }],
      ['rest', serverUrl(baseUrl, created.serverId, '/tool-calls'), {
        method: 'POST', headers: pluralOnlyAdjacent,
        body: JSON.stringify({ name: 'query_orders', arguments: {} }),
      }],
      ['rpc', serverUrl(baseUrl, created.serverId, '/rpc'), {
        method: 'POST', headers: pluralOnlyAdjacent,
        body: JSON.stringify({ jsonrpc: '2.0', id: 27, method: 'tools/call', params: { name: 'query_orders', arguments: {} } }),
      }],
    ];
    const observed = [];
    for (const [name, url, init] of probes) {
      const response = await fetch(url, init);
      observed.push({ name, status: response.status, body: await response.text() });
    }

    assert.deepEqual(
      observed.map(({ name, status }) => ({ name, status })),
      probes.map(([name]) => ({ name, status: 403 })),
      `a verified plural workspace_ids claim must bind every MCP route; observed ${JSON.stringify(observed)}`,
    );
    assert.ok(observed.every(({ body }) => !body.includes('KNATIVE')), 'denial must precede dependency disclosure');
    assert.equal(statusCalls.length, statusCallsBeforeProbe, 'denied probes must not inspect Knative readiness');
    assert.equal(invokeCalls.length, 0, 'denied REST/RPC probes must not dispatch a tool');
    assert.equal(fallbackCalls.length, 0, 'denied REST/RPC probes must not fall back to another runtime');
  }, { runtimeState: OUTAGE, mcpRuntimeAdapter: adapter });
});

function kubeResponse(statusCode, payload) {
  return { statusCode, body: JSON.stringify(payload) };
}

function ownedService(options = {}) {
  const uid = Object.hasOwn(options, 'uid') ? options.uid : 'uid-service-933';
  const resourceVersion = Object.hasOwn(options, 'resourceVersion') ? options.resourceVersion : '41';
  const metadata = {
    namespace: RUNTIME_NAMESPACE,
    name: 'mcp-orders-followup-933',
    labels: {
      'in-falcone.io/tenant': TENANT,
      'in-falcone.io/mcp-server': SERVER_ID,
    },
  };
  if (uid !== undefined) metadata.uid = uid;
  if (resourceVersion !== undefined) metadata.resourceVersion = resourceVersion;
  return { apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata };
}

function productionCleaner(fetchImpl) {
  return createMcpRuntimeCleaner({
    apiBase: 'https://kubernetes.invalid',
    readFile: serviceAccountReader([]),
    resolveRuntimeNamespace: () => RUNTIME_NAMESPACE,
    fetchImpl,
    env: {},
  });
}

test('bbx-933-mcp-cleaner-production-list-28: production Kubernetes JSON is precondition-deleted and absence-verified', async () => {
  const listCounts = new Map();
  const deleteCalls = [];
  const cleaner = productionCleaner(async (url, init) => {
    const value = String(url);
    if (init.method === 'DELETE') {
      deleteCalls.push({ url: value, body: JSON.parse(init.body) });
      return kubeResponse(200, { kind: 'Status', status: 'Success' });
    }
    const count = (listCounts.get(value) ?? 0) + 1;
    listCounts.set(value, count);
    const isServiceList = value.includes('/services?');
    return kubeResponse(200, { items: isServiceList && count === 1 ? [ownedService()] : [] });
  });

  const result = await cleaner.deleteOwnedRuntimeResources({ tenantId: TENANT, resourceId: SERVER_ID });
  assert.equal(result.deleted, true, 'cleanup may finalize only after the verified target is absent');
  assert.equal(deleteCalls.length, 1, 'the production List response must be parsed instead of treated as empty');
  assert.deepEqual(deleteCalls[0].body.preconditions, {
    uid: 'uid-service-933',
    resourceVersion: '41',
  });
  const serviceLists = [...listCounts].filter(([url]) => url.includes('/services?'));
  assert.equal(serviceLists[0]?.[1], 2, 'the cleaner must re-list after deletion to verify absence');
});

test('bbx-933-mcp-cleaner-fail-closed-29: Kubernetes 401, 403, and 500 list responses never become successful cleanup', async () => {
  const observed = [];
  for (const statusCode of [401, 403, 500]) {
    let deleteCalls = 0;
    const cleaner = productionCleaner(async (_url, init) => {
      if (init.method === 'DELETE') deleteCalls += 1;
      return kubeResponse(statusCode, {
        kind: 'Status', status: 'Failure', code: statusCode, reason: 'fixture_failure',
      });
    });
    try {
      const result = await cleaner.deleteOwnedRuntimeResources({ tenantId: TENANT, resourceId: SERVER_ID });
      observed.push({ statusCode, rejected: false, deleted: result?.deleted, deleteCalls });
    } catch {
      observed.push({ statusCode, rejected: true, deleted: false, deleteCalls });
    }
  }
  assert.deepEqual(observed, [401, 403, 500].map((statusCode) => ({
    statusCode, rejected: true, deleted: false, deleteCalls: 0,
  })), 'authorization and server failures must remain retryable cleanup failures');
});

test('bbx-933-mcp-cleaner-precondition-errors-30: unsafe metadata and delete conflicts cannot report cleanup complete', async () => {
  const cases = [
    { name: 'missing uid', item: ownedService({ uid: undefined }), deleteStatus: 200 },
    { name: 'missing resourceVersion', item: ownedService({ resourceVersion: undefined }), deleteStatus: 200 },
    { name: 'replacement conflict', item: ownedService(), deleteStatus: 409 },
  ];

  for (const fixture of cases) {
    const deleteCalls = [];
    const cleaner = productionCleaner(async (url, init) => {
      if (init.method === 'DELETE') {
        deleteCalls.push({ url: String(url), body: JSON.parse(init.body) });
        return kubeResponse(fixture.deleteStatus, {
          kind: 'Status', status: 'Failure', code: fixture.deleteStatus, reason: 'Conflict',
        });
      }
      const isServiceList = String(url).includes('/services?');
      return kubeResponse(200, { items: isServiceList ? [fixture.item] : [] });
    });
    let outcome;
    try {
      outcome = await cleaner.deleteOwnedRuntimeResources({ tenantId: TENANT, resourceId: SERVER_ID });
    } catch (error) {
      outcome = { deleted: false, rejected: true, message: error.message };
    }
    assert.notEqual(outcome?.deleted, true, `${fixture.name} must retain the logical owner for retry`);
    if (fixture.name.startsWith('missing')) {
      assert.equal(deleteCalls.length, 0, `${fixture.name} must never issue an unpreconditioned delete`);
    } else {
      assert.equal(deleteCalls.length, 1, 'the 409 fixture must reach the preconditioned delete boundary');
      assert.deepEqual(deleteCalls[0].body.preconditions, {
        uid: 'uid-service-933', resourceVersion: '41',
      });
    }
  }
});

test('bbx-933-mcp-cleanup-api-retention-31: missing preconditions and 409 retain deletion_pending through the public API', async () => {
  const fixtures = [
    { name: 'missing uid', uid: undefined, resourceVersion: '41', deleteStatus: 200 },
    { name: 'missing resourceVersion', uid: 'uid-service-933', resourceVersion: undefined, deleteStatus: 200 },
    { name: 'replacement conflict', uid: 'uid-service-933', resourceVersion: '41', deleteStatus: 409 },
  ];
  for (const fixture of fixtures) {
    const deleteCalls = [];
    const adapter = {
      async listOwned() {
        return [{
          kind: 'Service', namespace: TENANT, name: 'mcp-orders-followup-933',
          uid: fixture.uid, resourceVersion: fixture.resourceVersion,
        }];
      },
      async deleteOwned(input) {
        deleteCalls.push(input);
        return { status: fixture.deleteStatus, code: fixture.deleteStatus === 409 ? 'PRECONDITION_CONFLICT' : undefined };
      },
    };
    await withHarness(async ({ baseUrl, engine }) => {
      const created = await createDraft(engine, { name: `retention-${fixture.name.replaceAll(' ', '-')}` });
      const endpoint = serverUrl(baseUrl, created.serverId);
      const response = await fetch(endpoint, {
        method: 'DELETE', headers: authHeaders({ correlationId: `corr-${fixture.name.replaceAll(' ', '-')}` }),
      });
      assert.equal(response.status, 202, `${fixture.name} must be an honest pending deletion: ${await response.clone().text()}`);
      assert.equal((await response.json()).status, 'deletion_pending');

      const retained = await fetch(endpoint, { headers: authHeaders() });
      assert.equal(retained.status, 200, `${fixture.name} must retain the logical server for retry`);
      assert.equal((await retained.json()).lifecycleStatus, 'deletion_pending');
      if (fixture.uid === undefined || fixture.resourceVersion === undefined) {
        assert.equal(deleteCalls.length, 0, `${fixture.name} must never issue an unpreconditioned delete`);
      } else {
        assert.equal(deleteCalls.length, 1);
        assert.deepEqual(
          { uid: deleteCalls[0].uid, resourceVersion: deleteCalls[0].resourceVersion },
          { uid: fixture.uid, resourceVersion: fixture.resourceVersion },
        );
      }
    }, { mcpRuntimeAdapter: adapter });
  }
});

test('bbx-933-mcp-runtime-wire-context-32: hosted dispatch emits JSON-RPC with trusted context and strips smuggled ownership', async () => {
  const wireCalls = [];
  const productionAdapter = createMcpRuntimeAdapter({
    apiBase: 'https://kubernetes.invalid',
    runtimeImage: 'registry.invalid/falcone/mcp-runtime',
    runtimeImageDigest: DIGEST,
    env: {},
    readFile: serviceAccountReader([]),
    resolveRuntimeNamespace: () => RUNTIME_NAMESPACE,
    fetchImpl: async (url, init) => {
      const call = { url: String(url), init: structuredClone(init) };
      wireCalls.push(call);
      if (call.url.includes('.svc.cluster.local')) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], isError: false }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ kind: 'Status', status: 'Success' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });

  await withHarness(async ({ baseUrl, engine }) => {
    const created = await createDraft(engine, { name: 'wire-context-933' });
    await curate(engine, created.serverId);
    await publish(engine, created.serverId);
    wireCalls.length = 0;

    const response = await fetch(serverUrl(baseUrl, created.serverId, '/tool-calls'), {
      method: 'POST',
      headers: authHeaders({ correlationId: 'corr-mcp-wire-context-933' }),
      body: JSON.stringify({
        name: 'query_orders',
        arguments: {
          query: 'retained-value',
          tenantId: 'tenant-smuggled', tenant_id: 'tenant_smuggled',
          workspaceId: ADJACENT_WORKSPACE, workspace_id: 'workspace_smuggled',
        },
      }),
    });
    assert.equal(response.status, 200, `${response.status} ${await response.clone().text()}`);
    const runtimeCalls = wireCalls.filter(({ url }) => url.includes('.svc.cluster.local'));
    assert.equal(runtimeCalls.length, 1, `expected one hosted runtime call, got ${JSON.stringify(wireCalls)}`);

    const runtimeCall = runtimeCalls[0];
    const headers = new Headers(runtimeCall.init.headers);
    const envelope = JSON.parse(runtimeCall.init.body);
    assert.equal(envelope.jsonrpc, '2.0');
    assert.ok(envelope.id !== undefined && envelope.id !== null, 'tools/call must carry a JSON-RPC request id');
    assert.equal(envelope.method, 'tools/call');
    assert.equal(envelope.params?.name, 'query_orders');
    assert.deepEqual(envelope.params?.arguments, { query: 'retained-value' });
    assert.equal(headers.get('x-tenant-id'), TENANT);
    assert.equal(headers.get('x-workspace-id'), WORKSPACE);
    assert.match(headers.get('x-actor-roles') ?? '', /(?:^|,)workspace_owner(?:,|$)/);
    assert.match(headers.get('x-auth-scopes') ?? '', new RegExp(`(?:^|[ ,])${BASE_SCOPE.replaceAll(':', '\\:')}(?:[ ,]|$)`));
    assert.equal(headers.get('x-correlation-id'), 'corr-mcp-wire-context-933');
  }, { mcpRuntimeAdapter: productionAdapter });
});

test('bbx-933-mcp-review-reconcile-33: review-held publish waits for approval before reconciling its exact manifest', async () => {
  const applyCalls = [];
  const adapter = {
    async apply(input) { applyCalls.push(structuredClone(input)); return { status: 'accepted' }; },
  };
  await withHarness(async ({ engine }) => {
    const created = await createDraft(engine, { name: 'review-reconcile-933' });
    await curate(engine, created.serverId);
    const v1 = await publish(engine, created.serverId, 'v1');
    assert.equal(v1.status, 'active');
    assert.equal(applyCalls.length, 1);

    await curate(engine, created.serverId, {
      query_orders: { enabled: true, description: 'Changed description requiring review.' },
    });
    const v2 = await publish(engine, created.serverId, 'v2');
    assert.equal(v2.requiresReview, true);
    assert.equal(v2.status, 'requires_review');
    assert.equal(v2.activeVersion, 'v1');
    assert.equal(applyCalls.length, 1, 'a held version must not reconcile before approval');

    const approved = await engine.executeMcp({
      operation: 'approve_version', identity: OWNER, workspaceId: WORKSPACE,
      serverId: created.serverId, version: 'v2', body: {},
      correlationId: 'corr-mcp-approve-reconcile-933',
    });
    assert.equal(approved.activeVersion, 'v2');
    assert.equal(applyCalls.length, 2, 'approval must reconcile the newly approved version');
    const approvedApply = applyCalls[1];
    assert.equal(approvedApply.tenantId, TENANT);
    assert.equal(approvedApply.workspaceId, WORKSPACE);
    assert.equal(approvedApply.serverId, created.serverId);
    assert.equal(approvedApply.version, 'v2');
    assert.match(approvedApply.operation ?? '', /approv/i);
    assert.equal(approvedApply.correlationId, 'corr-mcp-approve-reconcile-933');
    assert.equal(approvedApply.runtimeImage, DIGEST);
    assert.equal(approvedApply.manifest?.tools?.find((tool) => tool.name === 'query_orders')?.description,
      'Changed description requiring review.');
  }, { mcpRuntimeAdapter: adapter });
});

const SERVICE_ACCOUNT_ROOT = '/var/run/secrets/kubernetes.io/serviceaccount';
const FIXTURE_CA = '-----BEGIN CERTIFICATE-----\nBBX-933-KUBERNETES-CA\n-----END CERTIFICATE-----\n';
const RUNTIME_NAMESPACE = 'runtime-tenant-933-a';

function serviceAccountReader(readPaths) {
  return (path) => {
    const value = String(path);
    readPaths.push(value);
    if (value === `${SERVICE_ACCOUNT_ROOT}/token`) return 'bbx-933-service-account-token';
    if (value === `${SERVICE_ACCOUNT_ROOT}/ca.crt`) return FIXTURE_CA;
    throw new Error(`unexpected serviceaccount read: ${value}`);
  };
}

function successfulKubeResponse() {
  return new Response(JSON.stringify({ kind: 'Status', status: 'Success' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function appliedObjects(calls) {
  return calls.flatMap(({ init }) => {
    if (typeof init?.body !== 'string') return [];
    try {
      const value = JSON.parse(init.body);
      return value?.apiVersion && value?.kind ? [value] : [];
    } catch {
      return [];
    }
  });
}

async function publishThrough(adapter, name) {
  await withHarness(async ({ engine }) => {
    const created = await createDraft(engine, { name });
    await curate(engine, created.serverId);
    const result = await publish(engine, created.serverId);
    assert.equal(result.status, 'active');
  }, { mcpRuntimeAdapter: adapter });
}

test('bbx-933-mcp-kube-ca-34: adapter and cleaner explicitly trust the mounted Kubernetes serviceaccount CA', async () => {
  const adapterReads = [];
  const adapterCalls = [];
  const adapter = createMcpRuntimeAdapter({
    apiBase: 'https://kubernetes.invalid',
    runtimeImage: 'registry.invalid/falcone/mcp-runtime',
    runtimeImageDigest: DIGEST,
    env: {},
    readFile: serviceAccountReader(adapterReads),
    resolveRuntimeNamespace: () => RUNTIME_NAMESPACE,
    fetchImpl: async (url, init = {}) => {
      adapterCalls.push({ url: String(url), init });
      return successfulKubeResponse();
    },
  });
  await publishThrough(adapter, 'explicit-kube-ca-933');

  const cleanerReads = [];
  const cleanerCalls = [];
  const cleaner = createMcpRuntimeCleaner({
    apiBase: 'https://kubernetes.invalid',
    env: {},
    readFile: serviceAccountReader(cleanerReads),
    resolveRuntimeNamespace: () => RUNTIME_NAMESPACE,
    fetchImpl: async (url, init = {}) => {
      cleanerCalls.push({ url: String(url), init });
      return kubeResponse(200, { items: [] });
    },
  });
  const cleanup = await cleaner.deleteOwnedRuntimeResources({ tenantId: TENANT, resourceId: SERVER_ID });
  assert.equal(cleanup.deleted, true);

  for (const [label, reads, calls] of [
    ['apply adapter', adapterReads, adapterCalls],
    ['cleanup adapter', cleanerReads, cleanerCalls],
  ]) {
    assert.ok(reads.includes(`${SERVICE_ACCOUNT_ROOT}/ca.crt`), `${label} did not read the mounted Kubernetes CA`);
    assert.ok(calls.length > 0, `${label} made no Kubernetes HTTPS request`);
    assert.ok(
      calls.every(({ init }) => init.dispatcher != null || init.agent != null),
      `${label} delegated Kubernetes TLS trust to ambient NODE_EXTRA_CA_CERTS`,
    );
  }
});

test('bbx-933-mcp-runtime-namespace-map-35: apply and cleaner share the authoritative tenant runtime-namespace mapping', async () => {
  const resolverCalls = [];
  const resolveRuntimeNamespace = ({ tenantId }) => {
    resolverCalls.push(tenantId);
    assert.equal(tenantId, TENANT);
    return RUNTIME_NAMESPACE;
  };
  const adapterCalls = [];
  const adapter = createMcpRuntimeAdapter({
    apiBase: 'https://kubernetes.invalid',
    runtimeImage: 'registry.invalid/falcone/mcp-runtime',
    runtimeImageDigest: DIGEST,
    env: {},
    readFile: serviceAccountReader([]),
    resolveRuntimeNamespace,
    fetchImpl: async (url, init = {}) => {
      adapterCalls.push({ url: String(url), init });
      return successfulKubeResponse();
    },
  });
  await publishThrough(adapter, 'authoritative-namespace-933');

  const cleanerCalls = [];
  const cleaner = createMcpRuntimeCleaner({
    apiBase: 'https://kubernetes.invalid',
    env: {},
    readFile: serviceAccountReader([]),
    resolveRuntimeNamespace,
    fetchImpl: async (url, init = {}) => {
      cleanerCalls.push({ url: String(url), init });
      return kubeResponse(200, { items: [] });
    },
  });
  await cleaner.deleteOwnedRuntimeResources({ tenantId: TENANT, resourceId: SERVER_ID });

  assert.ok(resolverCalls.length >= 2, 'apply and cleaner did not both consult the shared tenant→runtime namespace authority');
  const kubeUrls = [...adapterCalls, ...cleanerCalls].map(({ url }) => url);
  assert.ok(kubeUrls.length > 0);
  for (const url of kubeUrls) {
    assert.match(url, new RegExp(`/namespaces/${RUNTIME_NAMESPACE}(?:/|$)`), `Kubernetes request escaped the mapped namespace: ${url}`);
    assert.doesNotMatch(url, new RegExp(`/namespaces/${TENANT}(?:/|$)`), 'raw tenantId was used as a Kubernetes namespace');
  }
  const objects = appliedObjects(adapterCalls);
  assert.ok(objects.length > 0, 'publish reconciled no Kubernetes objects');
  assert.ok(objects.every((object) => object.metadata?.namespace === RUNTIME_NAMESPACE),
    `rendered resources escaped the authoritative namespace: ${JSON.stringify(objects)}`);
});

test('bbx-933-mcp-cluster-local-isolation-36: hosted MCP reconciliation is cluster-local and materially namespaced-isolated', async (t) => {
  const calls = [];
  const adapter = createMcpRuntimeAdapter({
    apiBase: 'https://kubernetes.invalid',
    runtimeImage: 'registry.invalid/falcone/mcp-runtime',
    runtimeImageDigest: DIGEST,
    env: {},
    readFile: serviceAccountReader([]),
    resolveRuntimeNamespace: () => RUNTIME_NAMESPACE,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return successfulKubeResponse();
    },
  });
  await publishThrough(adapter, 'cluster-local-isolation-933');
  const objects = appliedObjects(calls);
  const services = objects.filter((object) => object.apiVersion === 'serving.knative.dev/v1' && object.kind === 'Service');
  assert.equal(services.length, 1, `expected one hosted Knative Service, got ${JSON.stringify(objects)}`);
  const service = services[0];
  const serviceNamespace = service.metadata?.namespace;

  await t.test('Knative Service is cluster-local and does not mount Kubernetes credentials', () => {
    assert.equal(service.metadata?.labels?.['networking.knative.dev/visibility'], 'cluster-local',
      'hosted MCP Knative Service is externally visible instead of cluster-local');
    assert.equal(service.spec?.template?.spec?.automountServiceAccountToken, false,
      'hosted MCP runtime unnecessarily mounts Kubernetes API credentials');
  });

  await t.test('NetworkPolicy selects the exact hosted workload in the same mapped namespace', () => {
    const policies = objects.filter((object) => object.apiVersion === 'networking.k8s.io/v1' && object.kind === 'NetworkPolicy');
    assert.ok(policies.length > 0, 'hosted MCP reconciliation materialized no namespaced NetworkPolicy isolation');
    const templateLabels = service.spec?.template?.metadata?.labels ?? {};
    assert.ok(Object.keys(templateLabels).length > 0, 'hosted MCP revision exposes no stable isolation selector labels');
    assert.ok(policies.every((policy) => policy.metadata?.namespace === serviceNamespace));
    assert.ok(policies.some((policy) => {
      const selector = policy.spec?.podSelector?.matchLabels ?? {};
      return Object.keys(selector).length > 0
        && Object.entries(selector).every(([key, value]) => templateLabels[key] === value)
        && (policy.spec?.policyTypes ?? []).includes('Ingress');
    }), 'no ingress NetworkPolicy selects the exact hosted MCP revision labels');
  });

  await t.test('any reconciled RBAC remains namespace-local', () => {
    const rbac = objects.filter((object) => ['Role', 'RoleBinding', 'ServiceAccount'].includes(object.kind));
    assert.ok(rbac.every((object) => object.metadata?.namespace === serviceNamespace));
    for (const binding of rbac.filter((object) => object.kind === 'RoleBinding')) {
      assert.ok((binding.subjects ?? []).every((subject) => subject.kind !== 'ServiceAccount' || subject.namespace === serviceNamespace),
        'RoleBinding references a ServiceAccount outside the mapped runtime namespace');
    }
  });
});
