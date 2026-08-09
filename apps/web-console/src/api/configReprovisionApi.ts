/**
 * API client for tenant functional configuration reprovision endpoints.
 */

import { publicApiFetch } from '@/lib/http'

const API_BASE = (typeof process !== 'undefined' && process.env?.CONFIG_REPROVISION_API_URL) || '/api'

export class ConfigReprovisionApiError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'ConfigReprovisionApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

// --- Types ---

export interface IdentifierMapEntry {
  from: string
  to: string
  scope?: string | null
}

export interface IdentifierMap {
  source_tenant_id?: string | null
  target_tenant_id?: string | null
  entries: IdentifierMapEntry[]
}

export interface ReprovisionRequest {
  artifact: Record<string, unknown>
  identifier_map?: IdentifierMap | null
  domains?: string[]
  dry_run?: boolean
}

export interface ResourceResult {
  resource_type: string
  resource_name: string
  resource_id: string | null
  action: 'created' | 'skipped' | 'conflict' | 'error' | 'applied_with_warnings' | 'would_create' | 'would_skip' | 'would_conflict'
  message: string | null
  warnings: string[]
  diff: Record<string, unknown> | null
}

export interface DomainCounts {
  created: number
  skipped: number
  conflicts: number
  errors: number
  warnings: number
}

export interface DomainResult {
  domain_key: string
  status: string
  resource_results: ResourceResult[]
  counts: DomainCounts
  message: string | null
}

export interface ReprovisionSummary {
  domains_requested: number
  domains_processed: number
  domains_skipped: number
  resources_created: number
  resources_skipped: number
  resources_conflicted: number
  resources_failed: number
}

export interface ReprovisionResult {
  tenant_id: string
  source_tenant_id: string
  correlation_id: string
  dry_run: boolean
  result_status: 'success' | 'partial' | 'failed' | 'dry_run'
  format_version: string
  summary: ReprovisionSummary
  domain_results: DomainResult[]
  started_at: string
  ended_at: string
  needs_confirmation?: boolean
  proposal?: IdentifierMap
  message?: string
}

export interface IdentifierMapResponse {
  source_tenant_id: string
  target_tenant_id: string
  proposal: IdentifierMap
  warnings: string[]
  correlation_id: string
}

// --- API functions ---

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await publicApiFetch(url, options)
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok && res.status !== 207) {
    const message = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new ConfigReprovisionApiError(res.status, message, (data as { code?: string }).code)
  }
  return data as T
}

/** POST /v1/admin/tenants/{tenantId}/config/reprovision */
export async function reprovisionTenantConfig(
  tenantId: string,
  req: ReprovisionRequest
): Promise<ReprovisionResult> {
  return request<ReprovisionResult>(
    `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/reprovision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }
  )
}

/** POST /v1/admin/tenants/{tenantId}/config/reprovision/identifier-map */
export async function generateIdentifierMap(
  tenantId: string,
  artifact: Record<string, unknown>
): Promise<IdentifierMapResponse> {
  return request<IdentifierMapResponse>(
    `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/reprovision/identifier-map`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact }),
    }
  )
}
