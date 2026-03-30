import { EventEmitter } from 'node:events';
import { CaptureChangeEvent } from '../../provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs';
export class KafkaChangePublisher extends EventEmitter {
  constructor({ kafka, maxEventsPerSecond = Number(process.env.PG_CDC_MAX_EVENTS_PER_SECOND ?? 1000), metricsCollector = null }) { super(); this.kafka = kafka; this.maxEventsPerSecond = maxEventsPerSecond; this.metricsCollector = metricsCollector; this.windows = new Map(); this.connected = false; }
  async initialize() { this.producer = this.kafka?.producer ? this.kafka.producer({ idempotent: true, acks: -1 }) : this.kafka?.producerObj; await this.producer?.connect?.(); this.connected = true; }
  _allow(workspaceId) { const now = Date.now(); const current = this.windows.get(workspaceId) ?? { count: 0, windowStart: now }; if (now - current.windowStart >= 1000) { current.count = 0; current.windowStart = now; } current.count += 1; this.windows.set(workspaceId, current); return current.count <= this.maxEventsPerSecond; }
  async publish(captureConfig, decodedEvent, lsn, committedAt) {
    if (!this._allow(captureConfig.workspace_id)) { this.metricsCollector?.increment('pg_cdc_events_rate_limited_total', { workspace_id: captureConfig.workspace_id }); this.emit('rate-limited', captureConfig.workspace_id); return null; }
    const event = CaptureChangeEvent.create({ eventType: decodedEvent.type, schema: decodedEvent.relation.namespace, table: decodedEvent.relation.relationName, lsn, committedAt, rowPayload: decodedEvent.newRow ?? decodedEvent.oldRow ?? {}, captureConfigId: captureConfig.id, workspaceId: captureConfig.workspace_id, tenantId: captureConfig.tenant_id, sequence: decodedEvent.sequence ?? 0, dataSourceRef: captureConfig.data_source_ref });
    const topic = process.env.PG_CDC_KAFKA_TOPIC_PREFIX ?? `${captureConfig.tenant_id}.${captureConfig.workspace_id}.pg-changes`;
    const key = `${captureConfig.workspace_id}:${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}`;
    await this.producer.send({ topic, messages: [{ key, value: JSON.stringify(event), headers: { 'ce-type': 'console.pg-capture.change', 'ce-tenantid': captureConfig.tenant_id, 'ce-workspaceid': captureConfig.workspace_id, 'ce-source': `/data-sources/${captureConfig.data_source_ref}/tables/${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}` } }] });
    this.metricsCollector?.increment('pg_cdc_events_published_total', { workspace_id: captureConfig.workspace_id, table: `${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}` });
    this.metricsCollector?.set('pg_cdc_publish_lag_seconds', { workspace_id: captureConfig.workspace_id }, Math.max(0, (Date.now() - new Date(committedAt).getTime()) / 1000));
    return event;
  }
  async disconnect() { await this.producer?.disconnect?.(); this.connected = false; }
}
