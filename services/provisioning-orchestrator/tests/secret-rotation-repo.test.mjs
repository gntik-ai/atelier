import test from 'node:test';
import assert from 'node:assert/strict';
import { insertRotationEvent, listRotationHistory } from '../src/repositories/secret-rotation-repo.mjs';

test('insertRotationEvent sanitizes detail before insert', async () => {
  const client = { async query() { return { rows: [{ ok: true }] }; } };
  const row = await insertRotationEvent(client, { secretPath: 'platform/a', domain: 'platform', eventType: 'initiated', actorId: 'u1', actorRoles: [], detail: { note: 'ok' } });
  assert.deepEqual(row, { ok: true });
  await assert.rejects(() => insertRotationEvent(client, { secretPath: 'platform/a', domain: 'platform', eventType: 'initiated', actorId: 'u1', actorRoles: [], detail: { password: 'bad' } }));
});

test('listRotationHistory returns rows and total', async () => {
  const client = { async query() { return { rows: [{ id: '1', __total: '1' }] }; } };
  const result = await listRotationHistory(client, { secretPath: 'platform/a', limit: 20, offset: 0 });
  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
});
