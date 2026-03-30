import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from '../../src/MongoChangeEventMapper.mjs';

const captureConfig = {
  id: 'cfg-1',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  data_source_ref: 'mongo-main',
  database_name: 'catalog',
  collection_name: 'products',
  capture_mode: 'delta'
};
const ts = { toDate: () => new Date('2026-03-30T10:00:00.000Z') };

test('maps insert operation', () => {
  const event = map({ operationType: 'insert', documentKey: { _id: '1' }, fullDocument: { _id: '1', name: 'A' }, clusterTime: ts }, captureConfig);
  assert.equal(event.data.event_type, 'insert');
  assert.deepEqual(event.data.full_document, { _id: '1', name: 'A' });
  assert.equal(event.data.update_description, null);
  assert.equal(event.specversion, '1.0');
  assert.equal(event.type, 'console.mongo-capture.change');
});

test('maps update in delta mode', () => {
  const event = map({ operationType: 'update', documentKey: { _id: '1' }, updateDescription: { updatedFields: { name: 'B' }, removedFields: ['old'] }, clusterTime: ts }, captureConfig);
  assert.equal(event.data.event_type, 'update');
  assert.deepEqual(event.data.update_description, { updatedFields: { name: 'B' }, removedFields: ['old'] });
  assert.equal(event.data.full_document, null);
});

test('maps update in full-document mode', () => {
  const event = map({ operationType: 'update', documentKey: { _id: '1' }, fullDocument: { _id: '1', name: 'B' }, clusterTime: ts }, { ...captureConfig, capture_mode: 'full-document' });
  assert.deepEqual(event.data.full_document, { _id: '1', name: 'B' });
  assert.equal(event.data.update_description, null);
});

test('maps replace operation', () => {
  const event = map({ operationType: 'replace', documentKey: { _id: '1' }, fullDocument: { _id: '1', name: 'C' }, clusterTime: ts }, captureConfig);
  assert.equal(event.data.event_type, 'replace');
  assert.deepEqual(event.data.full_document, { _id: '1', name: 'C' });
});

test('maps delete operation with graceful null fullDocument handling', () => {
  const event = map({ operationType: 'delete', documentKey: { _id: '1' }, clusterTime: ts }, captureConfig);
  assert.equal(event.data.event_type, 'delete');
  assert.deepEqual(event.data.document_key, { _id: '1' });
  assert.equal(event.data.full_document, null);
});

test('normalizes ObjectId-like, string, and composite keys', () => {
  const objectIdEvent = map({ operationType: 'insert', documentKey: { _id: { toHexString: () => '507f1f77bcf86cd799439011' } }, fullDocument: {}, clusterTime: ts }, captureConfig);
  const stringEvent = map({ operationType: 'insert', documentKey: { _id: 'plain-key' }, fullDocument: {}, clusterTime: ts }, captureConfig);
  const compositeEvent = map({ operationType: 'insert', documentKey: { _id: { sku: 'sku-1', locale: 'es-ES' } }, fullDocument: {}, clusterTime: ts }, captureConfig);

  assert.deepEqual(objectIdEvent.data.document_key, { _id: '507f1f77bcf86cd799439011' });
  assert.deepEqual(stringEvent.data.document_key, { _id: 'plain-key' });
  assert.deepEqual(compositeEvent.data.document_key, { _id: { sku: 'sku-1', locale: 'es-ES' } });
});

test('maps clusterTime and wallTime to ISO strings and generates unique ids', () => {
  const first = map({ operationType: 'insert', documentKey: { _id: '1' }, fullDocument: {}, clusterTime: ts, wallTime: new Date('2026-03-30T10:00:01.000Z') }, captureConfig);
  const second = map({ operationType: 'insert', documentKey: { _id: '2' }, fullDocument: {}, clusterTime: ts }, captureConfig);

  assert.equal(first.data.cluster_time, '2026-03-30T10:00:00.000Z');
  assert.equal(first.data.wall_time, '2026-03-30T10:00:01.000Z');
  assert.equal(second.data.wall_time, null);
  assert.notEqual(first.id, second.id);
});
