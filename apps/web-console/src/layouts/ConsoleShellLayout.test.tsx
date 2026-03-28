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
  issuedAt: '2026-03-28T18:00:00.000Z',
  lastActivityAt: '2026-03-28T18:00:00.000Z',
  expiresAt: '2026-03-28T20:00:00.000Z',
  idleExpiresAt: '2026-03-28T19:00:00.000Z',
  refreshExpiresAt: '2026-03-29T18:00:00.000Z',
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
    expiresAt: '2026-03-28T20:00:00.000Z',
    refreshExpiresAt: '2026-03-29T18:00:00.000Z'
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
  })

  it('renderiza header, sidebar y avatar usando la sesión persistida', async () => {
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /in atelier console/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(/operaciones plataforma/i)).toBeInTheDocument()
    expect(screen.getByTestId('console-shell-avatar')).toHaveTextContent('OP')
  })

  it('abre el dropdown y lo cierra con escape', async () => {
    vi.stubGlobal('fetch', fetchMock)
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
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))
    await user.click(screen.getByRole('menuitem', { name: /profile/i }))

    expect(await screen.findByRole('heading', { name: /perfil/i })).toBeInTheDocument()
  })

  it('ejecuta logout, limpia storage y redirige a login', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(202, {
        sessionId: 'ses_abc123',
        status: 'accepted',
        acceptedAt: '2026-03-28T18:05:00.000Z'
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))
    await user.click(screen.getByRole('menuitem', { name: /logout/i }))

    expect(await screen.findByText(/pantalla de login/i)).toBeInTheDocument()
    expect(readConsoleShellSession()).toBeNull()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/auth/login-sessions/ses_abc123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.any(Headers)
        })
      )
    })

    const [, requestInit] = fetchMock.mock.calls[0]
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

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'Accepted' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body
  } as Response
}
