function baseEvent(action, ctx, resourceId, extra = {}) {
  const payload = {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    actorId: ctx.actorId,
    action,
    resourceId,
    timestamp: new Date().toISOString(),
    ...extra
  };
  delete payload.signingSecret;
  delete payload.rawPayload;
  return payload;
}

export const subscriptionCreatedEvent = (ctx, resourceId) => baseEvent('subscription.created', ctx, resourceId);
export const subscriptionUpdatedEvent = (ctx, resourceId) => baseEvent('subscription.updated', ctx, resourceId);
export const subscriptionDeletedEvent = (ctx, resourceId) => baseEvent('subscription.deleted', ctx, resourceId);
export const subscriptionPausedEvent = (ctx, resourceId) => baseEvent('subscription.paused', ctx, resourceId);
export const subscriptionResumedEvent = (ctx, resourceId) => baseEvent('subscription.resumed', ctx, resourceId);
export const secretRotatedEvent = (ctx, resourceId) => baseEvent('secret.rotated', ctx, resourceId);
export const deliverySucceededEvent = (ctx, resourceId) => baseEvent('delivery.succeeded', ctx, resourceId);
export const deliveryPermanentlyFailedEvent = (ctx, resourceId) => baseEvent('delivery.permanently_failed', ctx, resourceId);
export const subscriptionAutoDisabledEvent = (ctx, resourceId) => baseEvent('subscription.auto_disabled', ctx, resourceId);
