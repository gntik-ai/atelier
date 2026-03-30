function assertTenantAndWorkspace(tenantId, workspaceId) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }
}

export async function getScopeMappings(db, tenantId, workspaceId) {
  assertTenantAndWorkspace(tenantId, workspaceId);

  const result = await db.query(
    `SELECT id, tenant_id, workspace_id, scope_name, channel_type, created_at, updated_at, created_by
       FROM realtime_scope_channel_mappings
      WHERE tenant_id = $1
        AND workspace_id = $2
      ORDER BY scope_name ASC, channel_type ASC`,
    [tenantId, workspaceId]
  );

  return result.rows;
}

export async function upsertScopeMapping(db, mapping) {
  assertTenantAndWorkspace(mapping.tenantId, mapping.workspaceId);

  const result = await db.query(
    `INSERT INTO realtime_scope_channel_mappings (
        tenant_id,
        workspace_id,
        scope_name,
        channel_type,
        created_by
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, workspace_id, scope_name, channel_type)
      DO UPDATE SET
        updated_at = now(),
        created_by = EXCLUDED.created_by
      RETURNING id, tenant_id, workspace_id, scope_name, channel_type, created_at, updated_at, created_by`,
    [
      mapping.tenantId,
      mapping.workspaceId,
      mapping.scopeName,
      mapping.channelType,
      mapping.createdBy
    ]
  );

  return result.rows[0];
}
