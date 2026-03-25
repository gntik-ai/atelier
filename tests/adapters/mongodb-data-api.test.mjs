import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MONGO_DATA_DEFAULT_BULK_LIMITS,
  MongoDataApiError,
  buildMongoDataApiPlan,
  detectMongoRequestUniqueIndexConflicts,
  mongodbDataAdapterPort,
  summarizeMongoDataApiCapabilityMatrix,
  validateMongoDocumentAgainstCollectionRules
} from '../../services/adapters/src/mongodb-data-api.mjs';

test('mongodb data adapter publishes CRUD and bulk capabilities for document operations', () => {
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_query'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_insert'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_update'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_replace'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_delete'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_bulk_write'));
  assert.equal(summarizeMongoDataApiCapabilityMatrix().length, 7);
  assert.equal(MONGO_DATA_DEFAULT_BULK_LIMITS.maxPayloadBytes > 0, true);
});

test('mongodb data adapter validates nested document payloads against collection rules', () => {
  const validation = validateMongoDocumentAgainstCollectionRules(
    {
      tenantId: 'ten_alpha',
      profile: {
        name: 'Andrea',
        address: { city: 'Madrid', country: 'ES' }
      },
      tags: ['vip']
    },
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['tenantId', 'profile'],
        properties: {
          tenantId: { bsonType: 'string' },
          profile: {
            bsonType: 'object',
            required: ['name', 'address'],
            properties: {
              name: { bsonType: 'string', minLength: 2 },
              address: {
                bsonType: 'object',
                required: ['city', 'country'],
                properties: {
                  city: { bsonType: 'string' },
                  country: { bsonType: 'string', minLength: 2, maxLength: 2 }
                }
              }
            }
          },
          tags: {
            bsonType: 'array',
            items: { bsonType: 'string' }
          }
        }
      }
    }
  );

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.violations, []);
});

test('mongodb data adapter flags unique index conflicts inside bounded requests', () => {
  const conflicts = detectMongoRequestUniqueIndexConflicts({
    documents: [
      { tenantId: 'ten_alpha', email: 'a@example.com' },
      { tenantId: 'ten_alpha', email: 'a@example.com' },
      { tenantId: 'ten_alpha', email: 'b@example.com' }
    ],
    indexes: [{ name: 'uniq_email', unique: true, keys: { tenantId: 1, email: 1 } }]
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].indexName, 'uniq_email');
  assert.deepEqual(conflicts[0].keys, ['tenantId', 'email']);
});

test('mongodb data adapter builds a controlled bulk-write plan with tenant scoping, validation, and size checks', () => {
  const plan = buildMongoDataApiPlan({
    operation: 'bulk_write',
    workspaceId: 'ws_orders',
    databaseName: 'tenant_shared',
    collectionName: 'orders',
    tenantId: 'ten_alpha',
    payload: {
      limits: { maxOperations: 3, maxPayloadBytes: 2048, ordered: false },
      operations: [
        {
          kind: 'insertOne',
          document: {
            _id: 'ord_001',
            status: 'open',
            payload: { channel: 'web' }
          }
        },
        {
          kind: 'updateOne',
          filter: { status: 'open' },
          update: {
            $set: { 'payload.priority': 'high' }
          },
          existingDocument: {
            _id: 'ord_001',
            tenantId: 'ten_alpha',
            status: 'open',
            payload: { channel: 'web' }
          }
        },
        {
          kind: 'deleteMany',
          filter: { archived: true }
        }
      ]
    },
    collectionMetadata: {
      validationRules: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['tenantId', 'status'],
          properties: {
            tenantId: { bsonType: 'string' },
            status: { enum: ['open', 'closed'] },
            payload: { bsonType: 'object' }
          }
        }
      },
      indexes: [{ name: 'uniq_tenant_status', unique: true, keys: { tenantId: 1, _id: 1 } }]
    }
  });

  assert.equal(plan.bulk.operationCount, 3);
  assert.equal(plan.bulk.ordered, false);
  assert.equal(plan.bulk.operations[0].document.tenantId, 'ten_alpha');
  assert.equal(plan.bulk.operations[1].filter.$and[0].tenantId, 'ten_alpha');
  assert.equal(plan.bulk.payloadBytes > 0, true);

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'bulk_write',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        payload: {
          limits: { maxOperations: 2, maxPayloadBytes: 1024 },
          operations: [
            { kind: 'insertOne', document: { _id: 'ord_001', status: 'open' } },
            { kind: 'insertOne', document: { _id: 'ord_002', status: 'open' } },
            { kind: 'deleteMany', filter: { archived: true } }
          ]
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_bulk_limit_exceeded'
  );
});

test('mongodb data adapter rejects large or conflicting bulk payloads deterministically', () => {
  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'bulk_write',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        payload: {
          limits: { maxOperations: 4, maxPayloadBytes: 280 },
          operations: [
            { kind: 'insertOne', document: { _id: 'ord_001', email: 'dup@example.com', notes: 'x'.repeat(140) } },
            { kind: 'insertOne', document: { _id: 'ord_002', email: 'dup@example.com', notes: 'x'.repeat(140) } }
          ]
        },
        collectionMetadata: {
          indexes: [{ name: 'uniq_email', unique: true, keys: { tenantId: 1, email: 1 } }]
        }
      }),
    (error) => error instanceof MongoDataApiError && ['mongo_data_bulk_payload_too_large', 'mongo_data_conflict'].includes(error.code)
  );
});
