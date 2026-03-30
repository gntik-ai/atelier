import { randomUUID } from 'node:crypto';
import { createRetryAttempt as createRetryAttemptModel } from '../models/retry-attempt.mjs';
import {
  atomicResetToRetry,
  findByIdAnyTenant,
  findByIdWithTenant,
  insertAsyncOperationTransition
} from '../repositories/async-operation-repo.mjs';
import { create as createRetryAttempt } from '../repositories/retry-attempt-repo.mjs';
import { publishRetryEvent } from '../events/async-operation-events.mjs';

const ERROR_STATUS_CODES = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  TENANT_ISOLATION_VIOLATION: 403,
  INVALID_OPERATION_STATE: 409,
  MAX_RETRIES_EXCEEDED: 422,
  TENANT_DEACTIVATED: 400
};

function metricAnnotation(name, labels = {}) {
  return { metric: name, labels };
}

function requireCallerIdentity(callerContext) {
  if (!callerContext.actor?.id) {
    throw Object.assign(new Error('callerContext.actor.id is required'), { code: 'VALIDATION_ERROR' });
  }

  if (!callerContext.actor?.type) {
    throw Object.assign(new Error('callerContext.actor.type is required'), { code: 'VALIDATION_ERROR' });
  }

  if (callerContext.actor.type !== 'superadmin' && !callerContext.tenantId) {
    throw Object.assign(new Error('callerContext.tenantId is required'), { code: 'VALIDATION_ERROR' });
  }
}

