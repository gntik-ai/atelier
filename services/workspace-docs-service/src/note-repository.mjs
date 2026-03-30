function mapRow(row) {
  if (!row) return null
  return {
    noteId: row.id,
    content: row.content,
    authorId: row.author_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

export async function insertNote(db, tenantId, workspaceId, authorId, sanitisedContent) {
  const result = await db.query(
    `INSERT INTO workspace_docs_service.workspace_doc_notes (tenant_id, workspace_id, content, author_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, content, author_id, created_at, updated_at`,
    [tenantId, workspaceId, sanitisedContent, authorId]
  )
  return mapRow(result.rows[0])
}

export async function updateNote(db, tenantId, workspaceId, noteId, sanitisedContent) {
  const result = await db.query(
    `UPDATE workspace_docs_service.workspace_doc_notes
        SET content = $4, updated_at = now()
      WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 AND deleted_at IS NULL
      RETURNING id, content, author_id, created_at, updated_at`,
    [tenantId, workspaceId, noteId, sanitisedContent]
  )
  return mapRow(result.rows[0])
}

export async function softDeleteNote(db, tenantId, workspaceId, noteId) {
  const result = await db.query(
    `UPDATE workspace_docs_service.workspace_doc_notes
        SET deleted_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 AND deleted_at IS NULL
      RETURNING id`,
    [tenantId, workspaceId, noteId]
  )
  return result.rowCount > 0 ? { noteId } : null
}

export async function listNotes(db, tenantId, workspaceId) {
  const result = await db.query(
    `SELECT id, content, author_id, created_at, updated_at
       FROM workspace_docs_service.workspace_doc_notes
      WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [tenantId, workspaceId]
  )

  return result.rows.map(mapRow)
}
