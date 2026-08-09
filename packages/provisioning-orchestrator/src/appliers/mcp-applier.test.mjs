// Unit tests for the MCP domain teardown applier (change add-mcp-runtime-deployment, #388).
// No real DB / cluster: injected fakes drive every branch. Mirrors workflows-applier semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { teardown } from './mcp-applier.mjs';
import { resolveDependencies } from '../actions/tenant-purge-sweep.mjs';

function fakeDb(behaviour = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const m = sql.match(/DELETE FROM (\w+)/);
      const table = m?.[1];
      if (behaviour[table] === 'missing') { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; }
      if (behaviour[table] === 'boom') throw new Error(`boom on ${table}`);
      return { rowCount: behaviour[table] ?? 0 };
    },
  };
}

test('teardown: deletes tenant MCP ksvcs + metadata rows -> applied, no errors', async () => {
  const db = fakeDb({ mcp_servers: 2, mcp_tools: 5 });
  let killedTenant = null;
  const res = await teardown('ten_A', {}, {
    credentials: { db, deleteTenantMcpServers: async (t) => { killedTenant = t; return { deleted: 3 }; } },
  });
  assert.equal(res.domain_key, 'mcp');
  assert.equal(res.status, 'applied');
  assert.equal(res.counts.errors, 0);
  assert.equal(killedTenant, 'ten_A');
  // every Postgres DELETE is tenant-scoped by an explicit predicate
  for (const c of db.calls) assert.deepEqual(c.params, ['ten_A']);
  // ksvc removal is recorded
  assert.ok(res.resource_results.some((r) => r.resource_type === 'mcp_servers_ksvc' && r.action === 'removed'));
});

test('teardown: idempotent — second run removes nothing and still succeeds', async () => {
  const db = fakeDb({}); // 0 rows everywhere
  const res = await teardown('ten_A', {}, {
    credentials: { db, deleteTenantMcpServers: async () => ({ deleted: 0 }) },
  });
  assert.equal(res.status, 'applied');
  assert.equal(res.counts.errors, 0);
});

test('teardown: dryRun performs no I/O', async () => {
  const db = fakeDb({ mcp_servers: 9 });
  let called = false;
  const res = await teardown('ten_A', {}, {
    dryRun: true,
    credentials: { db, deleteTenantMcpServers: async () => { called = true; return { deleted: 1 }; } },
  });
  assert.equal(res.status, 'would_apply');
  assert.equal(called, false, 'ksvc delete must not run in dryRun');
  assert.equal(db.calls.length, 0, 'no DELETE must run in dryRun');
  assert.ok(res.resource_results.every((r) => r.action === 'would_remove'));
});

test('teardown: missing table (42P01) is skipped, not an error', async () => {
  const db = fakeDb({ mcp_servers: 'missing', mcp_tools: 'missing', mcp_oauth_clients: 'missing', mcp_server_versions: 'missing' });
  const res = await teardown('ten_A', {}, { credentials: { db, deleteTenantMcpServers: async () => ({ deleted: 0 }) } });
  assert.equal(res.status, 'applied');
  assert.equal(res.counts.errors, 0);
  assert.ok(res.resource_results.some((r) => r.action === 'skipped' && r.message === 'table absent'));
});

test('teardown: a real failure surfaces as counts.errors>0 / status error', async () => {
  const db = fakeDb({ mcp_servers: 'boom' });
  const res = await teardown('ten_A', {}, { credentials: { db, deleteTenantMcpServers: async () => ({ deleted: 0 }) } });
  assert.ok(res.counts.errors >= 1);
  assert.equal(res.status, 'error');
});

test('teardown: Knative outage persists tenant cleanup and keeps aggregate + metadata pending', async () => {
  const db = fakeDb({ mcp_servers: 2 });
  const deferred = [];
  const res = await teardown('ten_A', {}, {
    credentials: {
      db,
      correlationId: 'corr-purge-a',
      deleteTenantMcpServers: async () => { throw Object.assign(new Error('runtime unavailable'), { code: 'KNATIVE_UNAVAILABLE' }); },
      deferTenantMcpServers: async (input) => {
        deferred.push(input);
        return { status: 'deletion_pending', correlationId: input.correlationId };
      },
    },
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /deletion_pending/);
  assert.deepEqual(deferred, [{ tenantId: 'ten_A', correlationId: 'corr-purge-a' }]);
  assert.equal(db.calls.length, 0, 'metadata must remain until runtime cleanup completes');
  assert.ok(res.resource_results.some((item) => item.message.includes('corr-purge-a')));
});

test('teardown: works with no injected credentials (safe no-ops)', async () => {
  const res = await teardown('ten_A', {}, {});
  assert.equal(res.status, 'applied');
  assert.equal(res.counts.errors, 0);
});

test('purge sweep wires the mcp domain teardown by default', () => {
  const deps = resolveDependencies({});
  assert.equal(typeof deps.mcpTeardown, 'function');
  assert.equal(deps.mcpTeardown, teardown, 'default mcpTeardown must be the mcp-applier teardown');
});
