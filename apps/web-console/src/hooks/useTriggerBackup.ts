import { useCallback, useState } from 'react'
import { triggerBackup as apiTriggerBackup } from '@/services/backupOperationsApi'

interface UseTriggerBackupResult {
  trigger: (body: { tenant_id: string; component_type: string; instance_id: string }, token: string) => Promise<void>
  isLoading: boolean
  error: Error | null
  operationId: string | null
}

export function useTriggerBackup(): UseTriggerBackupResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)

  const trigger = useCallback(async (
    body: { tenant_id: string; component_type: string; instance_id: string },
    token: string,
  ) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await apiTriggerBackup(body, token)
      setOperationId(res.operation_id)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { trigger, isLoading, error, operationId }
}
