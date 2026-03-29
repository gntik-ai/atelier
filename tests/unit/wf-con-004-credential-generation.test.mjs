import test from 'node:test';
import assert from 'node:assert/strict';

import { _resetForTest as resetIdempotencyStore } from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import handleCredentialGeneration, {
  __resetWorkflowDependenciesForTest,
  __setWorkflowDependenciesForTest
} from '../../apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs';

function request(overrides = {}) {
  return {
    workflowId: 'WF-CON-004',
    idempotencyKey: '44444444-4444-4444-8444-444444444444',
    callerContext: {
      actor: 'workspace-admin-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-4'
    },
    input: {
      credentialAction: 'generate',
      targetWorkspaceId: 'workspace-1'
    },
    ...overrides,
    callerContext: {
      actor: 'workspace-admin-1',
      actorType: 'workspace_admin',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      correlationId: 'corr-4',
      ...(overrides.callerContext ?? {})
    },
    input: {
      credentialAction: 'generate',
      targetWorkspaceId: 'workspace-1',
      ...(overrides.input ?? {})
    }
  };
}

test.afterEach(() => {
  resetIdempotencyStore();
  __resetWorkflowDependenciesForTest();
});

test('generate returns credential and stores sanitized cached result', async () => {
  __setWorkflowDependenciesForTest({
    async generateCredential() {
      return { credentialId: 'cred-1', credentialType: 'client_secret', credential: 'secret-1', consumerKeyId: 'consumer-1' };
    },
    async registerGatewayCredential() {
      return { ok: true };
    },
    async writeCredentialMetadata() {
      return { recordId: 'record-1', credentialId: 'cred-1' };
    }
  });

  const result = await handleCredentialGeneration(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.credential, 'secret-1');

  const replay = await handleCredentialGeneration(request());
  assert.equal(replay.output.credential, null);
});

test('generate retry returns null credential', async () => {
  __setWorkflowDependenciesForTest({
    async generateCredential() {
      return { credentialId: 'cred-1', credentialType: 'client_secret', credential: 'secret-1', consumerKeyId: 'consumer-1' };
    },
    async registerGatewayCredential() {
      return { ok: true };
    },
    async writeCredentialMetadata() {
      return { recordId: 'record-1', credentialId: 'cred-1' };
    }
  });

  await handleCredentialGeneration(request());
  const retry = await handleCredentialGeneration(request());
  assert.equal(retry.output.credential, null);
});

test('rotate follows the same one-time secret exposure rule', async () => {
  __setWorkflowDependenciesForTest({
    async rotateCredential() {
      return { credentialId: 'cred-2', credentialType: 'client_secret', credential: 'secret-2', consumerKeyId: 'consumer-2' };
    },
    async updateGatewayCredential() {
      return { ok: true };
    },
    async writeCredentialMetadata() {
      return { recordId: 'record-2', credentialId: 'cred-2' };
    }
  });

  const first = await handleCredentialGeneration(request({
    idempotencyKey: '44444444-4444-4444-9444-444444444444',
    input: { credentialAction: 'rotate', targetWorkspaceId: 'workspace-1', credentialId: 'cred-2' }
  }));
  const replay = await handleCredentialGeneration(request({
    idempotencyKey: '44444444-4444-4444-9444-444444444444',
    input: { credentialAction: 'rotate', targetWorkspaceId: 'workspace-1', credentialId: 'cred-2' }
  }));
  assert.equal(first.output.credential, 'secret-2');
  assert.equal(replay.output.credential, null);
});

test('revoke does not include credential in output', async () => {
  __setWorkflowDependenciesForTest({
    async revokeCredential() {
      return { credentialId: 'cred-3', credentialType: 'client_secret', consumerKeyId: 'consumer-3' };
    },
    async removeGatewayCredential() {
      return { ok: true };
    },
    async writeCredentialMetadata() {
      return { recordId: 'record-3', credentialId: 'cred-3' };
    }
  });

  const result = await handleCredentialGeneration(request({ input: { credentialAction: 'revoke', targetWorkspaceId: 'workspace-1', credentialId: 'cred-3' } }));
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.credential, null);
});

test('gateway failure marks failed step', async () => {
  __setWorkflowDependenciesForTest({
    async generateCredential() {
      return { credentialId: 'cred-4', credentialType: 'client_secret', credential: 'secret-4', consumerKeyId: 'consumer-4' };
    },
    async registerGatewayCredential() {
      const error = new Error('gateway unavailable');
      error.failedStep = 'register_apisix_routes';
      throw error;
    }
  });

  const result = await handleCredentialGeneration(request({ idempotencyKey: '45444444-4444-4444-8444-444444444444' }));
  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary.failedStep, 'register_apisix_routes');
});

test('cross-tenant request is forbidden', async () => {
  const result = await handleCredentialGeneration(request({ callerContext: { requestWorkspaceId: 'workspace-2' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});

test('under-privileged role is forbidden', async () => {
  const result = await handleCredentialGeneration(request({ callerContext: { actorType: 'tenant_member' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
});
