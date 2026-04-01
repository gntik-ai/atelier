/**
 * OpenWhisk action: REST API handler for GET /v1/backup/status.
 */

import { getByTenant, getAll } from '../db/repository.js'
import type { BackupSnapshot } from '../db/repository.js'
import { validateToken, enforceScope, AuthError } from './backup-status.auth.js'
import type { BackupStatusApiResponse, BackupStatusComponentResponse } from './backup-status.schema.js'
import * as audit from '../shared/audit.js'

const STALE_THRESHOLD_MS = parseInt(process.env.BACKUP_STALE_THRESHOLD_MS ?? '900000', 10) // 15 min default

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
  tenant_id?: string
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

function isStale(lastCheckedAt: Date): boolean {
  return Date.now() - lastCheckedAt.getTime() > STALE_THRESHOLD_MS
}

function serializeComponent(
  snapshot: BackupSnapshot,
  includeTechnical: boolean,
): BackupStatusComponentResponse {
  const stale = isStale(snapshot.lastCheckedAt)
  const component: BackupStatusComponentResponse = {
    component_type: snapshot.componentType,
    instance_label: snapshot.instanceLabel ?? snapshot.componentType,
    status: snapshot.status,
    last_successful_backup_at: snapshot.lastSuccessfulBackupAt?.toISOString() ?? null,
    last_checked_at: snapshot.lastCheckedAt.toISOString(),
    stale,
    stale_since: stale ? snapshot.lastCheckedAt.toISOString() : null,
  }
  if (includeTechnical) {
    component.instance_id = snapshot.instanceId
    component.detail = snapshot.detail ?? undefined
  }
  return component
}

function response(statusCode: number, body: unknown): ActionResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body,
  }
}

export async function main(params: ActionParams): Promise<ActionResponse> {
  // Method check
  if (params.__ow_method && params.__ow_method !== 'get') {
    return response(405, { error: 'Method not allowed' })
  }

  const headers = params.__ow_headers ?? {}
  const token = extractToken(headers)
  if (!token) {
    return response(401, { error: 'Missing or invalid Authorization header' })
  }

  let claims
  try {
    claims = await validateToken(token)
  } catch (err) {
    if (err instanceof AuthError) {
      return response(err.statusCode, { error: err.message })
    }
    return response(401, { error: 'Invalid or expired token' })
  }

  const hasGlobalScope = claims.scopes.includes('backup-status:read:global')
  const hasTechnicalScope = claims.scopes.includes('backup-status:read:technical')
  const hasOwnScope = claims.scopes.includes('backup-status:read:own')
  const requestedTenantId = params.tenant_id

  // Enforce scopes
  if (requestedTenantId) {
    if (!hasGlobalScope && claims.tenantId !== requestedTenantId) {
      return response(403, { error: 'Forbidden: cannot access another tenant\'s backup status' })
    }
    if (!hasGlobalScope && !hasOwnScope) {
      return response(403, { error: 'Forbidden: missing backup-status:read:own scope' })
    }
  } else {
    if (!hasGlobalScope) {
      return response(403, { error: 'Forbidden: global view requires backup-status:read:global scope' })
    }
  }

  // Query snapshots
  let snapshots: BackupSnapshot[]
  try {
    if (requestedTenantId) {
      snapshots = await getByTenant(requestedTenantId, { includeShared: hasTechnicalScope })
    } else {
      snapshots = await getAll({ includeShared: hasTechnicalScope })
    }
  } catch (err) {
    console.error('[api] Database query failed:', err)
    return response(500, { error: 'Internal server error' })
  }

  // Filter shared instances for non-technical scopes
  if (!hasTechnicalScope) {
    snapshots = snapshots.filter((s) => !s.isSharedInstance)
  }

  const deploymentBackupAvailable = snapshots.some(
    (s) => s.status !== 'not_available' && s.status !== 'not_configured',
  )

  const body: BackupStatusApiResponse = {
    schema_version: '1',
    tenant_id: requestedTenantId ?? null,
    queried_at: new Date().toISOString(),
    components: snapshots.map((s) => serializeComponent(s, hasTechnicalScope)),
    deployment_backup_available: deploymentBackupAvailable,
  }

  if (!deploymentBackupAvailable) {
    // Still return the components but add context
    ;(body as Record<string, unknown>).message =
      'La visibilidad de backup no está habilitada en este perfil de despliegue.'
  }

  // Audit access event
  try {
    await audit.logAccessEvent({
      actor: claims.sub,
      tenantId: requestedTenantId ?? '*',
      timestamp: new Date().toISOString(),
      action: 'backup_status_read',
    })
  } catch {
    // Non-blocking
  }

  return response(200, body)
}
