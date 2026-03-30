export class CaptureQuotaRepository {
  constructor(pool) { this.pool = pool; }
  async getQuota(scope, scopeId) {
    const { rows } = await this.pool.query('SELECT * FROM pg_capture_quotas WHERE scope = $1 AND scope_id = $2 LIMIT 1', [scope, scopeId]);
    return rows[0] ?? null;
  }
  async countActive(scope, scopeId) {
    const column = scope === 'tenant' ? 'tenant_id' : 'workspace_id';
    const { rows } = await this.pool.query(`SELECT COUNT(*)::int AS count FROM pg_capture_configs WHERE ${column} = $1 AND status = 'active'`, [scopeId]);
    return rows[0]?.count ?? 0;
  }
  async upsert(scope, scopeId, maxTables) {
    const { rows } = await this.pool.query(`INSERT INTO pg_capture_quotas (scope, scope_id, max_tables) VALUES ($1,$2,$3)
      ON CONFLICT (scope, scope_id) DO UPDATE SET max_tables = $3, updated_at = now() RETURNING *`, [scope, scopeId, maxTables]);
    return rows[0];
  }
}
