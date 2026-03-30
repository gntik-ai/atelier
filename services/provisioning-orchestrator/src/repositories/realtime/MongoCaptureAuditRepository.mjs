export class MongoCaptureAuditRepository {
  constructor(pool) { this.pool = pool; }
  async append({ capture_id = null, tenant_id, workspace_id, actor_identity, action, before_state = null, after_state = null, request_id = null }) {
    const { rows } = await this.pool.query(`INSERT INTO mongo_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, before_state, after_state, request_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING *`, [capture_id, tenant_id, workspace_id, actor_identity, action, JSON.stringify(before_state), JSON.stringify(after_state), request_id]);
    return rows[0];
  }
}
