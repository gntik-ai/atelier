import { randomUUID } from 'node:crypto';
import { createOverride } from '../models/retry-override.mjs';
import { createRetryAttempt as createRetryAttemptModel } from '../models/retry-attempt.mjs';
import { findByIdWithTenant } from '../repositories/async-operation-repo.mjs';
import { findByOperationId as findFlagByOperationId, resolveFlag } from '../repositories/manual-intervention-flag-repo.mjs';
import { createIfNotInProgress } from '../repositories/retry-override-repo.mjs';
import { create as createRetryAttempt } from '../repositories/retry-attempt-repo.mjs';
import { publishRetryOverrideEvent } from '../events/async-operation-events.mjs';

export function buildRetryOverrideDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    findByIdWithTenant: overrides.findByIdWithTenant ?? findByIdWithTenant,
    findFlagByOperationId: overrides.findFlagByOperationId ?? findFlagByOperationId,
    createIfNotInProgress: overrides.createIfNotInProgress ?? createIfNotInProgress,
    createRetryAttemptModel: overrides.createRetryAttemptModel ?? createRetryAttemptModel,
    createRetryAttempt: overrides.createRetryAttempt ?? createRetryAttempt,
    resolveFlag: overrides.resolveFlag ?? resolveFlag,
    publishRetryOverrideEvent: overrides.publishRetryOverrideEvent ?? publishRetryOverrideEvent,
    log: overrides.log ?? console.log
  };
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildRetryOverrideDependencies(overrides);
  const callerContext = params.callerContext ?? {};
  if (callerContext.actor?.type !== 'superadmin') {
    return { statusCode: 403, body: { error: 'FORBIDDEN', message: 'Retry override requires superadmin role.' } };
  }

  const operation = await dependencies.findByIdWithTenant(dependencies.db, { operation_id: params.operation_id, tenant_id: params.tenant_id });
  if (!operation || operation.manual_intervention_required !== true) {
    return { statusCode: 404, body: { error: 'NOT_APPLICABLE', message: 'Operation does not have manual_intervention_required flag set.' } };
  }

  const flag = await dependencies.findFlagByOperationId(dependencies.db, params.operation_id);
  if (!flag || flag.status === 'resolved') {
    return { statusCode: 409, body: { error: 'FLAG_ALREADY_RESOLVED', message: 'Manual intervention flag is already resolved.' } };
  }

  const overrideRecord = createOverride({ operationId: params.operation_id, flagId: flag.flag_id, tenantId: params.tenant_id, superadminId: callerContext.actor.id, justification: params.justification, attemptNumber: (operation.attempt_count ?? 0) + 1 });
  const creation = await dependencies.createIfNotInProgress(dependencies.db, overrideRecord);
  if (!creation.created) {
    return { statusCode: 409, body: { error: 'OVERRIDE_IN_PROGRESS', message: 'A retry override is already in progress for this operation.', existingOverrideId: creation.existing?.override_id ?? null } };
  }

  const retryAttempt = dependencies.createRetryAttemptModel({ operation_id: operation.operation_id, tenant_id: operation.tenant_id, attempt_number: overrideRecord.attemptNumber, actor_id: callerContext.actor.id, actor_type: callerContext.actor.type, metadata: { override_id: overrideRecord.overrideId, justification: overrideRecord.justification } });
  await dependencies.db.query('BEGIN');
  try {
    await dependencies.createRetryAttempt(dependencies.db, retryAttempt);
    await dependencies.db.query(`UPDATE async_operations SET status = 'pending', attempt_count = attempt_count + 1, manual_intervention_required = FALSE, correlation_id = $3, updated_at = NOW() WHERE operation_id = $1 AND tenant_id = $2`, [operation.operation_id, operation.tenant_id, retryAttempt.correlation_id]);
    await dependencies.resolveFlag(dependencies.db, flag.flag_id, callerContext.actor.id, 'override');
    await dependencies.db.query('COMMIT');
  } catch (error) { await dependencies.db.query('ROLLBACK'); throw error; }

  await dependencies.publishRetryOverrideEvent(dependencies.producer, { overrideId: overrideRecord.overrideId, operationId: operation.operation_id, flagId: flag.flag_id, tenantId: operation.tenant_id, superadminId: callerContext.actor.id, justification: overrideRecord.justification, attemptNumber: overrideRecord.attemptNumber, newCorrelationId: retryAttempt.correlation_id });
  dependencies.log(JSON.stringify({ level: 'info', event: 'async_operation_retry_override', operation_id: operation.operation_id, tenant_id: operation.tenant_id, correlation_id: retryAttempt.correlation_id }));
  return { statusCode: 200, body: { overrideId: overrideRecord.overrideId, attemptId: retryAttempt.attempt_id, operationId: operation.operation_id, attemptNumber: overrideRecord.attemptNumber, correlationId: retryAttempt.correlation_id, status: 'pending', createdAt: overrideRecord.createdAt } };
}
