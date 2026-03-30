export class KafkaChangePublisher {
  constructor({ kafka, maxEventsPerSecond = Number(process.env.MONGO_CDC_MAX_EVENTS_PER_SECOND ?? 1000), metricsCollector = null }) { this.kafka = kafka; this.maxEventsPerSecond = maxEventsPerSecond; this.metricsCollector = metricsCollector; this.windows = new Map(); this.connected = false; }
  async connect() { this.producer = this.kafka?.producer ? this.kafka.producer({ idempotent: true, acks: -1 }) : this.kafka?.producerObj; await this.producer?.connect?.(); this.connected = true; }
  _allow(workspaceId) { const now = Date.now(); const current = this.windows.get(workspaceId) ?? { count: 0, windowStart: now }; if (now - current.windowStart >= 1000) { current.count = 0; current.windowStart = now; } current.count += 1; this.windows.set(workspaceId, current); return current.count <= this.maxEventsPerSecond; }
  resolveTopic(captureConfig) { return process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX ?? `${captureConfig.tenant_id}.${captureConfig.workspace_id}.mongo-changes`; }
  async publish(topic, partitionKey, cloudeventsEnvelope, headers) {
    const workspaceId = cloudeventsEnvelope.workspaceid;
    if (!this._allow(workspaceId)) throw new Error('MONGO_CDC_RATE_LIMITED');
    await this.producer.send({ topic, messages: [{ key: partitionKey, value: JSON.stringify(cloudeventsEnvelope), headers }] });
    this.metricsCollector?.increment('mongo_cdc_events_published_total', { workspace_id: workspaceId, collection: `${cloudeventsEnvelope.data.database_name}.${cloudeventsEnvelope.data.collection_name}` });
    if (cloudeventsEnvelope.data.cluster_time) this.metricsCollector?.observe('mongo_cdc_publish_lag_seconds', { workspace_id: workspaceId }, Math.max(0, (Date.now() - new Date(cloudeventsEnvelope.data.cluster_time).getTime()) / 1000));
    return cloudeventsEnvelope;
  }
  async disconnect() { await this.producer?.disconnect?.(); this.connected = false; }
}
