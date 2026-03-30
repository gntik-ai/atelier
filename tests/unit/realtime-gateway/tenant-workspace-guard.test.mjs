import test from 'node:test';
import assert from 'node:assert/strict';
import { guardEvent } from '../../../services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs';

const sessionContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1'
};

test('guardEvent allows matching tenant and workspace', () => {
  assert.equal(guardEvent({ tenantId: 'tenant-1', workspaceId: 'workspace-1' }, sessionContext), true);
});

test('guardEvent rejects mismatched tenant', () => {
  assert.equal(guardEvent({ tenantId: 'tenant-2', workspaceId: 'workspace-1' }, sessionContext), false);
});

test('guardEvent rejects mismatched workspace', () => {
  assert.equal(guardEvent({ tenantId: 'tenant-1', workspaceId: 'workspace-2' }, sessionContext), false);
});

test('guardEvent rejects when both tenant and workspace mismatch', () => {
  assert.equal(guardEvent({ tenantId: 'tenant-2', workspaceId: 'workspace-2' }, sessionContext), false);
});
