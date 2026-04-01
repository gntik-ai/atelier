/**
 * Response schema (v1) for the backup status API.
 */

import type { BackupStatus } from '../adapters/types.js'

export interface BackupStatusComponentResponse {
  component_type: string
  instance_label: string
  status: BackupStatus
  last_successful_backup_at: string | null
  last_checked_at: string
  stale: boolean
  stale_since: string | null
  // Only included for technical scope
  instance_id?: string
  detail?: string
}

export interface BackupStatusApiResponse {
  schema_version: '1'
  tenant_id: string | null
  queried_at: string
  components: BackupStatusComponentResponse[]
  deployment_backup_available: boolean
}

/**
 * Fields that must never appear in any public API response.
 */
export const PROHIBITED_FIELDS = ['adapter_metadata', 'connection_string'] as const
