import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson, resolveParameters } from '../../scripts/lib/quality-gates.mjs';
import {
  getContract,
  getPublicRoute,
  getService
} from '../../services/internal-contracts/src/index.mjs';
import { mongodbDataAdapterPort } from '../../services/adapters/src/mongodb-data-api.mjs';

test('mongo data API service contracts and adapter capability baseline are published', () => {
  const mongoDataRequest = getContract('mongo_data_request');
  const mongoDataResult = getContract('mongo_data_result');
  const controlApi = getService('control_api');
  const provisioning = getService('provisioning_orchestrator');

  assert.ok(controlApi.outbound_contracts.includes('mongo_data_request'));
  assert.ok(provisioning.inbound_contracts.includes('mongo_data_request'));
  assert.ok(provisioning.outbound_contracts.includes('mongo_data_result'));
  assert.equal(mongoDataRequest.owner, 'control_api');
  assert.equal(mongoDataResult.owner, 'provisioning_orchestrator');
  assert.ok(mongoDataRequest.required_fields.includes('tenant_scope'));
  assert.ok(mongoDataRequest.required_fields.includes('filters'));
  assert.ok(mongoDataRequest.required_fields.includes('projection'));
  assert.ok(mongoDataRequest.required_fields.includes('sort'));
  assert.ok(mongoDataRequest.required_fields.includes('page'));
  assert.ok(mongoDataRequest.required_fields.includes('bulk_limits'));
  assert.ok(mongoDataRequest.required_fields.includes('collection_validation'));
  assert.ok(mongoDataRequest.required_fields.includes('trace_context'));
  assert.ok(mongoDataResult.required_fields.includes('documents'));
  assert.ok(mongoDataResult.required_fields.includes('counts'));
  assert.ok(mongoDataResult.required_fields.includes('page'));
  assert.ok(mongoDataResult.required_fields.includes('tenant_scope'));
  assert.ok(mongoDataResult.required_fields.includes('bulk_summary'));
  assert.ok(mongoDataResult.required_fields.includes('validation_summary'));
  assert.ok(mongoDataResult.required_fields.includes('trace_context'));
  assert.ok(mongoDataResult.required_fields.includes('audit_record_id'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_query'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_insert'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_update'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_replace'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_delete'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_bulk_write'));
});

test('mongo data API public routes publish CRUD/query, bulk, and tenant-scoped document metadata', () => {
  const document = readJson(OPENAPI_PATH);
  const listDocumentsRoute = getPublicRoute('listMongoDataDocuments');
  const createDocumentRoute = getPublicRoute('createMongoDataDocument');
  const getDocumentRoute = getPublicRoute('getMongoDataDocument');
  const updateDocumentRoute = getPublicRoute('updateMongoDataDocument');
  const replaceDocumentRoute = getPublicRoute('replaceMongoDataDocument');
  const deleteDocumentRoute = getPublicRoute('deleteMongoDataDocument');
  const bulkWriteRoute = getPublicRoute('bulkWriteMongoDataDocuments');

  const listOperation = document.paths['/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents'].get;
  const createOperation = document.paths['/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents'].post;
  const getOperation = document.paths['/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}'].get;
  const updateOperation = document.paths['/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}'].patch;
  const replaceOperation = document.paths['/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}'].put;
  const bulkOperation = document.paths['/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/bulk/write'].post;
  const listParameters = resolveParameters(document, listOperation);
  const createParameters = resolveParameters(document, createOperation);
  const getParameters = resolveParameters(document, getOperation);
  const updateParameters = resolveParameters(document, updateOperation);
  const replaceParameters = resolveParameters(document, replaceOperation);
  const bulkParameters = resolveParameters(document, bulkOperation);

  assert.equal(listDocumentsRoute.family, 'mongo');
  assert.equal(listDocumentsRoute.resourceType, 'mongo_data_documents');
  assert.equal(listDocumentsRoute.gatewayQosProfile, 'provisioning');
  assert.equal(createDocumentRoute.resourceType, 'mongo_data_documents');
  assert.equal(createDocumentRoute.supportsIdempotencyKey, true);
  assert.equal(getDocumentRoute.resourceType, 'mongo_data_document');
  assert.equal(updateDocumentRoute.supportsIdempotencyKey, true);
  assert.equal(replaceDocumentRoute.supportsIdempotencyKey, true);
  assert.equal(deleteDocumentRoute.supportsIdempotencyKey, true);
  assert.equal(bulkWriteRoute.resourceType, 'mongo_data_bulk');
  assert.equal(bulkWriteRoute.supportsIdempotencyKey, true);

  assert.equal(listOperation['x-resource-type'], 'mongo_data_documents');
  assert.equal(createOperation['x-resource-type'], 'mongo_data_documents');
  assert.equal(getOperation['x-resource-type'], 'mongo_data_document');
  assert.equal(updateOperation['x-resource-type'], 'mongo_data_document');
  assert.equal(replaceOperation['x-resource-type'], 'mongo_data_document');
  assert.equal(bulkOperation['x-resource-type'], 'mongo_data_bulk');

  assert.equal(listParameters.some((parameter) => parameter.name === 'filter'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'projection'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'sort'), true);
  assert.equal(listParameters.some((parameter) => parameter.name === 'page[size]'), true);
  assert.equal(createParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(getParameters.some((parameter) => parameter.name === 'documentId'), true);
  assert.equal(updateParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(replaceParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(bulkParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);

  assert.ok(document.components.schemas.MongoDataDocumentCollection);
  assert.ok(document.components.schemas.MongoDataDocumentEnvelope);
  assert.ok(document.components.schemas.MongoDataInsertRequest);
  assert.ok(document.components.schemas.MongoDataPatchRequest);
  assert.ok(document.components.schemas.MongoDataReplaceRequest);
  assert.ok(document.components.schemas.MongoDataMutationResult);
  assert.ok(document.components.schemas.MongoDataBulkWriteRequest);
  assert.ok(document.components.schemas.MongoDataBulkMutationResult);
  assert.ok(document.components.schemas.MongoDataBulkWriteOperation);
  assert.ok(document.components.schemas.MongoDataTenantScope);
  assert.ok(document.components.schemas.MongoDataValidationSummary);
  assert.ok(document.components.schemas.MongoDataTraceContext);
});
