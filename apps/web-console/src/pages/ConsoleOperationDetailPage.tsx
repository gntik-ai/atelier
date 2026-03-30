import { OperationLogEntriesList } from '@/components/console/OperationLogEntriesList'
import { OperationResultSummary } from '@/components/console/OperationResultSummary'
import { OperationStatusBadge } from '@/components/console/OperationStatusBadge'
import { useOperationDetail } from '@/lib/console-operations'
import { useParams } from 'react-router-dom'

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return value
  }

  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

export function ConsoleOperationDetailPage() {
  const { operationId } = useParams()
  const { data, isLoading } = useOperationDetail(operationId)

  if (isLoading && !data) {
    return <div className="h-80 animate-pulse rounded-3xl border border-border bg-muted/60" aria-busy="true" />
  }

  if (!operationId || !data) {
    return <p className="text-sm text-muted-foreground">Operación no encontrada o no disponible.</p>
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Detalle de operación</h1>
          <OperationStatusBadge status={data.status} />
        </div>
        <p className="text-sm text-muted-foreground">Consulta los metadatos, logs resumidos y resultado final de la operación seleccionada.</p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <dl className="grid gap-px bg-border/60 md:grid-cols-2">
          {[
            ['Tipo', data.operationType],
            ['Actor', data.actorId],
            ['Workspace', data.workspaceId ?? '—'],
            ['Tenant', data.tenantId],
            ['Creada', formatDateTime(data.createdAt)],
            ['Actualizada', formatDateTime(data.updatedAt)],
            ['Correlation ID', data.correlationId ?? '—'],
            ['Saga ID', data.sagaId ?? '—']
          ].map(([label, value]) => (
            <div key={label} className="bg-card px-4 py-4">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <section className="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Logs resumidos</h2>
          <p className="text-sm text-muted-foreground">Mensajes orientados al usuario sobre el progreso de la operación.</p>
        </div>
        <OperationLogEntriesList operationId={operationId} />
      </section>

      <section className="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Resultado</h2>
          <p className="text-sm text-muted-foreground">Estado final y resumen ejecutable de la operación.</p>
        </div>
        <OperationResultSummary operationId={operationId} />
      </section>
    </section>
  )
}

export default ConsoleOperationDetailPage
