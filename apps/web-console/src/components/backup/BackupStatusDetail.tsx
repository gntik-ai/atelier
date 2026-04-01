import type { BackupStatusComponent } from '@/services/backupStatusApi'
import { BackupStatusBadge } from './BackupStatusBadge'

interface BackupStatusDetailProps {
  component: BackupStatusComponent
  onClose?: () => void
}

export function BackupStatusDetail({ component, onClose }: BackupStatusDetailProps) {
  return (
    <div className="rounded-lg border p-4 space-y-3" data-testid="backup-status-detail">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{component.instance_label}</h3>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">
            Cerrar
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Tipo</dt>
        <dd>{component.component_type}</dd>
        <dt className="text-muted-foreground">Estado</dt>
        <dd><BackupStatusBadge status={component.status} /></dd>
        <dt className="text-muted-foreground">Último backup exitoso</dt>
        <dd>{component.last_successful_backup_at ?? 'N/A'}</dd>
        <dt className="text-muted-foreground">Última comprobación</dt>
        <dd>{component.last_checked_at}</dd>
        <dt className="text-muted-foreground">Stale</dt>
        <dd>{component.stale ? `Sí (desde ${component.stale_since ?? '?'})` : 'No'}</dd>
        {component.detail && (
          <>
            <dt className="text-muted-foreground">Detalle</dt>
            <dd>{component.detail}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
