import crypto from 'node:crypto';
const VALID = new Set(['capture-enabled', 'capture-disabled', 'capture-errored', 'capture-paused', 'capture-resumed', 'quota-exceeded']);
export class PgCaptureLifecyclePublisher {
  constructor(kafkaProducer) { this.kafkaProducer = kafkaProducer; }
  async publish(eventType, payload) {
    if (!VALID.has(eventType)) throw new Error('INVALID_PG_CAPTURE_LIFECYCLE_EVENT');
    const envelope = {
      specversion: '1.0',
      id: crypto.randomUUID(),
      type: `console.pg-capture.${eventType}`,
      source: `/workspaces/${payload.workspaceId}/pg-captures`,
      time: new Date().toISOString(),
      tenantid: payload.tenantId,
      workspaceid: payload.workspaceId,
      data: payload
    };
    await this.kafkaProducer?.send?.({ topic: process.env.PG_CAPTURE_KAFKA_TOPIC_LIFECYCLE ?? 'console.pg-capture.lifecycle', messages: [{ key: payload.workspaceId, value: JSON.stringify(envelope) }] });
    return envelope;
  }
}
