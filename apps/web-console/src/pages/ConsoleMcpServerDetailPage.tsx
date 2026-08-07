import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { McpServerConnectPanel } from '@/components/console/mcp/McpServerConnectPanel'
import { McpServerPlayground } from '@/components/console/mcp/McpServerPlayground'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError } from '@/lib/console-errors'
import { fetchMcpServerDetail } from '@/lib/mcp/mcp-api'
import { toMcpServerDetailViewModel, type McpServerDetailView } from '@/lib/mcp/mcp-server-detail'

/**
 * MCP server detail page (issue #397): endpoint + status + active version + curated tool list,
 * with a client-snippet tab and an interactive test-area tab.
 */
type Tab = 'connect' | 'playground'

const tabs: Array<{ value: Tab; label: string }> = [
  { value: 'connect', label: 'Conectar' },
  { value: 'playground', label: 'Área de pruebas' }
]

function getTabId(tab: Tab) {
  return `mcp-server-${tab}-tab`
}

function getPanelId(tab: Tab) {
  return `mcp-server-${tab}-panel`
}

export function ConsoleMcpServerDetailPage() {
  const { mcpServerId = '' } = useParams<{ mcpServerId: string }>()
  const { activeWorkspaceId, workspacesLoading } = useConsoleContext()
  const [view, setView] = useState<McpServerDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('connect')
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    setError(null)
    setView(null)

    if (!mcpServerId || !activeWorkspaceId) return undefined

    const controller = new AbortController()
    fetchMcpServerDetail(activeWorkspaceId, mcpServerId, controller.signal)
      .then((payload) => setView(toMcpServerDetailViewModel(payload)))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(describeConsoleError(err, 'No se pudo cargar el servidor MCP.'))
      })
    return () => controller.abort()
  }, [activeWorkspaceId, mcpServerId, reloadNonce])

  const tools = useMemo(() => view?.tools ?? [], [view])
  const toolsCountLabel = tools.length === 1 ? '1 publicada' : `${tools.length} publicadas`

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, value: Tab) {
    const currentIndex = tabs.findIndex((item) => item.value === value)
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1

    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = tabs[nextIndex].value
    setTab(nextTab)
    requestAnimationFrame(() => document.getElementById(getTabId(nextTab))?.focus())
  }

  if (!activeWorkspaceId) {
    if (workspacesLoading) {
      return (
        <div data-testid="mcp-detail-loading">
          <ConsolePageState
            kind="loading"
            title="Cargando área de trabajo"
            description="Estamos resolviendo el área de trabajo activa antes de cargar el servidor MCP."
          />
        </div>
      )
    }
    return (
      <div data-testid="mcp-detail-no-workspace">
        <WorkspaceRequiredState description="El detalle y el área de pruebas del servidor MCP se cargan para el área de trabajo activa. Selecciona un área de trabajo para continuar." />
      </div>
    )
  }

  if (error) {
    return (
      <ConsolePageState
        kind="error"
        title="No se pudo cargar el servidor MCP"
        description={error}
        actionLabel="Reintentar"
        onAction={() => setReloadNonce((nonce) => nonce + 1)}
      />
    )
  }
  if (!view) {
    return (
      <div data-testid="mcp-detail-loading">
        <ConsolePageState
          kind="loading"
          title="Cargando servidor MCP"
          description="Estamos cargando el punto de conexión, la versión activa y las herramientas curadas."
        />
      </div>
    )
  }

  return (
    <section className="space-y-6" data-testid="mcp-server-detail" aria-labelledby="mcp-server-detail-heading">
      <header className="space-y-5 rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <div className="min-w-0 space-y-1">
          <h2 id="mcp-server-detail-heading" className="break-words text-2xl font-semibold tracking-tight text-foreground">
            {view.name ?? mcpServerId}
          </h2>
          <p className="text-sm text-muted-foreground">Detalle operativo del servidor MCP en el área de trabajo activa.</p>
        </div>

        <dl className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="min-w-0 rounded-2xl border border-border/70 bg-background/60 p-4 md:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Punto de conexión</dt>
            <dd className="mt-1 break-all text-sm leading-6 text-foreground" data-testid="mcp-detail-endpoint">
              {view.endpoint ?? 'No publicado'}
            </dd>
          </div>
          <div className="min-w-0 rounded-2xl border border-border/70 bg-background/60 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versión activa</dt>
            <dd className="mt-1 break-words text-sm leading-6 text-foreground" data-testid="mcp-detail-version">
              {view.version ?? '—'}
            </dd>
          </div>
          <div className="min-w-0 rounded-2xl border border-border/70 bg-background/60 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado</dt>
            <dd className="mt-2 text-sm text-foreground" data-testid="mcp-detail-status">
              <Badge variant="outline" className="max-w-full whitespace-normal break-words text-left">
                {view.status ?? 'Sin estado'}
              </Badge>
            </dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="mcp-tools-heading" className="space-y-4 rounded-3xl border border-border bg-card/60 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 id="mcp-tools-heading" className="text-lg font-semibold text-foreground">Herramientas curadas</h3>
          <Badge variant="secondary" className="w-fit">{toolsCountLabel}</Badge>
        </div>
        {tools.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-6 text-sm text-muted-foreground">
            Sin herramientas publicadas todavía.
          </p>
        ) : (
          <ul className="grid gap-3" data-testid="mcp-detail-tools">
            {tools.map((tool) => (
              <li key={tool.name} className="min-w-0 rounded-2xl border border-border/70 bg-background/70 p-4 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-medium text-foreground">{tool.name}</span>
                  {tool.mutates ? <Badge variant="secondary">Muta estado</Badge> : null}
                  {tool.scope ? (
                    <Badge variant="outline" className="max-w-full whitespace-normal break-all text-left">
                      Alcance: {tool.scope}
                    </Badge>
                  ) : null}
                </div>
                {tool.description ? <p className="mt-2 break-words leading-6 text-muted-foreground">{tool.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="tablist" aria-label="Servidor MCP" className="flex w-full flex-wrap gap-1 rounded-2xl border border-border bg-card/60 p-1 sm:w-fit">
        {tabs.map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            role="tab"
            id={getTabId(value)}
            aria-controls={getPanelId(value)}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            variant={tab === value ? 'default' : 'ghost'}
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => setTab(value)}
            onKeyDown={(event) => handleTabKeyDown(event, value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <section
        role="tabpanel"
        id={getPanelId(tab)}
        aria-labelledby={getTabId(tab)}
        tabIndex={0}
        className="outline-none"
      >
        {tab === 'connect' ? (
          <McpServerConnectPanel name={view.name} slug={view.slug} endpoint={view.endpoint} />
        ) : (
          <McpServerPlayground
            workspaceId={activeWorkspaceId}
            serverId={view.id ?? mcpServerId}
            tools={tools}
            endpoint={view.endpoint}
            disabledReason={view.runtimeReady ? undefined : 'El runtime Hosted MCP no está disponible; la invocación está deshabilitada.'}
          />
        )}
      </section>
    </section>
  )
}
