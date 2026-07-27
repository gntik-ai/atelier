// bbx-webhook-schema-bootstrap
//
// Black-box coverage for change add-webhook-engine-kind-runtime (GitHub #643).
//
// The kind control-plane provisions the webhook relations at boot via
// applyWebhookSchema(pool). These tests drive it with a recording pool + a real
// file read from the checkout, asserting: it applies migrations 001 (tables) and
// 002 (tenant columns) only, the DDL is idempotent (IF NOT EXISTS), and it does
// NOT enable FORCE RLS / create policies on kind (migration 003 is deferred to
// the RLS-rollout feature — applying it without a SET LOCAL app.tenant_id wrapper
// would make every webhook query match zero rows).
//
// Scenarios:
//   bbx-643-schema-01: applies migrations 001 + 002 + 004 with idempotent DDL
//   bbx-643-schema-02: does NOT enable row-level security / create policies (003 deferred)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWebhookSchema, WEBHOOK_MIGRATIONS } from '../../apps/control-plane/webhook-schema.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRINCIPAL_NAMES = {
  schema: 'c25_schema',
  runtime: 'c25_runtime',
  writer: 'c25_writer',
  lifecycle: 'c25_lifecycle',
  grantor: 'postgres',
};

function recordingPool() {
  const calls = [];
  return { calls, async query(text) { calls.push(String(text)); return { rows: [] }; } };
}

