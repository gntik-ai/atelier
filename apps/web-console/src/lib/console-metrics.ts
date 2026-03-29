import { useCallback, useEffect, useMemo, useState } from 'react'

import { requestConsoleSessionJson } from '@/lib/console-session'

export type ConsoleMetricRangePreset = '24h' | '7d' | '30d' | 'custom'

export interface ConsoleMetricRange {
  preset: ConsoleMetricRangePreset
  from?: string
  to?: string
}

export interface ConsoleMetricDimensionView {
  dimensionId: string
  displayName: string
  measuredValue: number
  hardLimit: number | null
  pctUsed: number | null
  policyMode: 'enforced' | 'unbounded'
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
}

export interface ConsoleMetricsOverview {
  generatedAt: string
  overallPosture: string | null
  dimensions: ConsoleMetricDimensionView[]
  hasQuotaWarning: boolean
  seriesPoints: Array<{ timestamp: string; value: number }>
}

export interface ConsoleAuditFilter {
  actorId?: string
  category?: string
  result?: 'success' | 'failure'
  from?: string
  to?: string
}

export interface ConsoleAuditRecord {
  eventId: string
  eventTimestamp: string
  correlationId: string | null
  actor: { actorId: string; actorType: string; displayName?: string }
  action: { actionId: string; category: string; subsystem?: string }
  resource: { resourceId: string; resourceType: string; workspaceId?: string } | null
  result: { outcome: string; failureCode?: string } | null
  origin: { ipAddress?: string; userAgent?: string; originSurface?: string } | null
  scope?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

interface OverviewResponse {
  generatedAt?: string
  overallPosture?: string
  hardLimitDimensions?: string[]
  dimensions?: Array<{
    dimensionId?: string
    displayName?: string
    measuredValue?: number
    hardLimit?: number | null
    policyMode?: 'enforced' | 'unbounded'
    freshnessStatus?: 'fresh' | 'degraded' | 'unavailable'
  }>
}

interface UsageSnapshotResponse {
  measuredAt?: string
  dimensions?: Array<{
    metricKey?: string
    dimensionId?: string
    value?: number
    measuredValue?: number
    points?: Array<{ timestamp?: string; value?: number }>
  }>
}

interface MetricSeriesResponse {
  points?: Array<{ timestamp?: string; value?: number }>
}

interface AuditRecordCollectionResponse {
  items?: Array<Record<string, any>>
}

function toErrorMessage(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
  if (status === 403) {
    return 'Acceso denegado para este contexto.'
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'No se pudo cargar la información solicitada.'
}

function mapRangeToWindow(range: ConsoleMetricRange): string {
  switch (range.preset) {
    case '24h':
      return '24h'
    case '7d':
      return '7d'
    case '30d':
      return '30d'
    default:
      return '24h'
  }
}

function appendDateFilters(searchParams: URLSearchParams, from?: string, to?: string) {
  if (from) searchParams.set('filter[occurredAfter]', from)
  if (to) searchParams.set('filter[occurredBefore]', to)
}

export function normalizeMetricsOverview(
  overview: OverviewResponse | null | undefined,
  usage: UsageSnapshotResponse | null | undefined,
  series?: MetricSeriesResponse | null
): ConsoleMetricsOverview {
  const usageLookup = new Map(
    (usage?.dimensions ?? []).map((dimension) => [dimension.dimensionId ?? dimension.metricKey ?? '', dimension])
  )

  const dimensions = (overview?.dimensions ?? []).map((dimension) => {
    const key = dimension.dimensionId ?? ''
    const usageDimension = usageLookup.get(key)
    const measuredValue =
      typeof dimension.measuredValue === 'number'
        ? dimension.measuredValue
        : typeof usageDimension?.measuredValue === 'number'
          ? usageDimension.measuredValue
          : typeof usageDimension?.value === 'number'
            ? usageDimension.value
            : 0
    const hardLimit = typeof dimension.hardLimit === 'number' ? dimension.hardLimit : null
    const pctUsed = hardLimit && hardLimit > 0 ? Math.round((measuredValue / hardLimit) * 100) : null

    return {
      dimensionId: key,
      displayName: dimension.displayName ?? key,
      measuredValue,
      hardLimit,
      pctUsed,
      policyMode: dimension.policyMode ?? 'enforced',
      freshnessStatus: dimension.freshnessStatus ?? 'fresh'
    }
  })

  const seriesPoints = series?.points?.length
    ? series.points.map((point) => ({ timestamp: point.timestamp ?? '', value: point.value ?? 0 }))
    : (usage?.dimensions ?? []).flatMap((dimension) =>
        (dimension.points ?? []).map((point) => ({ timestamp: point.timestamp ?? '', value: point.value ?? 0 }))
      )

  return {
    generatedAt: overview?.generatedAt ?? usage?.measuredAt ?? '',
    overallPosture: overview?.overallPosture ?? null,
    dimensions,
    hasQuotaWarning: dimensions.some((dimension) => (dimension.pctUsed ?? 0) >= 80),
    seriesPoints
  }
}

export function normalizeAuditRecord(record: Record<string, any>): ConsoleAuditRecord {
  return {
    eventId: record.eventId ?? '',
    eventTimestamp: record.eventTimestamp ?? '',
    correlationId: record.correlationId ?? null,
    actor: {
      actorId: record.actor?.actorId ?? '',
      actorType: record.actor?.actorType ?? 'unknown',
      displayName: record.actor?.displayName
    },
    action: {
      actionId: record.action?.actionId ?? '',
      category: record.action?.category ?? 'unknown',
      subsystem: record.action?.subsystem
    },
    resource: record.resource
      ? {
          resourceId: record.resource.resourceId ?? '',
          resourceType: record.resource.resourceType ?? 'unknown',
          workspaceId: record.resource.workspaceId
        }
      : null,
    result: record.result
      ? {
          outcome: record.result.outcome ?? 'unknown',
          failureCode: record.result.failureCode
        }
      : null,
    origin: record.origin
      ? {
          ipAddress: record.origin.ipAddress,
          userAgent: record.origin.userAgent,
          originSurface: record.origin.originSurface
        }
      : null,
    scope: record.scope ?? null,
    metadata: record.metadata ?? null
  }
}

export function useConsoleMetrics(tenantId: string | null, workspaceId: string | null, range: ConsoleMetricRange) {
  const [overview, setOverview] = useState<ConsoleMetricsOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((current) => current + 1), [])
  const rangeKey = useMemo(() => JSON.stringify(range), [range])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!tenantId) {
        setOverview(null)
        setError(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const base = workspaceId ? `/v1/metrics/workspaces/${workspaceId}` : `/v1/metrics/tenants/${tenantId}`
        const [overviewResponse, usageResponse, seriesResponse] = await Promise.all([
          requestConsoleSessionJson<OverviewResponse>(`${base}/overview`),
          requestConsoleSessionJson<UsageSnapshotResponse>(`${base}/usage`),
          workspaceId
            ? requestConsoleSessionJson<MetricSeriesResponse>(`${base}/series?metricKey=api_requests&window=${mapRangeToWindow(range)}`)
            : Promise.resolve(null)
        ])

        if (cancelled) return
        setOverview(normalizeMetricsOverview(overviewResponse, usageResponse, seriesResponse))
      } catch (error) {
        if (cancelled) return
        setError(toErrorMessage(error))
        setOverview(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tenantId, workspaceId, rangeKey, reloadToken])

  return { overview, loading, error, reload }
}

export function useConsoleAuditRecords(tenantId: string | null, workspaceId: string | null, filters: ConsoleAuditFilter) {
  const [records, setRecords] = useState<ConsoleAuditRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((current) => current + 1), [])
  const filterKey = useMemo(() => JSON.stringify(filters), [filters])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!tenantId) {
        setRecords([])
        setError(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const searchParams = new URLSearchParams({ 'page[size]': '50', sort: '-eventTimestamp' })
        if (filters.actorId) searchParams.set('filter[actorId]', filters.actorId)
        if (filters.category) searchParams.set('filter[actionCategory]', filters.category)
        if (filters.result) {
          searchParams.set('filter[outcome]', filters.result === 'success' ? 'succeeded' : 'failed')
        }
        appendDateFilters(searchParams, filters.from, filters.to)

        const base = workspaceId ? `/v1/metrics/workspaces/${workspaceId}` : `/v1/metrics/tenants/${tenantId}`
        const response = await requestConsoleSessionJson<AuditRecordCollectionResponse>(`${base}/audit-records?${searchParams.toString()}`)
        if (cancelled) return
        setRecords((response.items ?? []).map(normalizeAuditRecord))
      } catch (error) {
        if (cancelled) return
        setError(toErrorMessage(error))
        setRecords([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tenantId, workspaceId, filterKey, reloadToken])

  return { records, loading, error, reload }
}

export async function exportAuditRecords(tenantId: string, workspaceId: string | null, filters: ConsoleAuditFilter): Promise<void> {
  const base = workspaceId ? `/v1/metrics/workspaces/${workspaceId}` : `/v1/metrics/tenants/${tenantId}`
  const body: any = {
    filters: {
      actorId: filters.actorId,
      actionCategory: filters.category,
      outcome: filters.result === 'success' ? 'succeeded' : filters.result === 'failure' ? 'failed' : undefined,
      occurredAfter: filters.from,
      occurredBefore: filters.to
    }
  }

  await requestConsoleSessionJson(`${base}/audit-exports`, {
    method: 'POST',
    body
  })
}
