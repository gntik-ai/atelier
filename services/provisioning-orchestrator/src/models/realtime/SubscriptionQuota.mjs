export function resolveQuota({ workspaceQuota, tenantQuota, platformDefault = 100 }) {
  if (Number.isInteger(workspaceQuota)) return workspaceQuota;
  if (Number.isInteger(tenantQuota)) return tenantQuota;
  return platformDefault;
}

export function checkAllowed(currentCount, quota) {
  return currentCount < quota;
}

export class SubscriptionQuota {
  constructor({ workspaceQuota, tenantQuota, platformDefault = 100 }) {
    this.workspaceQuota = workspaceQuota ?? null;
    this.tenantQuota = tenantQuota ?? null;
    this.platformDefault = platformDefault;
    this.maxSubscriptions = resolveQuota(this);
  }

  allows(currentCount) {
    return checkAllowed(currentCount, this.maxSubscriptions);
  }
}
