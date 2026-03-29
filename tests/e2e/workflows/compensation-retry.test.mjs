import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../../apps/control-plane/src/saga/saga-definitions.mjs';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

function withRetryAwareStubs(workflowId) {
  const definition = sagaDefinitions.get(workflowId);
  const originals = definition.steps.map((step) => ({ step, forward: step.forward, compensate: step.compensate }));
  for (const { step } of originals) {
    step.forward = async (_params, sagaCtx) => ({ stepKey: step.key, correlationId: sagaCtx.correlationId });
    step.compensate = async () => ({ compensated: step.key });
  }
  return {
    restore() {
      for (const original of originals) {
        original.step.forward = original.forward;
        original.step.compensate = original.compensate;
      }
    }
  };
}

test('WF-CON-003: compensation action that fails once retries and eventually succeeds', async () => {
  const stubs = withRetryAwareStubs('WF-CON-003');
  const failForward = injectSagaStepFailure('WF-CON-003', 'reserve-s3-storage');
  const failCompensate = injectSagaStepFailure('WF-CON-003', 'create-postgresql-workspace', {
    failOnAttempt: Number.MAX_SAFE_INTEGER,
    compensationFailOnAttempt: 1,
    compensationRetryUntil: 1
  });

  try {
    await assert.rejects(() => runWorkflow('WF-CON-003', { idempotencyKey: makeIdempotencyKey('wf003-retry') }));
    assert.ok(failCompensate.attempts.compensate >= 2);
    assert.ok(failCompensate.attempts.compensate <= 3);
  } finally {
    failCompensate.restore();
    failForward.restore();
    stubs.restore();
  }
});

test('WF-CON-002: compensation action that exhausts retries marks saga as compensation-failed', async () => {
  const stubs = withRetryAwareStubs('WF-CON-002');
  const failForward = injectSagaStepFailure('WF-CON-002', 'create-kafka-namespace');
  const failCompensate = injectSagaStepFailure('WF-CON-002', 'create-postgresql-boundary', {
    failOnAttempt: Number.MAX_SAFE_INTEGER,
    compensationFailOnAttempt: 1
  });

  try {
    await assert.rejects(() => runWorkflow('WF-CON-002', { idempotencyKey: makeIdempotencyKey('wf002-retry-exhaust') }));
    assert.equal(failCompensate.attempts.compensate, 3);
  } finally {
    failCompensate.restore();
    failForward.restore();
    stubs.restore();
  }
});
