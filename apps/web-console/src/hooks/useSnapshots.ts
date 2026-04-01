import { useCallback, useEffect, useState } from 'react'
import { listSnapshots, type SnapshotsResponse } from '@/services/backupOperationsApi'

interface UseSnapshotsResult {
  data: SnapshotsResponse | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useSnapshots(
  tenantId: string | undefined,
  componentType: string | undefined,
  instanceId: string | undefined,
  token?: string,
): UseSnapshotsResult {
  const [data, setData] = useState<SnapshotsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    if (!tenantId || !componentType || !instanceId || !token) return
    setLoading(true)
    setError(null)
    try {
      const res = await listSnapshots(
        { tenant_id: tenantId, component_type: componentType, instance_id: instanceId },
        token,
      )
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [tenantId, componentType, instanceId, token])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { data, loading, error, refetch }
}
