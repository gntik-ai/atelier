import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../../src/sanitizer.mjs';
import { parseVaultEntry } from '../../src/vault-log-reader.mjs';

test('parsed and sanitized audit event never exposes secret material', () => {
  const parsed = parseVaultEntry(JSON.stringify({
    time: '2026-03-30T00:00:00.000Z',
    auth: { display_name: 'svc', metadata: { service_account_namespace: 'platform', service_account_name: 'svc-sa' } },
    request: { id: 'req-1', path: 'secret/data/platform/postgresql/app-password', operation: 'read' },
    response: { data: { value: 'top-secret' } }
  }));
  const sanitized = sanitize(parsed);
  assert.equal('value' in sanitized, false);
  assert.equal(sanitized.domain, 'platform');
});
