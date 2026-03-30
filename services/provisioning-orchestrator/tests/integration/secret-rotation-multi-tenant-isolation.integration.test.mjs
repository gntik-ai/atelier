import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/actions/secret-rotation-initiate.mjs';

test('integration: tenant rotation does not affect another tenant state', async () => {
  const state = { tenantA: [{ id: 'a1', vault_version: 1, state: 'active' }], tenantB: [{ id: 'b1', vault_version: 7, state: 'active' }] };
  const db = { async query() { return { rows: [] }; } };
  await main({ auth: { sub: 'u1', roles: ['tenant-owner'], tenantId: 'tenant-a' }, secretPath: 'tenant/tenant-a/db-password', domain: 'tenant', tenantId: 'tenant-a', newValue: 'v', justification: 'rotate', db, repo: { async getActiveVersion(_, path) { return path.includes('tenant-a') ? state.tenantA[0] : state.tenantB[0]; }, async getGraceVersion() { return null; }, async transitionToGrace() { state.tenantA[0].state = 'grace'; return { grace_expires_at: '2026-03-31T00:10:00.000Z' }; }, async insertSecretVersion() { state.tenantA.push({ id: 'a2', state: 'active', vault_version: -1 }); return state.tenantA[1]; }, async updateSecretVersionVaultVersion(_, { id, vaultVersion }) { const row = state.tenantA.find((item) => item.id === id); row.vault_version = vaultVersion; return row; }, async insertRotationEvent() {}, async listConsumers() { return []; } }, vaultClient: { async writeSecret() { return { data: { version: 2 } }; } } });
  assert.equal(state.tenantB[0].state, 'active');
  assert.equal(state.tenantB[0].vault_version, 7);
});
