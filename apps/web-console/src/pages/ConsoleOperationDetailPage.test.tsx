import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleOperationDetailPage } from './ConsoleOperationDetailPage'

const mockUseOperationDetail = vi.fn()

vi.mock('@/lib/console-operations', () => ({
  useOperationDetail: (...args: unknown[]) => mockUseOperationDetail(...args)
}))

vi.mock('@/components/console/OperationLogEntriesList', () => ({
  OperationLogEntriesList: ({ operationId }: { operationId: string }) => <div>Logs resumidos mock: {operationId}</div>
}))

vi.mock('@/components/console/OperationResultSummary', () => ({
  OperationResultSummary: ({ operationId }: { operationId: string }) => <div>Resultado mock: {operationId}</div>
}))

describe('ConsoleOperationDetailPage', () => {
  beforeEach(() => {
    mockUseOperationDetail.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  function renderPage(path = '/console/operations/op_1') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/console/operations/:operationId" element={<ConsoleOperationDetailPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('F17 renders heading and status badge', () => {
    mockUseOperationDetail.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'detail',
        operationId: 'op_1',
        status: 'running',
        operationType: 'workspace.create',
        tenantId: 'tenant_a',
        workspaceId: 'wrk_1',
        actorId: 'usr_1',
        actorType: 'tenant_owner',
        correlationId: 'corr_1',
        idempotencyKey: null,
        sagaId: null,
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        errorSummary: null
      }
    })

    renderPage()

    expect(screen.getByRole('heading', { name: 'Detalle de operación' })).toBeInTheDocument()
    expect(screen.getByText('En curso')).toBeInTheDocument()
  })

  it('F18/F19 renders logs and result sections', () => {
    mockUseOperationDetail.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'detail',
        operationId: 'op_1',
        status: 'completed',
        operationType: 'workspace.create',
        tenantId: 'tenant_a',
        workspaceId: 'wrk_1',
        actorId: 'usr_1',
        actorType: 'tenant_owner',
        correlationId: 'corr_1',
        idempotencyKey: null,
        sagaId: null,
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        errorSummary: null
      }
    })

    renderPage()

    expect(screen.getByRole('heading', { name: 'Logs resumidos' })).toBeInTheDocument()
    expect(screen.getByText('Logs resumidos mock: op_1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Resultado' })).toBeInTheDocument()
    expect(screen.getByText('Resultado mock: op_1')).toBeInTheDocument()
  })

  it('F20 renders not found message when detail is unavailable', () => {
    mockUseOperationDetail.mockReturnValue({
      isLoading: false,
      data: undefined
    })

    renderPage()

    expect(screen.getByText('Operación no encontrada o no disponible.')).toBeInTheDocument()
  })
})
