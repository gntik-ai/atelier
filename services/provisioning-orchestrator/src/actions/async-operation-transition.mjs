import { transitionOperation as persistTransition, findById } from '../repositories/async-operation-repo.mjs';
import { publishStateChanged } from '../events/async-operation-events.mjs';
import { validateErrorSummary } from '../models/async-operation.mjs';

const ERROR_STATUS_CODES = {
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  VALIDATION_ERROR: 400,
  TENANT_ISOLATION_VIOLATION: 403
};

function sanitizeErrorSummary(errorSummary) {
  if (!errorSummary) {
    return null;
  }

  validateErrorSummary(errorSummary);
  return {
    code: errorSummary.code,
    message: errorSummary.message.trim(),
    failedStep: errorSummary.failedStep ?? null
  };
}

function metricAnnotation(name, labels = {}) {
  return { metric: name, labels };
}

export function buildTransitionActionDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    persistTransition: overrides.persistTransition ?? persistTransition,
    findById: overrides.findById ?? findById,
    publishStateChanged: overrides.publishStateChanged ?? publishStateChanged,
    log: overrides.log ?? console.log
  };
}

function resolveTenantScope(callerContext = {}, params = {}) {
  if (callerContext.actor?.type === 'superadmin') {
    if (params.tenant_id) {
      return params.tenant_id;
    }

    throw Object.assign(new Error('tenant_id is required for superadmin transitions'), {
      code: 'VALIDATION_ERROR'
    });
  }

  if (!callerContext.tenantId) {
    throw Object.assign(new Error('callerContext.tenantId is required'), {
      code: 'VALIDATION_ERROR'
    });
  }

  if (params.tenant_id && params.tenant_id !== callerContext.tenantId) {
    throw Object.assign(new Error('tenant_id must come from callerContext'), {
      code: 'TENANT_ISOLATION_VIOLATION'
    });
  }

  return callerContext.tenantId;
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildTransitionActionDependencies(overrides);
  const callerContext = params.callerContext ?? {};

  if (!callerContext.actor?.id) {
    throw Object.assign(new Error('callerContext.actor.id is required'), { code: 'VALIDATION_ERROR' });
  }

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

    let publishFailure = null;
    try {
      await dependencies.publishStateChanged(dependencies.producer, updatedOperation, transition.previous_status);
    } catch (error) {
      publishFailure = error;
    }

    dependencies.log(
      JSON.stringify({
        level: publishFailure ? 'warn' : 'info',
        event: 'async_operation_transitioned',
        operation_id: updatedOperation.operation_id,
        tenant_id: updatedOperation.tenant_id,
        correlation_id: updatedOperation.correlation_id,
        status: updatedOperation.status,
        metrics: [
          metricAnnotation('async_operation_transition_total', { from: transition.previous_status, to: transition.new_status }),
          ...(publishFailure ? [metricAnnotation('async_operation_event_publish_failures_total', { tenant: updatedOperation.tenant_id })] : [])
        ]
      })
    );

    return {
      statusCode: 200,
      headers: { 'X-Correlation-Id': updatedOperation.correlation_id },
      body: {
        operationId: updatedOperation.operation_id,
        previousStatus: transition.previous_status,
        newStatus: transition.new_status,
        updatedAt: updatedOperation.updated_at
      }
    };
  } catch (error) {
    error.statusCode = ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
