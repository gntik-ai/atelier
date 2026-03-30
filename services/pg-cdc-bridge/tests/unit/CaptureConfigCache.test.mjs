import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureConfigCache } from '../../src/CaptureConfigCache.mjs';
test('cache behaviors', async () => {
  let calls = 0; let rows = [{ id: 1 }];
  const pool = { query: async () => { calls += 1; return { rows }; } };
  const cache = new CaptureConfigCache({ pool, ttlSeconds: 0.01 });
  assert.equal((await cache.getActiveConfigs('db')).length, 1);
  assert.equal((await cache.getActiveConfigs('db')).length, 1);
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 15));
  await cache.getActiveConfigs('db');
  assert.equal(calls, 2);
  cache.invalidate('db');
  await cache.getActiveConfigs('db');
  assert.equal(calls, 3);
});
test('db error returns stale or empty', async () => {
  let fail = false; const pool = { query: async () => { if (fail) throw new Error('boom'); return { rows: [{ id: 1 }] }; } };
  const cache = new CaptureConfigCache({ pool, ttlSeconds: 0 });
  assert.equal((await cache.getActiveConfigs('db')).length, 1);
  fail = true;
  assert.equal((await cache.getActiveConfigs('db')).length, 1);
  const empty = new CaptureConfigCache({ pool: { query: async () => { throw new Error('x'); } }, ttlSeconds: 0 });
  assert.deepEqual(await empty.getActiveConfigs('db'), []);
});
