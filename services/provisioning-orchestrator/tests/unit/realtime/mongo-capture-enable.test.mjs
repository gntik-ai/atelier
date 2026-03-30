import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../src/actions/realtime/mongo-capture-enable.mjs';

const auth = (claims) => `Bearer ${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
const validClaims = { tenant_id: 'tenant-1', workspace_id: 'workspace-1', actor_identity: 'user-1' };
const validBody = { data_source_ref: 'mongo-main', database_name: 'catalog', collection_name: 'products' };
const successDeps = () => ({
  quotaRepo: { getQuota: async () => null, countActive: async () => 0 },
  configRepo: { create: async () => ({ id: 'cfg-1', collection_name: 'products', toJSON: () => ({ id: 'cfg-1', status: 'active' }) }) },
  auditRepo: { append: async () => ({ ok: true }) },
  publisher: { publish: async () => ({ ok: true }) },
  collectionProbe: async () => ({ ok: true, replicaSet: true })
});

test('returns 201 for valid request', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: validBody }, successDeps());
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.id, 'cfg-1');
});

test('returns 400 for missing required request fields', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: { data_source_ref: 'mongo-main', database_name: 'catalog' } }, successDeps());
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'INVALID_REQUEST');
});

test('returns 401 for invalid JWT', async () => {
  const response = await main({ __ow_headers: { authorization: 'Bearer nope' }, body: validBody }, successDeps());
  assert.equal(response.statusCode, 401);
});

test('returns 429 when workspace quota is exceeded', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: validBody }, {
    quotaRepo: { getQuota: async () => ({ max_collections: 1 }), countActive: async () => 1 }
  });
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.code, 'QUOTA_EXCEEDED');
  assert.equal(response.body.scope, 'workspace');
});

test('returns 404 when collection probe reports missing collection', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: validBody }, {
    ...successDeps(),
    collectionProbe: async () => ({ ok: false, code: 'COLLECTION_NOT_FOUND', replicaSet: true })
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'COLLECTION_NOT_FOUND');
});

test('returns 400 when data source is not a replica set', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: validBody }, {
    ...successDeps(),
    collectionProbe: async () => ({ ok: true, replicaSet: false })
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'REPLICA_SET_REQUIRED');
});

test('returns 409 when capture is already active', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: validBody }, {
    ...successDeps(),
    configRepo: { create: async () => { throw { code: 'CAPTURE_ALREADY_ACTIVE' }; } }
  });
  assert.equal(response.statusCode, 409);
});

test('calls audit append and lifecycle publish exactly once on success', async () => {
  let auditCalls = 0;
  let publishCalls = 0;
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, body: validBody }, {
    ...successDeps(),
    auditRepo: { append: async () => { auditCalls += 1; } },
    publisher: { publish: async () => { publishCalls += 1; } }
  });
  assert.equal(response.statusCode, 201);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auditCalls, 1);
  assert.equal(publishCalls, 1);
});
