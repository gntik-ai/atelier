import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

const NOW = '2026-08-07T10:00:00.000Z';
const WORKSPACE = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app' };
const ACTION = {
  resource_id: 'fn-a',
  workspace_id: WORKSPACE.id,
  tenant_id: WORKSPACE.tenant_id,
  action_name: 'hello',
  source_code: 'export function main() {}',
  memory_mb: 256,
  timeout_ms: 60_000,
  ksvc_name: 'fn-app-hello-a',
  version: 2,
};
const HISTORICAL_VERSION = {
  ...ACTION,
  version_id: 'fnv_1',
  version_number: 1,
  status: 'historical',
};

const WORKSPACE_DEVELOPER = {
  sub: 'developer-a',
  tenantId: WORKSPACE.tenant_id,
  workspaceId: WORKSPACE.id,
  workspaceIds: [WORKSPACE.id],
  actorType: 'tenant_member',
  roles: ['workspace_developer'],
  scopes: [],
};

function fakeStore(calls) {
  return {
    getWorkspace: async (_pool, id) => id === WORKSPACE.id ? WORKSPACE : null,
    getFnAction: async (_pool, id, tenantId) => (
      id === ACTION.resource_id && (tenantId == null || tenantId === ACTION.tenant_id)
        ? ACTION
        : null
    ),
    upsertFnAction: async (_pool, input) => {
      calls.push({ kind: 'write', input });
      return { ...ACTION, resource_id: input.resourceId, workspace_id: input.workspaceId };
    },
    deleteFnAction: async () => {
      calls.push({ kind: 'logical-delete' });
      return ACTION;
    },
    listFnActionVersions: async () => [
      { ...ACTION, version_id: 'fnv_2', version_number: 2, status: 'active' },
      HISTORICAL_VERSION,
    ],
    activateFnActionVersion: async () => {
      calls.push({ kind: 'activate-version' });
      return ACTION;
    },
  };
}

function runtime({ ready }, calls) {
  return {
    functionsEnabled: true,
    status() {
      calls.push({ kind: 'runtime-status' });
      return {
        mode: 'managed',
        state: ready ? 'ready' : 'degraded',
        reason: ready ? 'READY' : 'CONTROL_PLANE_NOT_READY',
      };
    },
    canServeWorkloads: () => ready,
  };
}

function context(identity, { ready = true, params = {}, body = {} } = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      pool: {},
      params,
      body,
      query: {},
      identity,
      callerContext: {
        correlationId: 'corr-function-a',
        tenantId: identity.tenantId,
        workspaceId: identity.workspaceId ?? null,
      },
      store: fakeStore(calls),
      knativeRuntime: runtime({ ready }, calls),
      deployKnativeService: async () => { calls.push({ kind: 'deploy' }); },
      deleteKnativeService: async () => { calls.push({ kind: 'runtime-delete' }); },
    },
  };
}

const MUTATIONS = [
  {
    name: 'create',
    run: (ctx) => FN_HANDLERS.fnDeploy(ctx),
    input: {
      body: {
        workspaceId: WORKSPACE.id,
        actionName: ACTION.action_name,
        source: { inlineCode: ACTION.source_code },
      },
    },
  },
  {
    name: 'update',
    run: (ctx) => FN_HANDLERS.fnDeploy(ctx),
    input: {
      params: { actionId: ACTION.resource_id },
      body: {
        workspaceId: WORKSPACE.id,
        actionName: ACTION.action_name,
        source: { inlineCode: 'export function main() { return 2; }' },
      },
    },
  },
  {
    name: 'delete',
    run: (ctx) => FN_HANDLERS.fnDelete(ctx),
    input: { params: { actionId: ACTION.resource_id } },
  },
  {
    name: 'rollback',
    run: (ctx) => FN_HANDLERS.fnRollback(ctx),
    input: {
      params: { actionId: ACTION.resource_id },
      body: { versionId: HISTORICAL_VERSION.version_id },
    },
  },
];

test('function-mutation-auth-01: viewer and wrong-workspace claims are denied before runtime disclosure or side effects', async () => {
  const deniedIdentities = [
    {
      ...WORKSPACE_DEVELOPER,
      sub: 'viewer-a',
      actorType: 'tenant_member',
      roles: ['workspace_viewer'],
    },
    {
      ...WORKSPACE_DEVELOPER,
      sub: 'developer-other-workspace',
      workspaceId: 'ws-b',
      workspaceIds: ['ws-b'],
    },
  ];

  for (const identity of deniedIdentities) {
    for (const mutation of MUTATIONS) {
      const { ctx, calls } = context(identity, { ready: false, ...mutation.input });
      const result = await mutation.run(ctx);

      assert.equal(result.statusCode, 403, `${mutation.name} must deny ${identity.sub}`);
      assert.equal(result.body.code, 'FORBIDDEN');
      assert.equal(
        calls.some(({ kind }) => kind === 'runtime-status'),
        false,
        `${mutation.name} must authorize before disclosing runtime readiness`,
      );
      assert.equal(
        calls.some(({ kind }) => ['deploy', 'runtime-delete', 'logical-delete', 'write', 'activate-version'].includes(kind)),
        false,
        `${mutation.name} must deny before mutation side effects`,
      );
    }
  }
});

test('function-mutation-auth-02: a workspace developer bound to the target workspace may perform all Function mutations', async () => {
  for (const mutation of MUTATIONS) {
    const { ctx } = context(WORKSPACE_DEVELOPER, mutation.input);
    const result = await mutation.run(ctx);
    assert.equal(result.statusCode, 202, `${mutation.name} must accept a bound workspace developer`);
  }
});

test('function-mutation-auth-03: tenant and platform/internal mutation bypasses remain available', async () => {
  const bypasses = [
    {
      ...WORKSPACE_DEVELOPER,
      sub: 'tenant-owner-a',
      workspaceId: null,
      workspaceIds: [],
      actorType: 'tenant_owner',
      roles: ['tenant_owner'],
    },
    {
      ...WORKSPACE_DEVELOPER,
      sub: 'platform-control-plane',
      tenantId: null,
      workspaceId: null,
      workspaceIds: [],
      actorType: 'internal',
      roles: ['platform_operator'],
    },
  ];

  for (const identity of bypasses) {
    const { ctx } = context(identity, MUTATIONS[0].input);
    const result = await FN_HANDLERS.fnDeploy(ctx);
    assert.equal(result.statusCode, 202, `create must preserve the ${identity.sub} bypass`);
  }
});

test('function-success-contract-01: create and update emit the exact Function GatewayMutationAccepted constants', async () => {
  for (const mutation of MUTATIONS.slice(0, 2)) {
    const { ctx } = context(WORKSPACE_DEVELOPER, mutation.input);
    const result = await mutation.run(ctx);

    assert.equal(result.statusCode, 202);
    assert.deepEqual(Object.keys(result.body).sort(), [
      'acceptedAt',
      'correlationId',
      'family',
      'requestId',
      'resourceId',
      'resourceType',
      'status',
    ]);
    assert.equal(result.body.family, 'functions');
    assert.equal(result.body.resourceType, 'function_action');
    assert.equal(result.body.status, 'accepted');
    assert.equal(result.body.correlationId, 'corr-function-a');
  }
});
