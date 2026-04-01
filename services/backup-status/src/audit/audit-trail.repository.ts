/**
 * Data Access Layer for backup_audit_events table.
 */

import type { AuditEvent, AuditEventPage, AuditQueryFilters } from './audit-trail.types.js'

// In production: import { pool } from '../db/pool.js'
// Minimal DB interface for compilation; real pool injected at runtime.
interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

let pool: DbPool

export function setPool(p: DbPool): void {
  pool = p
}

function getPool(): DbPool {
  if (!pool) throw new Error('audit-trail repository: pool not initialized')
  return pool
}

export const AuditTrailRepository = {
  async insert(event: AuditEvent): Promise<void> {
    const db = getPool()
    await db.query(
      `INSERT INTO backup_audit_events (
        id, schema_version, event_type, operation_id, correlation_id,
        tenant_id, component_type, instance_id, snapshot_id,
        actor_id, actor_role,
        session_id, source_ip, user_agent, session_context_status,
        result, rejection_reason, rejection_reason_public,
        detail, detail_truncated, destructive,
        occurred_at, published_at, publish_attempts
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18,
        $19, $20, $21,
        $22, $23, $24
      )`,
      [
        event.id, event.schemaVersion, event.eventType, event.operationId ?? null, event.correlationId,
        event.tenantId, event.componentType, event.instanceId, event.snapshotId ?? null,
        event.actorId, event.actorRole,
        event.sessionContext.sessionId ?? null, event.sessionContext.sourceIp ?? null,
        event.sessionContext.userAgent ?? null, event.sessionContext.status,
        event.result, event.rejectionReason ?? null, event.rejectionReasonPublic ?? null,
        event.detail ?? null, event.detailTruncated, event.destructive ?? false,
        event.occurredAt, null, 0,
      ],
    )
  },

  async markPublished(eventId: string): Promise<void> {
    const db = getPool()
    await db.query('UPDATE backup_audit_events SET published_at = NOW() WHERE id = $1', [eventId])
  },

  async incrementPublishAttempt(eventId: string, error: string): Promise<void> {
    const db = getPool()
    await db.query(
      'UPDATE backup_audit_events SET publish_attempts = publish_attempts + 1, publish_last_error = $2 WHERE id = $1',
      [eventId, error],
    )
  },

  async findPendingPublish(maxAttempts: number): Promise<AuditEvent[]> {
    const db = getPool()
    const { rows } = await db.query(
      `SELECT * FROM backup_audit_events
       WHERE published_at IS NULL AND publish_attempts < $1
       ORDER BY occurred_at ASC`,
      [maxAttempts],
    )
    return rows.map(rowToEvent)
  },

  async query(filters: AuditQueryFilters): Promise<AuditEventPage> {
    const db = getPool()
    const conditions: string[] = []
    const values: unknown[] = []
    let idx = 1

    if (filters.tenantId) {
      conditions.push(`tenant_id = $${idx++}`)
      values.push(filters.tenantId)
    }
    if (filters.eventType) {
      const types = Array.isArray(filters.eventType) ? filters.eventType : [filters.eventType]
      conditions.push(`event_type = ANY($${idx++}::backup_audit_event_type[])`)
      values.push(types)
    }
    if (filters.actorId) {
      conditions.push(`actor_id = $${idx++}`)
      values.push(filters.actorId)
    }
    if (filters.operationId) {
      conditions.push(`operation_id = $${idx++}`)
      values.push(filters.operationId)
    }
    if (filters.result) {
      conditions.push(`result = $${idx++}`)
      values.push(filters.result)
    }
    if (filters.from) {
      conditions.push(`occurred_at >= $${idx++}`)
      values.push(filters.from)
    }
    if (filters.to) {
      conditions.push(`occurred_at <= $${idx++}`)
      values.push(filters.to)
    }

    // Cursor-based pagination on (occurred_at, id)
    if (filters.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString())
        conditions.push(`(occurred_at, id) < ($${idx++}, $${idx++})`)
        values.push(decoded.occurred_at, decoded.id)
      } catch {
        // Invalid cursor — ignore
      }
    }

    const limit = Math.min(filters.limit ?? 50, 200)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows } = await db.query(
      `SELECT * FROM backup_audit_events ${where}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $${idx}`,
      [...values, limit + 1],
    )

    const hasMore = rows.length > limit
    const resultRows = hasMore ? rows.slice(0, limit) : rows
    const events = resultRows.map(rowToEvent)

    let nextCursor: string | null = null
    if (hasMore && resultRows.length > 0) {
      const last = resultRows[resultRows.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({ occurred_at: last.occurred_at, id: last.id }),
      ).toString('base64url')
    }

    return {
      schemaVersion: '1',
      events: events as never,
      pagination: { limit, nextCursor },
    }
  },
}

function rowToEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row.id as string,
    schemaVersion: '1',
    eventType: row.event_type as AuditEvent['eventType'],
    operationId: (row.operation_id as string) ?? null,
    correlationId: row.correlation_id as string,
    tenantId: row.tenant_id as string,
    componentType: row.component_type as string,
    instanceId: row.instance_id as string,
    snapshotId: (row.snapshot_id as string) ?? null,
    actorId: row.actor_id as string,
    actorRole: row.actor_role as string,
    sessionContext: {
      sessionId: (row.session_id as string) ?? null,
      sourceIp: (row.source_ip as string) ?? null,
      userAgent: (row.user_agent as string) ?? null,
      status: row.session_context_status as AuditEvent['sessionContext']['status'],
    },
    result: row.result as string,
    rejectionReason: (row.rejection_reason as string) ?? null,
    rejectionReasonPublic: (row.rejection_reason_public as string) ?? null,
    detail: (row.detail as string) ?? null,
    detailTruncated: row.detail_truncated as boolean,
    destructive: row.destructive as boolean,
    occurredAt: new Date(row.occurred_at as string),
    publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    publishAttempts: row.publish_attempts as number,
  }
}
