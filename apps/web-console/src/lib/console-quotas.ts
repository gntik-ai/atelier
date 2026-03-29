import { useCallback, useEffect, useState } from 'react'

import { requestConsoleSessionJson } from '@/lib/console-session'

export interface ConsoleQuotaDimensionView {
  dimensionId: string
  displayName: string
  policyMode: 'enforced' | 'unbounded'
  hardLimit: number | null
  softLimit: number | null
  measuredValue: number
  remainingToHardLimit: number | null
  pctUsed: number | null
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
  isWarning: boolean
  isExceeded: boolean
}

export interface ConsoleQuotaPosture {
  evaluatedAt: string | null
  generatedAt: string | null
  overallPosture: string | null
  hardLimitDimensions: string[]
  dimensions: ConsoleQuotaDimensionView[]
}

interface QuotaPostureResponse {
  evaluatedAt?: string
  dimensions?: Array<{
    dimensionId?: string
    displayName?: string
    policyMode?: 'enforced' | 'unbounded'
    hardLimit?: number | null
    softLimit?: number | null
    measuredValue?: number
    remainingToHardLimit?: number | null
    freshnessStatus?: 'fresh' | 'degraded' | 'unavailable'
  }>
  hardLimitBreaches?: string[]
}

interface QuotaOverviewResponse {
  generatedAt?: string
  overallPosture?: string
  hardLimitDimensions?: string[]
}

export function normalizeQuotaPosture(posture: QuotaPostureResponse | null | undefined, overview: QuotaOverviewResponse | null | undefined): ConsoleQuotaPosture {
  const hardLimitDimensions = [...new Set([...(posture?.hardLimitBreaches ?? []), ...(overview?.hardLimitDimensions ?? [])])]
  return {
    evaluatedAt: posture?.evaluatedAt ?? null,
    generatedAt: overview?.generatedAt ?? null,
    overallPosture: overview?.overallPosture ?? null,
    hardLimitDimensions,
    dimensions: (posture?.dimensions ?? []).map((dimension) => {
      const hardLimit = typeof dimension.hardLimit === 'number' ? dimension.hardLimit : null
      const measuredValue = dimension.measuredValue ?? 0
      const pctUsed = hardLimit && hardLimit > 0 ? Math.round((measuredValue / hardLimit) * 100) : null
      const isExceeded = (pctUsed ?? 0) >= 100 || hardLimitDimensions.includes(dimension.dimensionId ?? '')
      const isWarning = !isExceeded && (pctUsed ?? 0) >= 80
      return {
        dimensionId: dimension.dimensionId ?? '',
        displayName: dimension.displayName ?? dimension.dimensionId ?? '',
        policyMode: dimension.policyMode ?? 'enforced',
        hardLimit,
        softLimit: typeof dimension.softLimit === 'number' ? dimension.softLimit : null,
        measuredValue,
        remainingToHardLimit: typeof dimension.remainingToHardLimit === 'number' ? dimension.remainingToHardLimit : null,
        pctUsed,
        freshnessStatus: dimension.freshnessStatus ?? 'fresh',
        isWarning,
        isExceeded
      }
    })
  }
}

function toErrorMessage(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
  if (status === 403) return 'Acceso denegado para consultar cuotas.'
  if (error instanceof Error && error.message) return error.message
  return 'No se pudo cargar la postura de cuotas.'
}

export function useConsoleQuotas(tenantId: string | null, workspaceId: string | null) {
  const [tenantPosture, setTenantPosture] = useState<ConsoleQuotaPosture | null>(null)
  const [workspacePosture, setWorkspacePosture] = useState<ConsoleQuotaPosture | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!tenantId) {
        setTenantPosture(null)
        setWorkspacePosture(null)
        setLoading(false)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const [tenantPostureResponse, tenantOverviewResponse] = await Promise.all([
          requestConsoleSessionJson<QuotaPostureResponse>(`/v1/metrics/tenants/${tenantId}/quotas`),
          requestConsoleSessionJson<QuotaOverviewResponse>(`/v1/metrics/tenants/${tenantId}/overview`)
        ])

        const workspaceResponses = workspaceId
          ? await Promise.all([
              requestConsoleSessionJson<QuotaPostureResponse>(`/v1/metrics/workspaces/${workspaceId}/quotas`),
              requestConsoleSessionJson<QuotaOverviewResponse>(`/v1/metrics/workspaces/${workspaceId}/overview`)
            ])
          : null

        if (cancelled) return
        setTenantPosture(normalizeQuotaPosture(tenantPostureResponse, tenantOverviewResponse))
        setWorkspacePosture(workspaceResponses ? normalizeQuotaPosture(workspaceResponses[0], workspaceResponses[1]) : null)
      } catch (error) {
        if (cancelled) return
        setError(toErrorMessage(error))
        setTenantPosture(null)
        setWorkspacePosture(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tenantId, workspaceId, reloadToken])

  return { posture: tenantPosture, workspacePosture, loading, error, reload }
}
