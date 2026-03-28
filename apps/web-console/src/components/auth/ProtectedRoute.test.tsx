import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sessionMocks = vi.hoisted(() => ({
  ensureConsoleSessionMock: vi.fn(),
  readConsoleShellSessionMock: vi.fn(),
  storeProtectedRouteIntentMock: vi.fn()
}))

vi.mock('@/lib/console-session', () => ({
  ensureConsoleSession: sessionMocks.ensureConsoleSessionMock,
  readConsoleShellSession: sessionMocks.readConsoleShellSessionMock,
  storeProtectedRouteIntent: sessionMocks.storeProtectedRouteIntentMock
}))

import { ProtectedRoute } from './ProtectedRoute'

describe('ProtectedRoute', () => {
  afterEach(() => {
    cleanup()
    sessionMocks.ensureConsoleSessionMock.mockReset()
    sessionMocks.readConsoleShellSessionMock.mockReset()
    sessionMocks.storeProtectedRouteIntentMock.mockReset()
  })

  it('redirige a login y guarda el destino si no hay sesión', async () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)

    renderProtectedRouter('/console/overview')

    expect(await screen.findByText('Login screen')).toBeInTheDocument()
    expect(sessionMocks.storeProtectedRouteIntentMock).toHaveBeenCalledWith('/console/overview')
  })

  it('renderiza el contenido protegido cuando la sesión es válida', async () => {
    const session = { sessionId: 'ses_test123' }
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(session)
    sessionMocks.ensureConsoleSessionMock.mockResolvedValue(session)

    renderProtectedRouter('/console/overview')

    expect(await screen.findByText('Protected content')).toBeInTheDocument()
  })

  it('permite recuperar una sesión refrescable antes de renderizar la ruta', async () => {
    const session = { sessionId: 'ses_refresh123' }
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(session)
    sessionMocks.ensureConsoleSessionMock.mockResolvedValue(session)

    renderProtectedRouter('/console/overview?tab=live')

    await waitFor(() => {
      expect(sessionMocks.ensureConsoleSessionMock).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('Protected content')).toBeInTheDocument()
  })

  it('redirige a login si la recuperación de sesión falla', async () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue({ sessionId: 'ses_broken123' })
    sessionMocks.ensureConsoleSessionMock.mockResolvedValue(null)

    renderProtectedRouter('/console/workspaces')

    expect(await screen.findByText('Login screen')).toBeInTheDocument()
    expect(sessionMocks.storeProtectedRouteIntentMock).toHaveBeenCalledWith('/console/workspaces')
  })
})

function renderProtectedRouter(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: <div>Login screen</div>
      },
      {
        path: '/console',
        element: <ProtectedRoute />,
        children: [
          {
            path: 'overview',
            element: <div>Protected content</div>
          },
          {
            path: 'workspaces',
            element: <div>Protected workspace content</div>
          }
        ]
      }
    ],
    {
      initialEntries: [initialEntry]
    }
  )

  render(<RouterProvider router={router} />)
}