function resolveDefaultMaxRetries(value = process.env.OPERATION_DEFAULT_MAX_RETRIES) {
  const parsed = Number.parseInt(value ?? '5', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

function resolveMaxRetries(operation) {
  const value = operation.max_retries ?? resolveDefaultMaxRetries();
  const parsed = Number.parseInt(`${value}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : resolveDefaultMaxRetries();
}

function isTenantActiveByDefault(_tenantId, callerContext) {
  if (callerContext?.tenant?.status === 'deactivated' || callerContext?.tenant?.active === false) {
    return false;
  }

  return true;
}

export function buildRetryActionDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    createRetryAttemptModel: overrides.createRetryAttemptModel ?? createRetryAttemptModel,
    createRetryAttempt: overrides.createRetryAttempt ?? createRetryAttempt,
    findByIdAnyTenant: overrides.findByIdAnyTenant ?? findByIdAnyTenant,
    findByIdWithTenant: overrides.findByIdWithTenant ?? findByIdWithTenant,
    atomicResetToRetry: overrides.atomicResetToRetry ?? atomicResetToRetry,
    insertAsyncOperationTransition: overrides.insertAsyncOperationTransition ?? insertAsyncOperationTransition,
    publishRetryEvent: overrides.publishRetryEvent ?? publishRetryEvent,
    isTenantActive: overrides.isTenantActive ?? isTenantActiveByDefault,
    log: overrides.log ?? console.log
  };
}

async function loadOperation(dependencies, callerContext, params) {
  if (callerContext.actor.type === 'superadmin' && params.tenant_id) {
    return dependencies.findByIdWithTenant(dependencies.db, {
      operation_id: params.operation_id,
      tenant_id: params.tenant_id
    });
  }

  return dependencies.findByIdAnyTenant(dependencies.db, { operation_id: params.operation_id });
}

function assertTenantAccess(callerContext, operation, params) {
  if (!operation) {
    throw Object.assign(new Error('Operation not found'), { code: 'NOT_FOUND' });
  }

  if (callerContext.actor.type === 'superadmin') {
    return;
  }

  if (params.tenant_id && params.tenant_id !== callerContext.tenantId) {
    throw Object.assign(new Error('tenant_id must come from callerContext'), {
      code: 'TENANT_ISOLATION_VIOLATION'
    });
  }

  if (operation.tenant_id !== callerContext.tenantId) {
    throw Object.assign(new Error('Operation belongs to a different tenant'), {
      code: 'FORBIDDEN'
    });
  }
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildRetryActionDependencies(overrides);
  const callerContext = params.callerContext ?? {};
  requireCallerIdentity(callerContext);

  try {
    const operation = await loadOperation(dependencies, callerContext, params);
    assertTenantAccess(callerContext, operation, params);

    if (!dependencies.isTenantActive(operation.tenant_id, callerContext, operation)) {
      throw Object.assign(new Error('Tenant is deactivated'), { code: 'TENANT_DEACTIVATED' });
    }

    if (operation.status !== 'failed') {
      const error = Object.assign(new Error("Only operations in 'failed' state can be retried"), {
        code: 'INVALID_OPERATION_STATE',
        currentStatus: operation.status
      });
      throw error;
    }

    const maxRetries = resolveMaxRetries(operation);
    if ((operation.attempt_count ?? 0) >= maxRetries) {
      const error = Object.assign(new Error('Maximum retry attempts reached for this operation type'), {
        code: 'MAX_RETRIES_EXCEEDED',
        maxRetries,
        attemptCount: operation.attempt_count ?? 0
      });
      throw error;
    }

    const retryAttempt = dependencies.createRetryAttemptModel({
      operation_id: operation.operation_id,
      tenant_id: operation.tenant_id,
      attempt_number: (operation.attempt_count ?? 0) + 1,
      actor_id: callerContext.actor.id,
      actor_type: callerContext.actor.type,
      metadata: params.metadata ?? null
    });

    let updatedOperation;
    await dependencies.db.query('BEGIN');

    try {
      await dependencies.createRetryAttempt(dependencies.db, retryAttempt);
      updatedOperation = await dependencies.atomicResetToRetry(dependencies.db, {
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id,
        correlation_id: retryAttempt.correlation_id
      });

      if (!updatedOperation) {
        throw Object.assign(new Error("Only operations in 'failed' state can be retried"), {
          code: 'INVALID_OPERATION_STATE',
          currentStatus: operation.status
        });
      }

      await dependencies.insertAsyncOperationTransition(dependencies.db, {
        transition_id: randomUUID(),
        operation_id: operation.operation_id,
        tenant_id: operation.tenant_id,
        actor_id: callerContext.actor.id,
        previous_status: operation.status,
        new_status: updatedOperation.status,
        transitioned_at: updatedOperation.updated_at,
        metadata: {
          retry_attempt_id: retryAttempt.attempt_id,
          retry_attempt_number: retryAttempt.attempt_number,
          previous_correlation_id: operation.correlation_id,
          new_correlation_id: retryAttempt.correlation_id
        }
      });

      await dependencies.db.query('COMMIT');
    } catch (error) {
      await dependencies.db.query('ROLLBACK');
      throw error;
    }

    let publishFailure = null;
    try {
      await dependencies.publishRetryEvent(dependencies.producer, {
        operation: updatedOperation,
        attempt: retryAttempt,
        actor: callerContext.actor,
        previousCorrelationId: operation.correlation_id
      });
    } catch (error) {
      publishFailure = error;
    }

    dependencies.log(
      JSON.stringify({
        level: publishFailure ? 'warn' : 'info',
        event: 'async_operation_retry_requested',
        operation_id: updatedOperation.operation_id,
        tenant_id: updatedOperation.tenant_id,
        correlation_id: retryAttempt.correlation_id,
        status: updatedOperation.status,
        metrics: [
          metricAnnotation('async_operation_retry_requested_total', {
            tenant: updatedOperation.tenant_id,
            operation_type: updatedOperation.operation_type
          }),
          ...(publishFailure ? [metricAnnotation('async_operation_event_publish_failures_total', { tenant: updatedOperation.tenant_id })] : [])
        ]
      })
    );

    return {
      statusCode: 200,
      headers: { 'X-Correlation-Id': retryAttempt.correlation_id },
      body: {
        attemptId: retryAttempt.attempt_id,
        operationId: retryAttempt.operation_id,
        attemptNumber: retryAttempt.attempt_number,
        correlationId: retryAttempt.correlation_id,
        status: retryAttempt.status,
        createdAt: retryAttempt.created_at
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
