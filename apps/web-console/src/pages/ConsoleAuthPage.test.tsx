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

describe('ConsoleAuthPage', () => {
  beforeEach(() => {
    useConsoleContextMock.mockReturnValue({
      activeTenant: null,
      activeWorkspace: null
    } as never)
    requestConsoleSessionJsonMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('muestra un estado vacío cuando no hay tenant activo', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: /gestión auth\/iam/i })).toBeInTheDocument()
    expect(screen.getByText(/selecciona un tenant para inspeccionar auth\/iam/i)).toBeInTheDocument()
  })

  it('muestra un estado vacío cuando el tenant no expone consoleUserRealm', () => {
    useConsoleContextMock.mockReturnValue({
      activeTenant: {
        tenantId: 'ten_alpha',
        label: 'Tenant Alpha',
        consoleUserRealm: null
      },
      activeWorkspace: null
    } as never)

    renderPage()

    expect(screen.getByText(/este tenant no tiene un realm iam de consola configurado/i)).toBeInTheDocument()
  })

  it('renderiza el resumen del realm, scopes, clients, aplicaciones y providers', async () => {
    useConsoleContextMock.mockReturnValue({
      activeTenant: {
        tenantId: 'ten_alpha',
        label: 'Tenant Alpha',
        consoleUserRealm: 'realm-alpha'
      },
      activeWorkspace: {
        workspaceId: 'wrk_alpha',
        label: 'Workspace Alpha'
      }
    } as never)

    requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
      if (url.includes('/users')) {
        return { items: [{ id: 'usr_1' }, { id: 'usr_2' }], compatibility: { provider: 'keycloak', contractVersion: '2026-03-26', supportedVersions: ['26'], adminApiStability: 'stable_v1' } }
      }
      if (url.includes('/roles')) {
        return { items: [{ roleName: 'admin' }, { roleName: 'viewer' }] }
      }
      if (url.includes('/scopes')) {
        return {
          items: [
            {
              scopeName: 'openid',
              protocol: 'openid-connect',
              isDefault: true,
              isOptional: false,
              includeInTokenScope: true,
              assignedClientIds: ['console-web']
            }
          ]
        }
      }
      if (url.includes('/clients')) {
        return {
          items: [
            {
              clientId: 'console-web',
              protocol: 'openid-connect',
              accessType: 'public',
              enabled: true,
              state: 'active',
              redirectUris: ['https://console.example.com/callback'],
              defaultScopes: ['openid'],
              optionalScopes: ['profile']
            }
          ]
        }
      }
      if (url.includes('/applications')) {
        return {
          items: [
            {
              applicationId: 'app_alpha',
              displayName: 'Portal Clientes',
              slug: 'portal-clientes',
              protocol: 'oidc',
              state: 'active',
              authenticationFlows: ['oidc_authorization_code_pkce'],
              redirectUris: ['https://portal.example.com/callback'],
              scopes: [{ scopeName: 'profile' }],
              validation: { status: 'valid', checks: [] },
              federatedProviders: [
                {
                  providerId: 'google',
                  alias: 'google-workforce',
                  displayName: 'Google Workforce',
                  protocol: 'oidc',
                  providerMode: 'metadata_url',
                  enabled: true
                }
              ]
            }
          ]
        }
      }
      throw new Error(`unexpected url: ${url}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('auth-summary-users')).toHaveTextContent('2')
      expect(screen.getByTestId('auth-summary-roles')).toHaveTextContent('2')
      expect(screen.getByTestId('auth-summary-scopes')).toHaveTextContent('1')
      expect(screen.getByTestId('auth-summary-clients')).toHaveTextContent('1')
    })

    expect(screen.getByRole('link', { name: /abrir members/i })).toHaveAttribute('href', '/console/members')
    expect(screen.getAllByText('openid').length).toBeGreaterThan(0)
    expect(screen.getAllByText('console-web').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Portal Clientes').length).toBeGreaterThan(0)
    expect(screen.getByText('google-workforce')).toBeInTheDocument()
  })

  it('muestra el estado contextual cuando no hay workspace activo', async () => {
    useConsoleContextMock.mockReturnValue({
      activeTenant: {
        tenantId: 'ten_alpha',
        label: 'Tenant Alpha',
        consoleUserRealm: 'realm-alpha'
      },
      activeWorkspace: null
    } as never)

    requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
      if (url.includes('/users')) return { items: [] }
      if (url.includes('/roles')) return { items: [] }
      if (url.includes('/scopes')) return { items: [] }
      if (url.includes('/clients')) return { items: [] }
      throw new Error(`unexpected url: ${url}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('auth-summary-users')).toBeInTheDocument()
    })

    expect(screen.getByText(/selecciona un workspace para ver aplicaciones externas y providers/i)).toBeInTheDocument()
  })

  it('muestra error y permite reintentar la carga del realm', async () => {
    useConsoleContextMock.mockReturnValue({
      activeTenant: {
        tenantId: 'ten_alpha',
        label: 'Tenant Alpha',
        consoleUserRealm: 'realm-alpha'
      },
      activeWorkspace: null
    } as never)

    let shouldFail = true
    requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
      if (url.includes('/users') && shouldFail) {
        shouldFail = false
        throw new Error('IAM temporalmente no disponible')
      }
      if (url.includes('/users')) return { items: [{ id: 'usr_1' }] }
      if (url.includes('/roles')) return { items: [{ roleName: 'admin' }] }
      if (url.includes('/scopes')) return { items: [] }
      if (url.includes('/clients')) return { items: [] }
      throw new Error(`unexpected url: ${url}`)
    })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/iam temporalmente no disponible/i)

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    await waitFor(() => {
      expect(screen.getByTestId('auth-summary-users')).toHaveTextContent('1')
      expect(screen.getByTestId('auth-summary-roles')).toHaveTextContent('1')
    })
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ConsoleAuthPage />
    </MemoryRouter>
  )
}
