import { cleanup, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from './router'

vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: () => <Outlet /> }))
vi.mock('@/layouts/ConsoleShellLayout', () => ({ ConsoleShellLayout: () => <Outlet /> }))
vi.mock('@/pages/ConsoleObservabilityPage', () => ({ ConsoleObservabilityPage: () => <h1>Observability Real</h1> }))
vi.mock('@/pages/ConsoleServiceAccountsPage', () => ({ ConsoleServiceAccountsPage: () => <h1>Service Accounts Real</h1> }))
vi.mock('@/pages/ConsoleQuotasPage', () => ({ ConsoleQuotasPage: () => <h1>Quotas Real</h1> }))

afterEach(() => {
  cleanup()
})

describe('router', () => {
  it('renderiza la página de bienvenida en la ruta raíz', async () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: ['/']
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1, name: /in atelier console/i })).toBeInTheDocument()
  })

  it('renderiza la página no encontrada para rutas inexistentes', async () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: ['/ruta-inexistente']
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1, name: /página no encontrada/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver al inicio/i })).toHaveAttribute('href', '/')
  })

  it('registra observability con página real y añade service-accounts y quotas', async () => {
    const observabilityRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/observability'] })
    render(<RouterProvider router={observabilityRouter} />)
    expect(await screen.findByRole('heading', { name: /observability real/i })).toBeInTheDocument()

    cleanup()
    const serviceAccountsRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/service-accounts'] })
    render(<RouterProvider router={serviceAccountsRouter} />)
    expect(await screen.findByRole('heading', { name: /service accounts real/i })).toBeInTheDocument()

    cleanup()
    const quotasRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/quotas'] })
    render(<RouterProvider router={quotasRouter} />)
    expect(await screen.findByRole('heading', { name: /quotas real/i })).toBeInTheDocument()
  })
})
