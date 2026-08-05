import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeQuotaPosture, useConsoleQuotas } from './console-quotas'

const mockRequestConsoleSessionJson = vi.fn()
vi.mock('@/lib/console-session', () => ({ requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args) }))

describe('console-quotas', () => {
  beforeEach(() => {
    mockRequestConsoleSessionJson.mockReset()
  })

  it('normaliza postura y deriva warning/exceeded', () => {
    const result = normalizeQuotaPosture({ evaluatedAt: 'now', hardLimitBreaches: ['storage'], dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 8, hardLimit: 10 }, { dimensionId: 'storage', displayName: 'Storage', measuredValue: 12, hardLimit: 10 }] }, { generatedAt: 'now', overallPosture: 'hard_limit_breached' })
    expect(result.dimensions[0]?.isWarning).toBe(true)
    expect(result.dimensions[1]?.isExceeded).toBe(true)
  })

  it('carga cuotas tenant y workspace', async () => {
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ evaluatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 8, hardLimit: 10 }] })
      .mockResolvedValueOnce({ generatedAt: 'now', overallPosture: 'warning_threshold_reached' })
      .mockResolvedValueOnce({ evaluatedAt: 'now', dimensions: [{ dimensionId: 'storage', displayName: 'Storage', measuredValue: 1, hardLimit: 10 }] })
      .mockResolvedValueOnce({ generatedAt: 'now', overallPosture: 'within_limit' })
    const { result } = renderHook(() => useConsoleQuotas('ten_1', 'wrk_1'))
    await waitFor(() => expect(result.current.posture?.dimensions[0]?.dimensionId).toBe('api'))
    expect(result.current.workspacePosture?.dimensions[0]?.dimensionId).toBe('storage')
  })

  // C-16: either authoritative scope can disappear between reloads. Both normalized posture
  // objects form one screen snapshot and must be cleared together on a tenant or workspace 404.
  it.each(['tenant', 'workspace'] as const)(
    'limpia la postura tenant y workspace cuando el alcance %s devuelve 404',
    async (failedScope) => {
      const notFound = Object.assign(new Error(`${failedScope} not found`), { status: 404 })
      let failScope = false
      mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
        if (failScope && url.includes(`/metrics/${failedScope === 'tenant' ? 'tenants' : 'workspaces'}/`)) {
          throw notFound
        }
        if (url.includes('/quotas')) {
          const workspace = url.includes('/workspaces/')
          return {
            evaluatedAt: 'now',
            dimensions: [{
              dimensionId: workspace ? 'storage' : 'api',
              displayName: workspace ? 'Storage' : 'API',
              measuredValue: workspace ? 1 : 8,
              hardLimit: 10
            }]
          }
        }
        return { generatedAt: 'now', overallPosture: 'within_limit' }
      })

      const { result } = renderHook(() => useConsoleQuotas('ten_1', 'wrk_1'))
      await waitFor(() => expect(result.current.posture?.dimensions[0]?.dimensionId).toBe('api'))
      expect(result.current.workspacePosture?.dimensions[0]?.dimensionId).toBe('storage')

      failScope = true
      await act(async () => {
        result.current.reload()
      })
      await waitFor(() => expect(result.current.error).not.toBeNull())
      expect(result.current.posture).toBeNull()
      expect(result.current.workspacePosture).toBeNull()
    }
  )
})
