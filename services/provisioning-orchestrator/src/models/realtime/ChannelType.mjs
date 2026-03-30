export const CHANNEL_STATUSES = new Set(['available', 'unavailable', 'deprovisioned']);

export class ChannelType {
  constructor(attrs) {
    this.id = attrs.id;
    this.tenant_id = attrs.tenant_id;
    this.workspace_id = attrs.workspace_id;
    this.channel_type = attrs.channel_type;
    this.data_source_kind = attrs.data_source_kind;
    this.data_source_ref = attrs.data_source_ref;
    this.display_name = attrs.display_name ?? null;
    this.description = attrs.description ?? null;
    this.status = attrs.status ?? 'available';
    this.kafka_topic_pattern = attrs.kafka_topic_pattern ?? null;
    this.created_at = attrs.created_at ?? null;
    this.updated_at = attrs.updated_at ?? null;
    ChannelType.validate(this);
  }

  static validate(attrs) {
    for (const key of ['tenant_id', 'workspace_id', 'channel_type', 'data_source_kind', 'data_source_ref']) {
      if (!attrs[key]) throw new Error(`CHANNEL_${key.toUpperCase()}_REQUIRED`);
    }
    if (!CHANNEL_STATUSES.has(attrs.status ?? 'available')) throw new Error('INVALID_CHANNEL_STATUS');
    return true;
  }

  static fromRow(row) {
    return new ChannelType(row);
  }

  toJSON() {
    return { ...this };
  }
}
