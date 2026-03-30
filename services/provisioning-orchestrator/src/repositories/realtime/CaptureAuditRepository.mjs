export class CaptureAuditRepository {
  constructor(pool) { this.pool = pool; }
  async append({ captureId, tenantId, workspaceId, actorIdentity, action, beforeState, afterState, requestId }) {
    const { rows } = await this.pool.query(`INSERT INTO pg_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, before_state, after_state, request_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING *`, [captureId ?? null, tenantId, workspaceId, actorIdentity, action, JSON.stringify(beforeState ?? null), JSON.stringify(afterState ?? null), requestId ?? null]);
    return rows[0];
  }
}
