import { useConsoleContext } from '@/lib/console-context'

export type CapabilityGateReason = 'plan_restriction' | 'override_restriction' | null

export interface CapabilityGateResult {
  enabled: boolean
  loading: boolean
  reason: CapabilityGateReason
}

export function useCapabilityGate(capabilityKey: string): CapabilityGateResult {
  const { capabilities, capabilitiesLoading } = useConsoleContext()

  if (capabilitiesLoading) {
    return { enabled: false, loading: true, reason: null }
  }

  if (capabilities[capabilityKey] === true) {
    return { enabled: true, loading: false, reason: null }
  }

  return { enabled: false, loading: false, reason: 'plan_restriction' }
}
