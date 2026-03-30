import { randomUUID } from 'node:crypto';

const ROTATION_TYPES = new Set(['grace_period', 'immediate']);
const STATES = new Set(['in_progress', 'completed', 'force_completed', 'expired']);

export function createRotationStateRecord({ tenantId, workspaceId, serviceAccountId, newCredentialId, oldCredentialId, rotationType, gracePeriodSeconds = 0, gracePeriodSecondsEffective, initiatedBy } = {}) {
  const effective = Number.isInteger(gracePeriodSecondsEffective) ? gracePeriodSecondsEffective : gracePeriodSeconds;
  const now = new Date();
  return validateRotationState({
    id: randomUUID(),
    tenant_id: tenantId,
    workspace_id: workspaceId,
    service_account_id: serviceAccountId,
    new_credential_id: newCredentialId,
    old_credential_id: oldCredentialId,
    rotation_type: rotationType,
    grace_period_seconds: effective,
    deprecated_expires_at: effective > 0 ? new Date(now.getTime() + effective * 1000).toISOString() : null,
    initiated_at: now.toISOString(),
    initiated_by: initiatedBy,
    state: effective > 0 ? 'in_progress' : 'completed',
    completed_at: effective > 0 ? null : now.toISOString(),
    completed_by: effective > 0 ? null : initiatedBy,
    rotation_lock_version: 0
  });
}

export function validateRotationState(record = {}) {
  const required = ['tenant_id', 'workspace_id', 'service_account_id', 'new_credential_id', 'old_credential_id', 'rotation_type', 'initiated_by', 'state'];
  for (const field of required) {
    if (!record[field]) throw Object.assign(new Error(`Missing required field: ${field}`), { code: 'VALIDATION_ERROR', field });
  }
  if (!ROTATION_TYPES.has(record.rotation_type)) throw Object.assign(new Error('Invalid rotation_type'), { code: 'VALIDATION_ERROR', field: 'rotation_type' });
  if (!STATES.has(record.state)) throw Object.assign(new Error('Invalid state'), { code: 'VALIDATION_ERROR', field: 'state' });
  if (!Number.isInteger(record.grace_period_seconds) || record.grace_period_seconds < 0) {
    throw Object.assign(new Error('grace_period_seconds must be a non-negative integer'), { code: 'VALIDATION_ERROR', field: 'grace_period_seconds' });
  }
  return { ...record };
}
