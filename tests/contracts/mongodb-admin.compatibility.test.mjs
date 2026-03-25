import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  getContract,
  getPublicRoute,
  getService
} from '../../services/internal-contracts/src/index.mjs';
import {
  MONGO_ADMIN_CAPABILITY_MATRIX,
  SUPPORTED_MONGO_VERSION_RANGES,
  mongodbAdminAdapterPort
} from '../../services/adapters/src/mongodb-admin.mjs';

test('mongo admin service contracts and adapter capability baseline cover the MongoDB administrative surface', () => {
  const mongoAdminRequest = getContract('mongo_admin_request');
  const mongoAdminResult = getContract('mongo_admin_result');
  const mongoInventorySnapshot = getContract('mongo_inventory_snapshot');
  const controlApi = getService('control_api');
  const provisioning = getService('provisioning_orchestrator');

  assert.ok(controlApi.outbound_contracts.includes('mongo_admin_request'));
  assert.ok(provisioning.inbound_contracts.includes('mongo_admin_request'));
  assert.ok(provisioning.outbound_contracts.includes('mongo_admin_result'));
  assert.equal(mongoAdminRequest.owner, 'control_api');
  assert.equal(mongoAdminResult.owner, 'provisioning_orchestrator');
  assert.equal(mongoInventorySnapshot.owner, 'provisioning_orchestrator');
  assert.ok(mongoAdminRequest.required_fields.includes('resource_kind'));
  assert.ok(mongoAdminRequest.required_fields.includes('isolation_mode'));
  assert.ok(mongoAdminRequest.required_fields.includes('cluster_topology'));
  assert.ok(mongoAdminResult.required_fields.includes('normalized_resource'));
  assert.ok(mongoAdminResult.required_fields.includes('inventory_projection'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('counts'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('minimum_engine_policy'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('tenant_isolation'));

  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_database_create'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_collection_update'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_user_delete'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_role_binding_assign'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_inventory_upsert'));
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.collection, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.role_binding, ['assign', 'revoke']);
  assert.deepEqual(SUPPORTED_MONGO_VERSION_RANGES.map((entry) => entry.range), ['6.x', '7.x', '8.x']);
});

test('mongo public routes publish normalized family metadata, inventory, and structural admin contracts', () => {
  const document = readJson(OPENAPI_PATH);
  const listDatabasesRoute = getPublicRoute('listMongoDatabases');
  const getInventoryRoute = getPublicRoute('getMongoInventory');
  const createCollectionRoute = getPublicRoute('createMongoCollection');
  const updateUserRoute = getPublicRoute('updateMongoUser');
  const assignRoleRoute = getPublicRoute('assignMongoUserRoleBinding');

  assert.equal(listDatabasesRoute.family, 'mongo');
  assert.equal(listDatabasesRoute.path, '/v1/mongo/databases');
  assert.equal(listDatabasesRoute.gatewayQosProfile, 'provisioning');
  assert.equal(listDatabasesRoute.gatewayRequestValidationProfile, 'provisioning');
  assert.equal(getInventoryRoute.path, '/v1/mongo/workspaces/{workspaceId}/inventory');
  assert.equal(createCollectionRoute.resourceType, 'mongo_collection');
  assert.equal(createCollectionRoute.supportsIdempotencyKey, true);
  assert.equal(updateUserRoute.resourceType, 'mongo_user');
  assert.equal(assignRoleRoute.resourceType, 'mongo_role_binding');
  assert.equal(assignRoleRoute.supportsIdempotencyKey, true);

  assert.ok(document.components.schemas.MongoProviderCompatibility);
  assert.ok(document.components.schemas.MongoAdminEnginePolicy);
  assert.ok(document.components.schemas.MongoDatabase.properties.stats);
  assert.ok(document.components.schemas.MongoDatabase.properties.tenantIsolation);
  assert.ok(document.components.schemas.MongoCollection.properties.configuration);
  assert.ok(document.components.schemas.MongoCollection.properties.indexDefinitions);
  assert.ok(document.components.schemas.MongoUser.properties.passwordBinding);
  assert.ok(document.components.schemas.MongoUser.properties.roleBindings);
  assert.ok(document.components.schemas.MongoRoleBinding);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.minimumEnginePolicy);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.inventoryRef);
});
