import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRealtimeSubscriptionCrud } from '../../../services/provisioning-orchestrator/src/actions/realtime/realtime-subscription-crud.mjs';

function createDeps() {
  const channels = [{ id: 'ch-1', tenant_id: 'tenant-1', workspace_id: 'ws-1', channel_type: 'postgresql-changes', data_source_kind: 'postgresql', data_source_ref: 'mydb', status: 'available' }];
  const subscriptions = [];
  const audits = [];
  const sent = [];
  const db = { query: async (sql, params) => {
    if (sql.includes('FROM realtime_channels')) {
      const row = channels.find((c) => c.tenant_id === params[0] && c.workspace_id === params[1] && c.channel_type === params[2] && c.data_source_ref === params[3]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO realtime_subscriptions') && sql.includes('WITH current_count')) {
      const count = subscriptions.filter((s) => s.tenant_id === params[0] && s.workspace_id === params[1] && s.status !== 'deleted').length;
      if (count >= params[9]) return { rows: [] };
      const row = { id: `sub-${subscriptions.length + 1}`, tenant_id: params[0], workspace_id: params[1], channel_id: params[2], channel_type: params[3], owner_identity: params[4], owner_client_id: params[5], event_filter: JSON.parse(params[6]), status: params[7], metadata: JSON.parse(params[8]), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null };
      subscriptions.push(row); return { rows: [row] };
    }
    if (sql.includes('SELECT workspace_id, max_subscriptions FROM subscription_quotas')) return { rows: [] };
    if (sql.includes('SELECT * FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3')) {
      const row = subscriptions.find((s) => s.tenant_id === params[0] && s.workspace_id === params[1] && s.id === params[2] && s.status !== 'deleted');
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('SELECT * FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND status !=')) {
      const rows = subscriptions.filter((s) => s.tenant_id === params[0] && s.workspace_id === params[1] && s.status !== 'deleted' && (!params[2] || s.status === params[2]));
      return { rows };
    }
    if (sql.includes('SELECT COUNT(*)::int AS total FROM realtime_subscriptions')) {
      return { rows: [{ total: subscriptions.filter((s) => s.tenant_id === params[0] && s.workspace_id === params[1] && s.status !== 'deleted' && (!params[2] || s.status === params[2])).length }] };
    }
    if (sql.includes('UPDATE realtime_subscriptions SET')) {
      const row = subscriptions.find((s) => s.tenant_id === params[0] && s.workspace_id === params[1] && s.id === params[2]);
      if (!row) return { rows: [] };
      if (sql.includes('status = $4')) row.status = params[3];
      if (sql.includes('event_filter = $5::jsonb')) row.event_filter = JSON.parse(params[4]);
      if (sql.includes('metadata = $6::jsonb')) row.metadata = JSON.parse(params[5]);
      if (sql.includes('deleted_at = $7')) row.deleted_at = params[6];
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO subscription_audit_log')) { const row = { action: params[4], before_state: JSON.parse(params[5]), after_state: JSON.parse(params[6]) }; audits.push(row); return { rows: [row] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const producer = { send: async (payload) => sent.push(payload) };
  return { db, producer, channels, subscriptions, audits, sent };
}

test('create, list, get, suspend, reactivate and delete lifecycle works', async () => {
  const deps = createDeps();
  const create = await handleRealtimeSubscriptionCrud({ method: 'POST', tenantId: 'tenant-1', workspaceId: 'ws-1', actorIdentity: 'user-1', channel_type: 'postgresql-changes', data_source_ref: 'mydb', event_filter: { table_name: 'orders', operations: ['INSERT'] } }, deps);
  assert.equal(create.statusCode, 201);
  const list = await handleRealtimeSubscriptionCrud({ method: 'GET', tenantId: 'tenant-1', workspaceId: 'ws-1' }, deps);
  assert.equal(list.body.total, 1);
  const get = await handleRealtimeSubscriptionCrud({ method: 'GET', tenantId: 'tenant-1', workspaceId: 'ws-1', subscriptionId: create.body.id }, deps);
  assert.equal(get.body.id, create.body.id);
  const suspend = await handleRealtimeSubscriptionCrud({ method: 'PATCH', tenantId: 'tenant-1', workspaceId: 'ws-1', subscriptionId: create.body.id, status: 'suspended' }, deps);
  assert.equal(suspend.body.status, 'suspended');
  const reactivate = await handleRealtimeSubscriptionCrud({ method: 'PATCH', tenantId: 'tenant-1', workspaceId: 'ws-1', subscriptionId: create.body.id, status: 'active' }, deps);
  assert.equal(reactivate.body.status, 'active');
  const remove = await handleRealtimeSubscriptionCrud({ method: 'DELETE', tenantId: 'tenant-1', workspaceId: 'ws-1', subscriptionId: create.body.id }, deps);
  assert.equal(remove.statusCode, 204);
  const missing = await handleRealtimeSubscriptionCrud({ method: 'GET', tenantId: 'tenant-1', workspaceId: 'ws-1', subscriptionId: create.body.id }, deps);
  assert.equal(missing.statusCode, 404);
  assert.equal(deps.audits.length, 4);
});

test('invalid channel and invalid event filter return 400', async () => {
  const deps = createDeps();
  const badChannel = await handleRealtimeSubscriptionCrud({ method: 'POST', tenantId: 'tenant-1', workspaceId: 'ws-1', actorIdentity: 'user-1', channel_type: 'mongodb-changes', data_source_ref: 'mydb' }, deps);
  assert.equal(badChannel.statusCode, 400);
  const badFilter = await handleRealtimeSubscriptionCrud({ method: 'POST', tenantId: 'tenant-1', workspaceId: 'ws-1', actorIdentity: 'user-1', channel_type: 'postgresql-changes', data_source_ref: 'mydb', event_filter: { invalid: true } }, deps);
  assert.equal(badFilter.statusCode, 400);
});
