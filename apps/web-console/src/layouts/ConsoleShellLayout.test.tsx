import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleShellLayout } from './ConsoleShellLayout'

import { clearConsoleShellSession, persistConsoleShellSession, readConsoleShellSession } from '@/lib/console-session'

const fetchMock = vi.fn<typeof fetch>()

const baseSession = {
  sessionId: 'ses_abc123',
  authenticationState: 'active' as const,
  statusView: 'login' as const,
  issuedAt: '2099-03-28T18:00:00.000Z',
  lastActivityAt: '2099-03-28T18:00:00.000Z',
  expiresAt: '2099-03-28T20:00:00.000Z',
  idleExpiresAt: '2099-03-28T19:00:00.000Z',
  refreshExpiresAt: '2099-03-29T18:00:00.000Z',
  sessionPolicy: {
    maxLifetime: '8h',
    idleTimeout: '1h',
    refreshTokenMaxAge: '24h'
  },
  tokenSet: {
    accessToken: 'access-token-1234567890',
    refreshToken: 'refresh-token-1234567890',
    tokenType: 'Bearer' as const,
    expiresIn: 3600,
    refreshExpiresIn: 7200,
    scope: 'openid profile email',
    expiresAt: '2099-03-28T20:00:00.000Z',
    refreshExpiresAt: '2099-03-29T18:00:00.000Z'
  },
  principal: {
    userId: 'usr_abc123',
    username: 'operaciones',
    displayName: 'Operaciones Plataforma',
    primaryEmail: 'ops@example.com',
    state: 'active' as const,
    platformRoles: ['platform_operator']
  }
}

