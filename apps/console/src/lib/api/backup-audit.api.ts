/**
 * HTTP client for GET /v1/backup/audit.
 */

import type { AuditQueryFilters, AuditEventPage } from '../../../../services/backup-status/src/audit/audit-trail.types.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export async function fetchAuditEvents(
  filters: AuditQueryFilters,
  token: string,
): Promise<AuditEventPage> {
  const params = new URLSearchParams()

  if (filters.tenantId) params.set('tenant_id', filters.tenantId)
  if (filters.eventType) {
    const types = Array.isArray(filters.eventType) ? filters.eventType : [filters.eventType]
    params.set('event_type', types.join(','))
  }
  if (filters.actorId) params.set('actor_id', filters.actorId)
  if (filters.operationId) params.set('operation_id', filters.operationId)
  if (filters.result) params.set('result', filters.result)
  if (filters.from) params.set('from', filters.from.toISOString())
  if (filters.to) params.set('to', filters.to.toISOString())
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.cursor) params.set('cursor', filters.cursor)

  const res = await fetch(`${BASE_URL}/v1/backup/audit?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    throw new Error(`Audit query failed: ${res.status}`)
  }

  return res.json()
}
