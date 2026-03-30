import { randomUUID } from 'node:crypto';
import { applyTransition } from '../models/async-operation.mjs';

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw Object.assign(new Error('tenant_id is required'), { code: 'VALIDATION_ERROR', field: 'tenant_id' });
  }
}

function requireActorId(actorId) {
  if (!actorId) {
    throw Object.assign(new Error('actor_id is required'), { code: 'VALIDATION_ERROR', field: 'actor_id' });
  }
}

function mapOperationRow(row) {
  return row ? { ...row } : null;
}

export async function createOperation(db, operation) {
  requireTenantId(operation?.tenant_id);
  requireActorId(operation?.actor_id);

  const result = await db.query(
    `INSERT INTO async_operations (
      operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type,
      status, error_summary, correlation_id, idempotency_key, saga_id, attempt_count, max_retries, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13, $14, $15
    ) RETURNING *`,
    [
      operation.operation_id,
      operation.tenant_id,
      operation.actor_id,
      operation.actor_type,
      operation.workspace_id,
      operation.operation_type,
      operation.status,
      operation.error_summary,
      operation.correlation_id,
      operation.idempotency_key,
      operation.saga_id,
      operation.attempt_count ?? 0,
      operation.max_retries ?? null,
      operation.created_at,
      operation.updated_at
    ]
  );

  return mapOperationRow(result.rows[0]);
}

export async function findById(db, { operation_id, tenant_id } = {}) {
  requireTenantId(tenant_id);

  const result = await db.query(
    'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2',
    [operation_id, tenant_id]
  );

  return mapOperationRow(result.rows[0] ?? null);
}

export async function findByIdAnyTenant(db, { operation_id } = {}) {
  const result = await db.query('SELECT * FROM async_operations WHERE operation_id = $1', [operation_id]);
  return mapOperationRow(result.rows[0] ?? null);
}

export async function findByIdWithTenant(db, { operation_id, tenant_id } = {}) {
  return findById(db, { operation_id, tenant_id });
}

export async function findByIdempotencyKey(db, { tenant_id, idempotency_key } = {}) {
  requireTenantId(tenant_id);

  const result = await db.query(
    'SELECT * FROM async_operations WHERE tenant_id = $1 AND idempotency_key = $2 ORDER BY created_at DESC LIMIT 1',
    [tenant_id, idempotency_key]
  );

  return mapOperationRow(result.rows[0] ?? null);
}

export async function findByTenant(db, { tenant_id, status, limit = 50, offset = 0 } = {}) {
  requireTenantId(tenant_id);

  const filters = ['tenant_id = $1'];
  const values = [tenant_id];

  if (status) {
    filters.push(`status = $${values.length + 1}`);
    values.push(status);
  }

  const whereClause = filters.join(' AND ');
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM async_operations WHERE ${whereClause}`, values);
  values.push(limit, offset);
  const itemsResult = await db.query(
    `SELECT * FROM async_operations WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { items: itemsResult.rows.map(mapOperationRow), total: countResult.rows[0].total };
}

export async function findAll(db, { status, limit = 50, offset = 0 } = {}) {
  const filters = [];
  const values = [];

  if (status) {
    filters.push(`status = $${values.length + 1}`);
    values.push(status);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM async_operations ${whereClause}`, values);
  values.push(limit, offset);
  const itemsResult = await db.query(
    `SELECT * FROM async_operations ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { items: itemsResult.rows.map(mapOperationRow), total: countResult.rows[0].total };
}

export async function insertAsyncOperationTransition(db, transition) {
  await db.query(
    `INSERT INTO async_operation_transitions (
      transition_id, operation_id, tenant_id, actor_id, previous_status, new_status, transitioned_at, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      transition.transition_id,
      transition.operation_id,
      transition.tenant_id,
      transition.actor_id,
      transition.previous_status,
      transition.new_status,
      transition.transitioned_at,
      transition.metadata
    ]
  );

  return { ...transition };
}

export async function atomicResetToRetry(db, { operation_id, tenant_id, correlation_id } = {}) {
  requireTenantId(tenant_id);

  const result = await db.query(
    `UPDATE async_operations
     SET status = 'pending',
         attempt_count = attempt_count + 1,
         correlation_id = $3,
         error_summary = NULL,
         updated_at = NOW()
     WHERE operation_id = $1 AND tenant_id = $2 AND status = 'failed'
     RETURNING *`,
    [operation_id, tenant_id, correlation_id]
  );

  return mapOperationRow(result.rows[0] ?? null);
}

export async function transitionOperation(db, { operation_id, tenant_id, new_status, actor_id, error_summary } = {}) {
  requireTenantId(tenant_id);
  requireActorId(actor_id);

  await db.query('BEGIN');

  try {
    const locked = await db.query(
      'SELECT * FROM async_operations WHERE operation_id = $1 AND tenant_id = $2 FOR UPDATE',
      [operation_id, tenant_id]
    );

    const existing = locked.rows[0];
    if (!existing) {
      throw Object.assign(new Error('Operation not found'), { code: 'NOT_FOUND' });
    }

    const updatedOperation = applyTransition(existing, { new_status, error_summary });
    const updateResult = await db.query(
      `UPDATE async_operations
       SET status = $3, error_summary = $4, updated_at = $5
       WHERE operation_id = $1 AND tenant_id = $2
       RETURNING *`,
      [operation_id, tenant_id, updatedOperation.status, updatedOperation.error_summary, updatedOperation.updated_at]
    );

    const transition = {
      transition_id: randomUUID(),
      operation_id,
      tenant_id,
      actor_id,
      previous_status: existing.status,
      new_status: updatedOperation.status,
      transitioned_at: updatedOperation.updated_at,
      metadata: updatedOperation.error_summary ? { error_summary: updatedOperation.error_summary } : null
    };

    await insertAsyncOperationTransition(db, transition);

    await db.query('COMMIT');
    return { updatedOperation: mapOperationRow(updateResult.rows[0]), transition };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
