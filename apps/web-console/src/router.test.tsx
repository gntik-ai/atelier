import { cleanup, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from './router'

const {
  consoleAuthPageRenderMock,
  consoleIamAccessPageRenderMock,
  consolePrivilegeDomainAuditPageRenderMock,
  readConsoleShellSessionMock,
  hasUsableConsoleSessionMock
} = vi.hoisted(() => ({
  consoleAuthPageRenderMock: vi.fn(),
  consoleIamAccessPageRenderMock: vi.fn(),
  consolePrivilegeDomainAuditPageRenderMock: vi.fn(),
  readConsoleShellSessionMock: vi.fn(),
  hasUsableConsoleSessionMock: vi.fn()
}))

vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: () => <Outlet /> }))
vi.mock('@/layouts/ConsoleShellLayout', () => ({ ConsoleShellLayout: () => <Outlet /> }))
vi.mock('@/pages/ConsoleAuthPage', () => ({
  ConsoleAuthPage: () => {
    consoleAuthPageRenderMock()
    return <h1>Auth IAM</h1>
  }
}))
vi.mock('@/pages/ConsoleAuthConfigPage', () => ({ ConsoleAuthConfigPage: () => <h1>Auth Config Real</h1> }))
vi.mock('@/pages/ConsoleIamAccessPage', () => ({
  ConsoleIamAccessPage: () => {
    consoleIamAccessPageRenderMock()
    return <h1>IAM Access</h1>
  }
}))
vi.mock('@/pages/ConsolePrivilegeDomainAuditPage', () => ({
  default: () => {
    consolePrivilegeDomainAuditPageRenderMock()
    return <h1>Auditoría de dominios de privilegio</h1>
  }
}))
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
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: readConsoleShellSessionMock,
  // NotFoundPage (#733) reads this to decide its auth-aware primary recovery action; the router
  // tests below aren't about that decision, so default it to match the always-present superadmin
  // session set up below (an authenticated session is, in fact, "usable").
  hasUsableConsoleSession: hasUsableConsoleSessionMock
}))

beforeEach(() => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))
  hasUsableConsoleSessionMock.mockReturnValue(true)
  consoleAuthPageRenderMock.mockClear()
  consoleIamAccessPageRenderMock.mockClear()
  consolePrivilegeDomainAuditPageRenderMock.mockClear()
})

afterEach(() => {
  cleanup()
  readConsoleShellSessionMock.mockReset()
  hasUsableConsoleSessionMock.mockReset()
})

describe('router', () => {
  it('renderiza la página de bienvenida en la ruta raíz', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: /in falcone console/i })).toBeInTheDocument()
    // [#731] AuthLayout wraps every unauthenticated route with the shared brand mark and a
    // per-route, localized document.title.
    expect(document.title).toBe('Bienvenida · Consola In Falcone')
    expect(screen.getByRole('img', { name: /in falcone/i })).toHaveAttribute('src', '/img/logo-wide.png')
  })

  it('[#731] renderiza el 404 dentro de AuthLayout (brand mark + título localizado) para una ruta no reconocida', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/this-route-does-not-exist'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1, name: /página no encontrada/i })).toBeInTheDocument()
    expect(document.title).toBe('Página no encontrada · Consola In Falcone')
    expect(screen.getByRole('img', { name: /in falcone/i })).toHaveAttribute('src', '/img/logo-wide.png')
    expect(screen.getByRole('link', { name: /volver al inicio de sesión/i })).toHaveAttribute('href', '/login')
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

  it('[#761] /console redirige a Vista general para un rol write-capable (superadmin, por defecto)', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/console'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: /vista general de la consola/i })).toBeInTheDocument()
  })

  it('[#761] /console redirige a Observabilidad para un rol de solo lectura (tenant_viewer)', async () => {
    readConsoleShellSessionMock.mockReturnValue(createRouterSession(['tenant_viewer'], { tenantIds: ['ten_alpha'] }))

    const router = createMemoryRouter(appRoutes, { initialEntries: ['/console'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: /observability real/i })).toBeInTheDocument()
  })

  it('[#726] renderiza /password-recovery como ruta pública real, no como NotFound', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/password-recovery'] })
    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { name: /recupera el acceso a in falcone console/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar instrucciones/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('heading', { name: /página no encontrada/i })).not.toBeInTheDocument()
    // [#731]
    expect(document.title).toBe('Recuperar contraseña · Consola In Falcone')
    expect(screen.getByRole('img', { name: /in falcone/i })).toHaveAttribute('src', '/img/logo-wide.png')
  })
})


