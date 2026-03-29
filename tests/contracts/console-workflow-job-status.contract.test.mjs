import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  _resetForTest,
  CrossTenantJobAccessError,
  queryJobStatus,
  registerJob,
  updateJobStatus
} from '../../apps/control-plane/src/workflows/job-status.mjs';

const schema = JSON.parse(readFileSync(new URL('../../services/internal-contracts/src/console-workflow-job-status.json', import.meta.url), 'utf8'));

function callerContext() {
  return {
    actor: 'actor-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1'
  };
}

test.afterEach(() => {
  _resetForTest();
});

test('job status schema exposes required status enum values', () => {
  assert.deepEqual(schema.properties.status.enum, ['pending', 'running', 'succeeded', 'failed']);
  assert.ok(schema.properties.auditFields);
});

test('job status records allow nullable result and errorSummary', async () => {
  const jobRef = await registerJob('WF-CON-002', '11111111-1111-4111-8111-111111111111', callerContext());
  let status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.result, null);
  assert.equal(status.errorSummary, null);

  await updateJobStatus(jobRef, 'running', null);
  await updateJobStatus(jobRef, 'failed', { code: 'STEP_FAILURE', message: 'boom', failedStep: 'create_kafka_namespace' });
  status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.result, null);
  assert.equal(status.errorSummary.code, 'STEP_FAILURE');
});

test('job status can carry auditFields on success', async () => {
  const jobRef = await registerJob('WF-CON-003', '22222222-2222-4222-8222-222222222222', callerContext());
  await updateJobStatus(jobRef, 'running', null);
  await updateJobStatus(jobRef, 'succeeded', {
    workflowId: 'WF-CON-003',
    auditFields: {
      workflowId: 'WF-CON-003',
      actor: 'actor-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      timestamp: new Date().toISOString(),
      affectedResources: [{ type: 'workspace_record', id: 'workspace-1' }],
      outcome: 'succeeded'
    }
  });

  const status = await queryJobStatus(jobRef, { tenantId: 'tenant-1' });
  assert.equal(status.status, 'succeeded');
  assert.ok(status.auditFields);
});

test('cross-tenant job queries are rejected without leaking records', async () => {
  const jobRef = await registerJob('WF-CON-002', '33333333-3333-4333-8333-333333333333', callerContext());
  await assert.rejects(() => queryJobStatus(jobRef, { tenantId: 'tenant-2' }), CrossTenantJobAccessError);
});
