import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actions/secret-rotation-initiate.mjs';

function makeDb() {
  return { calls: [], async query(sql) { this.calls.push(sql); return { rows: [] }; } };
}

test('secret-rotation-initiate happy path', async () => {
  const db = makeDb();
  const events = [];
  const result = await main({
    auth: { sub: 'user:1', roles: ['superadmin'] },
    secretPath: 'platform/postgresql/app-password',
    domain: 'platform',
    tenantId: null,
    newValue: 'ciphertext',
    justification: 'rotate',
    db,
    repo: {
      async getActiveVersion() { return { id: 'v1', vault_version: 1 }; },
      async getGraceVersion() { return null; },
      async expireGraceVersion() {},
      async transitionToGrace() { return { grace_expires_at: '2026-03-31T00:00:00.000Z' }; },
      async insertSecretVersion() { return { id: 'row-1' }; },
      async insertRotationEvent() {},
      async updateSecretVersionVaultVersion() { return { id: 'row-1', vault_version: 2 }; },
      async listConsumers() { return [{ consumer_id: 'apisix', reload_mechanism: 'eso_annotation', eso_external_secret_name: 'es-1', consumer_namespace: 'ns-1' }]; },
      async insertPropagationEvent() { return { requested_at: '2026-03-31T00:00:00.000Z' }; }
    },
    vaultClient: { async writeSecret() { return { data: { version: 2 } }; } },
    publishEvent: async (name, payload) => events.push([name, payload]),
    triggerEsoRefresh: async () => {}
  });
  assert.equal(result.vaultVersionNew, 2);
  assert.equal(events.length, 3);
});

test('secret-rotation-initiate rejects invalid grace period', async () => {
  const result = await main({ auth: { sub: 'u', roles: ['superadmin'] }, secretPath: 'platform/x', domain: 'platform', newValue: 'v', gracePeriodSeconds: 10, db: makeDb() });
  assert.equal(result.error.code, 'INVALID_GRACE_PERIOD');
});

test('secret-rotation-initiate rejects missing role', async () => {
  const result = await main({ auth: { sub: 'u', roles: [] }, secretPath: 'platform/x', domain: 'platform', newValue: 'v', db: makeDb() });
  assert.equal(result.error.code, 'FORBIDDEN');
});

test('secret-rotation-initiate returns vault error and rolls back', async () => {
  const db = makeDb();
  const result = await main({
    auth: { sub: 'user:1', roles: ['superadmin'] },
    secretPath: 'platform/postgresql/app-password',
    domain: 'platform',
    newValue: 'ciphertext',
    db,
    repo: {
      async getActiveVersion() { return { id: 'v1', vault_version: 1 }; },
      async getGraceVersion() { return null; },
      async transitionToGrace() { return { grace_expires_at: 'x' }; },
      async insertSecretVersion() { return { id: 'row-1' }; },
      async insertRotationEvent() {},
      async updateSecretVersionVaultVersion() { throw new Error('should not happen'); }
    },
    vaultClient: { async writeSecret() { throw new Error('vault down'); } }
  });
  assert.equal(result.error.code, 'VAULT_WRITE_FAILED');
  assert.ok(db.calls.includes('ROLLBACK'));
});
