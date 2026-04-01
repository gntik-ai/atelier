/**
 * OpenWhisk action: GET /v1/backup/audit — query audit trail.
 */

import { validateToken, AuthError } from '../api/backup-status.auth.js'
import { AuditTrailRepository } from '../audit/audit-trail.repository.js'
import type {
  AuditEvent,
  AuditEventType,
  AuditEventAdmin,
  AuditEventPublic,
  AuditQueryFilters,
} from '../audit/audit-trail.types.js'

const MAX_AUDIT_RANGE_DAYS = parseInt(process.env.AUDIT_MAX_RANGE_DAYS ?? '90', 10)
const MS_PER_DAY = 86_400_000

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
  tenant_id?: string
  event_type?: string
  actor_id?: string
  operation_id?: string
  result?: string
  from?: string
  to?: string
  limit?: string
  cursor?: string
}

interface ActionResponse {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

function extractToken(headers: Record<string, string>): string | null {
  const auth = headers.authorization ?? headers.Authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

export async function main(params: ActionParams): Promise<ActionResponse> {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache',
    'X-Content-Type-Options': 'nosniff',
  }

  // Only GET allowed
  if (params.__ow_method && params.__ow_method.toLowerCase() !== 'get') {
    return { statusCode: 405, headers, body: { error: 'Method Not Allowed' } }
  }

  try {
    const rawToken = extractToken(params.__ow_headers ?? {})
    if (!rawToken) return { statusCode: 401, headers, body: { error: 'Missing authorization' } }

    const token = await validateToken(rawToken)

    const hasGlobal = token.scopes.includes('backup-audit:read:global')
    const hasOwn = token.scopes.includes('backup-audit:read:own')

    if (!hasGlobal && !hasOwn) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    // Tenant owner constraints
    if (!hasGlobal) {
      if (!params.tenant_id || params.tenant_id !== token.tenantId) {
        return { statusCode: 403, headers, body: { error: 'Tenant owners can only query their own tenant' } }
      }
    }

    // Date range validation
    const from = params.from ? new Date(params.from) : undefined
    const to = params.to ? new Date(params.to) : undefined
    if (from && to) {
      const rangeMs = to.getTime() - from.getTime()
      if (rangeMs > MAX_AUDIT_RANGE_DAYS * MS_PER_DAY) {
        return {
          statusCode: 422,
          headers,
          body: { error: 'range_too_wide', max_days: MAX_AUDIT_RANGE_DAYS },
        }
      }
    }

    // Build filters
    const eventTypes = params.event_type
      ? params.event_type.split(',').map((t) => t.trim()) as AuditEventType[]
      : undefined

    const filters: AuditQueryFilters = {
      tenantId: params.tenant_id,
      eventType: eventTypes && eventTypes.length === 1 ? eventTypes[0] : eventTypes,
      actorId: params.actor_id,
      operationId: params.operation_id,
      result: params.result,
      from,
      to,
      limit: params.limit ? parseInt(params.limit, 10) : 50,
      cursor: params.cursor,
    }

    const page = await AuditTrailRepository.query(filters)

    // Serialize based on role
    const events = (page.events as unknown as AuditEvent[]).map((e) =>
      hasGlobal ? serializeAdmin(e) : serializePublic(e),
    )

    return {
      statusCode: 200,
      headers,
      body: {
        schema_version: '1',
        events,
        pagination: {
          limit: page.pagination.limit,
          next_cursor: page.pagination.nextCursor,
          total: null,
        },
      },
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return { statusCode: err.statusCode, headers, body: { error: err.message } }
    }
    console.error('[query-audit] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}

function serializeAdmin(e: AuditEvent): AuditEventAdmin {
  return {
    schema_version: '1',
    id: e.id,
    event_type: e.eventType,
    correlation_id: e.correlationId!,
    operation_id: e.operationId ?? null,
    tenant_id: e.tenantId,
    component_type: e.componentType,
    instance_id: e.instanceId,
    snapshot_id: e.snapshotId ?? null,
    actor_id: e.actorId,
    actor_role: e.actorRole,
    session_id: e.sessionContext.sessionId ?? null,
    source_ip: e.sessionContext.sourceIp ?? null,
    user_agent: e.sessionContext.userAgent ?? null,
    session_context_status: e.sessionContext.status,
    result: e.result,
    rejection_reason: e.rejectionReason ?? null,
    rejection_reason_public: e.rejectionReasonPublic ?? null,
    detail: e.detail ?? null,
    detail_truncated: e.detailTruncated,
    destructive: e.destructive ?? false,
    occurred_at: e.occurredAt.toISOString(),
  }
}

function serializePublic(e: AuditEvent): AuditEventPublic {
  return {
    schema_version: '1',
    id: e.id,
    event_type: e.eventType,
    correlation_id: e.correlationId!,
    operation_id: e.operationId ?? null,
    tenant_id: e.tenantId,
    component_type: e.componentType,
    result: e.result,
    rejection_reason_public: e.rejectionReasonPublic ?? null,
    destructive: e.destructive ?? false,
    occurred_at: e.occurredAt.toISOString(),
  }
}
