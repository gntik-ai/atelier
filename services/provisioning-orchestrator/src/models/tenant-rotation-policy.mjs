export function createTenantRotationPolicy({ tenantId, maxCredentialAgeDays = null, maxGracePeriodSeconds = null, warnBeforeExpiryDays = 14, updatedBy } = {}) {
  return validateTenantRotationPolicy({
    tenant_id: tenantId,
    max_credential_age_days: maxCredentialAgeDays,
    max_grace_period_seconds: maxGracePeriodSeconds,
    warn_before_expiry_days: warnBeforeExpiryDays,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy
  });
}

export function validateTenantRotationPolicy(policy = {}) {
  if (!policy.tenant_id) throw Object.assign(new Error('tenant_id is required'), { code: 'VALIDATION_ERROR', field: 'tenant_id' });
  if (!policy.updated_by) throw Object.assign(new Error('updated_by is required'), { code: 'VALIDATION_ERROR', field: 'updated_by' });
  for (const [field, minimum, nullable] of [['max_credential_age_days',1,true],['max_grace_period_seconds',0,true],['warn_before_expiry_days',1,false]]) {
    const value = policy[field];
    if (value == null && nullable) continue;
    if (!Number.isInteger(value) || value < minimum) throw Object.assign(new Error(`${field} must be >= ${minimum}`), { code: 'VALIDATION_ERROR', field });
  }
  return { ...policy };
}

export function enforceRotationPolicy(policy, requestedGracePeriodSeconds = 0) {
  if (!policy) return;
  const max = policy.max_grace_period_seconds ?? policy.maxGracePeriodSeconds ?? null;
  if (max != null && requestedGracePeriodSeconds > max) {
    const error = new Error(`Requested grace period ${requestedGracePeriodSeconds} exceeds policy limit ${max}`);
    error.code = 'POLICY_VIOLATION';
    error.statusCode = 422;
    throw error;
  }
}
