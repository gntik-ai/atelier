export class QuantitativeLimitEntry {
  constructor({ dimensionKey, displayLabel, unit, effectiveValue, source, quotaType = 'hard', graceMargin = 0, currentUsage = undefined, usageStatus = undefined, usageUnknownReason = undefined } = {}) {
    Object.assign(this, { dimensionKey, displayLabel, unit, effectiveValue, source, quotaType, graceMargin, currentUsage, usageStatus, usageUnknownReason });
  }
}

export class CapabilityEntry {
  constructor({ capabilityKey, displayLabel, effectiveState, source } = {}) {
    Object.assign(this, { capabilityKey, displayLabel, effectiveState, source });
  }
}

export class WorkspaceLimitEntry {
  constructor({ dimensionKey, tenantEffectiveValue, tenantSource, workspaceLimit = null, workspaceSource, isInconsistent = false } = {}) {
    Object.assign(this, { dimensionKey, tenantEffectiveValue, tenantSource, workspaceLimit, workspaceSource, isInconsistent });
  }
}

export class EffectiveEntitlementProfile {
  constructor({ tenantId, planSlug = null, planStatus = null, quantitativeLimits = [], capabilities = [] } = {}) {
    Object.assign(this, { tenantId, planSlug, planStatus, quantitativeLimits, capabilities });
  }
}

export function resolveSource(override, planHasDimension) {
  if (override) return 'override';
  if (planHasDimension) return 'plan';
  return 'catalog_default';
}

export function isInconsistentSubQuota(subQuotaValue, tenantEffectiveValue) {
  return subQuotaValue !== null && subQuotaValue !== undefined && tenantEffectiveValue !== -1 && subQuotaValue > tenantEffectiveValue;
}
