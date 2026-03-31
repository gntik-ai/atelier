import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleTenantPlanOverviewPage } from './ConsoleTenantPlanOverviewPage'

vi.mock('@/services/planManagementApi', () => ({ getMyPlan: vi.fn().mockResolvedValue({ assignment: { planId: 'p1' }, plan: { displayName: 'Starter', description: 'Desc', capabilities: { api: true } } }), getMyPlanLimits: vi.fn().mockResolvedValue({ profile: [] }) }))

describe('ConsoleTenantPlanOverviewPage', () => {
  it('renders tenant owner plan overview', async () => {
    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('Desc')).toBeInTheDocument()
  })
})
