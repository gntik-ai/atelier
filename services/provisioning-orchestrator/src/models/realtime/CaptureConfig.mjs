export const CAPTURE_STATUSES = new Set(['active', 'paused', 'errored', 'disabled']);
export class CaptureConfig {
  constructor(attrs) {
    this.id = attrs.id;
    this.tenant_id = attrs.tenant_id;
    this.workspace_id = attrs.workspace_id;
    this.data_source_ref = attrs.data_source_ref;
    this.schema_name = attrs.schema_name ?? 'public';
    this.table_name = attrs.table_name;
    this.status = attrs.status ?? 'active';
    this.activation_ts = attrs.activation_ts ?? null;
    this.deactivation_ts = attrs.deactivation_ts ?? null;
    this.actor_identity = attrs.actor_identity;
    this.last_error = attrs.last_error ?? null;
    this.lsn_start = attrs.lsn_start ?? null;
    this.created_at = attrs.created_at ?? null;
    this.updated_at = attrs.updated_at ?? null;
    CaptureConfig.validate(this);
  }
  static validate(attrs) {
    for (const key of ['tenant_id', 'workspace_id', 'data_source_ref', 'table_name', 'actor_identity']) {
      if (!attrs[key]) throw new Error(`CAPTURE_${key.toUpperCase()}_REQUIRED`);
    }
    if (!CAPTURE_STATUSES.has(attrs.status ?? 'active')) throw new Error('INVALID_CAPTURE_STATUS');
    return true;
  }
  qualifiedTable() { return `${this.schema_name}.${this.table_name}`; }
  static fromRow(row) { return new CaptureConfig(row); }
  toJSON() { return { ...this }; }
}
