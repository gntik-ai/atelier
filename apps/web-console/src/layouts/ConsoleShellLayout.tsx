import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Database,
  FolderKanban,
  Gauge,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Menu,
  PieChart,
  Rocket,
  RefreshCw,
  Users,
  Settings,
  Shield,
  User,
  Workflow,
  X
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom'

import { ActiveOperationsIndicator } from '@/components/console/ActiveOperationsIndicator'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'
import { READ_ONLY_AFFORDANCE_BADGE_TONE } from '@/components/console/ReadOnlyActionBadge'
import { WorkspaceActivationAction } from '@/components/console/WorkspaceRequiredState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { terminateConsoleLoginSession } from '@/lib/console-auth'
import { consoleAuthConfig } from '@/lib/console-config'
import {
  ConsoleContextProvider,
  formatConsoleContextEnumLabel,
  formatConsoleEnumLabel,
  getConsoleContextStatusBadgeClasses,
  getConsoleTenantStatusMeta,
  getConsoleWorkspaceStatusMeta,
  useConsoleContext
} from '@/lib/console-context'
import { hasPlatformInventoryAccess } from '@/lib/console-principal'
import { useConsolePermissions, type PermissionAction } from '@/lib/console-permissions'
import {
  clearConsoleShellSession,
  getConsolePrincipalInitials,
  getConsolePrincipalLabel,
  getConsolePrincipalSecondary,
  readConsoleShellSession
} from '@/lib/console-session'
import { cn } from '@/lib/utils'
import { canManageWorkspaceSecrets } from '@/lib/workspace-secrets-access'

const consoleNavigationGroupLabels = {
  main: 'Principal',
  workspace: 'Área de trabajo',
  functions: 'Funciones',
  administration: 'Administración',
  dataPlane: 'Plano de datos',
  operations: 'Operaciones',
  // #761 (F2c-5, observer-first IA): destinations that are write-ONLY for a read-only tenant role
  // (tenant_viewer / tenant_developer — nothing readable renders there for them) are regrouped
  // under this heading instead of appearing as live destinations in their normal group. This is
  // ADDITIVE to #741's nav visibility gating: it never hides an item a write-capable role can see —
  // it only changes WHICH heading a read-only role sees it under.
  restricted: 'Administración (requiere permisos)'
} as const

type ConsoleNavigationGroup = keyof typeof consoleNavigationGroupLabels

const consoleNavigationGroupOrder = Object.keys(consoleNavigationGroupLabels) as ConsoleNavigationGroup[]

