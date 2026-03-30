import { listNotes } from './note-repository.mjs'
import { buildSnippetContexts } from './snippet-context-builder.mjs'

function withTimeout(promise, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Upstream timeout')
      error.code = 'UPSTREAM_UNAVAILABLE'
      error.statusCode = 503
      reject(error)
    }, ms)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function buildAuthInstructions(apiSurface) {
  return {
    method: apiSurface.authMethod ?? 'bearer_oidc',
    tokenEndpoint: apiSurface.tokenEndpoint ?? null,
    clientIdPlaceholder: '<YOUR_CLIENT_ID>',
    clientSecretPlaceholder: '<YOUR_CLIENT_SECRET>',
    scopeHint: apiSurface.scopeHint ?? 'openid profile',
    consoleRef: 'Settings → Applications → [your application] → Credentials'
  }
}

export async function assembleWorkspaceDocs(ctx, db, internalClient) {
  try {
    const [apiSurface, effectiveCapabilities] = await Promise.all([
      withTimeout(internalClient.getApiSurface(ctx.workspaceId, ctx), 2000),
      withTimeout(internalClient.getEffectiveCapabilities(ctx.workspaceId, ctx), 2000)
    ])

    const enabledServices = buildSnippetContexts(apiSurface, effectiveCapabilities)
    const customNotes = await listNotes(db, ctx.tenantId, ctx.workspaceId)

    return {
      workspaceId: ctx.workspaceId,
      tenantId: ctx.tenantId,
      generatedAt: new Date().toISOString(),
      baseUrl: apiSurface.baseUrl ?? '',
      authInstructions: buildAuthInstructions(apiSurface),
      enabledServices,
      customNotes,
      stale: false
    }
  } catch (error) {
    if (error?.statusCode === 404) {
      error.code = 'WORKSPACE_NOT_FOUND'
      throw error
    }

    if (error?.code === 'UPSTREAM_UNAVAILABLE' || error?.statusCode === 503) {
      return {
        workspaceId: ctx.workspaceId,
        tenantId: ctx.tenantId,
        generatedAt: new Date().toISOString(),
        baseUrl: '',
        authInstructions: buildAuthInstructions({}),
        enabledServices: [],
        customNotes: await listNotes(db, ctx.tenantId, ctx.workspaceId),
        stale: true
      }
    }

    throw error
  }
}
