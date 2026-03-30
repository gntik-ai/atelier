import { CaptureConfig } from '../../models/realtime/CaptureConfig.mjs';

const defaultQuota = (scope) => Number(process.env[scope === 'workspace' ? 'PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA' : 'PG_CAPTURE_DEFAULT_TENANT_QUOTA'] ?? (scope === 'workspace' ? 10 : 50));

export class CaptureConfigRepository {
  constructor(pool) { this.pool = pool; }

  async create(attrs) {
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    const release = client.release?.bind(client);
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${attrs.workspace_id}pg_capture_quota`]);
      const workspaceQuota = await client.query(`SELECT COALESCE((SELECT max_tables FROM pg_capture_quotas WHERE scope='workspace' AND scope_id=$1), $2::int) AS quota,
        (SELECT COUNT(*)::int FROM pg_capture_configs WHERE workspace_id=$1 AND status='active') AS current`, [attrs.workspace_id, defaultQuota('workspace')]);
      const w = workspaceQuota.rows[0];
      if (w.current >= w.quota) throw { code: 'QUOTA_EXCEEDED', scope: 'workspace', limit: w.quota, current: w.current };
      const tenantQuota = await client.query(`SELECT COALESCE((SELECT max_tables FROM pg_capture_quotas WHERE scope='tenant' AND scope_id=$1), $2::int) AS quota,
        (SELECT COUNT(*)::int FROM pg_capture_configs WHERE tenant_id=$1 AND status='active') AS current`, [attrs.tenant_id, defaultQuota('tenant')]);
      const t = tenantQuota.rows[0];
      if (t.current >= t.quota) throw { code: 'QUOTA_EXCEEDED', scope: 'tenant', limit: t.quota, current: t.current };
      const { rows } = await client.query(`INSERT INTO pg_capture_configs (tenant_id, workspace_id, data_source_ref, schema_name, table_name, status, actor_identity, activation_ts, lsn_start)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (workspace_id, data_source_ref, schema_name, table_name)
        DO UPDATE SET updated_at = now()
        WHERE pg_capture_configs.status = 'active'
        RETURNING *`, [attrs.tenant_id, attrs.workspace_id, attrs.data_source_ref, attrs.schema_name ?? 'public', attrs.table_name, attrs.status ?? 'active', attrs.actor_identity, attrs.activation_ts ?? new Date().toISOString(), attrs.lsn_start ?? null]);
      if (!rows[0]) throw { code: 'CAPTURE_ALREADY_ACTIVE' };
      await client.query('COMMIT');
      return CaptureConfig.fromRow(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { release?.(); }
  }
  async findActive(dataSourceRef) {
    const { rows } = await this.pool.query(`SELECT * FROM pg_capture_configs WHERE data_source_ref = $1 AND status = 'active' ORDER BY created_at ASC`, [dataSourceRef]);
    return rows.map((row) => CaptureConfig.fromRow(row));
  }
  async findByWorkspace(tenantId, workspaceId, status = null) {
    const { rows } = await this.pool.query(`SELECT * FROM pg_capture_configs WHERE tenant_id=$1 AND workspace_id=$2 AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC`, [tenantId, workspaceId, status]);
    return rows.map((row) => CaptureConfig.fromRow(row));
  }
  async findById(tenantId, workspaceId, id) {
    const { rows } = await this.pool.query(`SELECT * FROM pg_capture_configs WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 LIMIT 1`, [tenantId, workspaceId, id]);
    return rows[0] ? CaptureConfig.fromRow(rows[0]) : null;
  }
  async findByTenantSummary(tenantId) {
    const { rows } = await this.pool.query(`SELECT workspace_id, COUNT(*)::int AS active_count, array_agg(json_build_object('id', id, 'schema_name', schema_name, 'table_name', table_name) ORDER BY created_at) AS tables FROM pg_capture_configs WHERE tenant_id = $1 AND status='active' GROUP BY workspace_id ORDER BY workspace_id`, [tenantId]);
    return rows;
  }
  async updateStatus(id, status, { lastError = null, deactivationTs = null, actorIdentity }) {
    const { rows } = await this.pool.query(`UPDATE pg_capture_configs SET status=$2, last_error=$3, deactivation_ts=$4, actor_identity=$5, updated_at=now() WHERE id=$1 RETURNING *`, [id, status, lastError, deactivationTs, actorIdentity]);
    return rows[0] ? CaptureConfig.fromRow(rows[0]) : null;
  }
  async disable(id, actorIdentity) { return this.updateStatus(id, 'disabled', { deactivationTs: new Date().toISOString(), actorIdentity }); }
}
