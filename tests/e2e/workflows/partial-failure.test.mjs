import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../../apps/control-plane/src/saga/saga-definitions.mjs';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

function withSagaTracking(workflowId) {
  const definition = sagaDefinitions.get(workflowId);
  const calls = [];
  const originals = definition.steps.map((step) => ({ step, forward: step.forward, compensate: step.compensate }));
  for (const { step } of originals) {
    step.forward = async (params, sagaCtx) => {
      calls.push({ type: 'forward', stepKey: step.key, correlationId: sagaCtx.correlationId });
      return { stepKey: step.key, correlationId: sagaCtx.correlationId };
    };
    step.compensate = async (_input, _output, sagaCtx) => {
      calls.push({ type: 'compensate', stepKey: step.key, correlationId: sagaCtx.correlationId });
      return { compensated: step.key };
    };
  }
  return {
    calls,
    restore() {
      for (const original of originals) {
        original.step.forward = original.forward;
        original.step.compensate = original.compensate;
      }
    }
  };
}

async function runExpectingFailure(workflowId, stepKey, label) {
  const tracking = withSagaTracking(workflowId);
  const injected = injectSagaStepFailure(workflowId, stepKey);
  const capture = installAuditCapture();
  try {
    await assert.rejects(() => runWorkflow(workflowId, { idempotencyKey: makeIdempotencyKey(label) }));
    return { tracking, capture };
  } finally {
    capture.restore();
    injected.restore();
    tracking.restore();
  }
}

test('WF-CON-002: fail at step 2 → steps [1] are compensated in reverse order', async () => {
  const { tracking } = await runExpectingFailure('WF-CON-002', 'create-postgresql-boundary', 'wf002-fail-step2');
  assert.deepEqual(
    tracking.calls.map((entry) => `${entry.type}:${entry.stepKey}`),
    ['forward:create-keycloak-realm', 'compensate:create-keycloak-realm']
  );
});

test('WF-CON-003: fail at last step (reserve-s3-storage) → steps [1,2] compensated in reverse order', async () => {
  const { tracking } = await runExpectingFailure('WF-CON-003', 'reserve-s3-storage', 'wf003-fail-last');
  assert.deepEqual(
    tracking.calls.map((entry) => `${entry.type}:${entry.stepKey}`),
    [
      'forward:create-keycloak-client',
      'forward:create-postgresql-workspace',
      'compensate:create-postgresql-workspace',
      'compensate:create-keycloak-client'
    ]
  );
});

test('WF-CON-004: fail at step 1 (create-keycloak-credential) → compensation is a no-op', async () => {
  const { tracking, capture } = await runExpectingFailure('WF-CON-004', 'create-keycloak-credential', 'wf004-fail-step1');
  assert.deepEqual(tracking.calls.map((entry) => `${entry.type}:${entry.stepKey}`), []);
  const compensationEvents = capture.records.filter((record) => record.action?.action_id === 'step.compensated');
  assert.equal(compensationEvents.length, 0);
});

test('WF-CON-002: fail at step 2 → no step-level output for steps 3 and 4', async () => {
  const { tracking } = await runExpectingFailure('WF-CON-002', 'create-postgresql-boundary', 'wf002-fail-step2-no-orphans');
  const forwardSteps = tracking.calls.filter((entry) => entry.type === 'forward').map((entry) => entry.stepKey);
  assert.deepEqual(forwardSteps, ['create-keycloak-realm']);
});
