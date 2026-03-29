import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../../apps/control-plane/src/saga/saga-definitions.mjs';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { tenantAContext, tenantBContext } from './helpers/tenant-context.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

function withSuccessfulSagaStubs(workflowId) {
  const definition = sagaDefinitions.get(workflowId);
  const originals = definition.steps.map((step) => ({ step, forward: step.forward, compensate: step.compensate }));
  for (const { step } of originals) {
    step.forward = async (_params, sagaCtx) => ({ stepKey: step.key, correlationId: sagaCtx.correlationId, tenantId: sagaCtx.tenantId });
    step.compensate = async () => ({ compensated: step.key });
  }
  return () => {
    for (const original of originals) {
      original.step.forward = original.forward;
      original.step.compensate = original.compensate;
    }
  };
}

test('Tenant A success + Tenant B failure: A audit records unaffected by B compensation', async () => {
  const restore002 = withSuccessfulSagaStubs('WF-CON-002');
  const restore003 = withSuccessfulSagaStubs('WF-CON-003');
  const capture = installAuditCapture();
  const injected = injectSagaStepFailure('WF-CON-003', 'create-postgresql-workspace');

  try {
    const success = await runWorkflow('WF-CON-002', { idempotencyKey: makeIdempotencyKey('tenant-a') }, tenantAContext());
    await assert.rejects(() => runWorkflow('WF-CON-003', { idempotencyKey: makeIdempotencyKey('tenant-b') }, tenantBContext()));

    const tenantARecords = capture.byCorrelationId(success.output.correlationId);
    assert.ok(tenantARecords.length > 0);
    assert.ok(tenantARecords.every((record) => record.scope?.tenant_id === 'test-tenant-a'));
  } finally {
    injected.restore();
    capture.restore();
    restore003();
    restore002();
  }
});

test('Tenant A audit query returns only tenant A records', async () => {
  const restore002 = withSuccessfulSagaStubs('WF-CON-002');
  const restore003 = withSuccessfulSagaStubs('WF-CON-003');
  const capture = installAuditCapture();
  const injected = injectSagaStepFailure('WF-CON-003', 'create-postgresql-workspace');

  try {
    const [resultA] = await Promise.all([
      runWorkflow('WF-CON-002', { idempotencyKey: makeIdempotencyKey('tenant-a-concurrent') }, tenantAContext()),
      assert.rejects(() => runWorkflow('WF-CON-003', { idempotencyKey: makeIdempotencyKey('tenant-b-concurrent') }, tenantBContext()))
    ]);
    const tenantARecords = capture.byCorrelationId(resultA.output.correlationId);
    assert.ok(tenantARecords.every((record) => record.scope?.tenant_id === 'test-tenant-a'));
    assert.equal(tenantARecords.some((record) => record.scope?.tenant_id === 'test-tenant-b'), false);
  } finally {
    injected.restore();
    capture.restore();
    restore003();
    restore002();
  }
});
