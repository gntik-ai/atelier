import { Badge } from '@/components/ui/badge'
import {
  formatConsoleEnumLabel,
  getConsoleTenantStatusMeta,
  getConsoleWorkspaceStatusMeta,
  useConsoleContext
} from '@/lib/console-context'

interface ConsolePlaceholderPageProps {
  title: string
  description: string
  badge?: string
}

export function ConsolePlaceholderPage({ title, description, badge }: ConsolePlaceholderPageProps) {
  const { activeTenant, activeWorkspace } = useConsoleContext()
  const tenantStatus = getConsoleTenantStatusMeta(activeTenant)
  const workspaceStatus = getConsoleWorkspaceStatusMeta(activeWorkspace)
  const quotaSummary = activeTenant?.quotaSummary ?? null
  const inventorySummary = activeTenant?.inventorySummary ?? null

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">{description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Contexto operativo</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Tenant: {activeTenant?.label ?? 'No seleccionado'}</Badge>
              <Badge variant="outline">Estado tenant: {tenantStatus.label}</Badge>
              {activeWorkspace ? <Badge variant="outline">Workspace: {activeWorkspace.label}</Badge> : null}
              <Badge variant="outline">Estado workspace: {workspaceStatus.label}</Badge>
              {activeWorkspace?.environment ? <Badge variant="outline">Entorno: {formatConsoleEnumLabel(activeWorkspace.environment)}</Badge> : null}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {activeTenant
                ? 'La página refleja el estado actual del tenant y workspace seleccionados en el shell.'
                : 'Selecciona un tenant y, si aplica, un workspace para ver el estado contextual completo en esta vista.'}
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <div className="space-y-3 rounded-2xl border border-dashed border-border/70 p-5">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Shell de consola base</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Esta vista sigue siendo un placeholder navegable, pero ahora incorpora señales de estado del contexto activo para reducir operaciones a ciegas dentro del shell.
            </p>
          </div>
        </div>
      </div>

      {quotaSummary ? (
        <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" data-testid="console-tenant-quota-summary">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Resumen de cuotas</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Estado de cuotas del tenant activo</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Nominal: {quotaSummary.totals.nominal}</Badge>
              <Badge variant="outline">Warning: {quotaSummary.totals.warning}</Badge>
              <Badge variant="outline">Blocked: {quotaSummary.totals.blocked}</Badge>
            </div>
          </div>

          {quotaSummary.items.length > 0 ? (
            <details className="mt-5 rounded-2xl border border-border/70 bg-background/60 p-4">
              <summary className="cursor-pointer text-sm font-medium text-foreground">Ver detalle de cuotas</summary>
              <div className="mt-4 space-y-3">
                {quotaSummary.items.map((item) => (
                  <div key={`${item.scope}-${item.metricKey}`} className="rounded-2xl border border-border/60 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.metricKey}</p>
                        <p className="text-xs text-muted-foreground">Ámbito: {item.scope}</p>
                      </div>
                      <Badge variant="secondary">{item.severity}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Uso {formatCount(item.used)} / {formatCount(item.limit)} · restante {formatCount(item.remaining)} · utilización {item.utilizationPercent}%
                      {item.unit ? ` · ${item.unit}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">No hay alertas de cuota visibles para el tenant activo.</p>
          )}
        </div>
      ) : null}

      {inventorySummary ? (
        <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" data-testid="console-tenant-inventory-summary">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Resumen de inventario</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Composición del tenant activo</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <InventoryStat label="Workspaces" value={inventorySummary.workspaceCount} />
              <InventoryStat label="Aplicaciones" value={inventorySummary.applicationCount} />
              <InventoryStat label="Recursos gestionados" value={inventorySummary.managedResourceCount} />
              <InventoryStat label="Service accounts" value={inventorySummary.serviceAccountCount} />
            </div>

            {inventorySummary.workspaces.length > 0 ? (
              <details className="rounded-2xl border border-border/70 bg-background/60 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">Ver desglose por workspace</summary>
                <div className="mt-4 space-y-3">
                  {inventorySummary.workspaces.map((workspace) => (
                    <div key={workspace.workspaceId} className="rounded-2xl border border-border/60 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{workspace.workspaceSlug}</p>
                        {workspace.environment ? <Badge variant="outline">{formatConsoleEnumLabel(workspace.environment)}</Badge> : null}
                        {workspace.state ? <Badge variant="outline">{formatConsoleEnumLabel(workspace.state)}</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Apps {formatCount(workspace.applicationCount)} · Service accounts {formatCount(workspace.serviceAccountCount)} · Recursos {formatCount(workspace.managedResourceCount)}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function InventoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCount(value)}</p>
    </div>
  )
}

function formatCount(value: number) {
  return new Intl.NumberFormat('es-ES').format(value)
}
