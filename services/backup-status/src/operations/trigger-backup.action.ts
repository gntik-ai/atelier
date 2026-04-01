/**
 * OpenWhisk action: POST /v1/backup/trigger — initiate on-demand backup.
 */

import { validateToken, enforceScope, AuthError } from '../api/backup-status.auth.js'
import { getCapabilities } from '../adapters/registry.js'
import * as repo from './operations.repository.js'
import * as dispatcher from './operation-dispatcher.js'
import * as audit from '../shared/audit.js'
import { emitAuditEvent } from '../audit/audit-trail.js'
import type { SessionContext } from '../audit/audit-trail.types.js'

const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
  __ow_body?: string
  tenant_id?: string
  component_type?: string
  instance_id?: string
}

interface ActionResponse {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

function extractSessionContext(owHeaders: Record<string, string>): SessionContext {
  const sessionId = owHeaders['x-session-id'] ?? null
  const sourceIp = owHeaders['x-forwarded-for']?.split(',')[0]?.trim()
    ?? owHeaders['x-real-ip']
    ?? null
  const userAgent = owHeaders['user-agent'] ?? null
  const status = sessionId || sourceIp ? 'full' : 'not_applicable' as const
  return { sessionId, sourceIp, userAgent, status }
}

function extractToken(headers: Record<string, string>): string | null {
  const auth = headers.authorization ?? headers.Authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

export async function main(params: ActionParams): Promise<ActionResponse> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

  try {
    const rawToken = extractToken(params.__ow_headers ?? {})
    if (!rawToken) return { statusCode: 401, headers, body: { error: 'Missing authorization' } }

    const token = await validateToken(rawToken)

    // Must have at least backup:write:own
    const hasWriteOwn = token.scopes.includes('backup:write:own')
    const hasWriteGlobal = token.scopes.includes('backup:write:global')
    if (!hasWriteOwn && !hasWriteGlobal) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    const sessionContext = extractSessionContext(params.__ow_headers ?? {})
    const primaryRole = hasWriteGlobal ? 'sre' : 'tenant_owner'

    // Parse body
    let body: { tenant_id?: string; component_type?: string; instance_id?: string }
    if (params.__ow_body) {
      body = JSON.parse(Buffer.from(params.__ow_body, 'base64').toString())
    } else {
      body = { tenant_id: params.tenant_id, component_type: params.component_type, instance_id: params.instance_id }
    }

    const { tenant_id, component_type, instance_id } = body
    if (!tenant_id || !component_type || !instance_id) {
      return { statusCode: 400, headers, body: { error: 'Missing required fields: tenant_id, component_type, instance_id' } }
    }

    // Helper for rejected audit events
    const emitRejection = (rejectionReason: string, rejectionReasonPublic: string) => {
      void emitAuditEvent({
        eventType: 'backup.rejected',
        operationId: null,
        tenantId: tenant_id,
        componentType: component_type,
        instanceId: instance_id,
        actorId: token.sub,
        actorRole: primaryRole,
        sessionContext,
        result: 'rejected',
        rejectionReason,
        rejectionReasonPublic,
        destructive: false,
      })
    }

    // Scope enforcement: write:own can only operate on own tenant
    if (!hasWriteGlobal && token.tenantId !== tenant_id) {
      emitRejection('cross_tenant_not_allowed', 'No tiene permisos para operar en otro tenant.')
      return { statusCode: 403, headers, body: { error: 'Cannot operate on another tenant' } }
    }

    // Check adapter capabilities
    const caps = getCapabilities(component_type)
    if (!caps.triggerBackup) {
      emitRejection('adapter_capability_not_supported', 'El tipo de componente no soporta backup bajo demanda.')
      return { statusCode: 422, headers, body: { error: 'adapter_capability_not_supported', detail: `Component type '${component_type}' does not support trigger backup` } }
    }

    // Check deployment profile
    if (!BACKUP_ENABLED) {
      emitRejection('backup_not_enabled_in_deployment', 'El backup no está habilitado en este despliegue.')
      return { statusCode: 501, headers, body: { error: 'backup_not_enabled_in_deployment' } }
    }

    // Check for active concurrent operation
    const active = await repo.findActive(tenant_id, component_type, instance_id, 'backup')
    if (active) {
      emitRejection('operation_already_active', 'Ya existe una operación activa para este recurso.')
      return { statusCode: 409, headers, body: { error: 'operation_already_active', conflict_operation_id: active.id } }
    }

    // Create operation record
    const operation = await repo.create({
      type: 'backup',
      tenantId: tenant_id,
      componentType: component_type,
      instanceId: instance_id,
      requesterId: token.sub,
      requesterRole: token.scopes.includes('backup:write:global') ? 'sre' : 'tenant_owner',
    })

    // Audit trail event
    void emitAuditEvent({
      eventType: 'backup.requested',
      operationId: operation.id,
      tenantId: tenant_id,
      componentType: component_type,
      instanceId: instance_id,
      actorId: token.sub,
      actorRole: primaryRole,
      sessionContext,
      result: 'accepted',
      destructive: false,
    })

    // Dispatch async (non-blocking)
    void dispatcher.dispatch(operation.id).catch((err) => {
      console.error(`[trigger-backup] dispatch error for ${operation.id}:`, err)
    })

    // Legacy audit event
    void audit.logAccessEvent({
      actor: token.sub,
      tenantId: tenant_id,
      timestamp: new Date().toISOString(),
      action: 'backup_trigger',
    }).catch(() => {})

    return {
      statusCode: 202,
      headers,
      body: {
        operation_id: operation.id,
        status: 'accepted',
        accepted_at: operation.acceptedAt.toISOString(),
      },
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return { statusCode: err.statusCode, headers, body: { error: err.message } }
    }
    console.error('[trigger-backup] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}
