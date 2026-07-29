import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OperationSummary } from '@/lib/console-operations'

import { useReconnectStateSync } from './use-reconnect-state-sync'

const mockRequestConsoleSessionJson = vi.fn()
const mockFetchAsyncOperationQuery = vi.fn()

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

vi.mock('@/lib/console-operations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-operations')>('@/lib/console-operations')
  return {
    ...actual,
    fetchAsyncOperationQuery: (...args: unknown[]) => mockFetchAsyncOperationQuery(...args)
  }
})

function op(operationId: string, status: OperationSummary['status']): OperationSummary {
  return {
    operationId,
    status,
    operationType: 'workspace.create',
    tenantId: 'tenant-a',
    workspaceId: 'wrk-a',
    actorId: 'usr-1',
    actorType: 'tenant_owner',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
    correlationId: `corr-${operationId}`
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useReconnectStateSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRequestConsoleSessionJson.mockReset()
    mockFetchAsyncOperationQuery.mockReset()
    mockRequestConsoleSessionJson.mockResolvedValue({ ok: true })
    mockFetchAsyncOperationQuery.mockResolvedValue({ queryType: 'list', items: [], total: 0, pagination: { limit: 100, offset: 0 } })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('no-fetch-on-token-expired', async () => {
    mockRequestConsoleSessionJson.mockRejectedValue({ status: 401, code: 'HTTP_401', message: 'Unauthorized' })
    const { result } = renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(result.current.syncError?.name).toBe('ConsoleAuthExpiredError')
    expect(mockFetchAsyncOperationQuery).not.toHaveBeenCalled()
  })

  it('no-fetch-on-hidden-tab', async () => {
    renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(mockFetchAsyncOperationQuery).not.toHaveBeenCalled()
  })

  it('fetch-on-visible-tab', async () => {
    renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledTimes(1)
  })

  it('requests the running-pending union once and reconciles both states', async () => {
    const onStateChanged = vi.fn()
    mockFetchAsyncOperationQuery.mockResolvedValue({
      queryType: 'list',
      items: [op('op-running', 'running'), op('op-pending', 'pending')],
      total: 2,
      pagination: { limit: 100, offset: 0 }
    })
    renderHook(() =>
      useReconnectStateSync({
        tenantId: 'tenant-a',
        workspaceId: 'wrk-a',
        onStateChanged
      })
    )

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledTimes(1)
    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledWith(
      {
        queryType: 'list',
        filters: {
          status: ['running', 'pending'],
          tenantId: 'tenant-a',
          workspaceId: 'wrk-a'
        },
        pagination: { limit: 100, offset: 0 }
      },
      expect.any(AbortSignal)
    )
    expect(onStateChanged).toHaveBeenCalledTimes(1)
    expect(onStateChanged.mock.calls[0]?.[0].added.map((item: OperationSummary) => item.operationId)).toEqual([
      'op-running',
      'op-pending'
    ])
  })

  it('debounce', async () => {
    renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a', debounceMs: 500 }))

    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        window.dispatchEvent(new Event('online'))
      }
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledTimes(1)
  })

  it('is-syncing-lifecycle', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined
    mockFetchAsyncOperationQuery.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )

    const { result } = renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await Promise.resolve()
    })

    expect(result.current.isSyncing).toBe(true)

    await act(async () => {
      resolveFetch?.({ queryType: 'list', items: [], total: 0, pagination: { limit: 100, offset: 0 } })
      await flush()
    })

    expect(result.current.isSyncing).toBe(false)
  })

  it('last-synced-at', async () => {
    const { result } = renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(result.current.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('sync-error-on-api-failure', async () => {
    mockFetchAsyncOperationQuery.mockRejectedValue(new Error('backend down'))
    const { result } = renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(result.current.syncError?.message).toContain('backend down')
  })

  it('cleanup-on-unmount', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() =>
      useReconnectStateSync({
        tenantId: 'tenant-a',
        workspaceId: 'wrk-a',
        localSnapshot: new Map([[ 'op-1', op('op-1', 'running') ]])
      })
    )

    unmount()

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
