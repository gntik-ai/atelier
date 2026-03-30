import { randomUUID } from 'node:crypto';
import { nextRunAt } from './cron-validator.mjs';

export const VALID_TRANSITIONS = {
  active: new Set(['paused', 'errored', 'deleted']),
  paused: new Set(['active', 'deleted']),
  errored: new Set(['deleted']),
  deleted: new Set(),
};

export function buildJobRecord(input, context) {
  const now = context.now ?? new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    tenant_id: context.tenantId,
    workspace_id: context.workspaceId,
    name: input.name,
    cron_expression: input.cronExpression,
    target_action: input.targetAction,
    payload: input.payload ?? {},
    status: input.status ?? 'active',
    consecutive_failure_count: input.consecutiveFailureCount ?? 0,
    max_consecutive_failures: input.maxConsecutiveFailures ?? 5,
    next_run_at: input.nextRunAt ?? nextRunAt(input.cronExpression, context.fromDate ?? new Date(now)),
    last_triggered_at: input.lastTriggeredAt ?? null,
    created_by: context.actorId,
    created_at: input.createdAt ?? now,
    updated_at: input.updatedAt ?? now,
    deleted_at: input.deletedAt ?? null,
  };
}

export function canTransition(currentStatus, targetStatus) {
  return VALID_TRANSITIONS[currentStatus]?.has(targetStatus) ?? false;
}

export function applyTransition(job, targetStatus) {
  if (!canTransition(job.status, targetStatus)) {
    throw new Error(`Invalid job status transition from ${job.status} to ${targetStatus}.`);
  }
  return {
    ...job,
    status: targetStatus,
    deleted_at: targetStatus === 'deleted' ? new Date().toISOString() : job.deleted_at,
    updated_at: new Date().toISOString(),
  };
}

export function incrementFailureCount(job) {
  const consecutive_failure_count = job.consecutive_failure_count + 1;
  const status = consecutive_failure_count >= job.max_consecutive_failures ? 'errored' : job.status;
  return {
    ...job,
    consecutive_failure_count,
    status,
    updated_at: new Date().toISOString(),
  };
}

export function resetFailureCount(job) {
  return {
    ...job,
    consecutive_failure_count: 0,
    updated_at: new Date().toISOString(),
  };
}

export function applyNextRunAt(job, expr = job.cron_expression, fromDate = new Date()) {
  return {
    ...job,
    cron_expression: expr,
    next_run_at: nextRunAt(expr, fromDate),
    updated_at: new Date().toISOString(),
  };
}
