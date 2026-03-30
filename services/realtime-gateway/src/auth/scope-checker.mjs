import { loadEnv } from '../config/env.mjs';
import { getScopeMappings } from '../repositories/scope-mapping-repository.mjs';

function hasWorkspaceAccess(claims, workspaceId) {
  if (!workspaceId) {
    return false;
  }

  if (Array.isArray(claims.authorizedWorkspaces) && claims.authorizedWorkspaces.includes(workspaceId)) {
    return true;
  }

  if (claims.workspace_access && typeof claims.workspace_access === 'object') {
    return Object.hasOwn(claims.workspace_access, workspaceId);
  }

  if (claims.workspace_id === workspaceId) {
    return true;
  }

  return false;
}

export function createScopeChecker({
  envProvider = loadEnv,
  getScopeMappingsFn = getScopeMappings
} = {}) {
  const cache = new Map();

  async function loadMappings(db, tenantId, workspaceId) {
    const env = envProvider();
    const cacheKey = `${tenantId}:${workspaceId}`;
    const now = Date.now();
    const ttlMs = env.SCOPE_REVALIDATION_INTERVAL_SECONDS * 1000;
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.mappings;
    }

    const mappings = await getScopeMappingsFn(db, tenantId, workspaceId);
    cache.set(cacheKey, { mappings, expiresAt: now + ttlMs });
    return mappings;
  }

  return async function checkScopes(claims, workspaceId, channelType, db) {
    const tenantId = claims?.tenant_id;

    if (!tenantId) {
      return {
        allowed: false,
        missingScope: 'tenant_id',
        requiredScope: 'tenant_id'
      };
    }

    if (!hasWorkspaceAccess(claims, workspaceId)) {
      return {
        allowed: false,
        missingScope: 'workspace-access',
        requiredScope: 'workspace-access'
      };
    }

    const claimScopes = Array.isArray(claims.scopes) ? claims.scopes : [];
    const mappings = await loadMappings(db, tenantId, workspaceId);

    if (mappings.length === 0) {
      const allowed = claimScopes.includes('realtime:read');
      return {
        allowed,
        missingScope: allowed ? undefined : 'realtime:read',
        requiredScope: 'realtime:read'
      };
    }

    const relevantMappings = mappings.filter((mapping) => (
      mapping.channel_type === channelType || mapping.channel_type === '*'
    ));

    const matchedMapping = relevantMappings.find((mapping) => claimScopes.includes(mapping.scope_name));

    if (matchedMapping) {
      return {
        allowed: true,
        requiredScope: matchedMapping.scope_name
      };
    }

    return {
      allowed: false,
      missingScope: relevantMappings[0]?.scope_name ?? 'realtime:read',
      requiredScope: relevantMappings[0]?.scope_name ?? 'realtime:read'
    };
  };
}

export const checkScopes = createScopeChecker();
