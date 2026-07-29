import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportAuditRecords, normalizeAuditRecord, normalizeMetricsOverview, useConsoleAuditRecords, useConsoleMetrics, type ConsoleMetricRange } from './console-metrics'

const mockRequestConsoleSessionJson = vi.fn()
vi.mock('@/lib/console-session', () => ({ requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args) }))

describe('console-metrics', () => {
  beforeEach(() => {
    mockRequestConsoleSessionJson.mockReset()
  })

  it('normaliza overview y deriva pctUsed y warnings', () => {
    const result = normalizeMetricsOverview({ generatedAt: 'now', overallPosture: 'warning_threshold_reached', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 8, hardLimit: 10 }] }, { measuredAt: 'now', dimensions: [] })
    expect(result.dimensions[0]?.pctUsed).toBe(80)
    expect(result.hasQuotaWarning).toBe(true)
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

  it('carga auditoría con filtros', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({ items: [{ eventId: 'evt_1', actor: { actorId: 'usr_1', actorType: 'tenant_user' }, action: { actionId: 'create', category: 'resource_creation' } }] })
    const { result } = renderHook(() => useConsoleAuditRecords('ten_1', null, { actorId: 'usr_1', result: 'success' }))
    await waitFor(() => expect(result.current.records).toHaveLength(1))
    expect(mockRequestConsoleSessionJson.mock.calls[0][0]).toContain('filter%5BactorId%5D=usr_1')
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
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/metrics/tenants/ten_1/audit-exports', expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(manifest)
  })

  it('preserva respuestas aceptadas sin artefacto para que la UI no las trate como descarga', async () => {
    const acknowledgement = { status: 'accepted', message: 'Export queued; artifact pending.' }
    mockRequestConsoleSessionJson.mockResolvedValue(acknowledgement)
    const result = await exportAuditRecords('ten_1', null, {})
    expect(result).toEqual(acknowledgement)
  })
})
