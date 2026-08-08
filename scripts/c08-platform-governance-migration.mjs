#!/usr/bin/env node
// Local/disposable C-08 migration assistant.  Default mode is dry-run.
// Never invokes kubectl and never prints connection strings, credentials or projections.
import { createHash } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { forwardMigration } from '../apps/control-plane/governance-schema.mjs';
import { seedC08CanonicalEntities, canonicalC08Entities } from '../apps/control-plane/c08-schema.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { Pool } = pg;
const migrationPath = resolve(repoRoot, 'packages/provisioning-orchestrator/src/migrations/123-c08-platform-governance-registry.sql');
const VALID_MODES = new Set(['dry-run', 'apply', 'verify', 'backup', 'rollback-verify']);

function args(argv) {
  const parsed = { mode: 'dry-run', output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--mode') parsed.mode = argv[++index];
    else if (value === '--output') parsed.output = argv[++index];
    else if (value === '--help' || value === '-h') parsed.help = true;
    else throw new Error(`unknown argument ${value}`);
  }
  if (!VALID_MODES.has(parsed.mode)) throw new Error(`--mode must be one of ${[...VALID_MODES].join(', ')}`);
  return parsed;
}

function usage() {
  return `Usage: node scripts/c08-platform-governance-migration.mjs [--mode MODE] [--output ABSOLUTE_PATH]

Modes:
  dry-run          Print the additive plan only (default; no database connection)
  apply            Apply migration 123 and idempotently seed canonical release entities
  verify           Verify relations, canonical seeds, references and audit linkage
  backup           Write a mode-0600 JSON backup outside the repository (--output required)
  rollback-verify  Verify a data-retaining application rollback is safe (no DROP is run)`;
}

function connectionPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for this mode');
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function auditHash(row) {
  const canonical = stable({
    auditId: row.audit_id, commandId: row.command_id, operationId: row.operation_id,
    actorId: row.actor_id, entityType: row.entity_type, entityId: row.entity_id,
    correlationId: row.correlation_id, acceptedEventType: row.accepted_event_type,
    outcome: row.outcome, detail: row.detail,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  });
  return createHash('sha256').update(`${canonical}\n${row.prev_hash ?? ''}`).digest('hex');
}

