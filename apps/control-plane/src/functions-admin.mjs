import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  OPENWHISK_ADMIN_CAPABILITY_MATRIX,
  OPENWHISK_ADMIN_RESOURCE_KINDS,
  SUPPORTED_OPENWHISK_VERSION_RANGES,
  buildOpenWhiskServerlessContext,
  isOpenWhiskVersionSupported,
  resolveOpenWhiskAdminProfile
} from '../../../services/adapters/src/openwhisk-admin.mjs';

export const functionsApiFamily = getApiFamily('functions');
export const functionAdminRequestContract = getContract('function_admin_request');
export const functionAdminResultContract = getContract('function_admin_result');
export const functionInventorySnapshotContract = getContract('function_inventory_snapshot');
export const functionsAdminRoutes = filterPublicRoutes({ family: 'functions' });

export function listFunctionsAdminRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'functions', ...filters });
}

export function getFunctionsAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'functions' ? route : undefined;
}

export function summarizeFunctionsAdminSurface() {
  return OPENWHISK_ADMIN_RESOURCE_KINDS.map((resourceKind) => ({
    resourceKind,
    actions: OPENWHISK_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [],
    routeCount: functionsAdminRoutes.filter((route) => route.resourceType === `function_${resourceKind}`).length
  })).concat([
    {
      resourceKind: 'action',
      actions: ['get', 'create'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function').length
    },
    {
      resourceKind: 'inventory',
      actions: ['get'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_inventory').length
    }
  ]);
}

export function getOpenWhiskCompatibilitySummary(context = {}) {
  const profile = resolveOpenWhiskAdminProfile(context);
  const serverlessContext = buildOpenWhiskServerlessContext(context);

  return {
    provider: 'openwhisk',
    contractVersion: functionAdminRequestContract?.version ?? '2026-03-25',
    namespaceStrategy: profile.namespaceStrategy,
    subjectProvisioning: profile.subjectProvisioning,
    deploymentProfileId: profile.deploymentProfileId,
    namingPolicy: serverlessContext.namingPolicy,
    serverlessContext,
    quotaGuardrails: profile.quotaGuardrails,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    auditCoverage: profile.auditCoverage,
    packageMutationsSupported: profile.packageMutationsSupported,
    triggerMutationsSupported: profile.triggerMutationsSupported,
    ruleMutationsSupported: profile.ruleMutationsSupported,
    logicalContextMutationsSupported: profile.logicalContextMutationsSupported,
    nativeAdminCrudExposed: false,
    supportedVersions: SUPPORTED_OPENWHISK_VERSION_RANGES.map(
      ({ range, label, namespaceStrategy, subjectProvisioning, resourceSurface }) => ({
        range,
        label,
        namespaceStrategy,
        subjectProvisioning,
        resourceSurface
      })
    )
  };
}

export { isOpenWhiskVersionSupported };
