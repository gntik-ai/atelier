import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { WorkspaceDocAuthSection } from '@/components/console/WorkspaceDocAuthSection'
import { WorkspaceDocNotes } from '@/components/console/WorkspaceDocNotes'
import { WorkspaceDocSections } from '@/components/console/WorkspaceDocSections'
import { createDocNote, deleteDocNote, fetchWorkspaceDocs, updateDocNote, type WorkspaceDocNote } from '@/lib/console-workspace-docs'

const FALLBACK_TOKEN = ''

export function ConsoleDocsPage() {
  const { workspaceId = '' } = useParams()
  const [notesOverride, setNotesOverride] = useState<WorkspaceDocNote[] | null>(null)
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const token = FALLBACK_TOKEN
  const isAdmin = true

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetchWorkspaceDocs(workspaceId, token)
      .then((result) => {
        if (cancelled) return
        setData(result)
      })
      .catch(() => {
        if (cancelled) return
        setIsError(true)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, token, reloadKey])

  const notes = useMemo(() => notesOverride ?? data?.customNotes ?? [], [notesOverride, data])

  if (isLoading) {
    return <div data-testid="docs-loading">Loading workspace docs…</div>
  }

  if (isError || !data) {
    return <div data-testid="docs-error">No se pudo cargar la documentación del workspace.</div>
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <nav>Console / Workspaces / {workspaceId} / Documentation</nav>
        <h1 className="text-2xl font-bold">Documentación del workspace</h1>
        <p>Base URL: {data.baseUrl}</p>
        <p>Última generación: {new Date(data.generatedAt).toLocaleString()}</p>
        <button type="button" className="rounded border px-3 py-2" onClick={() => setReloadKey((value) => value + 1)}>Refresh</button>
      </header>

      <WorkspaceDocAuthSection authInstructions={data.authInstructions} />
      <WorkspaceDocSections enabledServices={data.enabledServices} />
      <WorkspaceDocNotes
        workspaceId={workspaceId}
        notes={notes}
        isAdmin={isAdmin}
        onCreate={async (content) => {
          const created = await createDocNote(workspaceId, content, token)
          setNotesOverride([...(notesOverride ?? data.customNotes), created])
        }}
        onUpdate={async (noteId, content) => {
          const updated = await updateDocNote(workspaceId, noteId, content, token)
          setNotesOverride((notesOverride ?? data.customNotes).map((note) => note.noteId === noteId ? updated : note))
        }}
        onDelete={async (noteId) => {
          await deleteDocNote(workspaceId, noteId, token)
          setNotesOverride((notesOverride ?? data.customNotes).filter((note) => note.noteId !== noteId))
        }}
      />
    </div>
  )
}
