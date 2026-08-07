/**
 * bbx-933-console-02..05 | fn-knative-runtime-status, fn-mcp-hosted-runtime
 * OpenSpec scenarios:
 * - #### Scenario: Disabled mode is deliberate
 * - #### Scenario: External canary is absent or unreadable
 * - #### Scenario: A failed stage is not a successful install
 * - #### Scenario: Developer receives actionable availability status
 * - #### Scenario: Degraded audit read remains available
 */
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, matchRoutes, MemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleShellLayout } from '../../../apps/web-console/src/layouts/ConsoleShellLayout'
import { McpServerPlayground } from '../../../apps/web-console/src/components/console/mcp/McpServerPlayground'
import { clearConsoleShellSession, persistConsoleShellSession } from '../../../apps/web-console/src/lib/console-session'
import { toMcpServerDetailViewModel } from '../../../apps/web-console/src/lib/mcp/mcp-server-detail'
import { ConsoleRuntimePage } from '../../../apps/web-console/src/pages/ConsoleRuntimePage'
import { appRoutes } from '../../../apps/web-console/src/router'
import type { KnativeRuntimeStatus } from '../../../apps/web-console/src/services/knativeRuntimeApi'
import type { ConsoleLoginSession } from '../../../apps/web-console/src/lib/console-auth'

const runtimeApi = vi.hoisted(() => ({ getStatus: vi.fn() }))

vi.mock('../../../apps/web-console/src/services/knativeRuntimeApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/web-console/src/services/knativeRuntimeApi')>()
  return { ...original, getKnativeRuntimeStatus: runtimeApi.getStatus }
})

const session: ConsoleLoginSession = {
  sessionId: 'console-session-ui-933',
  authenticationState: 'active',
  statusView: 'active',
  issuedAt: '2026-08-07T09:00:00.000Z',
  lastActivityAt: '2026-08-07T09:00:00.000Z',
  expiresAt: '2099-08-07T10:00:00.000Z',
  idleExpiresAt: '2099-08-07T10:00:00.000Z',
  refreshExpiresAt: '2099-08-08T09:00:00.000Z',
  sessionPolicy: {},
  principal: {
    displayName: 'Platform auditor',
    primaryEmail: 'auditor@example.test',
    state: 'active',
    userId: 'usr-platform-auditor',
    username: 'platform-auditor',
    platformRoles: ['platform_auditor']
  },
  tokenSet: {
    accessToken: 'console-ui-access-token-933',
    expiresAt: '2099-08-07T10:00:00.000Z',
    expiresIn: 3600,
    refreshExpiresAt: '2099-08-08T09:00:00.000Z',
    refreshExpiresIn: 90_000,
    refreshToken: 'console-ui-refresh-token-933',
    scope: 'openid profile',
    tokenType: 'Bearer'
  }
}

const status = (state: KnativeRuntimeStatus['state']): KnativeRuntimeStatus => ({
  mode: state === 'disabled' ? 'disabled' : state === 'unverified' ? 'external' : 'managed',
  owner: state === 'unverified' ? 'customer-platform' : 'falcone',
  version: state === 'disabled' ? null : '1.22.1',
  compatibility: state === 'ready' || state === 'degraded' ? 'compatible' : 'unverified',
  state,
  stage: state === 'ready' ? 'ready' : state === 'disabled' ? 'disabled' : state === 'unverified' ? 'external_validation' : 'serving',
  reason: state === 'ready' ? 'READY' : state === 'disabled' ? 'RUNTIME_DISABLED' : state === 'unverified' ? 'CANARY_UNVERIFIED' : state === 'degraded' ? 'CONTROL_PLANE_NOT_READY' : 'SERVING_UNAVAILABLE',
  lastTransitionAt: '2026-08-07T09:05:00.000Z'
})

