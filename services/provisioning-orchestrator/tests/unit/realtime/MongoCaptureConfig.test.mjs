import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoCaptureConfig } from '../../../src/models/realtime/MongoCaptureConfig.mjs';

const base = {
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  data_source_ref: 'mongo-main',
  database_name: 'catalog',
  collection_name: 'products',
  actor_identity: 'user-1'
};

test('constructs valid config with defaults', () => {
  const model = new MongoCaptureConfig(base);
  assert.equal(model.capture_mode, 'delta');
  assert.equal(model.status, 'active');
  assert.equal(model.qualifiedNs(), 'catalog.products');
});

test('throws for required fields', () => {
  assert.throws(() => new MongoCaptureConfig({ ...base, tenant_id: null }), /MONGO_CAPTURE_TENANT_ID_REQUIRED/);
  assert.throws(() => new MongoCaptureConfig({ ...base, workspace_id: null }), /MONGO_CAPTURE_WORKSPACE_ID_REQUIRED/);
  assert.throws(() => new MongoCaptureConfig({ ...base, data_source_ref: null }), /MONGO_CAPTURE_DATA_SOURCE_REF_REQUIRED/);
  assert.throws(() => new MongoCaptureConfig({ ...base, database_name: null }), /MONGO_CAPTURE_DATABASE_NAME_REQUIRED/);
  assert.throws(() => new MongoCaptureConfig({ ...base, collection_name: null }), /MONGO_CAPTURE_COLLECTION_NAME_REQUIRED/);
  assert.throws(() => new MongoCaptureConfig({ ...base, actor_identity: null }), /MONGO_CAPTURE_ACTOR_IDENTITY_REQUIRED/);
});

test('throws for invalid status or capture mode', () => {
  assert.throws(() => new MongoCaptureConfig({ ...base, status: 'unknown' }), /INVALID_MONGO_CAPTURE_STATUS/);
  assert.throws(() => new MongoCaptureConfig({ ...base, capture_mode: 'snapshot' }), /INVALID_MONGO_CAPTURE_MODE/);
});

test('fromRow mirrors constructor semantics', () => {
  const row = { ...base, id: 'cfg-1', capture_mode: 'full-document', status: 'paused' };
  const model = MongoCaptureConfig.fromRow(row);
  assert.deepEqual(model.toJSON(), new MongoCaptureConfig(row).toJSON());
});
