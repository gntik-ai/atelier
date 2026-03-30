import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRealtimeClient } from './helpers/client.mjs';
import { createProvisioner } from './helpers/provisioner.mjs';
import { createDataInjector } from './helpers/data-injector.mjs';
import { createTestUser, deleteTestUser, getToken } from './helpers/iam.mjs';
import { poll } from './helpers/poller.mjs';
import { teardown } from './helpers/teardown.mjs';

const REALTIME_ENDPOINT = process.env.REALTIME_ENDPOINT;

async function setupTenant(label) {
  const provisioner = createProvisioner();
  const injector = createDataInjector();
  const tenant = await provisioner.createTestTenant(label);
  const workspace = await provisioner.createTestWorkspace(tenant.tenantId);
  const channel = await provisioner.registerPgDataSource({ workspaceId: workspace.workspaceId, tables: ['e2e_iso'] });
  const user = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read'] });
  const tokens = await getToken({ username: user.username, password: user.password });
  const session = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: tokens.accessToken });
  await session.subscribe({ workspaceId: workspace.workspaceId, channelId: channel.channelId, filter: { operations: ['INSERT'] } });
  return { provisioner, injector, tenant, workspace, channel, user, tokens, session };
}

async function cleanupTenant(fixture) {
  await teardown([
    () => fixture.session.disconnect(),
    () => fixture.injector.close(),
    () => fixture.provisioner.deprovisionWorkspace(fixture.workspace.workspaceId),
    () => fixture.provisioner.deprovisionTenant(fixture.tenant.tenantId),
    () => deleteTestUser(fixture.user.userId)
  ]);
}

test('TC-TI-01 Cross-tenant event isolation: 100 events in tenant A, zero reach tenant B', async () => {
  const a = await setupTenant(`tenant-a-${Date.now()}`);
  const b = await setupTenant(`tenant-b-${Date.now()}`);
  try {
    for (let index = 0; index < 100; index += 1) {
      await a.injector.pgInsert({ table: 'e2e_iso', row: { id: randomUUID(), label: `a-${index}` } });
    }
    await poll(() => {
      assert.ok(a.session.events.length >= 100, `tenant A only received ${a.session.events.length}`);
    }, { maxWaitMs: 20_000, intervalMs: 200, backoffFactor: 1.2 });
    assert.equal(b.session.events.filter((event) => event.op === 'INSERT').length, 0);
  } finally {
    await cleanupTenant(a);
    await cleanupTenant(b);
  }
});

test('TC-TI-02 Adversarial cross-tenant subscription attempt rejected', async () => {
  const a = await setupTenant(`tenant-a-${Date.now()}`);
  const b = await setupTenant(`tenant-b-${Date.now()}`);
  try {
    const response = await fetch(`${process.env.PROVISIONING_API_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${b.tokens.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ workspaceId: b.workspace.workspaceId, channelId: a.channel.channelId, filter: { operations: ['INSERT'] } })
    });
    assert.ok([403, 404].includes(response.status), `unexpected status ${response.status}`);
  } finally {
    await cleanupTenant(a);
    await cleanupTenant(b);
  }
});

test('TC-TI-03 Identical source names: each tenant receives only their own events', async () => {
  const a = await setupTenant(`tenant-a-${Date.now()}`);
  const b = await setupTenant(`tenant-b-${Date.now()}`);
  try {
    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) => a.injector.pgInsert({ table: 'e2e_iso', row: { id: randomUUID(), label: `a-${index}` } })),
      ...Array.from({ length: 20 }, (_, index) => b.injector.pgInsert({ table: 'e2e_iso', row: { id: randomUUID(), label: `b-${index}` } }))
    ]);
    await poll(() => {
      assert.ok(a.session.events.length >= 20);
      assert.ok(b.session.events.length >= 20);
    }, { maxWaitMs: 15_000, intervalMs: 200, backoffFactor: 1.2 });
    assert.ok(a.session.events.every((event) => event.tenantId === a.tenant.tenantId && event.workspaceId === a.workspace.workspaceId));
    assert.ok(b.session.events.every((event) => event.tenantId === b.tenant.tenantId && event.workspaceId === b.workspace.workspaceId));
  } finally {
    await cleanupTenant(a);
    await cleanupTenant(b);
  }
});
