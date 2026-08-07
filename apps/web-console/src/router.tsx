import { lazy } from 'react'
import { createBrowserRouter, Navigate, useNavigate } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ConsoleShellLayout } from '@/layouts/ConsoleShellLayout'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PasswordRecoveryPage } from '@/pages/PasswordRecoveryPage'
import { PendingActivationPage } from '@/pages/PendingActivationPage'
import { ConsoleAuthPage } from '@/pages/ConsoleAuthPage'
import { ConsoleAuthConfigPage } from '@/pages/ConsoleAuthConfigPage'
import { ConsoleMembersPage } from '@/pages/ConsoleMembersPage'
import { ConsoleOverviewPage } from '@/pages/ConsoleOverviewPage'
import { ConsoleProfilePage } from '@/pages/ConsoleProfilePage'
import { ConsoleSettingsPage } from '@/pages/ConsoleSettingsPage'
import { ConsoleTenantsPage } from '@/pages/ConsoleTenantsPage'
import { ConsolePlanCatalogPage } from '@/pages/ConsolePlanCatalogPage'
import { ConsolePlanCreatePage } from '@/pages/ConsolePlanCreatePage'
import { ConsolePlanDetailPage } from '@/pages/ConsolePlanDetailPage'
import { ConsoleTenantPlanPage } from '@/pages/ConsoleTenantPlanPage'
import { ConsoleTenantPlanOverviewPage } from '@/pages/ConsoleTenantPlanOverviewPage'
import { ConsoleTenantAllocationSummaryPage } from '@/pages/ConsoleTenantAllocationSummaryPage'
import { ConsoleWorkspaceDashboardPage } from '@/pages/ConsoleWorkspaceDashboardPage'
import { ConsoleWorkspacesPage } from '@/pages/ConsoleWorkspacesPage'
import { ConsoleWorkspaceDatabasePage } from '@/pages/ConsoleWorkspaceDatabasePage'
import { ConsoleFunctionRegistryPage } from '@/pages/ConsoleFunctionRegistryPage'
import { ConsoleIamAccessPage } from '@/pages/ConsoleIamAccessPage'
// Eager (not lazy): clicking a NavLink to a lazy route suspends synchronously and
// throws React #426 in this build; import these wired pages directly.
import { ConsoleQuotasPage } from '@/pages/ConsoleQuotasPage'
import { ConsoleObservabilityPage } from '@/pages/ConsoleObservabilityPage'
import { ConsoleServiceAccountsPage } from '@/pages/ConsoleServiceAccountsPage'
import { ConsoleStoragePage } from '@/pages/ConsoleStoragePage'
import { ConsoleMongoPage } from '@/pages/ConsoleMongoPage'
import { ConsolePostgresPage } from '@/pages/ConsolePostgresPage'
import { ConsolePostgresDataPage } from '@/pages/ConsolePostgresDataPage'
import { ConsoleMongoDataPage } from '@/pages/ConsoleMongoDataPage'
import { ConsoleEventsDataPage } from '@/pages/ConsoleEventsDataPage'
import { ConsoleFunctionsDataPage } from '@/pages/ConsoleFunctionsDataPage'
import { ConsoleRealtimeChangesPage } from '@/pages/ConsoleRealtimeChangesPage'
import { ConsoleKafkaPage } from '@/pages/ConsoleKafkaPage'
import { ConsoleOperationsPage } from '@/pages/ConsoleOperationsPage'
import { ConsoleOperationDetailPage } from '@/pages/ConsoleOperationDetailPage'
import { ConsoleFunctionsPage } from '@/pages/ConsoleFunctionsPage'
import { ConsoleMcpServerDetailPage } from '@/pages/ConsoleMcpServerDetailPage'
import { ConsoleWorkspaceSecretsPage } from '@/pages/ConsoleWorkspaceSecretsPage'
import { ConsoleRuntimePage } from '@/pages/ConsoleRuntimePage'
// Eager (not lazy) for the same reason as the block above (#755): the secret-rotation table's
// "Rotate"/"History" buttons reach these routes via a synchronous in-app `navigate()`, so a lazy
// element would suspend synchronously and throw React #426 (blanking the whole shell).
import { ConsoleSecretsPage } from '@/pages/ConsoleSecretsPage'
import { ConsoleSecretRotationPage } from '@/pages/ConsoleSecretRotationPage'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'
import { SignupPage } from '@/pages/SignupPage'
import { consoleAuthConfig } from '@/lib/console-config'
import { getConsolePermissions } from '@/lib/console-permissions'
import { readConsoleShellSession } from '@/lib/console-session'
import { canManageWorkspaceSecrets } from '@/lib/workspace-secrets-access'
import { useConsoleContext } from '@/lib/console-context'
import { WelcomePage } from '@/pages/WelcomePage'

