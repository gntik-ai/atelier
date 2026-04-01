import type { BackupStatusComponent } from '@/services/backupStatusApi'
import { BackupStatusBadge } from './BackupStatusBadge'

interface BackupStatusTableProps {
  components: BackupStatusComponent[]
  onSelect?: (component: BackupStatusComponent) => void
}

export function BackupStatusTable({ components, onSelect }: BackupStatusTableProps) {
  if (components.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay componentes de backup registrados.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="backup-status-table">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Componente</th>
            <th className="px-4 py-2 text-left font-medium">Tipo</th>
            <th className="px-4 py-2 text-left font-medium">Estado</th>
            <th className="px-4 py-2 text-left font-medium">Último backup OK</th>
            <th className="px-4 py-2 text-left font-medium">Última comprobación</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr
              key={`${c.component_type}-${c.instance_label}`}
              className="border-t hover:bg-muted/30 cursor-pointer"
              onClick={() => onSelect?.(c)}
            >
              <td className="px-4 py-2">{c.instance_label}</td>
              <td className="px-4 py-2">{c.component_type}</td>
              <td className="px-4 py-2"><BackupStatusBadge status={c.status} /></td>
              <td className="px-4 py-2">{c.last_successful_backup_at ?? '—'}</td>
              <td className="px-4 py-2">{c.last_checked_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