const consoleNavigationItems = [
  {
    group: 'main',
    label: 'Runtime de funciones',
    to: '/console/runtime',
    icon: Activity,
    description: 'Estado de solo lectura del runtime gestionado por la plataforma.'
  },
  {
    group: 'main',
    label: 'Vista general',
    to: '/console/overview',
    icon: LayoutDashboard,
    description: 'Punto de entrada para la consola administrativa y su estado general.'
  },
  {
    group: 'main',
    label: 'Mi plan',
    to: '/console/my-plan',
    // `/console/my-plan/allocation` ("Resumen de asignación" below) is a child path of
    // `/console/my-plan`, so without `end` this NavLink also matches the allocation route and
    // TWO entries would carry aria-current="page" at once. Match exactly — mirroring the
    // "Funciones: administrar" entry, whose child is `/console/functions/data` (#797) — so
    // exactly one plan entry is the current page on each of the two routes (#741).
    exactActive: true,
    icon: Gauge,
    description: 'Derechos efectivos y consumo actual de la cuota de tu organización.'
  },
  {
    group: 'main',
    label: 'Resumen de asignación',
    to: '/console/my-plan/allocation',
    icon: PieChart,
    description: 'Reparto de límites por área de trabajo dentro de tu organización.'
  },
  {
    group: 'main',
    label: 'Gestión de organizaciones',
    to: '/console/tenants',
    icon: Shield,
    description: 'Gestión del dominio multiorganización y su navegación principal.',
    // The collection endpoint behind this page (GET /v1/tenants) 403s for tenant operators —
    // only superadmin/platform_admin/platform_operator can see a real inventory here
    // (ConsoleTenantsPage.tsx's `hasPlatformInventoryAccess`, #752). Hiding the entry for
    // tenant_owner/tenant_admin avoids a dead-end "blocked" page reachable only from the sidebar (#741).
    requiresPlatformInventoryAccess: true
  },
  {
    group: 'main',
    label: 'Gestión de áreas de trabajo',
    to: '/console/workspaces',
    icon: FolderKanban,
    description: 'Gestión de la organización por áreas de trabajo.',
    // The page renders NOTHING readable beyond the "Nueva área de trabajo" wizard trigger (#761) —
    // for a read-only tenant role it is a dead end, so subordinate it under "Administración
    // (requiere permisos)" instead of presenting it as a live destination (F2c-5).
    restrictedForAction: 'tenant.workspaces.create'
  },
  {
    group: 'workspace',
    label: 'DB del área de trabajo',
    to: '/console/database',
    icon: Database,
    description: 'Aprovisiona y rota la base de datos PostgreSQL dedicada del área de trabajo activa.',
    restrictedForAction: 'workspace.write'
  },
  {
    group: 'functions',
    label: 'Flujos / workflows',
    to: '/console/flows',
    icon: Workflow,
    description: 'Diseña, publica, ejecuta y revisa ejecuciones de flujos del área de trabajo activa.'
  },
  {
    group: 'functions',
    label: 'Funciones: registro',
    to: '/console/functions-registry',
    icon: Settings,
    description: 'Registra funciones del área de trabajo activa (ejecución pendiente del plano de datos).',
    restrictedForAction: 'workspace.write'
  },
  {
    group: 'functions',
    label: 'Funciones: administrar',
    to: '/console/functions',
    exactActive: true,
    icon: Workflow,
    description: 'Ciclo de vida serverless: inventario, versiones, activaciones, disparadores, despliegue y rollback.',
    restrictedForAction: 'workspace.write'
  },
  {
    group: 'functions',
    label: 'Funciones: despliegue rápido',
    to: '/console/functions/data',
    icon: Rocket,
    description: 'Editor JSON para desplegar, invocar y consultar activaciones sobre el ejecutor del área de trabajo.',
    restrictedForAction: 'workspace.write'
  },
  {
    group: 'administration',
    label: 'Acceso IAM',
    to: '/console/iam-access',
    icon: Shield,
    description: 'Asigna roles y gestiona la pertenencia a grupos en el realm de la organización activa.',
    requiresSuperadminAccess: true
  },
  {
    group: 'administration',
    label: 'Miembros',
    to: '/console/members',
    icon: Users,
    description: 'Miembros, roles y permisos del realm IAM de la organización activa.'
  },
  {
    group: 'administration',
    label: 'Planes',
    to: '/console/plans',
    icon: FolderKanban,
    description: 'Gestión del catálogo de planes, límites base y asignaciones por organización.',
    // `/console/plans*` is superadmin-gated at the route level (RequireSuperadminRoute in
    // router.tsx). Gate the nav entry on the SAME predicate so non-superadmins are never
    // offered a link that silently bounces them to /console/my-plan (#741).
    requiresSuperadminAccess: true
  },
  {
    group: 'administration',
    label: 'Autenticación',
    to: '/console/auth',
    icon: Shield,
    description: 'Superficie Auth/IAM para alcances, clientes, proveedores y aplicaciones externas del contexto activo.',
    requiresSuperadminAccess: true
  },
  {
    // #782: distinct from "Autenticación" above (superadmin-only realm/IAM inventory) — this is the
    // tenant owner/admin-reachable surface for the realm's OWN login settings (registration, email
    // login, password reset, remember-me, email verification) and its configured social identity
    // providers. Plain (no requiresSuperadminAccess/restrictedForAction): the backend already
    // authorizes owner/admin/superadmin server-side (`authorizeAuthConfig`).
    group: 'administration',
    label: 'Autenticación de la organización',
    to: '/console/auth-config',
    icon: LogIn,
    description: 'Configura el registro, inicio de sesión, recuperación de contraseña y proveedores de identidad del realm de tu organización.'
  },
  {
    group: 'dataPlane',
    label: 'PostgreSQL',
    to: '/console/postgres',
    icon: Database,
    description: 'Bases de datos, esquemas, tablas, índices, vistas y vista previa DDL.'
  },
  {
    group: 'dataPlane',
    label: 'MongoDB',
    to: '/console/mongo',
    icon: Database,
    description: 'Bases de datos, colecciones, índices, validación, documentos y vistas del dominio documental.'
  },
  {
    group: 'dataPlane',
    label: 'Kafka',
    to: '/console/kafka',
    icon: Activity,
    description: 'Tópicos, ACLs, métricas de retraso, puentes y herramientas de publicación/flujo.'
  },
  {
    group: 'dataPlane',
    label: 'Datos: Postgres',
    to: '/console/postgres/data',
    icon: Database,
    description: 'Editor de filas (CRUD) y claves API anon/service sobre el ejecutor de datos.'
  },
  {
    group: 'dataPlane',
    label: 'Datos: Mongo',
    to: '/console/mongo/data',
    icon: Database,
    description: 'Editor de documentos (CRUD) de una colección sobre el ejecutor de datos.'
  },
  {
    group: 'dataPlane',
    label: 'Datos: eventos',
    to: '/console/events/data',
    icon: Activity,
    description: 'Tópicos, publicación y consumo sobre el ejecutor de eventos del área de trabajo.'
  },
  {
    group: 'dataPlane',
    label: 'Datos: tiempo real',
    to: '/console/realtime/changes',
    icon: Activity,
    description: 'Flujo de cambios (SSE) de una colección con clave anónima sobre el ejecutor.'
  },
  {
    group: 'operations',
    label: 'Operaciones',
    to: '/console/operations',
    icon: Activity,
    description: 'Seguimiento de operaciones asíncronas, registros resumidos y resultado final.'
  },
  {
    group: 'dataPlane',
    label: 'Almacenamiento',
    to: '/console/storage',
    icon: Database,
    description: 'Navegación base al área de almacenamiento y datos relacionados.'
  },
  {
    group: 'operations',
    label: 'Observabilidad',
    to: '/console/observability',
    icon: Activity,
    description: 'Métricas, auditoría y señales operativas del contexto activo.'
  },
  {
    group: 'operations',
    label: 'Cuentas de servicio',
    to: '/console/service-accounts',
    // Credential-semantic icon (#783) — distinct from the `KeyRound` used by "Secretos del área de
    // trabajo" below, since these are two different credential surfaces in the same nav group.
    icon: KeySquare,
    description: 'Credenciales programáticas y service accounts del área de trabajo activa.',
    restrictedForAction: 'workspace.write'
  },
  {
    group: 'operations',
    label: 'Secretos del área de trabajo',
    to: '/console/workspace-secrets',
    icon: KeyRound,
    description: 'Secretos de función del área de trabajo activa (valores de solo escritura, inyectados en el despliegue).',
    requiresWorkspaceSecretsAccess: true,
    restrictedForAction: 'workspace.write'
  },
  {
    group: 'operations',
    label: 'Cuotas',
    to: '/console/quotas',
    icon: Activity,
    description: 'Postura de cuotas, límites y consumo por organización y área de trabajo.'
  }
] as const