async function verify(pool) {
  const relations = ['platform_governance_entities', 'platform_governance_commands', 'platform_governance_idempotency', 'platform_governance_audit', 'function_audit_outbox', 'function_audit_intents'];
  const existing = await pool.query(
    `SELECT name, to_regclass('public.' || name) AS relation
       FROM unnest($1::text[]) AS names(name)`, [relations]
  );
  const missing = existing.rows.filter((row) => !row.relation).map((row) => row.name);
  if (missing.length) throw new Error(`missing C-08 relations: ${missing.join(', ')}`);

  const domain = JSON.parse(await readFile(resolve(repoRoot, 'packages/internal-contracts/src/domain-model.json'), 'utf8'));
  const expectedIds = canonicalC08Entities(domain).map((row) => row.entityId);
  const [counts, canonical, danglingAudit, badParent, auditRows] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*) FROM platform_governance_entities)::int AS entities,
      (SELECT COUNT(*) FROM platform_governance_commands)::int AS commands,
      (SELECT COUNT(*) FROM platform_governance_idempotency)::int AS replay_receipts,
      (SELECT COUNT(*) FROM platform_governance_audit)::int AS audit_records,
      (SELECT COUNT(*) FROM function_audit_outbox WHERE published_at IS NULL)::int AS pending_function_audit_events,
      (SELECT COUNT(*) FROM function_audit_intents WHERE finalized_at IS NULL)::int AS pending_function_audit_intents`),
    pool.query('SELECT entity_id FROM platform_governance_entities WHERE entity_id = ANY($1::text[])', [expectedIds]),
    pool.query(`SELECT a.audit_id FROM platform_governance_audit a
      LEFT JOIN platform_governance_commands c ON c.command_id = a.command_id
      WHERE c.command_id IS NULL LIMIT 1`),
    pool.query(`SELECT q.entity_id FROM platform_governance_entities q
      LEFT JOIN platform_governance_entities p
        ON p.entity_type = 'plan' AND p.entity_id = q.parent_id
      WHERE q.entity_type = 'quota_policy' AND q.parent_id IS NOT NULL AND p.entity_id IS NULL LIMIT 1`),
    pool.query(`SELECT * FROM platform_governance_audit ORDER BY created_at, audit_id`)
  ]);
  const absentCanonical = expectedIds.filter((id) => !canonical.rows.some((row) => row.entity_id === id));
  if (absentCanonical.length) throw new Error(`canonical release entities absent: ${absentCanonical.join(', ')}`);
  if (danglingAudit.rows.length) throw new Error('platform governance audit has a dangling command link');
  if (badParent.rows.length) throw new Error('quota policy has a missing parent plan');
  let previousHash = '';
  for (const row of auditRows.rows) {
    if (row.prev_hash !== previousHash || auditHash(row) !== row.row_hash) {
      throw new Error(`platform governance audit hash chain is invalid at ${row.audit_id}`);
    }
    previousHash = row.row_hash;
  }
  return { ...counts.rows[0], canonical_entities: expectedIds.length, audit_chain_valid: true };
}

function outputOutsideRepository(output) {
  if (!output || !isAbsolute(output)) throw new Error('--output must be an absolute path outside the repository');
  const target = resolve(output);
  const rel = relative(repoRoot, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('backup output must be outside the repository');
  }
  return target;
}

async function main() {
  const parsed = args(process.argv.slice(2));
  if (parsed.help) { console.log(usage()); return; }
  if (parsed.mode === 'dry-run') {
    console.log(JSON.stringify({
      mode: 'dry-run', databaseConnected: false, clusterApplied: false,
      migration: relative(repoRoot, migrationPath),
      effects: ['6 additive relations', 'canonical catalog seed/upsert', 'no legacy table mutation'],
      rollback: 'roll back application image; retain C-08 tables and data'
    }, null, 2));
    return;
  }

  const pool = connectionPool();
  try {
    if (parsed.mode === 'apply') {
      const sql = forwardMigration(await readFile(migrationPath, 'utf8'));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve migration error */ }
        throw error;
      } finally {
        client.release();
      }
      const seeded = await seedC08CanonicalEntities(pool, { log: { log() {} } });
      const result = await verify(pool);
      console.log(JSON.stringify({ mode: 'apply', migrationApplied: true, seeded, verified: result, clusterApplied: false }, null, 2));
      return;
    }
    if (parsed.mode === 'verify' || parsed.mode === 'rollback-verify') {
      const result = await verify(pool);
      console.log(JSON.stringify({
        mode: parsed.mode, verified: result, clusterApplied: false,
        ...(parsed.mode === 'rollback-verify' ? { rollback: 'data-retaining; no destructive SQL executed' } : {})
      }, null, 2));
      return;
    }
    if (parsed.mode === 'backup') {
      const output = outputOutsideRepository(parsed.output);
      const [entities, commands, idempotency, audit, functionAuditOutbox, functionAuditIntents] = await Promise.all([
        pool.query('SELECT * FROM platform_governance_entities ORDER BY entity_type, entity_id'),
        pool.query('SELECT * FROM platform_governance_commands ORDER BY accepted_at, command_id'),
        pool.query('SELECT * FROM platform_governance_idempotency ORDER BY operation_id, actor_id, idempotency_key'),
        pool.query('SELECT * FROM platform_governance_audit ORDER BY created_at, audit_id'),
        pool.query('SELECT * FROM function_audit_outbox ORDER BY created_at, event_id'),
        pool.query('SELECT * FROM function_audit_intents ORDER BY created_at, intent_id')
      ]);
      const payload = {
        schemaVersion: 'c08-platform-governance-backup/v1', generatedAt: new Date().toISOString(),
        entities: entities.rows, commands: commands.rows, idempotency: idempotency.rows,
        audit: audit.rows, functionAuditOutbox: functionAuditOutbox.rows,
        functionAuditIntents: functionAuditIntents.rows
      };
      await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await chmod(output, 0o600);
      console.log(JSON.stringify({ mode: 'backup', output, records: {
        entities: entities.rowCount, commands: commands.rowCount, idempotency: idempotency.rowCount,
        audit: audit.rowCount, functionAuditOutbox: functionAuditOutbox.rowCount,
        functionAuditIntents: functionAuditIntents.rowCount
      }, clusterApplied: false }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[c08-migration] ${error.message}`);
  process.exitCode = 1;
});
