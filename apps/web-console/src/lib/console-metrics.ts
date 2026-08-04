import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { requestConsoleSessionJson } from '@/lib/console-session'

export type ConsoleMetricRangePreset = '24h' | '7d' | '30d'

export interface ConsoleMetricRange {
  preset: ConsoleMetricRangePreset
}

export interface ConsoleMetricDimensionView {
  dimensionId: string
  displayName: string
  measuredValue: number
  hardLimit: number | null
  pctUsed: number | null
  policyMode: 'enforced' | 'unbounded'
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
  // #766: mirrors `ConsoleQuotaDimensionView.isWarning`/`.isExceeded` in console-quotas.ts (same
  // >=80%/>=100% thresholds) so a metric row can render the same breach-honest, non-color-only
  // cue the Quotas table uses, and can cross-link to the Quotas view when exceeded.
  isWarning: boolean
  isExceeded: boolean
  // Wire `unit` ('count' | 'bytes') — optional because not every deploy runtime populates it;
  // see `lib/format.ts::isByteUnitDimension` for the dimensionId-based fallback.
  unit?: string
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

export interface ConsoleAuditExportManifest {
  exportId: string
  status?: string
  queryScope?: 'tenant' | 'workspace' | string
  tenantId?: string
  workspaceId?: string | null
  format?: 'jsonl' | 'csv' | string
  maskingProfileId?: string
  correlationId?: string
  generatedAt?: string
  appliedFilters?: Record<string, unknown>
  itemCount: number
  maskedItemCount?: number
  items: Array<Record<string, unknown>>
  message?: string
}

export interface ConsoleAuditExportAcknowledgement {
  exportId?: string
  status?: string
  message?: string
  itemCount?: number
  maskedItemCount?: number
  items?: unknown
  artifactUrl?: string
  downloadUrl?: string
  jobId?: string
}

export type ConsoleAuditExportResult = ConsoleAuditExportManifest | ConsoleAuditExportAcknowledgement | null

interface OverviewResponse {
  generatedAt?: string
  overallPosture?: string
  hardLimitDimensions?: string[]
  dimensions?: Array<{
    dimensionId?: string
    displayName?: string
    currentUsage?: number
    measuredValue?: number
    hardLimit?: number | null
    posture?: string
    policyMode?: 'enforced' | 'unbounded'
    freshnessStatus?: 'fresh' | 'degraded' | 'unavailable'
    unit?: string
  }>
}

interface UsageSnapshotResponse {
  snapshotTimestamp?: string
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
  tenantId: string
  workspaceId: string
  metricKey: 'api_requests' | 'api_errors'
  window: '5m' | '1h' | '24h' | '7d' | '30d'
  unit?: string
  points: Array<{ timestamp: string; value: number }>
}

interface AuditRecordCollectionResponse {
  items?: Array<Record<string, any>>
  page?: {
    size?: number
    hasMore?: boolean
    nextCursor?: string
  }
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

function mapRangeToWindow(range: ConsoleMetricRange): ConsoleMetricRangePreset | null {
  if (range.preset === '24h' || range.preset === '7d' || range.preset === '30d') {
    return range.preset
  }

  return null
}

function appendDateFilters(searchParams: URLSearchParams, from?: string, to?: string) {
  const completeDate = (value: string, endOfDay: boolean) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value
  if (from) searchParams.set('filter[occurredAfter]', completeDate(from, false))
  if (to) searchParams.set('filter[occurredBefore]', completeDate(to, true))
}

function auditRecordSearchParams(filters: ConsoleAuditFilter, cursor?: string) {
  const searchParams = new URLSearchParams({ 'page[size]': '50', sort: '-eventTimestamp' })
  if (filters.actorId) searchParams.set('filter[actorId]', filters.actorId)
  if (filters.category) searchParams.set('filter[actionCategory]', filters.category)
  if (filters.result) {
    searchParams.set('filter[outcome]', filters.result === 'success' ? 'succeeded' : 'failed')
  }
  appendDateFilters(searchParams, filters.from, filters.to)
  if (cursor) searchParams.set('page[after]', cursor)
  return searchParams
}

function auditPageState(response: AuditRecordCollectionResponse) {
  const nextCursor = typeof response.page?.nextCursor === 'string' && response.page.nextCursor.length > 0
    ? response.page.nextCursor
    : null
  const hasMore = response.page?.hasMore === true && nextCursor !== null
  return { hasMore, nextCursor: hasMore ? nextCursor : null }
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
      typeof dimension.currentUsage === 'number'
        ? dimension.currentUsage
        : typeof dimension.measuredValue === 'number'
          ? dimension.measuredValue
        : typeof usageDimension?.measuredValue === 'number'
          ? usageDimension.measuredValue
          : typeof usageDimension?.value === 'number'
            ? usageDimension.value
            : 0
    const hardLimit = typeof dimension.hardLimit === 'number' ? dimension.hardLimit : null
    const pctUsed = hardLimit && hardLimit > 0 ? Math.round((measuredValue / hardLimit) * 100) : null
    // Same thresholds as `normalizeQuotaPosture` in console-quotas.ts: >=100% is a breach
    // regardless of how far over (245% and 100% are both "exceeded"), 80-99% is a warning.
    const isExceeded = (pctUsed ?? 0) >= 100
    const isWarning = !isExceeded && (pctUsed ?? 0) >= 80

    return {
      dimensionId: key,
      displayName: dimension.displayName ?? key,
      measuredValue,
      hardLimit,
      pctUsed,
      policyMode: dimension.policyMode ?? 'enforced',
      freshnessStatus: dimension.freshnessStatus ?? 'fresh',
      isWarning,
      isExceeded,
      unit: dimension.unit
    }
  })

