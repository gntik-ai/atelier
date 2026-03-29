import test from 'node:test';
import assert from 'node:assert/strict';

import handleUserApproval from '../../apps/control-plane/src/workflows/wf-con-001-user-approval.mjs';
import handleTenantProvisioning from '../../apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs';
import handleWorkspaceCreation from '../../apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs';
import handleCredentialGeneration from '../../apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs';
import handleServiceAccountLifecycle from '../../apps/control-plane/src/workflows/wf-con-006-service-account.mjs';
import { resolveWorkflowHandler, WorkflowNotFoundError } from '../../apps/control-plane/src/workflows/index.mjs';
import { _resetForTest as resetIdempotencyStore } from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import { _resetForTest as resetJobStatus } from '../../apps/control-plane/src/workflows/job-status.mjs';

function baseRequest(workflowId, actorType = 'workspace_admin') {
  return {
    workflowId,
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
    callerContext: {
      actor: 'actor-1',
      actorType,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-auth'
    },
    input: {}
  };
}

test.afterEach(() => {
  resetIdempotencyStore();
  resetJobStatus();
});

test('cross-tenant token is rejected for WF-CON-001', async () => {
  const result = await handleUserApproval({
    ...baseRequest('WF-CON-001'),
    callerContext: { ...baseRequest('WF-CON-001').callerContext, requestWorkspaceId: 'workspace-2' },
    input: { userId: 'user-1', targetWorkspaceId: 'workspace-1', requestedRole: 'workspace_admin' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('cross-tenant token is rejected for WF-CON-003', async () => {
  const result = await handleWorkspaceCreation({
    ...baseRequest('WF-CON-003', 'tenant_owner'),
    callerContext: { ...baseRequest('WF-CON-003', 'tenant_owner').callerContext, requestTenantId: 'tenant-2' },
    input: { workspaceName: 'Workspace One', workspaceSlug: 'workspace-one' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('cross-tenant token is rejected for WF-CON-004', async () => {
  const result = await handleCredentialGeneration({
    ...baseRequest('WF-CON-004'),
    callerContext: { ...baseRequest('WF-CON-004').callerContext, requestWorkspaceId: 'workspace-2' },
    input: { credentialAction: 'generate', targetWorkspaceId: 'workspace-1' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('cross-tenant token is rejected for WF-CON-006', async () => {
  const result = await handleServiceAccountLifecycle({
    ...baseRequest('WF-CON-006'),
    callerContext: { ...baseRequest('WF-CON-006').callerContext, requestWorkspaceId: 'workspace-2' },
    input: { serviceAccountAction: 'create', targetWorkspaceId: 'workspace-1' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('tenant_member role is rejected for WF-CON-001', async () => {
  const result = await handleUserApproval({
    ...baseRequest('WF-CON-001', 'tenant_member'),
    input: { userId: 'user-1', targetWorkspaceId: 'workspace-1', requestedRole: 'workspace_admin' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('workspace_admin role is rejected for WF-CON-002', async () => {
  const result = await handleTenantProvisioning({
    ...baseRequest('WF-CON-002', 'workspace_admin'),
    input: { tenantSlug: 'tenant-one', tenantDisplayName: 'Tenant One', adminEmail: 'admin@example.com' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('workspace_admin role is rejected for WF-CON-003', async () => {
  const result = await handleWorkspaceCreation({
    ...baseRequest('WF-CON-003', 'workspace_admin'),
    input: { workspaceName: 'Workspace One', workspaceSlug: 'workspace-one' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('tenant_owner is rejected for WF-CON-002', async () => {
  const result = await handleTenantProvisioning({
    ...baseRequest('WF-CON-002', 'tenant_owner'),
    input: { tenantSlug: 'tenant-one', tenantDisplayName: 'Tenant One', adminEmail: 'admin@example.com' }
  });
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('unknown workflowId returns WorkflowNotFoundError', async () => {
  await assert.rejects(() => resolveWorkflowHandler('WF-CON-099'), WorkflowNotFoundError);
});

test('WF-CON-005 returns notImplemented extension point', async () => {
  const handler = await resolveWorkflowHandler('WF-CON-005');
  assert.deepEqual(handler, { notImplemented: true });
});

test('invalid invocation request returns INVALID_REQUEST', async () => {
  const result = await handleUserApproval({
    workflowId: 'WF-CON-001',
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
    callerContext: {
      actor: 'actor-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      correlationId: 'corr-auth'
    },
    input: { userId: 'user-1' }
  });
  assert.equal(result.errorSummary.code, 'INVALID_REQUEST');
});
