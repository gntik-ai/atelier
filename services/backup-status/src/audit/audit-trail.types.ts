/**
 * Types for the backup audit trail system (US-BKP-01-T03).
 */

export type AuditEventType =
  | 'backup.requested'
  | 'backup.started'
  | 'backup.completed'
  | 'backup.failed'
  | 'backup.rejected'
  | 'restore.requested'
  | 'restore.started'
  | 'restore.completed'
  | 'restore.failed'
  | 'restore.rejected'
  | 'restore.confirmation_pending'
  | 'restore.confirmed'
  | 'restore.aborted'
  | 'restore.confirmation_expired'
  | 'restore.simulation.requested'
  | 'restore.simulation.started'
  | 'restore.simulation.completed'
  | 'restore.simulation.failed'
  | 'restore.simulation.rejected'

/** Additional detail fields for restore confirmation audit events (US-BKP-01-T04). */
export interface RestoreConfirmationAuditDetail {
  confirmation_request_id: string
  risk_level?: string
  prechecks_summary?: Array<{ code: string; result: string }>
  prechecks_result?: unknown
  warnings_shown?: string[]
  confirmation_decision?: string
  confirmation_timestamp?: string
  second_factor_method?: string
  second_actor_id?: string
  confirmation_bypassed?: boolean
}

export type SessionContextStatus = 'full' | 'partial' | 'not_applicable'

export interface SessionContext {
  sessionId?: string | null
  sourceIp?: string | null
  userAgent?: string | null
  status: SessionContextStatus
}

export interface AuditEventInput {
  eventType: AuditEventType
  operationId?: string | null
  correlationId?: string
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId?: string | null
  actorId: string
  actorRole: string
  sessionContext: SessionContext
  result: string
  rejectionReason?: string | null
  rejectionReasonPublic?: string | null
  detail?: string | null
  destructive?: boolean
}

export interface AuditEvent extends AuditEventInput {
  id: string
  schemaVersion: '1'
  occurredAt: Date
  detailTruncated: boolean
  publishedAt?: Date | null
  publishAttempts: number
}

export interface AuditQueryFilters {
  tenantId?: string
  eventType?: AuditEventType | AuditEventType[]
  actorId?: string
  operationId?: string
  result?: string
  from?: Date
  to?: Date
  /** default: 50, max: 200 */
  limit?: number
  cursor?: string
}

export interface AuditEventPage {
  schemaVersion: '1'
  events: AuditEventPublic[] | AuditEventAdmin[]
  pagination: {
    limit: number
    nextCursor: string | null
    total?: number
  }
}

/** Full view for SRE/superadmin — all fields in snake_case JSON. */
export interface AuditEventAdmin {
  schema_version: '1'
  id: string
  event_type: AuditEventType
  correlation_id: string
  operation_id: string | null
  tenant_id: string
  component_type: string
  instance_id: string
  snapshot_id: string | null
  actor_id: string
  actor_role: string
  session_id: string | null
  source_ip: string | null
  user_agent: string | null
  session_context_status: SessionContextStatus
  result: string
  rejection_reason: string | null
  rejection_reason_public: string | null
  detail: string | null
  detail_truncated: boolean
  destructive: boolean
  occurred_at: string
}

/** Summary view for tenant owner — sensitive fields omitted. */
export interface AuditEventPublic {
  schema_version: '1'
  id: string
  event_type: AuditEventType
  correlation_id: string
  operation_id: string | null
  tenant_id: string
  component_type: string
  result: string
  rejection_reason_public: string | null
  destructive: boolean
  occurred_at: string
}
