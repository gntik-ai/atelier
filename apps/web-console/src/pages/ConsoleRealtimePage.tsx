import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { RealtimeSnippetsPanel } from '@/components/console/snippets/RealtimeSnippetsPanel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'

type WorkspaceRealtimeResponse = {
  workspaceId: string
  realtimeEndpointUrl?: string | null
  features?: { realtime?: boolean }
  dataSources?: Array<{ type?: string | null }>
}

function mapChannelTypes(dataSources: WorkspaceRealtimeResponse['dataSources']): string[] {
  return Array.from(new Set((dataSources ?? []).flatMap((source) => {
    if (source?.type === 'postgresql') return ['postgresql-changes']
    if (source?.type == 'mongodb') return ['mongodb-changes']
    return []
  })))
}

export function ConsoleRealtimePage() {
  const params = useParams<{ workspaceId: string }>()
  const { activeWorkspaceId } = useConsoleContext()
  const workspaceId = params.workspaceId ?? activeWorkspaceId ?? ''
  const [data, setData] = useState<WorkspaceRealtimeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await requestConsoleSessionJson<WorkspaceRealtimeResponse>(`/v1/workspaces/${workspaceId}/realtime`)
        if (!cancelled) {
          setData(response)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración realtime del workspace.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    if (workspaceId) {
      void load()
    } else {
      setError('No workspace selected.')
      setLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [reloadToken, workspaceId])

  const channelTypes = useMemo(() => mapChannelTypes(data?.dataSources), [data?.dataSources])

  if (loading) {
    return (
      <main className="space-y-4">
        <div data-testid="realtime-loading-skeleton" className="h-24 animate-pulse rounded-3xl border border-border bg-muted/40" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Error loading realtime workspace metadata</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button type="button" onClick={() => setReloadToken((value) => value + 1)}>Retry</Button>
      </main>
    )
  }

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Realtime del workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ejemplos de suscripción en tiempo real para browser y backend.</p>
      </header>
      <RealtimeSnippetsPanel
        workspaceId={workspaceId}
        realtimeEndpoint={data?.realtimeEndpointUrl ?? null}
        channelTypes={channelTypes}
        realtimeEnabled={data?.features?.realtime === true}
      />
    </main>
  )
}

export { mapChannelTypes }
