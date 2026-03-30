import test from 'node:test';
import assert from 'node:assert/strict';
import { ResumeTokenStore } from '../../src/ResumeTokenStore.mjs';

test('get/upsert/delete delegate to pool', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push([sql, params]); return sql.startsWith('SELECT') ? { rows: [{ resume_token: { _data: 'abc' } }] } : { rows: [{}] }; } };
  const store = new ResumeTokenStore(pool);
  await store.upsert('c1', { _data: 'abc' });
  const token = await store.get('c1');
  await store.delete('c1');
  assert.deepEqual(token, { _data: 'abc' });
  assert.equal(calls.length, 3);
});
