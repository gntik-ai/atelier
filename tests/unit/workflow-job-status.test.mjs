import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetForTest,
  CrossTenantJobAccessError,
  InvalidJobStateTransitionError,
  queryJobStatus,
  registerJob,
  updateJobStatus
} from '../../apps/control-plane/src/workflows/job-status.mjs';

test.afterEach(() => {
  _resetForTest();
});

function callerContext() {
  return {
    actor: 'actor-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1'
  };
}

test('registerJob returns a deterministic wf_job_* ref', async () => {
  const jobRef = await registerJob('WF-CON-002', '11111111-1111-4111-8111-111111111111', callerContext());
  assert.match(jobRef, /^wf_job_WF-CON-002_/);
});

test('updateJobStatus transitions pending to running', async () => {
  const jobRef = await registerJob('WF-CON-002', '22222222-2222-4222-8222-222222222222', callerContext());
  await updateJobStatus(jobRef, 'running', null);
  const status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.status, 'running');
});

test('updateJobStatus transitions running to succeeded', async () => {
  const jobRef = await registerJob('WF-CON-003', '33333333-3333-4333-8333-333333333333', callerContext());
  await updateJobStatus(jobRef, 'running', null);
  await updateJobStatus(jobRef, 'succeeded', { workflowId: 'WF-CON-003', output: { ok: true } });
  const status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.status, 'succeeded');
  assert.deepEqual(status.result.output, { ok: true });
});

test('updateJobStatus transitions running to failed', async () => {
  const jobRef = await registerJob('WF-CON-003', '44444444-4444-4444-8444-444444444444', callerContext());
  await updateJobStatus(jobRef, 'running', null);
  await updateJobStatus(jobRef, 'failed', { code: 'STEP_FAILURE', message: 'boom', failedStep: 'write_workspace_record' });
  const status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.status, 'failed');
  assert.equal(status.errorSummary.failedStep, 'write_workspace_record');
});

test('invalid state transitions throw InvalidJobStateTransitionError', async () => {
  const jobRef = await registerJob('WF-CON-003', '55555555-5555-4555-8555-555555555555', callerContext());
  await updateJobStatus(jobRef, 'running', null);
  await updateJobStatus(jobRef, 'succeeded', { workflowId: 'WF-CON-003' });
  await assert.rejects(() => updateJobStatus(jobRef, 'running', null), InvalidJobStateTransitionError);
});

test('queryJobStatus returns records for matching tenant', async () => {
  const jobRef = await registerJob('WF-CON-002', '66666666-6666-4666-8666-666666666666', callerContext());
  const status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.jobRef, jobRef);
});

test('queryJobStatus rejects mismatched tenant access', async () => {
  const jobRef = await registerJob('WF-CON-002', '77777777-7777-4777-8777-777777777777', callerContext());
  await assert.rejects(() => queryJobStatus(jobRef, { tenantId: 'tenant-2' }), CrossTenantJobAccessError);
});

test('queryJobStatus adds no artificial delay', async () => {
  const jobRef = await registerJob('WF-CON-002', '88888888-8888-4888-8888-888888888888', callerContext());
  const status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.ok(status.responseTimeMs < 1000);
});
