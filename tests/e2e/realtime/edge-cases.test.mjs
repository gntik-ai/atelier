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
const REPLAY_BUFFER_LIMIT = Number(process.env.REPLAY_BUFFER_LIMIT ?? 500);

async function setupHarness() {
  const provisioner = createProvisioner();
  const injector = createDataInjector();
  const tenant = await provisioner.createTestTenant(`ec-${Date.now()}`);
  const workspace = await provisioner.createTestWorkspace(tenant.tenantId);
  const channel = await provisioner.registerPgDataSource({ workspaceId: workspace.workspaceId, tables: ['e2e_edge'] });
  const user = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read'] });
  const tokens = await getToken({ username: user.username, password: user.password });
  const session = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: tokens.accessToken });
  return { provisioner, injector, tenant, workspace, channel, user, tokens, session };
}

async function cleanupHarness(ctx) {
  await teardown([
    () => ctx.session.disconnect(),
    () => ctx.injector.close(),
    () => ctx.provisioner.deprovisionWorkspace(ctx.workspace.workspaceId),
    () => ctx.provisioner.deprovisionTenant(ctx.tenant.tenantId),
    () => deleteTestUser(ctx.user.userId)
  ]);
}

test('TC-EC-01 Subscription on non-CDC-covered source is rejected', async () => {
  const ctx = await setupHarness();
  try {
    const response = await ctx.provisioner.createSubscription({ token: ctx.tokens.accessToken, workspaceId: ctx.workspace.workspaceId, channelId: ctx.channel.channelId, filter: { tables: ['not_captured_table'] } }).catch((error) => error);
    assert.ok(response instanceof Error || response?.status === 'no_cdc_coverage');
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-EC-02 Burst during disconnect signals buffer overflow', async () => {
  const ctx = await setupHarness();
  try {
    await ctx.session.subscribe({ workspaceId: ctx.workspace.workspaceId, channelId: ctx.channel.channelId, filter: { operations: ['INSERT'] } });
    ctx.session.disconnect();
    for (let index = 0; index < REPLAY_BUFFER_LIMIT + 25; index += 1) {
      await ctx.injector.pgInsert({ table: 'e2e_edge', row: { id: randomUUID(), label: `overflow-${index}` } });
    }
    await ctx.session.reconnect({ token: ctx.tokens.accessToken });
    await poll(() => {
      const overflowSignal = ctx.session.events.find((event) => event.truncated === true || event.type === 'BUFFER_OVERFLOW');
      assert.ok(overflowSignal);
      assert.ok(ctx.session.events.length <= REPLAY_BUFFER_LIMIT + 10);
    }, { maxWaitMs: 10_000, intervalMs: 200, backoffFactor: 1.3 });
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-EC-03 Overlapping filters, two subscribers: no cross-contamination', async () => {
  const ctx = await setupHarness();
  let session2;
  try {
    await ctx.session.subscribe({ workspaceId: ctx.workspace.workspaceId, channelId: ctx.channel.channelId, filter: { operations: ['INSERT'] } });
    session2 = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: ctx.tokens.accessToken });
    await session2.subscribe({ workspaceId: ctx.workspace.workspaceId, channelId: ctx.channel.channelId, filter: { operations: ['INSERT', 'UPDATE'] } });
    for (let index = 0; index < 10; index += 1) {
      const id = randomUUID();
      await ctx.injector.pgInsert({ table: 'e2e_edge', row: { id, label: `insert-${index}` } });
      await ctx.injector.pgUpdate({ table: 'e2e_edge', where: { id }, set: { label: `update-${index}` } });
    }
    await poll(() => {
      const s1Updates = ctx.session.events.filter((event) => event.op === 'UPDATE');
      const s2Inserts = session2.events.filter((event) => event.op === 'INSERT');
      const s2Updates = session2.events.filter((event) => event.op === 'UPDATE');
      assert.equal(s1Updates.length, 0);
      assert.ok(s2Inserts.length >= 10);
      assert.ok(s2Updates.length >= 10);
    }, { maxWaitMs: 10_000, intervalMs: 200, backoffFactor: 1.3 });
  } finally {
    await teardown([() => session2?.disconnect?.()]);
    await cleanupHarness(ctx);
  }
});

test('TC-EC-04 Pipeline degradation (Kafka mock unavailable) — conditional', { skip: process.env.SIMULATE_KAFKA_UNAVAILABLE !== 'true' }, async () => {
  const ctx = await setupHarness();
  try {
    await ctx.session.subscribe({ workspaceId: ctx.workspace.workspaceId, channelId: ctx.channel.channelId, filter: { operations: ['INSERT'] } });
    await poll(() => {
      const degraded = ctx.session.events.find((event) => event.type === 'PIPELINE_DEGRADED' || event.status === 'degraded');
      assert.ok(degraded);
    }, { maxWaitMs: 10_000, intervalMs: 200, backoffFactor: 1.2 });
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-EC-05 Tenant deprovisioned mid-session', async () => {
  const ctx = await setupHarness();
  try {
    await ctx.session.subscribe({ workspaceId: ctx.workspace.workspaceId, channelId: ctx.channel.channelId, filter: { operations: ['INSERT'] } });
    await ctx.provisioner.deprovisionTenant(ctx.tenant.tenantId);
    await poll(() => {
      const termination = ctx.session.events.find((event) => event.type === 'TENANT_DEPROVISIONED' || event.code === 'TENANT_DEPROVISIONED' || event.type === 'connection-closed');
      assert.ok(termination);
    }, { maxWaitMs: 15_000, intervalMs: 200, backoffFactor: 1.3 });
  } finally {
    await cleanupHarness(ctx);
  }
});
