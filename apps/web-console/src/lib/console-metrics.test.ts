import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportAuditRecords, normalizeAuditRecord, normalizeMetricsOverview, useConsoleAuditRecords, useConsoleMetrics } from './console-metrics'

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

  it('normaliza audit record', () => {
    const record = normalizeAuditRecord({ eventId: 'evt_1', actor: { actorId: 'usr_1', actorType: 'tenant_user' }, action: { actionId: 'create', category: 'resource_creation' } })
    expect(record.eventId).toBe('evt_1')
    expect(record.action.category).toBe('resource_creation')
  })

  it('carga métricas tenant/workspace', async () => {
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ generatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10 }] })
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ measuredAt: 'now', dimensions: [] })
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ points: [{ timestamp: 'now', value: 5 }] })
    const { result } = renderHook(() => useConsoleMetrics('ten_1', 'wrk_1', { preset: '7d' }))
    await waitFor(() => expect(result.current.overview?.dimensions[0]?.displayName).toBe('API'))
  })

  it('carga auditoría con filtros', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({ items: [{ eventId: 'evt_1', actor: { actorId: 'usr_1', actorType: 'tenant_user' }, action: { actionId: 'create', category: 'resource_creation' } }] })
    const { result } = renderHook(() => useConsoleAuditRecords('ten_1', null, { actorId: 'usr_1', result: 'success' }))
    await waitFor(() => expect(result.current.records).toHaveLength(1))
    expect(mockRequestConsoleSessionJson.mock.calls[0][0]).toContain('filter%5BactorId%5D=usr_1')
  })

  it('exporta auditoría', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({ ok: true })
    await exportAuditRecords('ten_1', null, { category: 'resource_creation' })
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/metrics/tenants/ten_1/audit-exports', expect.objectContaining({ method: 'POST' }))
  })
})
