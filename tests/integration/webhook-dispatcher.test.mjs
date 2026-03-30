import test from 'node:test';
import assert from 'node:assert/strict';
import { main as dispatcherMain } from '../../services/webhook-engine/actions/webhook-dispatcher.mjs';

function makeDb() {
  const subscriptions = [
    { id: 's1', tenant_id: 't1', workspace_id: 'w1', event_types: ['document.created'], status: 'active' },
    { id: 's2', tenant_id: 't1', workspace_id: 'w1', event_types: ['document.created'], status: 'paused' },
    { id: 's3', tenant_id: 't1', workspace_id: 'w2', event_types: ['document.created'], status: 'active' }
  ];
  const deliveries = new Map();
  const counters = new Map();
  return {
    deliveries,
    async findSubscriptionsForEvent(tenantId, workspaceId, eventType) {
      return subscriptions.filter((row) => row.tenant_id === tenantId && row.workspace_id === workspaceId && row.status === 'active' && row.event_types.includes(eventType));
    },
    async incrementRateCounter(workspaceId) {
      const count = (counters.get(workspaceId) ?? 0) + 1;
      counters.set(workspaceId, count);
      return { count };
    },
    async insertDelivery(row) {
      const key = `${row.subscription_id}:${row.event_id}`;
      if ([...deliveries.values()].some((existing) => `${existing.subscription_id}:${existing.event_id}` === key)) return false;
      deliveries.set(row.id, row);
      return true;
    }
  };
}

test('dispatcher fans out within workspace, deduplicates, and respects rate limit', async () => {
  const db = makeDb();
  const invoked = [];
  const invoker = { invoke: async (name, payload) => invoked.push({ name, payload }) };
  const env = { WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE: '1', WEBHOOK_MAX_RETRY_ATTEMPTS: '5' };
  const first = await dispatcherMain({ db, invoker, env, event: { tenantId: 't1', workspaceId: 'w1', eventType: 'document.created', eventId: 'e1', data: {} } });
  assert.equal(first.queued, 1);
  const duplicate = await dispatcherMain({ db, invoker, env, event: { tenantId: 't1', workspaceId: 'w1', eventType: 'document.created', eventId: 'e1', data: {} } });
  assert.equal(duplicate.queued, 0);
  const isolated = await dispatcherMain({ db, invoker, env, event: { tenantId: 'other-tenant', workspaceId: 'w2', eventType: 'document.created', eventId: 'e2', data: {} } });
  assert.equal(isolated.queued, 0);
  assert.equal(invoked.length, 1);
});
