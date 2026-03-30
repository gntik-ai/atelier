import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actions/secret-rotation-revoke.mjs';

const db = { async query() { return { rows: [] }; } };

test('secret-rotation-revoke returns 404 when version missing', async () => {
  const result = await main({ auth: { sub: 'u', roles: ['superadmin'] }, secretPath: 'platform/a', domain: 'platform', vaultVersion: 9, justification: 'x', db, repo: { async getVersionByVaultVersion() { return null; } } });
  assert.equal(result.error.code, 'VERSION_NOT_FOUND');
});

test('secret-rotation-revoke requires force when last valid version', async () => {
  const result = await main({
    auth: { sub: 'u', roles: ['superadmin'] },
    secretPath: 'platform/a',
    domain: 'platform',
    vaultVersion: 1,
    justification: 'x',
    db,
    repo: {
      async getVersionByVaultVersion() { return { id: '1' }; },
      async getActiveVersion() { return { id: '1' }; },
      async getGraceVersion() { return null; }
    }
  });
  assert.equal(result.error.code, 'REVOKE_LEAVES_NO_ACTIVE_VERSION');
});

test('secret-rotation-revoke happy path', async () => {
  const published = [];
  const db2 = { async query() { return { rows: [] }; } };
  const result = await main({
    auth: { sub: 'u', roles: ['superadmin'] },
    secretPath: 'platform/a',
    domain: 'platform',
    vaultVersion: 1,
    justification: 'x',
    forceRevoke: true,
    db: db2,
    repo: {
      async getVersionByVaultVersion() { return { id: '1' }; },
      async getActiveVersion() { return { id: '1' }; },
      async getGraceVersion() { return { id: '2' }; },
      async revokeVersion() {},
      async insertRotationEvent() {}
    },
    vaultClient: { async deleteSecretVersion() {} },
    publishEvent: async (topic) => published.push(topic)
  });
  assert.equal(result.revokedVersion, 1);
  assert.equal(published[0], 'console.secrets.rotation.revoked');
});
