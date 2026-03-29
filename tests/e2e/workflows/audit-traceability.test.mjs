import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../../apps/control-plane/src/saga/saga-definitions.mjs';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { tenantAContext } from './helpers/tenant-context.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

function withSuccessfulSagaStubs(workflowId) {
  const definition = sagaDefinitions.get(workflowId);
  const originals = definition.steps.map((step) => ({ step, forward: step.forward, compensate: step.compensate }));
  for (const { step } of originals) {
    step.forward = async (_params, sagaCtx) => ({ stepKey: step.key, correlationId: sagaCtx.correlationId, tenantId: sagaCtx.tenantId, actorId: sagaCtx.actorId });
    step.compensate = async () => ({ compensated: step.key });
  }
  return () => {
    for (const original of originals) {
      original.step.forward = original.forward;
      original.step.compensate = original.compensate;
    }
  };
}

test('WF-CON-002 success: audit log reconstructable from single correlationId', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-002');
  const capture = installAuditCapture();
  try {
    const result = await runWorkflow('WF-CON-002', { idempotencyKey: makeIdempotencyKey('audit-002') });
    const correlationId = result.output.correlationId;
    capture.assertComplete(correlationId, ['workflow.started', 'step.succeeded', 'workflow.terminal']);
    const scoped = capture.byCorrelationId(correlationId);
    assert.equal(scoped.filter((record) => record.action?.action_id === 'step.succeeded').length, 4);
  } finally {
    capture.restore();
    restore();
  }
});

test('WF-CON-003 compensated failure: audit log contains failure + terminal entries', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-003');
  const capture = installAuditCapture();
  const injected = injectSagaStepFailure('WF-CON-003', 'reserve-s3-storage');
  try {
    await assert.rejects(() => runWorkflow('WF-CON-003', { idempotencyKey: makeIdempotencyKey('audit-003') }));
    const terminal = capture.records.find((record) => record.action?.action_id === 'workflow.terminal');
    assert.ok(terminal);
    assert.ok(['compensated', 'compensation-failed'].includes(terminal.result?.outcome));
    assert.ok(capture.records.some((record) => record.action?.action_id === 'step.failed'));
  } finally {
    injected.restore();
    capture.restore();
    restore();
  }
});

test('WF-CON-004 success: all step milestones tagged with tenantId and actorId', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-004');
  const capture = installAuditCapture();
  try {
    const result = await runWorkflow(
      'WF-CON-004',
      { idempotencyKey: makeIdempotencyKey('audit-004') },
      tenantAContext({ actorId: 'audit-test-actor' })
    );
    const scoped = capture.byCorrelationId(result.output.correlationId);
    assert.ok(scoped.length > 0);
    assert.ok(scoped.every((record) => record.scope?.tenant_id === 'test-tenant-a'));
    assert.ok(scoped.every((record) => record.actor?.actor_id === 'audit-test-actor'));
  } finally {
    capture.restore();
    restore();
  }
});

test('WF-CON-002 edge case: first step failure → no compensation events, only failure event present', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-002');
  const capture = installAuditCapture();
  const injected = injectSagaStepFailure('WF-CON-002', 'create-keycloak-realm');
  try {
    await assert.rejects(() => runWorkflow('WF-CON-002', { idempotencyKey: makeIdempotencyKey('audit-002-first-step') }));
    assert.equal(capture.records.filter((record) => record.action?.action_id === 'step.compensated').length, 0);
    assert.equal(capture.records.filter((record) => record.action?.action_id === 'step.failed').length, 1);
  } finally {
    injected.restore();
    capture.restore();
    restore();
  }
});
