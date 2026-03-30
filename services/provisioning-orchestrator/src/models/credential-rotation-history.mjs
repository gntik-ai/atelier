import { randomUUID } from 'node:crypto';

const COMPLETION_REASONS = new Set(['expired', 'force_completed', 'immediate', null]);

export function createRotationHistoryRecord({ tenantId, workspaceId, serviceAccountId, rotationStateId = null, rotationType, gracePeriodSeconds = 0, oldCredentialId = null, newCredentialId = null, initiatedBy, initiatedAt = new Date().toISOString(), completedAt = null, completedBy = null, completionReason = null } = {}) {
  return validateRotationHistoryRecord({
    id: randomUUID(),
    tenant_id: tenantId,
    workspace_id: workspaceId,
    service_account_id: serviceAccountId,
    rotation_state_id: rotationStateId,
    rotation_type: rotationType,
    grace_period_seconds: gracePeriodSeconds,
    old_credential_id: oldCredentialId,
    new_credential_id: newCredentialId,
    initiated_by: initiatedBy,
    initiated_at: initiatedAt,
    completed_at: completedAt,
    completed_by: completedBy,
    completion_reason: completionReason
  });
}

export function validateRotationHistoryRecord(record = {}) {
  const required = ['tenant_id', 'workspace_id', 'service_account_id', 'rotation_type', 'initiated_by', 'initiated_at'];
  for (const field of required) {
    if (!record[field]) throw Object.assign(new Error(`Missing required field: ${field}`), { code: 'VALIDATION_ERROR', field });
  }
  if (!Number.isInteger(record.grace_period_seconds) || record.grace_period_seconds < 0) throw Object.assign(new Error('grace_period_seconds must be a non-negative integer'), { code: 'VALIDATION_ERROR', field: 'grace_period_seconds' });
  if (!COMPLETION_REASONS.has(record.completion_reason)) throw Object.assign(new Error('Invalid completion_reason'), { code: 'VALIDATION_ERROR', field: 'completion_reason' });
  return { ...record };
}
