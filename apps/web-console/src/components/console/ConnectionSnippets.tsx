import { useEffect, useMemo, useState } from 'react'

import { generateSnippets } from '@/lib/snippets/snippet-generator'
import type { ResourceType, SnippetContext } from '@/lib/snippets/snippet-types'

interface ConnectionSnippetsProps {
  resourceType: ResourceType
  context: SnippetContext
}

export function ConnectionSnippets({ resourceType, context }: ConnectionSnippetsProps) {
  const entries = useMemo(() => generateSnippets(resourceType, context), [resourceType, context])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [clipboardUnavailableFor, setClipboardUnavailableFor] = useState<string | null>(null)

  useEffect(() => {
    if (!copiedId) return undefined

    const timer = window.setTimeout(() => setCopiedId(null), 2500)
    return () => window.clearTimeout(timer)
  }, [copiedId])

  if (entries.length === 0) {
    return null
  }

  async function handleCopy(id: string, code: string) {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      setClipboardUnavailableFor(id)
      return
    }

    await navigator.clipboard.writeText(code)
    setClipboardUnavailableFor(null)
    setCopiedId(id)
  }

  return (
    <section className="rounded-3xl border border-border bg-card/60 p-6 shadow-sm" aria-labelledby="connection-snippets-heading">
      <div className="space-y-2">
        <h3 id="connection-snippets-heading" className="text-lg font-semibold text-foreground">Snippets de conexión</h3>
        <p className="text-sm text-muted-foreground">Ejemplos generados en cliente a partir del contexto visible del recurso activo.</p>
      </div>

      <div className="mt-4 space-y-4">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-medium text-foreground">{entry.label}</h4>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground transition hover:bg-muted"
                onClick={() => void handleCopy(entry.id, entry.code)}
              >
                {copiedId === entry.id ? 'Copiado ✓' : 'Copiar'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-xs leading-6 text-foreground whitespace-pre-wrap select-text"><code>{entry.code}</code></pre>
            {clipboardUnavailableFor === entry.id ? (
              <p className="mt-2 text-sm text-muted-foreground">Tu navegador no expone Clipboard API aquí; selecciona y copia el bloque manualmente.</p>
            ) : null}
            {entry.notes.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {entry.notes.map((note) => (
                  <li key={`${entry.id}-${note}`}>{note}</li>
                ))}
              </ul>
            ) : null}
            {entry.hasPlaceholderSecrets && entry.secretPlaceholderRef ? (
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Secretos:</span> {entry.secretPlaceholderRef}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
