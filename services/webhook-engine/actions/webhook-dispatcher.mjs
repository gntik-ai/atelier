import { buildDeliveryRecord } from '../src/webhook-delivery.mjs';
import { checkDeliveryRateLimit, getQuotaConfig, incrementRateCounter } from '../src/webhook-quota.mjs';

export async function main(params) {
  const { db, invoker, event, env = process.env } = params;
  if (String(env.WEBHOOK_ENGINE_ENABLED ?? 'true') !== 'true') return { queued: 0, skipped: 'disabled' };
  const quotaConfig = getQuotaConfig(env);
  const subscriptions = await db.findSubscriptionsForEvent(event.tenantId, event.workspaceId, event.eventType);
  let queued = 0;
  for (const subscription of subscriptions) {
    const counter = await incrementRateCounter(db, subscription.workspace_id);
    if (!checkDeliveryRateLimit(subscription.workspace_id, counter, quotaConfig.maxDeliveriesPerMinutePerWorkspace).allowed) continue;
    const delivery = buildDeliveryRecord(subscription, event, { maxAttempts: Number(env.WEBHOOK_MAX_RETRY_ATTEMPTS ?? 5) });
    const inserted = await db.insertDelivery(delivery);
    if (!inserted) continue;
    queued += 1;
    if (invoker?.invoke) await invoker.invoke('webhook-delivery-worker', { deliveryId: delivery.id });
  }
  return { queued };
}
