import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ASYNC_OPERATION_QUERY_ENDPOINT,
  useActiveOperationsCount,
  useOperations
} from './console-operations'
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from './generated/async-operation-status-vocabulary.mjs'

const mockRequestConsoleSessionJson = vi.fn()

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('console-operations hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRequestConsoleSessionJson.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('F21 enables polling every 30 seconds when there are running operations', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({
      queryType: 'list',
      total: 1,
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
        }
      ]
    })

    renderHook(() => useOperations())

    await act(async () => {
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith(
      ASYNC_OPERATION_QUERY_ENDPOINT,
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({ queryType: 'list' }) })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(2)
  })

  it('F22 disables polling when all operations are completed', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({
      queryType: 'list',
      total: 1,
      pagination: { limit: 20, offset: 0 },
      items: [
        {
          operationId: 'op_1',
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
    })

    renderHook(() => useOperations())

    await act(async () => {
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)
  })

  it('C-12 keeps polling for cancelling and stops for every terminal status', async () => {
    const operation = (status: (typeof ACTIVE_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number]) => ({
      operationId: `op_${status}`,
      status,
      operationType: 'workspace.create',
      tenantId: 'tenant_a',
      workspaceId: 'wrk_1',
      actorId: 'usr_1',
      actorType: 'tenant_owner',
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
      correlationId: `corr_${status}`
    })

    mockRequestConsoleSessionJson.mockResolvedValue({
      queryType: 'list',
      total: 1,
      pagination: { limit: 20, offset: 0 },
      items: [operation('cancelling')]
    })
    const cancellingHook = renderHook(() => useOperations())
    await act(async () => { await flushAsyncWork() })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsyncWork()
    })
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(2)
    cancellingHook.unmount()

    for (const terminalStatus of TERMINAL_STATUSES) {
      mockRequestConsoleSessionJson.mockReset()
      mockRequestConsoleSessionJson.mockResolvedValue({
        queryType: 'list',
        total: 1,
        pagination: { limit: 20, offset: 0 },
        items: [operation(terminalStatus)]
      })
      const terminalHook = renderHook(() => useOperations())
      await act(async () => { await flushAsyncWork() })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
        await flushAsyncWork()
      })
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)
      terminalHook.unmount()
    }
  })

  it('bounds retries when the operations query keeps failing', async () => {
    mockRequestConsoleSessionJson.mockRejectedValue(new Error('async_operations missing'))

    const { result } = renderHook(() => useOperations(undefined, { limit: 20, offset: 0 }))

    await act(async () => {
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(3)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error?.message).toBe('async_operations missing')
  })

  it('shows loading feedback while a manual retry is pending after an exhausted no-data failure', async () => {
    mockRequestConsoleSessionJson.mockRejectedValue(new Error('async_operations missing'))

    const { result } = renderHook(() => useOperations(undefined, { limit: 20, offset: 0 }))

    await act(async () => {
      await flushAsyncWork()
      await vi.advanceTimersByTimeAsync(1_000)
      await flushAsyncWork()
      await vi.advanceTimersByTimeAsync(3_000)
      await flushAsyncWork()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error?.message).toBe('async_operations missing')

    mockRequestConsoleSessionJson.mockImplementation(() => new Promise<never>(() => {}))

    await act(async () => {
      result.current.refetch()
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(4)
    expect(result.current.error).toBeNull()
    expect(result.current.isLoading).toBe(true)
  })

  it('F23/C-12 returns one active-set union total including cancelling', async () => {
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ queryType: 'list', total: 3, pagination: { limit: 1, offset: 0 }, items: [] })

    const { result } = renderHook(() => useActiveOperationsCount())

    await act(async () => {
      await flushAsyncWork()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.count).toBe(3)
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith(
      ASYNC_OPERATION_QUERY_ENDPOINT,
      expect.objectContaining({ body: expect.objectContaining({ filters: { status: [...ACTIVE_STATUSES] } }) })
    )
  })

  it('F24 returns zero and stops polling when there are no active operations', async () => {
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ queryType: 'list', total: 0, pagination: { limit: 1, offset: 0 }, items: [] })

    const { result } = renderHook(() => useActiveOperationsCount())

    await act(async () => {
      await flushAsyncWork()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.count).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await flushAsyncWork()
    })

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(1)
  })
})
