import { Fragment, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConsoleAuditCategoryBadge } from '@/components/console/ConsoleAuditCategoryBadge'
import { ConsoleAuditRecordDetail } from '@/components/console/ConsoleAuditRecordDetail'
import { ConsoleAuditResultBadge } from '@/components/console/ConsoleAuditResultBadge'
import { ConsoleMetricDimensionRow } from '@/components/console/ConsoleMetricDimensionRow'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { ConsoleTimeRangeSelector } from '@/components/console/ConsoleTimeRangeSelector'
import { Select } from '@/components/ui/select'
import {
  exportAuditRecords,
  useConsoleAuditRecords,
  useConsoleMetrics,
  type ConsoleAuditExportManifest,
  type ConsoleAuditExportResult,
  type ConsoleAuditFilter,
  type ConsoleMetricRange
} from '@/lib/console-metrics'
import { useConsoleContext } from '@/lib/console-context'
import { useConsolePermissions } from '@/lib/console-permissions'
import { cn } from '@/lib/utils'

const TENANT_SCOPE_METRICS_RANGE: ConsoleMetricRange = { preset: '24h' }

type AuditExportFeedback =
  | { kind: 'loading' }
  | { kind: 'artifact'; manifest: ConsoleAuditExportManifest }
  | { kind: 'unavailable'; result: ConsoleAuditExportResult; message: string }
  | { kind: 'error'; message: string }

const auditExportStatusLabels: Record<string, string> = {
  accepted: 'Aceptado',
  completed: 'Completado',
  failed: 'Fallido',
  queued: 'En cola'
}

function isAuditExportManifest(result: ConsoleAuditExportResult): result is ConsoleAuditExportManifest {
  return Boolean(
    result &&
      typeof result === 'object' &&
      typeof result.exportId === 'string' &&
      result.exportId.length > 0 &&
      typeof result.itemCount === 'number' &&
      Array.isArray(result.items)
  )
}

function auditExportStatus(result: ConsoleAuditExportResult): string | null {
  return result && typeof result === 'object' && typeof result.status === 'string' && result.status.trim()
    ? result.status.trim()
    : null
}

function auditExportId(result: ConsoleAuditExportResult): string | null {
  return result && typeof result === 'object' && typeof result.exportId === 'string' && result.exportId.trim()
    ? result.exportId.trim()
    : null
}

function auditExportStatusLabel(result: ConsoleAuditExportResult): string | null {
  const status = auditExportStatus(result)
  return status ? auditExportStatusLabels[status] ?? status : null
}

function auditExportUnavailableMessage(result: ConsoleAuditExportResult): string {
  if (result && typeof result === 'object' && typeof result.message === 'string' && result.message.trim()) {
    return result.message.trim()
  }

  const status = auditExportStatus(result)
  if (status) {
    return `El servidor devolvió estado ${status}, pero no incluyó un manifiesto descargable.`
  }

  return 'El servidor respondió sin un manifiesto descargable para esta solicitud.'
}

function auditExportErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }

  return 'No se pudo exportar la auditoría.'
}

