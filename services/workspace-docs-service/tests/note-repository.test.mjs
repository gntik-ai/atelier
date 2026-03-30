import test from 'node:test'
import assert from 'node:assert/strict'
import { insertNote, listNotes, updateNote, softDeleteNote } from '../src/note-repository.mjs'

test('note repository issues scoped queries', async () => {
  const state = []
  const db = {
    async query(sql, params) {
      if (sql.startsWith('INSERT')) {
        const row = { id: 'note-1', content: params[2], author_id: params[3], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        state.push({ tenantId: params[0], workspaceId: params[1], ...row, deleted_at: null })
        return { rows: [row], rowCount: 1 }
      }
      if (sql.startsWith('SELECT')) {
        return { rows: state.filter((row) => row.tenantId === params[0] && row.workspaceId === params[1] && !row.deleted_at) }
      }
      if (sql.startsWith('UPDATE') && sql.includes('SET content')) {
        const row = state.find((item) => item.tenantId === params[0] && item.workspaceId === params[1] && item.id === params[2] && !item.deleted_at)
        if (!row) return { rows: [], rowCount: 0 }
        row.content = params[3]
        row.updated_at = new Date().toISOString()
        return { rows: [row], rowCount: 1 }
      }
      const row = state.find((item) => item.tenantId === params[0] && item.workspaceId === params[1] && item.id === params[2] && !item.deleted_at)
      if (!row) return { rows: [], rowCount: 0 }
      row.deleted_at = new Date().toISOString()
      return { rows: [{ id: row.id }], rowCount: 1 }
    }
  }

  const note = await insertNote(db, 'ten-1', 'wrk-1', 'actor-1', 'hello')
  assert.equal(note.content, 'hello')
  assert.equal((await listNotes(db, 'ten-1', 'wrk-1')).length, 1)
  assert.equal((await updateNote(db, 'ten-1', 'wrk-1', 'note-1', 'bye')).content, 'bye')
  assert.deepEqual(await softDeleteNote(db, 'ten-1', 'wrk-1', 'note-1'), { noteId: 'note-1' })
  assert.equal((await listNotes(db, 'ten-1', 'wrk-1')).length, 0)
})
