import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMongoAdminRoute,
  getMongoCompatibilitySummary,
  listMongoAdminRoutes,
  summarizeMongoAdminSurface,
  summarizeMongoAuditCoverage
} from '../../apps/control-plane/src/mongo-admin.mjs';

test('mongo admin control-plane helper exposes the expanded structural administrative route surface', () => {
  const routes = listMongoAdminRoutes();
  const inventoryRoute = getMongoAdminRoute('getMongoInventory');
  const rebuildIndexRoute = getMongoAdminRoute('rebuildMongoIndex');
  const viewRoute = getMongoAdminRoute('getMongoView');
  const templateRoute = getMongoAdminRoute('createMongoCollectionTemplate');
  const surface = summarizeMongoAdminSurface();

  assert.ok(routes.some((route) => route.operationId === 'createMongoDatabase'));
  assert.ok(routes.some((route) => route.operationId === 'listMongoIndexes'));
  assert.ok(routes.some((route) => route.operationId === 'createMongoView'));
  assert.ok(routes.some((route) => route.operationId === 'createMongoCollectionTemplate'));
  assert.ok(routes.some((route) => route.operationId === 'revokeMongoUserRoleBinding'));
  assert.equal(inventoryRoute.path, '/v1/mongo/workspaces/{workspaceId}/inventory');
  assert.equal(rebuildIndexRoute.resourceType, 'mongo_index');
  assert.equal(viewRoute.resourceType, 'mongo_view');
  assert.equal(templateRoute.resourceType, 'mongo_template');
  assert.equal(surface.find((entry) => entry.resourceKind === 'index').actions.includes('rebuild'), true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'view').routeCount >= 5, true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'template').routeCount >= 5, true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'inventory').routeCount, 1);
});

test('mongo admin control-plane helper resolves compatibility summaries for shared and dedicated segregation profiles', () => {
  const auditCoverage = summarizeMongoAuditCoverage();
  const sharedSummary = getMongoCompatibilitySummary({
    tenantId: 'ten_01starteralpha',
    workspaceId: 'wrk_01starterdev',
    planId: 'pln_01growth'
  });
  const dedicatedSummary = getMongoCompatibilitySummary({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01enterpriseprod',
    planId: 'pln_01enterprise',
    isolationMode: 'dedicated_cluster',
    clusterTopology: 'sharded_cluster',
    segregationModel: 'tenant_database'
  });

  assert.equal(sharedSummary.isolationMode, 'shared_cluster');
  assert.equal(sharedSummary.clusterTopology, 'replica_set');
  assert.equal(sharedSummary.segregationModel, 'workspace_database');
  assert.equal(sharedSummary.supportedSegregationModels.includes('workspace_database'), true);
  assert.equal(sharedSummary.indexMutationsSupported, true);
  assert.equal(sharedSummary.templateCatalogSupported, true);
  assert.equal(sharedSummary.namingPolicy.databasePrefix, '01starterdev_');
  assert.equal(sharedSummary.adminCredentialStrategy, 'tenant_scoped_internal_service_account');
  assert.equal(sharedSummary.maximumCredentialLifetimeHours, 168);
  assert.equal(sharedSummary.auditCoverage.capturesCredentialLifecycle, true);
  assert.equal(auditCoverage.adminContextFields.some((entry) => entry.field === 'origin_surface' && entry.requestContract), true);

  assert.equal(dedicatedSummary.isolationMode, 'dedicated_cluster');
  assert.equal(dedicatedSummary.clusterTopology, 'sharded_cluster');
  assert.equal(dedicatedSummary.segregationModel, 'tenant_database');
  assert.equal(dedicatedSummary.allowedRoleBindings.includes('dbOwner'), true);
  assert.equal(dedicatedSummary.supportedVersions.some((entry) => entry.range === '8.x' && entry.segregationModels.includes('tenant_database')), true);
  assert.equal(dedicatedSummary.minimumEnginePolicy.forbiddenBuiltinRoles.includes('root'), true);
  assert.equal(dedicatedSummary.minimumEnginePolicy.auditEvidence.includes('recovery_guidance'), true);
  assert.equal(dedicatedSummary.maximumCredentialLifetimeHours, 336);
});