beforeEach(() => {
  clearConsoleShellSession()
  persistConsoleShellSession(session)
  runtimeApi.getStatus.mockReset()
  document.title = 'Consola In Falcone'
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [], page: { after: null } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderRuntimePage(runtimeStatus: KnativeRuntimeStatus) {
  runtimeApi.getStatus.mockResolvedValue(runtimeStatus)
  return render(<MemoryRouter><ConsoleRuntimePage /></MemoryRouter>)
}

describe('issue #933 runtime console route', () => {
  it('bbx-933-console-02 exposes a titled, single-main route in keyboard navigation and links only to served destinations', async () => {
    runtimeApi.getStatus.mockResolvedValue(status('ready'))
    const router = createMemoryRouter([
      {
        path: '/console',
        element: <ConsoleShellLayout />,
        children: [{
          path: 'runtime',
          element: <ConsoleRuntimePage />,
          handle: { platformGlobal: true, title: 'Runtime de funciones · Consola In Falcone' }
        }]
      }
    ], { initialEntries: ['/console/runtime'] })

    render(<RouterProvider router={router} />)
    await screen.findByRole('heading', { name: 'Runtime de funciones' })

    expect(document.title).toBe('Runtime de funciones · Consola In Falcone')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const runtimeNav = screen.getByRole('link', { name: /runtime de funciones/i })
    expect(runtimeNav).toHaveAttribute('href', '/console/runtime')

    const hostedMcpCta = screen.getByRole('link', { name: 'Inspeccionar Hosted MCP' })
    const matches = matchRoutes(appRoutes, hostedMcpCta.getAttribute('href') ?? '')
    expect(matches?.at(-1)?.route.path).not.toBe('*')
  })

  it.each([
    ['disabled', 'Deshabilitado'],
    ['unverified', 'Sin verificar'],
    ['unavailable', 'No disponible'],
    ['degraded', 'Degradado'],
    ['ready', 'Disponible']
  ] as const)('bbx-933-console-03 presents %s as a distinct human dependency state', async (state, label) => {
    renderRuntimePage(status(state))
    await screen.findByRole('heading', { name: 'Runtime de funciones' })

    const capabilities = screen.getByRole('region', { name: 'Capacidades dependientes del runtime' })
    const functionCard = within(capabilities).getByRole('heading', { name: 'Funciones' }).closest('article')
    const mcpCard = within(capabilities).getByRole('heading', { name: 'Hosted MCP' }).closest('article')
    expect(functionCard).toHaveTextContent(label)
    expect(mcpCard).toHaveTextContent(label)

    expect(screen.queryByText(status(state).reason)).not.toBeInTheDocument()
    if (state !== 'ready') {
      expect(screen.getByRole('button', { name: /volver a comprobar/i })).toBeEnabled()
      expect(screen.getByText(/las operaciones dependientes/i)).toBeInTheDocument()
    }
  })

  it('bbx-933-console-04 restores retry focus and announces one deterministic completion', async () => {
    runtimeApi.getStatus
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(status('ready'))
    render(<MemoryRouter><ConsoleRuntimePage /></MemoryRouter>)

    const retry = await screen.findByRole('button', { name: 'Reintentar' })
    retry.focus()
    expect(retry).toHaveFocus()
    await userEvent.click(retry)

    const recheck = await screen.findByRole('button', { name: /volver a comprobar/i })
    await waitFor(() => expect(recheck).toHaveFocus())
    const announcements = screen.getAllByRole('status')
    expect(announcements).toHaveLength(1)
    expect(announcements[0]).toHaveTextContent(/estado actualizado.*listo/i)
  })
})

describe('issue #933 hosted MCP runtime readiness', () => {
  it('bbx-933-console-05 retains dependency readiness and blocks hosted invocation while runtimeReady is false', async () => {
    const view = toMcpServerDetailViewModel({
      id: 'srv-orders',
      name: 'Orders MCP',
      endpoint: '/v1/mcp/workspaces/ws-a/servers/srv-orders/rpc',
      status: 'active',
      runtimeDependency: { state: 'unavailable', reason: 'SERVING_UNAVAILABLE' },
      runtimeReady: false,
      tools: [{ name: 'orders.list', description: 'List orders' }]
    } as Parameters<typeof toMcpServerDetailViewModel>[0] & Record<string, unknown>) as ReturnType<typeof toMcpServerDetailViewModel> & {
      runtimeDependency?: { state: string; reason: string }
      runtimeReady?: boolean
    }

    expect(view.runtimeReady).toBe(false)
    expect(view.runtimeDependency).toEqual({ state: 'unavailable', reason: 'SERVING_UNAVAILABLE' })

    render(createElement(McpServerPlayground as ComponentType<Record<string, unknown>>, {
      workspaceId: 'ws-a',
      serverId: 'srv-orders',
      tools: view.tools,
      endpoint: view.endpoint,
      runtimeReady: view.runtimeReady,
      runtimeDependency: view.runtimeDependency
    }))

    expect(screen.getByRole('button', { name: /invocar/i })).toBeDisabled()
    expect(screen.getByText(/runtime.*no disponible/i)).toBeInTheDocument()
  })
})
