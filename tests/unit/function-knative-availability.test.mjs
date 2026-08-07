import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

const NOW = '2026-08-07T10:00:00.000Z';
const WS = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app', created_at: NOW };
const ACTION = {
  resource_id: 'fn-a', workspace_id: 'ws-a', tenant_id: 'tenant-a', action_name: 'hello',
  source_code: 'export function main(){}', runtime: 'nodejs:22', entrypoint: 'main',
  parameters: null, memory_mb: 256, timeout_ms: 60000, ksvc_name: 'fn-app-hello-abcd',
  version: 1, lifecycle_status: 'active', created_at: NOW, updated_at: NOW,
};
const IDENTITY = {
  sub: 'developer-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner',
  roles: ['workspace_owner'], scopes: [],
};
const UNAVAILABLE = {
  mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY',
  owner: 'falcone-managed', version: '1.22.1', compatibility: 'compatible',
  stage: 'serving', lastTransitionAt: NOW,
};
const unavailableRuntime = {
  functionsEnabled: true,
  status: () => UNAVAILABLE,
  canServeWorkloads: () => false,
};

function store(overrides = {}) {
  return {
    getWorkspace: async (_pool, id) => id === 'ws-a' ? WS : null,
    getFnAction: async (_pool, id, tenantId) => id === ACTION.resource_id && tenantId === ACTION.tenant_id ? ACTION : null,
    listFnActionVersions: async () => [{
      ...ACTION, version_id: 'ver-0', version_number: 0, status: 'historical',
    }],
    getFnActionVersion: async () => ({
      ...ACTION, version_id: 'ver-0', version_number: 0, status: 'historical',
    }),
    getFnActionVersionSummary: async () => ({ activeVersionId: 'ver-1', versionCount: 2, rollbackAvailable: true }),
    latestFnActivation: async () => null,
    ...overrides,
  };
}

function context({ params = {}, body = {}, runtime = unavailableRuntime, storeOverrides = {}, extra = {} } = {}) {
  return {
    params, body, query: {}, identity: IDENTITY, pool: {}, store: store(storeOverrides),
    knativeRuntime: runtime,
    callerContext: { correlationId: 'corr-a', tenantId: 'tenant-a', workspaceId: 'ws-a' },
    ...extra,
  };
}

test('function-knative-01: deploy gates before any Knative or registry mutation', async () => {
  let deploys = 0;
  let writes = 0;
  const result = await FN_HANDLERS.fnDeploy(context({
    body: { workspaceId: 'ws-a', actionName: 'hello', source: { inlineCode: 'main' } },
    storeOverrides: { upsertFnAction: async () => { writes += 1; } },
    extra: { deployKnativeService: async () => { deploys += 1; } },
  }));
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'KNATIVE_UNAVAILABLE');
  assert.equal(result.body.correlationId, 'corr-a');
  assert.equal(deploys, 0);
  assert.equal(writes, 0);
});

test('function-knative-02: invoke gates before readiness probe, invocation, or activation write', async () => {
  let readinessChecks = 0;
  let activations = 0;
  const result = await FN_HANDLERS.fnInvoke(context({
    params: { actionId: 'fn-a' },
    storeOverrides: { insertFnActivation: async () => { activations += 1; } },
    extra: { waitKsvcReady: async () => { readinessChecks += 1; return true; } },
  }));
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'KNATIVE_UNAVAILABLE');
  assert.equal(readinessChecks, 0);
  assert.equal(activations, 0);
});

test('function-knative-03: rollback gates before deployment or version activation', async () => {
  let deploys = 0;
  let activations = 0;
  const result = await FN_HANDLERS.fnRollback(context({
    params: { actionId: 'fn-a' }, body: { versionId: 'ver-0' },
    storeOverrides: { activateFnActionVersion: async () => { activations += 1; } },
    extra: { deployKnativeService: async () => { deploys += 1; } },
  }));
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'KNATIVE_UNAVAILABLE');
  assert.equal(deploys, 0);
  assert.equal(activations, 0);
});

test('function-knative-04: intentionally disabled Functions retains 501 precedence', async () => {
  const result = await FN_HANDLERS.fnDeploy(context({
    body: { workspaceId: 'ws-a', actionName: 'hello', source: { inlineCode: 'main' } },
    runtime: { ...unavailableRuntime, functionsEnabled: false },
  }));
  assert.equal(result.statusCode, 501);
  assert.deepEqual(result.body, {
    code: 'FUNCTIONS_DISABLED',
    message: 'Functions capability is disabled.',
    correlationId: 'corr-a',
  });
});

test('function-knative-05: outage delete persists one obligation and returns deletion_pending without Knative mutation', async () => {
  let deletes = 0;
  const obligations = [];
  const result = await FN_HANDLERS.fnDelete(context({
    params: { actionId: 'fn-a' },
    extra: {
      deleteKnativeService: async () => { deletes += 1; },
      runtimeCleanupRepository: {
        deferFunctionDeletion: async (input) => {
          obligations.push(input);
          return { ...input, correlationId: input.correlationId, status: 'pending' };
        },
      },
    },
  }));
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.status, 'deletion_pending');
  assert.equal(result.body.correlationId, 'corr-a');
  assert.equal(deletes, 0);
  assert.equal(obligations.length, 1);
  assert.deepEqual(obligations[0], {
    tenantId: 'tenant-a', workspaceId: 'ws-a', resourceId: 'fn-a',
    runtimeResourceName: 'fn-app-hello-abcd', correlationId: 'corr-a',
  });
});

test('function-knative-06: degraded metadata remains scoped and never reports workload ready', async () => {
  const result = await FN_HANDLERS.fnActionDetail(context({ params: { actionId: 'fn-a' } }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.tenantId, 'tenant-a');
  assert.equal(result.body.status, 'unavailable');
  assert.deepEqual(result.body.runtimeDependency, {
    mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY', ready: false,
  });
  assert.equal(result.body.provisioning.state, 'unavailable');
  assert.ok(!JSON.stringify(result.body).includes('falcone-managed'));
});
