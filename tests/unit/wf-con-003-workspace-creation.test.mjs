import test from 'node:test';
import assert from 'node:assert/strict';

import { _resetForTest as resetIdempotencyStore } from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import { _resetForTest as resetJobStatus } from '../../apps/control-plane/src/workflows/job-status.mjs';
import handleWorkspaceCreation, {
  __resetWorkflowDependenciesForTest,
  __setWorkflowDependenciesForTest,
  runWorkspaceCreationAction
} from '../../apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs';

function request(overrides = {}) {
  return {
    workflowId: 'WF-CON-003',
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
    callerContext: {
      actor: 'tenant-owner-1',
      actorType: 'tenant_owner',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-3'
    },
    input: {
      workspaceName: 'Workspace One',
      workspaceSlug: 'workspace-one'
    },
    ...overrides,
    callerContext: {
      actor: 'tenant-owner-1',
      actorType: 'tenant_owner',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-3',
      ...(overrides.callerContext ?? {})
    },
    input: {
      workspaceName: 'Workspace One',
      workspaceSlug: 'workspace-one',
      ...(overrides.input ?? {})
    }
  };
}

test.afterEach(() => {
  resetIdempotencyStore();
  resetJobStatus();
  __resetWorkflowDependenciesForTest();
});

test('non-tenant_owner role is rejected before provisioning', async () => {
  let dispatched = 0;
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      dispatched += 1;
      return { activationId: 'act-1' };
    }
  });

  const result = await handleWorkspaceCreation(request({ callerContext: { actorType: 'workspace_admin' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
  assert.equal(dispatched, 0);
});

test('tenant_owner request returns pending jobRef', async () => {
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    }
  });

  const result = await handleWorkspaceCreation(request());
  assert.equal(result.status, 'pending');
  assert.match(result.jobRef, /^wf_job_WF-CON-003_/);
});

test('async action runs keycloak, postgres, and storage steps in order', async () => {
  const calls = [];
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    },
    async createClient() {
      calls.push('createClient');
      return { clientId: 'workspace-client' };
    },
    async writeWorkspaceRecord() {
      calls.push('writeWorkspaceRecord');
      return { workspaceId: 'workspace-one' };
    },
    async provisionWorkspaceStorageBoundary() {
      calls.push('provisionWorkspaceStorageBoundary');
      return { boundaryId: 'boundary-1' };
    }
  });

  const pending = await handleWorkspaceCreation(request());
  const result = await runWorkspaceCreationAction({ ...request(), jobRef: pending.jobRef });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(calls, ['createClient', 'writeWorkspaceRecord', 'provisionWorkspaceStorageBoundary']);
});

test('storage failure marks provision_storage_boundary', async () => {
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    },
    async createClient() {
      return { clientId: 'workspace-client' };
    },
    async writeWorkspaceRecord() {
      return { workspaceId: 'workspace-one' };
    },
    async provisionWorkspaceStorageBoundary() {
      const error = new Error('storage unavailable');
      error.failedStep = 'provision_storage_boundary';
      throw error;
    }
  });

  const pending = await handleWorkspaceCreation(request());
  const result = await runWorkspaceCreationAction({ ...request(), jobRef: pending.jobRef });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary.failedStep, 'provision_storage_boundary');
});

test('cross-tenant requests are rejected', async () => {
  const result = await handleWorkspaceCreation(request({ callerContext: { requestTenantId: 'tenant-2' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});
