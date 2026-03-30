import { isCancellable } from '../models/async-operation.mjs';
import { findById, findByIdAnyTenant, transitionOperation } from '../repositories/async-operation-repo.mjs';
import { publishCancelledEvent } from '../events/async-operation-events.mjs';

function resolveDependencies(params = {}) {
  return {
    db: params.db,
    producer: params.producer,
    repo: params.repo ?? { findById, findByIdAnyTenant, transitionOperation },
    events: params.events ?? { publishCancelledEvent }
  };
}

function json(statusCode, body) {
  return { statusCode, body };
}

function mapError(error) {
  const statusCode =
    error.code === 'NOT_FOUND' ? 404 :
    error.code === 'INVALID_TRANSITION' || error.code === 'NOT_CANCELLABLE' ? 409 :
    error.code === 'TENANT_ISOLATION_VIOLATION' ? 403 :
    error.code === 'VALIDATION_ERROR' ? 400 : 500;

  return json(statusCode, { error: error.code ?? 'INTERNAL_ERROR', message: error.message });
}

export async function main(params = {}) {
  try {
    const { db, producer, repo, events } = resolveDependencies(params);
    const callerContext = params.callerContext ?? {};
    const actorId = callerContext.actor ?? callerContext.actorId;
    const roles = callerContext.roles ?? [];
    const isSuperadmin = roles.includes('superadmin') || callerContext.actorType === 'superadmin';
    const tenant_id = isSuperadmin ? (params.tenant_id ?? callerContext.tenantId) : callerContext.tenantId;
    const operation_id = params.operation_id ?? params.operationId;
    const cancellation_reason = params.cancellation_reason ?? 'cancellation requested';

    if (!db || !operation_id || !tenant_id || !actorId) {
      throw Object.assign(new Error('db, operation_id, tenant_id and callerContext.actor are required'), { code: 'VALIDATION_ERROR' });
    }

    const operation = isSuperadmin
      ? await repo.findByIdAnyTenant(db, { operation_id })
      : await repo.findById(db, { operation_id, tenant_id });

    if (!operation) {
      throw Object.assign(new Error('Operation not found'), { code: 'NOT_FOUND' });
    }

    if (!isSuperadmin && operation.tenant_id !== tenant_id) {
      throw Object.assign(new Error('Cross-tenant cancellation is forbidden'), { code: 'TENANT_ISOLATION_VIOLATION' });
    }

    if (!isCancellable(operation.status)) {
      throw Object.assign(new Error(`Operation in status ${operation.status} cannot be cancelled`), { code: 'NOT_CANCELLABLE' });
    }

    const targetStatus = operation.status === 'pending' ? 'cancelled' : 'cancelling';
    const { updatedOperation } = await repo.transitionOperation(db, {
      operation_id: operation.operation_id,
      tenant_id: operation.tenant_id,
      new_status: targetStatus,
      actor_id: actorId,
      cancelled_by: actorId,
      cancellation_reason
    });

    await events.publishCancelledEvent(producer, { ...updatedOperation, previous_status: operation.status }, actorId);

    return json(200, {
      operationId: updatedOperation.operation_id,
      previousStatus: operation.status,
      newStatus: updatedOperation.status,
      updatedAt: updatedOperation.updated_at
    });
  } catch (error) {
    return mapError(error);
  }
}
