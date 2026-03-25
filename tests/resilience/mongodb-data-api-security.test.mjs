import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MongoDataApiError,
  buildMongoDataApiPlan,
  normalizeMongoDataFilter
} from '../../services/adapters/src/mongodb-data-api.mjs';

test('mongodb data API always injects tenant scope into reads and denies mismatched tenant predicates', () => {
  const plan = buildMongoDataApiPlan({
    operation: 'list',
    workspaceId: 'ws_profiles',
    databaseName: 'tenant_shared',
    collectionName: 'profiles',
    tenantId: 'ten_alpha',
    filter: normalizeMongoDataFilter({ status: 'active' })
  });

  assert.equal(plan.query.filter.$and[0].tenantId, 'ten_alpha');

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'list',
        workspaceId: 'ws_profiles',
        databaseName: 'tenant_shared',
        collectionName: 'profiles',
        tenantId: 'ten_alpha',
        filter: normalizeMongoDataFilter({ tenantId: { $eq: 'ten_beta' } })
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_tenant_scope_violation'
  );
});

test('mongodb data API rejects write payloads that attempt to switch tenant ownership', () => {
  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'replace',
        workspaceId: 'ws_profiles',
        databaseName: 'tenant_shared',
        collectionName: 'profiles',
        documentId: 'doc_001',
        tenantId: 'ten_alpha',
        payload: {
          replacement: {
            _id: 'doc_001',
            tenantId: 'ten_beta',
            status: 'active'
          }
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_tenant_scope_violation'
  );
});
