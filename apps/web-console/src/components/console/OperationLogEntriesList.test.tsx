import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OperationLogEntriesList } from './OperationLogEntriesList'

const mockUseOperationLogs = vi.fn()

vi.mock('@/lib/console-operations', () => ({
  useOperationLogs: (...args: unknown[]) => mockUseOperationLogs(...args)
}))

describe('OperationLogEntriesList', () => {
  beforeEach(() => {
    mockUseOperationLogs.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('F05 renders log entries with message and level', () => {
    mockUseOperationLogs.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'logs',
        operationId: 'op_1',
        total: 2,
        pagination: { limit: 20, offset: 0 },
        entries: [
          { logEntryId: 'log_1', level: 'info', message: 'Inicio', occurredAt: '2026-03-30T10:00:00.000Z' },
          { logEntryId: 'log_2', level: 'warning', message: 'Reintento', occurredAt: '2026-03-30T10:02:00.000Z' }
        ]
      }
    })

    render(<OperationLogEntriesList operationId="op_1" />)

    expect(screen.getByText('Inicio')).toBeInTheDocument()
    expect(screen.getByText('Reintento')).toBeInTheDocument()
    expect(screen.getByText('info')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
  })

  it('F06 renders empty state when there are no log entries', () => {
    mockUseOperationLogs.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'logs',
        operationId: 'op_2',
        total: 0,
        pagination: { limit: 20, offset: 0 },
        entries: []
      }
    })

    render(<OperationLogEntriesList operationId="op_2" />)

    expect(screen.getByRole('status')).toHaveTextContent('La operación aún no ha comenzado a ejecutarse.')
  })

  it('F07 advances pagination when next button is clicked', () => {
    mockUseOperationLogs.mockImplementation((_operationId: string, pagination?: { offset?: number; limit?: number }) => ({
      isLoading: false,
      data: {
        queryType: 'logs',
        operationId: 'op_3',
        total: 40,
        pagination: { limit: pagination?.limit ?? 20, offset: pagination?.offset ?? 0 },
        entries: [{ logEntryId: 'log_1', level: 'info', message: 'Inicio', occurredAt: '2026-03-30T10:00:00.000Z' }]
      }
    }))

    render(<OperationLogEntriesList operationId="op_3" />)

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    expect(mockUseOperationLogs).toHaveBeenLastCalledWith('op_3', { limit: 20, offset: 20 })
  })
})
