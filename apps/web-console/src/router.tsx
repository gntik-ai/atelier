import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { ConsoleShellLayout } from '@/layouts/ConsoleShellLayout'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PendingActivationPage } from '@/pages/PendingActivationPage'
import { ConsoleAuthPage } from '@/pages/ConsoleAuthPage'
import { ConsoleMembersPage } from '@/pages/ConsoleMembersPage'
import { ConsolePlaceholderPage } from '@/pages/ConsolePlaceholderPage'
import { ConsoleTenantsPage } from '@/pages/ConsoleTenantsPage'
import { ConsoleWorkspacesPage } from '@/pages/ConsoleWorkspacesPage'
import { SignupPage } from '@/pages/SignupPage'
import { WelcomePage } from '@/pages/WelcomePage'

const ConsolePostgresPage = lazy(async () => {
  const module = await import('@/pages/ConsolePostgresPage')
  return { default: module.ConsolePostgresPage }
})

const ConsoleMongoPage = lazy(async () => {
  const module = await import('@/pages/ConsoleMongoPage')
  return { default: module.ConsoleMongoPage }
})

const ConsoleKafkaPage = lazy(async () => {
  const module = await import('@/pages/ConsoleKafkaPage')
  return { default: module.ConsoleKafkaPage }
})

const ConsoleFunctionsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFunctionsPage')
  return { default: module.ConsoleFunctionsPage }
})

const ConsoleStoragePage = lazy(async () => {
  const module = await import('@/pages/ConsoleStoragePage')
  return { default: module.ConsoleStoragePage }
})

const ConsoleObservabilityPage = lazy(async () => {
  const module = await import('@/pages/ConsoleObservabilityPage')
  return { default: module.ConsoleObservabilityPage }
})

const ConsoleServiceAccountsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleServiceAccountsPage')
  return { default: module.ConsoleServiceAccountsPage }
})

const ConsoleQuotasPage = lazy(async () => {
  const module = await import('@/pages/ConsoleQuotasPage')
  return { default: module.ConsoleQuotasPage }
})

const ConsoleOperationsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleOperationsPage')
  return { default: module.ConsoleOperationsPage }
})

const ConsoleOperationDetailPage = lazy(async () => {
  const module = await import('@/pages/ConsoleOperationDetailPage')
  return { default: module.ConsoleOperationDetailPage }
})

const ConsoleRealtimePage = lazy(async () => {
  const module = await import('@/pages/ConsoleRealtimePage')
  return { default: module.ConsoleRealtimePage }
})

// T05 endurece la entrada a `/console/*` con guardas de sesión y refresh on-demand.
export const appRoutes = [
  {
    path: '/',
    element: <WelcomePage />
  },
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/signup',
    element: <SignupPage />
  },
  {
    path: '/signup/pending-activation',
    element: <PendingActivationPage />
  },
  {
    path: '/console',
    element: <ProtectedRoute />,
    children: [
      {
        element: <ConsoleShellLayout />,
        children: [
          {
            index: true,
            element: <Navigate replace to="overview" />
          },
          {
            path: 'overview',
            element: (
              <ConsolePlaceholderPage
                badge="Overview"
                title="Vista general de la consola"
                description="Resumen inicial del producto y punto de entrada persistente para la navegación administrativa del BaaS multi-tenant."
              />
            )
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
            path: 'members',
            element: <ConsoleMembersPage />
          },
          {
            path: 'auth',
            element: <ConsoleAuthPage />
          },
          {
            path: 'postgres',
            element: <ConsolePostgresPage />
          },
          {
            path: 'mongo',
            element: <ConsoleMongoPage />
          },
          {
            path: 'kafka',
            element: <ConsoleKafkaPage />
          },
          {
            path: 'functions',
            element: <ConsoleFunctionsPage />
          },
          {
            path: 'storage',
            element: <ConsoleStoragePage />
          },
          {
            path: 'observability',
            element: <ConsoleObservabilityPage />
          },
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
            path: 'workspaces/:workspaceId/realtime',
            element: <ConsoleRealtimePage />
          },
          {
            path: 'profile',
            element: (
              <ConsolePlaceholderPage
                badge="Profile"
                title="Perfil de usuario"
                description="Entrada base para la futura gestión del perfil del operador autenticado dentro de la consola."
              />
            )
          },
          {
            path: 'settings',
            element: (
              <ConsolePlaceholderPage
                badge="Settings"
                title="Ajustes de consola"
                description="Entrada base para los ajustes operativos y preferencias de la experiencia administrativa."
              />
            )
          },
          {
            path: '*',
            element: <Navigate replace to="/console/overview" />
          }
        ]
      }
    ]
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]

const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(appRoutes)

export default router
