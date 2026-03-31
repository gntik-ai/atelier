import { describe, expect, it, vi } from 'vitest'

// Mock the console context
const mockContextValue = {
  capabilities: {} as Record<string, boolean>,
  capabilitiesLoading: false
}

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockContextValue
}))

import { useCapabilityGate } from './use-capability-gate'

describe('useCapabilityGate', () => {
  it('returns enabled: true when capability is true in context', () => {
    mockContextValue.capabilities = { webhooks: true }
    mockContextValue.capabilitiesLoading = false

    const result = useCapabilityGate('webhooks')
    expect(result).toEqual({ enabled: true, loading: false, reason: null })
  })

  it('returns enabled: false with reason when capability is false', () => {
    mockContextValue.capabilities = { webhooks: false }
    mockContextValue.capabilitiesLoading = false

    const result = useCapabilityGate('webhooks')
    expect(result).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  })

  it('returns loading: true when capabilitiesLoading is true', () => {
    mockContextValue.capabilities = {}
    mockContextValue.capabilitiesLoading = true

    const result = useCapabilityGate('webhooks')
    expect(result).toEqual({ enabled: false, loading: true, reason: null })
  })

  it('returns enabled: false when capability key does not exist (deny-by-default)', () => {
    mockContextValue.capabilities = { realtime: true }
    mockContextValue.capabilitiesLoading = false

    const result = useCapabilityGate('unknown_capability')
    expect(result).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  })
})
