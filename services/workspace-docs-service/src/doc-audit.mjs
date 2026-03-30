export async function recordAccess(db, kafkaProducer, workspaceId, actorId, correlationId, tenantId = 'unknown') {
  const result = await db.query(
    `INSERT INTO workspace_docs_service.workspace_doc_access_log (workspace_id, actor_id, access_date)
     VALUES ($1, $2, current_date)
     ON CONFLICT DO NOTHING`,
    [workspaceId, actorId]
  )

  if (result.rowCount > 0 && kafkaProducer?.send) {
    const accessDate = new Date().toISOString().slice(0, 10)
    await kafkaProducer.send({
      topic: 'console.audit',
      messages: [
        {
          value: JSON.stringify({
            eventType: 'workspace.docs.accessed',
            workspaceId,
            tenantId,
            actorId,
            accessDate,
            correlationId
          })
        }
      ]
    })
  }

  return result.rowCount > 0
}
