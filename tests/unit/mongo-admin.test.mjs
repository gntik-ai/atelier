import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMongoAdminRoute,
  getMongoCompatibilitySummary,
  listMongoAdminRoutes,
  summarizeMongoAdminSurface
} from '../../apps/control-plane/src/mongo-admin.mjs';

test('mongo admin control-plane helper exposes the expanded administrative route surface', () => {
  const routes = listMongoAdminRoutes();
  const inventoryRoute = getMongoAdminRoute('getMongoInventory');
  const assignRoleRoute = getMongoAdminRoute('assignMongoUserRoleBinding');
  const surface = summarizeMongoAdminSurface();

  assert.ok(routes.some((route) => route.operationId === 'createMongoDatabase'));
  assert.ok(routes.some((route) => route.operationId === 'listMongoCollections'));
  assert.ok(routes.some((route) => route.operationId === 'createMongoUser'));
  assert.ok(routes.some((route) => route.operationId === 'revokeMongoUserRoleBinding'));
  assert.equal(inventoryRoute.path, '/v1/mongo/workspaces/{workspaceId}/inventory');
  assert.equal(assignRoleRoute.resourceType, 'mongo_role_binding');
  assert.equal(surface.find((entry) => entry.resourceKind === 'database').routeCount >= 3, true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'collection').actions.includes('update'), true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'inventory').routeCount, 1);
});

test('mongo admin control-plane helper resolves compatibility summaries for shared and dedicated isolation profiles', () => {
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
    clusterTopology: 'sharded_cluster'
  });

  assert.equal(sharedSummary.isolationMode, 'shared_cluster');
  assert.equal(sharedSummary.clusterTopology, 'replica_set');
  assert.equal(sharedSummary.allowedRoleBindings.includes('dbOwner'), false);
  assert.equal(sharedSummary.namingPolicy.databasePrefix, '01starterdev_');

  assert.equal(dedicatedSummary.isolationMode, 'dedicated_cluster');
  assert.equal(dedicatedSummary.clusterTopology, 'sharded_cluster');
  assert.equal(dedicatedSummary.allowedRoleBindings.includes('dbOwner'), true);
  assert.equal(dedicatedSummary.supportedVersions.some((entry) => entry.range === '8.x'), true);
  assert.equal(dedicatedSummary.minimumEnginePolicy.forbiddenBuiltinRoles.includes('root'), true);
});
