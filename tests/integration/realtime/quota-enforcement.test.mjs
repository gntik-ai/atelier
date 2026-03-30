import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotaRepository } from '../../../services/provisioning-orchestrator/src/repositories/realtime/QuotaRepository.mjs';

test('quota fallback and atomic insert behavior are enforced', async () => {
  const inserted = [];
  const db = { query: async (sql, params) => {
    if (sql.includes('SELECT workspace_id, max_subscriptions FROM subscription_quotas')) return { rows: [{ workspace_id: null, max_subscriptions: 2 }] };
    if (sql.includes('WITH current_count')) {
      if (inserted.length >= params[9]) return { rows: [] };
      const row = { id: `sub-${inserted.length + 1}`, tenant_id: params[0], workspace_id: params[1], channel_id: params[2], channel_type: params[3], owner_identity: params[4], event_filter: JSON.parse(params[6]), status: params[7], metadata: JSON.parse(params[8]) };
      inserted.push(row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const repo = new QuotaRepository(db, { platformDefault: 10, tenantDefault: 5 });
  assert.equal(await repo.findQuota('tenant-1', 'ws-1'), 2);
  assert.ok(await repo.atomicInsertWithQuotaCheck('tenant-1', 'ws-1', { channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'user-1' }));
  assert.ok(await repo.atomicInsertWithQuotaCheck('tenant-1', 'ws-1', { channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'user-1' }));
  assert.equal(await repo.atomicInsertWithQuotaCheck('tenant-1', 'ws-1', { channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'user-1' }), null);
});
