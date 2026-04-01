import { useCallback, useEffect, useState } from 'react'

import {
  getBackupStatus,
  type BackupStatusResponse,
  BackupStatusApiError,
} from '@/services/backupStatusApi'

interface UseBackupStatusOptions {
  tenantId?: string
  token?: string
  pollingIntervalMs?: number
  enabled?: boolean
}

interface UseBackupStatusResult {
  data: BackupStatusResponse | null
  loading: boolean
  error: BackupStatusApiError | Error | null
  refetch: () => Promise<void>
}

export function useBackupStatus({
  tenantId,
  token,
  pollingIntervalMs,
  enabled = true,
}: UseBackupStatusOptions = {}): UseBackupStatusResult {
  const [data, setData] = useState<BackupStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<BackupStatusApiError | Error | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getBackupStatus(tenantId, token)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [tenantId, token])

  useEffect(() => {
    if (!enabled) return
    void refetch()

    if (pollingIntervalMs && pollingIntervalMs > 0) {
      const id = setInterval(() => void refetch(), pollingIntervalMs)
      return () => clearInterval(id)
    }
  }, [enabled, refetch, pollingIntervalMs])

  return { data, loading, error, refetch }
}
