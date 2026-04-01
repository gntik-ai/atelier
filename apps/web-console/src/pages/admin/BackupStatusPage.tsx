import { useState } from 'react'

import { useBackupStatus } from '@/hooks/useBackupStatus'
import { BackupStatusTable } from '@/components/backup/BackupStatusTable'
import { BackupStatusDetail } from '@/components/backup/BackupStatusDetail'
import { BackupNotAvailable } from '@/components/backup/BackupNotAvailable'
import type { BackupStatusComponent } from '@/services/backupStatusApi'

export default function BackupStatusPage() {
  const { data, loading, error, refetch } = useBackupStatus({ pollingIntervalMs: 30_000 })
  const [selected, setSelected] = useState<BackupStatusComponent | null>(null)

  if (loading && !data) {
    return <div className="animate-pulse p-6">Cargando estado de backups…</div>
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">
        Error al consultar el estado de backup: {error.message}
      </div>
    )
  }

  if (!data || !data.deployment_backup_available) {
    return (
      <div className="p-6">
        <BackupNotAvailable />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6" data-testid="backup-status-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Estado de Backups</h1>
          <p className="text-sm text-slate-600">
            Las simulaciones de restore se muestran con modo explícito y evidencia consultable.
          </p>
        </div>
        <button onClick={() => void refetch()} className="text-sm underline">
          Refrescar
        </button>
      </div>

      <BackupStatusTable components={data.components} onSelect={setSelected} />

      {selected && (
        <BackupStatusDetail component={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
