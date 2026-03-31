import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsolePlanDetailPage } from './ConsolePlanDetailPage'

vi.mock('@/services/planManagementApi', () => ({ getPlan: vi.fn().mockResolvedValue({ id: 'p1', slug: 'starter', displayName: 'Starter', description: 'Desc', status: 'active', capabilities: { api: true }, quotaDimensions: {} }), getPlanLimitsProfile: vi.fn().mockResolvedValue({ planId: 'p1', profile: [] }), setPlanLimit: vi.fn(), removePlanLimit: vi.fn() }))

describe('ConsolePlanDetailPage', () => {
  it('renders plan detail tabs', async () => {
    render(<MemoryRouter initialEntries={['/console/plans/p1']}><Routes><Route path='/console/plans/:planId' element={<ConsolePlanDetailPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /capabilities/i })).toBeInTheDocument()
  })
})
