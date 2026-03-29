import test from 'node:test';
import assert from 'node:assert/strict';

import { _resetForTest as resetIdempotencyStore } from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import handleServiceAccountLifecycle, {
  __resetWorkflowDependenciesForTest,
  __setWorkflowDependenciesForTest
} from '../../apps/control-plane/src/workflows/wf-con-006-service-account.mjs';

function request(overrides = {}) {
  return {
    workflowId: 'WF-CON-006',
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    callerContext: {
      actor: 'workspace-admin-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-6'
    },
    input: {
      serviceAccountAction: 'create',
      targetWorkspaceId: 'workspace-1',
      serviceAccountId: 'sa-1'
    },
    ...overrides,
    callerContext: {
      actor: 'workspace-admin-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-6',
      ...(overrides.callerContext ?? {})
    },
    input: {
      serviceAccountAction: 'create',
      targetWorkspaceId: 'workspace-1',
      serviceAccountId: 'sa-1',
      ...(overrides.input ?? {})
    }
  };
}

test.afterEach(() => {
  resetIdempotencyStore();
  __resetWorkflowDependenciesForTest();
});

test('create writes a service account record', async () => {
  __setWorkflowDependenciesForTest({
    async createServiceAccount() {
      return { serviceAccountId: 'sa-1' };
    },
    async writeServiceAccountRecord() {
      return { recordId: 'record-1', serviceAccountId: 'sa-1' };
    }
  });

  const result = await handleServiceAccountLifecycle(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.serviceAccountId, 'sa-1');
});

test('scope updates service account bindings', async () => {
  __setWorkflowDependenciesForTest({
    async updateServiceAccountScopeBindings() {
      return { bindingId: 'binding-1' };
    },
    async writeServiceAccountRecord() {
      return { recordId: 'record-1', serviceAccountId: 'sa-1' };
    }
  });

  const result = await handleServiceAccountLifecycle(request({ input: { serviceAccountAction: 'scope', targetWorkspaceId: 'workspace-1', serviceAccountId: 'sa-1', scopeBindings: ['read'] } }));
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output.scopeBindings, ['read']);
});

test('rotate exposes credential once and replay returns null', async () => {
  __setWorkflowDependenciesForTest({
    async regenerateServiceAccountCredentials() {
      return { serviceAccountId: 'sa-1', credentialId: 'cred-1', credential: 'secret-1' };
    },
    async writeServiceAccountRecord() {
      return { recordId: 'record-1', serviceAccountId: 'sa-1', credentialId: 'cred-1' };
    }
  });

  const first = await handleServiceAccountLifecycle(request({
    idempotencyKey: '67666666-6666-4666-8666-666666666666',
    input: { serviceAccountAction: 'rotate', targetWorkspaceId: 'workspace-1', serviceAccountId: 'sa-1' }
  }));
  const replay = await handleServiceAccountLifecycle(request({
    idempotencyKey: '67666666-6666-4666-8666-666666666666',
    input: { serviceAccountAction: 'rotate', targetWorkspaceId: 'workspace-1', serviceAccountId: 'sa-1' }
  }));

  assert.equal(first.output.credential, 'secret-1');
  assert.equal(replay.output.credential, null);
});

test('deactivate marks account inactive', async () => {
  __setWorkflowDependenciesForTest({
    async disableServiceAccount() {
      return { serviceAccountId: 'sa-1' };
    },
    async writeServiceAccountRecord() {
      return { recordId: 'record-1', serviceAccountId: 'sa-1' };
    }
  });

  const result = await handleServiceAccountLifecycle(request({ input: { serviceAccountAction: 'deactivate', targetWorkspaceId: 'workspace-1', serviceAccountId: 'sa-1' } }));
  assert.equal(result.output.state, 'inactive');
});

test('delete marks account deleted', async () => {
  __setWorkflowDependenciesForTest({
    async deleteServiceAccount() {
      return { serviceAccountId: 'sa-1' };
    },
    async writeServiceAccountRecord() {
      return { recordId: 'record-1', serviceAccountId: 'sa-1' };
    }
  });

  const result = await handleServiceAccountLifecycle(request({ input: { serviceAccountAction: 'delete', targetWorkspaceId: 'workspace-1', serviceAccountId: 'sa-1' } }));
  assert.equal(result.output.state, 'deleted');
});

test('cross-tenant and under-privileged requests are forbidden', async () => {
  const crossTenant = await handleServiceAccountLifecycle(request({ callerContext: { requestWorkspaceId: 'workspace-2' } }));
  const underPrivileged = await handleServiceAccountLifecycle(request({ callerContext: { actorType: 'tenant_member' } }));
  assert.equal(crossTenant.errorSummary.code, 'FORBIDDEN');
  assert.equal(underPrivileged.errorSummary.code, 'FORBIDDEN');
});

test('auditFields list mutated resources', async () => {
  __setWorkflowDependenciesForTest({
    async createServiceAccount() {
      return { serviceAccountId: 'sa-1' };
    },
    async writeServiceAccountRecord() {
      return { recordId: 'record-1', serviceAccountId: 'sa-1' };
    }
  });

  const result = await handleServiceAccountLifecycle(request());
  assert.deepEqual(
    result.auditFields.affectedResources.map((entry) => entry.type),
    ['keycloak_service_account', 'service_account_record']
  );
});
