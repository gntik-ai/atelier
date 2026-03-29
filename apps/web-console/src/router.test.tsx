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

afterEach(() => cleanup())

describe('router', () => {
  it('renderiza la página de bienvenida en la ruta raíz', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: /in atelier console/i })).toBeInTheDocument()
  })

  it('renderiza tenants y workspaces con páginas reales', async () => {
    const tenantsRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/tenants'] })
    render(<RouterProvider router={tenantsRouter} />)
    expect(await screen.findByRole('heading', { name: /gestión de tenants/i })).toBeInTheDocument()

    cleanup()
    const workspacesRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/workspaces'] })
    render(<RouterProvider router={workspacesRouter} />)
    expect(await screen.findByRole('heading', { name: /gestión de workspaces/i })).toBeInTheDocument()
  })
})
