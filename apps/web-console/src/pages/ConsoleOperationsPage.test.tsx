import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleOperationsPage } from './ConsoleOperationsPage'

const mockUseOperations = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@/lib/console-operations', () => ({
  useOperations: (...args: unknown[]) => mockUseOperations(...args)
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

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'failed' } })

    expect(mockUseOperations).toHaveBeenLastCalledWith({ status: 'failed', operationType: undefined, workspaceId: undefined }, { limit: 20, offset: 0 })
  })

  it('F15 renders empty state when there are no operations', () => {
    mockUseOperations.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: { queryType: 'list', total: 0, pagination: { limit: 20, offset: 0 }, items: [] }
    })

    render(<ConsoleOperationsPage />)

    expect(screen.getByText('No hay operaciones registradas para este tenant.')).toBeInTheDocument()
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
