function requireTenantId(tenantId) {
  if (!tenantId) {
    throw Object.assign(new Error('tenant_id is required'), { code: 'VALIDATION_ERROR', field: 'tenant_id' });
  }
}

function requireIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) {
    throw Object.assign(new Error('idempotency_key is required'), {
      code: 'VALIDATION_ERROR',
      field: 'idempotency_key'
    });
  }
}

function mapRecordRow(row) {
  return row ? { ...row } : null;
}

export async function findActive(db, { tenant_id, idempotency_key } = {}) {
  requireTenantId(tenant_id);
  requireIdempotencyKey(idempotency_key);

  const result = await db.query(
    `SELECT *
       FROM idempotency_key_records
      WHERE tenant_id = $1
        AND idempotency_key = $2
        AND expires_at > NOW()`,
    [tenant_id, idempotency_key]
  );

  return mapRecordRow(result.rows[0] ?? null);
}

export async function insertOrFind(db, record) {
  requireTenantId(record?.tenant_id);
  requireIdempotencyKey(record?.idempotency_key);

  const result = await db.query(
    `INSERT INTO idempotency_key_records (
      record_id, tenant_id, idempotency_key, operation_id, operation_type, params_hash, created_at, expires_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
    ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
      SET record_id = EXCLUDED.record_id,
          operation_id = EXCLUDED.operation_id,
          operation_type = EXCLUDED.operation_type,
          params_hash = EXCLUDED.params_hash,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at
      WHERE idempotency_key_records.expires_at <= NOW()
    RETURNING *`,
    [
      record.record_id,
      record.tenant_id,
      record.idempotency_key,
      record.operation_id,
      record.operation_type,
      record.params_hash,
      record.created_at,
      record.expires_at
    ]
  );

  if (result.rows[0]) {
    const stored = mapRecordRow(result.rows[0]);
    return {
      record: stored,
      created: stored.operation_id === record.operation_id
    };
  }

  const existing = await findActive(db, {
    tenant_id: record.tenant_id,
    idempotency_key: record.idempotency_key
  });

  return {
    record: existing,
    created: existing?.operation_id === record.operation_id
  };
}