describe('ConsoleShellLayout', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    clearConsoleShellSession()
    window.localStorage.clear()
  })

  it('renderiza header, sidebar, avatar y panel de estado usando la sesión persistida', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /in atelier console/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /auth/i })).toHaveAttribute('href', '/console/auth')
    expect(screen.getByText(/operaciones plataforma/i)).toBeInTheDocument()
    expect(screen.getByTestId('console-shell-avatar')).toHaveTextContent('OP')
    expect(screen.getByLabelText(/contexto activo de consola/i)).toBeInTheDocument()
    expect(screen.getByTestId('console-context-status-panel')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_alpha')
      expect(screen.getByTestId('console-context-tenant-status')).toHaveTextContent(/tenant alpha/i)
      expect(screen.getByTestId('console-context-workspace-status')).toHaveTextContent(/workspace alpha/i)
    })

    expect(screen.queryByTestId('console-context-operational-alert')).not.toBeInTheDocument()
  })

  it('abre el dropdown y lo cierra con escape', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /profile/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /logout/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('navega a profile desde el menú de usuario', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))
    await user.click(screen.getByRole('menuitem', { name: /profile/i }))

    expect(await screen.findByRole('heading', { name: /perfil/i })).toBeInTheDocument()
  })

  it('cambia de tenant manteniendo la ruta y reseteando el workspace anterior', async () => {
    stubShellApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')],
        ten_beta: [
          createWorkspace('wrk_beta_1', 'ten_beta', 'Workspace Beta 1'),
          createWorkspace('wrk_beta_2', 'ten_beta', 'Workspace Beta 2')
        ]
      }
    })
    window.localStorage.setItem(
      'in-atelier.console-active-context',
      JSON.stringify({
        userId: 'usr_abc123',
        tenantId: 'ten_alpha',
        workspaceId: 'wrk_alpha',
        updatedAt: '2026-03-28T18:05:00.000Z'
      })
    )
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/workspaces')

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_alpha')
    })

    await user.selectOptions(screen.getByTestId('console-context-tenant-select'), 'ten_beta')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspaces/i })).toBeInTheDocument()
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_beta')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('')
    })
  })

  it('muestra estado vacío cuando no hay tenants accesibles', async () => {
    stubShellApi({ tenants: [] })
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByText(/no tiene tenants accesibles/i)).toBeInTheDocument()
    expect(screen.getByTestId('console-context-tenant-select')).toBeDisabled()
    expect(screen.getByTestId('console-context-workspace-select')).toBeDisabled()
  })

  it('renderiza el ítem Members y apunta a /console/members', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    const membersLink = await screen.findByRole('link', { name: /members/i })
    expect(membersLink).toHaveAttribute('href', '/console/members')
  })

  it('renderiza el ítem PostgreSQL en el sidebar', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /postgresql/i })).toBeInTheDocument()
  })

  it('apunta el ítem PostgreSQL a /console/postgres', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /postgresql/i })).toHaveAttribute('href', '/console/postgres')
  })

  it('renderiza el ítem Kafka en el sidebar', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /kafka/i })).toBeInTheDocument()
  })

  it('apunta el ítem Kafka a /console/kafka', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /kafka/i })).toHaveAttribute('href', '/console/kafka')
  })

  it('muestra reintento cuando falla la carga de tenants y se recupera al reintentar', async () => {
    fetchMock
      .mockImplementationOnce(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.startsWith('/v1/tenants')) {
          return createJsonResponse(500, { message: 'Tenants degradados' })
        }

        return createJsonResponse(404, { message: 'Not found' })
      })
      .mockImplementation(createShellApiImplementation())
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    const retryButton = await screen.findByRole('button', { name: /reintentar tenants/i })
    expect(screen.getAllByText(/tenants degradados/i).length).toBeGreaterThan(0)

    await user.click(retryButton)

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_alpha')
    })
  })

  it('muestra un banner cuando el tenant activo está suspendido', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { state: 'suspended' })]
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/functions')

    expect(await screen.findByRole('alert')).toHaveTextContent(/tenant suspended/i)
  })

  it('muestra un banner cuando el workspace activo tiene provisioning parcialmente fallido', async () => {
    stubShellApi({
      workspacesByTenant: {
        ten_alpha: [
          createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha', {
            provisioning: { status: 'partially_failed' }
          })
        ]
      }
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/storage')

    expect(await screen.findByRole('alert')).toHaveTextContent(/provisioning del workspace incompleto/i)
  })

  it('muestra un banner cuando existe una cuota bloqueada en el tenant activo', async () => {
    stubShellApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha', {
          quotaProfile: {
            governanceStatus: 'nominal',
            limits: [
              {
                metricKey: 'invocations_per_minute',
                scope: 'workspace',
                used: 1000,
                limit: 1000,
                remaining: 0,
                unit: 'rpm'
              }
            ]
          }
        })
      ]
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/observability')

    expect(await screen.findByRole('alert')).toHaveTextContent(/cuotas agotadas en el tenant activo/i)
  })

  it('renderiza los links nuevos de service accounts y quotas en el sidebar', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /service accounts/i })).toHaveAttribute('href', '/console/service-accounts')
    expect(screen.getByRole('link', { name: /quotas/i })).toHaveAttribute('href', '/console/quotas')
  })

  it('ejecuta logout, limpia storage y redirige a login', async () => {
    stubShellApi({ logoutStatus: 202 })
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))
    await user.click(screen.getByRole('menuitem', { name: /logout/i }))

    expect(await screen.findByText(/pantalla de login/i)).toBeInTheDocument()
    expect(readConsoleShellSession()).toBeNull()

    await waitFor(() => {
      const logoutCall = fetchMock.mock.calls.find(([request]) => {
        const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
        return url === '/v1/auth/login-sessions/ses_abc123'
      })

      expect(logoutCall).toBeDefined()
    })

    const logoutCall = fetchMock.mock.calls.find(([request]) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
      return url === '/v1/auth/login-sessions/ses_abc123'
    })
    const requestInit = logoutCall?.[1]
    const headers = requestInit?.headers as Headers

    expect(headers.get('Authorization')).toBe('Bearer access-token-1234567890')
    expect(headers.get('X-API-Version')).toBe('2026-03-26')
    expect(headers.get('Idempotency-Key')).toMatch(/^idem_/)
  })
})

