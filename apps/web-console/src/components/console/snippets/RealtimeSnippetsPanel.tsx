import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { SnippetContext } from '@/lib/snippets/snippet-types'
import { generateSnippets } from '@/lib/snippets/snippet-generator'

type RealtimeSnippetLanguage = 'javascript' | 'nodejs' | 'python'

const STORAGE_KEY = 'realtime-snippet-lang'

function getInitialLanguage(): RealtimeSnippetLanguage {
  if (typeof window === 'undefined') {
    return 'javascript'
  }

  const stored = window.sessionStorage.getItem(STORAGE_KEY)
  return stored === 'nodejs' || stored === 'python' || stored === 'javascript' ? stored : 'javascript'
}

export interface RealtimeSnippetsPanelProps {
  workspaceId: string
  realtimeEndpoint: string | null
  channelTypes: string[]
  realtimeEnabled: boolean
}

export function RealtimeSnippetsPanel({ workspaceId, realtimeEndpoint, channelTypes, realtimeEnabled }: RealtimeSnippetsPanelProps) {
  const [language, setLanguage] = useState<RealtimeSnippetLanguage>(() => getInitialLanguage())

  const context: SnippetContext = useMemo(() => ({
    tenantId: null,
    tenantSlug: null,
    workspaceId,
    workspaceSlug: null,
    resourceName: null,
    resourceHost: realtimeEndpoint ?? null,
    resourcePort: null,
    resourceExtraA: channelTypes[0] ?? null,
    resourceExtraB: null,
    resourceState: realtimeEnabled ? 'active' : 'unavailable',
    externalAccessEnabled: true
  }), [channelTypes, realtimeEnabled, realtimeEndpoint, workspaceId])

  const entries = useMemo(() => generateSnippets('realtime-subscription', context), [context])

  const filteredEntries = useMemo(() => {
    const prefix = language === 'javascript' ? 'realtime-js-' : language === 'nodejs' ? 'realtime-nodejs-' : 'realtime-python-'
    return entries.filter((entry) => entry.id.startsWith(prefix))
  }, [entries, language])

  function handleLanguageChange(nextLanguage: RealtimeSnippetLanguage) {
    setLanguage(nextLanguage)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY, nextLanguage)
    }
  }

  if (!realtimeEnabled || channelTypes.length === 0) {
    return (
      <section aria-labelledby="realtime-snippets-heading">
        <h2 id="realtime-snippets-heading" className="sr-only">Realtime Subscription Snippets</h2>
        <Alert>
          <AlertTitle>Realtime no disponible</AlertTitle>
          <AlertDescription>
            Realtime subscriptions require at least one provisioned data source. Visit the provisioning section to configure your workspace.{' '}
            <Link className="underline" to={`/console/workspaces/${workspaceId}/provisioning`}>
              Go to provisioning
            </Link>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <section aria-labelledby="realtime-snippets-heading" className="space-y-4">
      <h2 id="realtime-snippets-heading" className="sr-only">Realtime Subscription Snippets</h2>
      <div className="rounded-3xl border border-border bg-card/70 p-4 shadow-sm">
        <div role="tablist" aria-label="Realtime snippet languages" className="flex flex-wrap gap-2">
          {(['javascript', 'nodejs', 'python'] as const).map((tab) => (
            <button
              key={tab}
              id={`realtime-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={language === tab}
              aria-controls={`realtime-panel-${tab}`}
              className={`rounded-md border px-3 py-2 text-sm ${language === tab ? 'bg-foreground text-background' : 'bg-background text-foreground'}`}
              onClick={() => handleLanguageChange(tab)}
            >
              {tab === 'javascript' ? 'JavaScript' : tab === 'nodejs' ? 'Node.js' : 'Python'}
            </button>
          ))}
        </div>
      </div>
      <div id={`realtime-panel-${language}`} role="tabpanel" aria-labelledby={`realtime-tab-${language}`}>
        <ConnectionSnippets entries={filteredEntries} />
      </div>
      {channelTypes.length > 1 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Additional channel types available: {channelTypes.slice(1).join(', ')}. Change the <code>channelType</code> value in the snippet accordingly.
        </p>
      ) : null}
    </section>
  )
}
