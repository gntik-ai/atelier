import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecretVersionRecord, ensureNoSecretMaterial, validateSecretVersionState } from '../src/models/secret-version-state.mjs';

test('validateSecretVersionState accepts valid record', () => {
  assert.equal(validateSecretVersionState({ secretPath: 'platform/a/b', domain: 'platform', secretName: 'b', vaultVersion: 1, state: 'active', gracePeriodSeconds: 0, initiatedBy: 'user:1' }), true);
});

test('validateSecretVersionState rejects invalid state', () => {
  assert.throws(() => validateSecretVersionState({ secretPath: 'x', domain: 'platform', secretName: 'x', vaultVersion: 1, state: 'bad', gracePeriodSeconds: 0, initiatedBy: 'u' }));
});

test('createSecretVersionRecord applies shape', () => {
  const record = createSecretVersionRecord({ secretPath: 'tenant/t1/db-password', domain: 'tenant', tenantId: 'tenant-1', secretName: 'db-password', vaultVersion: 2, gracePeriodSeconds: 0, initiatedBy: 'user:1' });
  assert.equal(record.secretName, 'db-password');
});

test('ensureNoSecretMaterial rejects secret-like keys', () => {
  assert.throws(() => ensureNoSecretMaterial({ password: 'x' }));
});
