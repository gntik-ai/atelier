import test from 'node:test';
import assert from 'node:assert/strict';
import { main as initiate } from '../../src/actions/secret-rotation-initiate.mjs';
import { main as ack } from '../../src/actions/secret-consumer-ack.mjs';

test('integration: consumer ack confirms pending propagation', async () => {
  const state = { pending: [{ consumer_id: 'apisix' }], events: 0 };
  const db = { async query() { return { rows: [] }; } };
  await initiate({ auth: { sub: 'u1', roles: ['superadmin'] }, secretPath: 'platform/a', domain: 'platform', newValue: 'v', justification: 'rotate', db, repo: { async getActiveVersion() { return { id: '1', vault_version: 1 }; }, async getGraceVersion() { return null; }, async transitionToGrace() { return { grace_expires_at: '2026-03-31T00:10:00.000Z' }; }, async insertSecretVersion() { return { id: '2' }; }, async updateSecretVersionVaultVersion() { return { id: '2', vault_version: 2 }; }, async insertRotationEvent() {}, async listConsumers() { return [{ consumer_id: 'apisix', reload_mechanism: 'api_reload', consumer_namespace: 'ns' }]; }, async insertPropagationEvent() { return { requested_at: '2026-03-31T00:00:00.000Z' }; } }, vaultClient: { async writeSecret() { return { data: { version: 2 } }; } }, publishEvent: async () => {} });
  const result = await ack({ db, consumerId: 'apisix', secretPath: 'platform/a', vaultVersion: 2, repo: { async listPendingPropagations() { return state.pending; }, async confirmPropagation() { state.pending = []; }, async getVersionByVaultVersion() { return { domain: 'platform', tenant_id: null }; }, async insertRotationEvent() { state.events += 1; } }, publishEvent: async () => {} });
  assert.deepEqual(result, { ack: true });
  assert.equal(state.events, 1);
});
