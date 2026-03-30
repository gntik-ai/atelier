import { resolveQuota } from '../../models/realtime/SubscriptionQuota.mjs';
import { Subscription } from '../../models/realtime/Subscription.mjs';

export class QuotaRepository {
  constructor(db, { platformDefault = Number(process.env.REALTIME_SUBSCRIPTION_DEFAULT_QUOTA ?? 100), tenantDefault = Number(process.env.REALTIME_TENANT_DEFAULT_QUOTA ?? 500) } = {}) {
    this.db = db;
    this.platformDefault = platformDefault;
    this.tenantDefault = tenantDefault;
  }

  async findQuota(tenantId, workspaceId) {
    const { rows } = await this.db.query(
      `SELECT workspace_id, max_subscriptions FROM subscription_quotas WHERE tenant_id = $1 AND (workspace_id = $2 OR workspace_id IS NULL) ORDER BY workspace_id DESC NULLS LAST`,
      [tenantId, workspaceId]
    );
    const workspaceQuota = rows.find((row) => row.workspace_id === workspaceId)?.max_subscriptions;
    const tenantQuota = rows.find((row) => row.workspace_id == null)?.max_subscriptions ?? this.tenantDefault;
    return resolveQuota({ workspaceQuota, tenantQuota, platformDefault: this.platformDefault });
  }

  async atomicInsertWithQuotaCheck(tenantId, workspaceId, subscriptionData) {
    const quota = await this.findQuota(tenantId, workspaceId);
    const { rows } = await this.db.query(
      `WITH current_count AS (
         SELECT COUNT(*)::int AS cnt FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND status != 'deleted'
       )
       INSERT INTO realtime_subscriptions (tenant_id, workspace_id, channel_id, channel_type, owner_identity, owner_client_id, event_filter, status, metadata)
       SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb
       FROM current_count
       WHERE current_count.cnt < $10
       RETURNING *`,
      [tenantId, workspaceId, subscriptionData.channel_id, subscriptionData.channel_type, subscriptionData.owner_identity, subscriptionData.owner_client_id ?? null, JSON.stringify(subscriptionData.event_filter ?? null), subscriptionData.status ?? 'active', JSON.stringify(subscriptionData.metadata ?? null), quota]
    );
    if (!rows[0]) return null;
    return Subscription.fromRow(rows[0]);
  }
}
