import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRealtimeSubscriptions } from '../../../services/provisioning-orchestrator/src/actions/realtime/realtime-subscription-resolver.mjs';

test('resolver matches by workspace, channel and filter semantics', async () => {
  const rows = [
    { id: 'sub-1', tenant_id: 'tenant-1', workspace_id: 'ws-1', channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'u1', event_filter: null, status: 'active', metadata: null },
    { id: 'sub-2', tenant_id: 'tenant-1', workspace_id: 'ws-1', channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'u2', event_filter: { table_name: 'orders', operations: ['INSERT'] }, status: 'active', metadata: null },
    { id: 'sub-3', tenant_id: 'tenant-1', workspace_id: 'ws-1', channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'u3', event_filter: { table_name: 'users' }, status: 'active', metadata: null },
    { id: 'sub-4', tenant_id: 'tenant-1', workspace_id: 'ws-1', channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'u4', event_filter: null, status: 'suspended', metadata: null },
    { id: 'sub-5', tenant_id: 'tenant-1', workspace_id: 'ws-2', channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'u5', event_filter: null, status: 'active', metadata: null }
  ];
  const db = { query: async (sql, params) => {
    if (sql.includes('SELECT * FROM realtime_subscriptions WHERE tenant_id = $1 AND workspace_id = $2 AND status !=')) {
      return { rows: rows.filter((row) => row.tenant_id === params[0] && row.workspace_id === params[1] && row.status !== 'deleted' && row.status === params[2]) };
    }
    if (sql.includes('SELECT COUNT(*)::int AS total FROM realtime_subscriptions')) {
      return { rows: [{ total: rows.filter((row) => row.tenant_id === params[0] && row.workspace_id === params[1] && row.status === params[2]).length }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const result = await resolveRealtimeSubscriptions({ tenantId: 'tenant-1', workspaceId: 'ws-1', channelType: 'postgresql-changes', operation: 'INSERT', tableName: 'orders' }, { db });
  assert.deepEqual(result.body.items.map((item) => item.id), ['sub-1', 'sub-2']);
});
