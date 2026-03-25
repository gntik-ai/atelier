import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  MONGO_ADMIN_CAPABILITY_MATRIX,
  MONGO_ADMIN_RESOURCE_KINDS,
  SUPPORTED_MONGO_VERSION_RANGES,
  isMongoVersionSupported,
  resolveMongoAdminProfile
} from '../../../services/adapters/src/mongodb-admin.mjs';

export const mongoApiFamily = getApiFamily('mongo');
export const mongoAdminRequestContract = getContract('mongo_admin_request');
export const mongoAdminResultContract = getContract('mongo_admin_result');
export const mongoInventorySnapshotContract = getContract('mongo_inventory_snapshot');
export const mongoAdminRoutes = filterPublicRoutes({ family: 'mongo' });

export function listMongoAdminRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'mongo', ...filters });
}

export function getMongoAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'mongo' ? route : undefined;
}

export function summarizeMongoAdminSurface() {
  return MONGO_ADMIN_RESOURCE_KINDS.map((resourceKind) => ({
    resourceKind,
    actions: MONGO_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [],
    routeCount: mongoAdminRoutes.filter((route) => route.resourceType === `mongo_${resourceKind}`).length
  })).concat([
    {
      resourceKind: 'inventory',
      actions: ['get'],
      routeCount: mongoAdminRoutes.filter((route) => route.resourceType === 'mongo_inventory').length
    }
  ]);
}

export function getMongoCompatibilitySummary(context = {}) {
  const profile = resolveMongoAdminProfile(context);

  return {
    provider: 'mongodb',
    contractVersion: mongoAdminRequestContract?.version ?? '2026-03-25',
    clusterProfile: profile.clusterProfile,
    isolationMode: profile.isolationMode,
    clusterTopology: profile.clusterTopology,
    segregationModel: profile.segregationModel,
    supportedSegregationModels: profile.supportedSegregationModels,
    deploymentProfileId: profile.deploymentProfileId,
    quotaGuardrails: profile.quotaGuardrails,
    namingPolicy: profile.namingPolicy,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    allowedRoleBindings: profile.allowedRoleBindings,
    indexMutationsSupported: profile.indexMutationsSupported,
    viewMutationsSupported: profile.viewMutationsSupported,
    templateCatalogSupported: profile.templateCatalogSupported,
    supportedVersions: SUPPORTED_MONGO_VERSION_RANGES.map(
      ({ range, label, adminApiStability, topologies, isolationModes, segregationModels }) => ({
        range,
        label,
        adminApiStability,
        topologies,
        isolationModes,
        segregationModels
      })
    )
  };
}

export { isMongoVersionSupported };
