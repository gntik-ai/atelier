import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/actions/secret-rotation-initiate.mjs';

test('integration: initiate rotation with repository stubs preserves active+grace contract', async () => {
  const state = { versions: [{ id: 'old', vault_version: 1, state: 'active' }], events: [] };
  const db = { async query() { return { rows: [] }; } };
  const repo = {
    async getActiveVersion() { return state.versions.find((row) => row.state === 'active') ?? null; },
    async getGraceVersion() { return state.versions.find((row) => row.state === 'grace') ?? null; },
    async expireGraceVersion(_, { id }) { const row = state.versions.find((item) => item.id === id); if (row) row.state = 'expired'; },
    async transitionToGrace() { state.versions[0].state = 'grace'; state.versions[0].grace_expires_at = '2026-03-31T00:10:00.000Z'; return state.versions[0]; },
    async insertSecretVersion() { const row = { id: 'new', vault_version: -1, state: 'active' }; state.versions.push(row); return row; },
    async updateSecretVersionVaultVersion(_, { id, vaultVersion }) { const row = state.versions.find((item) => item.id === id); row.vault_version = vaultVersion; return row; },
    async insertRotationEvent(_, record) { state.events.push(record); },
    async listConsumers() { return []; }
  };
  const result = await main({ auth: { sub: 'u1', roles: ['superadmin'] }, secretPath: 'platform/a', domain: 'platform', newValue: 'v', justification: 'rotate', db, repo, vaultClient: { async writeSecret() { return { data: { version: 2 } }; } } });
  assert.equal(result.vaultVersionNew, 2);
  assert.equal(state.versions.filter((row) => ['active', 'grace'].includes(row.state)).length, 2);
  assert.equal(state.events.length, 2);
});
