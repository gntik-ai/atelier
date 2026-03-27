import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FUNCTION_SECRET_NAME_PATTERN,
  SUPPORTED_FUNCTION_RUNTIMES,
  SUPPORTED_FUNCTION_SOURCE_KINDS,
  SUPPORTED_FUNCTION_TRIGGER_KINDS,
  buildConsoleBackendInvocationEnvelope,
  getConsoleBackendFunctionsIdentityContract,
  getFunctionsAdminRoute,
  getOpenWhiskCompatibilitySummary,
  listFunctionsAdminRoutes,
  summarizeFunctionRuntimeCoverage,
  summarizeFunctionsAdminSurface
} from '../../apps/control-plane/src/functions-admin.mjs';

test('functions admin control-plane helper exposes CRUD, lifecycle versioning, rollback, invocation, activation, HTTP exposure, and trigger routes', () => {
  const routes = listFunctionsAdminRoutes();
  const actionRoute = getFunctionsAdminRoute('getFunctions');
  const invocationRoute = getFunctionsAdminRoute('invokeFunctionAction');
  const exposureRoute = getFunctionsAdminRoute('createFunctionHttpExposure');
  const versionRoute = getFunctionsAdminRoute('listFunctionVersions');
  const rollbackRoute = getFunctionsAdminRoute('rollbackFunctionAction');
  const activationLogRoute = getFunctionsAdminRoute('getFunctionActivationLogs');
  const storageTriggerRoute = getFunctionsAdminRoute('getFunctionStorageTrigger');
  const cronTriggerRoute = getFunctionsAdminRoute('getFunctionCronTrigger');
  const inventoryRoute = getFunctionsAdminRoute('getFunctionInventory');
  const tenantQuotaRoute = getFunctionsAdminRoute('getFunctionTenantQuota');
  const workspaceQuotaRoute = getFunctionsAdminRoute('getFunctionWorkspaceQuota');
  const listSecretsRoute = getFunctionsAdminRoute('listFunctionWorkspaceSecrets');
  const createSecretRoute = getFunctionsAdminRoute('createFunctionWorkspaceSecret');
  const getSecretRoute = getFunctionsAdminRoute('getFunctionWorkspaceSecret');
  const updateSecretRoute = getFunctionsAdminRoute('updateFunctionWorkspaceSecret');
  const deleteSecretRoute = getFunctionsAdminRoute('deleteFunctionWorkspaceSecret');
  const surface = summarizeFunctionsAdminSurface();

  for (const operationId of [
    'listFunctionActions',
    'createFunctions',
    'getFunctions',
    'updateFunctions',
    'deleteFunctions',
    'invokeFunctionAction',
    'listFunctionVersions',
    'getFunctionVersion',
    'rollbackFunctionAction',
    'listFunctionActivations',
    'getFunctionActivation',
    'getFunctionActivationLogs',
    'getFunctionActivationResult',
    'rerunFunctionActivation',
    'createFunctionHttpExposure',
    'getFunctionHttpExposure',
    'updateFunctionHttpExposure',
    'deleteFunctionHttpExposure',
    'createFunctionStorageTrigger',
    'getFunctionStorageTrigger',
    'createFunctionCronTrigger',
    'getFunctionCronTrigger',
    'createFunctionKafkaTrigger',
    'getFunctionKafkaTrigger',
    'listFunctionPackages',
    'listFunctionTriggers',
    'listFunctionRules',
    'getFunctionInventory',
    'getFunctionTenantQuota',
    'getFunctionWorkspaceQuota',
    'listFunctionWorkspaceSecrets',
    'createFunctionWorkspaceSecret',
    'getFunctionWorkspaceSecret',
    'updateFunctionWorkspaceSecret',
    'deleteFunctionWorkspaceSecret'
  ]) {
    assert.ok(routes.some((route) => route.operationId === operationId), `missing ${operationId}`);
  }

  assert.equal(actionRoute.resourceType, 'function_action');
  assert.equal(invocationRoute.resourceType, 'function_invocation');
  assert.equal(exposureRoute.resourceType, 'function_http_exposure');
  assert.equal(versionRoute.resourceType, 'function_version');
  assert.equal(rollbackRoute.resourceType, 'function_rollback');
  assert.equal(activationLogRoute.resourceType, 'function_activation_log');
  assert.equal(storageTriggerRoute.resourceType, 'function_storage_trigger');
  assert.equal(cronTriggerRoute.resourceType, 'function_cron_trigger');
  assert.equal(inventoryRoute.path, '/v1/functions/workspaces/{workspaceId}/inventory');
  assert.equal(tenantQuotaRoute.resourceType, 'function_quota');
  assert.equal(workspaceQuotaRoute.path, '/v1/functions/workspaces/{workspaceId}/quota');
  assert.equal(listSecretsRoute.resourceType, 'function_workspace_secret');
  assert.equal(createSecretRoute.resourceType, 'function_workspace_secret');
  assert.equal(getSecretRoute.resourceType, 'function_workspace_secret');
  assert.equal(updateSecretRoute.resourceType, 'function_workspace_secret');
  assert.equal(deleteSecretRoute.resourceType, 'function_workspace_secret');
  assert.equal(surface.find((entry) => entry.resourceKind === 'action').routeCount, 5);
  assert.equal(surface.find((entry) => entry.resourceKind === 'invocation').actions.includes('rerun'), true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'activation').routeCount, 4);
  assert.equal(surface.find((entry) => entry.resourceKind === 'version').routeCount, 2);
  assert.equal(surface.find((entry) => entry.resourceKind === 'rollback').routeCount, 1);
  assert.equal(surface.find((entry) => entry.resourceKind === 'http_exposure').routeCount, 4);
  assert.equal(surface.find((entry) => entry.resourceKind === 'storage_trigger').routeCount, 2);
  assert.equal(surface.find((entry) => entry.resourceKind === 'cron_trigger').routeCount, 2);
  assert.equal(surface.find((entry) => entry.resourceKind === 'quota').routeCount, 2);
  assert.deepEqual(surface.find((entry) => entry.resourceKind === 'workspace_secret').actions, ['list', 'create', 'get', 'update', 'delete']);
  assert.equal(surface.find((entry) => entry.resourceKind === 'workspace_secret').routeCount, 5);
});

