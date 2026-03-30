import { transitionOperation as persistTransition, findById } from '../repositories/async-operation-repo.mjs';
import { updateFailureClassification, setManualInterventionRequired } from '../repositories/async-operation-repo.mjs';
import { findByOperationType, findDefault } from '../repositories/retry-semantics-profile-repo.mjs';
import { create as createManualInterventionFlag } from '../repositories/manual-intervention-flag-repo.mjs';
import {
  publishStateChanged,
  publishFailureClassifiedEvent,
  publishManualInterventionRequiredEvent
} from '../events/async-operation-events.mjs';
import { validateErrorSummary } from '../models/async-operation.mjs';
import { classifyByErrorCode, loadMappingCache, FailureCategory } from '../models/failure-classification.mjs';
import { createFlag } from '../models/manual-intervention-flag.mjs';

const ERROR_STATUS_CODES = { NOT_FOUND: 404, INVALID_TRANSITION: 409, VALIDATION_ERROR: 400, TENANT_ISOLATION_VIOLATION: 403 };
let cachedMappings;

function sanitizeErrorSummary(errorSummary) {
  if (!errorSummary) return null;
  validateErrorSummary(errorSummary);
  return { code: errorSummary.code, message: errorSummary.message.trim(), failedStep: errorSummary.failedStep ?? null };
}

function metricAnnotation(name, labels = {}) { return { metric: name, labels }; }

async function loadFailureMappings(db) {
  if (cachedMappings) return cachedMappings;
  const result = await db.query('SELECT * FROM failure_code_mappings ORDER BY priority ASC, created_at ASC');
  cachedMappings = loadMappingCache(result.rows);
  return cachedMappings;
}

export function buildTransitionActionDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    persistTransition: overrides.persistTransition ?? persistTransition,
    findById: overrides.findById ?? findById,
    updateFailureClassification: overrides.updateFailureClassification ?? updateFailureClassification,
    setManualInterventionRequired: overrides.setManualInterventionRequired ?? setManualInterventionRequired,
    findByOperationType: overrides.findByOperationType ?? findByOperationType,
    findDefault: overrides.findDefault ?? findDefault,
    createManualInterventionFlag: overrides.createManualInterventionFlag ?? createManualInterventionFlag,
    publishStateChanged: overrides.publishStateChanged ?? publishStateChanged,
    publishFailureClassifiedEvent: overrides.publishFailureClassifiedEvent ?? publishFailureClassifiedEvent,
    publishManualInterventionRequiredEvent: overrides.publishManualInterventionRequiredEvent ?? publishManualInterventionRequiredEvent,
    loadFailureMappings: overrides.loadFailureMappings ?? loadFailureMappings,
    log: overrides.log ?? console.log
  };
}

function resolveTenantScope(callerContext = {}, params = {}) {
  if (callerContext.actor?.type === 'superadmin') {
    if (params.tenant_id) return params.tenant_id;
    throw Object.assign(new Error('tenant_id is required for superadmin transitions'), { code: 'VALIDATION_ERROR' });
  }
  if (!callerContext.tenantId) throw Object.assign(new Error('callerContext.tenantId is required'), { code: 'VALIDATION_ERROR' });
  if (params.tenant_id && params.tenant_id !== callerContext.tenantId) throw Object.assign(new Error('tenant_id must come from callerContext'), { code: 'TENANT_ISOLATION_VIOLATION' });
  return callerContext.tenantId;
}

async function classifyFailureForOperation(dependencies, updatedOperation, errorSummary) {
  const cache = await dependencies.loadFailureMappings(dependencies.db);
  const classification = classifyByErrorCode(errorSummary?.code ?? null, updatedOperation.operation_type, cache);
  await dependencies.updateFailureClassification(dependencies.db, updatedOperation.operation_id, {
    failureCategory: classification.category,
    failureErrorCode: classification.errorCode,
    failureDescription: classification.description,
    failureSuggestedActions: classification.suggestedActions
  }, updatedOperation.tenant_id);
  return classification;
}

