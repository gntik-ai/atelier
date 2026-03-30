import { MongoCaptureConfig } from '../../models/realtime/MongoCaptureConfig.mjs';

const defaultQuota = (scope) => Number(process.env[scope === 'workspace' ? 'MONGO_CAPTURE_DEFAULT_WORKSPACE_QUOTA' : 'MONGO_CAPTURE_DEFAULT_TENANT_QUOTA'] ?? (scope === 'workspace' ? 10 : 50));

export class MongoCaptureConfigRepository {
  constructor(pool) { this.pool = pool; }

  async create(attrs) {
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    const release = client.release?.bind(client);
    const activationTs = attrs.activation_ts ?? new Date().toISOString();

    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${attrs.workspace_id}mongo_capture_quota`]);

      const workspaceQuota = await client.query(`SELECT COALESCE((SELECT max_collections FROM mongo_capture_quotas WHERE scope='workspace' AND scope_id=$1), $2::int) AS quota,
        (SELECT COUNT(*)::int FROM mongo_capture_configs WHERE workspace_id=$1 AND status='active') AS current`, [attrs.workspace_id, defaultQuota('workspace')]);
      const w = workspaceQuota.rows[0];
      if (Number(w.current) >= Number(w.quota)) throw { code: 'QUOTA_EXCEEDED', scope: 'workspace', limit: Number(w.quota), current: Number(w.current) };

      const tenantQuota = await client.query(`SELECT COALESCE((SELECT max_collections FROM mongo_capture_quotas WHERE scope='tenant' AND scope_id=$1), $2::int) AS quota,
        (SELECT COUNT(*)::int FROM mongo_capture_configs WHERE tenant_id=$1 AND status='active') AS current`, [attrs.tenant_id, defaultQuota('tenant')]);
      const t = tenantQuota.rows[0];
      if (Number(t.current) >= Number(t.quota)) throw { code: 'QUOTA_EXCEEDED', scope: 'tenant', limit: Number(t.quota), current: Number(t.current) };

      const existingResult = await client.query(`SELECT * FROM mongo_capture_configs
        WHERE workspace_id = $1 AND data_source_ref = $2 AND database_name = $3 AND collection_name = $4
        LIMIT 1`, [attrs.workspace_id, attrs.data_source_ref, attrs.database_name, attrs.collection_name]);
      const existing = existingResult.rows[0];

      if (existing?.status === 'active') {
        throw { code: 'CAPTURE_ALREADY_ACTIVE', capture: MongoCaptureConfig.fromRow(existing) };
      }

      let rows;
      if (existing) {
        ({ rows } = await client.query(`UPDATE mongo_capture_configs
          SET tenant_id = $2,
              capture_mode = $3,
              status = $4,
              actor_identity = $5,
              activation_ts = $6,
              deactivation_ts = NULL,
              last_error = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING *`, [existing.id, attrs.tenant_id, attrs.capture_mode ?? 'delta', attrs.status ?? 'active', attrs.actor_identity, activationTs]));
      } else {
        ({ rows } = await client.query(`INSERT INTO mongo_capture_configs (tenant_id, workspace_id, data_source_ref, database_name, collection_name, capture_mode, status, actor_identity, activation_ts)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING *`, [attrs.tenant_id, attrs.workspace_id, attrs.data_source_ref, attrs.database_name, attrs.collection_name, attrs.capture_mode ?? 'delta', attrs.status ?? 'active', attrs.actor_identity, activationTs]));
      }

      await client.query('COMMIT');
      return MongoCaptureConfig.fromRow(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      release?.();
    }
  }

  async findActive(dataSourceRef) {
    const { rows } = await this.pool.query(`SELECT * FROM mongo_capture_configs WHERE data_source_ref = $1 AND status = 'active' ORDER BY created_at ASC`, [dataSourceRef]);
    return rows.map((row) => MongoCaptureConfig.fromRow(row));
  }

  async findByWorkspace(tenantId, workspaceId, status = null) {
    const { rows } = await this.pool.query(`SELECT * FROM mongo_capture_configs WHERE tenant_id=$1 AND workspace_id=$2 AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC`, [tenantId, workspaceId, status]);
    return rows.map((row) => MongoCaptureConfig.fromRow(row));
  }

  async findById(tenantId, workspaceId, id) {
    const { rows } = await this.pool.query(`SELECT * FROM mongo_capture_configs WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 LIMIT 1`, [tenantId, workspaceId, id]);
    return rows[0] ? MongoCaptureConfig.fromRow(rows[0]) : null;
  }

  async findByTenantSummary(tenantId) {
    const { rows } = await this.pool.query(`SELECT workspace_id, COUNT(*)::int AS active_count,
      array_agg(json_build_object('id', id, 'database_name', database_name, 'collection_name', collection_name) ORDER BY created_at) AS collections
      FROM mongo_capture_configs WHERE tenant_id = $1 AND status='active' GROUP BY workspace_id ORDER BY workspace_id`, [tenantId]);
    return rows.map((row) => ({ ...row, active_count: Number(row.active_count) }));
  }

  async updateStatus(id, status, { lastError = null, deactivationTs = null, actorIdentity }) {
    const { rows } = await this.pool.query(`UPDATE mongo_capture_configs SET status=$2, last_error=$3, deactivation_ts=$4, actor_identity=$5, updated_at=now() WHERE id=$1 RETURNING *`, [id, status, lastError, deactivationTs, actorIdentity]);
    return rows[0] ? MongoCaptureConfig.fromRow(rows[0]) : null;
  }

  async disable(id, actorIdentity) {
    return this.updateStatus(id, 'disabled', { deactivationTs: new Date().toISOString(), actorIdentity });
  }
}
