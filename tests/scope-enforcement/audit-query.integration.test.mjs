import test from 'node:test';
import assert from 'node:assert/strict';
import { main as queryMain } from '../../services/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs';

const denials = [
  { id: '00000000-0000-0000-0000-000000000001', tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'user', denial_type: 'SCOPE_INSUFFICIENT', http_method: 'POST', request_path: '/v1/functions/1/deploy', correlation_id: 'corr-1', denied_at: '2026-03-31T10:00:00.000Z' },
  { id: '00000000-0000-0000-0000-000000000002', tenant_id: 'tenant-b', actor_id: 'actor-2', actor_type: 'user', denial_type: 'CONFIG_ERROR', http_method: 'GET', request_path: '/v1/workspaces/ws-2', correlation_id: 'corr-2', denied_at: '2026-03-31T09:00:00.000Z' }
];

function buildDb(rows = denials) {
  return {
    async query(sql, params) {
      const tenantId = sql.includes('tenant_id = $3') ? params[2] : null;
      const filtered = rows.filter((row) => !tenantId || row.tenant_id === tenantId);
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: filtered.length }] };
      }
      return { rows: filtered };
    }
  };
}

test('superadmin gets all tenants', async () => {
  const result = await queryMain({ from: '2026-03-30T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z', callerContext: { actor: { type: 'platform_admin' } } }, { db: buildDb() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.denials.length, 2);
});

test('tenant-owner gets only their tenant denials', async () => {
  const result = await queryMain({ from: '2026-03-30T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z', callerContext: { actor: { type: 'tenant_owner' }, tenantId: 'tenant-a' } }, { db: buildDb() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.denials.length, 1);
  assert.equal(result.body.denials[0].tenant_id, 'tenant-a');
});

test('window > 30 days returns 400', async () => {
  const result = await queryMain({ from: '2026-01-01T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z', callerContext: { actor: { type: 'platform_admin' } } }, { db: buildDb() });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'QUERY_WINDOW_EXCEEDED');
});

test('missing from/to returns 400', async () => {
  const result = await queryMain({ callerContext: { actor: { type: 'platform_admin' } } }, { db: buildDb() });
  assert.equal(result.statusCode, 400);
});
