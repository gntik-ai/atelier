import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { getKnativeRuntimeStatus, type KnativeRuntimeStatus } from '@/services/knativeRuntimeApi'

const stateLabels: Record<string, string> = {
  ready: 'Listo', degraded: 'Degradado', unverified: 'Sin verificar', unavailable: 'No disponible', disabled: 'Deshabilitado'
}
const modeLabels: Record<string, string> = { managed: 'Gestionado por la plataforma', external: 'Runtime externo', disabled: 'Deshabilitado' }

export function ConsoleRuntimePage() {
  const [status, setStatus] = useState<KnativeRuntimeStatus | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = () => { setLoading(true); setError(false); getKnativeRuntimeStatus().then(setStatus).catch(() => setError(true)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])
  if (loading) return <ConsolePageState kind="loading" title="Consultando runtime de plataforma" description="Estamos verificando el estado de Knative. Esta operación es de solo lectura." />
  if (error || !status) return <ConsolePageState kind="error" title="No se pudo consultar el runtime" description="El estado temporalmente no está disponible. No se muestran mensajes internos del servidor." actionLabel="Reintentar" onAction={load} />
  const state = stateLabels[status.state] ?? 'Estado no disponible'
  const actionable = status.state === 'degraded' || status.state === 'unavailable'
  const statusTone = status.state === 'ready' ? 'border-emerald-500/50 bg-emerald-500/10' : actionable ? 'border-amber-500/60 bg-amber-500/10' : 'border-border bg-muted/30'
  const correlationId = `runtime-${status.lastTransitionAt ? new Date(status.lastTransitionAt).getTime() : 'status'}`
  return <main className="space-y-6" aria-labelledby="runtime-title">
    <header className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
      <p className="text-sm text-muted-foreground">Plataforma · solo lectura</p><h1 id="runtime-title" className="text-2xl font-semibold">Runtime de funciones</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Consulta el estado del runtime sin iniciar cambios ni despliegues.</p>
    </header>
    <section className={`rounded-3xl border p-5 sm:p-6 ${statusTone}`} aria-live="polite" aria-atomic="true">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado actual</p><h2 className="mt-1 text-lg font-semibold">Knative</h2></div><Badge variant={status.state === 'ready' ? 'default' : 'outline'} aria-label={`Estado del runtime: ${state}`}><span aria-hidden="true" className="mr-1">{status.state === 'ready' ? '●' : '○'}</span>{state}</Badge></div>
      <dl className="mt-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-muted-foreground">Modo</dt><dd className="font-medium">{modeLabels[status.mode] ?? 'Modo no verificado'}</dd></div><div><dt className="text-muted-foreground">Propietario</dt><dd className="font-medium break-words">{status.owner || 'No informado'}</dd></div><div><dt className="text-muted-foreground">Etapa</dt><dd className="font-medium break-words">{status.stage}</dd></div><div><dt className="text-muted-foreground">Compatibilidad</dt><dd className="font-medium">{status.compatibility}</dd></div><div><dt className="text-muted-foreground">Versión</dt><dd className="font-medium break-words">{status.version ?? 'No disponible'}</dd></div><div><dt className="text-muted-foreground">Última transición</dt><dd className="font-medium">{status.lastTransitionAt ? new Date(status.lastTransitionAt).toLocaleString() : 'No registrada'}</dd></div></dl>
      {status.mode === 'disabled' || status.state === 'unverified' ? <p className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">El runtime no está verificado para esta instalación. Las funciones nuevas permanecerán pendientes hasta que un operador complete la configuración.</p> : null}
      {actionable ? <div role="status" className="mt-4 rounded-xl border border-amber-600/40 bg-background/50 p-3 text-sm"><p>Las invocaciones pueden estar temporalmente limitadas.</p><p className="mt-1 text-muted-foreground">Motivo: <span className="break-words">{status.reason || 'No especificado'}</span></p><p className="mt-2 text-muted-foreground">Correlación: <code className="break-all rounded bg-muted px-1">{correlationId}</code> <button type="button" className="ml-2 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void navigator.clipboard?.writeText(correlationId)}>Copiar</button></p></div> : null}
    </section>
    <section className="grid gap-4 md:grid-cols-2" aria-label="Capacidades dependientes del runtime">
      {[['Funciones', '/console/functions', status.state === 'ready' ? 'Disponible' : 'Pendiente'], ['Hosted MCP', '/console/mcp/servers', status.state === 'ready' ? 'Disponible' : 'Degradado']].map(([label, href, availability]) => <article key={label} className="rounded-3xl border border-border bg-card p-5"><h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm text-muted-foreground">{availability}. No hay acciones de mutación desde esta vista.</p><Button asChild variant="outline" className="mt-4"><Link to={href}>Inspeccionar</Link></Button></article>)}
    </section>
  </main>
}
