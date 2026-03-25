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

test('mongo admin service contracts and adapter capability baseline cover the expanded MongoDB structural administration surface', () => {
  const mongoAdminRequest = getContract('mongo_admin_request');
  const mongoAdminResult = getContract('mongo_admin_result');
  const mongoInventorySnapshot = getContract('mongo_inventory_snapshot');
  const mongoAdminEvent = getContract('mongo_admin_event');
  const controlApi = getService('control_api');
  const provisioning = getService('provisioning_orchestrator');
  const eventGateway = getService('event_gateway');

  assert.ok(controlApi.outbound_contracts.includes('mongo_admin_request'));
  assert.ok(provisioning.inbound_contracts.includes('mongo_admin_request'));
  assert.ok(provisioning.outbound_contracts.includes('mongo_admin_result'));
  assert.ok(provisioning.outbound_contracts.includes('mongo_admin_event'));
  assert.ok(eventGateway.inbound_contracts.includes('mongo_admin_event'));
  assert.equal(mongoAdminRequest.owner, 'control_api');
  assert.equal(mongoAdminResult.owner, 'provisioning_orchestrator');
  assert.equal(mongoInventorySnapshot.owner, 'provisioning_orchestrator');
  assert.equal(mongoAdminEvent.owner, 'provisioning_orchestrator');
  assert.ok(mongoAdminRequest.required_fields.includes('resource_kind'));
  assert.ok(mongoAdminRequest.required_fields.includes('isolation_mode'));
  assert.ok(mongoAdminRequest.required_fields.includes('cluster_topology'));
  assert.ok(mongoAdminRequest.required_fields.includes('segregation_model'));
  assert.ok(mongoAdminRequest.required_fields.includes('admin_credential_binding'));
  assert.ok(mongoAdminResult.required_fields.includes('normalized_resource'));
  assert.ok(mongoAdminResult.required_fields.includes('inventory_projection'));
  assert.ok(mongoAdminResult.required_fields.includes('segregation_model'));
  assert.ok(mongoAdminResult.required_fields.includes('recovery_guidance'));
  assert.ok(mongoAdminResult.required_fields.includes('minimum_permission_guidance'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('counts'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('minimum_engine_policy'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('tenant_isolation'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('segregation_model'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('credential_posture'));
  assert.ok(mongoInventorySnapshot.required_fields.includes('audit_coverage'));
  assert.ok(mongoAdminEvent.required_fields.includes('correlation_context'));
  assert.ok(mongoAdminEvent.required_fields.includes('audit_record_id'));

  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_database_create'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_collection_update'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_index_rebuild'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_view_create'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_template_update'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_user_delete'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_role_binding_assign'));
  assert.ok(mongodbAdminAdapterPort.capabilities.includes('mongo_inventory_upsert'));
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.collection, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.index, ['list', 'get', 'create', 'update', 'delete', 'rebuild']);
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.view, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.template, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(MONGO_ADMIN_CAPABILITY_MATRIX.role_binding, ['assign', 'revoke']);
  assert.deepEqual(SUPPORTED_MONGO_VERSION_RANGES.map((entry) => entry.range), ['6.x', '7.x', '8.x']);
});

test('mongo public routes publish normalized family metadata, inventory, and structural administration contracts for secure credentials, audit evidence, and recovery metadata', () => {
  const document = readJson(OPENAPI_PATH);
  const listDatabasesRoute = getPublicRoute('listMongoDatabases');
  const getInventoryRoute = getPublicRoute('getMongoInventory');
  const createCollectionRoute = getPublicRoute('createMongoCollection');
  const rebuildIndexRoute = getPublicRoute('rebuildMongoIndex');
  const createViewRoute = getPublicRoute('createMongoView');
  const createTemplateRoute = getPublicRoute('createMongoCollectionTemplate');
  const assignRoleRoute = getPublicRoute('assignMongoUserRoleBinding');

  assert.equal(listDatabasesRoute.family, 'mongo');
  assert.equal(listDatabasesRoute.path, '/v1/mongo/databases');
  assert.equal(listDatabasesRoute.gatewayQosProfile, 'provisioning');
  assert.equal(listDatabasesRoute.gatewayRequestValidationProfile, 'provisioning');
  assert.equal(getInventoryRoute.path, '/v1/mongo/workspaces/{workspaceId}/inventory');
  assert.equal(createCollectionRoute.resourceType, 'mongo_collection');
  assert.equal(createCollectionRoute.supportsIdempotencyKey, true);
  assert.equal(rebuildIndexRoute.resourceType, 'mongo_index');
  assert.equal(rebuildIndexRoute.supportsIdempotencyKey, true);
  assert.equal(createViewRoute.resourceType, 'mongo_view');
  assert.equal(createTemplateRoute.resourceType, 'mongo_template');
  assert.equal(assignRoleRoute.resourceType, 'mongo_role_binding');
  assert.equal(assignRoleRoute.supportsIdempotencyKey, true);

  assert.ok(document.paths['/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes']);
  assert.ok(document.paths['/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes/{indexName}']);
  assert.ok(document.paths['/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes/{indexName}/rebuild']);
  assert.ok(document.paths['/v1/mongo/databases/{databaseName}/views']);
  assert.ok(document.paths['/v1/mongo/databases/{databaseName}/views/{viewName}']);
  assert.ok(document.paths['/v1/mongo/workspaces/{workspaceId}/templates']);
  assert.ok(document.paths['/v1/mongo/workspaces/{workspaceId}/templates/{templateId}']);

  assert.ok(document.components.schemas.MongoProviderCompatibility.properties.supportedSegregationModels);
  assert.ok(document.components.schemas.MongoProviderCompatibility.properties.supportedCredentialScopes);
  assert.ok(document.components.schemas.MongoProviderCompatibility.properties.supportedCredentialBindingTypes);
  assert.ok(document.components.schemas.MongoAdminEnginePolicy);
  assert.ok(document.components.schemas.MongoDatabase.properties.stats);
  assert.ok(document.components.schemas.MongoDatabase.properties.tenantIsolation);
  assert.ok(document.components.schemas.MongoDatabase.properties.segregationModel);
  assert.ok(document.components.schemas.MongoCollection.properties.configuration);
  assert.ok(document.components.schemas.MongoCollection.properties.indexDefinitions);
  assert.ok(document.components.schemas.MongoCollection.properties.metadataSummary);
  assert.ok(document.components.schemas.MongoCollection.properties.tenantIsolation);
  assert.ok(document.components.schemas.MongoIndex);
  assert.ok(document.components.schemas.MongoIndexWriteRequest);
  assert.ok(document.components.schemas.MongoIndexRebuildRequest);
  assert.ok(document.components.schemas.MongoView);
  assert.ok(document.components.schemas.MongoCollectionTemplate);
  assert.ok(document.components.schemas.MongoCollectionTemplateWriteRequest);
  assert.ok(document.components.schemas.MongoUser.properties.passwordBinding);
  assert.ok(document.components.schemas.MongoUser.properties.roleBindings);
  assert.ok(document.components.schemas.MongoUserPasswordBinding.properties.credentialScope);
  assert.ok(document.components.schemas.MongoUserPasswordBinding.properties.lifecycle);
  assert.ok(document.components.schemas.MongoCredentialLifecycle);
  assert.ok(document.components.schemas.MongoRoleBinding);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.minimumEnginePolicy);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.segregationModel);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.indexRefs);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.viewRefs);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.templateRefs);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.credentialPosture);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.auditCoverage);
  assert.ok(document.components.schemas.MongoAdminInventory.properties.dataApiCompatibility);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.inventoryRef);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.segregationModel);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.auditSummary);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.correlationContext);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.adminEvent);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.recoveryGuidance);
  assert.ok(document.components.schemas.MongoAdminMutationAccepted.properties.minimumPermissionGuidance);
  assert.ok(document.components.schemas.MongoAdminEvent);
  assert.ok(document.components.schemas.MongoAdminRecoveryGuidance);
  assert.ok(document.components.schemas.MongoAdminCorrelationContext);
});
