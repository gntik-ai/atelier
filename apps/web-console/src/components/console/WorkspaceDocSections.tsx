import { useEffect, useState } from 'react'
import type { WorkspaceDocsResponse } from '@/lib/console-workspace-docs'

interface Props {
  enabledServices: WorkspaceDocsResponse['enabledServices']
}

export function WorkspaceDocSections({ enabledServices }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedTabs, setSelectedTabs] = useState<Record<string, string>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextTabs: Record<string, string> = {}
    enabledServices.forEach((service) => {
      const stored = window.sessionStorage.getItem(`docs-snippet-tab-${service.serviceKey}`)
      if (stored) nextTabs[service.serviceKey] = stored
    })
    setSelectedTabs(nextTabs)
  }, [enabledServices])

  if (enabledServices.length === 0) {
    return (
      <section aria-label="Workspace services" className="rounded-lg border p-4">
        <p>No services enabled yet.</p>
        <a href="/console/settings" className="underline">Ir a workspace settings</a>
      </section>
    )
  }

  return (
    <section aria-label="Workspace services" className="space-y-4">
      {enabledServices.map((service) => {
        const selected = selectedTabs[service.serviceKey] ?? service.snippets[0]?.id
        const activeSnippet = service.snippets.find((snippet) => snippet.id === selected) ?? service.snippets[0]

        return (
          <details key={service.serviceKey} className="rounded-lg border p-4" open>
            <summary className="cursor-pointer font-semibold">{service.label}</summary>
            <div className="mt-3 space-y-3">
              <p>Categoría: {service.category}</p>
              <p>Endpoint: {service.endpoint}</p>
              {service.port ? <p>Puerto: {service.port}</p> : null}
              <div className="flex gap-2 flex-wrap">
                {service.snippets.map((snippet) => (
                  <button
                    type="button"
                    key={snippet.id}
                    className="rounded border px-2 py-1"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.sessionStorage.setItem(`docs-snippet-tab-${service.serviceKey}`, snippet.id)
                      }
                      setSelectedTabs((prev) => ({ ...prev, [service.serviceKey]: snippet.id }))
                    }}
                  >
                    {snippet.label}
                  </button>
                ))}
              </div>
              {activeSnippet ? (
                <div className="space-y-2">
                  <pre className="overflow-auto rounded bg-slate-100 p-3"><code>{activeSnippet.code}</code></pre>
                  <button
                    type="button"
                    className="rounded bg-black px-3 py-2 text-white"
                    onClick={async () => {
                      await navigator.clipboard.writeText(activeSnippet.code)
                      setCopiedId(activeSnippet.id)
                      window.setTimeout(() => setCopiedId((current) => current === activeSnippet.id ? null : current), 2000)
                    }}
                  >
                    {copiedId === activeSnippet.id ? 'Copied ✓' : 'Copy'}
                  </button>
                  {activeSnippet.secretPlaceholderRef ? <p className="text-sm text-slate-500">{activeSnippet.secretPlaceholderRef}</p> : null}
                </div>
              ) : null}
            </div>
          </details>
        )
      })}
    </section>
  )
}
