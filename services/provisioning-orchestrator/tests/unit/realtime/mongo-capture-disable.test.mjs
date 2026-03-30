import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../src/actions/realtime/mongo-capture-disable.mjs';

const auth = (claims) => `Bearer ${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
const validClaims = { tenant_id: 'tenant-1', workspace_id: 'workspace-1', actor_identity: 'user-1' };

test('returns 204 for valid disable and deletes resume token', async () => {
  const current = { id: 'cfg-1', status: 'active', collection_name: 'products', toJSON: () => ({ id: 'cfg-1', status: 'active' }) };
  const updated = { id: 'cfg-1', status: 'disabled', toJSON: () => ({ id: 'cfg-1', status: 'disabled' }) };
  let deletedCaptureId = null;

  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, captureId: 'cfg-1' }, {
    configRepo: { findById: async () => current, disable: async () => updated },
    resumeTokenRepo: { delete: async (captureId) => { deletedCaptureId = captureId; } },
    auditRepo: { append: async () => ({}) },
    publisher: { publish: async () => ({}) }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(deletedCaptureId, 'cfg-1');
});

test('returns 401 for invalid JWT', async () => {
  const response = await main({ __ow_headers: { authorization: 'Bearer nope' }, captureId: 'cfg-1' });
  assert.equal(response.statusCode, 401);
});

test('returns 404 when capture missing', async () => {
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, captureId: 'cfg-1' }, { configRepo: { findById: async () => null } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'CAPTURE_NOT_FOUND');
});

test('returns 409 when capture already disabled', async () => {
  const current = { id: 'cfg-1', status: 'disabled', toJSON: () => ({ id: 'cfg-1', status: 'disabled' }) };
  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, captureId: 'cfg-1' }, { configRepo: { findById: async () => current } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'CAPTURE_ALREADY_DISABLED');
});

test('calls audit append and lifecycle publish on success', async () => {
  const current = { id: 'cfg-1', status: 'active', collection_name: 'products', toJSON: () => ({ id: 'cfg-1', status: 'active' }) };
  const updated = { id: 'cfg-1', status: 'disabled', toJSON: () => ({ id: 'cfg-1', status: 'disabled' }) };
  let auditPayload = null;
  let published = false;

  const response = await main({ __ow_headers: { authorization: auth(validClaims) }, captureId: 'cfg-1' }, {
    configRepo: { findById: async () => current, disable: async () => updated },
    resumeTokenRepo: { delete: async () => {} },
    auditRepo: { append: async (payload) => { auditPayload = payload; } },
    publisher: { publish: async () => { published = true; } }
  });

  assert.equal(response.statusCode, 204);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auditPayload.action, 'capture-disabled');
  assert.deepEqual(auditPayload.before_state, { id: 'cfg-1', status: 'active' });
  assert.deepEqual(auditPayload.after_state, { id: 'cfg-1', status: 'disabled' });
  assert.equal(published, true);
});
