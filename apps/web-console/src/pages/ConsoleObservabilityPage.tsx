import { Fragment, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConsoleAuditCategoryBadge } from '@/components/console/ConsoleAuditCategoryBadge'
import { ConsoleAuditRecordDetail } from '@/components/console/ConsoleAuditRecordDetail'
import { ConsoleAuditResultBadge } from '@/components/console/ConsoleAuditResultBadge'
import { ConsoleMetricDimensionRow } from '@/components/console/ConsoleMetricDimensionRow'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { ConsoleTimeRangeSelector } from '@/components/console/ConsoleTimeRangeSelector'
import { exportAuditRecords, useConsoleAuditRecords, useConsoleMetrics, type ConsoleAuditFilter, type ConsoleMetricRange } from '@/lib/console-metrics'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleObservabilityPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const [tab, setTab] = useState<'metrics' | 'audit'>('metrics')
  const [range, setRange] = useState<ConsoleMetricRange>({ preset: '24h' })
  const [filters, setFilters] = useState<ConsoleAuditFilter>({})
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const metrics = useConsoleMetrics(activeTenantId, activeWorkspaceId, range)
  const audit = useConsoleAuditRecords(activeTenantId, activeWorkspaceId, filters)

  const headerText = useMemo(() => {
    return [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · ')
  }, [activeTenant?.label, activeWorkspace?.label])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Observabilidad bloqueada" description="Selecciona un tenant para consultar métricas y auditoría." />
  }

  const tenantId = activeTenantId

  async function handleExport() {
    await exportAuditRecords(tenantId, activeWorkspaceId, filters)
    setExportMessage('Exportación iniciada correctamente.')
  }

  return (
    <section className="space-y-6">
      <header className="space-y-3 rounded-3xl border border-border bg-card/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{headerText || 'Tenant activo'}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Observability</h1>
          </div>
          {metrics.overview ? <ConsoleQuotaPostureBadge posture={metrics.overview.overallPosture} /> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={tab === 'metrics' ? 'default' : 'outline'} onClick={() => setTab('metrics')}>Metrics</Button>
          <Button type="button" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Audit</Button>
        </div>
      </header>

      {tab === 'metrics' ? (
        <div className="space-y-4">
          <ConsoleTimeRangeSelector value={range} onChange={setRange} />
          {metrics.loading ? <ConsolePageState kind="loading" title="Cargando métricas" description="Consultando overview y snapshot de uso." /> : null}
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
          <section className="grid gap-3 rounded-3xl border border-border bg-card/70 p-6 md:grid-cols-5">
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block">Actor</span>
              <input aria-label="Actor" value={filters.actorId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block">Categoría</span>
              <input aria-label="Categoría" value={filters.category ?? ''} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block">Resultado</span>
              <select aria-label="Resultado" value={filters.result ?? ''} onChange={(event) => setFilters((current) => ({ ...current, result: (event.target.value || undefined) as ConsoleAuditFilter['result'] }))} className="w-full rounded-xl border border-input bg-background px-3 py-2">
                <option value="">Todos</option>
                <option value="success">success</option>
                <option value="failure">failure</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button type="button" variant="outline" onClick={() => void handleExport()}>Exportar</Button>
            </div>
          </section>
          {exportMessage ? <p className="text-sm text-emerald-700">{exportMessage}</p> : null}
          {audit.loading ? <ConsolePageState kind="loading" title="Cargando auditoría" description="Consultando eventos auditables." /> : null}
          {audit.error ? <ConsolePageState kind="error" title="No se pudo cargar la auditoría" description={audit.error} actionLabel="Reintentar" onAction={audit.reload} /> : null}
          {!audit.loading && !audit.error && audit.records.length === 0 ? <ConsolePageState kind="empty" title="Sin eventos de auditoría" description="No se encontraron registros con los filtros actuales." /> : null}
          {audit.records.length > 0 ? (
            <div className="overflow-hidden rounded-3xl border border-border bg-card/70">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3">Evento</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3">Resultado</th>
                    <th className="px-4 py-3">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.records.map((record) => (
                    <Fragment key={record.eventId}>
                      <tr className="border-b border-border/60">
                        <td className="px-4 py-3">
                          <button type="button" className="font-medium underline" onClick={() => setExpandedRecordId((current) => current === record.eventId ? null : record.eventId)}>
                            {record.eventId}
                          </button>
                        </td>
                        <td className="px-4 py-3"><ConsoleAuditCategoryBadge category={record.action.category} /></td>
                        <td className="px-4 py-3"><ConsoleAuditResultBadge result={record.result?.outcome ?? 'unknown'} /></td>
                        <td className="px-4 py-3">{record.eventTimestamp}</td>
                      </tr>
                      {expandedRecordId === record.eventId ? (
                        <tr>
                          <td className="px-4 py-3" colSpan={4}><ConsoleAuditRecordDetail record={record} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
