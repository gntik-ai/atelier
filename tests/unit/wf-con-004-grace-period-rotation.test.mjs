import test from 'node:test';
import assert from 'node:assert/strict';
import { _resetForTest as resetIdempotencyStore } from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import handleCredentialGeneration, { __resetWorkflowDependenciesForTest, __setWorkflowDependenciesForTest } from '../../apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs';

function request(overrides = {}) {
  return {
    workflowId: 'WF-CON-004',
    idempotencyKey: '55555555-4444-4444-8444-444444444444',
    callerContext: { actor: 'usr_1', actorType: 'workspace_admin', tenantId: 'ten_1', workspaceId: 'wrk_1', correlationId: 'corr-5' },
    input: { credentialAction: 'rotate', targetWorkspaceId: 'wrk_1', serviceAccountId: 'svc_1', credentialId: 'cred_old', gracePeriodSeconds: 3600 },
    ...overrides,
    callerContext: { actor: 'usr_1', actorType: 'workspace_admin', tenantId: 'ten_1', workspaceId: 'wrk_1', correlationId: 'corr-5', ...(overrides.callerContext ?? {}) },
    input: { credentialAction: 'rotate', targetWorkspaceId: 'wrk_1', serviceAccountId: 'svc_1', credentialId: 'cred_old', gracePeriodSeconds: 3600, ...(overrides.input ?? {}) }
  };
}

test.afterEach(() => { resetIdempotencyStore(); __resetWorkflowDependenciesForTest(); });

test('grace-period initiation returns rotation metadata', async () => {
  const events = [];
  __setWorkflowDependenciesForTest({
    async getTenantRotationPolicy() { return { max_grace_period_seconds: 7200 }; },
    async countActiveCredentials() { return 1; },
    async getInProgressRotation() { return null; },
    async rotateCredential() { return { credentialId: 'cred_new', credential: 'secret', credentialType: 'client_secret' }; },
    async updateGatewayCredential() {},
    async writeCredentialMetadata() { return { recordId: 'meta_1', credentialId: 'cred_new' }; },
    async writeRotationState({ record }) { return record; },
    async publishRotationEvent(evt) { events.push(evt); }
  });
  const result = await handleCredentialGeneration(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.newCredentialId, 'cred_new');
  assert.equal(events[0].topic, 'console.credential-rotation.initiated');
});

test('immediate rotation writes history record', async () => {
  let history = null;
  __setWorkflowDependenciesForTest({
    async getTenantRotationPolicy() { return null; },
    async countActiveCredentials() { return 1; },
    async getInProgressRotation() { return null; },
    async rotateCredential() { return { credentialId: 'cred_new', credential: 'secret' }; },
    async updateGatewayCredential() {},
    async writeCredentialMetadata() { return { recordId: 'meta_1', credentialId: 'cred_new' }; },
    async writeRotationHistory({ record }) { history = record; return record; },
    async publishRotationEvent() {}
  });
  const result = await handleCredentialGeneration(request({ idempotencyKey: '65555555-4444-4444-8444-444444444444', input: { gracePeriodSeconds: 0 } }));
  assert.equal(result.status, 'succeeded');
  assert.equal(history.completion_reason, 'immediate');
});

test('returns 409 when rotation is already in progress', async () => {
  __setWorkflowDependenciesForTest({ async getTenantRotationPolicy() { return null; }, async countActiveCredentials() { return 1; }, async getInProgressRotation() { return { id: 'rot_1' }; } });
  const result = await handleCredentialGeneration(request({ idempotencyKey: '75555555-4444-4444-8444-444444444444' }));
  assert.equal(result.errorSummary.code, 'ROTATION_IN_PROGRESS');
});

test('returns 422 for policy violation', async () => {
  __setWorkflowDependenciesForTest({ async getTenantRotationPolicy() { return { max_grace_period_seconds: 60 }; }, async countActiveCredentials() { return 1; }, async getInProgressRotation() { return null; } });
  const result = await handleCredentialGeneration(request({ idempotencyKey: '85555555-4444-4444-8444-444444444444' }));
  assert.equal(result.errorSummary.code, 'POLICY_VIOLATION');
});

test('returns 422 for credential limit exceeded', async () => {
  __setWorkflowDependenciesForTest({ async getTenantRotationPolicy() { return null; }, async countActiveCredentials() { return 3; }, async getInProgressRotation() { return null; } });
  const result = await handleCredentialGeneration(request({ idempotencyKey: '95555555-4444-4444-8444-444444444444' }));
  assert.equal(result.errorSummary.code, 'CREDENTIAL_LIMIT_EXCEEDED');
});

test('force-complete rotation revokes old key and writes history', async () => {
  let revoked = false; let removed = false; let history = null;
  __setWorkflowDependenciesForTest({
    async getInProgressRotation() { return { id: 'rot_1', tenant_id: 'ten_1', workspace_id: 'wrk_1', service_account_id: 'svc_1', rotation_type: 'grace_period', grace_period_seconds: 3600, old_credential_id: 'cred_old', new_credential_id: 'cred_new', initiated_by: 'usr_1', initiated_at: new Date().toISOString() }; },
    async revokeCredential() { revoked = true; return {}; },
    async removeGatewayCredential() { removed = true; return {}; },
    async completeRotation() { return { completed_at: new Date().toISOString() }; },
    async writeRotationHistory({ record }) { history = record; return record; },
    async publishRotationEvent() {}
  });
  const result = await handleCredentialGeneration(request({ idempotencyKey: '10555555-4444-4444-8444-444444444444', input: { credentialAction: 'force-complete-rotation' } }));
  assert.equal(result.status, 'succeeded');
  assert.equal(revoked, true);
  assert.equal(removed, true);
  assert.equal(history.completion_reason, 'force_completed');
});
