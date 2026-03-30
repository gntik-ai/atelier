import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, matches } from '../../../services/provisioning-orchestrator/src/models/realtime/EventFilter.mjs';

test('null filter matches all events', () => {
  assert.equal(matches(null, { operation: 'INSERT' }), true);
});

test('table_name, collection_name, operations and AND logic work', () => {
  assert.equal(matches({ table_name: 'orders' }, { tableName: 'orders', operation: 'INSERT' }), true);
  assert.equal(matches({ collection_name: 'orders' }, { collectionName: 'orders', operation: 'INSERT' }), true);
  assert.equal(matches({ operations: ['UPDATE'] }, { operation: 'UPDATE' }), true);
  assert.equal(matches({ table_name: 'orders', operations: ['UPDATE'] }, { tableName: 'orders', operation: 'UPDATE' }), true);
  assert.equal(matches({ table_name: 'orders', operations: ['UPDATE'] }, { tableName: 'users', operation: 'UPDATE' }), false);
});

test('schema validation rejects unknown fields', () => {
  const result = validate({ foo: 'bar' });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /UNKNOWN_FIELD/);
});
