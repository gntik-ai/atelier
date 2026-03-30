const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function assertTenantIsolation(tenantId, isSuperadmin = false) {
  if (tenantId === null && !isSuperadmin) {
    throw Object.assign(new Error('tenant_id is required'), {
      code: 'TENANT_ISOLATION_VIOLATION'
    });
  }
}

function normalizeLimit(limit) {
  const parsed = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_LIMIT;
  if (parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function normalizeOffset(offset) {
  const parsed = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  return parsed < 0 ? 0 : parsed;
}

function buildTenantPredicate(columnName, tenantId, isSuperadmin, values) {
  assertTenantIsolation(tenantId, isSuperadmin);

  if (tenantId === null) {
    return null;
  }

  values.push(tenantId);
  return `${columnName} = $${values.length}`;
}

export async function listOperations(db, params = {}) {
  const values = [];
  const filters = [];
  const tenantFilter = buildTenantPredicate('tenant_id', params.tenant_id ?? null, params.isSuperadmin === true, values);

  if (tenantFilter) {
    filters.push(tenantFilter);
  }

  if (params.status) {
    values.push(params.status);
    filters.push(`status = $${values.length}`);
  }

  if (params.operationType) {
    values.push(params.operationType);
    filters.push(`operation_type = $${values.length}`);
  }

  if (params.workspaceId) {
    values.push(params.workspaceId);
    filters.push(`workspace_id = $${values.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = normalizeLimit(params.limit);
  const offset = normalizeOffset(params.offset);

  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM async_operations ${whereClause}`, values);

  const itemValues = [...values, limit, offset];
  const itemsResult = await db.query(
    `SELECT *
       FROM async_operations
       ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${itemValues.length - 1}
     OFFSET $${itemValues.length}`,
    itemValues
  );

  return {
    items: itemsResult.rows.map((row) => ({ ...row })),
    total: countResult.rows[0]?.total ?? 0,
    pagination: { limit, offset }
  };
}

export async function getOperationById(db, params = {}) {
  const values = [params.operation_id];
  const filters = ['operation_id = $1'];
  const tenantFilter = buildTenantPredicate('tenant_id', params.tenant_id ?? null, params.isSuperadmin === true, values);

  if (tenantFilter) {
    filters.push(tenantFilter);
  }

  const result = await db.query(`SELECT * FROM async_operations WHERE ${filters.join(' AND ')}`, values);
  return result.rows[0] ? { ...result.rows[0] } : null;
}

export async function getOperationLogs(db, params = {}) {
  assertTenantIsolation(params.tenant_id ?? null, false);

  const limit = normalizeLimit(params.limit);
  const offset = normalizeOffset(params.offset);
  const baseValues = [params.operation_id, params.tenant_id];

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM async_operation_log_entries log_entries
       JOIN async_operations operations ON operations.operation_id = log_entries.operation_id
      WHERE log_entries.operation_id = $1
        AND operations.tenant_id = $2`,
    baseValues
  );

  const entriesResult = await db.query(
    `SELECT log_entries.log_entry_id,
            log_entries.level,
            log_entries.message,
            log_entries.occurred_at,
            log_entries.metadata
       FROM async_operation_log_entries log_entries
       JOIN async_operations operations ON operations.operation_id = log_entries.operation_id
      WHERE log_entries.operation_id = $1
        AND operations.tenant_id = $2
      ORDER BY log_entries.occurred_at ASC
      LIMIT $3 OFFSET $4`,
    [...baseValues, limit, offset]
  );

  return {
    entries: entriesResult.rows.map((row) => ({ ...row })),
    total: countResult.rows[0]?.total ?? 0,
    pagination: { limit, offset }
  };
}

export async function getOperationResult(db, params = {}) {
  assertTenantIsolation(params.tenant_id ?? null, false);

  const result = await db.query(
    `SELECT operation_id, status, result, error_summary, updated_at, completed_at
       FROM async_operations
      WHERE operation_id = $1
        AND tenant_id = $2`,
    [params.operation_id, params.tenant_id]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const resultType = row.status === 'completed' ? 'success' : row.status === 'failed' ? 'failure' : 'pending';
  const successSummary =
    typeof row.result === 'string'
      ? row.result
      : row.result && typeof row.result === 'object'
        ? row.result.summary ?? row.result.message ?? null
        : null;
  const failureReason =
    row.error_summary && typeof row.error_summary === 'object' ? row.error_summary.message ?? null : null;
  const retryable =
    row.error_summary && typeof row.error_summary === 'object' && typeof row.error_summary.retryable === 'boolean'
      ? row.error_summary.retryable
      : null;
  const completedAt = row.completed_at ?? (resultType === 'pending' ? null : row.updated_at ?? null);

  return {
    operation_id: row.operation_id,
    status: row.status,
    resultType,
    summary: resultType === 'success' ? successSummary : null,
    failureReason,
    retryable,
    completedAt
  };
}
