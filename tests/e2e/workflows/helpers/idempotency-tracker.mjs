import assert from 'node:assert/strict';

export function makeIdempotencyKey(label = '') {
  const normalized = String(label).trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
  return `e2e-${Date.now()}${normalized ? `-${normalized}` : ''}`;
}

export function assertIdempotentResult(firstResult, secondResult) {
  assert.equal(secondResult?.status, firstResult?.status, 'idempotent result status mismatch');
  assert.deepEqual(
    { ...secondResult?.output, correlationId: undefined },
    { ...firstResult?.output, correlationId: undefined },
    'idempotent output mismatch'
  );
  assert.equal(secondResult?.output?.idempotencyKey, firstResult?.output?.idempotencyKey, 'idempotency key mismatch');
}
