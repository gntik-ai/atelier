import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteFilter } from '../../src/RouteFilter.mjs';
const event = { relation: { namespace: 'public', relationName: 'orders' } };
const cache = { getActiveConfigs: async () => [
  { workspace_id: 'w1', schema_name: 'public', table_name: 'orders', status: 'active' },
  { workspace_id: 'w2', schema_name: 'public', table_name: 'orders', status: 'active' },
  { workspace_id: 'w1', schema_name: 'public', table_name: 'orders', status: 'disabled' },
  { workspace_id: 'w1', schema_name: 'public', table_name: 'users', status: 'active' }
] };
const filter = new RouteFilter(cache);
test('match returns configs', async () => assert.equal((await filter.match(event, 'db')).length, 2));
test('match returns empty for no table', async () => assert.equal((await filter.match({ relation: { namespace: 'public', relationName: 'missing' } }, 'db')).length, 0));
test('matchForWorkspace returns one', async () => assert.equal((await filter.matchForWorkspace(event, 'db', 'w1')).length, 1));
test('matchForWorkspace empty when no workspace', async () => assert.equal((await filter.matchForWorkspace(event, 'db', 'missing')).length, 0));