type ConsoleBreadcrumb = {
  label: string
  to?: string
}

function buildConsoleBreadcrumbs(pathname: string): ConsoleBreadcrumb[] {
  const normalizedPath = normalizeConsolePath(pathname)
  const breadcrumbs: ConsoleBreadcrumb[] = [
    {
      label: 'Consola',
      to: normalizedPath === '/console/overview' ? undefined : '/console/overview'
    }
  ]

  const navMatch = [...consoleNavigationItems]
    .filter((item) => normalizedPath === item.to || normalizedPath.startsWith(`${item.to}/`))
    .sort((left, right) => right.to.length - left.to.length)[0]

  const basePath = navMatch?.to ?? '/console'
  if (navMatch && navMatch.to !== '/console/overview') {
    breadcrumbs.push({
      label: navMatch.label,
      to: normalizedPath === navMatch.to ? undefined : navMatch.to
    })
  }

  const remainingPath = normalizedPath.slice(basePath.length).replace(/^\/+/, '')
  const remainingSegments = remainingPath ? remainingPath.split('/').filter(Boolean) : []
  const extraCrumbs = buildConsoleBreadcrumbTail(basePath, remainingSegments)

  if (extraCrumbs.length > 0) {
    const lastBreadcrumbIndex = breadcrumbs.length - 1
    const lastBreadcrumb = breadcrumbs[lastBreadcrumbIndex]
    if (breadcrumbs.length > 1 && lastBreadcrumb?.to === undefined) {
      breadcrumbs[lastBreadcrumbIndex] = {
        ...lastBreadcrumb,
        to: basePath
      }
    }
    breadcrumbs.push(...extraCrumbs)
  }

  return breadcrumbs
}

function normalizeConsolePath(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/)[0] || '/console/overview'
  const withoutTrailingSlash = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery
  return withoutTrailingSlash === '/console' ? '/console/overview' : withoutTrailingSlash
}

function buildConsoleBreadcrumbTail(basePath: string, segments: string[]): ConsoleBreadcrumb[] {
  if (segments.length === 0) {
    return []
  }

  if (basePath === '/console/flows') {
    const [flowId, runsSegment, executionId] = segments
    const crumbs: ConsoleBreadcrumb[] = []
    if (flowId) {
      crumbs.push({
        label: `Flujo ${decodeConsolePathSegment(flowId)}`,
        to: runsSegment ? `/console/flows/${flowId}` : undefined
      })
    }
    if (runsSegment === 'runs') {
      crumbs.push({
        label: executionId ? 'Ejecuciones' : 'Ejecuciones',
        to: executionId ? `/console/flows/${flowId}/runs` : undefined
      })
    }
    if (executionId) {
      crumbs.push({ label: `Ejecución ${decodeConsolePathSegment(executionId)}` })
    }
    return crumbs
  }

  if (basePath === '/console/workspaces') {
    const [workspaceId, child] = segments
    const crumbs: ConsoleBreadcrumb[] = []
    if (workspaceId) {
      crumbs.push({
        label: `Área ${decodeConsolePathSegment(workspaceId)}`,
        to: child ? `/console/workspaces/${workspaceId}` : undefined
      })
    }
    if (child === 'realtime') {
      crumbs.push({ label: 'Tiempo real' })
    } else if (child === 'docs') {
      crumbs.push({ label: 'Documentación' })
    }
    return crumbs
  }

  if (basePath === '/console/operations') {
    return [{ label: `Operación ${decodeConsolePathSegment(segments[0] ?? '')}` }]
  }

  if (basePath === '/console/plans') {
    const [planSegment] = segments
    if (planSegment === 'new') {
      return [{ label: 'Nuevo plan' }]
    }
    return [{ label: `Plan ${decodeConsolePathSegment(planSegment ?? '')}` }]
  }

  if (basePath === '/console/tenants') {
    const [tenantId, child] = segments
    const crumbs: ConsoleBreadcrumb[] = []
    if (tenantId) {
      crumbs.push({
        label: `Organización ${decodeConsolePathSegment(tenantId)}`,
        to: child ? `/console/tenants/${tenantId}` : undefined
      })
    }
    if (child === 'plan') {
      crumbs.push({ label: 'Plan' })
    }
    return crumbs
  }

  return segments.map((segment, index) => ({
    label: formatConsolePathSegment(segment),
    to: index === segments.length - 1 ? undefined : `${basePath}/${segments.slice(0, index + 1).join('/')}`
  }))
}

function decodeConsolePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function formatConsolePathSegment(segment: string): string {
  const decoded = decodeConsolePathSegment(segment)
  return decoded
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase())
}

export function ConsoleShellLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeMatches = useMatches()
  const routeWorkspaceId = useMemo(() => {
    for (let index = routeMatches.length - 1; index >= 0; index -= 1) {
      const workspaceId = routeMatches[index]?.params.workspaceId
      if (workspaceId) {
        return workspaceId
      }
    }

    return null
  }, [routeMatches])
  // Platform-global routes (e.g. the plan catalog under /console/plans*) are not scoped to
  // an active tenant/workspace — showing "Organización activa" / "Área de trabajo activa"
  // there implies a context dependency that doesn't exist (#752). Routes opt in via
  // `handle: { platformGlobal: true }` in router.tsx rather than a pathname string check
  // here, so the predicate stays principled as new platform-global surfaces are added.
  const isPlatformGlobalRoute = useMemo(
    () => routeMatches.some((match) => (match.handle as { platformGlobal?: boolean } | undefined)?.platformGlobal === true),
    [routeMatches]
  )
  const [session, setSession] = useState(() => readConsoleShellSession())
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null)
  const drawerButtonRef = useRef<HTMLButtonElement | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const { panelRef: drawerPanelRef, handleTabTrap: handleDrawerTabTrap } = useModalFocusTrap<HTMLDivElement>(
    drawerOpen,
    {
      initialFocus: 'panel',
      resolveReturnFocus: () => drawerButtonRef.current
    }
  )

  const principalLabel = useMemo(() => getConsolePrincipalLabel(session), [session])
  const principalSecondary = useMemo(() => getConsolePrincipalSecondary(session), [session])
  const principalInitials = useMemo(() => getConsolePrincipalInitials(session), [session])
  const principalRoles = session?.principal?.platformRoles ?? []
  // #761: always-visible, humanized role indicator — the roles were previously only shown as raw
  // tokens buried inside the opened avatar dropdown (see below), with no resting signal that a
  // read-only role's write actions are unavailable.
  const permissions = useConsolePermissions()
  const breadcrumbs = useMemo(() => buildConsoleBreadcrumbs(location.pathname), [location.pathname])

  useEffect(() => {
    setSession(readConsoleShellSession())
    setDrawerOpen(false)
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

  useEffect(() => {
    if (!drawerOpen) {
      return undefined
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      setDrawerOpen(false)
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [drawerOpen])

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

  function handleSkipToContent(event: ReactMouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    mainRef.current?.focus()
  }

  async function handleLogout() {
    setIsLoggingOut(true)

    try {
      if (session?.sessionId && session.tokenSet?.accessToken) {
        await terminateConsoleLoginSession(
          session.sessionId,
          session.tokenSet.accessToken,
          session.tokenSet.refreshToken
        )
      }
    } catch {
      // El cierre local sigue ocurriendo aunque la invalidación remota degrade.
    } finally {
      clearConsoleShellSession()
      setSession(null)
      setMenuOpen(false)
      setIsLoggingOut(false)
      navigate(consoleAuthConfig.loginPath, { replace: true })
    }
  }

  return (
    <ConsoleContextProvider session={session} routeWorkspaceId={routeWorkspaceId}>
      <div className="min-h-screen bg-background text-foreground">
        <a
          href="#console-main-content"
          onClick={handleSkipToContent}
          className="sr-only fixed left-4 top-4 z-[60] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          Saltar al contenido principal
        </a>
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6 lg:gap-4 lg:px-8">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Button
                ref={drawerButtonRef}
                type="button"
                variant="outline"
                size="icon"
                aria-label="Abrir navegación y contexto"
                aria-controls="console-shell-drawer"
                aria-expanded={drawerOpen}
                data-testid="console-shell-drawer-trigger"
                onClick={() => setDrawerOpen(true)}
                className="h-10 w-10 shrink-0 xl:hidden"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </Button>
              <img src="/img/logo-wide.png" alt="In Falcone" className="h-9 w-auto shrink-0 sm:h-10" />
              <div className="min-w-0">
                <Link className="block max-w-[8.5rem] truncate text-sm font-semibold tracking-tight sm:max-w-none sm:text-base" to="/console/overview">
                  Consola In Falcone
                </Link>
                <p className="hidden truncate text-xs text-muted-foreground sm:block">Panel de administración multi-organización</p>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-center">
              <ConsoleHeaderContextControls />
            </div>

            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <ActiveOperationsIndicator />
            </div>

            <div className="relative flex shrink-0 items-center gap-2 sm:gap-3">
              <RoleBadge permissions={permissions} />

              <div className="hidden max-w-48 text-right 2xl:block">
                <p className="truncate text-sm font-medium text-foreground">{principalLabel}</p>
                <p className="truncate text-xs text-muted-foreground">{principalSecondary}</p>
              </div>

              <button
                ref={avatarButtonRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Abrir menú de usuario de ${principalLabel}`}
                data-testid="console-shell-avatar"
                onClick={() => setMenuOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:rounded-2xl sm:px-3 sm:py-2"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground sm:h-10 sm:w-10">
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
                      Perfil
                    </Link>
                    <Link
                      to="/console/settings"
                      role="menuitem"
                      data-shell-menu-item="true"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Settings className="h-4 w-4" aria-hidden="true" />
                      Ajustes
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
                      {isLoggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <ConsoleResponsiveDrawer
          open={drawerOpen}
          panelRef={drawerPanelRef}
          onClose={() => setDrawerOpen(false)}
          onKeyDown={handleDrawerTabTrap}
        />

        <div className="mx-auto flex max-w-[1600px] pt-16">
          <aside
            data-testid="console-shell-sidebar"
            className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 overflow-y-auto border-r border-border bg-card/35 px-4 py-6 xl:block"
          >
            <div className="space-y-2 rounded-3xl border border-border/70 bg-background/50 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Navegación principal</p>
              <ConsoleNavigation />
            </div>
          </aside>

          <main
            id="console-main-content"
            ref={mainRef}
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8 xl:h-[calc(100vh-4rem)] xl:overflow-y-auto"
          >
            <div className="mx-auto max-w-5xl space-y-6">
              <ConsoleBreadcrumbs items={breadcrumbs} />
              {isPlatformGlobalRoute ? null : <ConsoleContextStatusPanel />}
              <Outlet />
            </div>
          </main>
        </div>

        <div data-testid="console-shell-mobile-hint" className="border-t border-border bg-background/95 px-4 py-3 xl:hidden">
          <p className="text-xs text-muted-foreground">La navegación y el selector de contexto están disponibles desde el botón del encabezado.</p>
        </div>
      </div>
    </ConsoleContextProvider>
  )
}

function ConsoleResponsiveDrawer({
  open,
  panelRef,
  onClose,
  onKeyDown
}: {
  open: boolean
  panelRef: RefObject<HTMLDivElement>
  onClose: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 xl:hidden" data-testid="console-shell-drawer-layer">
      <button
        type="button"
        aria-label="Cerrar navegación y contexto"
        className="absolute inset-0 h-full w-full bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        id="console-shell-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="console-shell-drawer-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 left-0 flex w-[min(28rem,calc(100vw-2rem))] max-w-full flex-col border-r border-border/80 bg-background shadow-2xl shadow-black/40 outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="console-shell-drawer-title" className="text-base font-semibold tracking-tight text-foreground">
              Navegación y contexto
            </h2>
            <p className="mt-1 max-w-[18rem] text-xs leading-5 text-muted-foreground">Cambia de sección, organización o área de trabajo.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar navegación y contexto" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <ConsoleHeaderContextControls variant="drawer" />
          <div className="rounded-2xl border border-border/70 bg-card/40 p-3">
            <ConsoleNavigation onNavigate={onClose} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ConsoleBreadcrumbs({ items }: { items: ConsoleBreadcrumb[] }) {
  return (
    <nav aria-label="Ruta de navegación de consola" data-testid="console-shell-breadcrumbs" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 max-w-full items-center gap-1.5">
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  title={item.label}
                  className="inline-block min-w-0 max-w-[9rem] truncate rounded-sm align-bottom font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[16rem]"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  title={item.label}
                  className={cn(
                    'inline-block min-w-0 max-w-[11rem] truncate align-bottom sm:max-w-[20rem]',
                    isLast && 'font-medium text-foreground'
                  )}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// Always-visible, humanized role indicator (#761 — F2c-3). Lives in the identity zone's
// ALWAYS-rendered identity wrapper next to the avatar button, not the `hidden … 2xl:block`
// name/email column — that zone disappears at narrower desktop widths while the avatar (and this
// badge) survive every breakpoint (#745's responsive dead-zone). Collapses to icon-only below `sm`
// to stay within a cramped mobile header; the label re-appears at `sm` and up.
function RoleBadge({ permissions }: { permissions: ReturnType<typeof useConsolePermissions> }) {
  const { highestRoleLabel, highestRoleTone } = permissions
  const isReadOnlyTone = highestRoleTone === 'read-only' || highestRoleTone === 'unknown'
  const ariaLabel = isReadOnlyTone
    ? `Rol actual: ${highestRoleLabel}. Puedes consultar, pero las acciones de creación, edición y eliminación están deshabilitadas.`
    : `Rol actual: ${highestRoleLabel}.`

  return (
    <Badge
      variant={isReadOnlyTone ? 'outline' : 'secondary'}
      data-testid="console-role-badge"
      role="status"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn('min-w-0 shrink-0 gap-1.5', isReadOnlyTone && READ_ONLY_AFFORDANCE_BADGE_TONE)}
    >
      {isReadOnlyTone ? <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="hidden max-w-36 truncate sm:inline">{highestRoleLabel}</span>
    </Badge>
  )
}

function ConsoleNavigation({ onNavigate }: { onNavigate?: () => void } = {}) {
  // The Workspace Secrets entry is shown only when the same coarse, fail-safe gate that guards the
  // route is satisfied (workspace membership / tenant-admin / platform role). This runs inside the
  // ConsoleContextProvider, so the active workspace is available.
  const { activeWorkspaceId } = useConsoleContext()
  const session = useMemo(() => readConsoleShellSession(), [])
  const canSecrets = canManageWorkspaceSecrets(session, activeWorkspaceId)
  const isSuperadmin = session?.principal?.platformRoles?.includes('superadmin') ?? false
  // Same predicate as ConsoleTenantsPage.tsx's `canViewInventory` (#752) — kept in sync via the
  // shared `hasPlatformInventoryAccess` helper so the "Gestión de organizaciones" nav entry never
  // drifts from what the page itself renders for a role (#741).
  const canViewTenantInventory = hasPlatformInventoryAccess(session?.principal?.platformRoles)
  // #761: read-only tenant roles (tenant_viewer/tenant_developer) get select write-ONLY nav entries
  // regrouped under "Administración (requiere permisos)" (F2c-5) — this NEVER hides an item a
  // write-capable role can see, it only changes which heading a read-only role sees it under.
  const { can, isReadOnly } = useConsolePermissions()

  const items = consoleNavigationItems.filter(
    (item) =>
      (!('requiresWorkspaceSecretsAccess' in item && item.requiresWorkspaceSecretsAccess) || canSecrets) &&
      (!('requiresSuperadminAccess' in item && item.requiresSuperadminAccess) || isSuperadmin) &&
      (!('requiresPlatformInventoryAccess' in item && item.requiresPlatformInventoryAccess) || canViewTenantInventory)
  )

  function resolvedGroup(item: (typeof consoleNavigationItems)[number]): ConsoleNavigationGroup {
    if (
      isReadOnly &&
      'restrictedForAction' in item &&
      item.restrictedForAction &&
      !can(item.restrictedForAction as PermissionAction)
    ) {
      return 'restricted'
    }
    return item.group
  }

  const groupedItems = consoleNavigationGroupOrder
    .map((group) => ({
      group,
      items: items.filter((item) => resolvedGroup(item) === group)
    }))
    .filter((group) => group.items.length > 0)

  return (
    <nav aria-label="Navegación principal de consola" className="space-y-5">
      {groupedItems.map(({ group, items: groupItems }) => {
        const headingId = `console-navigation-${group}`

        return (
          <section key={group} aria-labelledby={headingId} className="space-y-1.5">
            <p id={headingId} className="px-3 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              {consoleNavigationGroupLabels[group]}
            </p>
            <div className="space-y-1">
              {groupItems.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={'exactActive' in item ? item.exactActive : undefined}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex min-w-0 items-start gap-3 rounded-2xl px-3 py-3 text-sm transition-colors',
                        isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-current')} aria-hidden="true" />
                        <span className="min-w-0 break-words">
                          <span className="block font-medium leading-5">{item.label}</span>
                          {/* #734: /90 (not the more usual /80) for this sub-label. The active pill
                              is now bg-primary — a mid-navy — instead of the old near-white surface,
                              which shrank the headroom for the near-black --primary-foreground text:
                              /80 on navy measures 4.33:1 (a small-text WCAG AA miss), /90 restores it
                              to 4.97:1 with a barely-perceptible change. */}
                          <span className={cn('mt-1 block text-xs leading-5', isActive ? 'text-primary-foreground/90' : 'text-muted-foreground')}>
                            {item.description}
                          </span>
                        </span>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </section>
        )
      })}
    </nav>
  )
}

function ConsoleHeaderContextControls({ variant = 'header' }: { variant?: 'header' | 'drawer' } = {}) {
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
      return 'Cargando organizaciones accesibles…'
    }

    if (hasNoTenants) {
      return 'Tu cuenta no tiene organizaciones accesibles todavía.'
    }

    if (!activeTenantId) {
      return 'Selecciona una organización para establecer el contexto de trabajo.'
    }

    if (workspacesLoading) {
      return 'Cargando áreas de trabajo de la organización seleccionada…'
    }

    if (hasNoWorkspaces) {
      return 'La organización activa no tiene áreas de trabajo accesibles para tu cuenta.'
    }

    if (!activeWorkspaceId) {
      return 'Selecciona un área de trabajo para completar el contexto activo.'
    }

    return `Contexto activo: ${activeTenant?.label ?? 'Organización'} / ${activeWorkspace?.label ?? 'Área de trabajo'}`
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
  const isDrawer = variant === 'drawer'

  return (
    <section
      aria-label={isDrawer ? 'Contexto activo en navegación móvil' : 'Contexto activo de consola'}
      data-testid={isDrawer ? 'console-drawer-context-controls' : 'console-header-context-controls'}
      className={cn(
        isDrawer
          ? 'flex w-full min-w-0 flex-col'
          : 'hidden min-w-0 flex-1 items-center justify-center xl:flex'
      )}
    >
      <div
        className={cn(
          'w-full rounded-xl border border-border bg-card/70 shadow-sm',
          isDrawer
            ? 'grid gap-3 px-3 py-3'
            : 'flex max-w-3xl items-center gap-2 px-3 py-1.5'
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase leading-none tracking-[0.18em] text-muted-foreground">Contexto</p>
          <p className={cn('mt-1 text-xs leading-4 text-muted-foreground', isDrawer ? 'break-words' : 'truncate')}>{contextHint}</p>
        </div>

        <label className={cn('flex flex-1 flex-col gap-1', isDrawer ? 'min-w-0' : 'min-w-[210px] max-w-[240px]')}>
          <span className="text-[10px] font-medium uppercase leading-none tracking-[0.16em] text-muted-foreground">Organización</span>
          <select
            aria-label="Seleccionar organización"
            data-testid={isDrawer ? 'console-drawer-context-tenant-select' : 'console-context-tenant-select'}
            value={activeTenantId ?? ''}
            disabled={tenantsLoading || hasNoTenants}
            onChange={(event) => selectTenant(event.target.value || null)}
            className="h-8 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {tenantsLoading ? 'Cargando organizaciones…' : hasNoTenants ? 'Sin organizaciones accesibles' : 'Selecciona una organización'}
            </option>
            {tenants.map((tenant) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>
                {tenant.label}
              </option>
            ))}
          </select>
        </label>

        <label className={cn('flex flex-1 flex-col gap-1', isDrawer ? 'min-w-0' : 'min-w-[210px] max-w-[240px]')}>
          <span className="text-[10px] font-medium uppercase leading-none tracking-[0.16em] text-muted-foreground">Área de trabajo</span>
          <select
            aria-label="Seleccionar área de trabajo"
            data-testid={isDrawer ? 'console-drawer-context-workspace-select' : 'console-context-workspace-select'}
            value={activeWorkspaceId ?? ''}
            disabled={workspaceDisabled}
            onChange={(event) => selectWorkspace(event.target.value || null)}
            className="h-8 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {!activeTenantId
                ? 'Selecciona una organización primero'
                : workspacesLoading
                  ? 'Cargando áreas de trabajo…'
                  : hasNoWorkspaces
                    ? 'Sin áreas de trabajo accesibles'
                    : 'Selecciona un área de trabajo'}
            </option>
            {workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.label}
              </option>
            ))}
          </select>
        </label>

        {tenantsError ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Reintentar organizaciones"
            title="Reintentar organizaciones"
            onClick={() => void reloadTenants()}
            className={cn('h-9 shrink-0 rounded-lg', isDrawer ? 'w-full' : 'w-9 px-0')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {isDrawer ? <span>Reintentar organizaciones</span> : null}
          </Button>
        ) : workspacesError || hasNoWorkspaces ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Reintentar áreas de trabajo"
            title="Reintentar áreas de trabajo"
            onClick={() => void reloadWorkspaces()}
            className={cn('h-9 shrink-0 rounded-lg', isDrawer ? 'w-full' : 'w-9 px-0')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {isDrawer ? <span>Reintentar áreas de trabajo</span> : null}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function ConsoleContextStatusPanel() {
  const {
    activeTenant,
    activeTenantId,
    activeWorkspace,
    operationalAlerts,
    reloadTenants,
    reloadWorkspaces,
    selectWorkspace,
    tenantsError,
    tenantsLoading,
    workspaces,
    workspacesError,
    workspacesLoading
  } = useConsoleContext()
  const { can } = useConsolePermissions()

  const tenantStatus = useMemo(() => getConsoleTenantStatusMeta(activeTenant), [activeTenant])
  const workspaceStatus = useMemo(() => getConsoleWorkspaceStatusMeta(activeWorkspace), [activeWorkspace])
  const hasNoWorkspaces = Boolean(activeTenantId) && !workspacesLoading && !workspacesError && workspaces.length === 0
  // #742 (Scenario 1): give the "no active workspace" card a real first action instead of the
  // static "Selecciona un área de trabajo…" sentence below — a workspace picker when the active
  // organization already has workspaces, or a create-first-workspace CTA (degrading honestly when
  // the role can't create one) when it has none. Only once a tenant is active and the workspaces
  // list finished loading without error (the no-tenant-selected case is out of scope for #742 and
  // keeps its existing static copy).
  const showWorkspaceActivationAction = Boolean(activeTenantId) && !activeWorkspace && !workspacesLoading && !workspacesError

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
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Organización activa</p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{activeTenant?.label ?? 'Sin organización seleccionada'}</h2>
              <p className="text-sm text-muted-foreground">{activeTenant?.secondary ?? 'Selecciona una organización para ver su estado operativo.'}</p>
            </div>
            <Badge variant="outline" className={getConsoleContextStatusBadgeClasses(tenantStatus.tone)}>
              {tenantStatus.label}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeTenant?.state ? <Badge variant="secondary">Ciclo de vida: {formatConsoleContextEnumLabel(activeTenant.state)}</Badge> : null}
            {activeTenant?.governanceStatus ? (
              <Badge variant="secondary">Gobernanza: {formatConsoleContextEnumLabel(activeTenant.governanceStatus)}</Badge>
            ) : null}
            {activeTenant?.quotaSummary ? (
              <Badge variant="secondary">
                Cuotas: {activeTenant.quotaSummary.totals.blocked} bloqueadas · {activeTenant.quotaSummary.totals.warning} en alerta
              </Badge>
            ) : null}
            {activeTenant?.inventorySummary ? (
              <Badge variant="secondary">Inventario: {activeTenant.inventorySummary.workspaceCount} áreas de trabajo</Badge>
            ) : null}
          </div>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {tenantsLoading && !activeTenant ? 'Cargando el estado de la organización seleccionada…' : tenantStatus.description}
          </p>
          {tenantsError ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-destructive">{tenantsError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void reloadTenants()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reintentar organizaciones
              </Button>
            </div>
          ) : null}
        </article>

        <article
          role="status"
          aria-live="polite"
          data-testid="console-context-workspace-status"
          className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Área de trabajo activa</p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{activeWorkspace?.label ?? 'Sin área de trabajo seleccionada'}</h2>
              <p className="text-sm text-muted-foreground">
                {activeWorkspace?.secondary ?? 'Selecciona un área de trabajo para completar el contexto operativo.'}
              </p>
            </div>
            <Badge variant="outline" className={getConsoleContextStatusBadgeClasses(workspaceStatus.tone)}>
              {workspaceStatus.label}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeWorkspace?.environment ? <Badge variant="secondary">Entorno: {formatConsoleEnumLabel(activeWorkspace.environment)}</Badge> : null}
            {activeWorkspace?.state ? <Badge variant="secondary">Ciclo de vida: {formatConsoleContextEnumLabel(activeWorkspace.state)}</Badge> : null}
            {activeWorkspace?.provisioningStatus ? (
              <Badge variant="secondary">Aprovisionamiento: {formatConsoleContextEnumLabel(activeWorkspace.provisioningStatus)}</Badge>
            ) : null}
          </div>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {workspacesLoading && !activeWorkspace
              ? 'Cargando el estado del área de trabajo seleccionada…'
              : hasNoWorkspaces
                ? 'No se encontraron áreas de trabajo accesibles para la organización activa.'
                : workspaceStatus.description}
          </p>
          {workspacesError ? (
            // A real load failure: retrying IS the primary recovery here, so it keeps the outline
            // button and leads the footer (the activation action is suppressed while the list errored).
            <div className="mt-3 flex flex-col gap-3 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-destructive">{workspacesError}</p>
              <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => void reloadWorkspaces()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reintentar áreas de trabajo
              </Button>
            </div>
          ) : showWorkspaceActivationAction ? (
            // #742 (Scenario 1): no active workspace. The activation action (create-first-workspace
            // CTA / inline picker / honest degrade) is the DESIGNATED FIRST action, so it LEADS and
            // carries the visual weight in a single section. When the organization simply has no
            // workspaces yet, the "just provisioned? re-check" recovery is subordinated BELOW it as a
            // quiet ghost affordance — the earlier layout stacked that outline retry, on its own
            // divider, ABOVE the primary CTA, inverting the hierarchy.
            <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
              <WorkspaceActivationAction
                workspaces={workspaces}
                canCreateWorkspace={can('tenant.workspaces.create')}
                onSelectWorkspace={selectWorkspace}
              />
              {hasNoWorkspaces ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Vuelve a consultar áreas de trabajo si la organización se acaba de aprovisionar.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void reloadWorkspaces()}
                    className="shrink-0 text-muted-foreground"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Reintentar áreas de trabajo
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
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
