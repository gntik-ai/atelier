import { resolveTenantConsumption, resolveWorkspaceConsumption } from '../repositories/effective-entitlements-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, TENANT_NOT_FOUND: 404, WORKSPACE_NOT_FOUND: 404 };

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') return { tenantId: params.tenantId, workspaceId: params.workspaceId };
  if ((actor.type === 'tenant_owner' || actor.type === 'tenant-owner' || actor.type === 'tenant') && (actor.tenantId ?? params.tenantId) === params.tenantId) return { tenantId: params.tenantId, workspaceId: params.workspaceId };
  if ((actor.type === 'workspace_admin' || actor.type === 'workspace-admin') && (actor.tenantId ?? params.tenantId) === params.tenantId && (actor.workspaceId ?? actor.workspace?.id ?? params.workspaceId) === params.workspaceId) return { tenantId: params.tenantId, workspaceId: params.workspaceId };
  throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const { tenantId, workspaceId } = authorize(params);
    const [workspace, tenantProfile] = await Promise.all([
      resolveWorkspaceConsumption(db, tenantId, workspaceId),
      resolveTenantConsumption(db, tenantId)
    ]);
    const capabilityMap = new Map(tenantProfile.capabilities.map((entry) => [entry.capabilityKey, entry]));
    return {
      statusCode: 200,
      body: {
        tenantId,
        workspaceId,
        snapshotAt: new Date().toISOString(),
        dimensions: workspace.quantitativeLimits.map((entry) => ({
          dimensionKey: entry.dimensionKey,
          displayLabel: entry.displayLabel,
          unit: entry.unit,
          tenantEffectiveValue: entry.tenantEffectiveValue,
          workspaceLimit: entry.workspaceLimit,
          workspaceSource: entry.workspaceSource,
          currentUsage: entry.currentUsage,
          usageStatus: entry.usageStatus,
          usageUnknownReason: entry.usageUnknownReason
        })),
        capabilities: tenantProfile.capabilities.map((entry) => ({ capabilityKey: entry.capabilityKey, displayLabel: entry.displayLabel, enabled: entry.effectiveState, source: capabilityMap.get(entry.capabilityKey)?.source ?? 'plan' }))
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
