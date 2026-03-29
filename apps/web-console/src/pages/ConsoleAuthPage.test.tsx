import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleAuthPage } from './ConsoleAuthPage'

import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn()
}))

vi.mock('@/lib/console-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-context')>('@/lib/console-context')
  return {
    ...actual,
    useConsoleContext: vi.fn()
  }
})

const useConsoleContextMock = vi.mocked(useConsoleContext)
const requestConsoleSessionJsonMock = vi.mocked(requestConsoleSessionJson)

const baseContext = {
  activeTenant: {
    tenantId: 'ten_alpha',
    label: 'Tenant Alpha',
    consoleUserRealm: 'realm-alpha'
  },
  activeWorkspace: {
    workspaceId: 'wrk_alpha',
    label: 'Workspace Alpha'
  }
}

function applicationFixture(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: 'app_alpha',
    entityType: 'external_application',
    displayName: 'Portal Clientes',
    slug: 'portal-clientes',
    protocol: 'oidc',
    state: 'active',
    redirectUris: ['https://portal.example.com/callback'],
    scopes: [{ scopeName: 'openid' }],
    authenticationFlows: ['oidc_authorization_code_pkce'],
    federatedProviders: [
      {
        providerId: 'corp-oidc',
        alias: 'Corp OIDC',
        displayName: 'Corporate OIDC',
        protocol: 'oidc',
        providerMode: 'manual_endpoints',
        enabled: true,
        authorizationUrl: 'https://id.example.com/auth',
        tokenUrl: 'https://id.example.com/token',
        userInfoUrl: 'https://id.example.com/userinfo',
        requestedScopes: ['openid', 'profile']
      }
    ],
    metadata: { managedBy: 'seed' },
    login: {
      redirectUris: ['https://portal.example.com/callback'],
      defaultRedirectUri: 'https://portal.example.com/callback'
    },
    logout: {
      frontChannelLogoutUri: 'https://portal.example.com/logout',
      postLogoutRedirectUris: ['https://portal.example.com/logout']
    },
    ...overrides
  }
}

function mockSuccessfulLoads(applications = [applicationFixture()]) {
  requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
    if (url.includes('/users')) return { items: [{ id: 'usr_1' }, { id: 'usr_2' }] }
    if (url.includes('/roles')) return { items: [{ roleName: 'admin' }] }
    if (url.includes('/scopes')) return { items: [{ scopeName: 'openid', protocol: 'openid-connect', isDefault: true, isOptional: false, includeInTokenScope: true, assignedClientIds: ['console-web'] }] }
    if (url.includes('/clients')) return { items: [{ clientId: 'console-web', protocol: 'openid-connect', accessType: 'public', enabled: true, state: 'active', redirectUris: ['https://console.example.com/callback'], defaultScopes: ['openid'], optionalScopes: ['profile'] }] }
    if (url.includes('/applications?limit=100')) return { items: applications }
    return { status: 'accepted' }
  })
}

