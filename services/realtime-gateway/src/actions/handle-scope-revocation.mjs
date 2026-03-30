import { publishAuthDecision } from '../audit/audit-publisher.mjs';

export function createHandleScopeRevocationAction({
  publishAuthDecisionFn = publishAuthDecision,
  nowFn = () => new Date().toISOString()
} = {}) {
  return async function main(params, { db, kafka } = {}) {
    const { actorIdentity, tenantId } = params;
    const activeSessions = await db.query(
      `SELECT id, tenant_id, workspace_id, actor_identity, channel_type
         FROM realtime_sessions
        WHERE actor_identity = $1
          AND tenant_id = $2
          AND status = 'ACTIVE'`,
      [actorIdentity, tenantId]
    );

    let suspendedCount = 0;

    for (const session of activeSessions.rows) {
      const timestamp = nowFn();
      await db.query(
        `UPDATE realtime_sessions
            SET status = 'SUSPENDED',
                last_validated_at = $2,
                updated_at = $2
          WHERE id = $1`,
        [session.id, timestamp]
      );

      await publishAuthDecisionFn({
        action: 'SUSPENDED',
        tenantId: session.tenant_id,
        workspaceId: session.workspace_id,
        actorIdentity: session.actor_identity,
        subscriptionId: session.id,
        channelType: session.channel_type,
        scopesEvaluated: params.revokedScopes ?? [],
        suspensionReason: 'SCOPE_REVOKED',
        timestamp
      }, { kafka, db });

      suspendedCount += 1;
    }

    return { suspendedCount };
  };
}

export const main = createHandleScopeRevocationAction();
