import crypto from 'node:crypto';
export const EVENT_TYPES = new Set(['insert', 'update', 'delete']);
export class CaptureChangeEvent {
  static create({ eventType, schema, table, lsn, committedAt, rowPayload = {}, captureConfigId, workspaceId, tenantId, sequence = 0, dataSourceRef }) {
    if (!EVENT_TYPES.has(eventType)) throw new Error('INVALID_CHANGE_EVENT_TYPE');
    return {
      specversion: '1.0',
      type: 'console.pg-capture.change',
      source: `/data-sources/${dataSourceRef}/tables/${schema}.${table}`,
      id: crypto.randomUUID(),
      time: new Date(committedAt ?? Date.now()).toISOString(),
      tenantid: tenantId,
      workspaceid: workspaceId,
      data: {
        event_type: eventType,
        schema,
        table,
        lsn: String(lsn),
        committed_at: new Date(committedAt ?? Date.now()).toISOString(),
        row_payload: rowPayload,
        capture_config_id: captureConfigId,
        sequence
      }
    };
  }
  static fromKafkaMessage(msg) {
    return JSON.parse(typeof msg.value === 'string' ? msg.value : msg.value.toString('utf8'));
  }
}
