import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  OPENWHISK_ACTION_SOURCE_KINDS,
  OPENWHISK_ADMIN_CAPABILITY_MATRIX,
  OPENWHISK_ADMIN_RESOURCE_KINDS,
  OPENWHISK_SUPPORTED_ACTION_RUNTIMES,
  OPENWHISK_SUPPORTED_TRIGGER_KINDS,
  SUPPORTED_OPENWHISK_VERSION_RANGES,
  buildOpenWhiskRuntimeCoverageSummary,
  buildOpenWhiskServerlessContext,
  isOpenWhiskVersionSupported,
  resolveOpenWhiskAdminProfile
} from '../../../services/adapters/src/openwhisk-admin.mjs';

export const functionsApiFamily = getApiFamily('functions');
export const functionAdminRequestContract = getContract('function_admin_request');
export const functionAdminResultContract = getContract('function_admin_result');
export const functionInventorySnapshotContract = getContract('function_inventory_snapshot');
export const functionsAdminRoutes = filterPublicRoutes({ family: 'functions' });
export const SUPPORTED_FUNCTION_SOURCE_KINDS = OPENWHISK_ACTION_SOURCE_KINDS;
export const SUPPORTED_FUNCTION_TRIGGER_KINDS = OPENWHISK_SUPPORTED_TRIGGER_KINDS;
export const SUPPORTED_FUNCTION_RUNTIMES = OPENWHISK_SUPPORTED_ACTION_RUNTIMES;

export function listFunctionsAdminRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'functions', ...filters });
}

export function getFunctionsAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'functions' ? route : undefined;
}

export function summarizeFunctionsAdminSurface() {
  const actionRoutes = functionsAdminRoutes.filter((route) => route.resourceType === 'function_action');

  return OPENWHISK_ADMIN_RESOURCE_KINDS.map((resourceKind) => ({
    resourceKind,
    actions: OPENWHISK_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [],
    routeCount: functionsAdminRoutes.filter((route) => route.resourceType === `function_${resourceKind}`).length
  })).concat([
    {
      resourceKind: 'invocation',
      actions: ['invoke', 'rerun'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_invocation').length
    },
    {
      resourceKind: 'activation',
      actions: ['list', 'get', 'logs', 'result'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType.startsWith('function_activation')).length
    },
    {
      resourceKind: 'http_exposure',
      actions: ['get', 'create', 'update', 'delete'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_http_exposure').length
    },
    {
      resourceKind: 'storage_trigger',
      actions: ['create', 'get'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_storage_trigger').length
    },
    {
      resourceKind: 'cron_trigger',
      actions: ['create', 'get'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_cron_trigger').length
    },
    {
      resourceKind: 'inventory',
      actions: ['get'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_inventory').length
    },
    {
      resourceKind: 'action_collection',
      actions: ['list'],
      routeCount: actionRoutes.filter((route) => route.method === 'GET').length
    }
  ]);
}

export function summarizeFunctionRuntimeCoverage() {
  return buildOpenWhiskRuntimeCoverageSummary().map((runtime) => ({
    ...runtime,
    supportedTriggerKinds: [...SUPPORTED_FUNCTION_TRIGGER_KINDS]
  }));
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
    actionMutationsSupported: profile.actionMutationsSupported,
    packageMutationsSupported: profile.packageMutationsSupported,
    triggerMutationsSupported: profile.triggerMutationsSupported,
    ruleMutationsSupported: profile.ruleMutationsSupported,
    invocationSupported: profile.invocationSupported,
    activationReadsSupported: profile.activationReadsSupported,
    httpExposureSupported: profile.httpExposureSupported,
    storageTriggersSupported: profile.storageTriggersSupported,
    cronTriggersSupported: profile.cronTriggersSupported,
    logicalContextMutationsSupported: profile.logicalContextMutationsSupported,
    nativeAdminCrudExposed: false,
    supportedSourceKinds: [...SUPPORTED_FUNCTION_SOURCE_KINDS],
    supportedTriggerKinds: [...SUPPORTED_FUNCTION_TRIGGER_KINDS],
    supportedRuntimes: summarizeFunctionRuntimeCoverage(),
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
