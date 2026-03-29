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
            element: (
              <ConsolePlaceholderPage
                badge="Tenants"
                title="Gestión de tenants"
                description="Placeholder navegable para la futura administración de tenants, aislamiento lógico y gobierno de plataforma."
              />
            )
          },
          {
            path: 'workspaces',
            element: (
              <ConsolePlaceholderPage
                badge="Workspaces"
                title="Gestión de workspaces"
                description="Placeholder navegable para la organización operacional de recursos por workspace dentro del tenant."
              />
            )
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
            path: 'functions',
            element: (
              <ConsolePlaceholderPage
                badge="Functions"
                title="Functions y runtime serverless"
                description="Placeholder navegable para el dominio de funciones, despliegues y ejecución basada en Apache OpenWhisk."
              />
            )
          },
          {
            path: 'storage',
            element: (
              <ConsolePlaceholderPage
                badge="Storage"
                title="Storage y objetos"
                description="Placeholder navegable para buckets, políticas, consumo y capacidades de almacenamiento compatibles con S3."
              />
            )
          },
          {
            path: 'observability',
            element: (
              <ConsolePlaceholderPage
                badge="Observability"
                title="Observabilidad y auditoría"
                description="Placeholder navegable para métricas, alertas, consultas de auditoría y señales operativas del producto."
              />
            )
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
