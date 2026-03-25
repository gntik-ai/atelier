import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFunctionsAdminRoute,
  getOpenWhiskCompatibilitySummary,
  listFunctionsAdminRoutes,
  summarizeFunctionsAdminSurface
} from '../../apps/control-plane/src/functions-admin.mjs';

test('functions admin control-plane helper exposes action, package, trigger, rule, and inventory routes', () => {
  const routes = listFunctionsAdminRoutes();
  const packageRoute = getFunctionsAdminRoute('createFunctionPackage');
  const triggerRoute = getFunctionsAdminRoute('getFunctionTrigger');
  const inventoryRoute = getFunctionsAdminRoute('getFunctionInventory');
  const surface = summarizeFunctionsAdminSurface();

  assert.ok(routes.some((route) => route.operationId === 'createFunctions'));
  assert.ok(routes.some((route) => route.operationId === 'getFunctions'));
  assert.ok(routes.some((route) => route.operationId === 'listFunctionPackages'));
  assert.ok(routes.some((route) => route.operationId === 'createFunctionPackage'));
  assert.ok(routes.some((route) => route.operationId === 'getFunctionPackage'));
  assert.ok(routes.some((route) => route.operationId === 'updateFunctionPackage'));
  assert.ok(routes.some((route) => route.operationId === 'deleteFunctionPackage'));
  assert.ok(routes.some((route) => route.operationId === 'listFunctionTriggers'));
  assert.ok(routes.some((route) => route.operationId === 'createFunctionTrigger'));
  assert.ok(routes.some((route) => route.operationId === 'getFunctionTrigger'));
  assert.ok(routes.some((route) => route.operationId === 'updateFunctionTrigger'));
  assert.ok(routes.some((route) => route.operationId === 'deleteFunctionTrigger'));
  assert.ok(routes.some((route) => route.operationId === 'listFunctionRules'));
  assert.ok(routes.some((route) => route.operationId === 'createFunctionRule'));
  assert.ok(routes.some((route) => route.operationId === 'getFunctionRule'));
  assert.ok(routes.some((route) => route.operationId === 'updateFunctionRule'));
  assert.ok(routes.some((route) => route.operationId === 'deleteFunctionRule'));
  assert.ok(routes.some((route) => route.operationId === 'getFunctionInventory'));
  assert.equal(packageRoute.resourceType, 'function_package');
  assert.equal(triggerRoute.resourceType, 'function_trigger');
  assert.equal(inventoryRoute.path, '/v1/functions/workspaces/{workspaceId}/inventory');
  assert.equal(surface.find((entry) => entry.resourceKind === 'package').routeCount, 5);
  assert.equal(surface.find((entry) => entry.resourceKind === 'trigger').actions.includes('create'), true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'rule').routeCount, 5);
  assert.equal(surface.find((entry) => entry.resourceKind === 'inventory').routeCount, 1);
  assert.equal(surface.find((entry) => entry.resourceKind === 'action').routeCount, 2);
});

test('functions admin helper summarizes governed OpenWhisk compatibility, quotas, and internal-only logical context provisioning', () => {
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

  assert.equal(growthSummary.provider, 'openwhisk');
  assert.equal(growthSummary.namespaceStrategy, 'logical_namespace_per_workspace');
  assert.equal(growthSummary.subjectProvisioning, 'internal_only');
  assert.equal(growthSummary.serverlessContext.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(growthSummary.serverlessContext.tenantIsolation.userManagedNativeAdminSupported, false);
  assert.equal(growthSummary.namingPolicy.packagePrefix, 'pkg-alpha-dev-dev');
  assert.equal(growthSummary.quotaGuardrails.maxPackagesPerWorkspace, 12);
  assert.equal(growthSummary.minimumEnginePolicy.nativeAdminCrudExposed, false);
  assert.equal(growthSummary.auditCoverage.capturesServerlessContext, true);
  assert.equal(growthSummary.packageMutationsSupported, true);
  assert.equal(growthSummary.supportedVersions.some((entry) => entry.range === '2.1.x'), true);

  assert.equal(enterpriseSummary.serverlessContext.namespaceName, 'ia-01enterprisealpha-alpha-prod-prod');
  assert.equal(enterpriseSummary.serverlessContext.subjectRef, 'ia:01enterprisealpha:alpha-prod:prod');
  assert.equal(enterpriseSummary.quotaGuardrails.maxRulesPerWorkspace, 960);
  assert.equal(enterpriseSummary.ruleMutationsSupported, true);
});
