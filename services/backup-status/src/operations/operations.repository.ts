/**
 * Data access layer for backup_operations table.
 */

import type {
  OperationRecord,
  OperationType,
  OperationStatus,
} from './operations.types.js'

// Reuse the same DB client pattern from the existing repository
interface DbClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

let _client: DbClient | null = null

function getClient(): DbClient {
  if (_client) return _client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg')
  const pool = new Pool({ connectionString: process.env.DB_URL })
  _client = pool
  return _client
}

/** Allow injecting a mock client for testing */
export function setClient(client: DbClient | null): void {
  _client = client
}

function rowToRecord(row: Record<string, unknown>): OperationRecord {
  return {
    id: row.id as string,
    type: row.type as OperationType,
    tenantId: row.tenant_id as string,
    componentType: row.component_type as string,
    instanceId: row.instance_id as string,
    status: row.status as OperationStatus,
    requesterId: row.requester_id as string,
    requesterRole: row.requester_role as string,
    snapshotId: (row.snapshot_id as string) ?? null,
    failureReason: (row.failure_reason as string) ?? null,
    failureReasonPublic: (row.failure_reason_public as string) ?? null,
    adapterOperationId: (row.adapter_operation_id as string) ?? null,
    acceptedAt: new Date(row.accepted_at as string),
    inProgressAt: row.in_progress_at ? new Date(row.in_progress_at as string) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    failedAt: row.failed_at ? new Date(row.failed_at as string) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
  }
}

export async function create(
  record: Omit<OperationRecord, 'id' | 'status' | 'acceptedAt' | 'inProgressAt' | 'completedAt' | 'failedAt' | 'failureReason' | 'failureReasonPublic' | 'adapterOperationId'>,
): Promise<OperationRecord> {
  const client = getClient()
  const result = await client.query(
    `INSERT INTO backup_operations
      (type, tenant_id, component_type, instance_id, requester_id, requester_role, snapshot_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      record.type,
      record.tenantId,
      record.componentType,
      record.instanceId,
      record.requesterId,
      record.requesterRole,
      record.snapshotId ?? null,
      record.metadata ? JSON.stringify(record.metadata) : null,
    ],
  )
  return rowToRecord(result.rows[0])
}

export async function findById(id: string): Promise<OperationRecord | null> {
  const client = getClient()
  const result = await client.query(
    'SELECT * FROM backup_operations WHERE id = $1',
    [id],
  )
  return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null
}

export async function findActive(
  tenantId: string,
  componentType: string,
  instanceId: string,
  type: OperationType,
): Promise<OperationRecord | null> {
  const client = getClient()
  const result = await client.query(
    `SELECT * FROM backup_operations
     WHERE tenant_id = $1
       AND component_type = $2
       AND instance_id = $3
       AND type = $4
       AND status IN ('accepted', 'in_progress')
     LIMIT 1`,
    [tenantId, componentType, instanceId, type],
  )
  return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null
}

export async function updateStatus(
  id: string,
  status: OperationStatus,
  opts?: {
    failureReason?: string
    failureReasonPublic?: string
    adapterOperationId?: string
  },
): Promise<OperationRecord | null> {
  const timestampCol =
    status === 'in_progress' ? 'in_progress_at'
    : status === 'completed' ? 'completed_at'
    : status === 'failed' ? 'failed_at'
    : null

  const setClauses = ['status = $2']
  const params: unknown[] = [id, status]
  let paramIdx = 3

  if (timestampCol) {
    setClauses.push(`${timestampCol} = NOW()`)
  }

  if (opts?.failureReason !== undefined) {
    setClauses.push(`failure_reason = $${paramIdx}`)
    params.push(opts.failureReason)
    paramIdx++
  }

  if (opts?.failureReasonPublic !== undefined) {
    setClauses.push(`failure_reason_public = $${paramIdx}`)
    params.push(opts.failureReasonPublic)
    paramIdx++
  }

  if (opts?.adapterOperationId !== undefined) {
    setClauses.push(`adapter_operation_id = $${paramIdx}`)
    params.push(opts.adapterOperationId)
    paramIdx++
  }

  const client = getClient()
  const result = await client.query(
    `UPDATE backup_operations SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null
}

export async function listByTenant(
  tenantId: string,
  limit = 20,
): Promise<OperationRecord[]> {
  const client = getClient()
  const result = await client.query(
    'SELECT * FROM backup_operations WHERE tenant_id = $1 ORDER BY accepted_at DESC LIMIT $2',
    [tenantId, limit],
  )
  return result.rows.map(rowToRecord)
}
