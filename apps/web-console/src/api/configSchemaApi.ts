/**
 * API client for tenant config schema validation, migration, and format version endpoints.
 */

const API_BASE = (typeof process !== 'undefined' && process.env?.CONFIG_EXPORT_API_URL) || '/api'

// --- Types ---

export interface AjvError {
  path: string
  message: string
}

export interface ValidationResult {
  result: 'valid' | 'invalid' | 'valid_with_warnings'
  format_version: string
  errors: AjvError[]
  warnings: AjvError[]
  schema_checksum_match: boolean | null
  migration_required: boolean
}

export interface MigrationMetadata {
  migrated_from: string
  migrated_to: string
  migration_chain: string[]
  migrated_at: string
}

export interface MigrationWarning {
  step: string
  message: string
  affected_path?: string
}

export interface ExportArtifact {
  export_timestamp: string
  tenant_id: string
  format_version: string
  deployment_profile: string
  correlation_id: string
  schema_checksum: string
  domains: unknown[]
  _migration_metadata?: MigrationMetadata
  _migration_warnings?: MigrationWarning[]
}

export interface MigrationResult {
  migration_required: boolean
  artifact: ExportArtifact
  _migration_metadata?: MigrationMetadata
  _migration_warnings?: MigrationWarning[]
}

export interface FormatVersionEntry {
  version: string
  release_date: string
  change_notes: string
  schema_checksum: string
}

export interface FormatVersionsResponse {
  current_version: string
  min_migratable_version: string
  versions: FormatVersionEntry[]
}

export class ConfigSchemaApiError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'ConfigSchemaApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

// --- API functions ---

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) {
    const message = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new ConfigSchemaApiError(res.status, message, (data as { code?: string }).code)
  }
  return data as T
}

/**
 * Validate a config export artifact against its declared schema version.
 */
export async function validateArtifact(
  tenantId: string,
  artifact: unknown
): Promise<ValidationResult> {
  return request<ValidationResult>(
    `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/validate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact }),
    }
  )
}

/**
 * Migrate a config export artifact from an older format version to the current version.
 */
export async function migrateArtifact(
  tenantId: string,
  artifact: unknown
): Promise<MigrationResult> {
  return request<MigrationResult>(
    `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/migrate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact }),
    }
  )
}

/**
 * Get the list of supported config export format versions.
 */
export async function getFormatVersions(): Promise<FormatVersionsResponse> {
  return request<FormatVersionsResponse>(
    `${API_BASE}/v1/admin/config/format-versions`
  )
}
