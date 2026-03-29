import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetForTest as resetIdempotencyStore,
  markPending
} from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import handleUserApproval, {
  __resetWorkflowDependenciesForTest,
  __setWorkflowDependenciesForTest
} from '../../apps/control-plane/src/workflows/wf-con-001-user-approval.mjs';

function request(overrides = {}) {
  return {
    workflowId: 'WF-CON-001',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    callerContext: {
      actor: 'admin-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-1'
    },
    input: {
      userId: 'user-1',
      targetWorkspaceId: 'workspace-1',
      requestedRole: 'workspace_admin'
    },
    ...overrides,
    callerContext: {
      actor: 'admin-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-1',
      ...(overrides.callerContext ?? {})
    },
    input: {
      userId: 'user-1',
      targetWorkspaceId: 'workspace-1',
      requestedRole: 'workspace_admin',
      ...(overrides.input ?? {})
    }
  };
}

test.afterEach(() => {
  resetIdempotencyStore();
  __resetWorkflowDependenciesForTest();
});

test('happy path succeeds and populates auditFields', async () => {
  __setWorkflowDependenciesForTest({
    async assignRole() {
      return { assignmentId: 'assign-1' };
    },
    async activateMembership() {
      return { recordId: 'membership-1' };
    }
  });

  const result = await handleUserApproval(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.grantedRole, 'workspace_admin');
  assert.equal(result.auditFields.outcome, 'succeeded');
});

test('under-privileged role is forbidden without adapter calls', async () => {
  let called = 0;
  __setWorkflowDependenciesForTest({
    async assignRole() {
      called += 1;
      return { assignmentId: 'assign-1' };
    },
    async activateMembership() {
      called += 1;
      return { recordId: 'membership-1' };
    }
  });

  const result = await handleUserApproval(request({ callerContext: { actorType: 'tenant_member' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
  assert.equal(called, 0);
});

test('cross-tenant request is forbidden without adapter calls', async () => {
  let called = 0;
  __setWorkflowDependenciesForTest({
    async assignRole() {
      called += 1;
      return { assignmentId: 'assign-1' };
    },
    async activateMembership() {
      called += 1;
      return { recordId: 'membership-1' };
    }
  });

  const result = await handleUserApproval(request({ callerContext: { requestWorkspaceId: 'workspace-2' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
  assert.equal(called, 0);
});

test('succeeded idempotency keys return cached result without re-execution', async () => {
  let calls = 0;
  __setWorkflowDependenciesForTest({
    async assignRole() {
      calls += 1;
      return { assignmentId: 'assign-1' };
    },
    async activateMembership() {
      calls += 1;
      return { recordId: 'membership-1' };
    }
  });

  const first = await handleUserApproval(request());
  const second = await handleUserApproval(request());
  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'succeeded');
  assert.equal(calls, 2);
});

test('pending idempotency keys return duplicate invocation error', async () => {
  await markPending('11111111-1111-4111-8111-111111111111', 'WF-CON-001', 'tenant-1', 'workspace-1', null);

  const second = await handleUserApproval(request({ idempotencyKey: '11111111-1111-4111-8111-111111111111' }));
  assert.equal(second.errorSummary.code, 'DUPLICATE_INVOCATION');
});

test('keycloak adapter failure marks assign_keycloak_role step', async () => {
  __setWorkflowDependenciesForTest({
    async assignRole() {
      const error = new Error('keycloak unavailable');
      error.code = 'DOWNSTREAM_UNAVAILABLE';
      throw error;
    }
  });

  const result = await handleUserApproval(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary.failedStep, 'assign_keycloak_role');
});

test('membership update failure marks update_membership_record step', async () => {
  __setWorkflowDependenciesForTest({
    async assignRole() {
      return { assignmentId: 'assign-1' };
    },
    async activateMembership() {
      const error = new Error('postgres unavailable');
      error.code = 'DOWNSTREAM_UNAVAILABLE';
      throw error;
    }
  });

  const result = await handleUserApproval(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary.failedStep, 'update_membership_record');
});

test('auditFields list both mutated resources', async () => {
  __setWorkflowDependenciesForTest({
    async assignRole() {
      return { assignmentId: 'assign-1' };
    },
    async activateMembership() {
      return { recordId: 'membership-1' };
    }
  });

  const result = await handleUserApproval(request());
  assert.deepEqual(
    result.auditFields.affectedResources.map((entry) => entry.type),
    ['keycloak_role_assignment', 'membership_record']
  );
});
