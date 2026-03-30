import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverride, RetryOverride } from '../../services/provisioning-orchestrator/src/models/retry-override.mjs';

test('createOverride with valid fields', () => {
  const override = createOverride({ operationId: 'op', flagId: 'flag', tenantId: 't', superadminId: 'sa', justification: 'valid reason', attemptNumber: 2 });
  assert.equal(override.status, 'pending');
});

test('rejects short justification', () => {
  assert.throws(() => createOverride({ superadminId: 'sa', justification: 'short' }));
});

test('rejects missing superadminId', () => {
  assert.throws(() => createOverride({ justification: 'long enough justification' }));
});

test('status transitions pending to completed/failed are representable', () => {
  assert.equal(RetryOverride({ superadminId: 'sa', justification: 'long enough justification', status: 'completed' }).status, 'completed');
  assert.equal(RetryOverride({ superadminId: 'sa', justification: 'long enough justification', status: 'failed' }).status, 'failed');
});
