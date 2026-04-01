import { useBackupStatus } from '@/hooks/useBackupStatus'
import { BackupSummaryCard } from '@/components/backup/BackupSummaryCard'
import { BackupNotAvailable } from '@/components/backup/BackupNotAvailable'

interface BackupSummaryPageProps {
  tenantId: string
  token?: string
}

export default function BackupSummaryPage({ tenantId, token }: BackupSummaryPageProps) {
  const { data, loading, error } = useBackupStatus({
    tenantId,
    token,
    pollingIntervalMs: 60_000,
  })

  if (loading && !data) {
    return <div className="animate-pulse p-6">Cargando resumen de backups…</div>
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">
        No se pudo obtener el estado de backup: {error.message}
      </div>
    )
  }

  if (!data || !data.deployment_backup_available) {
    return (
      <div className="p-6">
        <BackupNotAvailable message={data?.message} />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-6" data-testid="backup-summary-page">
      <h2 className="text-xl font-bold">Backups del Tenant</h2>
      <BackupSummaryCard
        components={data.components}
        deploymentBackupAvailable={data.deployment_backup_available}
      />
    </div>
  )
}
