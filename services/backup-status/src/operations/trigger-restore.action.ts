/**
 * OpenWhisk action: POST /v1/backup/restore.
 * Default path now starts the confirmation flow; set RESTORE_CONFIRMATION_ENABLED=false
 * to preserve the legacy direct-dispatch behavior.
 */

import { validateToken, AuthError } from '../api/backup-status.auth.js'
import { adapterRegistry, getCapabilities, isActionAdapter } from '../adapters/registry.js'
import type { AdapterContext, BackupActionAdapter } from '../adapters/types.js'
import * as repo from './operations.repository.js'
import * as dispatcher from './operation-dispatcher.js'
import * as audit from '../shared/audit.js'
import { emitAuditEvent } from '../audit/audit-trail.js'
import { initiate, toSnakeCaseInitiate, ConfirmationError } from '../confirmations/confirmations.service.js'
import { isSafeSimulationProfile } from './restore-simulation.types.js'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_body?: string
  tenant_id?: string
  component_type?: string
  instance_id?: string
  snapshot_id?: string
}

function extractSessionContext(owHeaders: Record<string, string>) {
  const sessionId = owHeaders['x-session-id'] ?? null
  const sourceIp = owHeaders['x-forwarded-for']?.split(',')[0]?.trim()
    ?? owHeaders['x-real-ip']
    ?? null
  const userAgent = owHeaders['user-agent'] ?? null
  const status: 'full' | 'partial' | 'not_applicable' = sessionId || sourceIp ? 'full' : 'not_applicable'
  return { sessionId, sourceIp, userAgent, status }
}

function extractToken(headers: Record<string, string>): string | null {
  const auth = headers.authorization ?? headers.Authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

function parseBody(params: ActionParams): { tenant_id?: string; component_type?: string; instance_id?: string; snapshot_id?: string; scope?: 'partial' | 'full'; execution_mode?: 'operative' | 'simulation' } {
  if (params.__ow_body) {
    return JSON.parse(Buffer.from(params.__ow_body, 'base64').toString())
  }
  return {
    tenant_id: params.tenant_id,
    component_type: params.component_type,
    instance_id: params.instance_id,
    snapshot_id: params.snapshot_id,
  }
}

async function validateSnapshotAvailability(body: { tenant_id: string; component_type: string; instance_id: string; snapshot_id: string }) {
  const adapter = adapterRegistry.get(body.component_type)
  const adapterContext: AdapterContext = {
    deploymentProfile: process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default',
    serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
    k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
  }

  if (!isActionAdapter(adapter)) return

  const snapshots = await (adapter as BackupActionAdapter).listSnapshots(body.instance_id, body.tenant_id, adapterContext)
  const snap = snapshots.find((s) => s.snapshotId === body.snapshot_id)
  if (!snap || !snap.available) {
    throw new ConfirmationError(422, 'snapshot_not_available')
  }
}

async function legacyDirectDispatch(params: ActionParams, token: { sub: string }) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const sessionContext = extractSessionContext(params.__ow_headers ?? {})

  const body = parseBody(params)
  const { tenant_id, component_type, instance_id, snapshot_id } = body
  if (!tenant_id || !component_type || !instance_id || !snapshot_id) {
    return { statusCode: 400, headers, body: { error: 'Missing required fields: tenant_id, component_type, instance_id, snapshot_id' } }
  }

  const caps = getCapabilities(component_type)
  if (!caps.triggerRestore) {
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
      rejectionReason: 'adapter_capability_not_supported',
      rejectionReasonPublic: 'El tipo de componente no soporta restauración.',
      destructive: true,
      detail: JSON.stringify({ confirmation_bypassed: true }),
    })
    return { statusCode: 422, headers, body: { error: 'adapter_capability_not_supported' } }
  }

  const active = await repo.findActive(tenant_id, component_type, instance_id, 'restore')
  if (active) {
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
      rejectionReason: 'operation_already_active',
      rejectionReasonPublic: 'Ya existe una operación de restauración activa.',
      destructive: true,
      detail: JSON.stringify({ conflict_operation_id: active.id, confirmation_bypassed: true }),
    })
    return { statusCode: 409, headers, body: { error: 'operation_already_active', conflict_operation_id: active.id } }
  }

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
        rejectionReason: 'snapshot_not_available',
        rejectionReasonPublic: 'El snapshot solicitado no está disponible.',
        destructive: true,
        detail: JSON.stringify({ confirmation_bypassed: true }),
      })
      return { statusCode: 422, headers, body: { error: 'snapshot_not_available' } }
    }
  }

  const operation = await repo.create({
    type: 'restore',
    tenantId: tenant_id,
    componentType: component_type,
    instanceId: instance_id,
    requesterId: token.sub,
    requesterRole: 'sre',
    snapshotId: snapshot_id,
  })

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
    detail: JSON.stringify({ confirmation_bypassed: true }),
  })

  void dispatcher.dispatch(operation.id).catch((err) => {
    console.error(`[trigger-restore] dispatch error for ${operation.id}:`, err)
  })

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
      confirmation_bypassed: true,
    },
  }
}

