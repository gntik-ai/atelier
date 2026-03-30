export class AuditRepository {
  constructor(db) { this.db = db; }

  async append(auditRow) {
    const { rows } = await this.db.query(
      `INSERT INTO subscription_audit_log (subscription_id, tenant_id, workspace_id, actor_identity, action, before_state, after_state, request_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING *`,
      [auditRow.subscription_id ?? null, auditRow.tenant_id, auditRow.workspace_id, auditRow.actor_identity, auditRow.action, JSON.stringify(auditRow.before_state ?? null), JSON.stringify(auditRow.after_state ?? null), auditRow.request_id ?? null]
    );
    return rows[0];
  }
}
