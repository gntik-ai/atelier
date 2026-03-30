import crypto from 'node:crypto';

const VALID = new Set([
  'capture-enabled',
  'capture-disabled',
  'capture-errored',
  'capture-paused',
  'capture-resumed',
  'quota-exceeded',
  'oversized-event',
  'stream-invalidated'
]);

const pick = (payload, camelKey, snakeKey) => payload[camelKey] ?? payload[snakeKey] ?? null;

export class MongoCaptureLifecyclePublisher {
  constructor(kafkaProducer) { this.kafkaProducer = kafkaProducer; }

  async publish(eventType, payload) {
    if (!VALID.has(eventType)) throw new Error('INVALID_MONGO_CAPTURE_LIFECYCLE_EVENT');

    const workspaceId = pick(payload, 'workspaceId', 'workspace_id');
    const tenantId = pick(payload, 'tenantId', 'tenant_id');
    const data = {
      capture_id: pick(payload, 'captureId', 'capture_id'),
      tenant_id: tenantId,
      workspace_id: workspaceId,
      actor_identity: pick(payload, 'actorIdentity', 'actor_identity'),
      action: payload.action ?? eventType,
      before_state: pick(payload, 'beforeState', 'before_state'),
      after_state: pick(payload, 'afterState', 'after_state'),
      request_id: pick(payload, 'requestId', 'request_id'),
      error_detail: pick(payload, 'errorDetail', 'error_detail')
    };

    if (payload.collection_name != null) data.collection_name = payload.collection_name;
    if (payload.database_name != null) data.database_name = payload.database_name;

    const envelope = {
      specversion: '1.0',
      id: crypto.randomUUID(),
      type: `console.mongo-capture.${eventType}`,
      source: `/workspaces/${workspaceId}/mongo-captures`,
      time: new Date().toISOString(),
      tenantid: tenantId,
      workspaceid: workspaceId,
      data
    };

    await this.kafkaProducer?.send?.({
      topic: process.env.MONGO_CAPTURE_KAFKA_TOPIC_LIFECYCLE ?? 'console.mongo-capture.lifecycle',
      messages: [{ key: workspaceId, value: JSON.stringify(envelope) }]
    });

    return envelope;
  }
}
