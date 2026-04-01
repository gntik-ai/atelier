/**
 * API client for tenant config pre-flight conflict check endpoint.
 */

const API_BASE = (typeof process !== 'undefined' && process.env?.CONFIG_PREFLIGHT_API_URL) || '/api'

export class ConfigPreflightApiError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'ConfigPreflightApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

// --- Types ---

export interface ConflictEntry {
  resource_type: string
  resource_name: string
  resource_id: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  diff: Record<string, { artifact: unknown; destination: unknown }> | null
  recommendation: string
}

export interface CompatibleWithRedactedEntry {
  resource_type: string
  resource_name: string
  resource_id: string | null
  redacted_fields: string[]
}

export interface DomainAnalysisResult {
  domain_key: string
  status: 'analyzed' | 'no_conflicts' | 'skipped_not_exportable' | 'analysis_error'
  resources_analyzed: number
  compatible_count: number
  compatible_with_redacted_count: number
  conflicts: ConflictEntry[]
  compatible_with_redacted?: CompatibleWithRedactedEntry[]
  analysis_error_message: string | null
}

export interface PreflightSummary {
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  total_resources_analyzed: number
  compatible: number
  compatible_with_redacted_fields: number
  conflict_counts: { low: number; medium: number; high: number; critical: number }
  incomplete_analysis: boolean
  domains_analyzed: string[]
  domains_skipped: string[]
}

export interface PreflightReport {
  correlation_id: string
  source_tenant_id: string
  target_tenant_id: string
  format_version: string
  analyzed_at: string
  summary: PreflightSummary
  domains: DomainAnalysisResult[]
  needs_confirmation?: boolean
  identifier_map_proposal?: unknown
}

export interface PreflightRequest {
  artifact: Record<string, unknown>
  identifier_map?: { entries: { from: string; to: string; scope?: string | null }[] } | null
  domains?: string[] | null
}

// --- API functions ---

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new ConfigPreflightApiError(res.status, message, (data as { code?: string }).code)
  }
  return data as T
}

/** POST /v1/admin/tenants/{tenantId}/config/reprovision/preflight */
export async function runPreflightCheck(
  tenantId: string,
  req: PreflightRequest
): Promise<PreflightReport> {
  return request<PreflightReport>(
    `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/reprovision/preflight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }
  )
}
