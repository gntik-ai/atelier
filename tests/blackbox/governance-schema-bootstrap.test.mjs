/**
 * Black-box tests for the kind control-plane governance schema bootstrap
 * (fix-governance-schema-bootstrap, #555 BUG-GOV-SCHEMA, P1).
 *
 * The bug: the governance routes (capability-catalog, plan-assign, scope-enforcement
 * audit, quota dimensions / effective-limits) dispatch to the REAL product actions,
 * but the tables those actions query were never created in `in_falcone` — the kind
 * boot only ran `ensureSchema` (domain-B tables) and nothing applied the
 * provisioning-orchestrator governance migrations. So:
 *   GET /v1/capability-catalog            → 500 (boolean_capability_catalog missing)
 *   POST /v1/tenants/{id}/plan            → 500 (tenant_plan_change_history missing)
 *   GET …/scope-enforcement/audit         → 500 (scope_enforcement_denials missing)
 *   quota_dimension_catalog               → empty (limits can't be defined)
 *
 * The fix: `applyGovernanceSchema(pool)` applies the governance migration set at boot.
 * This drives that function with a recording pool over the REAL migration .sql files,
 * asserting (a) all four governance objects are created/seeded and (b) the application
 * order is dependency-safe. The live 200-vs-500 proof is in the consolidated kind run.
 *
 * bbx-555-01: applies every governance migration, in declared order
 * bbx-555-02: creates the three missing tables + the quota dimension catalog
 * bbx-555-03: seeds the dimension + capability catalogs idempotently (ON CONFLICT)
 * bbx-555-04: ordering is dependency-safe (function definer + FK targets precede users)
 *
 * fix-backup-scope-schema (#595, P1): the same bootstrap omitted migration 114, so
 * GET /v1/admin/backup/scope and /v1/tenants/{id}/backup/scope 500'd with 42P01
 * (deployment_profile_registry / backup_scope_entries undefined). The fix adds 114 to
 * the governance migration set, after 104 (whose boolean_capability_catalog 114 seeds)
 * and 097 (whose set_updated_at_timestamp() its triggers use).
 *
 * bbx-595-01: bootstrap creates the backup-scope tables (deployment_profile_registry + backup_scope_entries)
 * bbx-595-02: 114 is ordered after 097 (function) and 104 (capability catalog it seeds)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOVERNANCE_MIGRATIONS, applyGovernanceSchema, forwardMigration } from '../../apps/control-plane/governance-schema.mjs';
import { main as asyncOperationQueryAction } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// A pool that records the SQL it would execute; reads the real migration files.
async function runBootstrap() {
  const executed = [];
  const pool = { query: async (sql) => { executed.push(sql); return { rows: [] }; } };
  const applied = await applyGovernanceSchema(pool, { repoRoot: REPO_ROOT, log: { log() {} } });
  const tables = new Set();
  for (const sql of executed) {
    for (const match of sql.matchAll(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gi)) {
      tables.add(match[1]);
    }
  }
  return { applied, executed, all: executed.join('\n;\n'), tables };
}

function referencedTables(sql) {
  const refs = new Set();
  const patterns = [
    /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
    /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
    /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
    /\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) {
      refs.add(match[1].split('.').at(-1));
    }
  }
  return refs;
}

function schemaAwareAsyncOperationDb(tables) {
  const operation = {
    operation_id: '00000000-0000-0000-0000-000000000736',
    tenant_id: 'tenant-736',
    actor_id: 'actor-736',
    actor_type: 'tenant_owner',
    workspace_id: null,
    operation_type: 'tenant.create',
    status: 'completed',
    error_summary: null,
    correlation_id: 'corr-736',
    idempotency_key: null,
    saga_id: null,
    created_at: '2026-06-30T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
  };

  return {
    async query(sql) {
      for (const table of referencedTables(sql)) {
        if (!tables.has(table)) {
          const error = new Error(`relation "${table}" does not exist`);
          error.code = '42P01';
          throw error;
        }
      }

      if (/SELECT\s+COUNT\(\*\)::int\s+AS\s+total/i.test(sql)) {
        return { rows: [{ total: 0 }] };
      }

      if (/\bFROM\s+async_operation_log_entries\b/i.test(sql)) {
        return { rows: [] };
      }

      if (/\bFROM\s+async_operations\b/i.test(sql) && /\bWHERE\s+operation_id\s*=\s*\$1\b/i.test(sql)) {
        return { rows: [operation] };
      }

      if (/\bFROM\s+async_operations\b/i.test(sql)) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

test('bbx-555-01: applies every governance migration in declared order', async () => {
  const { applied, executed } = await runBootstrap();
  assert.deepEqual(applied, GOVERNANCE_MIGRATIONS, 'all governance migrations applied, in order');
  assert.equal(executed.length, GOVERNANCE_MIGRATIONS.length, 'one query per migration file');
});

test('bbx-555-02: creates the three missing tables + the quota dimension catalog', async () => {
  const { all } = await runBootstrap();
  for (const table of [
    'boolean_capability_catalog',   // capability-catalog 500
    'tenant_plan_change_history',   // plan-assign 500
    'scope_enforcement_denials',    // scope-enforcement audit 500
    'quota_dimension_catalog',      // limits can't be defined when empty
  ]) {
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `must create ${table}`);
  }
});

test('bbx-555-03: seeds the dimension + capability catalogs idempotently', async () => {
  const { all } = await runBootstrap();
  assert.match(all, /INSERT INTO quota_dimension_catalog[\s\S]*?ON CONFLICT[\s\S]*?DO NOTHING/i, 'seed quota dimensions, idempotent');
  assert.match(all, /INSERT INTO boolean_capability_catalog[\s\S]*?ON CONFLICT[\s\S]*?DO NOTHING/i, 'seed boolean capabilities, idempotent');
});

test('bbx-555-04: application order is dependency-safe', async () => {
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes(frag));
  // 097 defines set_updated_at_timestamp() + plans, used by 098/104/105.
  assert.ok(idx('097-') < idx('098-'), '097 (function/plans) before 098');
  assert.ok(idx('097-') < idx('104-'), '097 before 104');
  assert.ok(idx('097-') < idx('105-'), '097 before 105');
  // 098 creates quota_dimension_catalog, FK'd by 103 and 105.
  assert.ok(idx('098-') < idx('103-'), '098 (dimension catalog) before 103');
  assert.ok(idx('098-') < idx('105-'), '098 before 105');
});

test('bbx-595-01: bootstrap creates the backup-scope tables', async () => {
  const { applied, all } = await runBootstrap();
  assert.ok(
    applied.some((m) => m.includes('114-backup-scope-deployment-profiles')),
    'migration 114 (backup-scope) is applied at boot',
  );
  for (const table of ['deployment_profile_registry', 'backup_scope_entries']) {
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `must create ${table}`);
  }
});

test('bbx-595-02: 114 is ordered after its prerequisites (097 function, 104 capability catalog)', async () => {
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes(frag));
  // 114's triggers call set_updated_at_timestamp() (defined in 097) and it seeds
  // boolean_capability_catalog (created in 104) → both must precede 114.
  assert.ok(idx('114-') > -1, '114 is in the governance set');
  assert.ok(idx('097-') < idx('114-'), '097 (set_updated_at_timestamp) before 114');
  assert.ok(idx('104-') < idx('114-'), '104 (boolean_capability_catalog) before 114');
});

test('bbx-611-01: bootstrap creates the pg-capture tables (realtime pg-capture-list)', async () => {
  // add-gateway-realtime-config-identity (#611): GET /v1/realtime/workspaces/{ws}/pg-captures
  // reads pg_capture_configs; without migration 080 the read 500'd with 42P01 (undefined_table).
  const { applied, all } = await runBootstrap();
  assert.ok(
    applied.some((m) => m.includes('080-pg-capture-config')),
    'migration 080 (pg-capture) is applied at boot',
  );
  for (const table of ['pg_capture_configs', 'pg_capture_quotas', 'pg_capture_audit_log']) {
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `must create ${table}`);
  }
});

test('bbx-611-02: the forward-only applier strips the `-- down` rollback section', async () => {
  // 080 carries a `-- down` block (DROP TABLE pg_capture_configs ...). Running the whole file
  // would create then immediately drop the tables. The applier must run only the `-- up` portion.
  const { all } = await runBootstrap();
  assert.doesNotMatch(all, /DROP\s+TABLE\s+IF\s+EXISTS\s+pg_capture_configs/i, 'rollback DROP must not be executed at boot');
  // forwardMigration() keeps forward DDL and drops everything from `-- down` onward.
  const sample = 'CREATE TABLE IF NOT EXISTS t (id int);\n-- down\nDROP TABLE IF EXISTS t;\n';
  assert.match(forwardMigration(sample), /CREATE TABLE IF NOT EXISTS t/);
  assert.doesNotMatch(forwardMigration(sample), /DROP TABLE/);
  assert.equal(forwardMigration('CREATE TABLE x();'), 'CREATE TABLE x();', 'files without `-- down` pass through unchanged');
});

test('bbx-736-01: bootstrap creates the async-operation query tables', async () => {
  // #736: POST /v1/async-operation-query is served by the real action, so kind boot
  // must apply the async-operation schema before the server declares readiness.
  const { applied, all, tables } = await runBootstrap();
  for (const migration of [
    '073-async-operation-tables',
    '074-async-operation-log-entries',
    '075-idempotency-retry-tables',
    '076-timeout-cancel-recovery',
    '078-retry-semantics-intervention',
    '079-async-operation-results',
  ]) {
    assert.ok(
      applied.some((m) => m.includes(migration)),
      `${migration} is applied at boot`,
    );
  }

  for (const table of ['async_operations', 'async_operation_transitions', 'async_operation_log_entries']) {
    assert.ok(tables.has(table), `must create ${table}`);
    assert.match(all, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`), `real migration SQL creates ${table}`);
  }
});

test('bbx-736-02: async-operation migrations are applied in dependency-safe numeric order', async () => {
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((m) => m.includes(frag));
  for (const migration of ['073-', '074-', '075-', '076-', '078-', '079-']) {
    assert.ok(idx(migration) > -1, `${migration} is in the boot migration set`);
  }

  assert.ok(idx('073-') < idx('074-'), '073 (async_operations) before 074 logs FK');
  assert.ok(idx('073-') < idx('075-'), '073 before 075 idempotency/retry FKs');
  assert.ok(idx('073-') < idx('076-'), '073 before 076 status/timeout ALTERs');
  assert.ok(idx('073-') < idx('078-'), '073 before 078 intervention FKs/ALTERs');
  assert.ok(idx('074-') < idx('075-'), '074 before 075 in numeric order');
  assert.ok(idx('075-') < idx('076-'), '075 before 076 in numeric order');
  assert.ok(idx('076-') < idx('078-'), '076 before 078 in numeric order');
  assert.ok(idx('078-') < idx('079-'), '078 intervention schema before 079 result columns');
  assert.ok(idx('079-') < idx('080-'), 'async-operation chain before later provisioning migrations');

  const { all } = await runBootstrap();
  assert.match(all, /ADD COLUMN IF NOT EXISTS result JSONB/i);
  assert.match(all, /ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ/i);
});

test('bbx-736-03: async-operation-query list/logs run against the boot-created schema without 42P01', async () => {
  const { tables } = await runBootstrap();
  const db = schemaAwareAsyncOperationDb(tables);
  const baseParams = {
    __ow_headers: {
      'x-auth-subject': 'superadmin-736',
      'x-actor-type': 'superadmin',
      'x-correlation-id': 'corr-736',
    },
  };

  const listResponse = await asyncOperationQueryAction(
    {
      ...baseParams,
      queryType: 'list',
      filters: {},
      pagination: { limit: 20, offset: 0 },
    },
    { db, log() {} },
  );

  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.body, {
    queryType: 'list',
    items: [],
    total: 0,
    pagination: { limit: 20, offset: 0 },
  });

  const logsResponse = await asyncOperationQueryAction(
    {
      ...baseParams,
      queryType: 'logs',
      operationId: '00000000-0000-0000-0000-000000000736',
      pagination: { limit: 20, offset: 0 },
    },
    { db, log() {} },
  );

  assert.equal(logsResponse.statusCode, 200);
  assert.deepEqual(logsResponse.body.entries, []);
  assert.equal(logsResponse.body.total, 0);
  assert.deepEqual(logsResponse.body.pagination, { limit: 20, offset: 0 });

  const resultResponse = await asyncOperationQueryAction(
    {
      ...baseParams,
      queryType: 'result',
      operationId: '00000000-0000-0000-0000-000000000736',
    },
    { db, log() {} },
  );

  assert.equal(resultResponse.statusCode, 200);
  assert.deepEqual(resultResponse.body, {
    queryType: 'result',
    operationId: '00000000-0000-0000-0000-000000000736',
    status: 'completed',
    resultType: 'success',
    summary: null,
    failureReason: null,
    retryable: null,
    completedAt: '2026-06-30T00:00:00.000Z',
  });
});
