import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleTenantPlanOverviewPage } from './ConsoleTenantPlanOverviewPage'

vi.mock('@/services/planManagementApi', () => ({
  getEffectiveEntitlements: vi.fn().mockResolvedValue({
    planDisplayName: 'Starter',
    planSlug: 'starter',
    latestHistoryEntryId: 'h1',
    noAssignment: false,
    quotaDimensions: [{ dimensionKey: 'max_workspaces', displayLabel: 'Workspaces', effectiveValue: 10, observedUsage: 3, usageStatus: 'within_limit' }],
    capabilities: [{ capabilityKey: 'realtime', displayLabel: 'Realtime', enabled: true }]
  })
}))

describe('ConsoleTenantPlanOverviewPage', () => {
  it('renders tenant owner plan overview', async () => {
    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('starter')).toBeInTheDocument()
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('Realtime')).toBeInTheDocument()
  })
})
