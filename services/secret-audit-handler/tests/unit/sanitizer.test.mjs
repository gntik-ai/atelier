import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../../src/sanitizer.mjs';

test('sanitize removes forbidden fields recursively', () => {
  const sanitized = sanitize({
    secretPath: 'platform/postgresql/app-password',
    nested: { value: 'x', Password: 'y', ok: true },
    array: [{ token: 'z', keep: 1 }]
  });
  assert.deepEqual(sanitized, {
    secretPath: 'platform/postgresql/app-password',
    nested: { ok: true },
    array: [{ keep: 1 }]
  });
});

test('sanitize preserves allowed fields', () => {
  const sanitized = sanitize({ domain: 'platform', operation: 'read', secretPath: 'platform/x' });
  assert.equal(sanitized.domain, 'platform');
  assert.equal(sanitized.operation, 'read');
  assert.equal(sanitized.secretPath, 'platform/x');
});