async function simulationDispatch(body: Required<Pick<NonNullable<ReturnType<typeof parseBody>>, 'tenant_id' | 'component_type' | 'instance_id' | 'snapshot_id'>> & { scope?: 'partial' | 'full' }, token: { sub: string }, sessionContext: ReturnType<typeof extractSessionContext>) {
  const profile = process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default'
  if (!isSafeSimulationProfile(profile)) {
    throw new ConfirmationError(403, 'restore_simulation_profile_not_allowed', { deployment_profile: profile })
  }

  const caps = getCapabilities(body.component_type)
  if (!caps.triggerRestore) {
    throw new ConfirmationError(422, 'adapter_capability_not_supported')
  }

  const active = await repo.findActive(body.tenant_id, body.component_type, body.instance_id, 'restore')
  if (active) {
    throw new ConfirmationError(409, 'operation_already_active', { conflict_operation_id: active.id })
  }

  await validateSnapshotAvailability(body)

  const operation = await repo.create({
    type: 'restore',
    tenantId: body.tenant_id,
    componentType: body.component_type,
    instanceId: body.instance_id,
    requesterId: token.sub,
    requesterRole: 'sre',
    snapshotId: body.snapshot_id,
    metadata: {
      execution_mode: 'simulation',
      target_environment: profile,
      evidence_refs: [],
      validation_summary: null,
    },
  })

  void emitAuditEvent({
    eventType: 'restore.simulation.requested',
    operationId: operation.id,
    tenantId: body.tenant_id,
    componentType: body.component_type,
    instanceId: body.instance_id,
    snapshotId: body.snapshot_id,
    actorId: token.sub,
    actorRole: 'sre',
    sessionContext,
    result: 'accepted',
    destructive: false,
    detail: JSON.stringify({
      execution_mode: 'simulation',
      target_environment: profile,
      snapshot_id: body.snapshot_id,
    }),
  })

  void dispatcher.dispatch(operation.id).catch((err) => {
    console.error(`[trigger-restore] simulation dispatch error for ${operation.id}:`, err)
  })

  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: {
      operation_id: operation.id,
      status: 'accepted',
      accepted_at: operation.acceptedAt.toISOString(),
      execution_mode: 'simulation',
      target_environment: profile,
    },
  }
}

export async function main(params: ActionParams) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

  try {
    const rawToken = extractToken(params.__ow_headers ?? {})
    if (!rawToken) return { statusCode: 401, headers, body: { error: 'Missing authorization' } }

    const token = await validateToken(rawToken)
    if (!token.scopes.includes('backup:restore:global') && !token.scopes.includes('superadmin')) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    const body = parseBody(params)
    if (body.execution_mode === 'simulation') {
      if (!body.tenant_id || !body.component_type || !body.instance_id || !body.snapshot_id) {
        return { statusCode: 400, headers, body: { error: 'Missing required fields: tenant_id, component_type, instance_id, snapshot_id' } }
      }
      return await simulationDispatch(
        {
          tenant_id: body.tenant_id,
          component_type: body.component_type,
          instance_id: body.instance_id,
          snapshot_id: body.snapshot_id,
          scope: body.scope,
        },
        { sub: token.sub },
        extractSessionContext(params.__ow_headers ?? {}),
      )
    }

    if (process.env.RESTORE_CONFIRMATION_ENABLED === 'false') {
      return await legacyDirectDispatch(params, token)
    }

    if (!body.tenant_id || !body.component_type || !body.instance_id || !body.snapshot_id) {
      return { statusCode: 400, headers, body: { error: 'Missing required fields: tenant_id, component_type, instance_id, snapshot_id' } }
    }

    const adapter = adapterRegistry.get(body.component_type)
    const adapterContext: AdapterContext = {
      deploymentProfile: process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default',
      serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
      k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
    }

    const snapshots = isActionAdapter(adapter)
      ? await (adapter as BackupActionAdapter).listSnapshots(body.instance_id, body.tenant_id, adapterContext)
      : []
    const snap = snapshots.find((s) => s.snapshotId === body.snapshot_id)

    const response = await initiate(
      {
        tenant_id: body.tenant_id,
        component_type: body.component_type,
        instance_id: body.instance_id,
        snapshot_id: body.snapshot_id,
        scope: body.scope,
      },
      { sub: token.sub, tenantId: token.tenantId, role: token.scopes.includes('superadmin') ? 'superadmin' : 'sre', scopes: token.scopes },
      {
        operationsRepo: { findActive: repo.findActive },
        adapterClient: isActionAdapter(adapter) ? (adapter as BackupActionAdapter) : null,
        adapterContext,
        snapshotCreatedAt: snap?.createdAt,
        resolveTenantName: async (tenantId: string) => tenantId,
      },
      snap?.createdAt,
      body.tenant_id,
    )

    return { statusCode: 202, headers, body: toSnakeCaseInitiate(response) }
  } catch (err) {
    if (err instanceof ConfirmationError) {
      return { statusCode: err.statusCode, headers, body: { error: err.code, ...err.detail } }
    }
    if (err instanceof AuthError) {
      return { statusCode: err.statusCode, headers, body: { error: err.message } }
    }
    console.error('[trigger-restore] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}