it('renderiza plan catalog para superadmin', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/plans'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByRole('heading', { name: /plan catalog/i })).toBeInTheDocument()
})

it('[#745] muestra un bloqueo explícito para tenant_owner en /console/auth sin renderizar Auth', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/auth'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('alert')).toHaveTextContent(/necesitas permisos de superadmin/i)
  expect(screen.getByRole('button', { name: /volver a la vista general/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /revisar mi plan y permisos/i })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /my plan/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /auth iam/i })).not.toBeInTheDocument()
  expect(consoleAuthPageRenderMock).not.toHaveBeenCalled()
})

it('[#740] permite que superadmin abra /console/auth', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/auth'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /auth iam/i })).toBeInTheDocument()
  expect(consoleAuthPageRenderMock).toHaveBeenCalled()
})

it('[#782] permite que tenant_owner abra /console/auth-config (NO está gateado a superadmin, a diferencia de /console/auth)', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/auth-config'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /auth config real/i })).toBeInTheDocument()
})

it('[#782] permite que superadmin abra /console/auth-config', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/auth-config'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /auth config real/i })).toBeInTheDocument()
})

it('[#745] muestra un bloqueo explícito para tenant_owner en /console/iam-access sin renderizar IAM Access', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/iam-access'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('alert')).toHaveTextContent(/necesitas permisos de superadmin/i)
  expect(screen.getByRole('button', { name: /volver a la vista general/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /revisar mi plan y permisos/i })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /my plan/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /iam access/i })).not.toBeInTheDocument()
  expect(consoleIamAccessPageRenderMock).not.toHaveBeenCalled()
})

it('[#740] permite que superadmin abra /console/iam-access', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/iam-access'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /iam access/i })).toBeInTheDocument()
  expect(consoleIamAccessPageRenderMock).toHaveBeenCalled()
})

it.each(['platform_admin', 'tenant_owner'])(
  '[C-14] permite que %s abra la auditoría de dominios de privilegio',
  async (role) => {
    readConsoleShellSessionMock.mockReturnValue(
      createRouterSession([role], role === 'tenant_owner' ? { tenantIds: ['ten_alpha'] } : {})
    )

    const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/privilege-domain-audit'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: /auditoría de dominios de privilegio/i })).toBeInTheDocument()
    expect(consolePrivilegeDomainAuditPageRenderMock).toHaveBeenCalledTimes(1)
  }
)

it.each([
  'superadmin',
  'platform_auditor',
  'tenant_admin',
  'workspace_owner',
  'workspace_admin',
  'workspace_auditor'
])('[C-14] bloquea a %s sin montar la página de auditoría', async (role) => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession([role], { tenantIds: ['ten_alpha'] }))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/privilege-domain-audit'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sin acceso a la auditoría de dominios de privilegio/i })).toBeInTheDocument()
  expect(screen.getByText(/solo está disponible para los roles platform_admin o tenant_owner/i)).toBeInTheDocument()
  expect(consolePrivilegeDomainAuditPageRenderMock).not.toHaveBeenCalled()
})

it('[#745] muestra una recuperación explícita para rutas autenticadas desconocidas en vez de redirigir', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/no-existe'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByText(/sección de consola no encontrada/i)).toBeInTheDocument()
  expect(screen.getByText(/tu sesión y el contexto activo se mantienen/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /volver a la vista general/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /volver a la página anterior/i })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /vista general de la consola/i })).not.toBeInTheDocument()
})

function createRouterSession(
  platformRoles: string[],
  principalOverrides: Record<string, unknown> = {}
) {
  return {
    principal: {
      platformRoles,
      ...principalOverrides
    }
  }
}
