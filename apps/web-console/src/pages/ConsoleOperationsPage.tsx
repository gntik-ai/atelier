import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { OperationStatusBadge } from '@/components/console/OperationStatusBadge'
import { Button } from '@/components/ui/button'
import { useOperations, type OperationFilters } from '@/lib/console-operations'

const PAGE_SIZE = 20

function formatDateTime(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return value
  }

  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

export function ConsoleOperationsPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<OperationFilters['status']>()
  const [operationType, setOperationType] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [offset, setOffset] = useState(0)

  const filters = useMemo<OperationFilters>(
    () => ({
      status,
      operationType: operationType.trim() || undefined,
      workspaceId: workspaceId.trim() || undefined
    }),
    [operationType, status, workspaceId]
  )

  const { data, error, isLoading, refetch } = useOperations(filters, { limit: PAGE_SIZE, offset })
  const operationTypes = useMemo(() => Array.from(new Set((data?.items ?? []).map((item) => item.operationType))).sort(), [data?.items])
  const canGoBack = offset > 0
  const canGoNext = Boolean(data && offset + data.items.length < data.total)

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Operaciones</h1>
        <p className="text-sm text-muted-foreground">Consulta el progreso y el resultado de las operaciones asíncronas del tenant activo.</p>
      </div>

      <div className="grid gap-4 rounded-3xl border border-border bg-card p-4 md:grid-cols-3">
        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Estado</span>
          <select
            aria-label="Filtrar por estado"
            className="w-full rounded-xl border border-input bg-background px-3 py-2"
            value={status ?? ''}
            onChange={(event) => {
              setOffset(0)
              setStatus((event.target.value || undefined) as OperationFilters['status'])
            }}
          >
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="running">En curso</option>
            <option value="completed">Completada</option>
            <option value="failed">Fallida</option>
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Tipo de operación</span>
          <select
            aria-label="Filtrar por tipo de operación"
            className="w-full rounded-xl border border-input bg-background px-3 py-2"
            value={operationType}
            onChange={(event) => {
              setOffset(0)
              setOperationType(event.target.value)
            }}
          >
            <option value="">Todos</option>
            {operationTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Workspace</span>
          <input
            aria-label="Filtrar por workspace"
            className="w-full rounded-xl border border-input bg-background px-3 py-2"
            placeholder="wrk_demo"
            value={workspaceId}
            onChange={(event) => {
              setOffset(0)
              setWorkspaceId(event.target.value)
            }}
          />
        </label>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>No se pudieron cargar las operaciones.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={refetch}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {isLoading && !data ? <div className="h-64 animate-pulse rounded-3xl border border-border bg-muted/60" aria-busy="true" /> : null}

      {data && data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-background px-4 py-8 text-sm text-muted-foreground">
          No hay operaciones registradas para este tenant.
        </p>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Tipo de operación</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Creada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {data.items.map((operation) => (
                <tr
                  key={operation.operationId}
                  className="cursor-pointer transition-colors hover:bg-accent/40"
                  onClick={() => navigate(`/console/operations/${operation.operationId}`)}
                >
                  <td className="px-4 py-4 text-sm font-medium text-foreground">{operation.operationType}</td>
                  <td className="px-4 py-4 text-sm text-foreground">
                    <OperationStatusBadge status={operation.status} />
                  </td>
                  <td className="px-4 py-4 text-sm text-muted-foreground">{operation.actorId}</td>
                  <td className="px-4 py-4 text-sm text-muted-foreground">{operation.workspaceId ?? '—'}</td>
                  <td className="px-4 py-4 text-sm text-muted-foreground">{formatDateTime(operation.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" disabled={!canGoBack} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
          Anterior
        </Button>
        <Button type="button" variant="outline" disabled={!canGoNext} onClick={() => setOffset((current) => current + PAGE_SIZE)}>
          Siguiente
        </Button>
      </div>
    </section>
  )
}

export default ConsoleOperationsPage
