import { randomUUID } from 'node:crypto';

export function ManualInterventionFlag(fields = {}) {
  if (!fields.operationId && !fields.operation_id) {
    throw Object.assign(new Error('operationId is required'), { code: 'VALIDATION_ERROR' });
  }

  return Object.freeze({
    flagId: fields.flagId ?? fields.flag_id ?? randomUUID(),
    operationId: fields.operationId ?? fields.operation_id,
    tenantId: fields.tenantId ?? fields.tenant_id,
    actorId: fields.actorId ?? fields.actor_id,
    reason: fields.reason,
    attemptCountAtFlag: Number(fields.attemptCountAtFlag ?? fields.attempt_count_at_flag ?? 0),
    lastErrorCode: fields.lastErrorCode ?? fields.last_error_code ?? null,
    lastErrorSummary: fields.lastErrorSummary ?? fields.last_error_summary ?? null,
    status: fields.status ?? 'pending',
    lastNotificationAt: fields.lastNotificationAt ?? fields.last_notification_at ?? null,
    createdAt: fields.createdAt ?? fields.created_at ?? new Date().toISOString(),
    resolvedAt: fields.resolvedAt ?? fields.resolved_at ?? null,
    resolvedBy: fields.resolvedBy ?? fields.resolved_by ?? null,
    resolutionMethod: fields.resolutionMethod ?? fields.resolution_method ?? null
  });
}

export function createFlag(params = {}) {
  return ManualInterventionFlag(params);
}

export function shouldDebounceNotification(flag, debounceMinutes = 15) {
  if (!flag?.lastNotificationAt && !flag?.last_notification_at) {
    return false;
  }
  const last = new Date(flag.lastNotificationAt ?? flag.last_notification_at).getTime();
  const minutes = Number(debounceMinutes);
  if (!Number.isFinite(last) || minutes <= 0) {
    return false;
  }
  return (Date.now() - last) < minutes * 60_000;
}
