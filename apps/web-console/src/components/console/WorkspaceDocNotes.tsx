import { useMemo, useState } from 'react'
import type { WorkspaceDocNote } from '@/lib/console-workspace-docs'

interface Props {
  notes: WorkspaceDocNote[]
  workspaceId: string
  isAdmin: boolean
  onCreate?: (content: string) => Promise<void>
  onUpdate?: (noteId: string, content: string) => Promise<void>
  onDelete?: (noteId: string) => Promise<void>
}

export function WorkspaceDocNotes({ notes, isAdmin, onCreate, onUpdate, onDelete }: Props) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Record<string, string>>({})
  const orderedNotes = useMemo(() => [...notes], [notes])

  return (
    <section aria-label="Workspace notes" className="rounded-lg border p-4 space-y-4">
      <h2 className="text-lg font-semibold">Notas personalizadas</h2>
      {isAdmin ? (
        <form onSubmit={async (event) => {
          event.preventDefault()
          if (!draft.trim() || !onCreate) return
          await onCreate(draft)
          setDraft('')
        }} className="space-y-2"
        >
          <textarea aria-label="New note" className="min-h-24 w-full rounded border p-2" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="rounded bg-black px-3 py-2 text-white">Add note</button>
        </form>
      ) : null}
      <div className="space-y-3">
        {orderedNotes.map((note) => {
          const current = editing[note.noteId] ?? note.content
          return (
            <article key={note.noteId} className="rounded border p-3 space-y-2">
              {isAdmin ? (
                <textarea aria-label={`Edit ${note.noteId}`} className="min-h-20 w-full rounded border p-2" value={current} onChange={(event) => setEditing((prev) => ({ ...prev, [note.noteId]: event.target.value }))} />
              ) : (
                <p>{note.content}</p>
              )}
              <p className="text-sm text-slate-500">Autor: {note.authorId}</p>
              {isAdmin ? (
                <div className="flex gap-2">
                  <button type="button" className="rounded border px-3 py-1" onClick={() => onUpdate?.(note.noteId, current)}>Save</button>
                  <button type="button" className="rounded border px-3 py-1" onClick={() => onDelete?.(note.noteId)}>Delete</button>
                </div>
              ) : null}
            </article>
          )
        })}
        {orderedNotes.length === 0 ? <p className="text-sm text-slate-500">No hay notas todavía.</p> : null}
      </div>
    </section>
  )
}
