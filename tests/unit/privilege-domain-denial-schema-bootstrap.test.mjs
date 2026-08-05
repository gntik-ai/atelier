/**
 * C-14 governance/schema regression: the dedicated denial-history migration boots the table the
 * canonical audit action reads, WITHOUT dragging in the broad, unregistered migration 094.
 *
 * Like the sibling governance-schema-bootstrap suite, this drives the REAL applyGovernanceSchema over
 * the REAL migration .sql files with a recording pool (no live database, no cluster). It then runs
 * the REAL privilege-domain-audit-query action against a schema-aware DB double built from exactly
 * the boot-created tables, proving the empty count/list resolves rather than 42P01. The black-box
 * suite covers the migration's SQL SHAPE; this covers its REGISTRATION and REACHABILITY at boot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOVERNANCE_MIGRATIONS, applyGovernanceSchema } from '../../apps/control-plane/governance-schema.mjs';
import { main as queryPrivilegeDomainAudit } from '../../packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

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
  for (const match of String(sql).matchAll(/\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi)) {
    refs.add(match[1].split('.').at(-1));
  }
  return refs;
}

function schemaAwareDenialDb(tables) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values: [...values] });
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
      return { rows: [] };
    }
  };
}

test('c14-schema-01: the dedicated denial migration is registered at boot and creates privilege_domain_denials', async () => {
  const { applied, all, tables } = await runBootstrap();
  assert.ok(
    applied.some((migration) => migration.includes('122-privilege-domain-denial-history')),
    'the dedicated denial-history migration is applied at boot'
  );
  assert.ok(tables.has('privilege_domain_denials'), 'boot creates privilege_domain_denials');
  assert.match(all, /CREATE TABLE IF NOT EXISTS\s+privilege_domain_denials\b/i);
});

test('c14-schema-02: broad 094 stays out of boot, and none of its extra objects are bootstrapped', async () => {
  const { applied, tables } = await runBootstrap();
  assert.ok(
    applied.every((migration) => !/^094(?:-|_)/.test(basename(migration))),
    'migration 094 is never registered in the governance boot set'
  );
  for (const forbidden of [
    'privilege_domain_assignments',
    'privilege_domain_assignment_history',
    'workspace_structural_admin_count'
  ]) {
    assert.equal(tables.has(forbidden), false, `${forbidden} (094-only) must not be bootstrapped by C-14`);
  }
});

test('c14-schema-03: the denial migration is ordered after its 121 predecessor', async () => {
  const idx = (frag) => GOVERNANCE_MIGRATIONS.findIndex((migration) => migration.includes(frag));
  assert.ok(idx('122-privilege-domain-denial-history') > -1, '122 is in the boot set');
  assert.ok(idx('121-') < idx('122-privilege-domain-denial-history'), '121 precedes the C-14 denial bootstrap');
});

test('c14-schema-04: the audit action runs its empty count/list against the boot-created schema without 42P01', async () => {
  const { tables } = await runBootstrap();
  const db = schemaAwareDenialDb(tables);
  const response = await queryPrivilegeDomainAudit(
    { tenantId: 'ten_a', workspaceId: 'wrk_unknown', auth: { roles: ['platform_admin'] } },
    { db }
  );
  assert.deepEqual(response, { statusCode: 200, body: { denials: [], total: 0, limit: 50, offset: 0 } });
  assert.equal(db.calls.length, 2, 'authorized query issues one count and one list read');
});

test('c14-schema-05: control — without the bootstrap table the same action query fails with 42P01', async () => {
  const db = schemaAwareDenialDb(new Set());
  await assert.rejects(
    () => queryPrivilegeDomainAudit(
      { tenantId: 'ten_a', workspaceId: 'wrk_unknown', auth: { roles: ['platform_admin'] } },
      { db }
    ),
    (error) => error.code === '42P01',
    'the denial table is a real dependency the migration must satisfy'
  );
});
