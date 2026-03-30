import test from 'node:test';
import assert from 'node:assert/strict';
import { secretInventory } from '../../../services/provisioning-orchestrator/src/actions/secret-inventory.mjs';

test('inventory API returns metadata without values for authorized operator', async () => {
  const result = await secretInventory(
    { domain: 'platform', auth: { roles: ['platform-operator'] } },
    { query: async () => ({ rows: [{ name: 'app-password', domain: 'platform', path: 'platform/postgresql/app-password', createdAt: '2026-03-30T00:00:00Z', updatedAt: '2026-03-30T00:00:00Z', status: 'active', secretType: 'password' }] }) }
  );
  assert.equal(result.statusCode, 200);
  assert.equal('value' in result.body.secrets[0], false);
});