const ConsoleRealtimePage = lazy(async () => {
  const module = await import('@/pages/ConsoleRealtimePage')
  return { default: module.ConsoleRealtimePage }
})

const ConsoleDocsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleDocsPage')
  return { default: module.ConsoleDocsPage }
})

// Flows section is code-split so the @xyflow/react canvas chunk stays out of the
// initial shell bundle (change: add-console-flow-designer).
const ConsoleFlowsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowsPage')
  return { default: module.ConsoleFlowsPage }
})

const ConsoleFlowDesignerPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowDesignerPage')
  return { default: module.ConsoleFlowDesignerPage }
})

// Flow run-view + run-history (change: add-console-flow-monitoring). Code-split with the rest of
// the flows section so the canvas chunk stays out of the initial shell bundle.
const ConsoleFlowRunPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowRunPage')
  return { default: module.ConsoleFlowRunPage }
})

const ConsoleFlowHistoryPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowHistoryPage')
  return { default: module.ConsoleFlowHistoryPage }
})


function RequireSuperadminRoute({ children }: { children: JSX.Element }) {
  const session = readConsoleShellSession()
  const roles = session?.principal?.platformRoles ?? []
  return roles.includes('superadmin') ? children : (
    <ConsoleAccessDeniedState
      title="Necesitas permisos de superadmin"
      description="Esta sección administra recursos globales de la plataforma. Tu sesión actual no incluye el rol superadmin, así que la consola conserva esta ruta y muestra el bloqueo en lugar de enviarte a otra página sin explicación."
    />
  )
}

export function isPlatformObserverRole(role: string): boolean {
  return ['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor'].includes(role)
}

function RequirePlatformObserverRoute({ children }: { children: JSX.Element }) {
  const roles = readConsoleShellSession()?.principal?.platformRoles ?? []
  return roles.some(isPlatformObserverRole) ? children : (
    <ConsoleAccessDeniedState title="Estado de plataforma restringido" description="Esta vista está disponible para operadores de plataforma. Solicita acceso a un administrador para consultar el runtime global." />
  )
}

// #761 (F2c-5, observer-first IA): the bare `/console` index previously always redirected to the
// operator `overview` placeholder. A read-only tenant role has no use for it — land it on a read
// destination instead (mirrors LoginPage.tsx's `resolvePostLoginDestination`, used for the initial
// post-login navigation; this covers the OTHER path — a fresh load of `/console` on an existing
// session, e.g. after a hard refresh or a bookmark).
function ConsoleIndexRedirect() {
  const session = readConsoleShellSession()
  const permissions = getConsolePermissions(session?.principal?.platformRoles)
  return <Navigate replace to={permissions.isReadOnly ? 'observability' : 'overview'} />
}

// Fail-safe, coarse gate for the Workspace Secrets screen (#723): an operator who is neither a
// member of the active workspace nor a tenant-admin/platform-role operator sees an explicit
// blocked state. This runs inside ConsoleShellLayout's Outlet, so the ConsoleContext (active
// workspace) is available. Per-secret mutate authority stays server-enforced — this is
// defense-in-depth only.
function RequireWorkspaceSecretsRoute({ children }: { children: JSX.Element }) {
  const session = readConsoleShellSession()
  const { activeWorkspaceId } = useConsoleContext()
  return canManageWorkspaceSecrets(session, activeWorkspaceId) ? children : (
    <ConsoleAccessDeniedState
      title="Sin acceso a los secretos del área de trabajo"
      description="Necesitas pertenecer al área de trabajo activa o tener permisos de administración de organización o plataforma para gestionar estos secretos. Cambia el contexto o solicita acceso antes de continuar."
    />
  )
}

