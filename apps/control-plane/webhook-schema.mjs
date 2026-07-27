// Webhook schema bootstrap for the kind control-plane (#643).
//
// The webhook management plane (webhook-handlers.mjs -> webhook-management action)
// reads/writes webhook_subscriptions / webhook_signing_secrets / webhook_deliveries
// / webhook_delivery_attempts. Those relations live in the webhook-engine MIGRATIONS
// (packages/webhook-engine/migrations) — no in-repo kind migration creates them — so,
// like applyGovernanceSchema, this module applies the migration set at boot.
//
// We apply 001 (tables) + 002 (tenant_id/workspace_id columns on the secrets table)
// + 004 (platform master-key lifecycle metadata)
// ONLY. Migration 003 (FORCE ROW LEVEL SECURITY) remains an independently managed
// rollout and is intentionally not applied by this bootstrap. The runtime adapter
// now supplies both defenses for either production state: explicit tenant/workspace
// predicates and transaction-local app.tenant_id/app.workspace_id settings. Thus a
// database where migration 003 is already present remains usable, while an
// RLS-absent database does not rely on fixture-only grants or unscoped queries.
//
// Every statement is CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so
// re-running boot is a no-op (idempotent). The packages/webhook-engine tree is
// COPYd into the image under /repo by apps/control-plane/Dockerfile.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const WEBHOOK_MIGRATIONS = [
  'packages/webhook-engine/migrations/001-webhook-subscriptions.sql',
  'packages/webhook-engine/migrations/002-signing-secret-tenant-scope.sql',
  'packages/webhook-engine/migrations/004-webhook-master-key-lifecycle.sql',
];

const DEFAULT_REPO_ROOT = process.env.REPO_ROOT || '/repo';

/**
 * Apply the webhook schema (migrations 001 + 002 + 004) to the in_falcone database.
 * Idempotent. Injectable I/O for tests.
 *
 * @param {{query:(sql:string)=>Promise<any>}} pool  bounded schema-owner Postgres pool
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 * @param {(p:string,enc:string)=>Promise<string>} [opts.read]
 * @param {{log:Function}} [opts.log]
 * @returns {Promise<string[]>}  the migration paths applied, in order
 */
export async function applyWebhookSchema(pool, opts = {}) {
  const {
    repoRoot = DEFAULT_REPO_ROOT,
    read = readFile,
    log = console,
    principalNames,
  } = opts;
  if (!principalNames) {
    throw Object.assign(
      new Error('Webhook database principal configuration is incomplete'),
      { code: 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED' },
    );
  }
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const applied = [];
  try {
    for (const rel of WEBHOOK_MIGRATIONS) {
      const sql = await read(resolve(repoRoot, rel), 'utf8');
      if (rel.endsWith('/004-webhook-master-key-lifecycle.sql')) {
        let transactionStarted = false;
        try {
          await client.query('BEGIN');
          transactionStarted = true;
          await client.query(
            `SELECT
               set_config('falcone.webhook_schema_role', $1, true),
               set_config('falcone.webhook_runtime_role', $2, true),
               set_config('falcone.webhook_writer_role', $3, true),
               set_config('falcone.webhook_lifecycle_role', $4, true),
               set_config('falcone.webhook_authority_grantor_role', $5, true)`,
            [
              principalNames.schema,
              principalNames.runtime,
              principalNames.writer,
              principalNames.lifecycle,
              principalNames.grantor,
            ],
          );
          await client.query(sql);
          await client.query('COMMIT');
          transactionStarted = false;
        } catch (caught) {
          if (transactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve migration failure */ }
          }
          throw caught;
        }
      } else {
        await client.query(sql);
      }
      applied.push(rel);
    }
  } finally {
    if (client !== pool) client.release?.();
  }
  log.log?.(`[control-plane] webhook schema ready (${applied.length} migrations)`);
  return applied;
}
