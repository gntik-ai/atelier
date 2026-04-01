import { useCallback, useEffect, useState } from 'react'
import { getOperation, type OperationResponse } from '@/services/backupOperationsApi'

const POLL_INTERVAL_MS = 5000

interface UseOperationStatusResult {
  data: OperationResponse | null
  loading: boolean
  error: Error | null
}

export function useOperationStatus(
  operationId: string | null,
  token?: string,
): UseOperationStatusResult {
  const [data, setData] = useState<OperationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetch_ = useCallback(async () => {
    if (!operationId || !token) return
    setLoading(true)
    try {
      const res = await getOperation(operationId, token)
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [operationId, token])

  useEffect(() => {
    if (!operationId || !token) return
    void fetch_()

    const isTerminal = data?.operation?.status
      && !['accepted', 'in_progress'].includes(data.operation.status)

    if (isTerminal) return

    const id = setInterval(() => void fetch_(), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [operationId, token, fetch_, data?.operation?.status])

  return { data, loading, error }
}
