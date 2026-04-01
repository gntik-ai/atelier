import { useCallback, useState } from 'react'
import { triggerRestore as apiTriggerRestore } from '@/services/backupOperationsApi'

interface UseTriggerRestoreResult {
  trigger: (body: { tenant_id: string; component_type: string; instance_id: string; snapshot_id: string }, token: string) => Promise<void>
  isLoading: boolean
  error: Error | null
  operationId: string | null
}

export function useTriggerRestore(): UseTriggerRestoreResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)

  const trigger = useCallback(async (
    body: { tenant_id: string; component_type: string; instance_id: string; snapshot_id: string },
    token: string,
  ) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await apiTriggerRestore(body, token)
      setOperationId(res.operation_id)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { trigger, isLoading, error, operationId }
}
