import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FUNCTION_OWNERSHIP_LABELS,
  buildFunctionKsvcManifest,
  buildFunctionOwnershipLabels,
  deleteKnativeService,
  deployKnativeService,
} from '../../apps/control-plane/function-executor.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

const OWNERSHIP = { tenantId: 'tenant-a', functionResourceId: 'fn_aaaaaaaaaaaa' };

function statusError(statusCode) {
  return Object.assign(new Error(`Kubernetes ${statusCode}`), { statusCode });
}

test('managed-function-ownership-01: creation stamps stable Kubernetes-valid ownership labels', () => {
  const labels = buildFunctionOwnershipLabels(OWNERSHIP);
  assert.deepEqual(labels, {
    [FUNCTION_OWNERSHIP_LABELS.tenant]: OWNERSHIP.tenantId,
    [FUNCTION_OWNERSHIP_LABELS.functionResource]: OWNERSHIP.functionResourceId,
  });
  const awkward = {
    tenantId: `Tenant With Spaces/${'x'.repeat(80)}`,
    functionResourceId: `Function:${'y'.repeat(80)}`,
  };
  const encoded = buildFunctionOwnershipLabels(awkward);
  assert.deepEqual(encoded, buildFunctionOwnershipLabels(awkward));
  for (const value of Object.values(encoded)) {
    assert.ok(value.length <= 63);
    assert.match(value, /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])$/);
  }

  const manifest = buildFunctionKsvcManifest('fn-app-hello-abc', 'export function main() {}', OWNERSHIP);
  for (const [key, value] of Object.entries(labels)) {
    assert.equal(manifest.metadata.labels[key], value);
    assert.equal(manifest.spec.template.metadata.labels[key], value);
  }
});

test('managed-function-ownership-02: matching cleanup verifies both labels and uses a preconditioned delete', async () => {
  const calls = [];
  const labels = buildFunctionOwnershipLabels(OWNERSHIP);
  const result = await deleteKnativeService('fn-app-hello-abc', {
    ...OWNERSHIP,
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return method === 'GET' ? {
        metadata: { labels, uid: 'uid-a', resourceVersion: '7' },
      } : {};
    },
  });
  assert.deepEqual(result, { deleted: true, retained: false, reason: 'deleted' });
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'DELETE']);
  assert.ok(calls[1].path.endsWith('/services/fn-app-hello-abc'));
  assert.deepEqual(calls[1].body.preconditions, { uid: 'uid-a', resourceVersion: '7' });
});

test('managed-function-ownership-03: missing or mismatched ownership retains the live Service', async () => {
  for (const labels of [
    {},
    { [FUNCTION_OWNERSHIP_LABELS.tenant]: OWNERSHIP.tenantId },
    {
      [FUNCTION_OWNERSHIP_LABELS.tenant]: 'tenant-b',
      [FUNCTION_OWNERSHIP_LABELS.functionResource]: OWNERSHIP.functionResourceId,
    },
    {
      [FUNCTION_OWNERSHIP_LABELS.tenant]: OWNERSHIP.tenantId,
      [FUNCTION_OWNERSHIP_LABELS.functionResource]: 'fn_bbbbbbbbbbbb',
    },
  ]) {
    const calls = [];
    await assert.rejects(
      () => deleteKnativeService('fn-app-hello-abc', {
        ...OWNERSHIP,
        request: async (method, path) => {
          calls.push({ method, path });
          return { metadata: { labels } };
        },
      }),
      (error) => error?.code === 'FN_RUNTIME_OWNERSHIP_MISMATCH'
        && error?.statusCode === 409
        && error?.retained === true
        && error?.reason === 'ownership_mismatch',
    );
    assert.deepEqual(calls.map(({ method }) => method), ['GET']);
  }
});

test('managed-function-ownership-04: absent resources are idempotent and absent identity fails closed', async () => {
  const calls = [];
  const result = await deleteKnativeService('fn-app-hello-abc', {
    ...OWNERSHIP,
    request: async (method, path) => {
      calls.push({ method, path });
      throw statusError(404);
    },
  });
  assert.deepEqual(result, { deleted: false, retained: false, reason: 'not_found' });
  assert.deepEqual(calls.map(({ method }) => method), ['GET']);

  let unsafeCalls = 0;
  await assert.rejects(
    () => deleteKnativeService('fn-app-hello-abc', {
      request: async () => { unsafeCalls += 1; },
    }),
    /tenantId is required/i,
  );
  assert.equal(unsafeCalls, 0);
});

