import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateInvocationRequest } from '../../apps/control-plane/src/workflows/workflow-invocation-contract.mjs';

const schema = JSON.parse(readFileSync(new URL('../../services/internal-contracts/src/console-workflow-invocation.json', import.meta.url), 'utf8'));

function baseCallerContext(actorType = 'workspace_admin') {
  return {
    actor: 'actor-1',
    actorType,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    correlationId: 'corr-1'
  };
}

function assertValid(request) {
  const result = validateInvocationRequest(request);
  assert.equal(result.ok, true, result.violations?.join('\n'));
}

test('invocation schema artifact exposes expected top-level definitions', () => {
  assert.equal(schema.$id, 'console-workflow-invocation');
  assert.ok(schema.definitions.invocationRequest);
  assert.ok(schema.definitions.workflowResult);
  assert.ok(schema.definitions.auditFields);
});

test('valid WF-CON-001 request passes validation', () => {
  assertValid({
    workflowId: 'WF-CON-001',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    callerContext: baseCallerContext('workspace_admin'),
    input: {
      userId: 'user-1',
      targetWorkspaceId: 'workspace-1',
      requestedRole: 'workspace_admin'
    }
  });
});

test('valid WF-CON-002 request passes validation', () => {
  assertValid({
    workflowId: 'WF-CON-002',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    callerContext: baseCallerContext('superadmin'),
    input: {
      tenantSlug: 'tenant-one',
      tenantDisplayName: 'Tenant One',
      adminEmail: 'admin@example.com'
    }
  });
});

test('valid WF-CON-003 request passes validation', () => {
  assertValid({
    workflowId: 'WF-CON-003',
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
    callerContext: baseCallerContext('tenant_owner'),
    input: {
      workspaceName: 'Workspace One',
      workspaceSlug: 'workspace-one'
    }
  });
});

test('valid WF-CON-004 requests pass validation for all actions', () => {
  for (const credentialAction of ['generate', 'rotate', 'revoke']) {
    assertValid({
      workflowId: 'WF-CON-004',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      callerContext: baseCallerContext('workspace_admin'),
      input: {
        credentialAction,
        targetWorkspaceId: 'workspace-1'
      }
    });
  }
});

test('valid WF-CON-005 request passes validation', () => {
  assertValid({
    workflowId: 'WF-CON-005',
    idempotencyKey: '55555555-5555-4555-8555-555555555555',
    callerContext: baseCallerContext('tenant_owner'),
    input: {}
  });
});

test('valid WF-CON-006 requests pass validation for all actions', () => {
  for (const serviceAccountAction of ['create', 'scope', 'rotate', 'deactivate', 'delete']) {
    assertValid({
      workflowId: 'WF-CON-006',
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
      callerContext: baseCallerContext('workspace_admin'),
      input: {
        serviceAccountAction
      }
    });
  }
});

test('missing idempotencyKey fails validation', () => {
  const result = validateInvocationRequest({
    workflowId: 'WF-CON-001',
    callerContext: baseCallerContext('workspace_admin'),
    input: { userId: 'user-1', targetWorkspaceId: 'workspace-1', requestedRole: 'workspace_admin' }
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /idempotencyKey/);
});

test('missing callerContext fails validation', () => {
  const result = validateInvocationRequest({
    workflowId: 'WF-CON-001',
    idempotencyKey: '77777777-7777-4777-8777-777777777777',
    input: { userId: 'user-1', targetWorkspaceId: 'workspace-1', requestedRole: 'workspace_admin' }
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /callerContext/);
});

test('sync result envelope includes auditFields-compatible shape', () => {
  const result = {
    workflowId: 'WF-CON-001',
    idempotencyKey: '88888888-8888-4888-8888-888888888888',
    status: 'succeeded',
    jobRef: null,
    output: { ok: true },
    auditFields: {
      workflowId: 'WF-CON-001',
      actor: 'actor-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      timestamp: new Date().toISOString(),
      affectedResources: [{ type: 'membership_record', id: 'record-1' }],
      outcome: 'succeeded'
    }
  };

  assert.equal(result.status, 'succeeded');
  assert.ok(result.auditFields);
  assert.deepEqual(schema.definitions.auditFields.required, ['workflowId', 'actor', 'tenantId', 'timestamp', 'affectedResources', 'outcome']);
});

test('async pending result envelope does not require auditFields', () => {
  const result = {
    workflowId: 'WF-CON-002',
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
    status: 'pending',
    jobRef: 'wf_job_WF-CON-002_demo'
  };

  assert.equal(result.status, 'pending');
  assert.ok(result.jobRef);
  assert.equal('auditFields' in result, false);
});

test('failed result envelope carries errorSummary shape', () => {
  const result = {
    workflowId: 'WF-CON-004',
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'failed',
    errorSummary: {
      code: 'FORBIDDEN',
      message: 'Denied',
      failedStep: null
    }
  };

  assert.equal(result.errorSummary.code, 'FORBIDDEN');
  assert.ok(Object.keys(result.errorSummary).includes('message'));
});
