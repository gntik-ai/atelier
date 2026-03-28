import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LoginPage } from './LoginPage'

const fetchMock = vi.fn<typeof fetch>()

describe('LoginPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('renderiza el formulario y las acciones secundarias', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, { allowed: true, approvalRequired: false, effectiveMode: 'auto_activate', globalMode: 'auto_activate', environmentModes: {}, planModes: {} }))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: /accede a in atelier console/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /mantener la sesión abierta/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /¿olvidaste tu contraseña\?/i })).toHaveAttribute('href', '/password-recovery')
  })

  it('muestra el CTA de signup cuando la policy lo permite', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, { allowed: true, approvalRequired: false, effectiveMode: 'auto_activate', globalMode: 'auto_activate', environmentModes: {}, planModes: {} }))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('link', { name: /solicita acceso o crea tu cuenta/i })).toHaveAttribute('href', '/signup')
  })

  it('oculta el CTA de signup cuando la policy lo deshabilita', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        allowed: false,
        approvalRequired: false,
        effectiveMode: 'disabled',
        globalMode: 'disabled',
        environmentModes: {},
        planModes: {},
        reason: 'El auto-registro está deshabilitado por política.'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText(/el auto-registro está deshabilitado por política/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /solicita acceso o crea tu cuenta/i })).not.toBeInTheDocument()
  })

  it('envía el login y muestra el resumen de sesión', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, { allowed: true, approvalRequired: false, effectiveMode: 'auto_activate', globalMode: 'auto_activate', environmentModes: {}, planModes: {} }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          sessionId: 'ses_abc123',
          authenticationState: 'active',
          statusView: 'login',
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
          principal: {
            userId: 'usr_abc123',
            username: 'operaciones',
            displayName: 'Operaciones',
            primaryEmail: 'ops@example.com',
            state: 'active',
            platformRoles: ['platform_operator']
          }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('link', { name: /solicita acceso o crea tu cuenta/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar a la consola/i }))

    expect(await screen.findByText(/session id: ses_abc123/i)).toBeInTheDocument()
    expect(screen.getByText(/principal: operaciones/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/v1/auth/login-sessions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'operaciones', password: 'super-secret-123', rememberMe: false }),
          headers: expect.any(Headers)
        })
      )
    })

    const [, requestInit] = fetchMock.mock.calls[1]
    const headers = requestInit?.headers as Headers
    expect(headers.get('X-API-Version')).toBe('2026-03-26')
    expect(headers.get('X-Correlation-Id')).toMatch(/^corr_/)
    expect(headers.get('Idempotency-Key')).toMatch(/^idem_/)
  })

  it('muestra un error inline cuando las credenciales son inválidas', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, { allowed: true, approvalRequired: false, effectiveMode: 'auto_activate', globalMode: 'auto_activate', environmentModes: {}, planModes: {} }))
      .mockResolvedValueOnce(
        createJsonResponse(403, {
          status: 403,
          code: 'GW_INVALID_CREDENTIALS',
          message: 'Usuario o contraseña incorrectos.',
          detail: {},
          requestId: 'req_12345678',
          correlationId: 'corr_12345678',
          timestamp: '2026-03-28T18:00:00.000Z',
          resource: { path: '/v1/auth/login-sessions' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('link', { name: /solicita acceso o crea tu cuenta/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar a la consola/i }))

    expect(await screen.findByText(/usuario o contraseña incorrectos/i)).toBeInTheDocument()
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body
  } as Response
}
