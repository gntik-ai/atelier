/**
 * OpenWhisk action: POST /v1/backup/restore — request snapshot restoration.
 */

import { validateToken, AuthError } from '../api/backup-status.auth.js'
import { getCapabilities, isActionAdapter } from '../adapters/registry.js'
import { adapterRegistry } from '../adapters/registry.js'
import type { BackupActionAdapter, AdapterContext } from '../adapters/types.js'
import * as repo from './operations.repository.js'
import * as dispatcher from './operation-dispatcher.js'
import * as audit from '../shared/audit.js'
import { emitAuditEvent } from '../audit/audit-trail.js'
import type { SessionContext } from '../audit/audit-trail.types.js'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
  __ow_body?: string
  tenant_id?: string
  component_type?: string
  instance_id?: string
  snapshot_id?: string
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

    const sessionContext = extractSessionContext(params.__ow_headers ?? {})

    // Restore requires backup:restore:global — SRE/superadmin only
    if (!token.scopes.includes('backup:restore:global')) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    // Parse body
    let body: { tenant_id?: string; component_type?: string; instance_id?: string; snapshot_id?: string }
    if (params.__ow_body) {
      body = JSON.parse(Buffer.from(params.__ow_body, 'base64').toString())
    } else {
      body = {
        tenant_id: params.tenant_id,
        component_type: params.component_type,
        instance_id: params.instance_id,
        snapshot_id: params.snapshot_id,
      }
    }

    const { tenant_id, component_type, instance_id, snapshot_id } = body
    if (!tenant_id || !component_type || !instance_id || !snapshot_id) {
      return { statusCode: 400, headers, body: { error: 'Missing required fields: tenant_id, component_type, instance_id, snapshot_id' } }
    }

    // Helper for rejected restore audit events
    const emitRejection = (rejectionReason: string, rejectionReasonPublic: string) => {
      void emitAuditEvent({
        eventType: 'restore.rejected',
        operationId: null,
        tenantId: tenant_id,
        componentType: component_type,
        instanceId: instance_id,
        snapshotId: snapshot_id,
        actorId: token.sub,
        actorRole: 'sre',
        sessionContext,
        result: 'rejected',
        rejectionReason,
        rejectionReasonPublic,
        destructive: true,
      })
    }

    // Check adapter capabilities
    const caps = getCapabilities(component_type)
    if (!caps.triggerRestore) {
      emitRejection('adapter_capability_not_supported', 'El tipo de componente no soporta restauración.')
      return { statusCode: 422, headers, body: { error: 'adapter_capability_not_supported' } }
    }

    // Check for active concurrent restore
    const active = await repo.findActive(tenant_id, component_type, instance_id, 'restore')
    if (active) {
      emitRejection('operation_already_active', 'Ya existe una operación de restauración activa.')
      return { statusCode: 409, headers, body: { error: 'operation_already_active', conflict_operation_id: active.id } }
    }

    // Validate snapshot exists and is available
    const adapter = adapterRegistry.get(component_type)
    if (isActionAdapter(adapter)) {
      const context: AdapterContext = {
        deploymentProfile: process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default',
        serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
        k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
      }
      const snapshots = await (adapter as BackupActionAdapter).listSnapshots(instance_id, tenant_id, context)
      const snap = snapshots.find((s) => s.snapshotId === snapshot_id)
      if (!snap || !snap.available) {
        emitRejection('snapshot_not_available', 'El snapshot solicitado no está disponible.')
        return { statusCode: 422, headers, body: { error: 'snapshot_not_available' } }
      }
    }

    // Create operation record
    const operation = await repo.create({
      type: 'restore',
      tenantId: tenant_id,
      componentType: component_type,
      instanceId: instance_id,
      requesterId: token.sub,
      requesterRole: 'sre',
      snapshotId: snapshot_id,
    })

    // Audit trail event
    void emitAuditEvent({
      eventType: 'restore.requested',
      operationId: operation.id,
      tenantId: tenant_id,
      componentType: component_type,
      instanceId: instance_id,
      snapshotId: snapshot_id,
      actorId: token.sub,
      actorRole: 'sre',
      sessionContext,
      result: 'accepted',
      destructive: true,
    })

    // Dispatch async
    void dispatcher.dispatch(operation.id).catch((err) => {
      console.error(`[trigger-restore] dispatch error for ${operation.id}:`, err)
    })

    // Legacy audit event with destructive flag
    void audit.logAccessEvent({
      actor: token.sub,
      tenantId: tenant_id,
      timestamp: new Date().toISOString(),
      action: 'backup_restore_destructive',
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
    console.error('[trigger-restore] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}
