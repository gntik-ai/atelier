/**
 * Data access layer for backup_status_snapshots.
 * Only module that knows the table structure.
 */

export type BackupStatus =
  | 'success'
  | 'failure'
  | 'partial'
  | 'in_progress'
  | 'not_configured'
  | 'not_available'
  | 'pending'

export interface SnapshotInput {
  tenantId: string
  componentType: string
  instanceId: string
  instanceLabel?: string
  deploymentProfile?: string
  isSharedInstance: boolean
  status: BackupStatus
  lastSuccessfulBackupAt?: Date | null
  lastCheckedAt: Date
  detail?: string
  adapterMetadata?: Record<string, unknown>
}

export interface BackupSnapshot {
  id: string
  tenantId: string
  componentType: string
  instanceId: string
  instanceLabel: string | null
  deploymentProfile: string | null
  isSharedInstance: boolean
  status: BackupStatus
  lastSuccessfulBackupAt: Date | null
  lastCheckedAt: Date
  detail: string | null
  adapterMetadata: Record<string, unknown> | null
  collectedAt: Date
}

// Minimal DB interface — in production, use the shared pg client from the monorepo
interface DbClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

let _client: DbClient | null = null

function getClient(): DbClient {
  if (_client) return _client
  // Dynamic import pattern for pg — avoids hard dependency at module level
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg')
  const pool = new Pool({ connectionString: process.env.DB_URL })
  _client = pool
  return _client
}

/** Allow injection for testing */
export function setClient(client: DbClient): void {
  _client = client
}

function rowToSnapshot(row: Record<string, unknown>): BackupSnapshot {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    componentType: row.component_type as string,
    instanceId: row.instance_id as string,
    instanceLabel: (row.instance_label as string) ?? null,
    deploymentProfile: (row.deployment_profile as string) ?? null,
    isSharedInstance: row.is_shared_instance as boolean,
    status: row.status as BackupStatus,
    lastSuccessfulBackupAt: row.last_successful_backup_at ? new Date(row.last_successful_backup_at as string) : null,
    lastCheckedAt: new Date(row.last_checked_at as string),
    detail: (row.detail as string) ?? null,
    adapterMetadata: (row.adapter_metadata as Record<string, unknown>) ?? null,
    collectedAt: new Date(row.collected_at as string),
  }
}

export async function upsertSnapshot(snapshot: SnapshotInput): Promise<void> {
  const db = getClient()
  await db.query(
    `INSERT INTO backup_status_snapshots
       (tenant_id, component_type, instance_id, instance_label, deployment_profile,
        is_shared_instance, status, last_successful_backup_at, last_checked_at, detail, adapter_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, component_type, instance_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       last_successful_backup_at = EXCLUDED.last_successful_backup_at,
       last_checked_at = EXCLUDED.last_checked_at,
       detail = EXCLUDED.detail,
       adapter_metadata = EXCLUDED.adapter_metadata,
       instance_label = EXCLUDED.instance_label,
       deployment_profile = EXCLUDED.deployment_profile,
       is_shared_instance = EXCLUDED.is_shared_instance,
       collected_at = NOW()`,
    [
      snapshot.tenantId,
      snapshot.componentType,
      snapshot.instanceId,
      snapshot.instanceLabel ?? null,
      snapshot.deploymentProfile ?? null,
      snapshot.isSharedInstance,
      snapshot.status,
      snapshot.lastSuccessfulBackupAt ?? null,
      snapshot.lastCheckedAt,
      snapshot.detail ?? null,
      snapshot.adapterMetadata ? JSON.stringify(snapshot.adapterMetadata) : null,
    ],
  )
}

export async function getByTenant(
  tenantId: string,
  options?: { includeShared?: boolean },
): Promise<BackupSnapshot[]> {
  const db = getClient()
  const includeShared = options?.includeShared ?? false
  const result = includeShared
    ? await db.query(
        `SELECT * FROM backup_status_snapshots WHERE tenant_id = $1 OR is_shared_instance = TRUE ORDER BY last_checked_at DESC`,
        [tenantId],
      )
    : await db.query(
        `SELECT * FROM backup_status_snapshots WHERE tenant_id = $1 AND is_shared_instance = FALSE ORDER BY last_checked_at DESC`,
        [tenantId],
      )
  return result.rows.map(rowToSnapshot)
}

export async function getAll(options?: { includeShared?: boolean }): Promise<BackupSnapshot[]> {
  const db = getClient()
  const includeShared = options?.includeShared ?? true
  const result = includeShared
    ? await db.query(`SELECT * FROM backup_status_snapshots ORDER BY last_checked_at DESC`)
    : await db.query(
        `SELECT * FROM backup_status_snapshots WHERE is_shared_instance = FALSE ORDER BY last_checked_at DESC`,
      )
  return result.rows.map(rowToSnapshot)
}
