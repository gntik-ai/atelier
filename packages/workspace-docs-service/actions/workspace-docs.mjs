import { assembleWorkspaceDocs } from '../src/doc-assembler.mjs'
import { recordAccess } from '../src/doc-audit.mjs'
import { sanitise } from '../src/note-sanitiser.mjs'
import { insertNote, updateNote, softDeleteNote } from '../src/note-repository.mjs'
import { INTERNAL_API_BASE_URL } from '../src/config.mjs'

const SUPPORTED_API_VERSIONS = new Set(['2026-03-26'])
const ADMIN_ROLES = new Set(['workspace_admin', 'workspace_owner'])
const VIEWER_ROLES = new Set([
  'tenant_owner',
  'tenant_admin',
  'workspace_viewer',
  'workspace_admin',
  'workspace_owner',
  'developer_external'
])

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body
  }
}

function parseRoles(auth) {
  if (Array.isArray(auth.roles)) return auth.roles
  if (typeof auth.roles === 'string') return auth.roles.split(',').map((value) => value.trim()).filter(Boolean)
  return []
}

function workspaceIdFromPath(path = '') {
  const match = String(path).match(/\/workspaces\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function normalizeAuth(auth = {}, params = {}) {
  const pathWorkspaceId = params.workspaceId ?? workspaceIdFromPath(params.path)
  const authWorkspaceId = auth.workspaceId ?? auth.workspace_id ?? null

  return {
    ...auth,
    tenantId: auth.tenantId ?? auth.tenant_id ?? null,
    workspaceId: pathWorkspaceId ?? authWorkspaceId ?? null,
    workspaceMismatch: Boolean(pathWorkspaceId && authWorkspaceId && pathWorkspaceId !== authWorkspaceId),
    actorId: auth.actorId ?? auth.actor_id ?? auth.subject ?? auth.sub ?? null,
    roles: parseRoles(auth)
  }
}

function ensureContext(auth) {
  if (auth?.workspaceMismatch) {
    return response(403, { code: 'FORBIDDEN', message: 'Credential workspace does not match requested workspace' })
  }
  if (!auth?.tenantId || !auth?.workspaceId || !auth?.actorId) {
    return response(403, { code: 'FORBIDDEN', message: 'Missing workspace auth context' })
  }
  return null
}

function headerValue(headers = {}, name) {
  const lowerName = name.toLowerCase()
  const direct = headers[name] ?? headers[lowerName]
  if (Array.isArray(direct)) return direct[0]
  if (direct != null) return direct

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue
    return Array.isArray(value) ? value[0] : value
  }
  return undefined
}

function ensureVersion(headers = {}) {
  const version = headerValue(headers, 'X-API-Version')
  if (version && !SUPPORTED_API_VERSIONS.has(version)) {
    return response(400, { code: 'UNSUPPORTED_API_VERSION', message: 'Unsupported API version' })
  }
  return null
}

function hasRole(roles, allowedRoles) {
  return roles.some((role) => allowedRoles.has(role))
}

function noteIdFromPath(path) {
  const match = path.match(/\/notes\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function requestBaseUrl(headers = {}) {
  const forwardedProto = headerValue(headers, 'X-Forwarded-Proto')
  const forwardedHost = headerValue(headers, 'X-Forwarded-Host')
  const proto = String(forwardedProto ?? 'http').split(',')[0].trim() || 'http'
  const host = String(forwardedHost ?? headerValue(headers, 'Host') ?? '').split(',')[0].trim()
  return host ? `${proto}://${host}` : INTERNAL_API_BASE_URL
}

function defaultInternalClient(headers = {}) {
  const baseUrl = INTERNAL_API_BASE_URL || requestBaseUrl(headers)
  return {
    getApiSurface: async (workspaceId) => ({
      workspaceId,
      baseUrl,
      authMethod: 'bearer_oidc',
      tokenEndpoint: null,
      scopeHint: 'openid profile'
    }),
    getEffectiveCapabilities: async (workspaceId) => ({
      workspaceId,
      baseUrl,
      capabilities: [{
        key: 'postgres-database',
        endpoint: baseUrl ? `${baseUrl}/v1/postgres/workspaces/${workspaceId}` : `/v1/postgres/workspaces/${workspaceId}`,
        name: 'workspace data'
      }]
    })
  }
}

function resolveInternalClient(internalClient = {}, headers = {}) {
  const fallback = defaultInternalClient(headers)
  return {
    getApiSurface: typeof internalClient.getApiSurface === 'function'
      ? internalClient.getApiSurface.bind(internalClient)
      : fallback.getApiSurface,
    getEffectiveCapabilities: typeof internalClient.getEffectiveCapabilities === 'function'
      ? internalClient.getEffectiveCapabilities.bind(internalClient)
      : fallback.getEffectiveCapabilities
  }
}

export async function main(params, overrides = {}) {
  const {
    method = 'GET',
    path = '/',
    body = {},
    auth = {},
    internalClient = {}
  } = params
  const headers = { ...(params.__ow_headers ?? {}), ...(params.headers ?? {}) }
  const db = params.db ?? overrides.db
  const kafkaProducer = params.kafkaProducer ?? overrides.kafkaProducer
  const resolvedInternalClient = params.internalClient ?? overrides.internalClient ?? internalClient

  const authContext = normalizeAuth(auth, params)
  const contextError = ensureContext(authContext)
  if (contextError) return contextError

  const versionError = ensureVersion(headers)
  if (versionError) return versionError

  const correlationId = headers['X-Correlation-Id'] ?? headers['x-correlation-id'] ?? 'corr-missing'
  const ctx = {
    tenantId: authContext.tenantId,
    workspaceId: authContext.workspaceId,
    actorId: authContext.actorId,
    roles: authContext.roles
  }
  const docsInternalClient = resolveInternalClient(resolvedInternalClient, headers)

  try {
    if (method === 'GET' && /\/docs$/.test(path)) {
      if (!hasRole(ctx.roles, VIEWER_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Insufficient workspace access' }, { 'X-Correlation-Id': correlationId })
      }

      const docs = await assembleWorkspaceDocs(ctx, db, docsInternalClient)
      await recordAccess(db, kafkaProducer, ctx.workspaceId, ctx.actorId, correlationId, ctx.tenantId)
      return response(200, docs, { 'X-Correlation-Id': correlationId })
    }

    if (method === 'POST' && /\/docs\/notes$/.test(path)) {
      if (!hasRole(ctx.roles, ADMIN_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Only workspace admins can manage notes' }, { 'X-Correlation-Id': correlationId })
      }
      const note = await insertNote(db, ctx.tenantId, ctx.workspaceId, ctx.actorId, sanitise(body.content))
      return response(201, note, { 'X-Correlation-Id': correlationId })
    }

    if (method === 'PUT' && /\/docs\/notes\//.test(path)) {
      if (!hasRole(ctx.roles, ADMIN_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Only workspace admins can manage notes' }, { 'X-Correlation-Id': correlationId })
      }
      const note = await updateNote(db, ctx.tenantId, ctx.workspaceId, noteIdFromPath(path), sanitise(body.content))
      if (!note) {
        return response(404, { code: 'NOTE_NOT_FOUND', message: 'Note not found' }, { 'X-Correlation-Id': correlationId })
      }
      return response(200, note, { 'X-Correlation-Id': correlationId })
    }

    if (method === 'DELETE' && /\/docs\/notes\//.test(path)) {
      if (!hasRole(ctx.roles, ADMIN_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Only workspace admins can manage notes' }, { 'X-Correlation-Id': correlationId })
      }
      const deleted = await softDeleteNote(db, ctx.tenantId, ctx.workspaceId, noteIdFromPath(path))
      if (!deleted) {
        return response(404, { code: 'NOTE_NOT_FOUND', message: 'Note not found' }, { 'X-Correlation-Id': correlationId })
      }
      return { statusCode: 204, headers: { 'X-Correlation-Id': correlationId } }
    }

    return response(501, { code: 'NOT_IMPLEMENTED', message: 'Route not implemented' }, { 'X-Correlation-Id': correlationId })
  } catch (error) {
    if (error?.code === 'INVALID_NOTE_CONTENT') {
      return response(422, { code: 'INVALID_NOTE_CONTENT', message: 'Content too long or empty' }, { 'X-Correlation-Id': correlationId })
    }
    if (error?.code === 'WORKSPACE_NOT_FOUND' || error?.statusCode === 404) {
      return response(404, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found or inaccessible' }, { 'X-Correlation-Id': correlationId })
    }
    if (error?.code === 'UPSTREAM_UNAVAILABLE' || error?.statusCode === 503) {
      return response(503, { code: 'UPSTREAM_UNAVAILABLE', message: 'Unable to resolve workspace configuration' }, { 'X-Correlation-Id': correlationId })
    }
    return response(500, { code: 'INTERNAL_ERROR', message: 'Unexpected workspace docs error' }, { 'X-Correlation-Id': correlationId })
  }
}