test('managed-function-ownership-05: deploy never patches a same-named mismatched Service', async () => {
  const calls = [];
  await assert.rejects(
    () => deployKnativeService('fn-app-hello-abc', 'export function main() {}', {
      ...OWNERSHIP,
      request: async (method, path) => {
        calls.push({ method, path });
        if (method === 'POST') throw statusError(409);
        if (method === 'GET') {
          return {
            metadata: {
              resourceVersion: '7',
              labels: {
                [FUNCTION_OWNERSHIP_LABELS.tenant]: 'tenant-b',
                [FUNCTION_OWNERSHIP_LABELS.functionResource]: OWNERSHIP.functionResourceId,
              },
            },
          };
        }
        assert.fail('mismatched ownership must not reach PATCH');
      },
    }),
    (error) => error?.code === 'FN_RUNTIME_OWNERSHIP_MISMATCH' && error?.statusCode === 409,
  );
  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET']);
});

test('managed-function-ownership-06: immediate deletion forwards the stored tenant and Function identity', async () => {
  const action = {
    resource_id: OWNERSHIP.functionResourceId,
    tenant_id: OWNERSHIP.tenantId,
    workspace_id: 'workspace-a',
    ksvc_name: 'fn-app-hello-abc',
  };
  const calls = [];
  const result = await FN_HANDLERS.fnDelete({
    params: { actionId: action.resource_id },
    identity: {
      sub: 'owner-a',
      tenantId: action.tenant_id,
      actorType: 'tenant_owner',
      roles: ['tenant_owner'],
    },
    callerContext: { correlationId: 'corr-a' },
    pool: {},
    knativeRuntime: {
      functionsEnabled: true,
      status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }),
      canServeWorkloads: () => true,
    },
    store: {
      getFnAction: async () => action,
      deleteFnAction: async () => action,
    },
    deleteKnativeService: async (name, ownership) => calls.push({ name, ownership }),
  });
  assert.equal(result.statusCode, 202);
  assert.deepEqual(calls, [{
    name: action.ksvc_name,
    ownership: OWNERSHIP,
  }]);
});

test('managed-function-ownership-07: creation forwards one stable tenant and Function identity', async () => {
  const workspace = { id: 'workspace-a', tenant_id: OWNERSHIP.tenantId, slug: 'app' };
  const deploys = [];
  const writes = [];
  const result = await FN_HANDLERS.fnDeploy({
    params: {},
    body: {
      workspaceId: workspace.id,
      actionName: 'hello',
      source: { inlineCode: 'export function main() {}' },
    },
    identity: {
      sub: 'owner-a', tenantId: workspace.tenant_id, actorType: 'tenant_owner', roles: ['tenant_owner'],
    },
    callerContext: { correlationId: 'corr-a' },
    pool: {},
    knativeRuntime: {
      functionsEnabled: true,
      status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }),
      canServeWorkloads: () => true,
    },
    store: {
      getWorkspace: async () => workspace,
      upsertFnAction: async (_pool, input) => {
        writes.push(input);
        return { resource_id: input.resourceId };
      },
    },
    deployKnativeService: async (_name, _source, options) => deploys.push(options),
  });
  assert.equal(result.statusCode, 201);
  assert.equal(deploys.length, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(
    { tenantId: deploys[0].tenantId, functionResourceId: deploys[0].functionResourceId },
    { tenantId: workspace.tenant_id, functionResourceId: writes[0].resourceId },
  );
});

test('managed-function-ownership-08: immediate mismatch retains both runtime and logical state', async () => {
  const action = {
    resource_id: OWNERSHIP.functionResourceId,
    tenant_id: OWNERSHIP.tenantId,
    workspace_id: 'workspace-a',
    ksvc_name: 'fn-app-hello-abc',
  };
  let logicalDeletes = 0;
  const result = await FN_HANDLERS.fnDelete({
    params: { actionId: action.resource_id },
    identity: {
      sub: 'owner-a',
      tenantId: action.tenant_id,
      actorType: 'tenant_owner',
      roles: ['tenant_owner'],
    },
    callerContext: { correlationId: 'corr-a' },
    pool: {},
    knativeRuntime: {
      functionsEnabled: true,
      status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }),
      canServeWorkloads: () => true,
    },
    store: {
      getFnAction: async () => action,
      deleteFnAction: async () => { logicalDeletes += 1; },
    },
    deleteKnativeService: async () => {
      throw Object.assign(new Error('retained'), {
        code: 'FN_RUNTIME_OWNERSHIP_MISMATCH', statusCode: 409, retained: true,
      });
    },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'FN_DELETE_FAILED');
  assert.equal(logicalDeletes, 0);
});
