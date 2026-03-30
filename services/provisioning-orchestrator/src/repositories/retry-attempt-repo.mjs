function requireTenantId(tenantId) {
  if (!tenantId) {
    throw Object.assign(new Error('tenant_id is required'), { code: 'VALIDATION_ERROR', field: 'tenant_id' });
  }
}

function mapAttemptRow(row) {
  return row ? { ...row } : null;
}

export async function create(db, attempt) {
  requireTenantId(attempt?.tenant_id);

  const result = await db.query(
    `INSERT INTO retry_attempts (
      attempt_id, operation_id, tenant_id, attempt_number, correlation_id,
      actor_id, actor_type, status, created_at, completed_at, metadata
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11
    ) RETURNING *`,
    [
      attempt.attempt_id,
      attempt.operation_id,
      attempt.tenant_id,
      attempt.attempt_number,
      attempt.correlation_id,
      attempt.actor_id,
      attempt.actor_type,
      attempt.status,
      attempt.created_at,
      attempt.completed_at,
      attempt.metadata
    ]
  );

  return mapAttemptRow(result.rows[0]);
}

export async function findByOperationId(db, { operation_id, tenant_id } = {}) {
  requireTenantId(tenant_id);

  const result = await db.query(
    `SELECT *
       FROM retry_attempts
      WHERE operation_id = $1
        AND tenant_id = $2
      ORDER BY attempt_number ASC`,
    [operation_id, tenant_id]
  );

  return result.rows.map(mapAttemptRow);
}
