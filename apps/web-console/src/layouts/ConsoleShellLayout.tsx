import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Activity,
  ChevronDown,
  Database,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Users,
  Settings,
  Shield,
  User,
  Workflow
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ActiveOperationsIndicator } from '@/components/console/ActiveOperationsIndicator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { terminateConsoleLoginSession } from '@/lib/console-auth'
import {
  ConsoleContextProvider,
  formatConsoleEnumLabel,
  getConsoleTenantStatusMeta,
  getConsoleWorkspaceStatusMeta,
  useConsoleContext
} from '@/lib/console-context'
import {
  clearConsoleShellSession,
  getConsolePrincipalInitials,
  getConsolePrincipalLabel,
  getConsolePrincipalSecondary,
  readConsoleShellSession
} from '@/lib/console-session'
import { cn } from '@/lib/utils'

const consoleNavigationItems = [
  {
    label: 'Overview',
    to: '/console/overview',
    icon: LayoutDashboard,
    description: 'Punto de entrada para la consola administrativa y su estado general.'
  },
  {
    label: 'Tenants',
    to: '/console/tenants',
    icon: Shield,
    description: 'Acceso base al dominio multi-tenant y su navegación principal.'
  },
  {
    label: 'Workspaces',
    to: '/console/workspaces',
    icon: FolderKanban,
    description: 'Superficie incremental para la organización por workspaces.'
  },
  {
    label: 'Members',
    to: '/console/members',
    icon: Users,
    description: 'Miembros, roles y permisos del realm IAM del tenant activo.'
  },
  {
    label: 'Auth',
    to: '/console/auth',
    icon: Shield,
    description: 'Superficie Auth/IAM para scopes, clients, providers y aplicaciones externas del contexto activo.'
  },
  {
    label: 'PostgreSQL',
    to: '/console/postgres',
    icon: Database,
    description: 'Bases de datos, esquemas, tablas, índices, vistas y preview DDL.'
  },
  {
    label: 'MongoDB',
    to: '/console/mongo',
    icon: Database,
    description: 'Bases de datos, colecciones, índices, validación, documentos y vistas del dominio documental.'
  },
  {
    label: 'Kafka',
    to: '/console/kafka',
    icon: Activity,
    description: 'Topics, ACLs, métricas de lag, bridges y helpers de publish/stream.'
  },
  {
    label: 'Functions',
    to: '/console/functions',
    icon: Workflow,
    description: 'Entrada persistente al dominio serverless del producto.'
  },
  {
    label: 'Operaciones',
    to: '/console/operations',
    icon: Activity,
    description: 'Seguimiento de operaciones asíncronas, logs resumidos y resultado final.'
  },
  {
    label: 'Storage',
    to: '/console/storage',
    icon: Database,
    description: 'Navegación base al área de almacenamiento y datos relacionados.'
  },
  {
    label: 'Observability',
    to: '/console/observability',
    icon: Activity,
    description: 'Métricas, auditoría y señales operativas del contexto activo.'
  },
  {
    label: 'Service Accounts',
    to: '/console/service-accounts',
    icon: Settings,
    description: 'Credenciales programáticas y service accounts del workspace activo.'
  },
  {
    label: 'Quotas',
    to: '/console/quotas',
    icon: Activity,
    description: 'Postura de cuotas, límites y consumo por tenant y workspace.'
  }
] as const

