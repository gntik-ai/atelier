import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OperationResultSummary } from './OperationResultSummary'

const mockUseOperationResult = vi.fn()

vi.mock('@/lib/console-operations', () => ({
  useOperationResult: (...args: unknown[]) => mockUseOperationResult(...args)
}))

describe('OperationResultSummary', () => {
  beforeEach(() => {
    mockUseOperationResult.mockReset()
  })

  it('F08 renders success summary and completion date', () => {
    mockUseOperationResult.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'result',
        operationId: 'op_1',
        status: 'completed',
        resultType: 'success',
        summary: 'Workspace aprovisionado',
        failureReason: null,
        retryable: null,
        completedAt: '2026-03-30T10:00:00.000Z'
      }
    })

    render(<OperationResultSummary operationId="op_1" />)

    expect(screen.getByText('Workspace aprovisionado')).toBeInTheDocument()
    expect(screen.getByText(/Completada el/i)).toBeInTheDocument()
  })

  it('F09 renders failure reason and retryability label', () => {
    mockUseOperationResult.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'result',
        operationId: 'op_2',
        status: 'failed',
        resultType: 'failure',
        summary: null,
        failureReason: 'Se agotó la cuota',
        retryable: true,
        completedAt: '2026-03-30T10:00:00.000Z'
      }
    })

    render(<OperationResultSummary operationId="op_2" />)

    expect(screen.getByText('Se agotó la cuota')).toBeInTheDocument()
    expect(screen.getByText('Esta operación puede reintentarse.')).toBeInTheDocument()
  })

  it('F10 renders pending state message', () => {
    mockUseOperationResult.mockReturnValue({
      isLoading: false,
      data: {
        queryType: 'result',
        operationId: 'op_3',
        status: 'running',
        resultType: 'pending',
        summary: null,
        failureReason: null,
        retryable: null,
        completedAt: null
      }
    })

    render(<OperationResultSummary operationId="op_3" />)

    expect(screen.getByRole('status')).toHaveTextContent('La operación aún está en curso.')
  })
})
