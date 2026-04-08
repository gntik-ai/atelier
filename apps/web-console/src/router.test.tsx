import { cleanup, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from './router'

vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: () => <Outlet /> }))
vi.mock('@/layouts/ConsoleShellLayout', () => ({ ConsoleShellLayout: () => <Outlet /> }))
vi.mock('@/pages/ConsoleObservabilityPage', () => ({ ConsoleObservabilityPage: () => <h1>Observability Real</h1> }))
vi.mock('@/pages/ConsoleServiceAccountsPage', () => ({ ConsoleServiceAccountsPage: () => <h1>Service Accounts Real</h1> }))
vi.mock('@/pages/ConsoleQuotasPage', () => ({ ConsoleQuotasPage: () => <h1>Quotas Real</h1> }))
vi.mock('@/pages/ConsoleTenantsPage', () => ({ ConsoleTenantsPage: () => <h1>Gestión de tenants</h1> }))
vi.mock('@/pages/ConsoleWorkspacesPage', () => ({ ConsoleWorkspacesPage: () => <h1>Gestión de workspaces</h1> }))
vi.mock('@/pages/ConsoleRealtimePage', () => ({ ConsoleRealtimePage: () => <h1>Realtime workspace</h1> }))
vi.mock('@/pages/ConsolePlanCatalogPage', () => ({ ConsolePlanCatalogPage: () => <h1>Plan catalog</h1> }))
vi.mock('@/pages/ConsolePlanCreatePage', () => ({ ConsolePlanCreatePage: () => <h1>Create plan</h1> }))
vi.mock('@/pages/ConsolePlanDetailPage', () => ({ ConsolePlanDetailPage: () => <h1>Plan detail</h1> }))
vi.mock('@/pages/ConsoleTenantPlanPage', () => ({ ConsoleTenantPlanPage: () => <h1>Tenant plan admin</h1> }))
vi.mock('@/pages/ConsoleTenantPlanOverviewPage', () => ({ ConsoleTenantPlanOverviewPage: () => <h1>My plan</h1> }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => ({ principal: { platformRoles: ['superadmin'] } }) }))

afterEach(() => cleanup())

describe('router', () => {
  it('renderiza la página de bienvenida en la ruta raíz', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: /in falcone console/i })).toBeInTheDocument()
  })

  it('renderiza tenants y workspaces con páginas reales', async () => {
    const tenantsRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/tenants'] })
    render(<RouterProvider router={tenantsRouter} />)
    expect(await screen.findByRole('heading', { name: /gestión de tenants/i })).toBeInTheDocument()

    cleanup()
    const workspacesRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/workspaces'] })
    render(<RouterProvider router={workspacesRouter} />)
    expect(await screen.findByRole('heading', { name: /gestión de workspaces/i })).toBeInTheDocument()

    cleanup()
    const realtimeRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/workspaces/ws_1/realtime'] })
    render(<RouterProvider router={realtimeRouter} />)
    expect(await screen.findByRole('heading', { name: /realtime workspace/i })).toBeInTheDocument()
  })
})


it('renderiza plan catalog para superadmin', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/plans'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByRole('heading', { name: /plan catalog/i })).toBeInTheDocument()
})
