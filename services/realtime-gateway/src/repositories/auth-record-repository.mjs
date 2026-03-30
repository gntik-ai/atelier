function ensureRequiredRecordFields(record) {
  const requiredKeys = ['tenantId', 'workspaceId', 'actorIdentity', 'channelType', 'action'];

  for (const key of requiredKeys) {
    if (!record[key]) {
      throw new Error(`Auth record field ${key} is required`);
    }
  }
}

export async function insertAuthRecord(db, record) {
  ensureRequiredRecordFields(record);

  await db.query(
    `INSERT INTO realtime_subscription_auth_records (
        tenant_id,
        workspace_id,
        actor_identity,
        subscription_id,
        channel_type,
        action,
        denial_reason,
        scopes_evaluated,
        filter_snapshot,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [
      record.tenantId,
      record.workspaceId,
      record.actorIdentity,
      record.subscriptionId ?? null,
      record.channelType,
      record.action,
      record.denialReason ?? record.suspensionReason ?? null,
      JSON.stringify(record.scopesEvaluated ?? []),
      record.filterSnapshot ? JSON.stringify(record.filterSnapshot) : null,
      record.timestamp ?? new Date().toISOString()
    ]
  );
}
