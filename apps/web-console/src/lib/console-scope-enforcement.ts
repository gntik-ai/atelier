export interface ScopeEnforcementDenial {
  tenant_id: string
  workspace_id?: string | null
  actor_id: string
  actor_type: string
  denial_type: string
  http_method: string
  request_path: string
  required_scopes?: string[]
  presented_scopes?: string[]
  missing_scopes?: string[]
  required_entitlement?: string | null
  current_plan_id?: string | null
  source_ip?: string | null
  correlation_id: string
  denied_at: string
}

export interface DenialQueryParams {
  tenantId?: string
  workspaceId?: string
  denialType?: string
  actorId?: string
  from: string
  to: string
  limit?: number
  cursor?: string
}

export interface DenialQueryResponse {
  denials: ScopeEnforcementDenial[]
  nextCursor: string | null
  totalInWindow: number
}

export async function fetchDenials(params: DenialQueryParams): Promise<DenialQueryResponse> {
  const search = new URLSearchParams()
  if (params.tenantId) search.set('tenant_id', params.tenantId)
  if (params.workspaceId) search.set('workspace_id', params.workspaceId)
  if (params.denialType) search.set('denial_type', params.denialType)
  if (params.actorId) search.set('actor_id', params.actorId)
  search.set('from', params.from)
  search.set('to', params.to)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.cursor) search.set('cursor', params.cursor)
  const response = await fetch(`/api/security/scope-enforcement/denials?${search.toString()}`)
  const body = await response.json()
  return { denials: body.denials ?? [], nextCursor: body.next_cursor ?? null, totalInWindow: body.total_in_window ?? 0 }
}

export function exportDenialsAsCsv(denials: ScopeEnforcementDenial[]): string {
  const headers = ['tenant_id','workspace_id','actor_id','actor_type','denial_type','http_method','request_path','missing_scopes','required_entitlement','current_plan_id','source_ip','correlation_id','denied_at']
  const rows = denials.map((denial) => headers.map((header) => JSON.stringify(Array.isArray((denial as any)[header]) ? (denial as any)[header].join('|') : ((denial as any)[header] ?? ''))).join(','))
  return [headers.join(','), ...rows].join('\n')
}
