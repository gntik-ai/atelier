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
const timeoutMs = Number(process.env.SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS ?? 10_000);

function buildHarness() {
  const provisioner = createProvisioner();
  const injector = createDataInjector();
  const cleanup = [];

  return {
    async setup({ includeMongo = false } = {}) {
      const tenant = await provisioner.createTestTenant(`sl-${Date.now()}`);
      cleanup.push(() => provisioner.deprovisionTenant(tenant.tenantId));
      const workspace = await provisioner.createTestWorkspace(tenant.tenantId);
      cleanup.unshift(() => provisioner.deprovisionWorkspace(workspace.workspaceId));
      const pgChannel = await provisioner.registerPgDataSource({ workspaceId: workspace.workspaceId, tables: ['e2e_events'] });
      const mongoChannel = includeMongo
        ? await provisioner.registerMongoDataSource({ workspaceId: workspace.workspaceId, collections: ['e2e_docs'] })
        : null;
      const user = await createTestUser({ tenantId: tenant.tenantId, scopes: ['realtime:read'] });
      cleanup.push(() => deleteTestUser(user.userId));
      const tokens = await getToken({ username: user.username, password: user.password });
      const session = await createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: tokens.accessToken });
      cleanup.unshift(() => session.disconnect());
      return { provisioner, injector, tenant, workspace, pgChannel, mongoChannel, user, tokens, session };
    },
    async cleanup() {
      cleanup.push(() => injector.close());
      await teardown(cleanup);
    }
  };
}

test('TC-SL-01 PG INSERT event delivered', async () => {
  const harness = buildHarness();
  try {
    const { tenant, workspace, pgChannel, session, injector } = await harness.setup();
    await session.subscribe({ workspaceId: workspace.workspaceId, channelId: pgChannel.channelId, filter: { operations: ['INSERT'] } });
    const id = randomUUID();
    await injector.pgInsert({ table: 'e2e_events', row: { id, label: 'tc-sl-01' } });
    await poll(() => {
      const matches = session.events.filter((event) => event.op === 'INSERT' && event.table === 'e2e_events' && event.tenantId === tenant.tenantId && event.workspaceId === workspace.workspaceId);
      assert.equal(matches.length, 1);
    }, { maxWaitMs: timeoutMs, intervalMs: 200, backoffFactor: 1.5 });
  } finally {
    await harness.cleanup();
  }
});

test('TC-SL-02 MongoDB INSERT event delivered', async () => {
  const harness = buildHarness();
  try {
    const { workspace, tenant, mongoChannel, session, injector } = await harness.setup({ includeMongo: true });
    await session.subscribe({ workspaceId: workspace.workspaceId, channelId: mongoChannel.channelId, filter: { operations: ['INSERT'] } });
    await injector.mongoInsert({ db: workspace.workspaceId, collection: 'e2e_docs', doc: { _id: randomUUID(), label: 'tc-sl-02' } });
    await poll(() => {
      const match = session.events.find((event) => event.op === 'INSERT' && event.collection === 'e2e_docs' && event.tenantId === tenant.tenantId && event.workspaceId === workspace.workspaceId);
      assert.ok(match);
    }, { maxWaitMs: timeoutMs, intervalMs: 200, backoffFactor: 1.5 });
  } finally {
    await harness.cleanup();
  }
});

test('TC-SL-03 Subscription delete silences events', async () => {
  const harness = buildHarness();
  try {
    const { workspace, pgChannel, session, injector, provisioner } = await harness.setup();
    const { subscriptionId } = await session.subscribe({ workspaceId: workspace.workspaceId, channelId: pgChannel.channelId, filter: { operations: ['INSERT'] } });
    await injector.pgInsert({ table: 'e2e_events', row: { id: randomUUID(), label: 'before-delete' } });
    await session.waitForEvent((event) => event.op === 'INSERT' && event.label === 'before-delete', { maxWaitMs: timeoutMs, intervalMs: 200 });
    const baseline = session.events.length;
    await provisioner.deleteSubscription(subscriptionId);
    await injector.pgInsert({ table: 'e2e_events', row: { id: randomUUID(), label: 'after-delete' } });
    await poll(() => {
      assert.equal(session.events.length, baseline);
    }, { maxWaitMs: 5_000, intervalMs: 200, backoffFactor: 1.2 });
  } finally {
    await harness.cleanup();
  }
});

test('TC-SL-04 Filter UPDATE-only: no INSERT delivered, UPDATE delivered', async () => {
  const harness = buildHarness();
  try {
    const { workspace, pgChannel, session, injector } = await harness.setup();
    await session.subscribe({ workspaceId: workspace.workspaceId, channelId: pgChannel.channelId, filter: { operations: ['UPDATE'] } });
    const id = randomUUID();
    await injector.pgInsert({ table: 'e2e_events', row: { id, label: 'seed' } });
    await injector.pgUpdate({ table: 'e2e_events', where: { id }, set: { label: 'updated' } });
    await poll(() => {
      const updates = session.events.filter((event) => event.op === 'UPDATE');
      const inserts = session.events.filter((event) => event.op === 'INSERT');
      assert.equal(updates.length, 1);
      assert.equal(inserts.length, 0);
    }, { maxWaitMs: timeoutMs, intervalMs: 200, backoffFactor: 1.5 });
  } finally {
    await harness.cleanup();
  }
});
