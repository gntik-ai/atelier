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

async function setupFixtures() {
  const provisioner = createProvisioner();
  const injector = createDataInjector();
  const tenant = await provisioner.createTestTenant(`ws-iso-${Date.now()}`);
  const workspace1 = await provisioner.createTestWorkspace(tenant.tenantId);
  const workspace2 = await provisioner.createTestWorkspace(tenant.tenantId);
  const channel1 = await provisioner.registerPgDataSource({ workspaceId: workspace1.workspaceId, tables: ['e2e_ws_iso'] });
  const channel2 = await provisioner.registerPgDataSource({ workspaceId: workspace2.workspaceId, tables: ['e2e_ws_iso'] });
  const user1 = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read', `workspace:${workspace1.workspaceId}`] });
  const user2 = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read', `workspace:${workspace2.workspaceId}`] });
  const token1 = await getToken({ username: user1.username, password: user1.password });
  const token2 = await getToken({ username: user2.username, password: user2.password });
  const session1 = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: token1.accessToken });
  const session2 = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: token2.accessToken });
  await session1.subscribe({ workspaceId: workspace1.workspaceId, channelId: channel1.channelId, filter: { operations: ['INSERT'] } });
  await session2.subscribe({ workspaceId: workspace2.workspaceId, channelId: channel2.channelId, filter: { operations: ['INSERT'] } });
  return { provisioner, injector, tenant, workspace1, workspace2, channel1, channel2, user1, user2, token1, token2, session1, session2 };
}

async function cleanupFixtures(ctx) {
  await teardown([
    () => ctx.session1.disconnect(),
    () => ctx.session2.disconnect(),
    () => ctx.injector.close(),
    () => ctx.provisioner.deprovisionWorkspace(ctx.workspace1.workspaceId),
    () => ctx.provisioner.deprovisionWorkspace(ctx.workspace2.workspaceId),
    () => ctx.provisioner.deprovisionTenant(ctx.tenant.tenantId),
    () => deleteTestUser(ctx.user1.userId),
    () => deleteTestUser(ctx.user2.userId)
  ]);
}

test('TC-WI-01 Cross-workspace event isolation: 50 events in W1, zero reach W2', async () => {
  const ctx = await setupFixtures();
  try {
    for (let index = 0; index < 50; index += 1) {
      await ctx.injector.pgInsert({ table: 'e2e_ws_iso', row: { id: randomUUID(), label: `w1-${index}` } });
    }
    await poll(() => {
      assert.ok(ctx.session1.events.length >= 50);
    }, { maxWaitMs: 15_000, intervalMs: 200, backoffFactor: 1.2 });
    assert.equal(ctx.session2.events.filter((event) => event.op === 'INSERT').length, 0);
  } finally {
    await cleanupFixtures(ctx);
  }
});

test('TC-WI-02 Adversarial cross-workspace subscription attempt rejected', async () => {
  const ctx = await setupFixtures();
  try {
    const response = await fetch(`${process.env.PROVISIONING_API_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.token1.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ workspaceId: ctx.workspace1.workspaceId, channelId: ctx.channel2.channelId, filter: { operations: ['INSERT'] } })
    });
    assert.equal(response.status, 403);
  } finally {
    await cleanupFixtures(ctx);
  }
});
