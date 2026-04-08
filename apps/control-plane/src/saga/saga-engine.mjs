import * as eventsAdmin from '../events-admin.mjs';
import { emitWorkflowStarted, emitStepMilestone, emitWorkflowTerminal } from '../workflows/workflow-audit.mjs';
import { compensateSaga } from './saga-compensation.mjs';
import { enrichContextWithCorrelation } from './saga-correlation.mjs';
import { sagaDefinitions } from './saga-definitions.mjs';
import { checkIdempotencyKey, recordIdempotencyResult } from './saga-idempotency.mjs';
import {
  createSagaInstance,
  createSagaStep,
  getInFlightSagas,
  listStepsForSaga,
  updateSagaStatus,
  updateStepStatus
} from './saga-state-store.mjs';

function warnSagaAudit(message, meta = {}) {
  console.warn('[saga-engine]', { level: 'warn', message, ...meta });
}

async function safelyEmitAudit(operation, sagaCtx) {
  try {
    await operation();
  } catch (error) {
    warnSagaAudit('non-fatal audit emission failure', {
      sagaId: sagaCtx?.sagaId,
      correlationId: sagaCtx?.correlationId,
      error: error?.message ?? error?.code ?? String(error)
    });
  }
}

async function emitCompensationFailedAlert(payload) {
  const emitter = typeof eventsAdmin.emit === 'function' ? eventsAdmin.emit : globalThis.__FALCONE_EVENTS_ADMIN_EMIT__;
  if (typeof emitter === 'function') {
    await emitter({
      type: 'saga.compensation-failed',
      sagaId: payload.sagaId,
      workflowId: payload.workflowId,
      failedSteps: payload.failedSteps,
      correlationId: payload.correlationId,
      tenantId: payload.tenantId
    });
    return payload;
  }

  return payload;
}

export async function executeSaga(workflowId, params = {}, callerContext = {}) {
  const definition = sagaDefinitions.get(workflowId);
  if (!definition) {
    const error = new Error(`Workflow ${workflowId} not found`);
    error.code = 'WORKFLOW_NOT_FOUND';
    throw error;
  }

  if (definition.provisional) {
    return { status: 'not-implemented', workflowId };
  }

  const idempotencyKey = params.idempotencyKey ?? null;
  const existing = await checkIdempotencyKey(idempotencyKey, callerContext.tenantId);
  if (existing?.status === 'completed') return existing.result;
  if (existing?.status === 'in-progress') return { status: 'in-progress', sagaId: existing.sagaId };

  const correlated = enrichContextWithCorrelation(
    {
      workflowId,
      tenantId: callerContext.tenantId,
      workspaceId: callerContext.workspaceId,
      actorType: callerContext.actorType,
      actorId: callerContext.actorId ?? callerContext.actor
    },
    callerContext.correlationId
  );

  const saga = await createSagaInstance(workflowId, params, callerContext, correlated.correlationId, idempotencyKey);
  const sagaCtx = {
    sagaId: saga.saga_id,
    workflowId,
    correlationId: correlated.correlationId,
    tenantId: callerContext.tenantId,
    workspaceId: callerContext.workspaceId,
    actorType: callerContext.actorType ?? 'unknown',
    actorId: callerContext.actorId ?? callerContext.actor ?? 'unknown'
  };

  await safelyEmitAudit(() => emitWorkflowStarted(sagaCtx), sagaCtx);

  const succeededSteps = [];
  let lastStepOutput = null;

  for (const stepDef of definition.steps) {
    const step = await createSagaStep(saga.saga_id, stepDef.ordinal, stepDef.key, params);
    await updateStepStatus(step.step_id, 'executing');
    try {
      lastStepOutput = await stepDef.forward(params, sagaCtx);
      const succeeded = { ...step, status: 'succeeded', output_snapshot: lastStepOutput };
      await updateStepStatus(step.step_id, 'succeeded', lastStepOutput);
      if (stepDef.auditMilestone === true) {
        await safelyEmitAudit(
          () => emitStepMilestone(stepDef, 'succeeded', sagaCtx, { stepKey: stepDef.key, ordinal: stepDef.ordinal }),
          sagaCtx
        );
      }
      succeededSteps.push(succeeded);
    } catch (error) {
      await updateStepStatus(step.step_id, 'failed', { message: error?.message ?? String(error) });
      if (stepDef.auditMilestone === true) {
        await safelyEmitAudit(
          () => emitStepMilestone(stepDef, 'failed', sagaCtx, { stepKey: stepDef.key, ordinal: stepDef.ordinal, message: error?.message }),
          sagaCtx
        );
      }
      const compensation = await compensateSaga(saga, succeededSteps, definition, sagaCtx);
      const status = compensation.allCompensated ? 'compensated' : 'compensation-failed';
      await updateSagaStatus(saga.saga_id, status, {
        failedStep: stepDef.key,
        reason: error?.message ?? String(error),
        uncompensatedSteps: compensation.failedSteps
      });
      await safelyEmitAudit(() => emitWorkflowTerminal(sagaCtx, status), sagaCtx);
      if (!compensation.allCompensated) {
        await emitCompensationFailedAlert({
          sagaId: saga.saga_id,
          workflowId,
          failedSteps: compensation.failedSteps,
          correlationId: sagaCtx.correlationId,
          tenantId: sagaCtx.tenantId
        });
      }
      throw error;
    }
  }

  const result = { sagaId: saga.saga_id, status: 'completed', output: lastStepOutput };
  await updateSagaStatus(saga.saga_id, 'completed', result);
  await safelyEmitAudit(() => emitWorkflowTerminal(sagaCtx, 'completed'), sagaCtx);
  if (idempotencyKey) {
    await recordIdempotencyResult(idempotencyKey, callerContext.tenantId, saga.saga_id, result);
  }
  return result;
}

export async function recoverInFlightSagas(stalenessThresholdMs) {
  const staleSagas = await getInFlightSagas(stalenessThresholdMs);
  const failedToRecover = [];
  let recovered = 0;

  for (const saga of staleSagas) {
    try {
      const definition = sagaDefinitions.get(saga.workflow_id);
      if (!definition || definition.provisional) continue;
      const steps = await listStepsForSaga(saga.saga_id);
      const eligibleSteps = steps.filter((step) => ['succeeded', 'compensating', 'compensation-failed'].includes(step.status) === false ? false : true);
      const sagaCtx = {
        sagaId: saga.saga_id,
        workflowId: saga.workflow_id,
        correlationId: saga.correlation_id,
        tenantId: saga.tenant_id,
        workspaceId: saga.workspace_id,
        actorType: saga.actor_type,
        actorId: saga.actor_id
      };
      const compensation = await compensateSaga(saga, eligibleSteps, definition, sagaCtx);
      const recoveredStatus = compensation.allCompensated ? 'compensated' : 'compensation-failed';
      await updateSagaStatus(saga.saga_id, recoveredStatus, compensation);
      await safelyEmitAudit(() => emitWorkflowTerminal(sagaCtx, recoveredStatus), sagaCtx);
      recovered += 1;
    } catch {
      failedToRecover.push(saga.saga_id);
    }
  }

  return { recovered, failedToRecover };
}
