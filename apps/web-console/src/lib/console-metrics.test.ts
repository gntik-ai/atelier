import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportAuditRecords, normalizeAuditRecord, normalizeMetricsOverview, useConsoleAuditRecords, useConsoleMetrics, type ConsoleMetricRange } from './console-metrics'

const mockRequestConsoleSessionJson = vi.fn()
vi.mock('@/lib/console-session', () => ({ requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args) }))

describe('console-metrics', () => {
  beforeEach(() => {
    mockRequestConsoleSessionJson.mockReset()
  })

  it('consume currentUsage y snapshotTimestamp canónicos y deriva pctUsed y warnings', () => {
    const result = normalizeMetricsOverview(
      {
        generatedAt: '2026-08-04T08:00:00.000Z',
        overallPosture: 'warning_threshold_reached',
        dimensions: [{
          dimensionId: 'api',
          displayName: 'API',
          currentUsage: 8,
          measuredValue: 1,
          hardLimit: 10,
          posture: 'warning_threshold_reached'
        }]
      },
      { snapshotTimestamp: '2026-08-04T07:59:00.000Z', dimensions: [] }
    )
    expect(result.generatedAt).toBe('2026-08-04T08:00:00.000Z')
    expect(result.dimensions[0]?.measuredValue).toBe(8)
    expect(result.dimensions[0]?.pctUsed).toBe(80)
    expect(result.hasQuotaWarning).toBe(true)
    expect(normalizeMetricsOverview(null, {
      snapshotTimestamp: '2026-08-04T07:59:00.000Z',
      dimensions: []
    }).generatedAt).toBe('2026-08-04T07:59:00.000Z')
  })

  it('consume MetricSeriesResponse poblada y degradada sin depender de source', () => {
    const usageWithUnrelatedPoints = {
      measuredAt: '2026-07-28T00:00:00.000Z',
      dimensions: [{
        dimensionId: 'storage_bytes',
        points: [{ timestamp: '2026-07-27T00:00:00.000Z', value: 99 }]
      }]
    }
    const populated = normalizeMetricsOverview(null, null, {
      tenantId: 'ten_1',
      workspaceId: 'wrk_1',
      metricKey: 'api_requests',
      window: '24h',
      unit: 'requests_per_second',
      points: [{ timestamp: '2026-07-28T00:00:00.000Z', value: 3 }]
    })
    const degraded = normalizeMetricsOverview(null, usageWithUnrelatedPoints, {
      tenantId: 'ten_1',
      workspaceId: 'wrk_1',
      metricKey: 'api_requests',
      window: '24h',
      unit: 'requests_per_second',
      points: []
    })
    const seriesNotRequested = normalizeMetricsOverview(null, usageWithUnrelatedPoints)

    expect(populated.seriesPoints).toEqual([{ timestamp: '2026-07-28T00:00:00.000Z', value: 3 }])
    expect(degraded.seriesPoints).toEqual([])
    expect(seriesNotRequested.seriesPoints).toEqual([
      { timestamp: '2026-07-27T00:00:00.000Z', value: 99 }
    ])
  })

  it('normaliza audit record', () => {
    const record = normalizeAuditRecord({ eventId: 'evt_1', actor: { actorId: 'usr_1', actorType: 'tenant_user' }, action: { actionId: 'create', category: 'resource_creation' } })
    expect(record.eventId).toBe('evt_1')
    expect(record.action.category).toBe('resource_creation')
  })

  it('carga métricas workspace con las ventanas soportadas seleccionadas', async () => {
    mockRequestConsoleSessionJson.mockImplementation((url: string) => {
      if (url.includes('/overview')) {
        return Promise.resolve({ generatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10 }] })
      }
      if (url.includes('/series')) {
        return Promise.resolve({ points: [{ timestamp: 'now', value: 5 }] })
      }
      return Promise.resolve({ measuredAt: 'now', dimensions: [] })
    })
    const { result, rerender } = renderHook(({ range }) => useConsoleMetrics('ten_1', 'wrk_1', range), {
      initialProps: { range: { preset: '24h' } as ConsoleMetricRange }
    })
    await waitFor(() => expect(result.current.overview?.dimensions[0]?.displayName).toBe('API'))
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/metrics/workspaces/wrk_1/series?metricKey=api_requests&window=24h')

    mockRequestConsoleSessionJson.mockClear()
    rerender({ range: { preset: '7d' } })
    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/metrics/workspaces/wrk_1/series?metricKey=api_requests&window=7d')
    })

    mockRequestConsoleSessionJson.mockClear()
    rerender({ range: { preset: '30d' } })
    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/metrics/workspaces/wrk_1/series?metricKey=api_requests&window=30d')
    })
  })

  it('no usa campos custom obsoletos como reload key ni como window de series', async () => {
    mockRequestConsoleSessionJson.mockImplementation((url: string) => {
      if (url.includes('/overview')) {
        return Promise.resolve({ generatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10 }] })
      }
      if (url.includes('/series')) {
        return Promise.resolve({ points: [{ timestamp: 'now', value: 5 }] })
      }
      return Promise.resolve({ measuredAt: 'now', dimensions: [] })
    })

    const staleCustomRange = {
      preset: 'custom',
      from: '2026-01-01T00:00',
      to: '2026-01-02T00:00'
    } as unknown as ConsoleMetricRange
    const { result, rerender } = renderHook(({ range }) => useConsoleMetrics('ten_1', 'wrk_1', range), {
      initialProps: { range: staleCustomRange }
    })

    await waitFor(() => expect(result.current.overview?.dimensions[0]?.displayName).toBe('API'))
    const initialUrls = mockRequestConsoleSessionJson.mock.calls.map(([url]) => String(url))
    expect(initialUrls).toEqual(['/v1/metrics/workspaces/wrk_1/overview', '/v1/metrics/workspaces/wrk_1/usage'])
    expect(initialUrls.some((url) => url.includes('/series') || url.includes('window=24h') || url.includes('window=custom'))).toBe(false)

    mockRequestConsoleSessionJson.mockClear()
    rerender({
      range: {
        preset: 'custom',
        from: '2026-01-03T00:00',
        to: '2026-01-04T00:00'
      } as unknown as ConsoleMetricRange
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()
  })

  it('ignora cambios de rango en métricas tenant sin pedir series ni window', async () => {
    mockRequestConsoleSessionJson.mockImplementation((url: string) => {
      if (url.includes('/overview')) {
        return Promise.resolve({ generatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10 }] })
      }
      return Promise.resolve({ measuredAt: 'now', dimensions: [] })
    })

    const { result, rerender } = renderHook(({ range }) => useConsoleMetrics('ten_1', null, range), {
      initialProps: { range: { preset: '24h' } as ConsoleMetricRange }
    })

    await waitFor(() => expect(result.current.overview?.dimensions[0]?.displayName).toBe('API'))
    const initialUrls = mockRequestConsoleSessionJson.mock.calls.map(([url]) => String(url))
    expect(initialUrls).toEqual(['/v1/metrics/tenants/ten_1/overview', '/v1/metrics/tenants/ten_1/usage'])
    expect(initialUrls.some((url) => url.includes('/series') || url.includes('window='))).toBe(false)

    mockRequestConsoleSessionJson.mockClear()
    rerender({ range: { preset: '7d' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()
  })

  it('carga auditoría con los cinco filtros existentes y conserva metadatos de página', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({
      items: [{ eventId: 'evt_1', actor: { actorId: 'usr_1', actorType: 'tenant_user' }, action: { actionId: 'create', category: 'resource_creation' } }],
      page: { size: 1, hasMore: true, nextCursor: 'cursor-01' }
    })
    const { result } = renderHook(() => useConsoleAuditRecords('ten_1', null, {
      actorId: 'usr_1',
      category: 'resource_creation',
      result: 'success',
      from: '2026-08-01',
      to: '2026-08-04'
    }))
    await waitFor(() => expect(result.current.records).toHaveLength(1))
    const url = String(mockRequestConsoleSessionJson.mock.calls[0][0])
    expect(url).toContain('filter%5BactorId%5D=usr_1')
    expect(url).toContain('filter%5BactionCategory%5D=resource_creation')
    expect(url).toContain('filter%5Boutcome%5D=succeeded')
    expect(url).toContain('filter%5BoccurredAfter%5D=2026-08-01T00%3A00%3A00.000Z')
    expect(url).toContain('filter%5BoccurredBefore%5D=2026-08-04T23%3A59%3A59.999Z')
    expect(result.current.hasMore).toBe(true)
    expect(result.current.nextCursor).toBe('cursor-01')
  })

  it('añade una continuación una sola vez, suprime clics duplicados y deduplica eventId', async () => {
    let resolveContinuation: (value: unknown) => void = () => {}
    const continuation = new Promise((resolve) => { resolveContinuation = resolve })
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({
        items: [{ eventId: 'evt_1', actor: {}, action: {} }],
        page: { size: 1, hasMore: true, nextCursor: 'cursor-01' }
      })
      .mockReturnValueOnce(continuation)

    const { result } = renderHook(() => useConsoleAuditRecords('ten_1', 'wrk_1', {}))
    await waitFor(() => expect(result.current.nextCursor).toBe('cursor-01'))

    let pending: Promise<void> | undefined
    act(() => {
      pending = result.current.loadMore()
      void result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(2)
    expect(String(mockRequestConsoleSessionJson.mock.calls[1][0])).toContain('page%5Bafter%5D=cursor-01')

    await act(async () => {
      resolveContinuation({
        items: [
          { eventId: 'evt_1', actor: {}, action: {} },
          { eventId: 'evt_2', actor: {}, action: {} }
        ],
        page: { size: 2, hasMore: false }
      })
      await pending
    })
    expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt_1', 'evt_2'])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.nextCursor).toBeNull()
    expect(result.current.continuationStatus).toMatch(/1 evento añadido/)
  })

  it('conserva registros y cursor tras un fallo de continuación y permite reintentar', async () => {
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({
        items: [{ eventId: 'evt_1', actor: {}, action: {} }],
        page: { size: 1, hasMore: true, nextCursor: 'cursor-retry' }
      })
      .mockRejectedValueOnce(new Error('continuation unavailable'))
      .mockResolvedValueOnce({
        items: [{ eventId: 'evt_2', actor: {}, action: {} }],
        page: { size: 1, hasMore: false }
      })
    const { result } = renderHook(() => useConsoleAuditRecords('ten_1', null, {}))
    await waitFor(() => expect(result.current.nextCursor).toBe('cursor-retry'))

    await act(async () => { await result.current.loadMore() })
    expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt_1'])
    expect(result.current.nextCursor).toBe('cursor-retry')
    expect(result.current.loadMoreError).toContain('continuation unavailable')

    await act(async () => { await result.current.loadMore() })
    expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt_1', 'evt_2'])
    expect(result.current.loadMoreError).toBeNull()
  })

  it('descarta una primera página tardía cuando cambia el filtro', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    const oldRequest = new Promise((resolve) => { resolveOld = resolve })
    mockRequestConsoleSessionJson.mockImplementation((url: string) => {
      if (url.includes('actor-old')) return oldRequest
      return Promise.resolve({ items: [{ eventId: 'evt-new', actor: {}, action: {} }], page: { size: 1, hasMore: false } })
    })

    const { result, rerender } = renderHook(
      ({ actorId }) => useConsoleAuditRecords('ten_1', null, { actorId }),
      { initialProps: { actorId: 'actor-old' } }
    )
    rerender({ actorId: 'actor-new' })
    await waitFor(() => expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt-new']))

    await act(async () => {
      resolveOld({ items: [{ eventId: 'evt-old', actor: {}, action: {} }], page: { size: 1, hasMore: false } })
      await oldRequest
    })
    expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt-new'])
  })

  it('descarta una continuación tardía cuando cambia el scope', async () => {
    let resolveContinuation: (value: unknown) => void = () => {}
    const continuation = new Promise((resolve) => { resolveContinuation = resolve })
    mockRequestConsoleSessionJson.mockImplementation((url: string) => {
      if (url.includes('page%5Bafter%5D=cursor-old')) return continuation
      if (url.includes('/workspaces/wrk-new/')) {
        return Promise.resolve({
          items: [{ eventId: 'evt-new-scope', actor: {}, action: {} }],
          page: { size: 1, hasMore: false }
        })
      }
      return Promise.resolve({
        items: [{ eventId: 'evt-old-scope', actor: {}, action: {} }],
        page: { size: 1, hasMore: true, nextCursor: 'cursor-old' }
      })
    })

    const { result, rerender } = renderHook(
      ({ workspaceId }) => useConsoleAuditRecords('ten_1', workspaceId, {}),
      { initialProps: { workspaceId: 'wrk-old' } }
    )
    await waitFor(() => expect(result.current.nextCursor).toBe('cursor-old'))

    let pending: Promise<void> | undefined
    act(() => { pending = result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    rerender({ workspaceId: 'wrk-new' })
    await waitFor(() => {
      expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt-new-scope'])
    })

    await act(async () => {
      resolveContinuation({
        items: [{ eventId: 'evt-stale-continuation', actor: {}, action: {} }],
        page: { size: 1, hasMore: false }
      })
      await pending
    })
    expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt-new-scope'])
    expect(result.current.loadingMore).toBe(false)
  })

  it('reinicia registros y cursor al recargar explícitamente', async () => {
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({
        items: [{ eventId: 'evt-before-reload', actor: {}, action: {} }],
        page: { size: 1, hasMore: true, nextCursor: 'cursor-before-reload' }
      })
      .mockResolvedValueOnce({
        items: [{ eventId: 'evt-after-reload', actor: {}, action: {} }],
        page: { size: 1, hasMore: false }
      })

    const { result } = renderHook(() => useConsoleAuditRecords('ten_1', null, {}))
    await waitFor(() => expect(result.current.nextCursor).toBe('cursor-before-reload'))

    act(() => { result.current.reload() })
    await waitFor(() => {
      expect(result.current.records.map(({ eventId }) => eventId)).toEqual(['evt-after-reload'])
    })
    expect(result.current.hasMore).toBe(false)
    expect(result.current.nextCursor).toBeNull()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(2)
    expect(String(mockRequestConsoleSessionJson.mock.calls[1][0])).not.toContain('page%5Bafter%5D')
  })

  it('exporta auditoría y devuelve el manifiesto producido', async () => {
    const manifest = {
      exportId: 'exp_audit_1',
      status: 'completed',
      queryScope: 'tenant',
      itemCount: 1,
      maskedItemCount: 1,
      items: [{ eventId: 'evt_1', maskingApplied: true }]
    }
    mockRequestConsoleSessionJson.mockResolvedValue(manifest)
    const result = await exportAuditRecords('ten_1', null, { category: 'resource_creation' })
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/metrics/tenants/ten_1/audit-exports', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ format: 'jsonl', pageSize: 500, maskingProfileId: 'default_masked' }) }))
    expect(result).toEqual(manifest)
  })

  it('preserva respuestas aceptadas sin artefacto para que la UI no las trate como descarga', async () => {
    const acknowledgement = { status: 'accepted', message: 'Export queued; artifact pending.' }
    mockRequestConsoleSessionJson.mockResolvedValue(acknowledgement)
    const result = await exportAuditRecords('ten_1', null, {})
    expect(result).toEqual(acknowledgement)
  })
})
