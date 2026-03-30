import { assembleWorkspaceDocs } from '../src/doc-assembler.mjs'
import { recordAccess } from '../src/doc-audit.mjs'
import { sanitise } from '../src/note-sanitiser.mjs'
import { insertNote, updateNote, softDeleteNote } from '../src/note-repository.mjs'

const SUPPORTED_API_VERSION = '2026-03-01'
const ADMIN_ROLES = new Set(['workspace_admin', 'workspace_owner'])
const VIEWER_ROLES = new Set(['workspace_viewer', 'workspace_admin', 'workspace_owner', 'developer_external'])

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

function ensureContext(auth) {
  if (!auth?.tenantId || !auth?.workspaceId || !auth?.actorId) {
    return response(403, { code: 'FORBIDDEN', message: 'Missing workspace auth context' })
  }
  return null
}

function ensureVersion(headers = {}) {
  const version = headers['X-API-Version'] ?? headers['x-api-version']
  if (version && version !== SUPPORTED_API_VERSION) {
    return response(400, { code: 'UNSUPPORTED_API_VERSION', message: 'Unsupported API version' })
  }
  return null
}

function hasRole(roles, allowedRoles) {
  return roles.some((role) => allowedRoles.has(role))
}

function noteIdFromPath(path) {
  const match = path.match(/\/notes\/([^/]+)$/)
  return match ? match[1] : null
}

export async function main(params) {
  const {
    method = 'GET',
    path = '/',
    body = {},
    headers = {},
    auth = {},
    db,
    kafkaProducer,
    internalClient = {}
  } = params

  const contextError = ensureContext(auth)
  if (contextError) return contextError

  const versionError = ensureVersion(headers)
  if (versionError) return versionError

  const correlationId = headers['X-Correlation-Id'] ?? headers['x-correlation-id'] ?? 'corr-missing'
  const roles = parseRoles(auth)
  const ctx = {
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    actorId: auth.actorId,
    roles
  }

  try {
    if (method === 'GET' && /\/docs$/.test(path)) {
      if (!hasRole(roles, VIEWER_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Insufficient workspace access' }, { 'X-Correlation-Id': correlationId })
      }

      const docs = await assembleWorkspaceDocs(ctx, db, internalClient)
      await recordAccess(db, kafkaProducer, ctx.workspaceId, ctx.actorId, correlationId, ctx.tenantId)
      return response(200, docs, { 'X-Correlation-Id': correlationId })
    }

    if (method === 'POST' && /\/docs\/notes$/.test(path)) {
      if (!hasRole(roles, ADMIN_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Only workspace admins can manage notes' }, { 'X-Correlation-Id': correlationId })
      }
      const note = await insertNote(db, ctx.tenantId, ctx.workspaceId, ctx.actorId, sanitise(body.content))
      return response(201, note, { 'X-Correlation-Id': correlationId })
    }

    if (method === 'PUT' && /\/docs\/notes\//.test(path)) {
      if (!hasRole(roles, ADMIN_ROLES)) {
        return response(403, { code: 'FORBIDDEN', message: 'Only workspace admins can manage notes' }, { 'X-Correlation-Id': correlationId })
      }
      const note = await updateNote(db, ctx.tenantId, ctx.workspaceId, noteIdFromPath(path), sanitise(body.content))
      if (!note) {
        return response(404, { code: 'NOTE_NOT_FOUND', message: 'Note not found' }, { 'X-Correlation-Id': correlationId })
      }
      return response(200, note, { 'X-Correlation-Id': correlationId })
    }

    if (method === 'DELETE' && /\/docs\/notes\//.test(path)) {
      if (!hasRole(roles, ADMIN_ROLES)) {
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
