import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { RouterProvider, createMemoryRouter, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleShellLayout } from './ConsoleShellLayout'

import { useConsoleContext } from '@/lib/console-context'
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

    expect(await screen.findByRole('link', { name: /consola in falcone/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /vista general/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /flujos \/ workflows/i })).toHaveAttribute('href', '/console/flows')
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

  it('[#744][Scenario: Tenant owner views any authenticated page] no renderiza IDs de seguimiento interno ni copy de estado de desarrollo en el chrome', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    await screen.findByRole('link', { name: /consola in falcone/i })

    const shellText = document.body.textContent ?? ''
    expect(shellText).not.toMatch(/EP-\d+/)
    expect(shellText).not.toMatch(/US-UI/)
    expect(shellText).not.toMatch(/iteración posterior/i)
    expect(shellText).not.toMatch(/\bT02\b/)
    expect(screen.getByText(/panel de administración multi-organización/i)).toBeInTheDocument()
  })

  it('[#745][Scenario: Deep route and keyboard access] renderiza skip-link y breadcrumb del shell en rutas profundas', async () => {
    stubShellApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')],
        ten_beta: [createWorkspace('wrk_beta', 'ten_beta', 'Workspace Beta')]
      }
    })
    persistConsoleShellSession(
      createSessionWithRoles(['tenant_owner'], {
        tenantIds: ['ten_alpha', 'ten_beta'],
        workspaceIds: ['wrk_alpha', 'wrk_beta']
      })
    )
    const user = userEvent.setup()

    renderShell('/console/workspaces/wrk_beta')

    expect(await screen.findByRole('heading', { name: /workspace route probe/i })).toBeInTheDocument()
    const skipLink = screen.getByRole('link', { name: /saltar al contenido principal/i })
    expect(skipLink).toHaveAttribute('href', '#console-main-content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'console-main-content')
    expect(screen.getAllByRole('main')).toHaveLength(1)

    await user.click(skipLink)

    expect(screen.getByRole('main')).toHaveFocus()

    const breadcrumbs = screen.getByTestId('console-shell-breadcrumbs')
    expect(within(breadcrumbs).getByRole('link', { name: /^consola$/i })).toHaveAttribute('href', '/console/overview')
    expect(within(breadcrumbs).getByRole('link', { name: /gestión de áreas de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
    expect(within(breadcrumbs).getByText(/área wrk_beta/i)).toHaveAttribute('aria-current', 'page')
  })

  it('[#745][Scenario: Narrow viewport] abre un drawer con navegación y selectores de contexto alcanzables', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    const drawerTrigger = await screen.findByRole('button', { name: /abrir navegación y contexto/i })
    await user.click(drawerTrigger)

    const drawer = screen.getByRole('dialog', { name: /navegación y contexto/i })
    await waitFor(() => {
      expect(drawer).toHaveFocus()
    })
    expect(within(drawer).getByRole('navigation', { name: /navegación principal de consola/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(within(drawer).getByTestId('console-drawer-context-tenant-select')).toHaveValue('ten_alpha')
      expect(within(drawer).getByTestId('console-drawer-context-workspace-select')).toHaveValue('wrk_alpha')
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /navegación y contexto/i })).not.toBeInTheDocument()
    })
    expect(drawerTrigger).toHaveFocus()

    await user.click(drawerTrigger)
    const reopenedDrawer = screen.getByRole('dialog', { name: /navegación y contexto/i })

    await user.click(within(reopenedDrawer).getByRole('link', { name: /^postgresql/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /navegación y contexto/i })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('heading', { name: /postgresql/i })).toBeInTheDocument()
  })

  it('[#745][Scenario: Responsive breakpoints] evita solapar sidebar y drawer entre lg y xl', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('button', { name: /abrir navegación y contexto/i })).toHaveClass('xl:hidden')
    expect(screen.getByTestId('console-shell-sidebar')).toHaveClass('xl:block')
    expect(screen.getByTestId('console-shell-sidebar')).not.toHaveClass('lg:block')
    expect(screen.getByTestId('console-shell-mobile-hint')).toHaveClass('xl:hidden')
  })

  it('[#752][fn-console-context-panel][Scenario: context cards suppressed on platform-global routes] oculta el panel de contexto en una ruta global de plataforma (plans)', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/plans')

    expect(await screen.findByRole('heading', { name: /planes/i })).toBeInTheDocument()
    expect(screen.queryByTestId('console-context-status-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-context-tenant-status')).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-context-workspace-status')).not.toBeInTheDocument()
  })

  it('[#752][fn-console-context-panel][Scenario: context cards present on tenant-scoped routes] mantiene el panel de contexto en una ruta con alcance de organización (overview)', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByTestId('console-context-status-panel')).toBeInTheDocument()
    expect(screen.getByTestId('console-context-tenant-status')).toBeInTheDocument()
    expect(screen.getByTestId('console-context-workspace-status')).toBeInTheDocument()
  })

  it('abre el dropdown y lo cierra con escape', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /perfil/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /ajustes/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /cerrar sesión/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('navega a perfil desde el menú de usuario', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))
    await user.click(screen.getByRole('menuitem', { name: /perfil/i }))

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
      'in-falcone.console-active-context',
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

  it('[#738] restaura tenant y workspace desde /console/workspaces/:workspaceId en una sesión fresca', async () => {
    stubShellApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')],
        ten_beta: [createWorkspace('wrk_beta', 'ten_beta', 'Workspace Beta')]
      }
    })
    persistConsoleShellSession(
      createSessionWithRoles(['tenant_owner'], {
        tenantIds: ['ten_alpha', 'ten_beta'],
        workspaceIds: ['wrk_alpha', 'wrk_beta']
      })
    )

    renderShell('/console/workspaces/wrk_beta')

    expect(await screen.findByRole('heading', { name: /workspace route probe/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_beta')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_beta')
      expect(screen.getByTestId('console-context-workspace-status')).toHaveTextContent(/workspace beta/i)
      expect(screen.getByTestId('workspace-route-active-tenant')).toHaveTextContent('ten_beta')
      expect(screen.getByTestId('workspace-route-active-workspace')).toHaveTextContent('wrk_beta')
      expect(screen.getByTestId('workspace-route-data-state')).toHaveTextContent('loaded:wrk_beta')
    })

    expect(screen.queryByText(/sin área de trabajo seleccionada/i)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('in-falcone.console-active-context')).toContain('"workspaceId":"wrk_beta"')
  })

  it('[#738] no usa un workspace persistido no relacionado cuando el workspace de la ruta no es accesible', async () => {
    stubShellApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')],
        ten_beta: [createWorkspace('wrk_beta', 'ten_beta', 'Workspace Beta')]
      }
    })
    window.localStorage.setItem(
      'in-falcone.console-active-context',
      JSON.stringify({
        userId: 'usr_abc123',
        tenantId: 'ten_alpha',
        workspaceId: 'wrk_alpha',
        updatedAt: '2026-03-28T18:05:00.000Z'
      })
    )
    persistConsoleShellSession(
      createSessionWithRoles(['tenant_owner'], {
        tenantIds: ['ten_alpha', 'ten_beta'],
        workspaceIds: ['wrk_alpha', 'wrk_beta']
      })
    )

    renderShell('/console/workspaces/wrk_forbidden')

    expect(await screen.findByRole('heading', { name: /workspace route probe/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('workspace-route-param')).toHaveTextContent('wrk_forbidden')
      expect(screen.getByTestId('workspace-route-active-workspace')).toHaveTextContent('none')
      expect(screen.getByTestId('workspace-route-data-state')).toHaveTextContent('no-workspace')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('')
    })

    expect(screen.getByTestId('console-context-workspace-status')).toHaveTextContent(/sin área de trabajo seleccionada/i)
    expect(screen.getByTestId('console-context-workspace-status')).not.toHaveTextContent(/workspace alpha/i)
  })

  // #742 (Scenario 1 + Scenario 3): the "no active workspace" card gives a real first action
  // instead of the previously-static "Selecciona un área de trabajo para completar el contexto
  // operativo." sentence with zero buttons/links/inputs.
  it('[#742] muestra un CTA para crear la primera área de trabajo cuando la organización activa no tiene ninguna', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: { ten_alpha: [] }
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
    })

    const workspaceCard = screen.getByTestId('console-context-workspace-status')
    const createLink = within(workspaceCard).getByRole('link', { name: /crear área de trabajo/i })
    expect(createLink).toHaveAttribute('href', '/console/workspaces')
  })

  it('[#742] muestra un selector de área de trabajo en línea cuando la organización activa tiene varias y ninguna está activa, y activa la elegida', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [
          createWorkspace('wrk_1', 'ten_alpha', 'Workspace Uno'),
          createWorkspace('wrk_2', 'ten_alpha', 'Workspace Dos')
        ]
      }
    })
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      // Two workspaces and no persisted selection: no auto-fallback (that only applies when
      // there is exactly one), so the context switch-workspace select stays unset…
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('')
    })

    const workspaceCard = screen.getByTestId('console-context-workspace-status')
    const picker = within(workspaceCard).getByRole('combobox', { name: /seleccionar área de trabajo/i })
    await user.selectOptions(picker, 'wrk_2')

    await waitFor(() => {
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_2')
      expect(screen.getByTestId('console-context-workspace-status')).toHaveTextContent(/workspace dos/i)
    })
  })

  it('muestra estado vacío cuando no hay tenants accesibles', async () => {
    stubShellApi({ tenants: [] })
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByText(/no tiene organizaciones accesibles/i)).toBeInTheDocument()
    expect(screen.getByTestId('console-context-tenant-select')).toBeDisabled()
    expect(screen.getByTestId('console-context-workspace-select')).toBeDisabled()
  })

  it('renderiza el ítem Miembros y apunta a /console/members', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    const membersLink = await screen.findByRole('link', { name: /miembros/i })
    expect(membersLink).toHaveAttribute('href', '/console/members')
  })

  it('[#782] renderiza el ítem "Autenticación de la organización" y apunta a /console/auth-config (plano, no gateado a superadmin)', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    const authConfigLink = await screen.findByRole('link', { name: /autenticación de la organización/i })
    expect(authConfigLink).toHaveAttribute('href', '/console/auth-config')
  })

  it('[#740] oculta Auth e IAM Access en la navegación para tenant_owner', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /vista general/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^acceso iam/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^autenticación(?! de la organización)/i })).not.toBeInTheDocument()
  })

  it('[#740] mantiene Auth e IAM Access visibles para superadmin', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['superadmin']))

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /^acceso iam/i })).toHaveAttribute('href', '/console/iam-access')
    expect(await screen.findByRole('link', { name: /^autenticación(?! de la organización)/i })).toHaveAttribute('href', '/console/auth')
  })

  it('renderiza el ítem PostgreSQL en el sidebar', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /^postgresql/i })).toBeInTheDocument()
  })

  it('apunta el ítem PostgreSQL a /console/postgres', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /^postgresql/i })).toHaveAttribute('href', '/console/postgres')
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

  it('[#797] agrupa y etiqueta las superficies de funciones por propósito', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/functions')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    expect(within(navigation).getByText('Funciones')).toBeInTheDocument()
    expect(within(navigation).getByText('Plano de datos')).toBeInTheDocument()

    expect(within(navigation).getByRole('link', { name: /^funciones: registro/i })).toHaveAttribute('href', '/console/functions-registry')
    expect(within(navigation).getByRole('link', { name: /^funciones: administrar/i })).toHaveAttribute('href', '/console/functions')
    expect(within(navigation).getByRole('link', { name: /^funciones: despliegue rápido/i })).toHaveAttribute('href', '/console/functions/data')
    expect(within(navigation).getByRole('link', { name: /^datos: postgres/i })).toHaveAttribute('href', '/console/postgres/data')

    expect(within(navigation).queryByRole('link', { name: /^datos: funciones/i })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: /^funciones$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Funciones: administrar' })).toBeInTheDocument()
  })

  it('[#797] marca solo el destino de despliegue rápido como activo en /console/functions/data', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/functions/data')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    const adminLink = within(navigation).getByRole('link', { name: /^funciones: administrar/i })
    const quickDeployLink = within(navigation).getByRole('link', { name: /^funciones: despliegue rápido/i })

    expect(adminLink).not.toHaveAttribute('aria-current', 'page')
    expect(quickDeployLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Funciones: despliegue rápido' })).toBeInTheDocument()
  })

  it('muestra reintento cuando falla la carga de tenants y se recupera al reintentar', async () => {
    let tenantRequestCount = 0

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const parsedUrl = new URL(url, 'http://localhost')

      if (parsedUrl.pathname === '/v1/tenants') {
        tenantRequestCount += 1

        if (tenantRequestCount === 1) {
          return createJsonResponse(500, { message: 'Tenants degradados' })
        }
      }

      return createShellApiImplementation()(input)
    })
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    const retryButtons = await screen.findAllByRole('button', { name: /reintentar organizaciones/i })
    expect(retryButtons.length).toBeGreaterThan(0)
    expect(screen.getAllByText(/tenants degradados/i).length).toBeGreaterThan(0)

    await user.click(retryButtons[0])

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_alpha')
    })
  })

  it('[bbx-770-003][fn-console-shell-tenant-selector][Scenario: Re-selecting the already-active tenant] refetches workspaces when the visible tenant select fires after a workspace error', async () => {
    let workspaceRequestCount = 0
    const shellApi = createShellApiImplementation({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const parsedUrl = new URL(url, 'http://localhost')

      if (parsedUrl.pathname === '/v1/workspaces') {
        workspaceRequestCount += 1

        if (workspaceRequestCount === 1) {
          return createJsonResponse(500, { message: 'Workspaces degradados' })
        }
      }

      return shellApi(input)
    })
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('')
      expect(screen.getAllByText(/workspaces degradados/i).length).toBeGreaterThan(0)
    })

    const workspaceCallsBeforeReselect = workspaceRequestCount

    fireEvent.change(screen.getByTestId('console-context-tenant-select'), {
      target: { value: 'ten_alpha' }
    })

    await waitFor(() => {
      expect(workspaceRequestCount).toBeGreaterThan(workspaceCallsBeforeReselect)
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('wrk_alpha')
    })
  })

  it('[bbx-770-004][fn-console-shell-workspace-retry][Scenario: Cleared workspace list is recoverable] ofrece reintento cuando el tenant activo queda con la lista de workspaces vacía', async () => {
    let workspaceRequestCount = 0
    const shellApi = createShellApiImplementation({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: []
      }
    })

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const parsedUrl = new URL(url, 'http://localhost')

      if (parsedUrl.pathname === '/v1/workspaces') {
        workspaceRequestCount += 1
      }

      return shellApi(input)
    })
    vi.stubGlobal('fetch', fetchMock)
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await waitFor(() => {
      expect(screen.getByTestId('console-context-tenant-select')).toHaveValue('ten_alpha')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveValue('')
      expect(screen.getByTestId('console-context-workspace-select')).toHaveTextContent(/sin áreas de trabajo accesibles/i)
    })

    const retryButtons = screen.getAllByRole('button', { name: /reintentar áreas de trabajo/i })
    expect(retryButtons.length).toBeGreaterThan(0)

    const workspaceCallsBeforeRetry = workspaceRequestCount

    await user.click(retryButtons[0])

    await waitFor(() => {
      expect(workspaceRequestCount).toBeGreaterThan(workspaceCallsBeforeRetry)
    })
  })

  it('muestra un banner cuando el tenant activo está suspendido', async () => {
    stubShellApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { state: 'suspended' })]
    })
    persistConsoleShellSession(baseSession)

    renderShell('/console/functions')

    expect(await screen.findByRole('alert')).toHaveTextContent(/organización suspendido/i)
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/aprovisionamiento del área de trabajo incompleto/i)
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/cuotas agotadas en la organización activa/i)
  })

  it('renderiza los links nuevos de cuentas de servicio y cuotas en el sidebar', async () => {
    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /cuentas de servicio/i })).toHaveAttribute('href', '/console/service-accounts')
    expect(screen.getByRole('link', { name: /cuotas/i })).toHaveAttribute('href', '/console/quotas')
  })

  it('[#803] mantiene lang=es y chrome/navegación autenticada en español', async () => {
    const indexHtml = readFileSync('index.html', 'utf8')
    expect(indexHtml).toMatch(/<html\s+lang="es"/)

    stubShellApi()
    persistConsoleShellSession(baseSession)

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /consola in falcone/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /vista general/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /gestión de organizaciones/i })).toHaveAttribute('href', '/console/tenants')
    expect(screen.getByRole('link', { name: /gestión de áreas de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
    expect(screen.getByRole('link', { name: /observabilidad/i })).toHaveAttribute('href', '/console/observability')
    expect(screen.getByRole('link', { name: /cuentas de servicio/i })).toHaveAttribute('href', '/console/service-accounts')
    expect(screen.getByRole('link', { name: /cuotas/i })).toHaveAttribute('href', '/console/quotas')
    expect(screen.queryByRole('link', { name: /^overview\b/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^observability\b/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^service accounts\b/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^quotas\b/i })).not.toBeInTheDocument()
  })

  it('ejecuta logout, limpia storage y redirige a login', async () => {
    stubShellApi({ logoutStatus: 202 })
    persistConsoleShellSession(baseSession)
    const user = userEvent.setup()

    renderShell('/console/overview')

    await user.click(await screen.findByTestId('console-shell-avatar'))
    await user.click(screen.getByRole('menuitem', { name: /cerrar sesión/i }))

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

    expect(requestInit?.method).toBe('DELETE')
    expect(headers.get('Authorization')).toBe('Bearer access-token-1234567890')
    expect(headers.get('X-API-Version')).toBe('2026-03-26')
    expect(headers.get('Idempotency-Key')).toMatch(/^idem_/)
    // #667: logout must carry the session refresh token so the control plane can
    // revoke it at Keycloak and end the SSO session (otherwise logout is a no-op).
    expect(requestInit?.body).toBe(JSON.stringify({ refreshToken: 'refresh-token-1234567890' }))
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
            element: <h1>Vista general</h1>
          },
          {
            path: 'profile',
            element: <h1>Perfil</h1>
          },
          {
            path: 'settings',
            element: <h1>Ajustes</h1>
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
            path: 'workspaces/:workspaceId',
            element: <WorkspaceRouteProbe />
          },
          {
            path: 'members',
            element: <h1>Miembros</h1>
          },
          {
            path: 'postgres',
            element: <h1>PostgreSQL</h1>
          },
          {
            path: 'functions-registry',
            element: <h1>Funciones: registro</h1>
          },
          {
            path: 'functions',
            element: <h1>Funciones: administrar</h1>
          },
          {
            path: 'functions/data',
            element: <h1>Funciones: despliegue rápido</h1>
          },
          {
            path: 'storage',
            element: <h1>Almacenamiento</h1>
          },
          {
            path: 'observability',
            element: <h1>Observabilidad</h1>
          },
          {
            path: 'service-accounts',
            element: <h1>Cuentas de servicio</h1>
          },
          {
            path: 'quotas',
            element: <h1>Cuotas</h1>
          },
          {
            // Platform-global route probe (#752): mirrors router.tsx's `handle: { platformGlobal:
            // true }` on the real /console/plans* routes, without depending on router.tsx itself.
            path: 'plans',
            element: <h1>Planes</h1>,
            handle: { platformGlobal: true }
          },
          {
            path: 'my-plan',
            element: <h1>Mi plan</h1>
          },
          {
            path: 'my-plan/allocation',
            element: <h1>Resumen de asignación</h1>
          },
          {
            path: 'iam-access',
            element: <h1>Acceso IAM</h1>
          },
          {
            path: 'auth',
            element: <h1>Autenticación</h1>
          },
          {
            path: 'flows',
            element: <h1>Flujos</h1>
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

function WorkspaceRouteProbe() {
  const { workspaceId } = useParams()
  const { activeTenantId, activeWorkspaceId, activeWorkspace } = useConsoleContext()

  return (
    <section>
      <h1>Workspace route probe</h1>
      <p data-testid="workspace-route-param">{workspaceId ?? 'none'}</p>
      <p data-testid="workspace-route-active-tenant">{activeTenantId ?? 'none'}</p>
      <p data-testid="workspace-route-active-workspace">{activeWorkspaceId ?? 'none'}</p>
      <p data-testid="workspace-route-active-workspace-label">{activeWorkspace?.label ?? 'none'}</p>
      <p data-testid="workspace-route-data-state">{activeWorkspaceId && activeWorkspaceId === workspaceId ? `loaded:${activeWorkspaceId}` : 'no-workspace'}</p>
    </section>
  )
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

    if (parsedUrl.pathname.startsWith('/v1/tenants/')) {
      const tenantId = decodeURIComponent(parsedUrl.pathname.slice('/v1/tenants/'.length))
      const tenant = tenants.find((item) => item.tenantId === tenantId)
      return tenant
        ? createJsonResponse(200, { tenant })
        : createJsonResponse(404, { message: 'Tenant not found' })
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

function createSessionWithRoles(
  platformRoles: string[],
  principalOverrides: Partial<typeof baseSession.principal> & { tenantIds?: string[]; workspaceIds?: string[] } = {}
): typeof baseSession {
  return {
    ...baseSession,
    principal: {
      ...baseSession.principal,
      platformRoles,
      ...principalOverrides
    }
  }
}


it('[#741] renderiza el ítem Planes en el sidebar para superadmin', async () => {
  stubShellApi()
  persistConsoleShellSession(createSessionWithRoles(['superadmin']))
  renderShell('/console/overview')
  expect(await screen.findByRole('link', { name: /^planes/i })).toHaveAttribute('href', '/console/plans')
})

describe('[#741] navegación de consola consciente del rol', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    clearConsoleShellSession()
    window.localStorage.clear()
  })

  it('[Scenario: Tenant owner views the console nav] oculta Tenants/IAM Access/Plans/Auth y muestra Mi plan/Asignación/Flujos para tenant_owner sin roles de plataforma', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    await screen.findByRole('link', { name: /vista general/i })

    expect(screen.queryByRole('link', { name: /gestión de organizaciones/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^acceso iam/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^planes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^autenticación(?! de la organización)/i })).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: /^mi plan/i })).toHaveAttribute('href', '/console/my-plan')
    expect(screen.getByRole('link', { name: /^resumen de asignación/i })).toHaveAttribute('href', '/console/my-plan/allocation')
    expect(screen.getByRole('link', { name: /^flujos \/ workflows/i })).toHaveAttribute('href', '/console/flows')
    // [#782] unlike the superadmin-only "Autenticación" entry above, "Autenticación de la
    // organización" (realm auth-config) MUST stay visible to a tenant owner — that is the whole
    // point of the fix.
    expect(screen.getByRole('link', { name: /^autenticación de la organización/i })).toHaveAttribute('href', '/console/auth-config')
  })

  it('mantiene Tenants/IAM Access/Plans/Auth/Mi plan visibles para superadmin (sin regresión)', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['superadmin']))

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /gestión de organizaciones/i })).toHaveAttribute('href', '/console/tenants')
    expect(screen.getByRole('link', { name: /^acceso iam/i })).toHaveAttribute('href', '/console/iam-access')
    expect(screen.getByRole('link', { name: /^planes/i })).toHaveAttribute('href', '/console/plans')
    expect(screen.getByRole('link', { name: /^autenticación(?! de la organización)/i })).toHaveAttribute('href', '/console/auth')
    expect(screen.getByRole('link', { name: /^mi plan/i })).toHaveAttribute('href', '/console/my-plan')
    expect(screen.getByRole('link', { name: /^resumen de asignación/i })).toHaveAttribute('href', '/console/my-plan/allocation')
  })

  it('platform_operator ve Tenants (inventario de plataforma real) pero no las entradas exclusivas de superadmin', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['platform_operator']))

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /gestión de organizaciones/i })).toHaveAttribute('href', '/console/tenants')
    expect(screen.queryByRole('link', { name: /^acceso iam/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^planes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^autenticación(?! de la organización)/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^mi plan/i })).toHaveAttribute('href', '/console/my-plan')
  })

  it('platform_admin ve Tenants igual que platform_operator (mismo fork de plataforma), no las entradas de superadmin', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['platform_admin']))

    renderShell('/console/overview')

    expect(await screen.findByRole('link', { name: /gestión de organizaciones/i })).toHaveAttribute('href', '/console/tenants')
    expect(screen.queryByRole('link', { name: /^acceso iam/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^planes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^autenticación(?! de la organización)/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^mi plan/i })).toHaveAttribute('href', '/console/my-plan')
  })

  it('[Scenario: Active state on the plan parent route] marca solo "Mi plan" como página actual en /console/my-plan', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/my-plan')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    const planLink = within(navigation).getByRole('link', { name: /^mi plan/i })
    const allocationLink = within(navigation).getByRole('link', { name: /^resumen de asignación/i })

    expect(planLink).toHaveAttribute('aria-current', 'page')
    expect(allocationLink).not.toHaveAttribute('aria-current', 'page')
  })

  it('[Scenario: Active state on the allocation child route] marca solo "Resumen de asignación" como página actual en /console/my-plan/allocation', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/my-plan/allocation')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    const planLink = within(navigation).getByRole('link', { name: /^mi plan/i })
    const allocationLink = within(navigation).getByRole('link', { name: /^resumen de asignación/i })

    // Without exactActive on "Mi plan", the parent NavLink would also match the child route and
    // both entries would claim aria-current="page" — the child page must have exactly one current entry.
    expect(planLink).not.toHaveAttribute('aria-current', 'page')
    expect(allocationLink).toHaveAttribute('aria-current', 'page')
  })
})

