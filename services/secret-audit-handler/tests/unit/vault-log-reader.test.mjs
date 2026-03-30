import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVaultEntry } from '../../src/vault-log-reader.mjs';

test('parseVaultEntry maps successful read event', () => {
  const event = parseVaultEntry(JSON.stringify({
    time: '2026-03-30T00:00:00.000Z',
    auth: {
      display_name: 'provisioning-orchestrator',
      metadata: { service_account_namespace: 'orchestrator', service_account_name: 'provisioning-orchestrator-sa' }
    },
    request: { id: 'req-1', path: 'secret/data/platform/postgresql/app-password', operation: 'read' }
  }));
  assert.equal(event.operation, 'read');
  assert.equal(event.domain, 'platform');
  assert.equal(event.secretName, 'app-password');
});

test('parseVaultEntry maps denied entries', () => {
  const event = parseVaultEntry(JSON.stringify({
    error: 'permission denied',
    request: { id: 'req-2', path: 'secret/data/platform/postgresql/app-password', operation: 'read' },
    auth: { metadata: {} }
  }));
  assert.equal(event.operation, 'denied');
  assert.equal(event.result, 'denied');
});
