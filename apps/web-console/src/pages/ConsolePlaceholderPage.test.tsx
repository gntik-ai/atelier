import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const useConsoleContextMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/console-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-context')>('@/lib/console-context')

  return {
    ...actual,
    useConsoleContext: useConsoleContextMock
  }
})

import { ConsolePlaceholderPage } from './ConsolePlaceholderPage'

describe('ConsolePlaceholderPage', () => {
  afterEach(() => {
    cleanup()
    useConsoleContextMock.mockReset()
  })

  it('muestra los resúmenes de cuotas e inventario cuando hay datos disponibles', () => {
    useConsoleContextMock.mockReturnValue(createContextValue())

    render(
      <ConsolePlaceholderPage
        badge="Functions"
        title="Functions y runtime serverless"
        description="Vista contextual del dominio serverless."
      />
    )

    expect(screen.getByTestId('console-tenant-quota-summary')).toBeInTheDocument()
    expect(screen.getByText(/estado de cuotas del tenant activo/i)).toBeInTheDocument()
    expect(screen.getByText(/invocations_per_minute/i)).toBeInTheDocument()

    expect(screen.getByTestId('console-tenant-inventory-summary')).toBeInTheDocument()
    expect(screen.getByText(/composición del tenant activo/i)).toBeInTheDocument()
    expect(screen.getByText(/workspace-prod/i)).toBeInTheDocument()
  })

  it('oculta las secciones opcionales cuando no hay datos de cuota o inventario', () => {
    useConsoleContextMock.mockReturnValue(
      createContextValue({
        activeTenant: {
          ...createContextValue().activeTenant,
          quotaSummary: null,
          inventorySummary: null
        }
      })
    )

    render(
      <ConsolePlaceholderPage
        badge="Overview"
        title="Vista general de la consola"
        description="Resumen inicial del producto."
      />
    )

    expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
  })

  it('refleja el contexto activo aunque todavía no exista workspace seleccionado', () => {
    useConsoleContextMock.mockReturnValue(
      createContextValue({
        activeWorkspace: null
      })
    )

    render(
      <ConsolePlaceholderPage
        badge="Tenants"
        title="Gestión de tenants"
        description="Administración base de tenants."
      />
    )

    expect(screen.getByText(/tenant: tenant alpha/i)).toBeInTheDocument()
    expect(screen.getByText(/estado workspace: sin workspace activo/i)).toBeInTheDocument()
  })
})

function createContextValue(overrides: Record<string, unknown> = {}) {
  return {
    tenants: [],
    workspaces: [],
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_prod',
    activeTenant: {
      tenantId: 'ten_alpha',
      label: 'Tenant Alpha',
      secondary: 'tenant-alpha',
      state: 'active',
      governanceStatus: 'nominal',
      provisioningStatus: 'completed',
      quotaSummary: {
        totals: {
          nominal: 1,
          warning: 1,
          blocked: 1
        },
        items: [
          {
            metricKey: 'storage_gb',
            scope: 'tenant',
            used: 80,
            limit: 100,
            remaining: 20,
            utilizationPercent: 80,
            severity: 'warning',
            unit: 'GB'
          },
          {
            metricKey: 'invocations_per_minute',
            scope: 'workspace',
            used: 1000,
            limit: 1000,
            remaining: 0,
            utilizationPercent: 100,
            severity: 'blocked',
            unit: 'rpm'
          }
        ]
      },
      inventorySummary: {
        tenantId: 'ten_alpha',
        workspaceCount: 2,
        applicationCount: 7,
        managedResourceCount: 19,
        serviceAccountCount: 4,
        workspaces: [
          {
            workspaceId: 'wrk_prod',
            workspaceSlug: 'workspace-prod',
            environment: 'prod',
            state: 'active',
            applicationCount: 5,
            serviceAccountCount: 3,
            managedResourceCount: 11
          }
        ]
      }
    },
    activeWorkspace: {
      workspaceId: 'wrk_prod',
      tenantId: 'ten_alpha',
      label: 'Workspace Prod',
      secondary: 'workspace-prod · prod',
      environment: 'prod',
      state: 'active',
      provisioningStatus: 'completed'
    },
    operationalAlerts: [],
    tenantsLoading: false,
    workspacesLoading: false,
    tenantsError: null,
    workspacesError: null,
    selectTenant: vi.fn(),
    selectWorkspace: vi.fn(),
    reloadTenants: vi.fn(),
    reloadWorkspaces: vi.fn(),
    ...overrides
  }
}
