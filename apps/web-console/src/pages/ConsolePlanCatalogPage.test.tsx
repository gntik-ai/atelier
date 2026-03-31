import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsolePlanCatalogPage } from './ConsolePlanCatalogPage'

vi.mock('@/services/planManagementApi', () => ({ listPlans: vi.fn().mockResolvedValue({ items: [{ id: 'p1', slug: 'starter', displayName: 'Starter', status: 'active', capabilities: {}, quotaDimensions: {}, assignedTenantCount: 2, updatedAt: '2026-03-31' }], total: 1, page: 1, pageSize: 20 }) }))

describe('ConsolePlanCatalogPage', () => {
  it('renders catalog rows', async () => {
    render(<MemoryRouter><ConsolePlanCatalogPage /></MemoryRouter>)
    expect(await screen.findByText('starter')).toBeInTheDocument()
    expect(screen.getByText('Starter')).toBeInTheDocument()
  })
})
