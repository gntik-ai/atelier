import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mockGateResult = { enabled: true, loading: false, reason: null as string | null }

vi.mock('@/lib/hooks/use-capability-gate', () => ({
  useCapabilityGate: () => mockGateResult
}))

import { CapabilityGate } from './CapabilityGate'

describe('CapabilityGate', () => {
  it('renders children without modification when capability is enabled', () => {
    mockGateResult.enabled = true
    mockGateResult.loading = false
    mockGateResult.reason = null

    render(
      <CapabilityGate capability="webhooks">
        <span data-testid="child">Content</span>
      </CapabilityGate>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.queryByTestId('capability-gate-disabled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('capability-gate-skeleton')).not.toBeInTheDocument()
  })

  it('hides children in hide mode when capability is disabled', () => {
    mockGateResult.enabled = false
    mockGateResult.loading = false
    mockGateResult.reason = 'plan_restriction'

    render(
      <CapabilityGate capability="webhooks" mode="hide">
        <span data-testid="child">Content</span>
      </CapabilityGate>
    )

    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('renders children with pointer-events-none and badge in disable mode when capability is disabled', () => {
    mockGateResult.enabled = false
    mockGateResult.loading = false
    mockGateResult.reason = 'plan_restriction'

    render(
      <CapabilityGate capability="webhooks" mode="disable">
        <span data-testid="child">Content</span>
      </CapabilityGate>
    )

    const disabledContainer = screen.getByTestId('capability-gate-disabled')
    expect(disabledContainer).toBeInTheDocument()
    expect(disabledContainer.className).toContain('pointer-events-none')
    expect(screen.getByTestId('capability-gate-badge')).toBeInTheDocument()
  })

  it('renders skeleton when loading', () => {
    mockGateResult.enabled = false
    mockGateResult.loading = true
    mockGateResult.reason = null

    render(
      <CapabilityGate capability="webhooks">
        <span data-testid="child">Content</span>
      </CapabilityGate>
    )

    expect(screen.getByTestId('capability-gate-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })
})