function ConsoleAccessDeniedState({ title, description }: { title: string; description: string }) {
  const navigate = useNavigate()

  return (
    <ConsolePageState
      kind="blocked"
      title={title}
      description={description}
      actionLabel="Volver a la vista general"
      onAction={() => navigate('/console/overview')}
    >
      <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => navigate('/console/my-plan')}>
        Revisar mi plan y permisos
      </Button>
    </ConsolePageState>
  )
}

function ConsoleUnknownRouteState() {
  const navigate = useNavigate()

  return (
    <ConsolePageState
      kind="empty"
      title="Sección de consola no encontrada"
      description="No encontramos esta dirección autenticada. Tu sesión y el contexto activo se mantienen; revisa la ruta, usa la navegación de la consola o vuelve a una sección conocida."
      actionLabel="Volver a la vista general"
      onAction={() => navigate('/console/overview')}
    >
      <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => navigate(-1)}>
        Volver a la página anterior
      </Button>
    </ConsolePageState>
  )
}

// T05 endurece la entrada a `/console/*` con guardas de sesión y refresh on-demand.
export const appRoutes = [
  {
    // Pathless layout route (#731): every unauthenticated screen — including the 404 fallback —
    // shares AuthLayout's brand mark, container, and per-route `document.title` (read from each
    // leaf route's `handle.title` below) via a single `<Outlet/>`.
    element: <AuthLayout />,
    children: [
      {
        path: '/',
        element: <WelcomePage />,
        handle: { title: 'Bienvenida · Consola In Falcone' }
      },
      {
        path: consoleAuthConfig.loginPath,
        element: <LoginPage />,
        handle: { title: 'Acceso · Consola In Falcone' }
      },
      {
        path: consoleAuthConfig.passwordRecoveryPath,
        element: <PasswordRecoveryPage />,
        handle: { title: 'Recuperar contraseña · Consola In Falcone' }
      },
      {
        path: '/signup',
        element: <SignupPage />,
        handle: { title: 'Solicitar acceso · Consola In Falcone' }
      },
      {
        path: '/signup/pending-activation',
        element: <PendingActivationPage />,
        handle: { title: 'Registro pendiente · Consola In Falcone' }
      },
      {
        path: '*',
        element: <NotFoundPage />,
        handle: { title: 'Página no encontrada · Consola In Falcone' }
      }
    ]
  },
  {
    path: '/console',
    element: <ProtectedRoute />,
    children: [
      {
        element: <ConsoleShellLayout />,
        children: [
          // Pathless layout route (#755): renders just an <Outlet/> so the content routes below stay
          // mounted inside ConsoleShellLayout's chrome, but carries a shell-level errorElement so a
          // render error in any content route is contained HERE (inside the shell's main <Outlet/>,
          // nav intact) instead of bubbling to react-router's root boundary and blanking the whole
          // console + leaking a raw minified stack.
          {
            errorElement: <RouteErrorBoundary />,
            children: [
          {
            index: true,
            element: <ConsoleIndexRedirect />
          },
          {
            path: 'overview',
            element: <ConsoleOverviewPage />
          },
          {
            path: 'tenants',
            element: <ConsoleTenantsPage />
          },
          {
            path: 'workspaces',
            element: <ConsoleWorkspacesPage />
          },
          {
            path: 'database',
            element: <ConsoleWorkspaceDatabasePage />
          },
          {
            path: 'functions-registry',
            element: <ConsoleFunctionRegistryPage />
          },
          {
            path: 'iam-access',
            element: <RequireSuperadminRoute><ConsoleIamAccessPage /></RequireSuperadminRoute>
          },
          {
            path: 'members',
            element: <ConsoleMembersPage />
          },

          {
            // Platform-global surface (not scoped to an active tenant/workspace) — see
            // ConsoleShellLayout's `isPlatformGlobalRoute` predicate (#752).
            path: 'plans',
            element: <RequireSuperadminRoute><ConsolePlanCatalogPage /></RequireSuperadminRoute>,
            handle: { platformGlobal: true }
          },
          {
            path: 'plans/new',
            element: <RequireSuperadminRoute><ConsolePlanCreatePage /></RequireSuperadminRoute>,
            handle: { platformGlobal: true }
          },
          {
            path: 'plans/:planId',
            element: <RequireSuperadminRoute><ConsolePlanDetailPage /></RequireSuperadminRoute>,
            handle: { platformGlobal: true }
          },
          {
            path: 'tenants/:tenantId/plan',
            element: <RequireSuperadminRoute><ConsoleTenantPlanPage /></RequireSuperadminRoute>
          },
          {
            path: 'my-plan',
            element: <ConsoleTenantPlanOverviewPage />
          },
          {
            path: 'my-plan/allocation',
            element: <ConsoleTenantAllocationSummaryPage />
          },
          {
            path: 'workspaces/:workspaceId',
            element: <ConsoleWorkspaceDashboardPage />
          },
          {
            path: 'auth',
            element: <RequireSuperadminRoute><ConsoleAuthPage /></RequireSuperadminRoute>
          },
          {
            // Tenant realm auth-config (#782) — plain authenticated route, NOT superadmin-gated:
            // the backend (`authorizeAuthConfig`) already authorizes owner/admin/superadmin, and a
            // tenant owner must be able to reach it (unlike `/console/auth` above, which owners are
            // redirected away from per #740).
            path: 'auth-config',
            element: <ConsoleAuthConfigPage />
          },
          {
            path: 'postgres',
            element: <ConsolePostgresPage />
          },
          {
            path: 'postgres/data',
            element: <ConsolePostgresDataPage />
          },
          {
            path: 'mongo',
            element: <ConsoleMongoPage />
          },
          {
            path: 'mongo/data',
            element: <ConsoleMongoDataPage />
          },
          {
            path: 'kafka',
            element: <ConsoleKafkaPage />
          },
          {
            path: 'events/data',
            element: <ConsoleEventsDataPage />
          },
          {
            path: 'functions',
            element: <ConsoleFunctionsPage />
          },
          {
            path: 'functions/data',
            element: <ConsoleFunctionsDataPage />
          },
          {
            path: 'realtime/changes',
            element: <ConsoleRealtimeChangesPage />
          },
          {
            path: 'flows',
            element: <ConsoleFlowsPage />
          },
          {
            path: 'flows/:flowId',
            element: <ConsoleFlowDesignerPage />
          },
          {
            path: 'flows/:flowId/runs',
            element: <ConsoleFlowHistoryPage />
          },
          {
            path: 'flows/:flowId/runs/:executionId',
            element: <ConsoleFlowRunPage />
          },
          {
            path: 'storage',
            element: <ConsoleStoragePage />
          },
          {
            path: 'observability',
            element: <ConsoleObservabilityPage />
          },
          { path: 'runtime', element: <RequirePlatformObserverRoute><ConsoleRuntimePage /></RequirePlatformObserverRoute>, handle: { platformGlobal: true } },
          {
            path: 'service-accounts',
            element: <ConsoleServiceAccountsPage />
          },
          {
            path: 'quotas',
            element: <ConsoleQuotasPage />
          },
          {
            path: 'operations',
            element: <ConsoleOperationsPage />
          },
          {
            path: 'operations/:operationId',
            element: <ConsoleOperationDetailPage />
          },
          {
            path: 'mcp/servers/:mcpServerId',
            element: <ConsoleMcpServerDetailPage />
          },
          {
            path: 'workspaces/:workspaceId/realtime',
            element: <ConsoleRealtimePage />
          },
          {
            path: 'workspaces/:workspaceId/docs',
            element: <ConsoleDocsPage />
          },
          {
            // Legacy superadmin secret-ROTATION mock pages (platform/tenant rotation plane) — left
            // functionally untouched; relabeled in the nav to disambiguate from Workspace Secrets.
            path: 'secrets',
            element: <ConsoleSecretsPage />
          },
          {
            path: 'secrets/:encodedSecretPath/rotate',
            element: <ConsoleSecretRotationPage />
          },
          {
            // Workspace function secrets (#723) — distinct from the rotation route above. Gated by a
            // coarse, fail-safe workspace-membership / tenant-admin / platform guard.
            path: 'workspace-secrets',
            element: (
              <RequireWorkspaceSecretsRoute>
                <ConsoleWorkspaceSecretsPage />
              </RequireWorkspaceSecretsRoute>
            )
          },
          {
            path: 'profile',
            element: <ConsoleProfilePage />
          },
          {
            path: 'settings',
            element: <ConsoleSettingsPage />
          },
          {
            path: '*',
            element: <ConsoleUnknownRouteState />
          }
            ]
          }
        ]
      }
    ]
  }
]

const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(appRoutes)

export default router
