import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

export const ASYNC_OPERATION_QUERY_ENDPOINT = '/v1/async-operation-query'

export type OperationStatus = 'pending' | 'running' | 'completed' | 'failed'
export type OperationResultType = 'success' | 'failure' | 'pending'

export interface OperationFilters {
  status?: OperationStatus
  operationType?: string
  workspaceId?: string
  tenantId?: string
}

export interface PaginationParams {
  limit?: number
  offset?: number
}

export interface OperationSummary {
  operationId: string
  status: OperationStatus
  operationType: string
  tenantId: string
  workspaceId: string | null
  actorId: string
  actorType: string
  createdAt: string
  updatedAt: string
  correlationId: string
}

export interface OperationListResponse {
  queryType: 'list'
  items: OperationSummary[]
  total: number
  pagination: Required<PaginationParams>
}

export interface OperationDetailResponse {
  queryType: 'detail'
  operationId: string
  status: OperationStatus
  operationType: string
  tenantId: string
  workspaceId: string | null
  actorId: string
  actorType: string
  correlationId?: string
  idempotencyKey: string | null
  sagaId: string | null
  createdAt: string
  updatedAt: string
  errorSummary: { code?: string; message?: string; failedStep?: string | null } | null
}

export interface OperationLogEntry {
  logEntryId: string
  level: 'info' | 'warning' | 'error'
  message: string
  occurredAt: string
}

export interface OperationLogsResponse {
  queryType: 'logs'
  operationId: string
  entries: OperationLogEntry[]
  total: number
  pagination: Required<PaginationParams>
}

export interface OperationResultResponse {
  queryType: 'result'
  operationId: string
  status: OperationStatus
  resultType: OperationResultType
  summary: string | null
  failureReason: string | null
  retryable: boolean | null
  completedAt: string | null
}

interface AsyncOperationQueryRequest {
  queryType: 'list' | 'detail' | 'logs' | 'result'
  operationId?: string
  filters?: OperationFilters
  pagination?: Required<PaginationParams>
}

interface UseAsyncResourceOptions<T> {
  enabled?: boolean
  getNextInterval?: (data: T) => number | false
}

interface UseAsyncResourceResult<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

function normalizePagination(pagination?: PaginationParams): Required<PaginationParams> {
  const limit = typeof pagination?.limit === 'number' && pagination.limit > 0 ? Math.trunc(pagination.limit) : 20
  const offset = typeof pagination?.offset === 'number' && pagination.offset >= 0 ? Math.trunc(pagination.offset) : 0

  return { limit, offset }
}

function hasActiveOperations(items: OperationSummary[] = []): boolean {
  return items.some((item) => item.status === 'pending' || item.status === 'running')
}

export async function fetchAsyncOperationQuery<T>(body: AsyncOperationQueryRequest, signal?: AbortSignal): Promise<T> {
  return requestConsoleSessionJson<T>(ASYNC_OPERATION_QUERY_ENDPOINT, {
    method: 'POST',
    body: body as unknown as JsonValue,
    idempotent: true,
    signal
  })
}

function useAsyncResource<T>(
  requestFactory: (signal: AbortSignal) => Promise<T>,
  dependencyKey: string,
  options: UseAsyncResourceOptions<T> = {}
): UseAsyncResourceResult<T> {
  const { enabled = true, getNextInterval } = options
  const [data, setData] = useState<T>()
  const [isLoading, setIsLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refetch = useCallback(() => {
    clearTimer()
    setReloadToken((current) => current + 1)
  }, [clearTimer])

  useEffect(() => {
    if (!enabled) {
      clearTimer()
      setIsLoading(false)
      return undefined
    }

    const abortController = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading((current) => current || reloadToken === 0)
      setError(null)

      try {
        const nextData = await requestFactory(abortController.signal)
        if (cancelled) {
          return
        }

        setData(nextData)
        setIsLoading(false)

        const interval = getNextInterval?.(nextData) ?? false
        clearTimer()

        if (interval && interval > 0) {
          timerRef.current = window.setTimeout(() => {
            void load()
          }, interval)
        }
      } catch (rawError) {
        if (cancelled || abortController.signal.aborted) {
          return
        }

        setError(rawError as Error)
        setIsLoading(false)
      }
    }

    clearTimer()
    void load()

    return () => {
      cancelled = true
      abortController.abort()
      clearTimer()
    }
  }, [clearTimer, dependencyKey, enabled, getNextInterval, reloadToken, requestFactory])

  return { data, isLoading, error, refetch }
}

