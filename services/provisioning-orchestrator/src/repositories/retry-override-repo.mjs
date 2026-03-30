export async function createIfNotInProgress(client, override) {
  const existing = await client.query(
    `SELECT * FROM retry_overrides WHERE operation_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    [override.operationId ?? override.operation_id]
  );

  if (existing.rows[0]) {
    return { created: false, existing: existing.rows[0] };
  }

  const result = await client.query(
    `INSERT INTO retry_overrides (
      override_id, operation_id, flag_id, tenant_id, superadmin_id, justification, attempt_number, status, created_at, completed_at
    )
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
    WHERE NOT EXISTS (
      SELECT 1 FROM retry_overrides WHERE operation_id = $2 AND status = 'pending'
    )
    RETURNING *`,
    [
      override.overrideId ?? override.override_id,
      override.operationId ?? override.operation_id,
      override.flagId ?? override.flag_id,
      override.tenantId ?? override.tenant_id,
      override.superadminId ?? override.superadmin_id,
      override.justification,
      override.attemptNumber ?? override.attempt_number,
      override.status ?? 'pending',
      override.createdAt ?? override.created_at,
      override.completedAt ?? override.completed_at
    ]
  );

  if (!result.rows[0]) {
    const concurrent = await existing;
    return { created: false, existing: concurrent.rows?.[0] ?? null };
  }

  return { created: true, override: result.rows[0] };
}

export async function findByOperationId(client, operationId) {
  const result = await client.query(
    `SELECT * FROM retry_overrides WHERE operation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [operationId]
  );
  return result.rows[0] ?? null;
}

export async function completeOverride(client, overrideId, status) {
  const result = await client.query(
    `UPDATE retry_overrides
     SET status = $2, completed_at = NOW()
     WHERE override_id = $1
     RETURNING *`,
    [overrideId, status]
  );
  return result.rows[0] ?? null;
}
