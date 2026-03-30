import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIdempotencyKeyRecord,
  hashParams,
  isExpired,
  validateKeyFormat
} from '../../services/provisioning-orchestrator/src/models/idempotency-key-record.mjs';

test('createIdempotencyKeyRecord builds deterministic params hash and expiry', () => {
  const record = createIdempotencyKeyRecord({
    tenant_id: 'tenant-a',
    idempotency_key: 'create_workspace_01',
    operation_id: '11111111-1111-4111-8111-111111111111',
    operation_type: 'create-workspace',
    params: { b: 2, a: 1 },
    created_at: '2026-03-30T00:00:00.000Z',
    ttl_hours: 2
  });

  assert.equal(record.tenant_id, 'tenant-a');
  assert.equal(record.idempotency_key, 'create_workspace_01');
  assert.equal(record.params_hash, hashParams({ a: 1, b: 2 }));
  assert.equal(record.expires_at, '2026-03-30T02:00:00.000Z');
});

test('validateKeyFormat rejects invalid keys', () => {
  assert.equal(validateKeyFormat('valid_key-01'), 'valid_key-01');
  assert.throws(() => validateKeyFormat('x'.repeat(129)), /Idempotency key exceeds maximum length/);
  assert.throws(() => validateKeyFormat('invalid key'), /Idempotency key exceeds maximum length/);
});

test('isExpired detects expired records', () => {
  assert.equal(isExpired({ expires_at: '2026-03-30T00:00:00.000Z' }, '2026-03-30T00:00:01.000Z'), true);
  assert.equal(isExpired({ expires_at: '2026-03-30T00:00:01.000Z' }, '2026-03-30T00:00:00.000Z'), false);
});

test('hashParams is deterministic for sorted keys and nested objects', () => {
  const first = hashParams({ nested: { z: 3, a: 1 }, list: [{ b: 2, a: 1 }] });
  const second = hashParams({ list: [{ a: 1, b: 2 }], nested: { a: 1, z: 3 } });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});
