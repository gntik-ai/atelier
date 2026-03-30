import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRealtimeClient } from './helpers/client.mjs';
import { createProvisioner } from './helpers/provisioner.mjs';
import { createDataInjector } from './helpers/data-injector.mjs';
import { createKafkaConsumer } from './helpers/kafka-consumer.mjs';
import { createTestUser, deleteTestUser, getToken, revokeScope } from './helpers/iam.mjs';
import { poll } from './helpers/poller.mjs';
import { teardown } from './helpers/teardown.mjs';

const REALTIME_ENDPOINT = process.env.REALTIME_ENDPOINT;

async function setupHarness() {
  const provisioner = createProvisioner();
  const injector = createDataInjector();
  const tenant = await provisioner.createTestTenant(`sr-${Date.now()}`);
  const workspace = await provisioner.createTestWorkspace(tenant.tenantId);
  const channel = await provisioner.registerPgDataSource({ workspaceId: workspace.workspaceId, tables: ['e2e_scope'] });
  const user = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read'] });
  const tokens = await getToken({ username: user.username, password: user.password });
  const session = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: tokens.accessToken });
  const { subscriptionId } = await session.subscribe({ workspaceId: workspace.workspaceId, channelId: channel.channelId, filter: { operations: ['INSERT'] } });
  await injector.pgInsert({ table: 'e2e_scope', row: { id: randomUUID(), label: 'warmup' } });
  await session.waitForEvent((event) => event.op === 'INSERT', { maxWaitMs: 10_000, intervalMs: 200 });
  return { provisioner, injector, tenant, workspace, user, tokens, session, subscriptionId };
}

async function cleanupHarness(ctx, kafka) {
  await teardown([
    () => kafka?.close?.(),
    () => ctx.session.disconnect(),
    () => ctx.injector.close(),
    () => ctx.provisioner.deleteSubscription(ctx.subscriptionId),
    () => ctx.provisioner.deprovisionWorkspace(ctx.workspace.workspaceId),
    () => ctx.provisioner.deprovisionTenant(ctx.tenant.tenantId),
    () => deleteTestUser(ctx.user.userId)
  ]);
}

test('TC-SR-01 Scope revocation stops delivery within 30 seconds', async () => {
  const ctx = await setupHarness();
  try {
    const revokeTimestamp = Date.now();
    await revokeScope({ userId: ctx.user.userId, scope: 'realtime:read' });
    for (let index = 0; index < 18; index += 1) {
      await ctx.injector.pgInsert({ table: 'e2e_scope', row: { id: randomUUID(), label: `revocation-${index}` } });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    await poll(() => {
      const lateEvents = ctx.session.events.filter((event) => event.op === 'INSERT' && event.receivedAt > revokeTimestamp + 30_000);
      assert.equal(lateEvents.length, 0);
    }, { maxWaitMs: 35_000, intervalMs: 1_000, backoffFactor: 1.2 });
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-SR-02 Revoked subscriber cannot create new subscription', async () => {
  const ctx = await setupHarness();
  try {
    await revokeScope({ userId: ctx.user.userId, scope: 'realtime:read' });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`${process.env.PROVISIONING_API_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.tokens.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ workspaceId: ctx.workspace.workspaceId, channelId: 'any-channel', filter: { operations: ['INSERT'] } })
    });
    assert.equal(response.status, 403);
  } finally {
    await cleanupHarness(ctx);
  }
});

test('TC-SR-03 Audit event recorded for scope-revoked suspension', async () => {
  const ctx = await setupHarness();
  let kafka;
  try {
    kafka = await createKafkaConsumer({ topic: 'console.realtime.auth-decisions' });
    await revokeScope({ userId: ctx.user.userId, scope: 'realtime:read' });
    const message = await kafka.waitForMessage((candidate) => candidate.event_type === 'SUBSCRIPTION_SUSPENDED' && candidate.reason === 'scope_revoked' && candidate.tenantId === ctx.tenant.tenantId && candidate.subscriptionId === ctx.subscriptionId, { maxWaitMs: 35_000, intervalMs: 2_000, backoffFactor: 1.2 });
    assert.equal(message.reason, 'scope_revoked');
  } finally {
    await cleanupHarness(ctx, kafka);
  }
});
