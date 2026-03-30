export const CAPTURE_STATUSES = new Set(['active', 'paused', 'errored', 'disabled']);
export const CAPTURE_MODES = new Set(['delta', 'full-document']);

export class MongoCaptureConfig {
  constructor(attrs) {
    this.id = attrs.id;
    this.tenant_id = attrs.tenant_id;
    this.workspace_id = attrs.workspace_id;
    this.data_source_ref = attrs.data_source_ref;
    this.database_name = attrs.database_name;
    this.collection_name = attrs.collection_name;
    this.capture_mode = attrs.capture_mode ?? 'delta';
    this.status = attrs.status ?? 'active';
    this.activation_ts = attrs.activation_ts ?? null;
    this.deactivation_ts = attrs.deactivation_ts ?? null;
    this.actor_identity = attrs.actor_identity;
    this.last_error = attrs.last_error ?? null;
    this.created_at = attrs.created_at ?? null;
    this.updated_at = attrs.updated_at ?? null;
    MongoCaptureConfig.validate(this);
  }

  static validate(attrs) {
    for (const key of ['tenant_id', 'workspace_id', 'data_source_ref', 'database_name', 'collection_name', 'actor_identity']) {
      if (!attrs[key]) throw new Error(`MONGO_CAPTURE_${key.toUpperCase()}_REQUIRED`);
    }
    if (!CAPTURE_STATUSES.has(attrs.status ?? 'active')) throw new Error('INVALID_MONGO_CAPTURE_STATUS');
    if (!CAPTURE_MODES.has(attrs.capture_mode ?? 'delta')) throw new Error('INVALID_MONGO_CAPTURE_MODE');
    return true;
  }

  qualifiedNs() { return `${this.database_name}.${this.collection_name}`; }
  static fromRow(row) { return new MongoCaptureConfig(row); }
  toJSON() { return { ...this }; }
}