test('functions admin helper exposes console backend identity and envelope builders without regressing discoverability', () => {
  const identity = getConsoleBackendFunctionsIdentityContract();
  const envelope = buildConsoleBackendInvocationEnvelope({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  }, {
    actionRef: 'functions/actions/console-backend-inventory',
    responseMode: 'synchronous',
    triggerContext: { kind: 'direct' },
    body: { workflow: 'console_backend_inventory_sync' }
  });

  assert.equal(identity.actor_type, 'workspace_service_account');
  assert.equal(identity.initiating_surface, 'console_backend');
  assert.equal(envelope.request.responseMode, 'synchronous');
  assert.equal(envelope.request.triggerContext.kind, 'direct');
  assert.equal(envelope.annotation.initiating_surface, 'console_backend');
});

test('functions admin helper summarizes governed OpenWhisk compatibility, runtime coverage, quotas, and internal-only logical context provisioning', () => {
  const growthSummary = getOpenWhiskCompatibilitySummary({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceSlug: 'alpha-dev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  });
  const enterpriseSummary = getOpenWhiskCompatibilitySummary({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    workspaceSlug: 'alpha-prod',
    workspaceEnvironment: 'prod',
    planId: 'pln_01enterprise',
    providerVersion: '2.1.3'
  });
  const runtimeCoverage = summarizeFunctionRuntimeCoverage();

  assert.equal(growthSummary.provider, 'openwhisk');
  assert.equal(growthSummary.namespaceStrategy, 'logical_namespace_per_workspace');
  assert.equal(growthSummary.subjectProvisioning, 'internal_only');
  assert.equal(growthSummary.serverlessContext.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(growthSummary.serverlessContext.tenantIsolation.userManagedNativeAdminSupported, false);
  assert.equal(growthSummary.namingPolicy.actionPrefix, 'act-alpha-dev-dev');
  assert.equal(growthSummary.quotaGuardrails.maxActionsPerWorkspace, 24);
  assert.equal(growthSummary.quotaGuardrails.maxHttpExposuresPerWorkspace, 12);
  assert.deepEqual(growthSummary.quotaSupport.scopes, ['tenant', 'workspace']);
  assert.equal(growthSummary.quotaSupport.routeIds.includes('getFunctionWorkspaceQuota'), true);
  assert.equal(growthSummary.minimumEnginePolicy.nativeAdminCrudExposed, false);
  assert.equal(growthSummary.auditCoverage.capturesHttpExposure, true);
  assert.equal(growthSummary.actionMutationsSupported, true);
  assert.equal(growthSummary.functionVersioningSupported, true);
  assert.equal(growthSummary.rollbackSupported, true);
  assert.equal(growthSummary.lifecycleGovernance.rollbackPreservesHistory, true);
  assert.equal(growthSummary.workspaceSecretsSupported, true);
  assert.equal(growthSummary.secretGovernance.writeOnlyValue, true);
  assert.equal(growthSummary.httpExposureSupported, true);
  assert.equal(growthSummary.storageTriggersSupported, true);
  assert.equal(growthSummary.supportedSourceKinds.includes('runtime_image'), true);
  assert.equal(growthSummary.supportedTriggerKinds.includes('storage'), true);
  assert.equal(growthSummary.supportedVersions.some((entry) => entry.range === '2.1.x'), true);

  assert.equal(enterpriseSummary.serverlessContext.namespaceName, 'ia-01enterprisealpha-alpha-prod-prod');
  assert.equal(enterpriseSummary.serverlessContext.subjectRef, 'ia:01enterprisealpha:alpha-prod:prod');
  assert.equal(enterpriseSummary.quotaGuardrails.maxRulesPerWorkspace, 960);
  assert.equal(enterpriseSummary.ruleMutationsSupported, true);
  assert.equal(enterpriseSummary.supportedRuntimes.some((entry) => entry.runtime === 'container:image'), true);

  assert.deepEqual(SUPPORTED_FUNCTION_SOURCE_KINDS, ['inline_code', 'packaged_artifact', 'stored_reference', 'runtime_image']);
  assert.deepEqual(SUPPORTED_FUNCTION_TRIGGER_KINDS, ['http', 'kafka', 'storage', 'cron']);
  assert.equal(SUPPORTED_FUNCTION_RUNTIMES.some((entry) => entry.runtime === 'nodejs:20'), true);
  assert.equal(runtimeCoverage.find((entry) => entry.runtime === 'python:3.11').supportedTriggerKinds.includes('cron'), true);
  assert.equal(runtimeCoverage.find((entry) => entry.runtime === 'container:image').webActionSupported, true);
  assert.equal(FUNCTION_SECRET_NAME_PATTERN instanceof RegExp, true);
  assert.equal(FUNCTION_SECRET_NAME_PATTERN.test('my-secret'), true);
  assert.equal(FUNCTION_SECRET_NAME_PATTERN.test('api_key_prod'), true);
  assert.equal(FUNCTION_SECRET_NAME_PATTERN.test('BadSecret'), false);
});
