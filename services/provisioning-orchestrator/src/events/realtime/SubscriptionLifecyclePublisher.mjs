import crypto from 'node:crypto';

export class SubscriptionLifecyclePublisher {
  constructor({ producer, topic = process.env.REALTIME_SUBSCRIPTION_KAFKA_TOPIC ?? 'console.realtime.subscription-lifecycle' } = {}) {
    this.producer = producer;
    this.topic = topic;
  }

  buildEvent({ action, tenantId, workspaceId, actorIdentity, requestId, subscription, beforeState, afterState }) {
    return {
      specversion: '1.0',
      type: `console.realtime.subscription.${action}`,
      source: `/workspaces/${workspaceId}/realtime/subscriptions`,
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      tenantid: tenantId,
      workspaceid: workspaceId,
      data: {
        subscription_id: subscription?.id ?? null,
        channel_type: subscription?.channel_type ?? afterState?.channel_type ?? beforeState?.channel_type ?? null,
        owner_identity: subscription?.owner_identity ?? afterState?.owner_identity ?? beforeState?.owner_identity ?? null,
        action,
        before_state: beforeState ?? null,
        after_state: afterState ?? null,
        actor_identity: actorIdentity,
        request_id: requestId ?? null
      }
    };
  }

  async publish(payload) {
    const event = this.buildEvent(payload);
    if (this.producer?.send) {
      await this.producer.send({ topic: this.topic, messages: [{ key: payload.workspaceId, value: JSON.stringify(event) }] });
    }
    return event;
  }
}
