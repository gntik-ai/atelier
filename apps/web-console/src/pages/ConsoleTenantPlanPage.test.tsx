import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleTenantPlanPage } from './ConsoleTenantPlanPage'

vi.mock('@/services/planManagementApi', () => ({ getTenantCurrentPlan: vi.fn().mockResolvedValue({ assignment: { planId: 'p1' }, plan: { displayName: 'Starter', status: 'active' } }), getTenantPlanHistory: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }), listPlans: vi.fn().mockResolvedValue({ items: [{ id: 'p1', displayName: 'Starter', status: 'active' }], total: 1, page: 1, pageSize: 20 }), assignPlan: vi.fn() }))

describe('ConsoleTenantPlanPage', () => {
  it('renders current assignment and change action', async () => {
    render(<MemoryRouter initialEntries={['/console/tenants/ten_1/plan']}><Routes><Route path='/console/tenants/:tenantId/plan' element={<ConsoleTenantPlanPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change plan/i })).toBeInTheDocument()
  })
})