describe('ConsoleAuthPage', () => {
  beforeEach(() => {
    useConsoleContextMock.mockReturnValue(baseContext as never)
    requestConsoleSessionJsonMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('muestra un estado vacío cuando no hay tenant activo', () => {
    useConsoleContextMock.mockReturnValue({ activeTenant: null, activeWorkspace: null } as never)
    renderPage()
    expect(screen.getByRole('heading', { name: /gestión auth\/iam/i })).toBeInTheDocument()
    expect(screen.getByText(/selecciona un tenant para inspeccionar auth\/iam/i)).toBeInTheDocument()
  })

  it('crea una aplicación y refresca el inventario', async () => {
    mockSuccessfulLoads([])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /crear aplicación externa/i }))
    await user.type(screen.getByLabelText(/display name/i), 'Partner Portal')
    await user.type(screen.getByLabelText(/^slug$/i), 'partner-portal')
    await user.selectOptions(screen.getByLabelText(/protocol/i), 'saml')
    await user.type(screen.getByLabelText(/redirect uris/i), 'https://partner.example.com/callback')
    await user.type(screen.getByLabelText(/logout url/i), 'https://partner.example.com/logout')
    await user.type(screen.getByLabelText(/scopes/i), 'openid, profile')
    await user.click(screen.getByLabelText(/saml sp initiated/i))
    await user.click(screen.getByRole('button', { name: /crear aplicación$/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/workspaces/wrk_alpha/applications',
        expect.objectContaining({
          method: 'POST',
          idempotent: true,
          body: expect.objectContaining({
            entityType: 'external_application',
            displayName: 'Partner Portal',
            slug: 'partner-portal',
            protocol: 'saml',
            desiredState: 'active'
          })
        })
      )
    })

    expect(await screen.findByText(/aplicación creada\. refrescando inventario/i)).toBeInTheDocument()
  })

  it('valida nombre, slug y redirect uri al crear', async () => {
    mockSuccessfulLoads([])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /crear aplicación externa/i }))
    await user.type(screen.getByLabelText(/^slug$/i), 'slug-inválido')
    await user.type(screen.getByLabelText(/redirect uris/i), 'nota-url')
    await user.click(screen.getByRole('button', { name: /crear aplicación$/i }))

    expect(await screen.findByText(/el nombre es obligatorio/i)).toBeInTheDocument()
    expect(screen.getByText(/el slug debe usar minúsculas, números y guiones/i)).toBeInTheDocument()
    expect(screen.getByText(/todas las redirect uri deben ser válidas/i)).toBeInTheDocument()
    expect(requestConsoleSessionJsonMock).not.toHaveBeenCalledWith('/v1/workspaces/wrk_alpha/applications', expect.anything())
  })

  it('edita una aplicación existente', async () => {
    mockSuccessfulLoads([applicationFixture()])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /editar/i }))
    const nameInput = screen.getByLabelText(/display name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Portal B2B')
    const redirects = screen.getByLabelText(/redirect uris/i)
    await user.clear(redirects)
    await user.type(redirects, 'https://b2b.example.com/callback')
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/workspaces/wrk_alpha/applications/app_alpha',
        expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ displayName: 'Portal B2B' }) })
      )
    })
  })

  it('elimina lógicamente una aplicación con confirmación', async () => {
    mockSuccessfulLoads([applicationFixture()])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /eliminar/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/portal clientes/i)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/soft_deleted/i)
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/workspaces/wrk_alpha/applications/app_alpha',
        expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ desiredState: 'soft_deleted' }) })
      )
    })
  })

  it('añade un provider federado', async () => {
    mockSuccessfulLoads([applicationFixture({ federatedProviders: [] })])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /providers/i }))
    await user.type(screen.getByLabelText(/provider id/i), 'new-idp')
    await user.type(screen.getByLabelText(/^alias$/i), 'Partner IDP')
    await user.type(screen.getAllByLabelText(/display name/i)[0], 'Partner Login')
    await user.type(screen.getByLabelText(/authorization url/i), 'https://partner-idp.example.com/auth')
    await user.type(screen.getByLabelText(/token url/i), 'https://partner-idp.example.com/token')
    await user.click(screen.getByRole('button', { name: /crear provider/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/workspaces/wrk_alpha/applications/app_alpha/federation/providers',
        expect.objectContaining({ method: 'POST', body: expect.objectContaining({ providerId: 'new-idp', alias: 'Partner IDP' }) })
      )
    })
  })

  it('actualiza el estado enabled de un provider existente', async () => {
    mockSuccessfulLoads([applicationFixture()])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /providers/i }))
    await user.click(screen.getByRole('button', { name: /deshabilitar/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/workspaces/wrk_alpha/applications/app_alpha/federation/providers/corp-oidc',
        expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ enabled: false }) })
      )
    })
  })

  it('desasocia un provider mediante update de la aplicación', async () => {
    mockSuccessfulLoads([applicationFixture()])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /providers/i }))
    await user.click(screen.getByRole('button', { name: /desasociar/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/corp oidc/i)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/dejará de estar asociado a la aplicación actual/i)
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/workspaces/wrk_alpha/applications/app_alpha',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({ federatedProviders: [] })
        })
      )
    })
  })

  it('bloquea escritura sin workspace activo', async () => {
    useConsoleContextMock.mockReturnValue({ ...baseContext, activeWorkspace: null } as never)
    mockSuccessfulLoads([])
    renderPage()

    expect(await screen.findByText(/selecciona un workspace para operar aplicaciones externas y providers/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /crear aplicación externa/i })).toBeDisabled()
  })

  it('descarta formularios abiertos al cambiar de contexto', async () => {
    mockSuccessfulLoads([])
    const user = userEvent.setup()
    const { rerender } = renderPage()

    await user.click(await screen.findByRole('button', { name: /crear aplicación externa/i }))
    expect(screen.getByRole('button', { name: /crear aplicación$/i })).toBeInTheDocument()

    useConsoleContextMock.mockReturnValue({
      activeTenant: { tenantId: 'ten_beta', label: 'Tenant Beta', consoleUserRealm: 'realm-beta' },
      activeWorkspace: { workspaceId: 'wrk_beta', label: 'Workspace Beta' }
    } as never)
    rerender(
      <MemoryRouter>
        <ConsoleAuthPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /crear aplicación$/i })).not.toBeInTheDocument()
    })
  })

  it('renderiza el mensaje de error de API', async () => {
    requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
      if (url.includes('/users')) return { items: [] }
      if (url.includes('/roles')) return { items: [] }
      if (url.includes('/scopes')) return { items: [] }
      if (url.includes('/clients')) return { items: [] }
      if (url.includes('/applications?limit=100')) return { items: [applicationFixture()] }
      throw new Error('No autorizado por política del workspace')
    })

    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /editar/i }))
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText(/no autorizado por política del workspace/i)).toBeInTheDocument()
  })

  it('muestra snippets IAM para el client seleccionado sin filtrar secretos reales', async () => {
    mockSuccessfulLoads([])
    const user = userEvent.setup()

    renderPage()
    await user.click((await screen.findAllByText('console-web'))[0]!)

    expect(await screen.findByRole('heading', { name: 'Snippets de conexión' })).toBeInTheDocument()
    expect(screen.getByText(/client_secret=<CLIENT_SECRET>/)).toBeInTheDocument()
    expect(screen.queryByText(/super-secret/i)).not.toBeInTheDocument()
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ConsoleAuthPage />
    </MemoryRouter>
  )
}
