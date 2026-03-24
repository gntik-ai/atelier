import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  getContract,
  getPublicRoute,
  getService
} from '../../services/internal-contracts/src/index.mjs';
import {
  POSTGRES_ADMIN_CAPABILITY_MATRIX,
  SUPPORTED_POSTGRES_VERSION_RANGES,
  postgresqlAdminAdapterPort
} from '../../services/adapters/src/postgresql-admin.mjs';

test('postgres admin service contracts and adapter capability baseline cover the expanded PostgreSQL admin surface', () => {
  const postgresAdminRequest = getContract('postgres_admin_request');
  const postgresAdminResult = getContract('postgres_admin_result');
  const postgresInventorySnapshot = getContract('postgres_inventory_snapshot');
  const controlApi = getService('control_api');
  const provisioning = getService('provisioning_orchestrator');

  assert.ok(controlApi.outbound_contracts.includes('postgres_admin_request'));
  assert.ok(provisioning.inbound_contracts.includes('postgres_admin_request'));
  assert.ok(provisioning.outbound_contracts.includes('postgres_admin_result'));
  assert.equal(postgresAdminRequest.owner, 'control_api');
  assert.equal(postgresAdminResult.owner, 'provisioning_orchestrator');
  assert.equal(postgresInventorySnapshot.owner, 'provisioning_orchestrator');
  assert.ok(postgresAdminRequest.required_fields.includes('resource_kind'));
  assert.ok(postgresAdminRequest.required_fields.includes('placement_mode'));
  assert.ok(postgresAdminResult.required_fields.includes('normalized_resource'));
  assert.ok(postgresAdminResult.required_fields.includes('inventory_projection'));
  assert.ok(postgresInventorySnapshot.required_fields.includes('counts'));
  assert.ok(postgresInventorySnapshot.required_fields.includes('minimum_engine_policy'));

  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_role_create'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_user_update'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_database_delete'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_schema_list'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_constraint_create'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_index_delete'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_view_update'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_materialized_view_create'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_function_get'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_procedure_delete'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_inventory_upsert'));
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.schema, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.index, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.function, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(SUPPORTED_POSTGRES_VERSION_RANGES.map((entry) => entry.range), ['15.x', '16.x', '17.x']);
});

test('postgres public routes publish normalized family metadata, inventory, and advanced structural contracts', () => {
  const document = readJson(OPENAPI_PATH);
  const listRolesRoute = getPublicRoute('listPostgresRoles');
  const getInventoryRoute = getPublicRoute('getPostgresInventory');
  const createSchemaRoute = getPublicRoute('createPostgresSchema');
  const createConstraintRoute = getPublicRoute('createPostgresConstraint');
  const listIndexesRoute = getPublicRoute('listPostgresIndexes');
  const createViewRoute = getPublicRoute('createPostgresView');
  const listMaterializedViewsRoute = getPublicRoute('listPostgresMaterializedViews');
  const createFunctionRoute = getPublicRoute('createPostgresFunction');
  const getProcedureRoute = getPublicRoute('getPostgresProcedure');

  assert.equal(listRolesRoute.family, 'postgres');
  assert.equal(listRolesRoute.path, '/v1/postgres/roles');
  assert.equal(listRolesRoute.gatewayQosProfile, 'provisioning');
  assert.equal(listRolesRoute.gatewayRequestValidationProfile, 'provisioning');
  assert.equal(createSchemaRoute.resourceType, 'postgres_schema');
  assert.equal(createSchemaRoute.supportsIdempotencyKey, true);
  assert.equal(getInventoryRoute.path, '/v1/postgres/workspaces/{workspaceId}/inventory');
  assert.equal(createConstraintRoute.resourceType, 'postgres_constraint');
  assert.equal(listIndexesRoute.path, '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes');
  assert.equal(createViewRoute.resourceType, 'postgres_view');
  assert.equal(listMaterializedViewsRoute.resourceType, 'postgres_materialized_view');
  assert.equal(createFunctionRoute.resourceType, 'postgres_function');
  assert.equal(getProcedureRoute.resourceType, 'postgres_procedure');

  assert.ok(document.components.schemas.PostgresProviderCompatibility);
  assert.ok(document.components.schemas.PostgresAdminEnginePolicy);
  assert.ok(document.components.schemas.PostgresRole.properties.providerCompatibility);
  assert.ok(document.components.schemas.PostgresUser.properties.credentialBinding);
  assert.ok(document.components.schemas.PostgresDatabase.properties.placementMode);
  assert.ok(document.components.schemas.PostgresSchema.properties.accessPolicy);
  assert.ok(document.components.schemas.PostgresAdminInventory.properties.minimumEnginePolicy);
  assert.ok(document.components.schemas.PostgresAdminMutationAccepted);
  assert.ok(document.components.schemas.PostgresConstraint.properties.constraintType);
  assert.ok(document.components.schemas.PostgresIndex.properties.performanceProfile);
  assert.ok(document.components.schemas.PostgresView.properties.dependencySummary);
  assert.ok(document.components.schemas.PostgresMaterializedView.properties.integrityProfile);
  assert.ok(document.components.schemas.PostgresFunction.properties.documentation);
  assert.ok(document.components.schemas.PostgresProcedure.properties.securityMode);
  assert.ok(document.components.schemas.PostgresAdminInventory.properties.constraintRefs);
  assert.ok(document.components.schemas.PostgresAdminInventory.properties.materializedViewRefs);
});
