export async function create(client, flag) {
  try {
    const result = await client.query(
      `INSERT INTO manual_intervention_flags (
        flag_id, operation_id, tenant_id, actor_id, reason, attempt_count_at_flag,
        last_error_code, last_error_summary, status, last_notification_at,
        created_at, resolved_at, resolved_by, resolution_method
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        flag.flagId ?? flag.flag_id,
        flag.operationId ?? flag.operation_id,
        flag.tenantId ?? flag.tenant_id,
        flag.actorId ?? flag.actor_id,
        flag.reason,
        flag.attemptCountAtFlag ?? flag.attempt_count_at_flag,
        flag.lastErrorCode ?? flag.last_error_code,
        flag.lastErrorSummary ?? flag.last_error_summary,
        flag.status ?? 'pending',
        flag.lastNotificationAt ?? flag.last_notification_at,
        flag.createdAt ?? flag.created_at,
        flag.resolvedAt ?? flag.resolved_at,
        flag.resolvedBy ?? flag.resolved_by,
        flag.resolutionMethod ?? flag.resolution_method
      ]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (error.code === '23505') {
      error.code = 'UNIQUE_VIOLATION';
    }
    throw error;
  }
}

export async function findByOperationId(client, operationId) {
  const result = await client.query(
    `SELECT * FROM manual_intervention_flags
     WHERE operation_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [operationId]
  );
  return result.rows[0] ?? null;
}

export async function findPendingByTenant(client, tenantId) {
  const result = await client.query(
    `SELECT * FROM manual_intervention_flags
     WHERE tenant_id = $1 AND status = 'pending'
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}

export async function resolveFlag(client, flagId, resolvedBy, resolutionMethod) {
  const result = await client.query(
    `UPDATE manual_intervention_flags
     SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution_method = $3
     WHERE flag_id = $1
     RETURNING *`,
    [flagId, resolvedBy, resolutionMethod]
  );
  return result.rows[0] ?? null;
}

export async function updateLastNotificationAt(client, flagId, timestamp = new Date().toISOString()) {
  const result = await client.query(
    `UPDATE manual_intervention_flags
     SET last_notification_at = $2
     WHERE flag_id = $1
     RETURNING *`,
    [flagId, timestamp]
  );
  return result.rows[0] ?? null;
}
