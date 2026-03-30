import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/actions/secret-rotation-revoke.mjs';

test('integration: revoke keeps other valid version intact', async () => {
  const result = await main({
    auth: { sub: 'u1', roles: ['superadmin'] },
    secretPath: 'platform/a', domain: 'platform', vaultVersion: 1, justification: 'x', db: { async query() { return { rows: [] }; } },
    repo: { async getVersionByVaultVersion() { return { id: '1' }; }, async getActiveVersion() { return { id: '2' }; }, async getGraceVersion() { return { id: '1' }; }, async revokeVersion() {}, async insertRotationEvent() {} },
    vaultClient: { async deleteSecretVersion() {} }, publishEvent: async () => {}
  });
  assert.equal(result.revokedVersion, 1);
});
