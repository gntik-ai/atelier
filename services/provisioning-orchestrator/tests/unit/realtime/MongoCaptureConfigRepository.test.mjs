import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoCaptureConfigRepository } from '../../../src/repositories/realtime/MongoCaptureConfigRepository.mjs';

const attrs = {
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  data_source_ref: 'mongo-main',
  database_name: 'catalog',
  collection_name: 'products',
  actor_identity: 'user-1'
};

const connectable = (queryImpl) => ({
  async connect() {
    return {
      query: queryImpl,
      release() {}
    };
  }
});

test('create inserts within quota', async () => {
  const calls = [];
  const repo = new MongoCaptureConfigRepository(connectable(async (sql, params) => {
    calls.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
    if (sql === 'ROLLBACK') throw new Error('should not rollback');
    if (sql.includes('workspace_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 2, current: 0 }] };
    if (sql.includes('tenant_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 5, current: 0 }] };
    if (sql.includes('SELECT * FROM mongo_capture_configs')) return { rows: [] };
    if (sql.includes('INSERT INTO mongo_capture_configs')) return { rows: [{ ...attrs, id: 'cfg-1', capture_mode: 'delta', status: 'active' }] };
    return { rows: [] };
  }));

  const created = await repo.create(attrs);
  assert.equal(created.id, 'cfg-1');
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO mongo_capture_configs')));
});

test('create throws on workspace quota exceeded', async () => {
  const repo = new MongoCaptureConfigRepository(connectable(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('workspace_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 1, current: 1 }] };
    throw new Error(`unexpected query: ${sql}`);
  }));

  await assert.rejects(() => repo.create(attrs), (error) => error?.code === 'QUOTA_EXCEEDED' && error?.scope === 'workspace');
});

test('create throws on tenant quota exceeded', async () => {
  const repo = new MongoCaptureConfigRepository(connectable(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('workspace_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 2, current: 0 }] };
    if (sql.includes('tenant_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 1, current: 1 }] };
    throw new Error(`unexpected query: ${sql}`);
  }));

  await assert.rejects(() => repo.create(attrs), (error) => error?.code === 'QUOTA_EXCEEDED' && error?.scope === 'tenant');
});

test('create throws CAPTURE_ALREADY_ACTIVE on active duplicate', async () => {
  const repo = new MongoCaptureConfigRepository(connectable(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('workspace_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 2, current: 0 }] };
    if (sql.includes('tenant_id=$1') && sql.includes('COUNT(*)::int')) return { rows: [{ quota: 5, current: 0 }] };
    if (sql.includes('SELECT * FROM mongo_capture_configs')) return { rows: [{ ...attrs, id: 'cfg-1', status: 'active', capture_mode: 'delta' }] };
    throw new Error(`unexpected query: ${sql}`);
  }));

  await assert.rejects(() => repo.create(attrs), (error) => error?.code === 'CAPTURE_ALREADY_ACTIVE');
});

test('findActive scopes to active rows', async () => {
  const repo = new MongoCaptureConfigRepository({ query: async () => ({ rows: [{ ...attrs, id: 'cfg-1', status: 'active', capture_mode: 'delta' }] }) });
  const rows = await repo.findActive('mongo-main');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'active');
});

test('updateStatus and disable return mapped rows', async () => {
  const pool = { query: async (_sql, params) => ({ rows: [{ ...attrs, id: params[0], status: params[1] ?? 'disabled', capture_mode: 'delta' }] }) };
  const repo = new MongoCaptureConfigRepository(pool);
  const updated = await repo.updateStatus('cfg-1', 'errored', { lastError: 'boom', actorIdentity: 'user-1' });
  const disabled = await repo.disable('cfg-1', 'user-1');
  assert.equal(updated.status, 'errored');
  assert.equal(disabled.status, 'disabled');
});
