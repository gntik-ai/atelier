import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actions/secret-rotation-expiry-sweep.mjs';

test('secret-rotation-expiry-sweep processes rows and accumulates errors', async () => {
  const result = await main({
    db: {},
    repo: {
      async listExpiredGraceVersions() {
        return [
          { id: '1', secret_path: 'platform/a', vault_version: 1, domain: 'platform', tenant_id: null },
          { id: '2', secret_path: 'platform/b', vault_version: 2, domain: 'platform', tenant_id: null }
        ];
      },
      async expireGraceVersion({ }, args) { if (args.id === '2') throw new Error('boom'); return {}; },
      async insertRotationEvent() {}
    },
    vaultClient: { async deleteSecretVersion() {} },
    publishEvent: async () => {}
  });
  assert.equal(result.processed, 1);
  assert.equal(result.errors.length, 1);
});
