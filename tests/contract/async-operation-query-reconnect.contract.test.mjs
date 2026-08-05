import test from 'node:test'
import assert from 'node:assert/strict'
import { main as handler } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs'

const headers = {
  'x-auth-subject': 'reader-a',
  'x-actor-type': 'tenant_owner',
  'x-tenant-id': 'tenant-a',
  'x-workspace-id': 'workspace-a',
  'x-correlation-id': 'corr-c13'
}
const params = (overrides = {}) => ({
  __ow_headers: headers,
  queryType: 'list',
  filters: { status: ['pending', 'running', 'cancelling'], tenantId: 'tenant-a', workspaceId: 'workspace-a', operationType: 'workspace.create' },
  pagination: { limit: 10, offset: 0 },
  ...overrides
})
const rows = [
  { operation_id: 'op-1', status: 'running', operation_type: 'workspace.create', tenant_id: 'tenant-a', workspace_id: 'workspace-a', actor_id: 'actor-1', actor_type: 'tenant_owner', created_at: '2026-01-01', updated_at: '2026-01-01', correlation_id: 'c1' },
  { operation_id: 'op-2', status: 'pending', operation_type: 'workspace.create', tenant_id: 'tenant-a', workspace_id: 'workspace-a', actor_id: 'actor-2', actor_type: 'tenant_owner', created_at: '2026-01-02', updated_at: '2026-01-02', correlation_id: 'c2' },
  { operation_id: 'op-3', status: 'cancelling', operation_type: 'workspace.create', tenant_id: 'tenant-a', workspace_id: 'workspace-a', actor_id: 'actor-3', actor_type: 'tenant_owner', created_at: '2026-01-03', updated_at: '2026-01-03', correlation_id: 'c3' }
]
function deps(items = rows, calls = []) {
  return {
    listOperations: async (_db, query) => { calls.push(query); return { items, total: items.length, pagination: { limit: query.limit, offset: query.offset, hasMore: false } } },
    publishAuditEvent: async () => { calls.push('audit') },
    log: () => calls.push('log')
  }
}

test('C-13 contract returns ordered multi-status list with tenant/workspace/type AND filters', async () => {
  const calls = []
  const result = await handler(params(), deps(rows, calls))
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.body.items.map((item) => item.operationId), ['op-1', 'op-2', 'op-3'])
  assert.equal(result.body.total, 3)
  assert.deepEqual(calls[0], { tenant_id: 'tenant-a', status: ['pending', 'running', 'cancelling'], operationType: 'workspace.create', workspaceId: 'workspace-a', limit: 10, offset: 0, isSuperadmin: false })
  assert.deepEqual(calls.slice(1), ['audit', 'log'])
})

test('C-13 contract handles scalar and empty status filters without unauthorized short-circuit', async () => {
  const scalarCalls = []; const scalar = await handler(params({ filters: { status: 'running', tenantId: 'tenant-a' } }), deps(rows.slice(0, 1), scalarCalls))
  assert.equal(scalar.statusCode, 200); assert.equal(scalar.body.items.length, 1)
  const empty = await handler(params({ filters: { status: [], tenantId: 'tenant-a' } }), deps([], []))
  assert.equal(empty.statusCode, 200); assert.deepEqual(empty.body.items, []); assert.equal(empty.body.total, 0)
})

test('C-13 contract rejects cross-tenant filter and preserves read-only access', async () => {
  await assert.rejects(() => handler(params({ filters: { status: ['running'], tenantId: 'tenant-b' } }), deps()), (error) => error.statusCode === 403)
  const readOnly = await handler(params(), deps())
  assert.equal(readOnly.statusCode, 200)
})
