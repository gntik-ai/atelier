import test from 'node:test';
import assert from 'node:assert/strict';
import { main as initiate } from '../../src/actions/secret-rotation-initiate.mjs';
import { main as revoke } from '../../src/actions/secret-rotation-revoke.mjs';

function db() {
  return { async query() { return { rows: [] }; } };
}

test('initiate success contract', async () => {
  const result = await initiate({
    auth: { sub: 'u1', roles: ['superadmin'] }, secretPath: 'platform/a', domain: 'platform', newValue: 'v', justification: 'rotate', db: db(),
    repo: { async getActiveVersion() { return { id: '1', vault_version: 1 }; }, async getGraceVersion() { return null; }, async transitionToGrace() { return { grace_expires_at: '2026-01-01T00:00:00.000Z' }; }, async insertSecretVersion() { return { id: '2' }; }, async insertRotationEvent() {}, async updateSecretVersionVaultVersion() { return { id: '2', vault_version: 2 }; }, async listConsumers() { return []; } },
    vaultClient: { async writeSecret() { return { data: { version: 2 } }; } }
  });
  assert.equal(typeof result.rotationId, 'string');
  assert.equal(result.vaultVersionNew, 2);
  assert.equal('newValue' in result, false);
});

test('revoke error contract', async () => {
  const result = await revoke({ auth: { sub: 'u1', roles: ['superadmin'] }, secretPath: 'platform/a', domain: 'platform', vaultVersion: 5, justification: 'x', db: db(), repo: { async getVersionByVaultVersion() { return null; } } });
  assert.deepEqual(result.error, { code: 'VERSION_NOT_FOUND', status: 404 });
});