async function maybeMarkManualIntervention(dependencies, updatedOperation, classification) {
  const specific = await dependencies.findByOperationType(dependencies.db, updatedOperation.operation_type);
  const fallback = await dependencies.findDefault(dependencies.db);
  const maxRetries = Number(specific?.max_retries ?? fallback?.max_retries ?? updatedOperation.max_retries ?? 5);
  const mustIntervene = (updatedOperation.attempt_count ?? 0) >= maxRetries || classification.category === FailureCategory.REQUIRES_INTERVENTION;
  if (!mustIntervene) return null;

  const flaggedOperation = await dependencies.setManualInterventionRequired(dependencies.db, updatedOperation.operation_id, true, updatedOperation.tenant_id);
  const flag = createFlag({
    operationId: updatedOperation.operation_id,
    tenantId: updatedOperation.tenant_id,
    actorId: updatedOperation.actor_id,
    reason: classification.category === FailureCategory.REQUIRES_INTERVENTION ? 'failure_category_requires_intervention' : 'max_retries_exhausted',
    attemptCountAtFlag: updatedOperation.attempt_count ?? 0,
    lastErrorCode: classification.errorCode ?? 'UNKNOWN',
    lastErrorSummary: classification.description
  });

  try {
    await dependencies.createManualInterventionFlag(dependencies.db, flag);
  } catch (error) {
    if (error.code !== 'UNIQUE_VIOLATION') throw error;
    dependencies.log(JSON.stringify({ level: 'warn', event: 'manual_intervention_flag_already_exists', operation_id: updatedOperation.operation_id, tenant_id: updatedOperation.tenant_id, correlation_id: updatedOperation.correlation_id }));
  }

  return { flag, flaggedOperation: flaggedOperation ?? updatedOperation, maxRetries };
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildTransitionActionDependencies(overrides);
  const callerContext = params.callerContext ?? {};
  if (!callerContext.actor?.id) throw Object.assign(new Error('callerContext.actor.id is required'), { code: 'VALIDATION_ERROR' });
  const tenantId = resolveTenantScope(callerContext, params);
  const errorSummary = sanitizeErrorSummary(params.error_summary);

  try {
    const { updatedOperation, transition } = await dependencies.persistTransition(dependencies.db, {
      operation_id: params.operation_id,
      tenant_id: tenantId,
      new_status: params.new_status,
      actor_id: callerContext.actor.id,
      error_summary: errorSummary
    });

    let classification = null;
    let manualIntervention = null;
    if (updatedOperation.status === 'failed') {
      classification = await classifyFailureForOperation(dependencies, updatedOperation, errorSummary);
      manualIntervention = await maybeMarkManualIntervention(dependencies, updatedOperation, classification);
    }

    let publishFailure = null;
    try {
      await dependencies.publishStateChanged(dependencies.producer, updatedOperation, transition.previous_status);
      if (classification) {
        await dependencies.publishFailureClassifiedEvent(dependencies.producer, {
          operationId: updatedOperation.operation_id,
          tenantId: updatedOperation.tenant_id,
          actorId: updatedOperation.actor_id,
          failureCategory: classification.category,
          errorCode: classification.errorCode ?? 'UNKNOWN',
          attemptCount: updatedOperation.attempt_count ?? 0,
          maxRetries: manualIntervention?.maxRetries ?? updatedOperation.max_retries ?? 5,
          correlationId: updatedOperation.correlation_id
        });
      }
      if (manualIntervention) {
        await dependencies.publishManualInterventionRequiredEvent(dependencies.producer, {
          operationId: updatedOperation.operation_id,
          flagId: manualIntervention.flag.flagId,
          tenantId: updatedOperation.tenant_id,
          actorId: updatedOperation.actor_id,
          reason: manualIntervention.flag.reason,
          attemptCountAtFlag: manualIntervention.flag.attemptCountAtFlag,
          lastErrorCode: manualIntervention.flag.lastErrorCode ?? 'UNKNOWN',
          correlationId: updatedOperation.correlation_id
        });
      }
    } catch (error) {
      publishFailure = error;
    }

    dependencies.log(JSON.stringify({ level: publishFailure ? 'warn' : 'info', event: 'async_operation_transitioned', operation_id: updatedOperation.operation_id, tenant_id: updatedOperation.tenant_id, correlation_id: updatedOperation.correlation_id, status: updatedOperation.status, metrics: [metricAnnotation('async_operation_transition_total', { from: transition.previous_status, to: transition.new_status }), ...(classification ? [metricAnnotation('async_operation_failure_classified_total', { tenant: updatedOperation.tenant_id, operation_type: updatedOperation.operation_type, failure_category: classification.category })] : []), ...(manualIntervention ? [metricAnnotation('async_operation_manual_intervention_total', { tenant: updatedOperation.tenant_id, operation_type: updatedOperation.operation_type, reason: manualIntervention.flag.reason })] : []), ...(publishFailure ? [metricAnnotation('async_operation_event_publish_failures_total', { tenant: updatedOperation.tenant_id })] : [])] }));

    return { statusCode: 200, headers: { 'X-Correlation-Id': updatedOperation.correlation_id }, body: { operationId: updatedOperation.operation_id, previousStatus: transition.previous_status, newStatus: updatedOperation.status, updatedAt: updatedOperation.updated_at, failureCategory: classification?.category ?? updatedOperation.failure_category ?? null, failureDescription: classification?.description ?? updatedOperation.failure_description ?? null, failureSuggestedActions: classification?.suggestedActions ?? updatedOperation.failure_suggested_actions ?? [], manualInterventionRequired: manualIntervention ? true : Boolean(updatedOperation.manual_intervention_required) } };
  } catch (error) {
    error.statusCode = ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
