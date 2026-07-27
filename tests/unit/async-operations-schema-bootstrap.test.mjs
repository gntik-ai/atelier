/**
 * Regression tests for issue #736.
 *
 * The kind control-plane serves the real `/v1/async-operation-query` action, so its
 * boot schema applier must create the async operation tables before the route is
 * considered ready. These tests live in tests/unit so CI's `pnpm test:unit` runs the
 * acceptance guard, not only the optional black-box slice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOVERNANCE_MIGRATIONS,
  applyGovernanceSchema,
} from '../../apps/control-plane/governance-schema.mjs';
import { main as asyncOperationQueryAction } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

async function runBootstrap() {
  const executed = [];
  const pool = {
    async query(sql) {
      executed.push(sql);
      return { rows: [] };
    },
  };
  const applied = await applyGovernanceSchema(pool, {
    repoRoot: REPO_ROOT,
    log: { log() {} },
  });
  const tables = new Set();
  for (const sql of executed) {
    for (const match of sql.matchAll(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gi)) {
      tables.add(match[1]);
    }
  }
  return { applied, all: executed.join('\n;\n'), tables };
}

function referencedTables(sql) {
  const refs = new Set();
  for (const pattern of [
    /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
    /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
    /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
    /\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  ]) {
    for (const match of sql.matchAll(pattern)) {
      refs.add(match[1].split('.').at(-1));
    }
  }
  return refs;
}

function asyncOperationDbBackedByBootTables(tables) {
  return {
    async query(sql) {
      for (const table of referencedTables(sql)) {
        if (!tables.has(table)) {
          const err = new Error(`relation "${table}" does not exist`);
          err.code = '42P01';
          throw err;
        }
      }
      if (/SELECT\s+COUNT\(\*\)::int\s+AS\s+total/i.test(sql)) {
        return { rows: [{ total: 0 }] };
      }
      if (/\bFROM\s+async_operations\b/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('fix-736-01: boot applies the async operation migration chain before later provisioning migrations', async () => {
  const { applied } = await runBootstrap();
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((path) => path.includes(frag));

  assert.deepEqual(applied, GOVERNANCE_MIGRATIONS);
  for (const migration of ['073-', '074-', '075-', '076-', '078-', '079-']) {
    assert.ok(idx(migration) > -1, `${migration} must be part of the boot migration set`);
  }
  assert.ok(idx('073-') < idx('074-'), '073 async_operations before 074 logs FK');
  assert.ok(idx('074-') < idx('075-'), '074 before 075 in numeric order');
  assert.ok(idx('075-') < idx('076-'), '075 before 076 in numeric order');
  assert.ok(idx('076-') < idx('078-'), '076 before 078 in numeric order');
  assert.ok(idx('078-') < idx('079-'), '078 intervention schema before 079 result columns');
  assert.ok(idx('079-') < idx('080-'), 'async operation chain before later provisioning migrations');
});

test('fix-736-02: boot-created schema includes the tables queried by async-operation-query', async () => {
  const { all, tables } = await runBootstrap();
  for (const table of ['async_operations', 'async_operation_transitions', 'async_operation_log_entries']) {
    assert.ok(tables.has(table), `boot must create ${table}`);
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `real migration SQL creates ${table}`);
  }
  assert.match(all, /ADD COLUMN IF NOT EXISTS result JSONB/i);
  assert.match(all, /ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ/i);
});

test('fix-736-03: async-operation-query list returns 200 against the boot-created schema', async () => {
  const { tables } = await runBootstrap();
  const response = await asyncOperationQueryAction(
    {
      __ow_headers: {
        'x-auth-subject': 'superadmin-736',
        'x-actor-type': 'superadmin',
        'x-correlation-id': 'corr-736',
      },
      queryType: 'list',
      filters: {},
      pagination: { limit: 20, offset: 0 },
    },
    {
      db: asyncOperationDbBackedByBootTables(tables),
      log() {},
    },
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    queryType: 'list',
    items: [],
    total: 0,
    pagination: { limit: 20, offset: 0 },
  });
});

test('C-11 canonical manifest and local bootstrap place 079 after 078 and before 080', async () => {
  const requiredMigrations = await readFile(
    resolve(REPO_ROOT, 'apps/control-plane/required-migrations.txt'),
    'utf8'
  );
  const envBootstrap = await readFile(resolve(REPO_ROOT, 'tests/env/up.sh'), 'utf8');

  const required079 = requiredMigrations.indexOf('079-async-operation-results.sql');
  assert.ok(required079 > requiredMigrations.indexOf('078-retry-semantics-intervention.sql'));
  assert.ok(required079 < requiredMigrations.indexOf('080-pg-capture-config.sql'));

  const env079 = envBootstrap.indexOf('079-async-operation-results');
  assert.ok(env079 > envBootstrap.indexOf('078-retry-semantics-intervention'));
  assert.match(envBootstrap, /078-retry-semantics-intervention 079-async-operation-results/);
});
