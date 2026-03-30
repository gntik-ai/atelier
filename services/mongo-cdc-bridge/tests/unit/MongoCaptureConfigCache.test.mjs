import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoCaptureConfigCache } from '../../src/MongoCaptureConfigCache.mjs';

test('loads and diffs active configs', async () => {
  let rows = [{ id: 'a' }];
  const pool = { query: async () => ({ rows }) };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0 });
  const added = [];
  const removed = [];
  cache.on('added', (row) => added.push(row.id));
  cache.on('removed', (row) => removed.push(row.id));
  await cache.load(true);
  rows = [{ id: 'b' }];
  await cache.load(true);
  assert.deepEqual(added, ['a', 'b']);
  assert.deepEqual(removed, ['a']);
});

test('returns stale cache on db error', async () => {
  let fail = false;
  const pool = { query: async () => { if (fail) throw new Error('boom'); return { rows: [{ id: 'a' }] }; } };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0 });
  await cache.load(true);
  fail = true;
  const rows = await cache.load(true);
  assert.equal(rows.length, 1);
});
