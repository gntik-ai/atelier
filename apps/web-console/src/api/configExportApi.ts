/**
 * API client for tenant functional configuration export endpoints.
 */

import { publicApiFetch } from '@/lib/http'

const API_BASE = (typeof process !== 'undefined' && process.env?.CONFIG_EXPORT_API_URL) || '/api'

export class ConfigExportApiError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'ConfigExportApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

// --- Types ---

export interface ExportRequest {
  domains?: string[]
}

export interface DomainResult {
  domain_key: string
  status: 'ok' | 'empty' | 'error' | 'not_available' | 'not_requested'
  exported_at: string
  items_count?: number
  data?: Record<string, unknown> | null
  error?: string
  reason?: string
}

export interface ExportArtifact {
  export_timestamp: string
  tenant_id: string
  format_version: string
  deployment_profile: string
  correlation_id: string
  domains: DomainResult[]
}

export interface DomainAvailability {
  domain_key: string
  availability: 'available' | 'not_available' | 'degraded'
  description: string
  reason?: string
}

export interface ExportDomainsResponse {
  tenant_id: string
  deployment_profile: string
  queried_at: string
  domains: DomainAvailability[]
}

// --- API functions ---

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await publicApiFetch(url, options)
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) {
    const message = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new ConfigExportApiError(res.status, message, (data as { code?: string }).code)
  }
  return data as T
}

export async function getExportableDomains(tenantId: string): Promise<ExportDomainsResponse> {
  return request<ExportDomainsResponse>(
    `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/export/domains`
  )
}

export async function exportTenantConfig(
  tenantId: string,
  req: ExportRequest = {}
): Promise<{ artifact: ExportArtifact; status: 200 | 207 }> {
  const url = `${API_BASE}/v1/admin/tenants/${encodeURIComponent(tenantId)}/config/export`
  const res = await publicApiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  const data = await res.json().catch(() => ({} as Record<string, unknown>))

  if (res.status === 200 || res.status === 207) {
    return { artifact: data as ExportArtifact, status: res.status as 200 | 207 }
  }

  const message = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `HTTP ${res.status}`
  throw new ConfigExportApiError(res.status, message, (data as { code?: string }).code)
}
