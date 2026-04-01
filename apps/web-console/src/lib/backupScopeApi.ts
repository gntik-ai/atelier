import { requestConsoleSessionJson } from '@/lib/console-session'

// --- Types ---

export type CoverageStatus = 'platform-managed' | 'operator-managed' | 'not-supported' | 'unknown'
export type BackupGranularity = 'full' | 'incremental' | 'config-only' | 'none' | 'unknown'
export type OperationalStatus = 'operational' | 'degraded' | 'unknown'

export interface BackupScopeEntry {
  componentKey: string
  profileKey: string
  coverageStatus: CoverageStatus
  backupGranularity: BackupGranularity
  rpoRangeMinutes: { min: number; max: number } | null
  rtoRangeMinutes: { min: number; max: number } | null
  operationalStatus: OperationalStatus
  supportedByProfile: boolean
  maxBackupFrequencyMinutes: number | null
  maxRetentionDays: number | null
  maxConcurrentJobs: number | null
  maxBackupSizeGb: number | null
  preconditions: string[]
  limitations: string[]
  airGapNotes: string | null
  planCapabilityKey: string | null
}

export interface BackupScopeMatrixResponse {
  activeProfile: string
  requestedProfile: string
  entries: BackupScopeEntry[]
  generatedAt: string
  correlationId: string
}

export interface TenantBackupScopeEntry {
  componentKey: string
  coverageStatus: CoverageStatus
  backupGranularity: BackupGranularity
  rpoRangeMinutes: { min: number; max: number } | null
  rtoRangeMinutes: { min: number; max: number } | null
  operationalStatus: OperationalStatus
  tenantHasResources: boolean
  planRestriction: string | null
  recommendation: string | null
}

export interface TenantBackupScopeResponse {
  tenantId: string
  activeProfile: string
  planId: string
  entries: TenantBackupScopeEntry[]
  generatedAt: string
  correlationId: string
}

// --- API functions ---

export async function fetchAdminBackupScope(profile?: string): Promise<BackupScopeMatrixResponse> {
  const url = profile ? `/v1/admin/backup/scope?profile=${encodeURIComponent(profile)}` : '/v1/admin/backup/scope'
  return requestConsoleSessionJson(url) as Promise<BackupScopeMatrixResponse>
}

export async function fetchTenantBackupScope(tenantId: string): Promise<TenantBackupScopeResponse> {
  return requestConsoleSessionJson(`/v1/tenants/${encodeURIComponent(tenantId)}/backup/scope`) as Promise<TenantBackupScopeResponse>
}
