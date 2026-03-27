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
  OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY,
  OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE,
  OPENWHISK_SUPPORTED_ACTION_RUNTIMES,
  OPENWHISK_SUPPORTED_TRIGGER_KINDS,
  SUPPORTED_OPENWHISK_VERSION_RANGES,
  buildConsoleBackendActivationAnnotation,
  buildOpenWhiskRuntimeCoverageSummary,
  buildOpenWhiskServerlessContext,
  isOpenWhiskVersionSupported,
  resolveOpenWhiskAdminProfile,
  validateConsoleBackendInvocationRequest
} from '../../../services/adapters/src/openwhisk-admin.mjs';
import {
  IMPORT_ERROR_CODES,
  WEB_ACTION_VISIBILITY_STATES,
  buildScopeValidatedExportRequest,
  buildScopeValidatedImportRequest,
  validateImportBundle
} from './functions-import-export.mjs';

export const functionsApiFamily = getApiFamily('functions');
export const functionAdminRequestContract = getContract('function_admin_request');
export const functionAdminResultContract = getContract('function_admin_result');
export const functionInventorySnapshotContract = getContract('function_inventory_snapshot');
export const functionsAdminRoutes = filterPublicRoutes({ family: 'functions' });
export const SUPPORTED_FUNCTION_SOURCE_KINDS = OPENWHISK_ACTION_SOURCE_KINDS;
export const SUPPORTED_FUNCTION_TRIGGER_KINDS = OPENWHISK_SUPPORTED_TRIGGER_KINDS;
export const SUPPORTED_FUNCTION_RUNTIMES = OPENWHISK_SUPPORTED_ACTION_RUNTIMES;
export const FUNCTION_SECRET_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
export const SUPPORTED_WEB_ACTION_VISIBILITY_STATES = OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY;

export {
  buildConsoleBackendActivationAnnotation,
  validateConsoleBackendInvocationRequest,
  WEB_ACTION_VISIBILITY_STATES,
  IMPORT_ERROR_CODES,
  buildScopeValidatedExportRequest,
  buildScopeValidatedImportRequest,
  validateImportBundle
};

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
      resourceKind: 'version',
      actions: ['list', 'get'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_version').length
    },
    {
      resourceKind: 'rollback',
      actions: ['create'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_rollback').length
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
      resourceKind: 'quota',
      actions: ['get'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_quota').length
    },
    {
      resourceKind: 'workspace_secret',
      actions: ['list', 'create', 'get', 'update', 'delete'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_workspace_secret').length
    },
    {
      resourceKind: 'action_collection',
      actions: ['list'],
      routeCount: actionRoutes.filter((route) => route.method === 'GET').length
    },
    {
      resourceKind: 'function_definition_export',
      actions: ['export'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_definition_export').length
    },
    {
      resourceKind: 'function_definition_import',
      actions: ['import'],
      routeCount: functionsAdminRoutes.filter((route) => route.resourceType === 'function_definition_import').length
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
    quotaSupport: {
      supported: true,
      scopes: ['tenant', 'workspace'],
      dimensions: ['function_count', 'invocation_count', 'compute_time_ms', 'memory_mb'],
      routeIds: ['getFunctionTenantQuota', 'getFunctionWorkspaceQuota']
    },
    minimumEnginePolicy: profile.minimumEnginePolicy,
    auditCoverage: profile.auditCoverage,
    actionMutationsSupported: profile.actionMutationsSupported,
    packageMutationsSupported: profile.packageMutationsSupported,
    triggerMutationsSupported: profile.triggerMutationsSupported,
    ruleMutationsSupported: profile.ruleMutationsSupported,
    invocationSupported: profile.invocationSupported,
    activationReadsSupported: profile.activationReadsSupported,
    functionVersioningSupported: true,
    rollbackSupported: true,
    httpExposureSupported: profile.httpExposureSupported,
    storageTriggersSupported: profile.storageTriggersSupported,
    cronTriggersSupported: profile.cronTriggersSupported,
    logicalContextMutationsSupported: profile.logicalContextMutationsSupported,
    nativeAdminCrudExposed: false,
    lifecycleGovernance: {
      immutableVersions: true,
      rollbackPreservesHistory: true,
      scope: 'function_action'
    },
    workspaceSecretsSupported: true,
    definitionImportExportSupported: true,
    secretGovernance: {
      writeOnlyValue: true,
      scope: 'workspace_secret',
      isolationBoundary: 'tenant_plus_workspace',
      functionBindingModel: 'named_reference_only',
      valueDisclosure: 'never_returned'
    },
    supportedSourceKinds: [...SUPPORTED_FUNCTION_SOURCE_KINDS],
    supportedTriggerKinds: [...SUPPORTED_FUNCTION_TRIGGER_KINDS],
    supportedWebActionVisibility: [...SUPPORTED_WEB_ACTION_VISIBILITY_STATES],
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

export function getConsoleBackendFunctionsIdentityContract() {
  return {
    actor_type: 'workspace_service_account',
    initiating_surface: OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE
  };
}

export function buildConsoleBackendInvocationEnvelope(context = {}, payload = {}) {
  if (!payload.responseMode) {
    throw new Error('responseMode is required for console backend invocation envelope.');
  }

  if ((payload.triggerContext?.kind ?? context.triggerContext?.kind) !== 'direct') {
    throw new Error('console backend invocation envelope requires triggerContext.kind to be direct.');
  }

  if (!(payload.tenantId ?? context.tenantId)) {
    throw new Error('tenantId is required for console backend invocation envelope.');
  }

  if (!(payload.workspaceId ?? context.workspaceId)) {
    throw new Error('workspaceId is required for console backend invocation envelope.');
  }

  const request = {
    tenantId: payload.tenantId ?? context.tenantId,
    workspaceId: payload.workspaceId ?? context.workspaceId,
    responseMode: payload.responseMode,
    triggerContext: payload.triggerContext ?? { kind: 'direct' },
    actionRef: payload.actionRef,
    correlationId: payload.correlationId ?? context.correlationId,
    body: payload.body
  };
  const validation = validateConsoleBackendInvocationRequest(request, context);

  if (!validation.ok) {
    throw new Error(validation.violations[0]);
  }

  return {
    identity: getConsoleBackendFunctionsIdentityContract(),
    annotation: buildConsoleBackendActivationAnnotation({
      actor: context.actor,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      correlationId: request.correlationId
    }),
    request
  };
}

export { isOpenWhiskVersionSupported };
