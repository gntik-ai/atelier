const counters = new Map();

export function checkSubscriptionQuota(workspaceId, currentCount, limit) {
  return { workspaceId, allowed: currentCount < limit, currentCount, limit };
}

export function checkDeliveryRateLimit(workspaceId, windowCounterRow, limitPerMinute) {
  const count = windowCounterRow?.count ?? 0;
  return { workspaceId, allowed: count <= limitPerMinute, count, limitPerMinute };
}

export async function incrementRateCounter(pg, workspaceId) {
  if (pg?.incrementRateCounter) return pg.incrementRateCounter(workspaceId);
  const current = counters.get(workspaceId) ?? { count: 0, expiresAt: Date.now() + 60000 };
  if (current.expiresAt < Date.now()) {
    current.count = 0;
    current.expiresAt = Date.now() + 60000;
  }
  current.count += 1;
  counters.set(workspaceId, current);
  return { ...current };
}

export async function getWorkspaceSubscriptionCount(pg, tenantId, workspaceId) {
  if (pg?.getWorkspaceSubscriptionCount) return pg.getWorkspaceSubscriptionCount(tenantId, workspaceId);
  return 0;
}

export function getQuotaConfig(env = process.env) {
  return {
    maxSubscriptionsPerWorkspace: Number(env.WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE ?? 25),
    maxDeliveriesPerMinutePerWorkspace: Number(env.WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE ?? 100)
  };
}
