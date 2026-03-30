import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { WorkspaceDocAuthSection } from '@/components/console/WorkspaceDocAuthSection'
import { WorkspaceDocNotes } from '@/components/console/WorkspaceDocNotes'
import { WorkspaceDocSections } from '@/components/console/WorkspaceDocSections'
import { createDocNote, deleteDocNote, fetchWorkspaceDocs, updateDocNote, type WorkspaceDocNote } from '@/lib/console-workspace-docs'

const FALLBACK_TOKEN = ''

export function ConsoleDocsPage() {
  const { workspaceId = '' } = useParams()
  const queryClient = useQueryClient()
  const [notesOverride, setNotesOverride] = useState<WorkspaceDocNote[] | null>(null)
  const token = FALLBACK_TOKEN
  const isAdmin = true

  const query = useQuery({
    queryKey: ['workspace-docs', workspaceId],
    staleTime: 20_000,
    queryFn: () => fetchWorkspaceDocs(workspaceId, token)
  })

  const notes = useMemo(() => notesOverride ?? query.data?.customNotes ?? [], [notesOverride, query.data])

  if (query.isLoading) {
    return <div data-testid="docs-loading">Loading workspace docs…</div>
  }

  if (query.isError || !query.data) {
    return <div data-testid="docs-error">No se pudo cargar la documentación del workspace.</div>
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <nav>Console / Workspaces / {workspaceId} / Documentation</nav>
        <h1 className="text-2xl font-bold">Documentación del workspace</h1>
        <p>Base URL: {query.data.baseUrl}</p>
        <p>Última generación: {new Date(query.data.generatedAt).toLocaleString()}</p>
        <button type="button" className="rounded border px-3 py-2" onClick={() => queryClient.invalidateQueries({ queryKey: ['workspace-docs', workspaceId] })}>Refresh</button>
      </header>

      <WorkspaceDocAuthSection authInstructions={query.data.authInstructions} />
      <WorkspaceDocSections enabledServices={query.data.enabledServices} />
      <WorkspaceDocNotes
        workspaceId={workspaceId}
        notes={notes}
        isAdmin={isAdmin}
        onCreate={async (content) => {
          const created = await createDocNote(workspaceId, content, token)
          setNotesOverride([...(notesOverride ?? query.data.customNotes), created])
        }}
        onUpdate={async (noteId, content) => {
          const updated = await updateDocNote(workspaceId, noteId, content, token)
          setNotesOverride((notesOverride ?? query.data.customNotes).map((note) => note.noteId === noteId ? updated : note))
        }}
        onDelete={async (noteId) => {
          await deleteDocNote(workspaceId, noteId, token)
          setNotesOverride((notesOverride ?? query.data.customNotes).filter((note) => note.noteId !== noteId))
        }}
      />
    </div>
  )
}
