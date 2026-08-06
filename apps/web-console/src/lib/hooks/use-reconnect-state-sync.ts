import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchAsyncOperationQuery, type OperationListResponse, type OperationSummary } from '@/lib/console-operations'
import { requestConsoleSessionJson } from '@/lib/console-session'
import { ACTIVE_STATUSES } from '@/lib/generated/async-operation-status-vocabulary.mjs'
import { reconcileOperations, type ReconciliationDelta } from '@/lib/reconcile-operations'

export interface ReconnectStateSyncOptions {
  tenantId: string
  workspaceId: string | null
  localSnapshot?: ReadonlyMap<string, OperationSummary>
  onStateChanged?: (delta: ReconciliationDelta) => void
  debounceMs?: number
}

export interface ReconnectStateSyncResult {
  isSyncing: boolean
  lastSyncedAt: Date | null
  syncError: Error | null
}

export function createAuthExpiredError(): Error {
  const error = new Error('Tu sesión ha expirado. Vuelve a autenticarte para continuar.')
  error.name = 'ConsoleAuthExpiredError'
  return error
}

async function fetchAllActiveOperations(tenantId: string, workspaceId: string | null, signal: AbortSignal): Promise<OperationSummary[]> {
  const items: OperationSummary[] = []
  const limit = 100
  let offset = 0
  let total = 0

  do {
    const response = await fetchAsyncOperationQuery<OperationListResponse>(
      {
        queryType: 'list',
        filters: {
          status: [...ACTIVE_STATUSES],
          tenantId,
          workspaceId: workspaceId ?? undefined
        },
        pagination: { limit, offset }
      },
      signal
    )

    items.push(...(response.items ?? []))
    total = response.total ?? items.length
    offset += response.items?.length ?? 0

    if ((response.items?.length ?? 0) === 0) {
      break
    }
  } while (offset < total)

  return items
}

export function useReconnectStateSync(options: ReconnectStateSyncOptions): ReconnectStateSyncResult {
  const { tenantId, workspaceId, localSnapshot, onStateChanged, debounceMs = 500 } = options
  const snapshot = useMemo(() => localSnapshot ?? new Map<string, OperationSummary>(), [localSnapshot])
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [syncError, setSyncError] = useState<Error | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const runSync = useCallback(async () => {
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setIsSyncing(true)
    setSyncError(null)

    try {
      await requestConsoleSessionJson('/v1/console/session')
      const remoteOps = await fetchAllActiveOperations(tenantId, workspaceId, abortController.signal)
      const delta = reconcileOperations(snapshot, remoteOps)

      if (!mountedRef.current || abortController.signal.aborted) {
        return
      }

      console.debug('[reconnect-sync]', {
        tenantId,
        workspaceId,
        timestamp: new Date().toISOString(),
        updated: delta.updated.length,
        added: delta.added.length,
        terminal: delta.terminal.length,
        unavailable: delta.unavailable.length,
        unchanged: delta.unchanged.length
      })

      onStateChanged?.(delta)
      setLastSyncedAt(new Date())
      setIsSyncing(false)
    } catch (rawError) {
      if (!mountedRef.current || abortController.signal.aborted) {
        return
      }

      const maybeStatus = typeof rawError === 'object' && rawError !== null && 'status' in rawError ? (rawError as { status?: number }).status : undefined
      const nextError = maybeStatus === 401 ? createAuthExpiredError() : (rawError as Error)
      setSyncError(nextError)
      setIsSyncing(false)
    }
  }, [onStateChanged, snapshot, tenantId, workspaceId])

  const scheduleSync = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      void runSync()
    }, debounceMs)
  }, [clearTimer, debounceMs, runSync])

  useEffect(() => {
    mountedRef.current = true

    if (!tenantId) {
      return () => {
        mountedRef.current = false
        clearTimer()
        abortRef.current?.abort()
      }
    }

    const handleOnline = () => {
      scheduleSync()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleSync()
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mountedRef.current = false
      clearTimer()
      abortRef.current?.abort()
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [clearTimer, scheduleSync])

  return { isSyncing, lastSyncedAt, syncError }
}
