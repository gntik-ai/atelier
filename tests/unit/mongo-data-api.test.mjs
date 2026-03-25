import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMongoDataApiRoute,
  listMongoDataApiRoutes,
  mongoDataApiFamily,
  mongoDataApiRoutes,
  mongoDataRequestContract,
  mongoDataResultContract,
  summarizeMongoDataApiSurface
} from '../../apps/control-plane/src/mongo-data-api.mjs';
import {
  MONGO_DATA_API_CAPABILITIES,
  MONGO_DATA_DEFAULT_BULK_LIMITS,
  MongoDataApiError,
  applyMongoDataUpdateDocument,
  applyTenantScopeToFilter,
  buildMongoDataApiPlan,
  encodeMongoDataCursor,
  normalizeMongoDataError,
  normalizeMongoDataFilter,
  normalizeMongoDataProjection,
  normalizeMongoDataSort
} from '../../services/adapters/src/mongodb-data-api.mjs';

test('mongo data API surface publishes the expected family, contracts, and route inventory', () => {
  const summary = summarizeMongoDataApiSurface();

  assert.equal(mongoDataApiFamily?.id, 'mongo');
  assert.equal(mongoDataRequestContract?.owner, 'control_api');
  assert.equal(mongoDataResultContract?.owner, 'provisioning_orchestrator');
  assert.equal(mongoDataApiRoutes.length, 7);
  assert.equal(listMongoDataApiRoutes({ method: 'GET' }).length, 2);
  assert.equal(getMongoDataApiRoute('bulkWriteMongoDataDocuments')?.resourceType, 'mongo_data_bulk');
  assert.equal(summary.routeCount, 7);
  assert.equal(summary.operations.find((entry) => entry.operation === 'bulk_write')?.routeCount, 1);
  assert.deepEqual(summary.filterOperators.slice(0, 4), ['$eq', '$ne', '$gt', '$gte']);
});

test('mongo data API normalizes nested filters, projection, sort, and cursor pagination', () => {
  const filter = normalizeMongoDataFilter({
    status: { $in: ['active', 'paused'] },
    'profile.address.city': 'Madrid',
    $or: [{ score: { $gte: 10 } }, { priority: 'high' }]
  });
  const projection = normalizeMongoDataProjection({ _id: 1, status: true, 'profile.address.city': 1 });
  const sort = normalizeMongoDataSort({ updatedAt: 'desc' });
  const cursor = encodeMongoDataCursor({ values: { updatedAt: '2026-03-25T00:00:00.000Z', _id: 'doc_100' } });
  const plan = buildMongoDataApiPlan({
    operation: 'list',
    workspaceId: 'ws_analytics',
    databaseName: 'tenant_shared',
    collectionName: 'profiles',
    tenantId: 'ten_alpha',
    filter,
    projection,
    sort,
    page: { size: 40, after: cursor },
    correlationId: 'corr-123'
  });

  assert.deepEqual(filter.status.$in, ['active', 'paused']);
  assert.equal(projection['profile.address.city'], 1);
  assert.equal(sort.updatedAt, -1);
  assert.equal(sort._id, 1);
  assert.equal(plan.capability, MONGO_DATA_API_CAPABILITIES.list);
  assert.equal(plan.query.limit, 40);
  assert.equal(plan.query.filter.$and[0].$and[0].tenantId, 'ten_alpha');
  assert.ok(plan.query.cursorPredicate.$or);
});

test('mongo data API injects tenant scope into write payloads and validates collection rules for updates', () => {
  const plan = buildMongoDataApiPlan({
    operation: 'update',
    workspaceId: 'ws_analytics',
    databaseName: 'tenant_shared',
    collectionName: 'profiles',
    documentId: 'doc_001',
    tenantId: 'ten_alpha',
    payload: {
      existingDocument: {
        _id: 'doc_001',
        tenantId: 'ten_alpha',
        profile: {
          name: 'Andrea',
          address: { city: 'Barcelona' }
        },
        status: 'active'
      },
      update: {
        $set: {
          'profile.address.city': 'Madrid',
          status: 'paused'
        }
      }
    },
    collectionMetadata: {
      validationRules: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['tenantId', 'status', 'profile'],
          properties: {
            tenantId: { bsonType: 'string' },
            status: { enum: ['active', 'paused'] },
            profile: {
              bsonType: 'object',
              required: ['name', 'address'],
              properties: {
                name: { bsonType: 'string', minLength: 1 },
                address: {
                  bsonType: 'object',
                  required: ['city'],
                  properties: {
                    city: { bsonType: 'string', minLength: 1 }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  assert.equal(plan.query.filter.$and[1]._id, 'doc_001');
  assert.equal(plan.write.update.$set['profile.address.city'], 'Madrid');
  assert.equal(plan.write.validation.applied, true);

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'insert',
        workspaceId: 'ws_analytics',
        databaseName: 'tenant_shared',
        collectionName: 'profiles',
        tenantId: 'ten_alpha',
        payload: {
          document: {
            _id: 'doc_002',
            tenantId: 'ten_alpha',
            status: 'archived'
          }
        },
        collectionMetadata: {
          validationRules: {
            $jsonSchema: {
              bsonType: 'object',
              required: ['tenantId', 'status'],
              properties: {
                tenantId: { bsonType: 'string' },
                status: { enum: ['active', 'paused'] }
              }
            }
          }
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_validation_failed'
  );
});

test('mongo data API guards tenant overrides and supports update document helpers', () => {
  const scoped = applyTenantScopeToFilter({
    filter: { status: 'active' },
    tenantId: 'ten_alpha'
  });
  const updated = applyMongoDataUpdateDocument(
    {
      tenantId: 'ten_alpha',
      metrics: { count: 2 },
      tags: ['a']
    },
    {
      $inc: { 'metrics.count': 3 },
      $push: { tags: 'b' },
      $set: { status: 'active' }
    }
  );

  assert.equal(scoped.filter.$and[0].tenantId, 'ten_alpha');
  assert.equal(updated.metrics.count, 5);
  assert.deepEqual(updated.tags, ['a', 'b']);
  assert.equal(updated.status, 'active');

  assert.throws(
    () => applyTenantScopeToFilter({ filter: { tenantId: 'ten_beta' }, tenantId: 'ten_alpha' }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_tenant_scope_violation'
  );
});

test('mongo data API normalizes provider errors and bulk limits', () => {
  const conflict = normalizeMongoDataError({ code: 11000, message: 'E11000 duplicate key error' });
  const validation = normalizeMongoDataError({ code: 121, codeName: 'DocumentValidationFailure', message: 'failed validation' });
  const generic = normalizeMongoDataError(new Error('network timeout'));

  assert.equal(conflict.status, 409);
  assert.equal(validation.status, 422);
  assert.equal(generic.status, 502);
  assert.equal(MONGO_DATA_DEFAULT_BULK_LIMITS.maxOperations > 0, true);
});
