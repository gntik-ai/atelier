import { renderHook, waitFor } from '@testing-library/react'
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
})
