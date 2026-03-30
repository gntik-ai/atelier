import test from 'node:test';
import assert from 'node:assert/strict';
import { secretInventory } from '../actions/secret-inventory.mjs';

test('returns 403 for missing role', async () => {
  const result = await secretInventory({ domain: 'platform', auth: { roles: [] } });
  assert.equal(result.statusCode, 403);
});

test('returns metadata for authorized operator', async () => {
  const result = await secretInventory(
    { domain: 'platform', auth: { roles: ['platform-operator'] } },
    { query: async () => ({ rows: [{ name: 'app-password', domain: 'platform', path: 'platform/postgresql/app-password', createdAt: '2026-03-30T00:00:00Z', updatedAt: '2026-03-30T00:00:00Z', status: 'active', secretType: 'password' }] }) }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.secrets[0].name, 'app-password');
  assert.equal('value' in result.body.secrets[0], false);
});

test('cross-tenant query denied for tenant operator', async () => {
  const result = await secretInventory({ domain: 'tenant', tenantId: 'b', auth: { roles: ['tenant-operator'], tenantId: 'a' } });
  assert.equal(result.statusCode, 403);
});
