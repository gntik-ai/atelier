import { randomUUID } from 'node:crypto';

export function RetryOverride(fields = {}) {
  const justification = `${fields.justification ?? ''}`.trim();
  if (!fields.superadminId && !fields.superadmin_id) {
    throw Object.assign(new Error('superadminId is required'), { code: 'VALIDATION_ERROR' });
  }
  if (justification.length < 10) {
    throw Object.assign(new Error('justification must be at least 10 characters long'), { code: 'VALIDATION_ERROR' });
  }

  return Object.freeze({
    overrideId: fields.overrideId ?? fields.override_id ?? randomUUID(),
    operationId: fields.operationId ?? fields.operation_id,
    flagId: fields.flagId ?? fields.flag_id,
    tenantId: fields.tenantId ?? fields.tenant_id,
    superadminId: fields.superadminId ?? fields.superadmin_id,
    justification,
    attemptNumber: Number(fields.attemptNumber ?? fields.attempt_number ?? 1),
    status: fields.status ?? 'pending',
    createdAt: fields.createdAt ?? fields.created_at ?? new Date().toISOString(),
    completedAt: fields.completedAt ?? fields.completed_at ?? null
  });
}

export function createOverride(params = {}) {
  return RetryOverride(params);
}
