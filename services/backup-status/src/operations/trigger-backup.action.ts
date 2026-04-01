/**
 * OpenWhisk action: POST /v1/backup/trigger — initiate on-demand backup.
 */

import { validateToken, enforceScope, AuthError } from '../api/backup-status.auth.js'
import { getCapabilities } from '../adapters/registry.js'
import * as repo from './operations.repository.js'
import * as dispatcher from './operation-dispatcher.js'
import * as audit from '../shared/audit.js'

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

    // Scope enforcement: write:own can only operate on own tenant
    if (!hasWriteGlobal && token.tenantId !== tenant_id) {
      return { statusCode: 403, headers, body: { error: 'Cannot operate on another tenant' } }
    }

    // Check adapter capabilities
    const caps = getCapabilities(component_type)
    if (!caps.triggerBackup) {
      return { statusCode: 422, headers, body: { error: 'adapter_capability_not_supported', detail: `Component type '${component_type}' does not support trigger backup` } }
    }

    // Check deployment profile
    if (!BACKUP_ENABLED) {
      return { statusCode: 501, headers, body: { error: 'backup_not_enabled_in_deployment' } }
    }

    // Check for active concurrent operation
    const active = await repo.findActive(tenant_id, component_type, instance_id, 'backup')
    if (active) {
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

    // Dispatch async (non-blocking)
    void dispatcher.dispatch(operation.id).catch((err) => {
      console.error(`[trigger-backup] dispatch error for ${operation.id}:`, err)
    })

    // Audit event
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
