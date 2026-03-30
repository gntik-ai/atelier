import { buildCatalog } from '../../../workspace-docs-service/src/capability-catalog-builder.mjs';

export function createWorkspaceCapabilityCatalogAction({
  fetchCapabilities,
  emitAuditEvent = async () => {},
  logger = console,
  now = () => new Date()
} = {}) {
  return async function main(params = {}) {
    const auth = params.auth ?? params.authorization ?? {};
    const claims = auth.claims ?? auth;
    const workspaceId = params.workspaceId ?? params.path?.workspaceId;
    const capabilityId = params.capabilityId ?? params.path?.capabilityId ?? null;

    if (!claims.actorId || !claims.tenantId || !claims.workspaceId) {
      return errorResponse(401, 'UNAUTHORIZED', 'Missing or invalid JWT context.');
    }

    if (!workspaceId || claims.workspaceId !== workspaceId) {
      return errorResponse(403, 'FORBIDDEN', 'Workspace access denied.');
    }

    try {
      const rows = await fetchCapabilities?.({ workspaceId, capabilityId, claims, params });

      if (!Array.isArray(rows) || rows.length === 0) {
        return errorResponse(404, capabilityId ? 'CAPABILITY_NOT_FOUND' : 'WORKSPACE_NOT_FOUND', capabilityId ? 'Capability was not found.' : 'Workspace was not found.');
      }

      if (capabilityId && !rows.some((row) => (row.capability_key ?? row.id) === capabilityId)) {
        return errorResponse(404, 'CAPABILITY_NOT_FOUND', 'Capability was not found.');
      }

      const workspaceContext = {
        workspaceId,
        tenantId: claims.tenantId,
        host: params.host ?? `${workspaceId}.example.internal`,
        port: params.port ?? 443,
        resourceNames: params.resourceNames ?? {
          default: `${workspaceId}-primary`,
          extraA: `${workspaceId}-aux`,
          extraB: `https://functions.example.internal/api/v1/web/${workspaceId}/default/ping`
        },
        endpoints: params.endpoints ?? {
          realtime: params.realtimeEndpoint ?? 'wss://realtime.example.internal'
        }
      };

      const capabilities = buildCatalog(rows, workspaceContext);
      const timestamp = now().toISOString();
      const response = {
        workspaceId,
        tenantId: claims.tenantId,
        generatedAt: timestamp,
        catalogVersion: '1.0.0',
        capabilities
      };

      const auditEvent = {
        eventType: 'workspace.capability-catalog.accessed',
        workspaceId,
        tenantId: claims.tenantId,
        actorId: claims.actorId,
        capabilityId,
        accessDate: timestamp.slice(0, 10),
        correlationId: params.correlationId ?? params.headers?.['x-correlation-id'] ?? `corr-${workspaceId}`,
        timestamp
      };

      emitAuditEvent(auditEvent).catch((error) => {
        logger.warn?.({ action: 'workspace-capability-catalog', error: error.message }, 'audit-publish-failed');
      });

      return {
        statusCode: 200,
        body: response
      };
    } catch (error) {
      logger.error?.({ action: 'workspace-capability-catalog', error: error.message }, 'workspace-capability-catalog-failed');
      return errorResponse(500, 'INTERNAL_ERROR', 'Unexpected failure while building the capability catalog.');
    }
  };
}

function errorResponse(statusCode, code, message) {
  return {
    statusCode,
    body: {
      error: {
        code,
        message
      }
    }
  };
}

export const main = createWorkspaceCapabilityCatalogAction();