test('bbx-643-schema-01: applies migrations 001 + 002 + 004, with idempotent DDL', async () => {
  const pool = recordingPool();
  const applied = await applyWebhookSchema(pool, {
    repoRoot: REPO_ROOT,
    log: { log() {} },
    principalNames: PRINCIPAL_NAMES,
  });
  assert.deepEqual(applied, WEBHOOK_MIGRATIONS);
  assert.equal(applied.length, 3, 'exactly migrations 001 + 002 + 004');
  const all = pool.calls.join('\n').toLowerCase();
  assert.ok(/create table if not exists webhook_subscriptions/.test(all), 'creates webhook_subscriptions idempotently');
  assert.ok(/create table if not exists webhook_signing_secrets/.test(all), 'creates webhook_signing_secrets idempotently');
  assert.ok(/create table if not exists webhook_deliveries/.test(all), 'creates webhook_deliveries idempotently');
  assert.ok(/add column if not exists tenant_id/.test(all), 'migration 002 adds tenant columns idempotently');
  assert.ok(/add column if not exists encryption_key_id/.test(all), 'migration 004 adds a nullable key identity');
  assert.ok(/create table if not exists webhook_master_key_state/.test(all), 'migration 004 creates singleton state idempotently');
  assert.ok(/create table if not exists webhook_master_key_rotations/.test(all), 'migration 004 creates lifecycle ledger idempotently');
  assert.ok(/security definer[\s\S]*falcone_webhook_key_write_current_id|falcone_webhook_key_write_current_id[\s\S]*security definer/.test(all), 'dedicated writers receive only a bounded durable-identity function');
  assert.ok(/revoke all on function falcone_webhook_key_write_current_id\(\) from public/.test(all), 'identity lookup is not executable by arbitrary database roles');
  assert.ok(/grant execute on function falcone_webhook_key_write_current_id\(\)[\s\S]*to falcone_webhook_key_writer/.test(all), 'only the dedicated effective writer role can read the durable write identity');
  assert.ok(/falcone\.webhook_lifecycle_role/.test(all), 'migration requires the declared lifecycle login');
  assert.ok(/falcone\.webhook_writer_role/.test(all), 'migration requires the declared ciphertext-writer login');
  assert.ok(/falcone\.webhook_runtime_role/.test(all), 'migration requires the declared ordinary runtime login');
  assert.ok(/membership\.inherit_option/.test(all), 'migration validates PostgreSQL 16 INHERIT edge options');
  assert.ok(/membership\.set_option/.test(all), 'migration validates PostgreSQL 16 SET edge options');
  assert.ok(/membership\.grantor/.test(all), 'migration validates the durable administrator grantor');
  assert.ok(/protected_principals/.test(all), 'migration rejects every extra edge involving fixed roles or their bound logins');
  assert.ok(!/\bcreate\s+role\b/.test(all), 'application migrations never create global PostgreSQL roles');
  assert.ok(!/\balter\s+role\b/.test(all), 'application migrations never repair global PostgreSQL roles');
  assert.ok(!/\b(grant|revoke)\s+falcone_webhook_key_(lifecycle|writer)\s+(to|from)\b/.test(all), 'application migrations never bind or repair role memberships');
  assert.ok(/grant select,\s*update on webhook_signing_secrets to falcone_webhook_key_lifecycle/.test(all), 'lifecycle authority has only the signing-row transform grant');
  assert.ok(!/grant\s+falcone_webhook_key_(lifecycle|writer)\s+to\s+(falcone_app|public)/.test(all), 'ordinary and public roles do not inherit either fixed authority');
  assert.ok(/revoke all privileges on webhook_subscriptions,\s*webhook_signing_secrets,[\s\S]*from public,\s*falcone_app/.test(all), 'migration resets public and fixed-role table grants before applying the exact contract');
  assert.ok(/aclexplode\(attribute\.attacl\)/.test(all), 'migration removes unexpected column-level privileges');
  assert.ok(/aclexplode\([\s\S]*procedure\.proacl/.test(all), 'migration removes unexpected function execution privileges');
  assert.ok(
    /revoke all privileges on table %i\.%i from %s cascade/.test(all)
      && /revoke all privileges \(%i\) on table %i\.%i from %s cascade/.test(all)
      && /revoke all privileges on function %i\.%i\(%s\) from %s cascade/.test(all),
    'enumerated table, column, and function ACL cleanup removes dependent grant chains',
  );
  assert.ok(/grant select,\s*update,\s*delete on webhook_subscriptions to falcone_app/.test(all), 'runtime retains ordinary non-secret subscription operations');
  assert.ok(/grant select on webhook_signing_secrets to falcone_app/.test(all), 'runtime can read serving ciphertext but receives no encrypted-column write grant');
  assert.ok(/pg_advisory_xact_lock_shared\(723661,\s*25\)/.test(all), 'migration 004 fences every encrypted row write in the database');
  assert.ok(/before insert or update of secret_cipher,\s*secret_iv,\s*encryption_key_id/.test(all), 'database fence covers encrypted inserts and updates');
  assert.ok(/for each statement[\s\S]*falcone_webhook_signing_secret_write_statement_fence/.test(all), 'statement fence takes the shared lock before row discovery');
  assert.ok(/current_user\s*<>\s*'falcone_webhook_key_writer'/.test(all), 'row fence requires the effective dedicated writer role');
  assert.ok(!/current_setting\('falcone\.webhook_key_write_id'/.test(all), 'row fence ignores caller-controlled key-identity settings');
  assert.ok(/create trigger trg_webhook_signing_secret_write_fence/.test(all), 'migration 004 installs the writer fence trigger idempotently');
  assert.ok(/current_verification_cipher/.test(all), 'state authenticates keys with verification ciphertext');
  assert.ok(!/key_digest|key_hash|key_bytes|plaintext_secret/.test(all), 'lifecycle schema has no key digest/bytes/plaintext metadata');
  assert.ok(!/update\s+webhook_signing_secrets\s+set\s+encryption_key_id/.test(all), 'migration never guesses a legacy row key identity');
});

test('bbx-c25-schema-004-replay: applying the complete migration set twice is replay-safe', async () => {
  const pool = recordingPool();
  const options = {
    repoRoot: REPO_ROOT,
    log: { log() {} },
    principalNames: PRINCIPAL_NAMES,
  };
  await applyWebhookSchema(pool, options);
  await applyWebhookSchema(pool, options);
  assert.equal(pool.calls.length, 12);
  const lifecycleCopies = pool.calls.filter((sql) => /webhook_master_key_state/.test(sql));
  assert.equal(lifecycleCopies.length, 2);
  for (const sql of lifecycleCopies) {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS encryption_key_id/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS webhook_master_key_state/i);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_master_key_rotation_id/i);
    assert.match(sql, /IF NOT EXISTS \([\s\S]*trg_webhook_signing_secret_write_statement_fence/i);
    assert.match(sql, /IF NOT EXISTS \([\s\S]*trg_webhook_signing_secret_write_fence/i);
  }
});

test('bbx-643-schema-02: does not enable tenant RLS; policy reconciliation is variant-bound', async () => {
  const pool = recordingPool();
  await applyWebhookSchema(pool, {
    repoRoot: REPO_ROOT,
    log: { log() {} },
    principalNames: PRINCIPAL_NAMES,
  });
  const all = pool.calls.join('\n').toLowerCase();
  assert.ok(!/enable row level security/.test(all), 'no ENABLE ROW LEVEL SECURITY (003 deferred)');
  assert.ok(!/force row level security/.test(all), 'no FORCE ROW LEVEL SECURITY (003 deferred)');
  assert.match(
    all,
    /create policy webhook_signing_secrets_key_lifecycle[\s\S]*to falcone_webhook_key_lifecycle/,
    'the conditional FORCE-RLS branch limits lifecycle policy to the dedicated role',
  );
  assert.match(
    all,
    /if enabled_count = 4 then[\s\S]*create policy webhook_subscriptions_tenant_isolation/,
    'tenant policies are recreated only when all four migration-003 tables already have FORCE RLS',
  );
  assert.match(
    all,
    /from pg_policy[\s\S]*webhook_master_key_rotations[\s\S]*'drop policy %i on %i\.%i'/,
    'replay removes every unexpected C-25 policy before selecting the exact variant',
  );
});
