import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleOperationsPage } from './ConsoleOperationsPage'

const mockUseOperations = vi.fn()
const mockNavigate = vi.fn()
const mockUseReconnectStateSync = vi.fn()

vi.mock('@/lib/console-operations', () => ({
  useOperations: (...args: unknown[]) => mockUseOperations(...args)
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => ({ activeTenantId: 'tenant_a', activeWorkspaceId: 'wrk_1' })
}))

vi.mock('@/lib/hooks/use-reconnect-state-sync', () => ({
  useReconnectStateSync: (...args: unknown[]) => mockUseReconnectStateSync(...args)
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

describe('ConsoleOperationsPage', () => {
  beforeEach(() => {
    mockUseOperations.mockReset()
    mockNavigate.mockReset()
    mockUseReconnectStateSync.mockReset()
    mockUseReconnectStateSync.mockReturnValue({ isSyncing: false, lastSyncedAt: null, syncError: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('F13 renders a table with mocked operations', () => {
    mockUseOperations.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: {
        queryType: 'list',
        total: 2,
        pagination: { limit: 20, offset: 0 },
        items: [
          {
            operationId: 'op_1',
            status: 'running',
            operationType: 'workspace.create',
            tenantId: 'tenant_a',
            workspaceId: 'wrk_1',
            actorId: 'usr_1',
            actorType: 'tenant_owner',
            createdAt: '2026-03-30T10:00:00.000Z',
            updatedAt: '2026-03-30T10:00:00.000Z',
            correlationId: 'corr_1'
          },
          {
            operationId: 'op_2',
            status: 'failed',
            operationType: 'workspace.delete',
            tenantId: 'tenant_a',
            workspaceId: 'wrk_2',
            actorId: 'usr_2',
            actorType: 'tenant_owner',
            createdAt: '2026-03-30T11:00:00.000Z',
            updatedAt: '2026-03-30T11:00:00.000Z',
            correlationId: 'corr_2'
          }
        ]
      }
    })

    render(<ConsoleOperationsPage />)

    expect(screen.getByRole('heading', { name: 'Operaciones' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'workspace.create' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'workspace.delete' })).toBeInTheDocument()
  })

  it('F14 passes the selected status filter back to useOperations', () => {
    mockUseOperations.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: { queryType: 'list', total: 0, pagination: { limit: 20, offset: 0 }, items: [] }
    })

    render(<ConsoleOperationsPage />)

    const statusFilter = screen.getByLabelText('Filtrar por estado')
    expect(statusFilter).toHaveClass('h-11')
    expect(screen.getByLabelText('Filtrar por tipo de operación')).toHaveClass('h-11')
    expect(Array.from((statusFilter as HTMLSelectElement).options).map((option) => [option.value, option.text])).toEqual([
      ['', 'Todos'],
      ['pending', 'Pendiente'],
      ['running', 'En curso'],
      ['completed', 'Completada'],
      ['failed', 'Fallida'],
      ['timed_out', 'Expirada'],
      ['cancelling', 'Cancelando'],
      ['cancelled', 'Cancelada']
    ])

    fireEvent.change(statusFilter, { target: { value: 'cancelling' } })

    expect(mockUseOperations).toHaveBeenLastCalledWith({ status: 'cancelling', operationType: undefined, workspaceId: undefined }, { limit: 20, offset: 0 })
  })

  it('F15 renders empty state when there are no operations', () => {
    mockUseOperations.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: { queryType: 'list', total: 0, pagination: { limit: 20, offset: 0 }, items: [] }
    })

    render(<ConsoleOperationsPage />)

    expect(screen.getByText('No hay operaciones registradas para esta organización.')).toBeInTheDocument()
  })

  it('renders the operations error state with a manual retry action', () => {
    const refetch = vi.fn()
    mockUseOperations.mockReturnValue({
      isLoading: false,
      error: new Error('async_operations missing'),
      refetch,
      data: undefined
    })

    render(<ConsoleOperationsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las operaciones.')
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders accessible loading feedback before operations are available', () => {
    mockUseOperations.mockReturnValue({
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      data: undefined
    })

    render(<ConsoleOperationsPage />)

    expect(screen.getByRole('status', { name: 'Cargando operaciones' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument()
  })

  it('F16 navigates to detail page when a row is clicked', () => {
    mockUseOperations.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: {
        queryType: 'list',
        total: 1,
        pagination: { limit: 20, offset: 0 },
        items: [
          {
            operationId: 'op_click',
            status: 'completed',
            operationType: 'workspace.create',
            tenantId: 'tenant_a',
            workspaceId: 'wrk_1',
            actorId: 'usr_1',
            actorType: 'tenant_owner',
            createdAt: '2026-03-30T10:00:00.000Z',
            updatedAt: '2026-03-30T10:00:00.000Z',
            correlationId: 'corr_1'
          }
        ]
      }
    })

    render(<ConsoleOperationsPage />)

    fireEvent.click(screen.getByRole('cell', { name: 'workspace.create' }))

    expect(mockNavigate).toHaveBeenCalledWith('/console/operations/op_click')
  })
})