function downloadAuditExportManifest(manifest: ConsoleAuditExportManifest) {
  const filename = `${manifest.exportId.replace(/[^a-zA-Z0-9_.-]/g, '-') || 'audit-export'}.json`
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ConsoleObservabilityPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const [tab, setTab] = useState<'metrics' | 'audit'>('metrics')
  const [range, setRange] = useState<ConsoleMetricRange>({ preset: '24h' })
  const [filters, setFilters] = useState<ConsoleAuditFilter>({})
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<AuditExportFeedback | null>(null)
  // #761: `tenant_developer` is the one tenant-tier role denied `tenant.audit.read` in
  // authorization-model.json (the viewer IS allowed it — that asymmetry is the entire point of the
  // developer role's "directory read, no audit" intent). Don't offer an audit destination that
  // would 403 for them (Observer-first IA, scenario 5).
  const { can } = useConsolePermissions()
  const canReadAudit = can('tenant.audit.read')

  const metrics = useConsoleMetrics(activeTenantId, activeWorkspaceId, range)
  // Round-2 review (#761): `useConsoleAuditRecords` was called unconditionally regardless of
  // `canReadAudit`, so a `tenant_developer` (denied `tenant.audit.read`, and whose default landing
  // is now this page — Observer-first IA) fired a background GET .../audit-records that 403s on
  // every visit, even though the "Auditoría" tab is already hidden for them. `useConsoleAuditRecords`
  // already no-ops on a falsy `tenantId` (see its `if (!tenantId) { ...; return }` guard in
  // console-metrics.ts), so passing `null` here — the same gate-by-null-id pattern the hook itself
  // uses — suppresses the fetch without a conditional hook call. Behavior for a role that CAN read
  // audit is unchanged (the real `activeTenantId`/`activeWorkspaceId` still flow through).
  const audit = useConsoleAuditRecords(canReadAudit ? activeTenantId : null, canReadAudit ? activeWorkspaceId : null, filters)
  const metricsRangeApplies = Boolean(activeWorkspaceId)

  const headerText = useMemo(() => {
    return [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · ')
  }, [activeTenant?.label, activeWorkspace?.label])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Observabilidad bloqueada" description="Selecciona una organización para consultar métricas y auditoría." />
  }

  const tenantId = activeTenantId
  const isExporting = exportFeedback?.kind === 'loading'
  const exportFeedbackId = exportFeedback ? 'audit-export-feedback' : undefined

  async function handleExport() {
    setExportFeedback({ kind: 'loading' })

    try {
      const result = await exportAuditRecords(tenantId, activeWorkspaceId, filters)
      if (isAuditExportManifest(result)) {
        setExportFeedback({ kind: 'artifact', manifest: result })
        return
      }

      setExportFeedback({ kind: 'unavailable', result, message: auditExportUnavailableMessage(result) })
    } catch (error) {
      setExportFeedback({ kind: 'error', message: auditExportErrorMessage(error) })
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-4 rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{headerText || 'Organización activa'}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Observabilidad</h1>
          </div>
          {metrics.overview ? <ConsoleQuotaPostureBadge posture={metrics.overview.overallPosture} linkTo="/console/quotas" /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={tab === 'metrics' ? 'default' : 'outline'} onClick={() => setTab('metrics')}>Métricas</Button>
          {canReadAudit ? (
            <Button type="button" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Auditoría</Button>
          ) : null}
        </div>
      </header>

      {tab === 'metrics' ? (
        <div className="space-y-4">
          <ConsoleTimeRangeSelector
            value={metricsRangeApplies ? range : TENANT_SCOPE_METRICS_RANGE}
            onChange={setRange}
            disabled={!metricsRangeApplies}
            disabledReason={!metricsRangeApplies ? 'El rango temporal no está activo para métricas de organización. Selecciona un área de trabajo en el contexto de consola para consultar series con ventana temporal.' : undefined}
          />
          {metrics.loading ? <ConsolePageState kind="loading" title="Cargando métricas" description="Consultando resumen e instantánea de uso." /> : null}
          {metrics.error ? <ConsolePageState kind="error" title="No se pudieron cargar las métricas" description={metrics.error} actionLabel="Reintentar" onAction={metrics.reload} /> : null}
          {!metrics.loading && !metrics.error && metrics.overview && metrics.overview.dimensions.length === 0 ? (
            <ConsolePageState kind="empty" title="Sin métricas en este periodo" description="No hay dimensiones disponibles para el rango temporal seleccionado." />
          ) : null}
          {metrics.overview ? (
            <section className="space-y-4">
              <p className="text-sm text-muted-foreground">Última actualización: {metrics.overview.generatedAt || 'n/a'}</p>
              {metrics.overview.dimensions.map((dimension) => (
                <ConsoleMetricDimensionRow key={dimension.dimensionId} dimension={dimension} />
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
            {/* #766 responsiveness: the audit filters lay out on a fluid grid (1 → 2 → 3 columns)
                with a uniform field idiom, and the export action gets its own right-aligned row, so
                the panel holds its rhythm from narrow to wide without ragged wrapping. */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actor</span>
                <input aria-label="Actor" value={filters.actorId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Categoría</span>
                <input aria-label="Categoría" value={filters.category ?? ''} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resultado</span>
                <Select aria-label="Resultado" value={filters.result ?? ''} onChange={(event) => setFilters((current) => ({ ...current, result: (event.target.value || undefined) as ConsoleAuditFilter['result'] }))}>
                  <option value="">Todos</option>
                  <option value="success">Éxito</option>
                  <option value="failure">Fallo</option>
                </Select>
              </label>
              {/* #766: `ConsoleAuditFilter.from`/`.to` were already modeled and wired into the
                  fetch (`appendDateFilters`), but the audit tab never exposed inputs for them. */}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Desde</span>
                <input type="date" aria-label="Desde" value={filters.from ?? ''} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hasta</span>
                <input type="date" aria-label="Hasta" value={filters.to ?? ''} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={isExporting}
                aria-busy={isExporting}
                aria-describedby={exportFeedbackId}
                onClick={() => void handleExport()}
              >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                {isExporting ? 'Exportando auditoría...' : 'Exportar auditoría'}
              </Button>
            </div>
          </section>
          {exportFeedback ? (
            <div id="audit-export-feedback" aria-live="polite" aria-atomic="true" className="space-y-3">
              {exportFeedback.kind === 'loading' ? (
                <section role="status" aria-busy="true" className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm sm:p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">Solicitando exportación de auditoría</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Estamos esperando la respuesta del servidor para saber si hay un manifiesto JSON descargable.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              {exportFeedback.kind === 'artifact' ? (
                <section role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-sm font-semibold text-foreground">Manifiesto de auditoría listo</h2>
                        <p className="break-words text-sm leading-6 text-muted-foreground">
                          ID de exportación <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{exportFeedback.manifest.exportId}</code>
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" className="w-full shrink-0 sm:w-auto" onClick={() => downloadAuditExportManifest(exportFeedback.manifest)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Descargar JSON
                    </Button>
                  </div>
                  <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-emerald-500/20 pt-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Registros exportados</dt>
                      <dd className="font-medium">{exportFeedback.manifest.itemCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Registros enmascarados</dt>
                      <dd className="font-medium">{exportFeedback.manifest.maskedItemCount ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Estado</dt>
                      <dd className="font-medium">{auditExportStatusLabel(exportFeedback.manifest) ?? 'Completado'}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}
              {exportFeedback.kind === 'unavailable' ? (
                <section role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm sm:p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">Manifiesto no disponible</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{exportFeedback.message}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        No se descargó ningún archivo porque la respuesta no incluyó un manifiesto.
                      </p>
                      {auditExportId(exportFeedback.result) ? (
                        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                          Solicitud <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{auditExportId(exportFeedback.result)}</code>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}
              {exportFeedback.kind === 'error' ? (
                <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 shadow-sm sm:p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">No se pudo exportar la auditoría</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{exportFeedback.message}</p>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
          {audit.loading ? <ConsolePageState kind="loading" title="Cargando auditoría" description="Consultando eventos auditables." /> : null}
          {audit.error ? <ConsolePageState kind="error" title="No se pudo cargar la auditoría" description={audit.error} actionLabel="Reintentar" onAction={audit.reload} /> : null}
          {audit.loadMoreError ? (
            <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-foreground">No se pudieron cargar más eventos de auditoría.</p>
              <p className="mt-1 text-muted-foreground">{audit.loadMoreError} Los eventos ya cargados se conservan; vuelve a intentar con el botón de continuación.</p>
            </section>
          ) : null}
          {!audit.loading && !audit.error && audit.records.length === 0 ? <ConsolePageState kind="empty" title="Sin eventos de auditoría" description="No se encontraron registros con los filtros actuales." /> : null}
          {audit.records.length > 0 ? (
            <>
              <p role="status" aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
                {audit.records.length} {audit.records.length === 1 ? 'evento mostrado' : 'eventos mostrados'}
              </p>
              {audit.continuationStatus ? <p role="status" aria-live="polite" className="sr-only">{audit.continuationStatus}</p> : null}
              <div className="overflow-hidden rounded-3xl border border-border bg-card/70 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <caption className="sr-only">Eventos de auditoría</caption>
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th scope="col" className="px-4 py-3 font-medium">Evento</th>
                        <th scope="col" className="px-4 py-3 font-medium">Categoría</th>
                        <th scope="col" className="px-4 py-3 font-medium">Resultado</th>
                        <th scope="col" className="px-4 py-3 font-medium">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.records.map((record) => {
                        const isExpanded = expandedRecordId === record.eventId
                        const detailId = `audit-record-detail-${record.eventId}`
                        return (
                          <Fragment key={record.eventId}>
                            {/* #766 disclosure rhythm: an expanded event shares a subtle tint with
                                its detail row and drops the divider between the two so the pair reads
                                as one open unit; collapsed rows keep the hover affordance + divider. */}
                            <tr className={cn('transition-colors', isExpanded ? 'bg-muted/25' : 'border-b border-border/60 last:border-b-0 hover:bg-muted/20')}>
                              <td className="px-4 py-3 align-top">
                                <Button
                                  type="button"
                                  variant="link"
                                  className="h-auto whitespace-normal break-all p-0 text-left font-mono text-sm"
                                  aria-expanded={isExpanded}
                                  aria-controls={detailId}
                                  onClick={() => setExpandedRecordId((current) => current === record.eventId ? null : record.eventId)}
                                >
                                  {record.eventId}
                                </Button>
                              </td>
                              <td className="px-4 py-3 align-top"><ConsoleAuditCategoryBadge category={record.action.category} /></td>
                              <td className="px-4 py-3 align-top"><ConsoleAuditResultBadge result={record.result?.outcome ?? 'unknown'} /></td>
                              <td className="whitespace-nowrap px-4 py-3 align-top tabular-nums text-muted-foreground">{record.eventTimestamp}</td>
                            </tr>
                            {isExpanded ? (
                              <tr className="border-b border-border/60 bg-muted/25 last:border-b-0">
                                <td id={detailId} className="px-4 pb-4 pt-0" colSpan={4}><ConsoleAuditRecordDetail record={record} /></td>
                              </tr>
                            ) : null}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {audit.hasMore && audit.nextCursor ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={audit.loadingMore}
                    aria-busy={audit.loadingMore}
                    aria-label={audit.loadingMore ? 'Cargando más eventos de auditoría' : 'Cargar más eventos de auditoría'}
                    onClick={() => void audit.loadMore()}
                  >
                    {audit.loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {audit.loadingMore ? 'Cargando más…' : 'Cargar más'}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}
