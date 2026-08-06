import { useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { OperationStatusBadge } from '@/components/console/OperationStatusBadge'
import { OperationStatusBanner } from '@/components/console/OperationStatusBanner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useConsoleContext } from '@/lib/console-context'
import {
  OPERATION_STATUSES,
  OPERATION_STATUS_LABELS
} from '@/lib/generated/async-operation-status-vocabulary.mjs'
import { useReconnectStateSync } from '@/lib/hooks/use-reconnect-state-sync'
import { useOperations, type OperationFilters, type OperationSummary } from '@/lib/console-operations'
import type { ReconciliationDelta } from '@/lib/reconcile-operations'

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
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()
  const [status, setStatus] = useState<OperationFilters['status']>()
  const [operationType, setOperationType] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [offset, setOffset] = useState(0)
  const [delta, setDelta] = useState<ReconciliationDelta | null>(null)

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
  const reconnectEnabled =
    ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_CONSOLE_RECONNECT_SYNC_ENABLED ?? 'true') !== 'false'
  const localSnapshot = useMemo(
    () => new Map<string, OperationSummary>((data?.items ?? []).map((operation) => [operation.operationId, operation])),
    [data?.items]
  )

  useReconnectStateSync({
    tenantId: activeTenantId ?? '',
    workspaceId: activeWorkspaceId ?? null,
    localSnapshot,
    onStateChanged: (nextDelta) => {
      setDelta(nextDelta)
      if (nextDelta.updated.length > 0 || nextDelta.added.length > 0 || nextDelta.unavailable.length > 0) {
        refetch()
      }
    },
    debounceMs: 500
  })

  const shouldRenderReconnectSync = reconnectEnabled && Boolean(activeTenantId)

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Operaciones</h1>
        <p className="text-sm text-muted-foreground">Consulta el progreso y el resultado de las operaciones asíncronas de la organización activa.</p>
      </div>

      {shouldRenderReconnectSync ? <OperationStatusBanner delta={delta} onDismiss={() => setDelta(null)} /> : null}

      <div className="grid gap-4 rounded-3xl border border-border bg-card p-4 md:grid-cols-3">
        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Estado</span>
          <Select
            aria-label="Filtrar por estado"
            value={status ?? ''}
            onChange={(event) => {
              setOffset(0)
              setStatus((event.target.value || undefined) as OperationFilters['status'])
            }}
          >
            <option value="">Todos</option>
            {OPERATION_STATUSES.map((operationStatus) => (
              <option key={operationStatus} value={operationStatus}>
                {OPERATION_STATUS_LABELS[operationStatus]}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Tipo de operación</span>
          <Select
            aria-label="Filtrar por tipo de operación"
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
          </Select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Área de trabajo</span>
          <input
            aria-label="Filtrar por área de trabajo"
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
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5 text-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/20 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <AlertTitle className="text-base">No se pudieron cargar las operaciones.</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  Se detuvieron los reintentos automáticos para evitar tráfico continuo. Reintenta cuando el servicio esté disponible.
                </AlertDescription>
              </div>
            </div>
            <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={refetch}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : null}

      {isLoading && !data ? (
        <div
          role="status"
          aria-label="Cargando operaciones"
          aria-busy="true"
          className="h-64 animate-pulse rounded-3xl border border-border bg-muted/60"
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-background px-4 py-8 text-sm text-muted-foreground">
          No hay operaciones registradas para esta organización.
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
                <th className="px-4 py-3 font-medium">Área de trabajo</th>
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

      {data ? (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" disabled={!canGoBack} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
            Anterior
          </Button>
          <Button type="button" variant="outline" disabled={!canGoNext} onClick={() => setOffset((current) => current + PAGE_SIZE)}>
            Siguiente
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export default ConsoleOperationsPage