export function ConsoleShellLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [session, setSession] = useState(() => readConsoleShellSession())
  const [menuOpen, setMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null)

  const principalLabel = useMemo(() => getConsolePrincipalLabel(session), [session])
  const principalSecondary = useMemo(() => getConsolePrincipalSecondary(session), [session])
  const principalInitials = useMemo(() => getConsolePrincipalInitials(session), [session])
  const principalRoles = session?.principal?.platformRoles ?? []

  useEffect(() => {
    setSession(readConsoleShellSession())
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) {
      return undefined
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }

      if (menuRef.current?.contains(target) || avatarButtonRef.current?.contains(target)) {
        return
      }

      setMenuOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      setMenuOpen(false)
      avatarButtonRef.current?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()

    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[data-shell-menu-item="true"]') ?? [])
    if (items.length === 0) {
      return
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement)

    if (event.key === 'Home') {
      items[0]?.focus()
      return
    }

    if (event.key === 'End') {
      items[items.length - 1]?.focus()
      return
    }

    const nextIndex =
      currentIndex === -1
        ? 0
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % items.length
          : (currentIndex - 1 + items.length) % items.length

    items[nextIndex]?.focus()
  }

  async function handleLogout() {
    setIsLoggingOut(true)

    try {
      if (session?.sessionId && session.tokenSet?.accessToken) {
        await terminateConsoleLoginSession(session.sessionId, session.tokenSet.accessToken)
      }
    } catch {
      // El cierre local sigue ocurriendo aunque la invalidación remota degrade.
    } finally {
      clearConsoleShellSession()
      setSession(null)
      setMenuOpen(false)
      setIsLoggingOut(false)
      navigate('/login', { replace: true })
    }
  }

  return (
    <ConsoleContextProvider session={session}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
                IA
              </div>
              <div className="min-w-0">
                <Link className="block truncate text-base font-semibold tracking-tight" to="/console/overview">
                  In Atelier Console
                </Link>
                <p className="truncate text-xs text-muted-foreground">Shell persistente + estado contextual · EP-14 / US-UI-02-T02</p>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-center">
              <ConsoleHeaderContextControls />
            </div>

            <div className="flex items-center gap-3">
              <ActiveOperationsIndicator />
            </div>

            <div className="relative flex items-center gap-3">
              <div className="hidden text-right md:block">
                <p className="text-sm font-medium text-foreground">{principalLabel}</p>
                <p className="text-xs text-muted-foreground">{principalSecondary}</p>
              </div>

              <button
                ref={avatarButtonRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Abrir menú de usuario de ${principalLabel}`}
                data-testid="console-shell-avatar"
                onClick={() => setMenuOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                  {principalInitials ? principalInitials : <User className="h-4 w-4" aria-hidden="true" />}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>

              {menuOpen ? (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label="Menú de usuario"
                  onKeyDown={handleMenuKeyDown}
                  className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-72 rounded-2xl border border-border bg-popover p-2 shadow-2xl"
                >
                  <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                    <p className="text-sm font-semibold text-popover-foreground">{principalLabel}</p>
                    <p className="text-xs text-muted-foreground">{principalSecondary}</p>
                    {principalRoles.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {principalRoles.slice(0, 3).map((role) => (
                          <Badge key={role} variant="outline">
                            {role}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-2 grid gap-1">
                    <Link
                      to="/console/profile"
                      role="menuitem"
                      data-shell-menu-item="true"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <User className="h-4 w-4" aria-hidden="true" />
                      Profile
                    </Link>
                    <Link
                      to="/console/settings"
                      role="menuitem"
                      data-shell-menu-item="true"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Settings className="h-4 w-4" aria-hidden="true" />
                      Settings
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      data-shell-menu-item="true"
                      disabled={isLoggingOut}
                      onClick={handleLogout}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      {isLoggingOut ? 'Cerrando sesión…' : 'Logout'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-[1600px] pt-16">
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 overflow-y-auto border-r border-border bg-card/35 px-4 py-6 lg:block">
            <div className="space-y-2 rounded-3xl border border-border/70 bg-background/50 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Navegación principal</p>
              <nav aria-label="Navegación principal de consola" className="space-y-1">
                {consoleNavigationItems.map((item) => {
                  const Icon = item.icon

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          'flex items-start gap-3 rounded-2xl px-3 py-3 text-sm transition-colors',
                          isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-current')} aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block font-medium">{item.label}</span>
                            <span className={cn('mt-1 block text-xs leading-5', isActive ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                              {item.description}
                            </span>
                          </span>
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </nav>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:px-8 lg:py-8">
            <div className="mx-auto max-w-5xl space-y-6">
              <ConsoleContextStatusPanel />
              <Outlet />
            </div>
          </main>
        </div>

        <div className="border-t border-border bg-background/95 px-4 py-3 lg:hidden">
          <p className="text-xs text-muted-foreground">La experiencia optimizada para móvil llegará en una iteración posterior. T02 prioriza el estado contextual dentro del shell de escritorio.</p>
        </div>
      </div>
    </ConsoleContextProvider>
  )
}

function ConsoleHeaderContextControls() {
  const {
    activeTenant,
    activeTenantId,
    activeWorkspace,
    activeWorkspaceId,
    reloadTenants,
    reloadWorkspaces,
    selectTenant,
    selectWorkspace,
    tenants,
    tenantsError,
    tenantsLoading,
    workspaces,
    workspacesError,
    workspacesLoading
  } = useConsoleContext()

  const hasNoTenants = !tenantsLoading && !tenantsError && tenants.length === 0
  const hasNoWorkspaces = Boolean(activeTenantId) && !workspacesLoading && !workspacesError && workspaces.length === 0

  const contextHint = useMemo(() => {
    if (tenantsError) {
      return tenantsError
    }

    if (workspacesError) {
      return workspacesError
    }

    if (tenantsLoading) {
      return 'Cargando tenants accesibles…'
    }

    if (hasNoTenants) {
      return 'Tu cuenta no tiene tenants accesibles todavía.'
    }

    if (!activeTenantId) {
      return 'Selecciona un tenant para establecer el contexto de trabajo.'
    }

    if (workspacesLoading) {
      return 'Cargando workspaces del tenant seleccionado…'
    }

    if (hasNoWorkspaces) {
      return 'El tenant activo no tiene workspaces accesibles para tu cuenta.'
    }

    if (!activeWorkspaceId) {
      return 'Selecciona un workspace para completar el contexto activo.'
    }

    return `Contexto activo: ${activeTenant?.label ?? 'Tenant'} / ${activeWorkspace?.label ?? 'Workspace'}`
  }, [
    activeTenant?.label,
    activeTenantId,
    activeWorkspace?.label,
    activeWorkspaceId,
    hasNoTenants,
    hasNoWorkspaces,
    tenantsError,
    tenantsLoading,
    workspacesError,
    workspacesLoading
  ])

  const workspaceDisabled = tenantsLoading || !activeTenantId || workspacesLoading || Boolean(tenantsError) || hasNoTenants

  return (
    <section
      aria-label="Contexto activo de consola"
      className="hidden min-w-0 flex-1 items-center justify-center xl:flex"
    >
      <div className="flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-border bg-card/70 px-4 py-3 shadow-sm">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Contexto</p>
          <p className="truncate text-xs text-muted-foreground">{contextHint}</p>
        </div>

        <label className="flex min-w-[220px] max-w-[260px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Tenant</span>
          <select
            aria-label="Seleccionar tenant"
            data-testid="console-context-tenant-select"
            value={activeTenantId ?? ''}
            disabled={tenantsLoading || hasNoTenants}
            onChange={(event) => selectTenant(event.target.value || null)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {tenantsLoading ? 'Cargando tenants…' : hasNoTenants ? 'Sin tenants accesibles' : 'Selecciona un tenant'}
            </option>
            {tenants.map((tenant) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>
                {tenant.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[220px] max-w-[260px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace</span>
          <select
            aria-label="Seleccionar workspace"
            data-testid="console-context-workspace-select"
            value={activeWorkspaceId ?? ''}
            disabled={workspaceDisabled}
            onChange={(event) => selectWorkspace(event.target.value || null)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {!activeTenantId
                ? 'Selecciona un tenant primero'
                : workspacesLoading
                  ? 'Cargando workspaces…'
                  : hasNoWorkspaces
                    ? 'Sin workspaces accesibles'
                    : 'Selecciona un workspace'}
            </option>
            {workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.label}
              </option>
            ))}
          </select>
        </label>

        {tenantsError ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void reloadTenants()}>
            Reintentar tenants
          </Button>
        ) : workspacesError ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void reloadWorkspaces()}>
            Reintentar workspaces
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function ConsoleContextStatusPanel() {
  const {
    activeTenant,
    activeWorkspace,
    operationalAlerts,
    tenantsError,
    tenantsLoading,
    workspacesError,
    workspacesLoading
  } = useConsoleContext()

  const tenantStatus = useMemo(() => getConsoleTenantStatusMeta(activeTenant), [activeTenant])
  const workspaceStatus = useMemo(() => getConsoleWorkspaceStatusMeta(activeWorkspace), [activeWorkspace])

  return (
    <section aria-label="Estado operativo del contexto" className="space-y-4" data-testid="console-context-status-panel">
      <div className="grid gap-4 xl:grid-cols-2">
        <article
          role="status"
          aria-live="polite"
          data-testid="console-context-tenant-status"
          className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Tenant activo</p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{activeTenant?.label ?? 'Sin tenant seleccionado'}</h2>
              <p className="text-sm text-muted-foreground">{activeTenant?.secondary ?? 'Selecciona un tenant para ver su estado operativo.'}</p>
            </div>
            <Badge variant="outline" className={getStatusBadgeClasses(tenantStatus.tone)}>
              {tenantStatus.label}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeTenant?.state ? <Badge variant="secondary">Lifecycle: {formatConsoleEnumLabel(activeTenant.state)}</Badge> : null}
            {activeTenant?.governanceStatus ? (
              <Badge variant="secondary">Gobernanza: {formatConsoleEnumLabel(activeTenant.governanceStatus)}</Badge>
            ) : null}
            {activeTenant?.quotaSummary ? (
              <Badge variant="secondary">
                Cuotas: {activeTenant.quotaSummary.totals.blocked} bloqueadas · {activeTenant.quotaSummary.totals.warning} en alerta
              </Badge>
            ) : null}
            {activeTenant?.inventorySummary ? (
              <Badge variant="secondary">Inventario: {activeTenant.inventorySummary.workspaceCount} workspaces</Badge>
            ) : null}
          </div>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {tenantsLoading && !activeTenant ? 'Cargando el estado del tenant seleccionado…' : tenantStatus.description}
          </p>
          {tenantsError ? <p className="mt-2 text-sm text-destructive">{tenantsError}</p> : null}
        </article>

        <article
          role="status"
          aria-live="polite"
          data-testid="console-context-workspace-status"
          className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Workspace activo</p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{activeWorkspace?.label ?? 'Sin workspace seleccionado'}</h2>
              <p className="text-sm text-muted-foreground">
                {activeWorkspace?.secondary ?? 'Selecciona un workspace para completar el contexto operativo.'}
              </p>
            </div>
            <Badge variant="outline" className={getStatusBadgeClasses(workspaceStatus.tone)}>
              {workspaceStatus.label}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeWorkspace?.environment ? <Badge variant="secondary">Entorno: {formatConsoleEnumLabel(activeWorkspace.environment)}</Badge> : null}
            {activeWorkspace?.state ? <Badge variant="secondary">Lifecycle: {formatConsoleEnumLabel(activeWorkspace.state)}</Badge> : null}
            {activeWorkspace?.provisioningStatus ? (
              <Badge variant="secondary">Provisioning: {formatConsoleEnumLabel(activeWorkspace.provisioningStatus)}</Badge>
            ) : null}
          </div>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {workspacesLoading && !activeWorkspace ? 'Cargando el estado del workspace seleccionado…' : workspaceStatus.description}
          </p>
          {workspacesError ? <p className="mt-2 text-sm text-destructive">{workspacesError}</p> : null}
        </article>
      </div>

      {operationalAlerts.length > 0 ? (
        <div className="space-y-3" aria-label="Alertas operativas del contexto">
          {operationalAlerts.map((alert) => (
            <article
              key={alert.key}
              role="alert"
              data-testid="console-context-operational-alert"
              className={cn(
                'rounded-2xl border px-4 py-3 shadow-sm',
                alert.level === 'destructive'
                  ? 'border-destructive/30 bg-destructive/5'
                  : alert.level === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-border bg-card/70'
              )}
            >
              <p className="text-sm font-semibold text-foreground">{alert.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{alert.description}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function getStatusBadgeClasses(tone: 'healthy' | 'warning' | 'restricted' | 'neutral') {
  if (tone === 'healthy') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (tone === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }

  if (tone === 'restricted') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }

  return 'border-border bg-background text-muted-foreground'
}
