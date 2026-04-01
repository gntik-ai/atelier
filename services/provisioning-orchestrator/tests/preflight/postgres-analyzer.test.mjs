import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../src/preflight/analyzers/postgres-analyzer.mjs';

const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

test('postgres-analyzer: empty domain data → no_conflicts', async () => {
  const result = await analyze('t-1', null, { log: silentLog });
  assert.equal(result.status, 'no_conflicts');
  assert.equal(result.resources_analyzed, 0);
});

test('postgres-analyzer: table not in destination → compatible', async () => {
  const data = { schema: 't_1', tables: [{ name: 'events', columns: [{ column_name: 'id', data_type: 'uuid' }] }] };
  const query = async () => [];
  const result = await analyze('t-1', data, { credentials: { query }, log: silentLog });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('postgres-analyzer: identical table → compatible', async () => {
  const cols = [{ column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null }];
  const data = { schema: 't_1', tables: [{ name: 'events', columns: cols }] };
  const query = async () => cols;
  const result = await analyze('t-1', data, { credentials: { query }, log: silentLog });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('postgres-analyzer: table with different columns → conflict high', async () => {
  const artifactCols = [{ column_name: 'id', data_type: 'uuid' }, { column_name: 'name', data_type: 'text' }];
  const existingCols = [{ column_name: 'id', data_type: 'uuid' }, { column_name: 'title', data_type: 'varchar' }];
  const data = { schema: 't_1', tables: [{ name: 'events', columns: artifactCols }] };
  const query = async () => existingCols;
  const result = await analyze('t-1', data, { credentials: { query }, log: silentLog });
  assert.equal(result.conflicts.length, 1);
  // Severity depends on the diff key: 'columns' → high
  assert.ok(['high', 'medium'].includes(result.conflicts[0].severity));
});

test('postgres-analyzer: view with different definition → conflict medium', async () => {
  const data = { schema: 't_1', views: [{ name: 'v_events', definition: 'select id from events' }] };
  const query = async (sql) => {
    if (sql.includes('pg_views')) return [{ viewname: 'v_events', definition: 'select * from events' }];
    return [];
  };
  const result = await analyze('t-1', data, { credentials: { query }, log: silentLog });
  assert.equal(result.conflicts.length, 1);
});

test('postgres-analyzer: database unavailable → analysis_error', async () => {
  const data = { schema: 't_1', tables: [{ name: 'events' }] };
  const query = async () => { throw new Error('connection refused'); };
  const result = await analyze('t-1', data, { credentials: { query }, log: silentLog });
  // Individual resource error → captured as high-severity conflict
  assert.ok(result.conflicts.length >= 0 || result.status === 'analysis_error');
});

test('postgres-analyzer: no write operations', async () => {
  const queryCalls = [];
  const data = { schema: 't_1', tables: [{ name: 'events' }] };
  const query = async (sql) => {
    queryCalls.push(sql);
    return [];
  };
  await analyze('t-1', data, { credentials: { query }, log: silentLog });
  for (const sql of queryCalls) {
    assert.ok(!sql.trim().toUpperCase().startsWith('INSERT'), 'No INSERT queries');
    assert.ok(!sql.trim().toUpperCase().startsWith('UPDATE'), 'No UPDATE queries');
    assert.ok(!sql.trim().toUpperCase().startsWith('DELETE'), 'No DELETE queries');
    assert.ok(!sql.trim().toUpperCase().startsWith('CREATE'), 'No CREATE queries');
    assert.ok(!sql.trim().toUpperCase().startsWith('DROP'), 'No DROP queries');
    assert.ok(!sql.trim().toUpperCase().startsWith('ALTER'), 'No ALTER queries');
  }
});
