import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PendingActivationPage } from './PendingActivationPage'
import { SignupPage } from './SignupPage'

const fetchMock = vi.fn<typeof fetch>()

describe('SignupPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('renderiza el formulario cuando la policy permite signup', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        allowed: true,
        approvalRequired: false,
        effectiveMode: 'auto_activate',
        globalMode: 'auto_activate',
        environmentModes: {},
        planModes: {}
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: /crea tu acceso a in falcone console/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/nombre visible/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/correo principal/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
  })

  it('muestra una pantalla informativa cuando la policy deshabilita signup', async () => {
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

    expect((await screen.findAllByText(/el auto-registro está deshabilitado por política/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /crear solicitud de acceso/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ir al acceso de consola/i })).toHaveAttribute('href', '/login')
  })

  it('envía el signup y muestra feedback de éxito cuando la cuenta queda activa', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          allowed: true,
          approvalRequired: false,
          effectiveMode: 'auto_activate',
          globalMode: 'auto_activate',
          environmentModes: {},
          planModes: {}
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(202, {
          registrationId: 'reg_abc123',
          userId: 'usr_abc123',
          activationMode: 'auto_activate',
          state: 'active',
          statusView: 'signup',
          createdAt: '2026-03-28T19:00:00.000Z',
          message: 'La cuenta ya puede continuar a login.'
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByText(/registration id: reg_abc123/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /continuar hacia login/i })).toHaveAttribute('href', '/login')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/v1/auth/signups',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            username: 'operaciones',
            displayName: 'Operaciones Plataforma',
            primaryEmail: 'ops@example.com',
            password: 'super-secret-123'
          }),
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

  it('navega a activación pendiente cuando el signup queda pendiente', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          allowed: true,
          approvalRequired: true,
          effectiveMode: 'approval_required',
          globalMode: 'approval_required',
          environmentModes: {},
          planModes: {}
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(202, {
          registrationId: 'reg_pending123',
          userId: 'usr_pending123',
          activationMode: 'approval_required',
          state: 'pending_activation',
          statusView: 'pending_activation',
          createdAt: '2026-03-28T19:10:00.000Z',
          message: 'Tu registro está pendiente de revisión.'
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          statusView: 'pending_activation',
          title: 'Tu registro está pendiente de activación',
          message: 'Estamos esperando la aprobación final para habilitar el acceso.',
          allowedActions: []
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByText(/estamos esperando la aprobación final para habilitar el acceso/i)).toBeInTheDocument()
    expect(screen.getByText(/registration id: reg_pending123/i)).toBeInTheDocument()
  })

  it('muestra feedback cuando ya existe una cuenta con esos datos', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          allowed: true,
          approvalRequired: false,
          effectiveMode: 'auto_activate',
          globalMode: 'auto_activate',
          environmentModes: {},
          planModes: {}
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(409, {
          status: 409,
          code: 'AUTH_SIGNUP_CONFLICT',
          message: 'El username o email ya existe.',
          detail: {},
          requestId: 'req_12345678',
          correlationId: 'corr_12345678',
          resource: { path: '/v1/auth/signups' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByText(/el username o email ya existe/i)).toBeInTheDocument()
  })
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/pending-activation" element={<PendingActivationPage />} />
      </Routes>
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
