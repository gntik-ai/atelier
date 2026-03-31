export type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived'

export interface PlanRecord {
  id: string
  slug: string
  displayName: string
  description?: string | null
  status: PlanStatus
  capabilities: Record<string, boolean>
  quotaDimensions: Record<string, number>
  assignedTenantCount?: number
  updatedAt?: string
}

export interface PaginationEnvelope<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface AssignmentRecord {
  assignmentId: string
  tenantId: string
  planId: string
  effectiveFrom: string
  supersededAt?: string | null
  assignedBy?: string
  assignmentMetadata?: Record<string, unknown>
}

export interface LimitProfileRow {
  dimensionKey: string
  displayLabel: string
  unit?: string | null
  defaultValue: number
  effectiveValue: number
  explicitValue?: number | null
  source: 'default' | 'explicit' | 'unlimited'
}

export class PlanApiError extends Error {
  code: string
  detail?: unknown
  status?: number

  constructor(input: { message: string; code?: string; detail?: unknown; status?: number }) {
    super(input.message)
    this.name = 'PlanApiError'
    this.code = input.code ?? 'UNKNOWN'
    this.detail = input.detail
    this.status = input.status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'X-API-Version': '2026-03-26' },
    ...init
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = payload?.error ?? payload ?? {}
    throw new PlanApiError({
      message: error.message ?? `Request failed with status ${response.status}`,
      code: error.code,
      detail: error.detail,
      status: response.status
    })
  }
  return payload as T
}

function withSearch(url: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  return search.size ? `${url}?${search.toString()}` : url
}

export const isConflictError = (error: unknown, code?: string) => error instanceof PlanApiError && error.status === 409 && (!code || error.code === code)

export function listPlans(params: { status?: PlanStatus | 'all'; page?: number; pageSize?: number } = {}) {
  const { status, page = 1, pageSize = 20 } = params
  return request<PaginationEnvelope<PlanRecord>>(withSearch('/v1/plans', { status: status === 'all' ? undefined : status, page, pageSize }))
}

export function createPlan(body: Record<string, unknown>) { return request<PlanRecord>('/v1/plans', { method: 'POST', body: JSON.stringify(body) }) }
export function getPlan(planIdOrSlug: string) { return request<PlanRecord>(`/v1/plans/${planIdOrSlug}`) }
export function updatePlan(planId: string, body: Record<string, unknown>) { return request<PlanRecord>(`/v1/plans/${planId}`, { method: 'PUT', body: JSON.stringify(body) }) }
export function transitionPlanLifecycle(planId: string, body: Record<string, unknown>) { return request(`/v1/plans/${planId}/lifecycle`, { method: 'POST', body: JSON.stringify(body) }) }
export function getPlanLimitsProfile(planId: string) { return request<{ planId: string; profile: LimitProfileRow[] }>(`/v1/plans/${planId}/limits`) }
export function setPlanLimit(planId: string, dimensionKey: string, value: number) { return request(`/v1/plans/${planId}/limits/${dimensionKey}`, { method: 'PUT', body: JSON.stringify({ value }) }) }
export function removePlanLimit(planId: string, dimensionKey: string) { return request(`/v1/plans/${planId}/limits/${dimensionKey}`, { method: 'DELETE' }) }
export function listQuotaDimensions() { return request<{ dimensions: LimitProfileRow[]; total: number }>('/v1/quota-dimensions') }
export function assignPlan(tenantId: string, body: Record<string, unknown>) { return request<AssignmentRecord>(`/v1/tenants/${tenantId}/plan`, { method: 'POST', body: JSON.stringify(body) }) }
export function getTenantCurrentPlan(tenantId: string) { return request(`/v1/tenants/${tenantId}/plan`) }
export function getTenantPlanHistory(tenantId: string, params: { page?: number; pageSize?: number } = {}) { return request<PaginationEnvelope<AssignmentRecord>>(withSearch(`/v1/tenants/${tenantId}/plan/history`, { page: params.page ?? 1, pageSize: params.pageSize ?? 20 })) }
export function getMyPlan() { return request('/v1/tenant/plan') }
export function getMyPlanLimits() { return request<{ tenantId?: string; noAssignment?: boolean; profile: LimitProfileRow[] }>('/v1/tenant/plan/limits') }