export function useOperations(filters?: OperationFilters, pagination?: PaginationParams) {
  const normalizedPagination = useMemo(() => normalizePagination(pagination), [pagination])
  const dependencyKey = useMemo(
    () => JSON.stringify({ queryType: 'list', filters: filters ?? {}, pagination: normalizedPagination }),
    [filters, normalizedPagination]
  )
  const requestFactory = useCallback(
    (signal: AbortSignal) =>
      fetchAsyncOperationQuery<OperationListResponse>(
        {
          queryType: 'list',
          filters,
          pagination: normalizedPagination
        },
        signal
      ),
    [filters, normalizedPagination]
  )
  const getNextInterval = useCallback((response: OperationListResponse) => (hasActiveOperations(response.items) ? 30_000 : false), [])

  return useAsyncResource(requestFactory, dependencyKey, { getNextInterval })
}

export function useOperationDetail(operationId: string | undefined) {
  const enabled = Boolean(operationId)
  const dependencyKey = useMemo(() => JSON.stringify({ queryType: 'detail', operationId: operationId ?? null }), [operationId])
  const requestFactory = useCallback(
    (signal: AbortSignal) =>
      fetchAsyncOperationQuery<OperationDetailResponse>(
        {
          queryType: 'detail',
          operationId,
          pagination: normalizePagination()
        },
        signal
      ),
    [operationId]
  )

  return useAsyncResource(requestFactory, dependencyKey, { enabled })
}

export function useOperationLogs(operationId: string | undefined, pagination?: PaginationParams) {
  const enabled = Boolean(operationId)
  const normalizedPagination = useMemo(() => normalizePagination(pagination), [pagination])
  const dependencyKey = useMemo(
    () => JSON.stringify({ queryType: 'logs', operationId: operationId ?? null, pagination: normalizedPagination }),
    [operationId, normalizedPagination]
  )
  const requestFactory = useCallback(
    (signal: AbortSignal) =>
      fetchAsyncOperationQuery<OperationLogsResponse>(
        {
          queryType: 'logs',
          operationId,
          pagination: normalizedPagination
        },
        signal
      ),
    [normalizedPagination, operationId]
  )

  return useAsyncResource(requestFactory, dependencyKey, { enabled })
}

export function useOperationResult(operationId: string | undefined) {
  const enabled = Boolean(operationId)
  const dependencyKey = useMemo(() => JSON.stringify({ queryType: 'result', operationId: operationId ?? null }), [operationId])
  const requestFactory = useCallback(
    (signal: AbortSignal) =>
      fetchAsyncOperationQuery<OperationResultResponse>(
        {
          queryType: 'result',
          operationId,
          pagination: normalizePagination()
        },
        signal
      ),
    [operationId]
  )

  return useAsyncResource(requestFactory, dependencyKey, { enabled })
}

export function useActiveOperationsCount() {
  const [count, setCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refetch = useCallback(() => {
    clearTimer()
    setReloadToken((current) => current + 1)
  }, [clearTimer])

  useEffect(() => {
    const abortController = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading(true)

      try {
        const [running, pending] = await Promise.all([
          fetchAsyncOperationQuery<OperationListResponse>(
            {
              queryType: 'list',
              filters: { status: 'running' },
              pagination: { limit: 1, offset: 0 }
            },
            abortController.signal
          ),
          fetchAsyncOperationQuery<OperationListResponse>(
            {
              queryType: 'list',
              filters: { status: 'pending' },
              pagination: { limit: 1, offset: 0 }
            },
            abortController.signal
          )
        ])

        if (cancelled) {
          return
        }

        const nextCount = (running.total ?? 0) + (pending.total ?? 0)
        setCount(nextCount)
        setIsLoading(false)
        clearTimer()

        if (nextCount > 0) {
          timerRef.current = window.setTimeout(() => {
            void load()
          }, 15_000)
        }
      } catch (error) {
        if (cancelled || abortController.signal.aborted) {
          return
        }

        setCount(0)
        setIsLoading(false)
      }
    }

    clearTimer()
    void load()

    return () => {
      cancelled = true
      abortController.abort()
      clearTimer()
    }
  }, [clearTimer, reloadToken])

  return { count, isLoading, refetch }
}