describe('[#761] role badge in the chrome + observer-first nav grouping', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    clearConsoleShellSession()
    window.localStorage.clear()
  })

  it('shows an always-visible, humanized, amber role badge with a Lock cue for tenant_viewer', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_viewer'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    const badge = await screen.findByTestId('console-role-badge')
    expect(badge).toHaveTextContent('Viewer · solo lectura')
    expect(badge).toHaveAttribute('aria-label', expect.stringMatching(/viewer · solo lectura/i))
    expect(badge.querySelector('svg')).not.toBeNull()
    // Dark-root amber tone (the console never toggles `.dark`) sourced from the shared
    // READ_ONLY_AFFORDANCE_BADGE_TONE — pin it so the badge cannot regress to the dark-on-dark
    // `text-amber-700` base of the legacy pattern.
    expect(badge.className).toMatch(/\btext-amber-300\b/)
    expect(badge.className).not.toMatch(/amber-700/)
    expect(badge.className).not.toMatch(/dark:/)
  })

  it('shows the "Developer · solo lectura" badge for tenant_developer', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_developer'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    expect(await screen.findByTestId('console-role-badge')).toHaveTextContent('Developer · solo lectura')
  })

  it('shows a neutral, non-amber badge (no Lock icon) for a write-capable role (tenant_owner)', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    const badge = await screen.findByTestId('console-role-badge')
    expect(badge).toHaveTextContent('Propietario')
    expect(badge.querySelector('svg')).toBeNull()
    expect(badge.className).not.toMatch(/amber/)
  })

  it('the role badge is present regardless of viewport width (always in the non-collapsing identity zone)', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['superadmin']))

    renderShell('/console/overview')

    // No `hidden`/`md:block`/`xl:flex` classes gating visibility — only the label text collapses
    // to icon-only below `sm` via an inner `hidden sm:inline` span (#745's responsive dead-zone).
    const badge = await screen.findByTestId('console-role-badge')
    expect(badge.className).not.toMatch(/\bhidden\b/)
  })

  it('regroups write-only nav entries under "Administración (requiere permisos)" for tenant_viewer', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_viewer'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    const restrictedHeading = within(navigation).getByText('Administración (requiere permisos)')
    const restrictedSection = restrictedHeading.closest('section')
    expect(restrictedSection).not.toBeNull()

    // Purely write-only destinations move into the restricted group…
    expect(within(restrictedSection!).getByRole('link', { name: /gestión de áreas de trabajo/i })).toBeInTheDocument()
    expect(within(restrictedSection!).getByRole('link', { name: /^cuentas de servicio/i })).toBeInTheDocument()

    // …but the item is NOT hidden — it is still reachable, just regrouped (additive to #741).
    expect(within(navigation).getByRole('link', { name: /gestión de áreas de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
  })

  it('does NOT regroup nav entries for a write-capable role (tenant_owner) — no "Administración (requiere permisos)" heading', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    await within(navigation).findByRole('link', { name: /gestión de áreas de trabajo/i })
    expect(within(navigation).queryByText('Administración (requiere permisos)')).not.toBeInTheDocument()
  })

  it('[C-14] muestra "Auditoría de dominios de privilegio" para platform_admin', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['platform_admin']))

    renderShell('/console/overview')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    expect(within(navigation).getByRole('link', { name: /auditoría de dominios de privilegio/i })).toHaveAttribute(
      'href',
      '/console/privilege-domain-audit'
    )
  })

  it('[C-14] muestra "Auditoría de dominios de privilegio" para tenant_owner', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    expect(within(navigation).getByRole('link', { name: /auditoría de dominios de privilegio/i })).toHaveAttribute(
      'href',
      '/console/privilege-domain-audit'
    )
  })

  it('[C-14] oculta "Auditoría de dominios de privilegio" para superadmin (sin ampliación de rol)', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['superadmin']))

    renderShell('/console/overview')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    await within(navigation).findByRole('link', { name: /vista general/i })
    expect(within(navigation).queryByRole('link', { name: /auditoría de dominios de privilegio/i })).not.toBeInTheDocument()
  })

  it('[C-14] oculta "Auditoría de dominios de privilegio" para un rol de solo lectura (tenant_viewer)', async () => {
    stubShellApi()
    persistConsoleShellSession(createSessionWithRoles(['tenant_viewer'], { tenantIds: ['ten_alpha'] }))

    renderShell('/console/overview')

    const navigation = await screen.findByRole('navigation', { name: /navegación principal de consola/i })
    await within(navigation).findByRole('link', { name: /vista general/i })
    expect(within(navigation).queryByRole('link', { name: /auditoría de dominios de privilegio/i })).not.toBeInTheDocument()
  })
})