function renderShell(initialPath = '/console/overview') {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: <div>Pantalla de login</div>
      },
      {
        path: '/console',
        element: <ConsoleShellLayout />,
        children: [
          {
            path: 'overview',
            element: <h1>Overview</h1>
          },
          {
            path: 'profile',
            element: <h1>Perfil</h1>
          },
          {
            path: 'settings',
            element: <h1>Settings</h1>
          },
          {
            path: 'tenants',
            element: <h1>Tenants</h1>
          },
          {
            path: 'workspaces',
            element: <h1>Workspaces</h1>
          },
          {
            path: 'members',
            element: <h1>Members</h1>
          },
          {
            path: 'postgres',
            element: <h1>PostgreSQL</h1>
          },
          {
            path: 'functions',
            element: <h1>Functions</h1>
          },
          {
            path: 'storage',
            element: <h1>Storage</h1>
          },
          {
            path: 'observability',
            element: <h1>Observability</h1>
          },
          {
            path: 'service-accounts',
            element: <h1>Service Accounts</h1>
          },
          {
            path: 'quotas',
            element: <h1>Quotas</h1>
          }
        ]
      }
    ],
    {
      initialEntries: [initialPath]
    }
  )

  return render(<RouterProvider router={router} />)
}

function stubShellApi({
  tenants = [createTenant('ten_alpha', 'Tenant Alpha')],
  workspacesByTenant = {
    ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
  },
  logoutStatus = 202
}: {
  tenants?: Array<ReturnType<typeof createTenant>>
  workspacesByTenant?: Record<string, Array<ReturnType<typeof createWorkspace>>>
  logoutStatus?: number
} = {}) {
  fetchMock.mockImplementation(createShellApiImplementation({ tenants, workspacesByTenant, logoutStatus }))
  vi.stubGlobal('fetch', fetchMock)
}

function createShellApiImplementation({
  tenants = [createTenant('ten_alpha', 'Tenant Alpha')],
  workspacesByTenant = {
    ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
  },
  logoutStatus = 202
}: {
  tenants?: Array<ReturnType<typeof createTenant>>
  workspacesByTenant?: Record<string, Array<ReturnType<typeof createWorkspace>>>
  logoutStatus?: number
} = {}) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsedUrl = new URL(url, 'http://localhost')

    if (parsedUrl.pathname === '/v1/tenants') {
      return createJsonResponse(200, { items: tenants, page: {} })
    }

    if (parsedUrl.pathname === '/v1/workspaces') {
      const tenantId = parsedUrl.searchParams.get('filter[tenantId]') ?? ''
      return createJsonResponse(200, { items: workspacesByTenant[tenantId] ?? [], page: {} })
    }

    if (parsedUrl.pathname === '/v1/auth/login-sessions/ses_abc123') {
      return createJsonResponse(logoutStatus, {
        sessionId: 'ses_abc123',
        status: 'accepted',
        acceptedAt: '2026-03-28T18:05:00.000Z'
      })
    }

    return createJsonResponse(404, { message: 'Not found' })
  }
}

function createTenant(tenantId: string, displayName: string, overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, '-'),
    state: 'active',
    governance: {
      governanceStatus: 'nominal'
    },
    quotaProfile: {
      governanceStatus: 'nominal',
      limits: []
    },
    inventorySummary: {
      tenantId,
      workspaceCount: 1,
      applicationCount: 1,
      managedResourceCount: 1,
      serviceAccountCount: 1,
      workspaces: []
    },
    ...overrides
  }
}

function createWorkspace(
  workspaceId: string,
  tenantId: string,
  displayName: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    workspaceId,
    tenantId,
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, '-'),
    environment: 'sandbox',
    state: 'active',
    provisioning: {
      status: 'completed'
    },
    ...overrides
  }
}

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'Accepted' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body
  } as Response
}
