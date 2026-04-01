import type { BackupStatusComponent } from '@/services/backupStatusApi'
import { BackupStatusBadge } from './BackupStatusBadge'

interface BackupSummaryCardProps {
  components: BackupStatusComponent[]
  deploymentBackupAvailable: boolean
}

export function BackupSummaryCard({ components, deploymentBackupAvailable }: BackupSummaryCardProps) {
  if (!deploymentBackupAvailable) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground" data-testid="backup-summary-card">
        Backup no disponible en este despliegue.
      </div>
    )
  }

  const total = components.length
  const ok = components.filter((c) => c.status === 'success').length
  const failing = components.filter((c) => c.status === 'failure').length

  return (
    <div className="rounded-lg border p-4 space-y-2" data-testid="backup-summary-card">
      <h4 className="font-medium">Resumen de Backups</h4>
      <div className="flex gap-4 text-sm">
        <span>{total} componentes</span>
        <span className="text-green-600">{ok} OK</span>
        {failing > 0 && <span className="text-red-600">{failing} con error</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {components.map((c) => (
          <BackupStatusBadge key={`${c.component_type}-${c.instance_label}`} status={c.status} />
        ))}
      </div>
    </div>
  )
}
