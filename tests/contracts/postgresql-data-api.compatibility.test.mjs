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
  assert.ok(postgresDataRequest.required_fields.includes('count_mode'));
  assert.ok(postgresDataRequest.required_fields.includes('pagination_metadata_mode'));
  assert.ok(postgresDataRequest.required_fields.includes('trace_context'));
  assert.ok(postgresDataResult.required_fields.includes('rows'));
  assert.ok(postgresDataResult.required_fields.includes('row_count'));
  assert.ok(postgresDataResult.required_fields.includes('page'));
  assert.ok(postgresDataResult.required_fields.includes('effective_role_name'));
  assert.ok(postgresDataResult.required_fields.includes('count'));
  assert.ok(postgresDataResult.required_fields.includes('pagination_summary'));
  assert.ok(postgresDataResult.required_fields.includes('trace_context'));
  assert.ok(postgresDataResult.required_fields.includes('audit_record_id'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_select'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_insert'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_update'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_delete'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_rpc'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_bulk_insert'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_bulk_update'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_bulk_delete'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_import'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_export'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_saved_query_execute'));
  assert.ok(postgresqlAdminAdapterPort.capabilities.includes('postgres_data_stable_endpoint_invoke'));
});

test('postgres data API public routes publish CRUD/query, bulk, transfer, scope, and stable-endpoint metadata', () => {
  const document = readJson(OPENAPI_PATH);
  const listRowsRoute = getPublicRoute('listPostgresDataRows');
  const createRowRoute = getPublicRoute('createPostgresDataRow');
  const getRowRoute = getPublicRoute('getPostgresDataRowByPrimaryKey');
  const updateRowRoute = getPublicRoute('updatePostgresDataRowByPrimaryKey');
  const deleteRowRoute = getPublicRoute('deletePostgresDataRowByPrimaryKey');
  const rpcRoute = getPublicRoute('executePostgresDataRpc');
  const bulkInsertRoute = getPublicRoute('bulkInsertPostgresDataRows');
  const bulkUpdateRoute = getPublicRoute('bulkUpdatePostgresDataRows');
  const bulkDeleteRoute = getPublicRoute('bulkDeletePostgresDataRows');
  const importRoute = getPublicRoute('importPostgresDataRows');
  const exportRoute = getPublicRoute('exportPostgresDataRows');
  const credentialRoute = getPublicRoute('createPostgresDataCredential');
  const savedQueryRoute = getPublicRoute('createPostgresSavedQuery');
  const savedQueryExecuteRoute = getPublicRoute('executePostgresSavedQuery');
  const endpointRoute = getPublicRoute('createPostgresDataEndpoint');
  const endpointInvokeRoute = getPublicRoute('invokePostgresDataEndpoint');
  const listOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows'].get;
  const bulkInsertOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/bulk/insert'].post;
  const importOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/imports'].post;
  const exportOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/exports'].post;
  const credentialOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials'].post;
  const savedQueryOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries'].post;
  const executeSavedQueryOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries/{savedQueryId}/execute'].post;
  const endpointOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/endpoints'].post;
  const invokeEndpointOperation = document.paths['/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/published/{endpointSlug}'].post;
  const listParameters = resolveParameters(document, listOperation);
  const bulkInsertParameters = resolveParameters(document, bulkInsertOperation);
  const credentialParameters = resolveParameters(document, credentialOperation);

  assert.equal(listRowsRoute.family, 'postgres');
  assert.equal(listRowsRoute.resourceType, 'postgres_data_rows');
  assert.equal(listRowsRoute.gatewayQosProfile, 'provisioning');
  assert.equal(createRowRoute.supportsIdempotencyKey, true);
  assert.equal(getRowRoute.resourceType, 'postgres_data_row');
  assert.equal(updateRowRoute.supportsIdempotencyKey, true);
  assert.equal(deleteRowRoute.supportsIdempotencyKey, true);
  assert.equal(rpcRoute.resourceType, 'postgres_data_rpc');
  assert.equal(bulkInsertRoute.resourceType, 'postgres_data_bulk');
  assert.equal(bulkUpdateRoute.resourceType, 'postgres_data_bulk');
  assert.equal(bulkDeleteRoute.resourceType, 'postgres_data_bulk');
  assert.equal(importRoute.resourceType, 'postgres_data_transfer');
  assert.equal(exportRoute.resourceType, 'postgres_data_transfer');
  assert.equal(credentialRoute.resourceType, 'postgres_data_credential');
  assert.equal(savedQueryRoute.resourceType, 'postgres_data_saved_query');
  assert.equal(savedQueryExecuteRoute.resourceType, 'postgres_data_saved_query');
  assert.equal(endpointRoute.resourceType, 'postgres_data_endpoint');
  assert.equal(endpointInvokeRoute.resourceType, 'postgres_data_endpoint');

  assert.equal(listOperation['x-resource-type'], 'postgres_data_rows');
  assert.equal(bulkInsertOperation['x-resource-type'], 'postgres_data_bulk');
  assert.equal(importOperation['x-resource-type'], 'postgres_data_transfer');
  assert.equal(exportOperation['x-resource-type'], 'postgres_data_transfer');
  assert.equal(credentialOperation['x-resource-type'], 'postgres_data_credential');
  assert.equal(savedQueryOperation['x-resource-type'], 'postgres_data_saved_query');
  assert.equal(executeSavedQueryOperation['x-resource-type'], 'postgres_data_saved_query');
  assert.equal(endpointOperation['x-resource-type'], 'postgres_data_endpoint');
  assert.equal(invokeEndpointOperation['x-resource-type'], 'postgres_data_endpoint');
  assert.equal(listParameters.some((parameter) => parameter.name === 'count'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'pageMeta'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'X-Origin-Surface'), true);
  assert.equal(bulkInsertParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(credentialParameters.some((parameter) => parameter.name === 'X-Origin-Surface'), true);

  assert.ok(document.components.schemas.PostgresDataRowCollection.properties.count);
  assert.ok(document.components.schemas.PostgresDataRowCollection.properties.paginationSummary);
  assert.ok(document.components.schemas.PostgresDataRowCollection.properties.trace);
  assert.ok(document.components.schemas.PostgresDataMutationResult.properties.trace);
  assert.ok(document.components.schemas.PostgresDataRpcEnvelope.properties.trace);
  assert.ok(document.components.schemas.PostgresDataBulkInsertRequest);
  assert.ok(document.components.schemas.PostgresDataBulkUpdateRequest);
  assert.ok(document.components.schemas.PostgresDataBulkDeleteRequest);
  assert.ok(document.components.schemas.PostgresDataBulkMutationResult);
  assert.ok(document.components.schemas.PostgresDataImportRequest);
  assert.ok(document.components.schemas.PostgresDataImportResult);
  assert.ok(document.components.schemas.PostgresDataExportRequest);
  assert.ok(document.components.schemas.PostgresDataExportEnvelope);
  assert.ok(document.components.schemas.PostgresDataCredentialScope);
  assert.ok(document.components.schemas.PostgresDataCredentialSecretEnvelope);
  assert.ok(document.components.schemas.PostgresSavedQueryRecord);
  assert.ok(document.components.schemas.PostgresSavedQueryExecutionRequest);
  assert.ok(document.components.schemas.PostgresDataEndpointRecord);
  assert.ok(document.components.schemas.PostgresDataEndpointInvocationEnvelope);
});
