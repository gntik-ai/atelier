import { requestJson } from '@/lib/http'

export type DestructiveOpLevel = 'CRITICAL' | 'WARNING'

export interface CascadeImpactSummary {
  resourceType: string
  count: number
}

export interface DestructiveOpConfig {
  level: DestructiveOpLevel
  operationId: string
  resourceName: string
  resourceType: string
  resourceId?: string
  impactDescription?: string
  cascadeImpact?: CascadeImpactSummary[]
  cascadeImpactError?: boolean
  onConfirm: () => Promise<void>
  onSuccess?: () => void
}

export type DestructiveOpState =
  | 'idle'
  | 'loading-impact'
  | 'ready'
  | 'confirming'
  | 'error'

export type CascadeImpactResourceType = 'tenant' | 'workspace' | 'database' | 'api-keys'

export const DESTRUCTIVE_OP_LEVELS: Record<string, DestructiveOpLevel> = {
  'soft-delete-application': 'WARNING',
  'detach-provider': 'WARNING',
  'revoke-service-account-credential': 'WARNING'
}

type CascadeImpactResponse = {
  dependents?: Array<{
    resourceType?: string
    count?: number
  }>
}

export async function fetchCascadeImpact(
  resourceType: CascadeImpactResourceType,
  resourceId: string,
  signal?: AbortSignal,
): Promise<CascadeImpactSummary[]> {
  const response = await requestJson<CascadeImpactResponse>(`/admin/v1/${resourceType}/${resourceId}/cascade-impact`, {
    signal
  })

  return (response.dependents ?? []).map((dependent) => ({
    resourceType: typeof dependent.resourceType === 'string' ? dependent.resourceType : 'unknown',
    count: typeof dependent.count === 'number' ? dependent.count : 0
  }))
}
