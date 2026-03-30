import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRealtimeClient } from './helpers/client.mjs';
import { createProvisioner } from './helpers/provisioner.mjs';
import { createDataInjector } from './helpers/data-injector.mjs';
import { createTestUser, deleteTestUser, getToken, refreshToken, revokeUserSessions } from './helpers/iam.mjs';
import { poll } from './helpers/poller.mjs';
import { teardown } from './helpers/teardown.mjs';

const REALTIME_ENDPOINT = process.env.REALTIME_ENDPOINT;
const RECONNECTION_WINDOW_SECONDS = Number(process.env.RECONNECTION_WINDOW_SECONDS ?? 60);
const TOKEN_SHORT_TTL_SECONDS = Number(process.env.TOKEN_SHORT_TTL_SECONDS ?? 5);

async function setupHarness() {
  const provisioner = createProvisioner();
  const injector = createDataInjector();
  const tenant = await provisioner.createTestTenant(`rc-${Date.now()}`);
  const workspace = await provisioner.createTestWorkspace(tenant.tenantId);
  const channel = await provisioner.registerPgDataSource({ workspaceId: workspace.workspaceId, tables: ['e2e_reconnect'] });
  const user = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read'] });
  const tokens = await getToken({ username: user.username, password: user.password });
  const session = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: tokens.accessToken });
  const { subscriptionId } = await session.subscribe({ workspaceId: workspace.workspaceId, channelId: channel.channelId, filter: { operations: ['INSERT'] } });
  return { provisioner, injector, tenant, workspace, channel, user, tokens, session, subscriptionId };
}

async function cleanupHarness(ctx) {
  await teardown([
    () => ctx.session.disconnect(),
    () => ctx.injector.close(),
    () => ctx.provisioner.deleteSubscription(ctx.subscriptionId),
    () => ctx.provisioner.deprovisionWorkspace(ctx.workspace.workspaceId),
    () => ctx.provisioner.deprovisionTenant(ctx.tenant.tenantId),
    () => deleteTestUser(ctx.user.userId)
  ]);
}

test('TC-RC-01 Drop + reconnect within window: at-least-once delivery', async () => {
  const ctx = await setupHarness();
  try {
    const eventA = randomUUID();
    const eventB = randomUUID();
    await ctx.injector.pgInsert({ table: 'e2e_reconnect', row: { id: eventA, label: 'A' } });
    await ctx.session.waitForEvent((event) => event.op === 'INSERT', { maxWaitMs: 10_000, intervalMs: 200 });
    ctx.session.disconnect();
    await ctx.injector.pgInsert({ table: 'e2e_reconnect', row: { id: eventB, label: 'B' } });
    const fresh = await refreshToken({ refreshToken: ctx.tokens.refreshToken });
    const reconnectStartMs = Date.now();
    await ctx.session.reconnect({ token: fresh.accessToken });
    assert.ok(Date.now() - reconnectStartMs < 5_000);
    await poll(() => {
      const resumed = ctx.session.events.find((event) => event.op === 'INSERT' && (event.id === eventB || event.payload?.id === eventB));
      assert.ok(resumed);
    }, { maxWaitMs: 5_000, intervalMs: 200, backoffFactor: 1.3 });
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-RC-02 Token refresh mid-session: no delivery gap', async () => {
  const ctx = await setupHarness();
  try {
    for (let index = 0; index < 5; index += 1) {
      await ctx.injector.pgInsert({ table: 'e2e_reconnect', row: { id: randomUUID(), label: `pre-${index}` } });
    }
    await poll(() => assert.ok(ctx.session.events.filter((event) => event.op === 'INSERT').length >= 5), { maxWaitMs: 10_000, intervalMs: 200 });
    const refreshed = await refreshToken({ refreshToken: ctx.tokens.refreshToken });
    await ctx.session.refreshToken(refreshed.accessToken);
    for (let index = 0; index < 5; index += 1) {
      await ctx.injector.pgInsert({ table: 'e2e_reconnect', row: { id: randomUUID(), label: `post-${index}` } });
    }
    await poll(() => {
      const inserts = ctx.session.events.filter((event) => event.op === 'INSERT');
      assert.ok(inserts.length >= 10);
      for (let index = 1; index < inserts.length; index += 1) {
        assert.ok(inserts[index].receivedAt - inserts[index - 1].receivedAt < 500);
      }
    }, { maxWaitMs: 10_000, intervalMs: 200, backoffFactor: 1.2 });
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-RC-03 Reconnect with expired token: rejected', async () => {
  const ctx = await setupHarness();
  try {
    const shortLived = await getToken({ username: ctx.user.username, password: ctx.user.password, scope: `ttl:${TOKEN_SHORT_TTL_SECONDS}` });
    ctx.session.disconnect();
    await new Promise((resolve) => setTimeout(resolve, TOKEN_SHORT_TTL_SECONDS * 1000 + 500));
    await assert.rejects(() => ctx.session.reconnect({ token: shortLived.accessToken }));
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-RC-04 Reconnect with revoked token: rejected', async () => {
  const ctx = await setupHarness();
  try {
    ctx.session.disconnect();
    await revokeUserSessions(ctx.user.userId);
    await assert.rejects(() => ctx.session.reconnect({ token: ctx.tokens.accessToken }));
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-RC-05 Reconnection-window exceeded: subscription suspended', async () => {
  const ctx = await setupHarness();
  try {
    ctx.session.disconnect();
    await new Promise((resolve) => setTimeout(resolve, (RECONNECTION_WINDOW_SECONDS + 5) * 1000));
    try {
      await ctx.session.reconnect({ token: ctx.tokens.accessToken });
    } catch {}
    const status = await ctx.provisioner.getSubscription(ctx.subscriptionId);
    assert.ok(status?.status === 'suspended' || status?.error === 'SUBSCRIPTION_SUSPENDED');
  } finally {
    await cleanupHarness(ctx);
  }
});