  const seriesPoints = series != null
    ? series.points.map((point) => ({ timestamp: point.timestamp ?? '', value: point.value ?? 0 }))
    : (usage?.dimensions ?? []).flatMap((dimension) =>
        (dimension.points ?? []).map((point) => ({ timestamp: point.timestamp ?? '', value: point.value ?? 0 }))
      )

  return {
    generatedAt: overview?.generatedAt ?? usage?.snapshotTimestamp ?? usage?.measuredAt ?? '',
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
  const seriesWindow = workspaceId ? mapRangeToWindow(range) : null
  const rangeKey = workspaceId ? seriesWindow ?? 'unsupported-range' : 'tenant-scope'

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
          seriesWindow
            ? requestConsoleSessionJson<MetricSeriesResponse>(`${base}/series?metricKey=api_requests&window=${seriesWindow}`)
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
  }, [tenantId, workspaceId, rangeKey, seriesWindow, reloadToken])

  return { overview, loading, error, reload }
}

export function useConsoleAuditRecords(tenantId: string | null, workspaceId: string | null, filters: ConsoleAuditFilter) {
  const [records, setRecords] = useState<ConsoleAuditRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [continuationStatus, setContinuationStatus] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const generationRef = useRef(0)
  const recordsRef = useRef<ConsoleAuditRecord[]>([])
  const continuationInFlightRef = useRef<{ generation: number; cursor: string } | null>(null)

  const reload = useCallback(() => {
    generationRef.current += 1
    continuationInFlightRef.current = null
    setReloadToken((current) => current + 1)
  }, [])
  const filterKey = useMemo(() => JSON.stringify(filters), [filters])
  const queryFilters = useMemo(() => JSON.parse(filterKey) as ConsoleAuditFilter, [filterKey])

  useEffect(() => {
    let cancelled = false
    const generation = generationRef.current + 1
    generationRef.current = generation
    continuationInFlightRef.current = null
    recordsRef.current = []
    setRecords([])
    setHasMore(false)
    setNextCursor(null)
    setLoadingMore(false)
    setLoadMoreError(null)
    setContinuationStatus(null)

    async function load() {
      if (!tenantId) {
        setError(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const searchParams = auditRecordSearchParams(queryFilters)
        const base = workspaceId ? `/v1/metrics/workspaces/${workspaceId}` : `/v1/metrics/tenants/${tenantId}`
        const response = await requestConsoleSessionJson<AuditRecordCollectionResponse>(`${base}/audit-records?${searchParams.toString()}`)
        if (cancelled || generationRef.current !== generation) return
        const normalizedRecords = (response.items ?? []).map(normalizeAuditRecord)
        const page = auditPageState(response)
        recordsRef.current = normalizedRecords
        setRecords(normalizedRecords)
        setHasMore(page.hasMore)
        setNextCursor(page.nextCursor)
      } catch (loadError) {
        if (cancelled || generationRef.current !== generation) return
        setError(toErrorMessage(loadError))
        recordsRef.current = []
        setRecords([])
      } finally {
        if (!cancelled && generationRef.current === generation) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tenantId, workspaceId, filterKey, queryFilters, reloadToken])

  const loadMore = useCallback(async () => {
    const cursor = nextCursor
    const generation = generationRef.current
    if (!tenantId || !hasMore || !cursor || continuationInFlightRef.current) return

    continuationInFlightRef.current = { generation, cursor }
    setLoadingMore(true)
    setLoadMoreError(null)
    setContinuationStatus(null)
    try {
      const searchParams = auditRecordSearchParams(queryFilters, cursor)
      const base = workspaceId ? `/v1/metrics/workspaces/${workspaceId}` : `/v1/metrics/tenants/${tenantId}`
      const response = await requestConsoleSessionJson<AuditRecordCollectionResponse>(`${base}/audit-records?${searchParams.toString()}`)
      const activeRequest = continuationInFlightRef.current
      if (generationRef.current !== generation || activeRequest?.generation !== generation || activeRequest.cursor !== cursor) return

      const seen = new Set(recordsRef.current.map(({ eventId }) => eventId))
      const appended = (response.items ?? [])
        .map(normalizeAuditRecord)
        .filter(({ eventId }) => !seen.has(eventId) && seen.add(eventId))
      const combined = [...recordsRef.current, ...appended]
      const page = auditPageState(response)
      recordsRef.current = combined
      setRecords(combined)
      setHasMore(page.hasMore)
      setNextCursor(page.nextCursor)
      setContinuationStatus(`${appended.length} ${appended.length === 1 ? 'evento añadido' : 'eventos añadidos'}; ${combined.length} en total.`)
    } catch (continuationError) {
      const activeRequest = continuationInFlightRef.current
      if (generationRef.current !== generation || activeRequest?.generation !== generation || activeRequest.cursor !== cursor) return
      setLoadMoreError(toErrorMessage(continuationError))
    } finally {
      const activeRequest = continuationInFlightRef.current
      if (activeRequest?.generation === generation && activeRequest.cursor === cursor) {
        continuationInFlightRef.current = null
        if (generationRef.current === generation) setLoadingMore(false)
      }
    }
  }, [hasMore, nextCursor, queryFilters, tenantId, workspaceId])

  return {
    records,
    loading,
    error,
    hasMore,
    nextCursor,
    loadingMore,
    loadMoreError,
    continuationStatus,
    loadMore,
    reload
  }
}

export async function exportAuditRecords(tenantId: string, workspaceId: string | null, filters: ConsoleAuditFilter): Promise<ConsoleAuditExportResult> {
  const base = workspaceId ? `/v1/metrics/workspaces/${workspaceId}` : `/v1/metrics/tenants/${tenantId}`
  const body: any = {
    format: 'jsonl',
    pageSize: 500,
    maskingProfileId: 'default_masked',
    filters: {
      actorId: filters.actorId,
      actionCategory: filters.category,
      outcome: filters.result === 'success' ? 'succeeded' : filters.result === 'failure' ? 'failed' : undefined,
      occurredAfter: filters.from,
      occurredBefore: filters.to
    }
  }

  return requestConsoleSessionJson<ConsoleAuditExportResult>(`${base}/audit-exports`, {
    method: 'POST',
    body
  })
}
