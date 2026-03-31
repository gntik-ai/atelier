import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { useCapabilityGate } from '@/lib/hooks/use-capability-gate'

interface CapabilityGateProps {
  capability: string
  mode?: 'hide' | 'disable'
  upgradeMessage?: string
  children: ReactNode
}

const DEFAULT_UPGRADE_MESSAGE = 'Disponible en un plan superior. Contacta con tu administrador para ampliar.'

export function CapabilityGate({
  capability,
  mode = 'disable',
  upgradeMessage,
  children
}: CapabilityGateProps) {
  const { enabled, loading } = useCapabilityGate(capability)

  if (loading) {
    return (
      <div data-testid="capability-gate-skeleton" className="h-16 animate-pulse rounded-lg border border-border bg-muted/40" />
    )
  }

  if (enabled) {
    return <>{children}</>
  }

  if (mode === 'hide') {
    return null
  }

  // mode === 'disable'
  return (
    <div className="relative">
      <div className="opacity-50 pointer-events-none" data-testid="capability-gate-disabled">
        {children}
      </div>
      <Badge variant="outline" className="absolute right-2 top-2 text-xs" data-testid="capability-gate-badge">
        {upgradeMessage ?? DEFAULT_UPGRADE_MESSAGE}
      </Badge>
    </div>
  )
}
