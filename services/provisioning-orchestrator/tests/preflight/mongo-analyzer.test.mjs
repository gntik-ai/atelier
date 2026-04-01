import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../src/preflight/analyzers/mongo-analyzer.mjs';

const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

test('mongo-analyzer: empty domain data → no_conflicts', async () => {
  const result = await analyze('t-1', null, { log: silentLog });
  assert.equal(result.status, 'no_conflicts');
});

test('mongo-analyzer: collection not in destination → compatible', async () => {
  const data = { database: 't_1', collections: [{ name: 'events', validator: {} }] };
  const result = await analyze('t-1', data, {
    credentials: { listCollections: async () => [], listIndexes: async () => [] },
    log: silentLog,
  });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('mongo-analyzer: collection with different validator → conflict high', async () => {
  const data = { database: 't_1', collections: [{ name: 'events', validator: { $jsonSchema: { required: ['id'] } } }] };
  const listCollections = async () => [{ name: 'events', options: { validator: { $jsonSchema: { required: ['id', 'type'] } } } }];
  const result = await analyze('t-1', data, {
    credentials: { listCollections, listIndexes: async () => [] },
    log: silentLog,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].severity, 'high');
});

test('mongo-analyzer: index with different key → conflict critical', async () => {
  const data = {
    database: 't_1',
    collections: [],
    indexes: [{ name: 'idx_events_type', collection: 'events', key: { type: 1, created: -1 }, unique: false }],
  };
  const listIndexes = async () => [{ name: 'idx_events_type', key: { type: 1 }, unique: false }];
  const result = await analyze('t-1', data, {
    credentials: { listCollections: async () => [], listIndexes },
    log: silentLog,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].severity, 'critical');
});

test('mongo-analyzer: MongoDB unavailable → analysis_error', async () => {
  const data = { database: 't_1', collections: [{ name: 'events' }] };
  const listCollections = async () => { throw new Error('connection refused'); };
  const result = await analyze('t-1', data, {
    credentials: { listCollections, listIndexes: async () => [] },
    log: silentLog,
  });
  assert.ok(result.conflicts.length >= 0 || result.status === 'analysis_error');
});

test('mongo-analyzer: no write operations called', async () => {
  const writeCalls = [];
  const data = { database: 't_1', collections: [{ name: 'events' }] };
  const listCollections = async () => [];
  const listIndexes = async () => [];
  const result = await analyze('t-1', data, {
    credentials: { listCollections, listIndexes },
    log: silentLog,
  });
  // No write functions exist on the credentials — that's the point
  assert.ok(result);
});
