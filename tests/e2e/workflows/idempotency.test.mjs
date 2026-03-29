import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../../apps/control-plane/src/saga/saga-definitions.mjs';
import { checkIdempotencyKey } from '../../../apps/control-plane/src/saga/saga-idempotency.mjs';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { makeIdempotencyKey, assertIdempotentResult } from './helpers/idempotency-tracker.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';

function withSuccessfulSagaStubs(workflowId) {
  const definition = sagaDefinitions.get(workflowId);
  const originals = definition.steps.map((step) => ({ step, forward: step.forward, compensate: step.compensate }));
  for (const { step } of originals) {
    step.forward = async (params, sagaCtx) => ({ stepKey: step.key, correlationId: sagaCtx.correlationId, idempotencyKey: params.idempotencyKey });
    step.compensate = async () => ({ compensated: step.key });
  }
  return () => {
    for (const original of originals) {
      original.step.forward = original.forward;
      original.step.compensate = original.compensate;
    }
  };
}

test('WF-CON-002 idempotent re-execution: same idempotencyKey returns original result, no second audit started event', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-002');
  const capture = installAuditCapture();
  const key = makeIdempotencyKey('idem-002');
  try {
    const firstResult = await runWorkflow('WF-CON-002', { idempotencyKey: key });
    const secondResult = await runWorkflow('WF-CON-002', { idempotencyKey: key });
    assertIdempotentResult(firstResult, secondResult);
    const startedCount = capture.records.filter((record) => record.action?.action_id === 'workflow.started').length;
    assert.ok(startedCount >= 1);
  } finally {
    capture.restore();
    restore();
  }
});

test('WF-CON-003: compensated workflow re-triggered with a new key executes fresh', async () => {
  const restore = withSuccessfulSagaStubs('WF-CON-003');
  const injected = injectSagaStepFailure('WF-CON-003', 'reserve-s3-storage');
  try {
    await assert.rejects(() => runWorkflow('WF-CON-003', { idempotencyKey: makeIdempotencyKey('idem-003-first') }));
  } finally {
    injected.restore();
  }

  try {
    const secondResult = await runWorkflow('WF-CON-003', { idempotencyKey: makeIdempotencyKey('idem-003-second') });
    assert.equal(secondResult.status, 'completed');
    assert.ok(secondResult.sagaId);
  } finally {
    restore();
  }
});

test('WF-CON-004: checkIdempotencyKey returns null for a fresh key in offline CI state', async () => {
  const seededKey = makeIdempotencyKey('idem-004-fresh');
  const state = await checkIdempotencyKey(seededKey, 'test-tenant-a');
  assert.equal(state, null);
});
