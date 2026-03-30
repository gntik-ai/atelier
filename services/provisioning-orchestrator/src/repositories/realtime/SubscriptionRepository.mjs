import { Subscription } from '../../models/realtime/Subscription.mjs';

export class SubscriptionRepository {
  constructor(db) { this.db = db; }

  async create(data) {
    const { rows } = await this.db.query(
      `INSERT INTO realtime_subscriptions (tenant_id, workspace_id, channel_id, channel_type, owner_identity, owner_client_id, event_filter, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb) RETURNING *`,
      [data.tenant_id, data.workspace_id, data.channel_id, data.channel_type, data.owner_identity, data.owner_client_id ?? null, JSON.stringify(data.event_filter ?? null), data.status ?? 'active', JSON.stringify(data.metadata ?? null)]
    );
    return Subscription.fromRow(rows[0]);
  }

  async findById(tenantId, workspaceId, id) {
    const { rows } = await this.db.query(
      `SELECT * FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 AND status != 'deleted' LIMIT 1`,
      [tenantId, workspaceId, id]
    );
    return rows[0] ? Subscription.fromRow(rows[0]) : null;
  }

  async list(tenantId, workspaceId, filters = {}, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const params = [tenantId, workspaceId, filters.status ?? null, pageSize, offset];
    const query = `SELECT * FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND status != 'deleted' AND ($3::text IS NULL OR status = $3) ORDER BY created_at DESC LIMIT $4 OFFSET $5`;
    const countQuery = `SELECT COUNT(*)::int AS total FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND status != 'deleted' AND ($3::text IS NULL OR status = $3)`;
    const [itemsResult, countResult] = await Promise.all([this.db.query(query, params), this.db.query(countQuery, params.slice(0, 3))]);
    return { items: itemsResult.rows.map(Subscription.fromRow), total: countResult.rows[0].total, page, pageSize };
  }

  async update(tenantId, workspaceId, id, patch) {
    const fields = [];
    const values = [tenantId, workspaceId, id];
    let idx = 4;
    for (const key of ['status', 'event_filter', 'metadata', 'deleted_at']) {
      if (key in patch) {
        fields.push(`${key} = $${idx}${key === 'event_filter' || key === 'metadata' ? '::jsonb' : ''}`);
        values.push(key === 'event_filter' || key === 'metadata' ? JSON.stringify(patch[key]) : patch[key]);
        idx += 1;
      }
    }
    fields.push(`updated_at = now()`);
    const { rows } = await this.db.query(
      `UPDATE realtime_subscriptions SET ${fields.join(', ')} WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 RETURNING *`,
      values
    );
    return rows[0] ? Subscription.fromRow(rows[0]) : null;
  }

  async findTenantSummary(tenantId, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const { rows } = await this.db.query(
      `SELECT workspace_id, status, channel_type, COUNT(*)::int AS count FROM realtime_subscriptions WHERE tenant_id = $1 AND status != 'deleted' GROUP BY workspace_id, status, channel_type ORDER BY workspace_id, status, channel_type LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset]
    );
    const countResult = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM (SELECT 1 FROM realtime_subscriptions WHERE tenant_id = $1 AND status != 'deleted' GROUP BY workspace_id, status, channel_type) AS grouped`,
      [tenantId]
    );
    return { items: rows, total: countResult.rows[0].total, page, pageSize };
  }
}
