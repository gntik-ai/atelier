import { Button } from '@/components/ui/button'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { useConsoleContext } from '@/lib/console-context'
import { useConsoleQuotas } from '@/lib/console-quotas'
import { readConsoleShellSession } from '@/lib/console-session'

export function ConsoleQuotasPage() {
  const { activeTenant, activeTenantId, activeWorkspaceId } = useConsoleContext()
  const { posture, workspacePosture, loading, error, reload } = useConsoleQuotas(activeTenantId, activeWorkspaceId)
  const roles = readConsoleShellSession()?.principal?.platformRoles ?? []
  const isSuperadmin = roles.includes('superadmin') || roles.includes('platform_operator')

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Cuotas bloqueadas" description="Selecciona un tenant para consultar la postura de cuotas." />
  }

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <p className="text-sm text-muted-foreground">{activeTenant?.label ?? 'Tenant activo'}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Quotas</h1>
          <ConsoleQuotaPostureBadge posture={posture?.overallPosture ?? null} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Última evaluación: {posture?.evaluatedAt ?? 'n/a'}</p>
      </header>

      {loading ? <ConsolePageState kind="loading" title="Cargando cuotas" description="Consultando posture y usage overview." /> : null}
      {error ? <ConsolePageState kind="error" title="No se pudieron cargar las cuotas" description={error} actionLabel="Reintentar" onAction={reload} /> : null}
      {!loading && !error && posture && posture.dimensions.length === 0 ? <ConsolePageState kind="empty" title="Sin dimensiones de cuota" description="No hay cuotas publicadas para este tenant." /> : null}

      {posture ? (
        <QuotaTable title="Tenant" posture={posture} isSuperadmin={isSuperadmin} />
      ) : null}
      {workspacePosture ? (
        <QuotaTable title="Workspace" posture={workspacePosture} isSuperadmin={isSuperadmin} />
      ) : null}
    </section>
  )
}

function QuotaTable({ title, posture, isSuperadmin }: { title: string; posture: { dimensions: Array<{ dimensionId: string; displayName: string; hardLimit: number | null; measuredValue: number; pctUsed: number | null; policyMode: string; freshnessStatus: string; isWarning: boolean; isExceeded: boolean }> }; isSuperadmin: boolean }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card/70">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3">Dimensión</th>
            <th className="px-4 py-3">Límite</th>
            <th className="px-4 py-3">Consumo</th>
            <th className="px-4 py-3">% uso</th>
            <th className="px-4 py-3">Modo</th>
            <th className="px-4 py-3">Freshness</th>
            <th className="px-4 py-3">Acción</th>
          </tr>
        </thead>
        <tbody>
          {posture.dimensions.map((dimension) => (
            <tr key={`${title}-${dimension.dimensionId}`} className={dimension.isExceeded ? 'bg-red-500/5' : dimension.isWarning ? 'bg-amber-500/5' : ''}>
              <td className="px-4 py-3">{dimension.displayName}</td>
              <td className="px-4 py-3">{dimension.hardLimit ?? 'unbounded'}</td>
              <td className="px-4 py-3">{dimension.measuredValue}</td>
              <td className="px-4 py-3">{dimension.pctUsed !== null ? `${dimension.pctUsed}%` : '—'}</td>
              <td className="px-4 py-3">{dimension.policyMode}</td>
              <td className="px-4 py-3">{dimension.freshnessStatus}</td>
              <td className="px-4 py-3">{isSuperadmin ? <Button type="button" variant="outline" size="sm">Ajustar cuota</Button> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isSuperadmin ? <p className="px-4 py-3 text-sm text-muted-foreground">La edición real de cuotas queda fuera de T01 y depende del panel de plataforma.</p> : null}
    </section>
  )
}
