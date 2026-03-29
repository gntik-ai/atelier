import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../../apps/control-plane/src/saga/saga-definitions.mjs';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { makeIdempotencyKey, assertIdempotentResult } from './helpers/idempotency-tracker.mjs';

function withSuccessfulSagaStubs(workflowId) {
  const definition = sagaDefinitions.get(workflowId);
  const originals = definition.steps.map((step) => ({ step, forward: step.forward, compensate: step.compensate }));
  for (const { step } of originals) {
    step.forward = async (params, sagaCtx) => ({
      workflowId,
      stepKey: step.key,
      ok: true,
      idempotencyKey: params.idempotencyKey,
      correlationId: sagaCtx.correlationId,
      tenantId: sagaCtx.tenantId
    });
    step.compensate = async () => ({ ok: true, compensated: step.key });
  }
  return () => {
    for (const original of originals) {
      original.step.forward = original.forward;
      original.step.compensate = original.compensate;
    }
  };
}

async function runHappyWorkflow(workflowId, label) {
  const restore = withSuccessfulSagaStubs(workflowId);
  const capture = installAuditCapture();
  try {
    const result = await runWorkflow(workflowId, { idempotencyKey: makeIdempotencyKey(label) });
    return { result, capture };
  } finally {
    capture.restore();
    restore();
  }
}

test('WF-CON-002 happy path: all 4 steps complete, status is completed, correlationId is present', async () => {
  const { result, capture } = await runHappyWorkflow('WF-CON-002', 'wf002-happy');
  assert.equal(result.status, 'completed');
  assert.ok(result.sagaId);
  assert.ok(result.output?.correlationId);
  capture.assertComplete(result.output.correlationId, ['workflow.started', 'step.succeeded', 'workflow.terminal']);
});

test('WF-CON-003 happy path: all 3 steps complete, status is completed', async () => {
  const { result, capture } = await runHappyWorkflow('WF-CON-003', 'wf003-happy');
  assert.equal(result.status, 'completed');
  assert.ok(result.sagaId);
  capture.assertComplete(result.output.correlationId, ['workflow.started', 'step.succeeded', 'workflow.terminal']);
});

test('WF-CON-004 happy path: all 3 steps complete, status is completed', async () => {
  const { result, capture } = await runHappyWorkflow('WF-CON-004', 'wf004-happy');
  assert.equal(result.status, 'completed');
  assert.ok(result.sagaId);
  capture.assertComplete(result.output.correlationId, ['workflow.started', 'step.succeeded', 'workflow.terminal']);
});

test('WF-CON-002 idempotent happy path: second execution with same key returns original result without re-executing steps', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-002');
  const capture = installAuditCapture();
  const key = makeIdempotencyKey('wf002-idem-happy');
  try {
    const firstResult = await runWorkflow('WF-CON-002', { idempotencyKey: key });
    const secondResult = await runWorkflow('WF-CON-002', { idempotencyKey: key });
    assertIdempotentResult(firstResult, secondResult);
    const scoped = capture.byCorrelationId(firstResult.output.correlationId);
    const startedCount = scoped.filter((record) => record.action?.action_id === 'workflow.started').length;
    assert.ok(startedCount >= 1);
  } finally {
    capture.restore();
    restore();
  }
});
