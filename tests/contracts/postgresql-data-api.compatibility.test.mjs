import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson, resolveParameters } from '../../scripts/lib/quality-gates.mjs';
import {
  getContract,
  getPublicRoute,
  getService
} from '../../services/internal-contracts/src/index.mjs';
import { postgresqlAdminAdapterPort } from '../../services/adapters/src/postgresql-admin.mjs';

test('postgres data API service contracts and adapter capability baseline are published', () => {
  const postgresDataRequest = getContract('postgres_data_request');
  const postgresDataResult = getContract('postgres_data_result');
  const controlApi = getService('control_api');
  const provisioning = getService('provisioning_orchestrator');

  assert.ok(controlApi.outbound_contracts.includes('postgres_data_request'));
  assert.ok(provisioning.inbound_contracts.includes('postgres_data_request'));
  assert.ok(provisioning.outbound_contracts.includes('postgres_data_result'));
  assert.equal(postgresDataRequest.owner, 'control_api');
  assert.equal(postgresDataResult.owner, 'provisioning_orchestrator');
  assert.ok(postgresDataRequest.required_fields.includes('database_name'));
  assert.ok(postgresDataRequest.required_fields.includes('schema_name'));
  assert.ok(postgresDataRequest.required_fields.includes('table_name'));
  assert.ok(postgresDataRequest.required_fields.includes('effective_role_name'));
  assert.ok(postgresDataRequest.required_fields.includes('filters'));
  assert.ok(postgresDataResult.required_fields.includes('rows'));
  assert.ok(postgresDataResult.required_fields.includes('row_count'));
  assert.ok(postgresDataResult.required_fields.includes('page'));
  assert.ok(postgresDataResult.required_fields.includes('effective_role_name'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_select'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_insert'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_update'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_delete'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_rpc'));
});

test('postgres data API public routes publish CRUD/query metadata and query parameter contracts', () => {
  const document = readJson(OPENAPI_PATH);
  const listRowsRoute = getPublicRoute('listPostgresDataRows');
  const createRowRoute = getPublicRoute('createPostgresDataRow');
  const getRowRoute = getPublicRoute('getPostgresDataRowByPrimaryKey');
  const updateRowRoute = getPublicRoute('updatePostgresDataRowByPrimaryKey');
  const deleteRowRoute = getPublicRoute('deletePostgresDataRowByPrimaryKey');
  const rpcRoute = getPublicRoute('executePostgresDataRpc');
  const listOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows'].get;
  const createOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows'].post;
  const getOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key'].get;
  const updateOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key'].patch;
  const deleteOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key'].delete;
  const rpcOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/rpc/{routineName}'].post;
  const listParameters = resolveParameters(document, listOperation);
  const getParameters = resolveParameters(document, getOperation);
  const updateParameters = resolveParameters(document, updateOperation);

  assert.equal(listRowsRoute.family, 'postgres');
  assert.equal(listRowsRoute.resourceType, 'postgres_data_rows');
  assert.equal(listRowsRoute.gatewayQosProfile, 'provisioning');
  assert.equal(createRowRoute.supportsIdempotencyKey, true);
  assert.equal(getRowRoute.resourceType, 'postgres_data_row');
  assert.equal(updateRowRoute.supportsIdempotencyKey, true);
  assert.equal(deleteRowRoute.supportsIdempotencyKey, true);
  assert.equal(rpcRoute.resourceType, 'postgres_data_rpc');

  assert.equal(listOperation['x-resource-type'], 'postgres_data_rows');
  assert.equal(createOperation['x-rate-limit-class'], 'data-write');
  assert.equal(getOperation['x-resource-type'], 'postgres_data_row');
  assert.equal(updateOperation['x-resource-type'], 'postgres_data_row');
  assert.equal(deleteOperation['x-resource-type'], 'postgres_data_row');
  assert.equal(rpcOperation['x-resource-type'], 'postgres_data_rpc');
  assert.equal(listParameters.some((parameter) => parameter.name === 'select'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'include'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'order'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'filter'), true);
  assert.equal(getParameters.some((parameter) => parameter.name === 'pk'), true);
  assert.equal(updateParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);

  assert.ok(document.components.schemas.PostgresDataRowCollection);
  assert.ok(document.components.schemas.PostgresDataRowEnvelope);
  assert.ok(document.components.schemas.PostgresDataInsertRequest);
  assert.ok(document.components.schemas.PostgresDataUpdateRequest);
  assert.ok(document.components.schemas.PostgresDataMutationResult);
  assert.ok(document.components.schemas.PostgresDataProjection);
  assert.ok(document.components.schemas.PostgresDataRelationProjection);
  assert.ok(document.components.schemas.PostgresDataRpcRequest);
  assert.ok(document.components.schemas.PostgresDataRpcEnvelope);
  assert.ok(document.components.schemas.PostgresDataRowCollection.properties.filters);
  assert.ok(document.components.schemas.PostgresDataMutationResult.properties.effectiveRoleName);
  assert.ok(document.components.schemas.PostgresDataInsertRequest.properties.row);
  assert.ok(document.components.schemas.PostgresDataUpdateRequest.properties.changes);
});
