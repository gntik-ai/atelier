/**
 * OpenWhisk action: GET /v1/backup/snapshots — list available snapshots.
 */

import { validateToken, AuthError } from '../api/backup-status.auth.js'
import { getCapabilities, isActionAdapter } from '../adapters/registry.js'
import { adapterRegistry } from '../adapters/registry.js'
import type { BackupActionAdapter, AdapterContext } from '../adapters/types.js'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
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
  const headers = { 'Content-Type': 'application/json' }

  try {
    const rawToken = extractToken(params.__ow_headers ?? {})
    if (!rawToken) return { statusCode: 401, headers, body: { error: 'Missing authorization' } }

    const token = await validateToken(rawToken)

    // Requires global read scope
    if (!token.scopes.includes('backup-status:read:global')) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    const { tenant_id, component_type, instance_id } = params
    if (!tenant_id || !component_type || !instance_id) {
      return { statusCode: 400, headers, body: { error: 'Missing required query params: tenant_id, component_type, instance_id' } }
    }

    // Check capabilities
    const caps = getCapabilities(component_type)
    if (!caps.listSnapshots) {
      return { statusCode: 422, headers, body: { error: 'adapter_capability_not_supported' } }
    }

    const adapter = adapterRegistry.get(component_type)
    if (!isActionAdapter(adapter)) {
      return { statusCode: 422, headers, body: { error: 'adapter_capability_not_supported' } }
    }

    const context: AdapterContext = {
      deploymentProfile: process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default',
      serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
      k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
    }

    const snapshots = await (adapter as BackupActionAdapter).listSnapshots(instance_id, tenant_id, context)

    // Filter internal data — return only safe fields
    const sanitized = snapshots.map((s) => ({
      snapshot_id: s.snapshotId,
      created_at: s.createdAt.toISOString(),
      available: s.available,
      size_bytes: s.sizeBytes ?? null,
      label: s.label ?? null,
    }))

    return {
      statusCode: 200,
      headers,
      body: {
        schema_version: '1',
        tenant_id,
        component_type,
        instance_id,
        snapshots: sanitized,
      },
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return { statusCode: err.statusCode, headers, body: { error: err.message } }
    }
    console.error('[list-snapshots] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}
