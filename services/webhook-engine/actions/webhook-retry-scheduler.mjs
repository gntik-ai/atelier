import { deliveryPermanentlyFailedEvent, subscriptionAutoDisabledEvent } from '../src/webhook-audit.mjs';
import { buildRetryPolicy, computeNextAttemptAt, hasRetriesRemaining } from '../src/webhook-retry-policy.mjs';
import { shouldAutoDisable } from '../src/webhook-delivery.mjs';

export async function main(params) {
  const { db, kafka, invoker, deliveryId, attemptCount, env = process.env } = params;
  const delivery = await db.getDeliveryById(deliveryId);
  if (!delivery) return { status: 'missing' };
  const subscription = await db.getSubscription(delivery.subscription_id);
  if (!subscription || ['deleted', 'paused'].includes(subscription.status)) return { status: 'cancelled' };
  const policy = buildRetryPolicy(env);
  if (hasRetriesRemaining(attemptCount, delivery.max_attempts ?? policy.maxAttempts)) {
    const nextAttemptAt = computeNextAttemptAt(attemptCount, policy);
    await db.updateDelivery(deliveryId, { status: 'pending', next_attempt_at: nextAttemptAt });
    if (invoker?.invoke) await invoker.invoke('webhook-delivery-worker', { deliveryId, scheduledFor: nextAttemptAt });
    return { status: 'scheduled', nextAttemptAt };
  }
  const updatedDelivery = await db.updateDelivery(deliveryId, { status: 'permanently_failed', next_attempt_at: null });
  const updatedSubscription = await db.incrementSubscriptionFailures(subscription.id);
  const ctx = { tenantId: updatedDelivery.tenant_id, workspaceId: updatedDelivery.workspace_id, actorId: 'system' };
  await kafka?.publish?.('console.webhook.delivery.permanently_failed', deliveryPermanentlyFailedEvent(ctx, deliveryId));
  const threshold = Number(env.WEBHOOK_AUTO_DISABLE_THRESHOLD ?? 5);
  if (shouldAutoDisable(updatedSubscription, threshold)) {
    await db.updateSubscription(subscription.id, { status: 'disabled' });
    await kafka?.publish?.('console.webhook.subscription.auto_disabled', subscriptionAutoDisabledEvent(ctx, subscription.id));
    return { status: 'auto_disabled' };
  }
  return { status: 'permanently_failed' };
}
