import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ASYNC_OPERATION_QUERY_ENDPOINT,
  useActiveOperationsCount,
  useOperations
} from './console-operations'

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

  it('F23 returns the sum of pending and running operations', async () => {
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ queryType: 'list', total: 2, pagination: { limit: 1, offset: 0 }, items: [] })
      .mockResolvedValueOnce({ queryType: 'list', total: 1, pagination: { limit: 1, offset: 0 }, items: [] })

    const { result } = renderHook(() => useActiveOperationsCount())

    await act(async () => {
      await flushAsyncWork()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.count).toBe(3)
    expect(mockRequestConsoleSessionJson).toHaveBeenNthCalledWith(
      1,
      ASYNC_OPERATION_QUERY_ENDPOINT,
      expect.objectContaining({ body: expect.objectContaining({ filters: { status: 'running' } }) })
    )
    expect(mockRequestConsoleSessionJson).toHaveBeenNthCalledWith(
      2,
      ASYNC_OPERATION_QUERY_ENDPOINT,
      expect.objectContaining({ body: expect.objectContaining({ filters: { status: 'pending' } }) })
    )
  })

  it('F24 returns zero and stops polling when there are no active operations', async () => {
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ queryType: 'list', total: 0, pagination: { limit: 1, offset: 0 }, items: [] })
      .mockResolvedValueOnce({ queryType: 'list', total: 0, pagination: { limit: 1, offset: 0 }, items: [] })

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

    expect(mockRequestConsoleSessionJson).toHaveBeenCalledTimes(2)
  })
})
