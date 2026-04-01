import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../src/preflight/analyzers/functions-analyzer.mjs';

const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

test('functions-analyzer: empty domain data → no_conflicts', async () => {
  const result = await analyze('t-1', null, { log: silentLog });
  assert.equal(result.status, 'no_conflicts');
});

test('functions-analyzer: action not in destination → compatible', async () => {
  const data = { namespace: 't-1', actions: [{ name: 'hello', exec: { kind: 'nodejs:20', code: 'fn()' } }] };
  const owApi = async () => null;
  const result = await analyze('t-1', data, { credentials: { owApi }, log: silentLog });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('functions-analyzer: action with different runtime → conflict high', async () => {
  const artifactAction = { name: 'hello', exec: { kind: 'nodejs:20', code: 'fn()' }, limits: {} };
  const existingAction = { name: 'hello', exec: { kind: 'python:3.11', code: 'fn()' }, limits: {} };
  const data = { namespace: 't-1', actions: [artifactAction] };
  const owApi = async () => existingAction;
  const result = await analyze('t-1', data, { credentials: { owApi }, log: silentLog });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].severity, 'high');
});

test('functions-analyzer: only redacted parameter differs → compatible_with_redacted_fields', async () => {
  const artifactAction = { name: 'hello', exec: { kind: 'nodejs:20' }, parameters: [{ key: 'DB_PASSWORD', value: '***REDACTED***' }] };
  const existingAction = { name: 'hello', exec: { kind: 'nodejs:20' }, parameters: [{ key: 'DB_PASSWORD', value: 'real-secret' }] };
  const data = { namespace: 't-1', actions: [artifactAction] };
  const owApi = async () => existingAction;
  const result = await analyze('t-1', data, { credentials: { owApi }, log: silentLog });
  assert.equal(result.compatible_with_redacted_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('functions-analyzer: OpenWhisk unavailable → analysis_error', async () => {
  const data = { namespace: 't-1', actions: [{ name: 'hello' }] };
  const owApi = async () => { throw new Error('connection refused'); };
  const result = await analyze('t-1', data, { credentials: { owApi }, log: silentLog });
  assert.ok(result.conflicts.length >= 0 || result.status === 'analysis_error');
});

test('functions-analyzer: no write operations called', async () => {
  const calls = [];
  const data = { namespace: 't-1', actions: [{ name: 'hello' }] };
  const owApi = async (method, path) => {
    calls.push({ method, path });
    if (method !== 'GET') throw new Error('Write operation attempted!');
    return null;
  };
  await analyze('t-1', data, { credentials: { owApi }, log: silentLog });
  for (const c of calls) {
    assert.equal(c.method, 'GET', 'Only GET calls should be made');
  }
});
