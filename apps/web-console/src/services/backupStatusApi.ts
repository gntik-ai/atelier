/**
 * API client for the backup status endpoint.
 */

export type BackupStatus =
  | 'success'
  | 'failure'
  | 'partial'
  | 'in_progress'
  | 'not_configured'
  | 'not_available'
  | 'pending'

export interface BackupStatusComponent {
  component_type: string
  instance_label: string
  status: BackupStatus
  last_successful_backup_at: string | null
  last_checked_at: string
  stale: boolean
  stale_since: string | null
  instance_id?: string
  detail?: string
}

export interface BackupStatusResponse {
  schema_version: '1'
  tenant_id: string | null
  queried_at: string
  components: BackupStatusComponent[]
  deployment_backup_available: boolean
  message?: string
}

export class BackupStatusApiError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'BackupStatusApiError'
    this.statusCode = statusCode
  }
}

const BASE_URL = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? ''

export async function getBackupStatus(
  tenantId?: string,
  token?: string,
): Promise<BackupStatusResponse> {
  const url = new URL(`${BASE_URL}/v1/backup/status`, window.location.origin)
  if (tenantId) url.searchParams.set('tenant_id', tenantId)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url.toString(), { headers })

  if (res.status === 401) {
    throw new BackupStatusApiError(401, 'Unauthorized')
  }
  if (res.status === 403) {
    throw new BackupStatusApiError(403, 'Forbidden')
  }
  if (!res.ok) {
    throw new BackupStatusApiError(res.status, `API error: ${res.status}`)
  }

  return res.json()
}
