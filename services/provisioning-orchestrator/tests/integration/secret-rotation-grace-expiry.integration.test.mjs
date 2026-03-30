import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/actions/secret-rotation-expiry-sweep.mjs';

test('integration: expiry sweep marks expired grace versions', async () => {
  const rows = [{ id: '1', secret_path: 'platform/a', vault_version: 1, domain: 'platform', tenant_id: null }];
  let expired = false;
  const result = await main({ db: {}, repo: { async listExpiredGraceVersions() { return rows; }, async expireGraceVersion() { expired = true; return {}; }, async insertRotationEvent() {} }, vaultClient: { async deleteSecretVersion() {} }, publishEvent: async () => {} });
  assert.equal(result.processed, 1);
  assert.equal(expired, true);
});
