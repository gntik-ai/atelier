import { Badge } from '@/components/ui/badge'
import type { BackupStatus } from '@/services/backupStatusApi'

const VARIANT_MAP: Record<BackupStatus, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  success: 'default',
  failure: 'destructive',
  partial: 'secondary',
  in_progress: 'outline',
  not_configured: 'secondary',
  not_available: 'secondary',
  pending: 'outline',
}

const LABEL_MAP: Record<BackupStatus, string> = {
  success: 'OK',
  failure: 'Error',
  partial: 'Parcial',
  in_progress: 'En curso',
  not_configured: 'No configurado',
  not_available: 'No disponible',
  pending: 'Pendiente',
}

interface BackupStatusBadgeProps {
  status: BackupStatus
}

export function BackupStatusBadge({ status }: BackupStatusBadgeProps) {
  return (
    <Badge variant={VARIANT_MAP[status]} data-testid="backup-status-badge">
      {LABEL_MAP[status]}
    </Badge>
  )
}
