import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { recordAuditEventInTransaction } from '../../apps/control-plane/audit-store.mjs';
import { prepareControlPlaneDatabases } from '../../apps/control-plane/control-plane-database-startup.mjs';
import {
  dropWorkspaceDatabase,
  provisionWorkspaceDatabase,
} from '../../apps/control-plane/dataplane.mjs';
import { applyGovernanceSchema } from '../../apps/control-plane/governance-schema.mjs';
import { recoverSagas as recoverControlPlaneSagas } from '../../apps/control-plane/saga.mjs';
import { applyWebhookSchema } from '../../apps/control-plane/webhook-schema.mjs';
import {
  assertWebhookDatabasePoolBoundary,
  buildWebhookDb,
} from '../../apps/control-plane/webhook-db.mjs';
import {
  verifyWebhookDatabasePrincipalConnections,
  verifyWebhookDatabasePrincipalSessions,
  verifyWebhookLifecyclePrincipalConnections,
} from '../../apps/control-plane/webhook-database-principals.mjs';
import { main as managementMain } from '../../packages/webhook-engine/actions/webhook-management.mjs';
import { buildWebhookMasterKeyRepository } from '../../packages/webhook-engine/src/webhook-master-key-lifecycle.mjs';
import {
  createCanonicalWebhookKeyContext,
  createLifecycleWebhookKeyContext,
  createRuntimeWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';
import { decryptSecret, encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';

const { Pool } = pg;
const databaseUrl = process.env.WEBHOOK_KEY_TEST_DATABASE_URL;
const FIXED_AUTHORITIES = [
  'falcone_app',
  'falcone_webhook_key_writer',
  'falcone_webhook_key_lifecycle',
];
const FIXTURE_AUTHORITY_MEMBERS = {
  falcone_app: 'c25_fixture_runtime_login',
  falcone_webhook_key_writer: 'c25_fixture_writer_login',
  falcone_webhook_key_lifecycle: 'c25_fixture_lifecycle_login',
};
const FIXTURE_SCHEMA_LOGIN = 'c25_fixture_schema_login';
const FIXTURE_SCHEMA_PASSWORD = 'C25SyntheticSchemaPassword9x';
const FIXTURE_RUNTIME_PASSWORD = 'C25SyntheticRuntimePassword9x';
const FIXTURE_WRITER_PASSWORD = 'C25SyntheticWriterPassword9x';
const FIXTURE_LIFECYCLE_PASSWORD = 'C25SyntheticLifecyclePassword9x';
const FIXTURE_LOGIN_PASSWORDS = {
  c25_fixture_runtime_login: FIXTURE_RUNTIME_PASSWORD,
  c25_fixture_writer_login: FIXTURE_WRITER_PASSWORD,
  c25_fixture_lifecycle_login: FIXTURE_LIFECYCLE_PASSWORD,
};
const AUTHORITY_EDGE_OPTIONS = {
  falcone_app: 'WITH ADMIN FALSE, INHERIT TRUE, SET FALSE',
  falcone_webhook_key_writer: 'WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  falcone_webhook_key_lifecycle: 'WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
};

function quoteRole(name) {
  assert.match(name, /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/);
  return `"${name.replaceAll('"', '""')}"`;
}

async function ensureFixedAuthorities(adminPool, { bindFixture = true } = {}) {
  await adminPool.query(`
    DO $bootstrap$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'falcone_app') THEN
        CREATE ROLE falcone_app
          NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'falcone_webhook_key_writer'
      ) THEN
        CREATE ROLE falcone_webhook_key_writer
          NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'falcone_webhook_key_lifecycle'
      ) THEN
        CREATE ROLE falcone_webhook_key_lifecycle
          NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END
    $bootstrap$;
    ALTER ROLE falcone_app
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    ALTER ROLE falcone_webhook_key_writer
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    ALTER ROLE falcone_webhook_key_lifecycle
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  `);
  for (const member of Object.values(FIXTURE_AUTHORITY_MEMBERS)) {
    const password = FIXTURE_LOGIN_PASSWORDS[member];
    await adminPool.query(`
      DO $fixture_login$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${member}') THEN
          CREATE ROLE ${quoteRole(member)}
            LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
            PASSWORD '${password}';
        END IF;
      END
      $fixture_login$;
      ALTER ROLE ${quoteRole(member)}
        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        PASSWORD '${password}';
    `);
  }
  await adminPool.query(`
    DO $fixture_schema_login$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = '${FIXTURE_SCHEMA_LOGIN}'
      ) THEN
        CREATE ROLE ${quoteRole(FIXTURE_SCHEMA_LOGIN)}
          LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
          PASSWORD '${FIXTURE_SCHEMA_PASSWORD}';
      END IF;
    END
    $fixture_schema_login$;
    ALTER ROLE ${quoteRole(FIXTURE_SCHEMA_LOGIN)}
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      PASSWORD '${FIXTURE_SCHEMA_PASSWORD}';
    GRANT USAGE, CREATE ON SCHEMA public TO ${quoteRole(FIXTURE_SCHEMA_LOGIN)};
  `);
  // PostgreSQL 16 can record the role creator as an ADMIN member. The
  // separately authenticated bootstrap owns exact graph repair; application
  // migrations deliberately cannot do this.
  const protectedPrincipals = [
    ...FIXED_AUTHORITIES,
    ...Object.values(FIXTURE_AUTHORITY_MEMBERS),
  ];
  const { rows: existingEdges } = await adminPool.query(
    `SELECT granted.rolname AS granted_name,
            member.rolname AS member_name
       FROM pg_auth_members membership
       JOIN pg_roles granted ON granted.oid = membership.roleid
       JOIN pg_roles member ON member.oid = membership.member
      WHERE granted.rolname = ANY($1::name[])
         OR member.rolname = ANY($1::name[])`,
    [protectedPrincipals],
  );
  for (const { granted_name: granted, member_name: member } of existingEdges) {
    await adminPool.query(`REVOKE ${quoteRole(granted)} FROM ${quoteRole(member)}`);
  }
  if (bindFixture) {
    for (const [authority, member] of Object.entries(FIXTURE_AUTHORITY_MEMBERS)) {
      await adminPool.query(
        `GRANT ${quoteRole(authority)} TO ${quoteRole(member)}`
          + ` ${AUTHORITY_EDGE_OPTIONS[authority]}`,
      );
    }
  }
}

function fixturePrincipalNames(baseUrl) {
  return {
    schema: FIXTURE_SCHEMA_LOGIN,
    runtime: FIXTURE_AUTHORITY_MEMBERS.falcone_app,
    writer: FIXTURE_AUTHORITY_MEMBERS.falcone_webhook_key_writer,
    lifecycle: FIXTURE_AUTHORITY_MEMBERS.falcone_webhook_key_lifecycle,
    grantor: new URL(baseUrl).username,
  };
}

function fixtureSchemaPool(baseUrl, max = 2) {
  return new Pool({
    connectionString: databaseUrlForLogin(
      baseUrl,
      FIXTURE_SCHEMA_LOGIN,
      FIXTURE_SCHEMA_PASSWORD,
    ),
    max,
  });
}

async function applyMigration(pool, name, principalNames) {
  const sql = await readFile(
    new URL(`../../packages/webhook-engine/migrations/${name}`, import.meta.url),
    'utf8',
  );
  if (name !== '004-webhook-master-key-lifecycle.sql') {
    return pool.query(sql);
  }
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
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
    const result = await client.query(sql);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (caught) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve migration failure */ }
    }
    throw caught;
  } finally {
    if (client !== pool) client.release?.();
  }
}

function databaseUrlForLogin(base, username, password) {
  const url = new URL(base);
  url.username = username;
  url.password = password;
  return url.toString();
}

function databaseUrlForDatabaseAndLogin(base, database, username, password) {
  const url = new URL(databaseUrlForLogin(base, username, password));
  url.pathname = `/${database}`;
  return url.toString();
}

async function waitForBlockedActivity(pool, applicationName, queryFragment) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT 1
         FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND datname = current_database()
          AND application_name = $1
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND position($2 in query) > 0
        LIMIT 1`,
      [applicationName, queryFragment],
    );
    if (rows.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for blocked ${applicationName} activity`);
}

async function withLifecycleFence(pool, work) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    // This fixture intentionally exercises the inherently privileged database
    // administrator path, not the production lifecycle repository (which
    // assumes the dedicated NOLOGIN role before taking the same lock).
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [723661, 25]);
    const result = await work(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (caught) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original fixture error */ }
    }
    throw caught;
  } finally {
    client.release();
  }
}

test('migration 004 and the lifecycle execute transactionally on PostgreSQL', {
  skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
}, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  t.after(() => pool.end());
  const adapterWritePool = new Pool({
    connectionString: databaseUrl,
    application_name: 'c25-transactional-adapter-writer',
    max: 1,
  });
  t.after(() => adapterWritePool.end());

  await ensureFixedAuthorities(pool);
  const schemaPool = fixtureSchemaPool(databaseUrl);
  t.after(() => schemaPool.end());
  const principalNames = fixturePrincipalNames(databaseUrl);
  const migration = (name) => applyMigration(schemaPool, name, principalNames);
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plan_audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_type VARCHAR(64) NOT NULL,
      actor_id VARCHAR(255) NOT NULL,
      tenant_id VARCHAR(255),
      plan_id UUID,
      previous_state JSONB,
      new_state JSONB NOT NULL,
      outcome VARCHAR(32),
      correlation_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      prev_hash TEXT,
      row_hash TEXT
    )`);
  await migration('001-webhook-subscriptions.sql');
  // Keep this fixture repeatable on the same disposable database while still
  // modeling rows committed by the pre-004 binary.
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_webhook_signing_secret_write_statement_fence
      ON webhook_signing_secrets;
    DROP TRIGGER IF EXISTS trg_webhook_signing_secret_write_fence
      ON webhook_signing_secrets;
    TRUNCATE webhook_delivery_attempts, webhook_deliveries,
             webhook_signing_secrets, webhook_subscriptions
      RESTART IDENTITY CASCADE;
    DO $reset$
    BEGIN
      IF to_regclass('public.webhook_master_key_rotations') IS NOT NULL THEN
        EXECUTE 'TRUNCATE webhook_master_key_rotations, webhook_master_key_state';
      END IF;
    END
    $reset$;
  `);
  const legacyId = deriveWebhookKeyId('test-ns', 'legacy-key', 'key');
  const targetId = deriveWebhookKeyId('test-ns', 'canonical-key', 'key');
  const legacyMaterial = 'synthetic-postgres-legacy-fixture';
  const targetMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x51));
  const wrongLegacyMaterial = 'synthetic-postgres-legacy-fixture-with-changed-bytes';
  const wrongTargetMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x52));
  const legacy = createLifecycleWebhookKeyContext({
    material: legacyMaterial, keyId: legacyId, mode: 'legacy', purpose: 'adopt',
  });
  const fixtures = [
    { subscription: '10000000-0000-4000-8000-000000000001', secret: 'tenant-a-secret', tenant: 'tenant-a', workspace: 'workspace-a', status: 'active' },
    { subscription: '20000000-0000-4000-8000-000000000002', secret: 'tenant-b-secret', tenant: 'tenant-b', workspace: 'workspace-b', status: 'grace' },
    { subscription: '30000000-0000-4000-8000-000000000003', secret: 'tenant-a-revoked-secret', tenant: 'tenant-a', workspace: 'workspace-c', status: 'revoked' },
  ];
  for (const fixture of fixtures) {
    const encrypted = encryptSecret(fixture.secret, legacy);
    await pool.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES ($1,$2,$3,'https://example.invalid/hook',ARRAY['tenant.created'],'postgres-test')`,
      [fixture.subscription, fixture.tenant, fixture.workspace],
    );
    await pool.query(
      `INSERT INTO webhook_signing_secrets
         (subscription_id, secret_cipher, secret_iv, status, grace_expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,
         CASE WHEN $4 = 'grace' THEN now() + interval '1 day' END,
         CASE WHEN $4 = 'revoked' THEN now() END)`,
      [fixture.subscription, encrypted.cipher, encrypted.iv, fixture.status],
    );
  }

  await migration('002-signing-secret-tenant-scope.sql');
  await migration('003-rls-webhook-tables.sql');
  await migration('004-webhook-master-key-lifecycle.sql');
  await migration('004-webhook-master-key-lifecycle.sql');
  await pool.query(
    `GRANT SELECT, INSERT ON TABLE plan_audit_events
       TO falcone_webhook_key_lifecycle`,
  );

  const repository = buildWebhookMasterKeyRepository(pool, {
    auditWriter: recordAuditEventInTransaction,
  });
  const truncateLifecycleFixtures = () => pool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state,
              plan_audit_events
       RESTART IDENTITY CASCADE`,
  );
  const adopted = await repository.adopt({
    material: legacyMaterial, keyId: legacyId, managed: false,
    requestId: 'postgres-adopt-001',
  });
  assert.equal(adopted.affectedCount, fixtures.length);
  const before = (await pool.query(
    `SELECT id, subscription_id, tenant_id, workspace_id, status, grace_expires_at,
            created_at, revoked_at
       FROM webhook_signing_secrets ORDER BY subscription_id`,
  )).rows;

  await repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  });
  const target = createCanonicalWebhookKeyContext(targetMaterial, targetId);
  const transformed = (await pool.query(
    `SELECT id, subscription_id, tenant_id, workspace_id, status, grace_expires_at,
            created_at, revoked_at, secret_cipher, secret_iv, encryption_key_id
       FROM webhook_signing_secrets ORDER BY subscription_id`,
  )).rows;
  assert.deepEqual(
    transformed.map(({ secret_cipher, secret_iv, encryption_key_id, ...row }) => row),
    before,
  );
  assert.deepEqual(
    transformed.map((row) => decryptSecret(row.secret_cipher, row.secret_iv, target)),
    fixtures.map(({ secret }) => secret),
  );
  assert.ok(transformed.every((row) => row.encryption_key_id === targetId));

  const replay = await repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  });
  assert.equal(replay.state, 'completed');
  await assert.rejects(repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'canonical-v1',
    targetMaterial: wrongTargetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });
  await assert.rejects(repository.rotate({
    sourceMaterial: wrongLegacyMaterial, sourceKeyId: legacyId, sourceMode: 'canonical-v1',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });
  await withLifecycleFence(pool, (client) => client.query(`
    UPDATE webhook_master_key_state
       SET lifecycle_state = 'recovery_required'
     WHERE singleton_id = 1;
    UPDATE webhook_master_key_rotations
       SET lifecycle_state = 'recovery_required'
     WHERE request_id = 'postgres-rotate-001'
  `));
  await assert.rejects(repository.rotate({
    sourceMaterial: wrongLegacyMaterial, sourceKeyId: legacyId, sourceMode: 'canonical-v1',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });
  assert.equal((await pool.query(
    'SELECT lifecycle_state FROM webhook_master_key_state WHERE singleton_id = 1',
  )).rows[0].lifecycle_state, 'recovery_required');
  assert.equal((await repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'canonical-v1',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  })).state, 'completed');
  assert.equal((await pool.query(
    `SELECT count(*)::int AS count FROM webhook_master_key_rotations
      WHERE request_id = 'postgres-rotate-001'`,
  )).rows[0].count, 1);
  const rotateAudit = (await pool.query(
    `SELECT action_type, actor_id, tenant_id, outcome, correlation_id, new_state
       FROM plan_audit_events
      WHERE correlation_id = 'postgres-rotate-001'`,
  )).rows[0];
  assert.equal(rotateAudit.action_type, 'webhook.master-key.rotate');
  assert.equal(rotateAudit.actor_id, 'falcone:platform-maintenance');
  assert.equal(rotateAudit.tenant_id, null);
  assert.equal(rotateAudit.outcome, 'succeeded');
  assert.equal(rotateAudit.new_state.affectedCount, fixtures.length);
  assert.equal(rotateAudit.new_state.verifiedCount, fixtures.length);
  assert.doesNotMatch(JSON.stringify(rotateAudit), /secret_cipher|secret_iv|v1:[A-Za-z0-9_-]{43}/);

  const recovered = await repository.recover({
    currentMaterial: targetMaterial, currentKeyId: targetId, currentMode: 'canonical-v1',
    targetMaterial: legacyMaterial, targetKeyId: legacyId, targetMode: 'legacy',
    targetManaged: false,
    requestId: 'postgres-recover-001', rotationId: 'postgres-recovery-001',
    recoveryWindowSeconds: 3600, quiesced: true, now: new Date(),
  });
  assert.equal(recovered.affectedCount, fixtures.length);
  await assert.rejects(repository.authorizeQuiescedReplay({
    requestId: 'postgres-rotate-001',
    action: 'rotate',
    rotationId: 'postgres-rotation-001',
    sourceKeyId: legacyId,
    targetKeyId: targetId,
    targetManaged: true,
    recoveryWindowSeconds: 3600,
  }), { code: 'WEBHOOK_KEY_STATE_CONFLICT' });
  await assert.rejects(repository.recover({
    currentMaterial: targetMaterial, currentKeyId: targetId, currentMode: 'legacy',
    targetMaterial: wrongLegacyMaterial, targetKeyId: legacyId, targetMode: 'canonical-v1',
    targetManaged: false,
    requestId: 'postgres-recover-001', rotationId: 'postgres-recovery-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });
  await pool.query(
    `UPDATE webhook_master_key_state
        SET recovery_deadline = '2026-07-23T11:00:00.000Z'
      WHERE singleton_id = 1`,
  );
  await withLifecycleFence(pool, (client) => client.query(
    `UPDATE webhook_signing_secrets SET encryption_key_id = NULL
      WHERE id = (SELECT id FROM webhook_signing_secrets ORDER BY id LIMIT 1)`,
  ));
  await assert.rejects(repository.finalize({
    material: legacyMaterial, keyId: legacyId, mode: 'legacy',
    recoveryKeyId: targetId, requestId: 'postgres-finalize-mixed',
    now: new Date('2026-07-23T12:00:00.000Z'),
  }), { code: 'WEBHOOK_ROW_KEY_MISMATCH' });
  assert.equal((await pool.query(
    'SELECT recovery_key_id FROM webhook_master_key_state WHERE singleton_id = 1',
  )).rows[0].recovery_key_id, targetId);
  await withLifecycleFence(pool, (client) => client.query(
    'UPDATE webhook_signing_secrets SET encryption_key_id = $1 WHERE encryption_key_id IS NULL',
    [legacyId],
  ));
  const finalized = await repository.finalize({
    material: legacyMaterial, keyId: legacyId, mode: 'legacy',
    recoveryKeyId: targetId, requestId: 'postgres-finalize-001',
    now: new Date('2026-07-23T12:00:00.000Z'),
  });
  assert.equal(finalized.affectedCount, fixtures.length);
  assert.equal((await pool.query(
    'SELECT recovery_key_id FROM webhook_master_key_state WHERE singleton_id = 1',
  )).rows[0].recovery_key_id, null);
  await assert.rejects(repository.finalize({
    material: wrongLegacyMaterial, keyId: legacyId, mode: 'legacy',
    recoveryKeyId: targetId, requestId: 'postgres-finalize-001',
    now: new Date('2026-07-23T12:00:00.000Z'),
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });

  const lifecycleColumns = (await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('webhook_master_key_state','webhook_master_key_rotations')`,
  )).rows.map(({ column_name }) => column_name);
  assert.ok(lifecycleColumns.every((name) => !/(key_bytes|key_digest|plaintext|secret_value)/.test(name)));

  await truncateLifecycleFixtures();
  const initialized = await repository.initializeOrVerify({
    material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true,
  });
  assert.equal(initialized.keyId, targetId);
  assert.equal((await repository.initializeOrVerify({
    material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true,
  })).keyId, targetId);
  await assert.rejects(repository.initializeOrVerify({
    material: formatCanonicalWebhookKey(Buffer.alloc(32, 0x52)),
    keyId: targetId, mode: 'canonical-v1', managed: true,
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });

  await pool.query(
    `INSERT INTO webhook_subscriptions
       (id, tenant_id, workspace_id, target_url, event_types, created_by)
     VALUES ('40000000-0000-4000-8000-000000000004','tenant-c','workspace-d',
       'https://example.invalid/hook',ARRAY['tenant.created'],'postgres-test')`,
  );
  const unlabeled = encryptSecret('unlabeled-secret', target);
  await withLifecycleFence(pool, (client) => client.query(
    `INSERT INTO webhook_signing_secrets
       (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status, encryption_key_id)
     VALUES ('40000000-0000-4000-8000-000000000004','tenant-c','workspace-d',$1,$2,'active',NULL)`,
    [unlabeled.cipher, unlabeled.iv],
  ));
  await assert.rejects(repository.initializeOrVerify({
    material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true,
  }), { code: 'WEBHOOK_ROW_KEY_MISMATCH' });

  const custodyDirections = [
    { name: 'external-to-external', currentManaged: false, recoveryManaged: false },
    { name: 'external-to-managed', currentManaged: false, recoveryManaged: true },
    { name: 'managed-to-external', currentManaged: true, recoveryManaged: false },
    { name: 'managed-to-managed', currentManaged: true, recoveryManaged: true },
  ];
  for (const [index, direction] of custodyDirections.entries()) {
    await truncateLifecycleFixtures();
    const caseLegacyId = deriveWebhookKeyId(
      'test-ns',
      `legacy-key-${direction.name}`,
      'key',
    );
    const caseTargetId = deriveWebhookKeyId(
      'test-ns',
      `canonical-key-${direction.name}`,
      'key',
    );
    const caseLegacyMaterial = `synthetic-postgres-${direction.name}-legacy`;
    const caseTargetMaterial = formatCanonicalWebhookKey(
      Buffer.alloc(32, 0x60 + index),
    );
    const caseLegacy = createLifecycleWebhookKeyContext({
      material: caseLegacyMaterial,
      keyId: caseLegacyId,
      mode: 'legacy',
      purpose: 'adopt',
    });
    const encrypted = encryptSecret(`secret-${direction.name}`, caseLegacy);
    const subscriptionId = `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await pool.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES ($1,$2,$3,'https://example.invalid/hook',
         ARRAY['tenant.created'],'postgres-custody-test')`,
      [subscriptionId, `tenant-${index}`, `workspace-${index}`],
    );
    await withLifecycleFence(pool, (client) => client.query(
      `INSERT INTO webhook_signing_secrets
         (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [
        subscriptionId,
        `tenant-${index}`,
        `workspace-${index}`,
        encrypted.cipher,
        encrypted.iv,
      ],
    ));

    const adoptRequestId = `postgres-adopt-${direction.name}`;
    await repository.adopt({
      material: caseLegacyMaterial,
      keyId: caseLegacyId,
      managed: direction.recoveryManaged,
      requestId: adoptRequestId,
    });
    await assert.rejects(repository.adopt({
      material: caseLegacyMaterial,
      keyId: caseLegacyId,
      managed: !direction.recoveryManaged,
      requestId: adoptRequestId,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const adoptBinding = {
      requestId: adoptRequestId,
      action: 'adopt',
      targetKeyId: caseLegacyId,
      targetManaged: direction.recoveryManaged,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(adoptBinding)).targetManaged,
      direction.recoveryManaged,
    );
    await assert.rejects(repository.authorizeQuiescedReplay({
      ...adoptBinding,
      targetManaged: !direction.recoveryManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });

    const rotateRequest = {
      sourceMaterial: caseLegacyMaterial,
      sourceKeyId: caseLegacyId,
      sourceMode: 'legacy',
      targetMaterial: caseTargetMaterial,
      targetKeyId: caseTargetId,
      targetManaged: direction.currentManaged,
      requestId: `postgres-rotate-${direction.name}`,
      rotationId: `postgres-rotation-${direction.name}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    };
    await repository.rotate(rotateRequest);
    await assert.rejects(repository.authorizeQuiescedReplay(adoptBinding), {
      code: 'WEBHOOK_KEY_STATE_CONFLICT',
    });
    await assert.rejects(repository.rotate({
      ...rotateRequest,
      targetManaged: !direction.currentManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const rotateBinding = {
      requestId: rotateRequest.requestId,
      action: 'rotate',
      rotationId: rotateRequest.rotationId,
      sourceKeyId: caseLegacyId,
      targetKeyId: caseTargetId,
      targetManaged: direction.currentManaged,
      recoveryWindowSeconds: 3600,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(rotateBinding)).targetManaged,
      direction.currentManaged,
    );
    await assert.rejects(repository.authorizeQuiescedReplay({
      ...rotateBinding,
      targetManaged: !direction.currentManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const rotateReplay = await repository.rotate({
      ...rotateRequest,
      sourceMode: 'canonical-v1',
    });
    assert.equal(rotateReplay.requestId, rotateRequest.requestId);
    assert.equal(rotateReplay.state, 'completed');

    const beforeMismatchState = (await pool.query(
      'SELECT * FROM webhook_master_key_state WHERE singleton_id = 1',
    )).rows[0];
    const beforeMismatchRows = (await pool.query(
      `SELECT id, secret_cipher, secret_iv, encryption_key_id
         FROM webhook_signing_secrets ORDER BY id`,
    )).rows;
    const mismatchRequestId = `postgres-recover-mismatch-${direction.name}`;
    await assert.rejects(repository.recover({
      currentMaterial: caseTargetMaterial,
      currentKeyId: caseTargetId,
      currentMode: 'canonical-v1',
      targetMaterial: caseLegacyMaterial,
      targetKeyId: caseLegacyId,
      targetMode: 'legacy',
      targetManaged: !direction.recoveryManaged,
      requestId: mismatchRequestId,
      rotationId: `postgres-recovery-mismatch-${direction.name}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    }), { code: 'WEBHOOK_KEY_CUSTODY_CONFLICT' });
    assert.deepEqual((await pool.query(
      'SELECT * FROM webhook_master_key_state WHERE singleton_id = 1',
    )).rows[0], beforeMismatchState);
    assert.deepEqual((await pool.query(
      `SELECT id, secret_cipher, secret_iv, encryption_key_id
         FROM webhook_signing_secrets ORDER BY id`,
    )).rows, beforeMismatchRows);
    const mismatchLedger = (await pool.query(
      `SELECT target_managed, lifecycle_state, error_code, error_message
         FROM webhook_master_key_rotations WHERE request_id = $1`,
      [mismatchRequestId],
    )).rows[0];
    assert.equal(mismatchLedger.target_managed, !direction.recoveryManaged);
    assert.equal(mismatchLedger.lifecycle_state, 'failed');
    assert.equal(mismatchLedger.error_code, 'WEBHOOK_KEY_CUSTODY_CONFLICT');
    assert.equal(
      mismatchLedger.error_message,
      'Webhook key custody conflicts with durable lifecycle state',
    );

    const recoverRequest = {
      currentMaterial: caseTargetMaterial,
      currentKeyId: caseTargetId,
      currentMode: 'canonical-v1',
      targetMaterial: caseLegacyMaterial,
      targetKeyId: caseLegacyId,
      targetMode: 'legacy',
      targetManaged: direction.recoveryManaged,
      requestId: `postgres-recover-${direction.name}`,
      rotationId: `postgres-recovery-${direction.name}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    };
    const custodyRecovery = await repository.recover(recoverRequest);
    assert.equal(custodyRecovery.sourceManaged, direction.currentManaged);
    assert.equal(custodyRecovery.targetManaged, direction.recoveryManaged);
    const recoveredState = (await pool.query(
      `SELECT current_key_id, current_managed, recovery_key_id, recovery_managed
         FROM webhook_master_key_state WHERE singleton_id = 1`,
    )).rows[0];
    assert.deepEqual(recoveredState, {
      current_key_id: caseLegacyId,
      current_managed: direction.recoveryManaged,
      recovery_key_id: caseTargetId,
      recovery_managed: direction.currentManaged,
    });
    const recoveredLedger = (await pool.query(
      `SELECT source_managed, target_managed
         FROM webhook_master_key_rotations WHERE request_id = $1`,
      [recoverRequest.requestId],
    )).rows[0];
    assert.deepEqual(recoveredLedger, {
      source_managed: direction.currentManaged,
      target_managed: direction.recoveryManaged,
    });
    const recoveredAudit = (await pool.query(
      `SELECT new_state FROM plan_audit_events
        WHERE correlation_id = $1 AND outcome = 'succeeded'`,
      [recoverRequest.requestId],
    )).rows[0].new_state;
    assert.equal(recoveredAudit.sourceManaged, direction.currentManaged);
    assert.equal(recoveredAudit.targetManaged, direction.recoveryManaged);
    const recoverReplay = await repository.recover({
      ...recoverRequest,
      currentMode: 'legacy',
      targetMode: 'canonical-v1',
    });
    assert.equal(recoverReplay.requestId, recoverRequest.requestId);
    assert.equal(recoverReplay.state, 'completed');
    await assert.rejects(repository.recover({
      ...recoverRequest,
      targetManaged: !direction.recoveryManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const recoverBinding = {
      requestId: recoverRequest.requestId,
      action: 'recover',
      rotationId: recoverRequest.rotationId,
      sourceKeyId: caseTargetId,
      targetKeyId: caseLegacyId,
      targetManaged: direction.recoveryManaged,
      recoveryWindowSeconds: 3600,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(recoverBinding)).targetManaged,
      direction.recoveryManaged,
    );
    await assert.rejects(repository.authorizeQuiescedReplay({
      ...recoverBinding,
      targetManaged: !direction.recoveryManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
  }
  await truncateLifecycleFixtures();

  // The ordinary RLS role has no lifecycle-table or encrypted-column write
  // privilege. A direct encrypted insert is denied either at the privilege
  // boundary or, on an older grant shape, by the database trigger. Only the
  // dedicated writer path below may complete the insert.
  await repository.initializeOrVerify({
    material: targetMaterial,
    keyId: targetId,
    mode: 'canonical-v1',
    managed: true,
  });
  const rolePrivileges = (await pool.query(
    `SELECT has_table_privilege('falcone_app', 'webhook_master_key_state', 'SELECT') AS state_select,
            has_function_privilege(
              'falcone_app',
              'falcone_webhook_key_write_current_id()',
              'EXECUTE'
            ) AS identity_execute`,
  )).rows[0];
  assert.equal(rolePrivileges.state_select, false);
  assert.equal(rolePrivileges.identity_execute, false);
  const rlsSubscription = '80000000-0000-4000-8000-000000000001';
  await pool.query(
    `INSERT INTO webhook_subscriptions
       (id, tenant_id, workspace_id, target_url, event_types, created_by)
     VALUES ($1,'tenant-rls','workspace-rls',
       'https://example.invalid/hook',ARRAY['tenant.created'],'postgres-rls-test')`,
    [rlsSubscription],
  );
  const rlsEncrypted = encryptSecret('rls-role-secret', target);
  await assert.rejects(async () => {
    const rlsClient = await pool.connect();
    try {
      await rlsClient.query('BEGIN');
      await rlsClient.query('SET LOCAL ROLE falcone_app');
      await rlsClient.query("SELECT set_config('app.tenant_id', 'tenant-rls', true)");
      await rlsClient.query("SELECT set_config('app.workspace_id', 'workspace-rls', true)");
      await rlsClient.query('SELECT pg_advisory_xact_lock_shared($1, $2)', [723661, 25]);
      await rlsClient.query(
        `INSERT INTO webhook_signing_secrets
           (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status, encryption_key_id)
         VALUES ($1,'tenant-rls','workspace-rls',$2,$3,'active',$4)`,
        [rlsSubscription, rlsEncrypted.cipher, rlsEncrypted.iv, targetId],
      );
      await rlsClient.query('COMMIT');
    } finally {
      try { await rlsClient.query('ROLLBACK'); } catch { /* transaction may already be aborted */ }
      rlsClient.release();
    }
  }, (caught) => ['42501', '55000'].includes(caught?.code));
  await buildWebhookDb(pool, { writePool: adapterWritePool }).insertSecret(
    rlsSubscription,
    rlsEncrypted,
    'tenant-rls',
    'workspace-rls',
    targetId,
  );
  assert.deepEqual((await pool.query(
    `SELECT tenant_id, workspace_id, encryption_key_id
       FROM webhook_signing_secrets WHERE subscription_id = $1`,
    [rlsSubscription],
  )).rows[0], {
    tenant_id: 'tenant-rls',
    workspace_id: 'workspace-rls',
    encryption_key_id: targetId,
  });
  await truncateLifecycleFixtures();
});

test('ordinary writers and lifecycle snapshots honor the shared/exclusive PostgreSQL fence', {
  skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
  timeout: 30_000,
}, async (t) => {
  const adminPool = new Pool({
    connectionString: databaseUrl,
    application_name: 'c25-race-observer',
    max: 2,
  });
  const lifecyclePool = new Pool({
    connectionString: databaseUrl,
    application_name: 'c25-race-lifecycle',
    max: 1,
  });
  const writerPool = new Pool({
    connectionString: databaseUrl,
    application_name: 'c25-race-writer',
    max: 1,
  });
  let blocker = null;
  let blockerInTransaction = false;
  let rotationPromise = null;
  let writerOutcomePromise = null;

  t.after(async () => {
    if (blockerInTransaction) {
      try { await blocker.query('ROLLBACK'); } catch { /* best-effort fixture cleanup */ }
    }
    blocker?.release();
    await Promise.allSettled([rotationPromise, writerOutcomePromise].filter(Boolean));
    try {
      await adminPool.query(
        `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
                  webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
           RESTART IDENTITY CASCADE`,
      );
    } catch { /* preserve the test result while still closing every pool */ }
    await Promise.all([writerPool.end(), lifecyclePool.end(), adminPool.end()]);
  });

  await ensureFixedAuthorities(adminPool);
  await adminPool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
       RESTART IDENTITY CASCADE`,
  );

  const sourceMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x71));
  const targetMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x72));
  const sourceKeyId = deriveWebhookKeyId('test-ns', 'race-source', 'key');
  const targetKeyId = deriveWebhookKeyId('test-ns', 'race-target', 'key');
  const sourceContext = createCanonicalWebhookKeyContext(sourceMaterial, sourceKeyId);
  const targetContext = createCanonicalWebhookKeyContext(targetMaterial, targetKeyId);
  const lifecycle = buildWebhookMasterKeyRepository(lifecyclePool);
  const ordinaryWriter = buildWebhookDb(adminPool, { writePool: writerPool });

  await lifecycle.initializeOrVerify({
    material: sourceMaterial,
    keyId: sourceKeyId,
    mode: 'canonical-v1',
    managed: true,
  });

  const existingSubscription = '60000000-0000-4000-8000-000000000001';
  const racingSubscription = '60000000-0000-4000-8000-000000000002';
  for (const [subscriptionId, tenantId, workspaceId] of [
    [existingSubscription, 'tenant-race-a', 'workspace-race-a'],
    [racingSubscription, 'tenant-race-b', 'workspace-race-b'],
  ]) {
    await adminPool.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES ($1,$2,$3,'https://example.invalid/hook',
         ARRAY['tenant.created'],'postgres-race-test')`,
      [subscriptionId, tenantId, workspaceId],
    );
  }
  const existingEncrypted = encryptSecret('existing-race-secret', sourceContext);
  await ordinaryWriter.insertSecret(
    existingSubscription,
    existingEncrypted,
    'tenant-race-a',
    'workspace-race-a',
    sourceKeyId,
  );

  blocker = await adminPool.connect();
  await blocker.query('BEGIN');
  blockerInTransaction = true;
  await blocker.query(
    `SELECT id
       FROM webhook_signing_secrets
      WHERE subscription_id = $1
      FOR UPDATE`,
    [existingSubscription],
  );

  rotationPromise = lifecycle.rotate({
    sourceMaterial,
    sourceKeyId,
    sourceMode: 'canonical-v1',
    targetMaterial,
    targetKeyId,
    targetManaged: true,
    requestId: 'postgres-race-rotate-001',
    rotationId: 'postgres-race-rotation-001',
    recoveryWindowSeconds: 3600,
    quiesced: true,
  });
  await waitForBlockedActivity(adminPool, 'c25-race-lifecycle', 'FOR UPDATE');

  const staleEncrypted = encryptSecret('stale-race-secret', sourceContext);
  // Deliberately bypass the updated adapter to reproduce an old/direct writer.
  // Migration 004's trigger must acquire the shared lock inside PostgreSQL and
  // reject the stale source identity after the lifecycle commit.
  writerOutcomePromise = writerPool.query(
    `INSERT INTO webhook_signing_secrets
       (subscription_id, secret_cipher, secret_iv, status, tenant_id, workspace_id, encryption_key_id)
     VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
    [
      racingSubscription,
      staleEncrypted.cipher,
      staleEncrypted.iv,
      'tenant-race-b',
      'workspace-race-b',
      sourceKeyId,
    ],
  ).then(
    () => ({ written: true, error: null }),
    (error) => ({ written: false, error }),
  );
  await waitForBlockedActivity(
    adminPool,
    'c25-race-writer',
    'INSERT INTO webhook_signing_secrets',
  );

  await blocker.query('COMMIT');
  blockerInTransaction = false;
  blocker.release();
  blocker = null;

  const rotated = await rotationPromise;
  assert.equal(rotated.affectedCount, 1);
  assert.equal(rotated.verifiedCount, 1);

  const writerOutcome = await writerOutcomePromise;
  assert.equal(writerOutcome.written, false);
  assert.equal(writerOutcome.error?.code, '55000');
  assert.equal(writerOutcome.error?.message, 'WEBHOOK_KEY_WRITE_FENCED');
  assert.doesNotMatch(
    writerOutcome.error?.message ?? '',
    /tenant-race|workspace-race|race-source|race-target|stale-race-secret/,
  );
  await assert.rejects(
    ordinaryWriter.insertSecret(
      racingSubscription,
      staleEncrypted,
      'tenant-race-b',
      'workspace-race-b',
      sourceKeyId,
    ),
    (error) => {
      assert.equal(error.code, 'WEBHOOK_KEY_UNAVAILABLE');
      assert.equal(error.message, 'Webhook key lifecycle is not ready');
      assert.doesNotMatch(
        error.message,
        /tenant-race|workspace-race|race-source|race-target|stale-race-secret/,
      );
      return true;
    },
  );
  await assert.rejects(
    writerPool.query(
      `UPDATE webhook_signing_secrets
          SET secret_cipher = $2, secret_iv = $3
        WHERE subscription_id = $1`,
      [existingSubscription, staleEncrypted.cipher, staleEncrypted.iv],
    ),
    (error) => {
      assert.equal(error.code, '55000');
      assert.equal(error.message, 'WEBHOOK_KEY_WRITE_FENCED');
      assert.doesNotMatch(
        error.message,
        /tenant-race|workspace-race|race-source|race-target|stale-race-secret/,
      );
      return true;
    },
  );

  const { rows } = await adminPool.query(
    `SELECT subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv,
            encryption_key_id
       FROM webhook_signing_secrets
      ORDER BY subscription_id`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subscription_id, existingSubscription);
  assert.equal(rows[0].tenant_id, 'tenant-race-a');
  assert.equal(rows[0].workspace_id, 'workspace-race-a');
  assert.equal(rows[0].encryption_key_id, targetKeyId);
  assert.equal(
    decryptSecret(rows[0].secret_cipher, rows[0].secret_iv, targetContext),
    'existing-race-secret',
  );

  const verified = await lifecycle.initializeOrVerify({
    material: targetMaterial,
    keyId: targetKeyId,
    mode: 'canonical-v1',
    managed: true,
  });
  assert.equal(verified.keyId, targetKeyId);

  // Reverse the ordering: an ordinary per-subscription rotation owns the
  // shared fence but is blocked on its active row. The lifecycle exclusive
  // fence must wait for that complete update+insert transaction, then include
  // both rows in its transformation snapshot.
  await adminPool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
       RESTART IDENTITY CASCADE`,
  );
  await lifecycle.initializeOrVerify({
    material: sourceMaterial,
    keyId: sourceKeyId,
    mode: 'canonical-v1',
    managed: true,
  });
  const inFlightSubscription = '70000000-0000-4000-8000-000000000001';
  await adminPool.query(
    `INSERT INTO webhook_subscriptions
       (id, tenant_id, workspace_id, target_url, event_types, created_by)
     VALUES ($1,'tenant-in-flight','workspace-in-flight',
       'https://example.invalid/hook',ARRAY['tenant.created'],'postgres-race-test')`,
    [inFlightSubscription],
  );
  await ordinaryWriter.insertSecret(
    inFlightSubscription,
    encryptSecret('in-flight-old-secret', sourceContext),
    'tenant-in-flight',
    'workspace-in-flight',
    sourceKeyId,
  );

  blocker = await adminPool.connect();
  await blocker.query('BEGIN');
  blockerInTransaction = true;
  await blocker.query(
    `SELECT id
       FROM webhook_signing_secrets
      WHERE subscription_id = $1 AND status = 'active'
      FOR UPDATE`,
    [inFlightSubscription],
  );

  writerOutcomePromise = ordinaryWriter.rotateSecret(
    inFlightSubscription,
    encryptSecret('in-flight-new-secret', sourceContext),
    '2026-07-24T00:00:00.000Z',
    'tenant-in-flight',
    'workspace-in-flight',
    sourceKeyId,
  ).then(
    () => ({ written: true, error: null }),
    (error) => ({ written: false, error }),
  );
  await waitForBlockedActivity(
    adminPool,
    'c25-race-writer',
    'UPDATE webhook_signing_secrets',
  );

  rotationPromise = lifecycle.rotate({
    sourceMaterial,
    sourceKeyId,
    sourceMode: 'canonical-v1',
    targetMaterial,
    targetKeyId,
    targetManaged: true,
    requestId: 'postgres-in-flight-rotate-001',
    rotationId: 'postgres-in-flight-rotation-001',
    recoveryWindowSeconds: 3600,
    quiesced: true,
  });
  await waitForBlockedActivity(
    adminPool,
    'c25-race-lifecycle',
    'pg_advisory_xact_lock(',
  );

  await blocker.query('COMMIT');
  blockerInTransaction = false;
  blocker.release();
  blocker = null;

  const inFlightWriterOutcome = await writerOutcomePromise;
  assert.equal(inFlightWriterOutcome.written, true);
  assert.equal(inFlightWriterOutcome.error, null);
  const inFlightRotation = await rotationPromise;
  assert.equal(inFlightRotation.affectedCount, 2);
  assert.equal(inFlightRotation.verifiedCount, 2);

  const { rows: transformedRows } = await adminPool.query(
    `SELECT tenant_id, workspace_id, status, secret_cipher, secret_iv,
            encryption_key_id
       FROM webhook_signing_secrets
      WHERE subscription_id = $1
      ORDER BY status`,
    [inFlightSubscription],
  );
  assert.equal(transformedRows.length, 2);
  assert.ok(transformedRows.every((row) => row.tenant_id === 'tenant-in-flight'));
  assert.ok(transformedRows.every((row) => row.workspace_id === 'workspace-in-flight'));
  assert.ok(transformedRows.every((row) => row.encryption_key_id === targetKeyId));
  assert.deepEqual(
    transformedRows
      .map((row) => decryptSecret(row.secret_cipher, row.secret_iv, targetContext))
      .sort(),
    ['in-flight-new-secret', 'in-flight-old-secret'],
  );
});

test('exclusive advisory-lock possession is insufficient without lifecycle database authority', {
  skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
  timeout: 30_000,
}, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const schemaPool = fixtureSchemaPool(databaseUrl);
  const adapterWritePool = new Pool({
    connectionString: databaseUrl,
    application_name: 'c25-authority-adapter-writer',
    max: 1,
  });
  t.after(async () => {
    try {
      await pool.query(
        `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
                  webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
           RESTART IDENTITY CASCADE`,
      );
    } finally {
      await adapterWritePool.end();
      await schemaPool.end();
      await pool.end();
    }
  });
  await ensureFixedAuthorities(pool);
  const migration = (name) => applyMigration(
    schemaPool,
    name,
    fixturePrincipalNames(databaseUrl),
  );
  await migration('001-webhook-subscriptions.sql');
  await migration('002-signing-secret-tenant-scope.sql');
  await migration('003-rls-webhook-tables.sql');
  await migration('004-webhook-master-key-lifecycle.sql');
  await migration('004-webhook-master-key-lifecycle.sql');
  await pool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
       RESTART IDENTITY CASCADE`,
  );

  const role = (await pool.query(
    `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
            pg_has_role('falcone_app', 'falcone_webhook_key_lifecycle', 'MEMBER') AS app_member,
            has_table_privilege(
              'falcone_app',
              'webhook_master_key_state',
              'SELECT'
            ) AS app_state_select
       FROM pg_roles
      WHERE rolname = 'falcone_webhook_key_lifecycle'`,
  )).rows[0];
  assert.deepEqual(role, {
    rolcanlogin: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    app_member: false,
    app_state_select: false,
  });

  const sourceMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x31));
  const foreignMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x32));
  const sourceKeyId = deriveWebhookKeyId('test-ns', 'authority-source', 'key');
  const foreignKeyId = deriveWebhookKeyId('test-ns', 'authority-foreign', 'key');
  const sourceContext = createCanonicalWebhookKeyContext(sourceMaterial, sourceKeyId);
  const foreignContext = createCanonicalWebhookKeyContext(foreignMaterial, foreignKeyId);
  const lifecycle = buildWebhookMasterKeyRepository(pool);
  const writer = buildWebhookDb(pool, { writePool: adapterWritePool });
  await lifecycle.initializeOrVerify({
    material: sourceMaterial,
    keyId: sourceKeyId,
    mode: 'canonical-v1',
    managed: true,
  });

  const existingSubscription = '91000000-0000-4000-8000-000000000001';
  const rejectedSubscription = '91000000-0000-4000-8000-000000000002';
  for (const id of [existingSubscription, rejectedSubscription]) {
    await pool.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES ($1,'tenant-authority','workspace-authority',
         'https://example.invalid/hook',ARRAY['document.created'],'authority-test')`,
      [id],
    );
  }
  await writer.insertSecret(
    existingSubscription,
    encryptSecret('authorized-source-secret', sourceContext),
    'tenant-authority',
    'workspace-authority',
    sourceKeyId,
  );

  const constrainedWrite = async (sql, params) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE falcone_app');
      await client.query("SELECT set_config('app.tenant_id', 'tenant-authority', true)");
      await client.query("SELECT set_config('app.workspace_id', 'workspace-authority', true)");
      await client.query(
        "SELECT set_config('falcone.webhook_key_write_id', $1, true)",
        [sourceKeyId],
      );
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [723661, 25]);
      await client.query(sql, params);
      await client.query('COMMIT');
      assert.fail('constrained write unexpectedly committed');
    } catch (caught) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the trigger result */ }
      assert.ok(['42501', '55000'].includes(caught.code));
      if (caught.code === '55000') {
        assert.equal(caught.message, 'WEBHOOK_KEY_WRITE_FENCED');
        assert.doesNotMatch(
          caught.message,
          /tenant-authority|workspace-authority|authority-source|authority-foreign/,
        );
      }
    } finally {
      client.release();
    }
  };
  const foreignEncrypted = encryptSecret('foreign-secret', foreignContext);
  await constrainedWrite(
    `INSERT INTO webhook_signing_secrets
       (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status, encryption_key_id)
     VALUES ($1,'tenant-authority','workspace-authority',$2,$3,'active',$4)`,
    [rejectedSubscription, foreignEncrypted.cipher, foreignEncrypted.iv, sourceKeyId],
  );
  await constrainedWrite(
    `UPDATE webhook_signing_secrets
      SET secret_cipher = $2, secret_iv = $3, encryption_key_id = $4
      WHERE subscription_id = $1`,
    [existingSubscription, foreignEncrypted.cipher, foreignEncrypted.iv, sourceKeyId],
  );
  const afterRejectedWrites = (await pool.query(
    `SELECT subscription_id, secret_cipher, secret_iv, encryption_key_id
       FROM webhook_signing_secrets ORDER BY subscription_id`,
  )).rows;
  assert.equal(afterRejectedWrites.length, 1);
  assert.equal(afterRejectedWrites[0].subscription_id, existingSubscription);
  assert.equal(afterRejectedWrites[0].encryption_key_id, sourceKeyId);
  assert.equal(
    decryptSecret(afterRejectedWrites[0].secret_cipher, afterRejectedWrites[0].secret_iv, sourceContext),
    'authorized-source-secret',
  );

  // Positive control: the dedicated effective role has relation-scoped grants
  // and an RLS policy, so it can execute every transformation while holding the
  // same exclusive serialization fence.
  await pool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
       RESTART IDENTITY CASCADE`,
  );
  const legacyMaterial = 'authority-positive-legacy-material';
  const legacyKeyId = deriveWebhookKeyId('test-ns', 'authority-legacy', 'key');
  const targetMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x33));
  const targetKeyId = deriveWebhookKeyId('test-ns', 'authority-target', 'key');
  const legacyContext = createLifecycleWebhookKeyContext({
    material: legacyMaterial,
    keyId: legacyKeyId,
    mode: 'legacy',
    purpose: 'adopt',
  });
  const lifecycleSubscription = '92000000-0000-4000-8000-000000000001';
  const legacyEncrypted = encryptSecret('authority-positive-secret', legacyContext);
  await pool.query(
    `INSERT INTO webhook_subscriptions
       (id, tenant_id, workspace_id, target_url, event_types, created_by)
     VALUES ($1,'tenant-positive','workspace-positive',
       'https://example.invalid/hook',ARRAY['document.created'],'authority-test')`,
    [lifecycleSubscription],
  );
  await withLifecycleFence(pool, (client) => client.query(
    `INSERT INTO webhook_signing_secrets
       (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status)
     VALUES ($1,'tenant-positive','workspace-positive',$2,$3,'active')`,
    [lifecycleSubscription, legacyEncrypted.cipher, legacyEncrypted.iv],
  ));

  const authorizedLifecycle = buildWebhookMasterKeyRepository(pool);
  const adopted = await authorizedLifecycle.adopt({
    material: legacyMaterial,
    keyId: legacyKeyId,
    managed: false,
    requestId: 'authority-adopt-001',
  });
  assert.equal(adopted.state, 'completed');
  const rotated = await authorizedLifecycle.rotate({
    sourceMaterial: legacyMaterial,
    sourceKeyId: legacyKeyId,
    sourceMode: 'legacy',
    targetMaterial,
    targetKeyId,
    targetManaged: true,
    requestId: 'authority-rotate-001',
    rotationId: 'authority-rotation-001',
    recoveryWindowSeconds: 3600,
    quiesced: true,
  });
  assert.equal(rotated.state, 'completed');
  const recovered = await authorizedLifecycle.recover({
    currentMaterial: targetMaterial,
    currentKeyId: targetKeyId,
    currentMode: 'canonical-v1',
    targetMaterial: legacyMaterial,
    targetKeyId: legacyKeyId,
    targetMode: 'legacy',
    targetManaged: false,
    requestId: 'authority-recover-001',
    rotationId: 'authority-recovery-001',
    recoveryWindowSeconds: 3600,
    quiesced: true,
    now: new Date('2026-07-24T00:00:00.000Z'),
  });
  assert.equal(recovered.state, 'completed');
  const finalized = await authorizedLifecycle.finalize({
    material: legacyMaterial,
    keyId: legacyKeyId,
    mode: 'legacy',
    recoveryKeyId: targetKeyId,
    requestId: 'authority-finalize-001',
    now: new Date('2026-07-24T02:00:00.000Z'),
  });
  assert.equal(finalized.state, 'completed');
  const finalRow = (await pool.query(
    `SELECT secret_cipher, secret_iv, encryption_key_id
       FROM webhook_signing_secrets WHERE subscription_id = $1`,
    [lifecycleSubscription],
  )).rows[0];
  assert.equal(finalRow.encryption_key_id, legacyKeyId);
  assert.equal(
    decryptSecret(finalRow.secret_cipher, finalRow.secret_iv, legacyContext),
    'authority-positive-secret',
  );
});

for (const rlsEnabled of [false, true]) {
  const rlsLabel = rlsEnabled ? 'RLS present' : 'RLS absent';
  test(`distinct authenticated runtime, schema, writer, and lifecycle principals reject same-ID wrong-cipher attacks (${rlsLabel})`, {
    skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
    timeout: 45_000,
  }, async (t) => {
    const baseAdminPool = new Pool({ connectionString: databaseUrl, max: 2 });
    const suffix = `${process.pid}_${rlsEnabled ? 'rls' : 'plain'}`;
    const databaseName = `c25_principals_${suffix}`;
    const alternateGrantor = `c25_grantor_${suffix}`;
    const unexpectedAclRole = `c25_acl_${suffix}`;
    const dependentGrantor = `c25_acl_grantor_${suffix}`;
    const dependentDownstream = `c25_acl_downstream_${suffix}`;
    const nonEnumeratedRelation = `c25_acl_control_${suffix}`;
    const names = {
      schema: `c25_schema_${suffix}`,
      runtime: `c25_runtime_${suffix}`,
      writer: `c25_key_writer_${suffix}`,
      lifecycle: `c25_lifecycle_${suffix}`,
      grantor: new URL(databaseUrl).username,
    };
    const boundedLoginNames = [
      names.schema,
      names.runtime,
      names.writer,
      names.lifecycle,
    ];
    const passwords = {
      schema: `SchemaSynthetic${suffix}x9`,
      runtime: `RuntimeSynthetic${suffix}x9`,
      writer: `WriterSynthetic${suffix}x9`,
      lifecycle: `LifecycleSynthetic${suffix}x9`,
    };
    const loginPools = {};
    let databaseCreated = false;
    t.after(async () => {
      await Promise.allSettled(
        Object.values(loginPools).map((candidate) => candidate.end()),
      );
      try {
        for (const [authority, member] of [
          ['falcone_app', names.runtime],
          ['falcone_webhook_key_writer', names.writer],
          ['falcone_webhook_key_lifecycle', names.lifecycle],
        ]) {
          try {
            await baseAdminPool.query(
              `REVOKE ${quoteRole(authority)} FROM ${quoteRole(member)}`,
            );
          } catch { /* role creation may have failed before exact binding */ }
        }
        if (databaseCreated) {
          await baseAdminPool.query(
            `DROP DATABASE IF EXISTS ${quoteRole(databaseName)} WITH (FORCE)`,
          );
        }
        for (const name of boundedLoginNames) {
          await baseAdminPool.query(`DROP ROLE IF EXISTS ${quoteRole(name)}`);
        }
        await baseAdminPool.query(`DROP ROLE IF EXISTS ${quoteRole(alternateGrantor)}`);
        await baseAdminPool.query(`DROP ROLE IF EXISTS ${quoteRole(unexpectedAclRole)}`);
        await baseAdminPool.query(`DROP ROLE IF EXISTS ${quoteRole(dependentGrantor)}`);
        await baseAdminPool.query(`DROP ROLE IF EXISTS ${quoteRole(dependentDownstream)}`);
      } finally {
        await baseAdminPool.end();
      }
    });

    await ensureFixedAuthorities(baseAdminPool, { bindFixture: false });
    for (const kind of ['schema', 'runtime', 'writer', 'lifecycle']) {
      await baseAdminPool.query(
        `CREATE ROLE ${quoteRole(names[kind])} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOREPLICATION NOBYPASSRLS PASSWORD '${passwords[kind]}'`,
      );
    }
    await baseAdminPool.query(
      `CREATE DATABASE ${quoteRole(databaseName)} OWNER ${quoteRole(names.schema)}`,
    );
    databaseCreated = true;

    loginPools.schema = new Pool({
      connectionString: databaseUrlForDatabaseAndLogin(
        databaseUrl,
        databaseName,
        names.schema,
        passwords.schema,
      ),
      application_name: `c25-distinct-schema-${rlsEnabled}`,
      max: 2,
    });
    loginPools.runtime = new Pool({
      connectionString: databaseUrlForDatabaseAndLogin(
        databaseUrl,
        databaseName,
        names.runtime,
        passwords.runtime,
      ),
      application_name: `c25-distinct-runtime-${rlsEnabled}`,
      max: 2,
    });
    loginPools.writer = new Pool({
      connectionString: databaseUrlForDatabaseAndLogin(
        databaseUrl,
        databaseName,
        names.writer,
        passwords.writer,
      ),
      application_name: `c25-distinct-writer-${rlsEnabled}`,
      max: 2,
    });
    loginPools.lifecycle = new Pool({
      connectionString: databaseUrlForDatabaseAndLogin(
        databaseUrl,
        databaseName,
        names.lifecycle,
        passwords.lifecycle,
      ),
      application_name: `c25-distinct-lifecycle-${rlsEnabled}`,
      max: 2,
    });
    loginPools.admin = new Pool({
      connectionString: databaseUrlForDatabaseAndLogin(
        databaseUrl,
        databaseName,
        new URL(databaseUrl).username,
        new URL(databaseUrl).password,
      ),
      application_name: `c25-distinct-fixture-admin-${rlsEnabled}`,
      max: 2,
    });

    const migration = (name) => applyMigration(loginPools.schema, name, names);
    const principalOptions = {
      schemaPool: loginPools.schema,
      runtimePool: loginPools.runtime,
      writerPool: loginPools.writer,
      lifecyclePool: loginPools.lifecycle,
      names,
    };
    await assert.rejects(
      verifyWebhookDatabasePrincipalSessions(principalOptions),
      { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' },
    );
    await migration('001-webhook-subscriptions.sql');
    await migration('002-signing-secret-tenant-scope.sql');
    await assert.rejects(
      migration('004-webhook-master-key-lifecycle.sql'),
      { code: '55000', message: 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID' },
    );
    await baseAdminPool.query(
      `GRANT falcone_app TO ${quoteRole(names.runtime)}
         WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
       GRANT falcone_webhook_key_writer TO ${quoteRole(names.writer)}
         WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
       GRANT falcone_webhook_key_lifecycle TO ${quoteRole(names.lifecycle)}
         WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
    );
    assert.deepEqual(
      await verifyWebhookDatabasePrincipalSessions(principalOptions),
      {
        schemaExecutor: names.schema,
        runtime: names.runtime,
        writer: names.writer,
        lifecycle: names.lifecycle,
      },
    );
    if (!rlsEnabled) {
      const optionDrifts = [
        {
          authority: 'falcone_app',
          member: names.runtime,
          drift: 'WITH ADMIN FALSE, INHERIT FALSE, SET FALSE',
          restore: 'WITH ADMIN FALSE, INHERIT TRUE, SET FALSE',
        },
        {
          authority: 'falcone_webhook_key_writer',
          member: names.writer,
          drift: 'WITH ADMIN FALSE, INHERIT FALSE, SET FALSE',
          restore: 'WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        },
        {
          authority: 'falcone_webhook_key_lifecycle',
          member: names.lifecycle,
          drift: 'WITH ADMIN FALSE, INHERIT TRUE, SET TRUE',
          restore: 'WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        },
      ];
      for (const edge of optionDrifts) {
        await baseAdminPool.query(
          `GRANT ${quoteRole(edge.authority)} TO ${quoteRole(edge.member)} ${edge.drift}`,
        );
        await assert.rejects(
          verifyWebhookDatabasePrincipalSessions(principalOptions),
          { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' },
        );
        await assert.rejects(
          migration('004-webhook-master-key-lifecycle.sql'),
          { code: '55000', message: 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID' },
        );
        await baseAdminPool.query(
          `GRANT ${quoteRole(edge.authority)} TO ${quoteRole(edge.member)} ${edge.restore}`,
        );
      }

      await baseAdminPool.query(
        `CREATE ROLE ${quoteRole(alternateGrantor)}
           LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         GRANT falcone_app TO ${quoteRole(alternateGrantor)}
           WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
      );
      const alternateGrantorClient = await baseAdminPool.connect();
      try {
        await alternateGrantorClient.query(`SET ROLE ${quoteRole(alternateGrantor)}`);
        await alternateGrantorClient.query(
          `GRANT falcone_app TO ${quoteRole(names.runtime)}
             WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`,
        );
        await alternateGrantorClient.query('RESET ROLE');
      } finally {
        alternateGrantorClient.release();
      }
      assert.equal((await baseAdminPool.query(
        `SELECT count(DISTINCT grantor)::int AS count
           FROM pg_auth_members
          WHERE roleid = 'falcone_app'::regrole
            AND member = $1::regrole`,
        [names.runtime],
      )).rows[0].count, 2);
      await assert.rejects(
        verifyWebhookDatabasePrincipalSessions(principalOptions),
        { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' },
      );
      await assert.rejects(
        migration('004-webhook-master-key-lifecycle.sql'),
        { code: '55000', message: 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID' },
      );
      const cleanupGrantorClient = await baseAdminPool.connect();
      try {
        await cleanupGrantorClient.query(`SET ROLE ${quoteRole(alternateGrantor)}`);
        await cleanupGrantorClient.query(
          `REVOKE falcone_app FROM ${quoteRole(names.runtime)}`,
        );
        await cleanupGrantorClient.query('RESET ROLE');
      } finally {
        cleanupGrantorClient.release();
      }
      await baseAdminPool.query(
        `REVOKE falcone_app FROM ${quoteRole(alternateGrantor)}`,
      );
      await baseAdminPool.query(`DROP ROLE ${quoteRole(alternateGrantor)}`);
    }
    if (rlsEnabled) await migration('003-rls-webhook-tables.sql');
    await migration('004-webhook-master-key-lifecycle.sql');
    await migration('004-webhook-master-key-lifecycle.sql');

    assert.deepEqual(
      await verifyWebhookDatabasePrincipalConnections(principalOptions),
      {
        schemaExecutor: names.schema,
        runtime: names.runtime,
        writer: names.writer,
        lifecycle: names.lifecycle,
      },
    );
    await baseAdminPool.query(
      `CREATE ROLE ${quoteRole(dependentGrantor)} NOLOGIN;
       CREATE ROLE ${quoteRole(dependentDownstream)} NOLOGIN`,
    );
    await loginPools.schema.query(
      `CREATE TABLE public.${quoteRole(nonEnumeratedRelation)}
         (id integer PRIMARY KEY, note text);
       GRANT SELECT ON TABLE public.webhook_subscriptions
         TO ${quoteRole(dependentGrantor)} WITH GRANT OPTION;
       GRANT SELECT (secret_cipher) ON TABLE public.webhook_signing_secrets
         TO ${quoteRole(dependentGrantor)} WITH GRANT OPTION;
       GRANT EXECUTE
         ON FUNCTION public.falcone_webhook_signing_secret_write_fence()
         TO ${quoteRole(dependentGrantor)} WITH GRANT OPTION;
       GRANT SELECT ON TABLE public.${quoteRole(nonEnumeratedRelation)}
         TO ${quoteRole(dependentGrantor)} WITH GRANT OPTION`,
    );
    const dependentGrantorClient = await loginPools.admin.connect();
    try {
      await dependentGrantorClient.query(
        `SET ROLE ${quoteRole(dependentGrantor)}`,
      );
      await dependentGrantorClient.query(
        `GRANT SELECT ON TABLE public.webhook_subscriptions
           TO ${quoteRole(dependentDownstream)};
         GRANT SELECT (secret_cipher) ON TABLE public.webhook_signing_secrets
           TO ${quoteRole(dependentDownstream)};
         GRANT EXECUTE
           ON FUNCTION public.falcone_webhook_signing_secret_write_fence()
           TO ${quoteRole(dependentDownstream)};
         GRANT SELECT ON TABLE public.${quoteRole(nonEnumeratedRelation)}
           TO ${quoteRole(dependentDownstream)}`,
      );
      await dependentGrantorClient.query('RESET ROLE');
    } finally {
      dependentGrantorClient.release();
    }
    const dependentBeforeReplay = (await loginPools.admin.query(
      `SELECT
         has_table_privilege(
           $1,
           'public.webhook_subscriptions',
           'SELECT WITH GRANT OPTION'
         ) AS grantor_table_option,
         has_table_privilege(
           $2,
           'public.webhook_subscriptions',
           'SELECT'
         ) AS downstream_table,
         has_column_privilege(
           $1,
           'public.webhook_signing_secrets',
           'secret_cipher',
           'SELECT WITH GRANT OPTION'
         ) AS grantor_column_option,
         has_column_privilege(
           $2,
           'public.webhook_signing_secrets',
           'secret_cipher',
           'SELECT'
         ) AS downstream_column,
         has_function_privilege(
           $1,
           'public.falcone_webhook_signing_secret_write_fence()',
           'EXECUTE WITH GRANT OPTION'
         ) AS grantor_function_option,
         has_function_privilege(
           $2,
           'public.falcone_webhook_signing_secret_write_fence()',
           'EXECUTE'
         ) AS downstream_function`,
      [dependentGrantor, dependentDownstream],
    )).rows[0];
    assert.deepEqual(dependentBeforeReplay, {
      grantor_table_option: true,
      downstream_table: true,
      grantor_column_option: true,
      downstream_column: true,
      grantor_function_option: true,
      downstream_function: true,
    });
    await migration('004-webhook-master-key-lifecycle.sql');
    assert.deepEqual(
      await verifyWebhookDatabasePrincipalConnections(principalOptions),
      {
        schemaExecutor: names.schema,
        runtime: names.runtime,
        writer: names.writer,
        lifecycle: names.lifecycle,
      },
      'the exact post-DDL verifier accepts the reconciled dependent ACL graph',
    );
    const dependentAfterReplay = (await loginPools.admin.query(
      `SELECT
         has_table_privilege(
           $1,
           'public.webhook_subscriptions',
           'SELECT'
         ) AS grantor_table,
         has_table_privilege(
           $2,
           'public.webhook_subscriptions',
           'SELECT'
         ) AS downstream_table,
         has_column_privilege(
           $1,
           'public.webhook_signing_secrets',
           'secret_cipher',
           'SELECT'
         ) AS grantor_column,
         has_column_privilege(
           $2,
           'public.webhook_signing_secrets',
           'secret_cipher',
           'SELECT'
         ) AS downstream_column,
         has_function_privilege(
           $1,
           'public.falcone_webhook_signing_secret_write_fence()',
           'EXECUTE'
         ) AS grantor_function,
         has_function_privilege(
           $2,
           'public.falcone_webhook_signing_secret_write_fence()',
           'EXECUTE'
         ) AS downstream_function,
         has_table_privilege(
           $1,
           $3,
           'SELECT WITH GRANT OPTION'
         ) AS control_grantor_option,
         has_table_privilege(
           $2,
           $3,
           'SELECT'
         ) AS control_downstream`,
      [
        dependentGrantor,
        dependentDownstream,
        `public.${nonEnumeratedRelation}`,
      ],
    )).rows[0];
    assert.deepEqual(dependentAfterReplay, {
      grantor_table: false,
      downstream_table: false,
      grantor_column: false,
      downstream_column: false,
      grantor_function: false,
      downstream_function: false,
      control_grantor_option: true,
      control_downstream: true,
    });
    t.diagnostic(
      `${rlsLabel}: migration replay removed alternate-grantor/downstream `
        + 'table, column, and function ACLs; non-enumerated grant chain preserved',
    );
    await loginPools.admin.query(
      `CREATE ROLE ${quoteRole(unexpectedAclRole)} NOLOGIN;
       GRANT DELETE ON TABLE public.webhook_subscriptions
         TO falcone_webhook_key_writer;
       GRANT DELETE ON TABLE public.webhook_signing_secrets
         TO falcone_webhook_key_lifecycle;
       GRANT SELECT ON TABLE public.webhook_master_key_state TO PUBLIC;
       GRANT EXECUTE ON FUNCTION public.falcone_webhook_signing_secret_write_fence()
         TO PUBLIC;
       GRANT SELECT (secret_cipher) ON TABLE public.webhook_signing_secrets
         TO ${quoteRole(unexpectedAclRole)};
       CREATE POLICY c25_unexpected_permissive_policy
         ON public.webhook_signing_secrets
         TO PUBLIC
         USING (true)
         WITH CHECK (true)`,
    );
    await assert.rejects(
      verifyWebhookDatabasePrincipalConnections(principalOptions),
      { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' },
    );
    await migration('004-webhook-master-key-lifecycle.sql');
    assert.deepEqual(
      await verifyWebhookDatabasePrincipalConnections(principalOptions),
      {
        schemaExecutor: names.schema,
        runtime: names.runtime,
        writer: names.writer,
        lifecycle: names.lifecycle,
      },
    );
    const reconciledExcess = (await loginPools.admin.query(
      `SELECT
         has_table_privilege(
           'falcone_webhook_key_writer',
           'public.webhook_subscriptions',
           'DELETE'
         ) AS writer_delete,
         has_table_privilege(
           'falcone_webhook_key_lifecycle',
           'public.webhook_signing_secrets',
           'DELETE'
         ) AS lifecycle_delete,
         EXISTS (
           SELECT 1
             FROM pg_class class
             CROSS JOIN LATERAL aclexplode(
               COALESCE(class.relacl, acldefault('r', class.relowner))
             ) privilege
            WHERE class.oid = 'public.webhook_master_key_state'::regclass
              AND privilege.grantee = 0
              AND privilege.privilege_type = 'SELECT'
         ) AS public_state_select,
         EXISTS (
           SELECT 1
             FROM pg_proc procedure
             CROSS JOIN LATERAL aclexplode(
               COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
             ) privilege
            WHERE procedure.oid =
                  'public.falcone_webhook_signing_secret_write_fence()'::regprocedure
              AND privilege.grantee = 0
              AND privilege.privilege_type = 'EXECUTE'
         ) AS public_fence_execute,
         has_column_privilege(
           $1,
           'public.webhook_signing_secrets',
           'secret_cipher',
           'SELECT'
         ) AS unexpected_column_select,
         EXISTS (
           SELECT 1
             FROM pg_policy
            WHERE polname = 'c25_unexpected_permissive_policy'
         ) AS unexpected_policy`,
      [unexpectedAclRole],
    )).rows[0];
    assert.deepEqual(reconciledExcess, {
      writer_delete: false,
      lifecycle_delete: false,
      public_state_select: false,
      public_fence_execute: false,
      unexpected_column_select: false,
      unexpected_policy: false,
    });
    if (!rlsEnabled) {
      await t.test('shared superuser sessions with startup-role aliases are rejected', async () => {
        const adminUrl = databaseUrlForDatabaseAndLogin(
          databaseUrl,
          databaseName,
          new URL(databaseUrl).username,
          new URL(databaseUrl).password,
        );
        const aliases = Object.fromEntries(
          ['schema', 'runtime', 'writer', 'lifecycle'].map((kind) => [
            kind,
            new Pool({
              connectionString: adminUrl,
              options: `-c role=${names[kind]}`,
              application_name: `c25-shared-alias-${kind}`,
              max: 1,
            }),
          ]),
        );
        try {
          const identities = await Promise.all(
            Object.values(aliases).map(async (candidate) => (
              await candidate.query(
                'SELECT session_user::text AS session_user, current_user::text AS current_user',
              )
            ).rows[0]),
          );
          assert.equal(new Set(
            identities.map(({ session_user }) => session_user),
          ).size, 1);
          assert.deepEqual(
            identities.map(({ current_user }) => current_user),
            [names.schema, names.runtime, names.writer, names.lifecycle],
          );
          await assert.rejects(verifyWebhookDatabasePrincipalConnections({
            schemaPool: aliases.schema,
            runtimePool: aliases.runtime,
            writerPool: aliases.writer,
            lifecyclePool: aliases.lifecycle,
            names,
          }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
          await assert.rejects(verifyWebhookLifecyclePrincipalConnections({
            schemaPool: aliases.schema,
            lifecyclePool: aliases.lifecycle,
            names,
          }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
        } finally {
          await Promise.allSettled(
            Object.values(aliases).map((candidate) => candidate.end()),
          );
        }
      });
    }
    const authenticatedUsers = await Promise.all(
      ['schema', 'runtime', 'writer', 'lifecycle'].map(async (kind) => (
        await loginPools[kind].query(
          'SELECT session_user AS session_user, current_user AS current_user',
        )
      ).rows[0]),
    );
    assert.deepEqual(
      authenticatedUsers.map(({ session_user }) => session_user),
      [names.schema, names.runtime, names.writer, names.lifecycle],
    );
    assert.deepEqual(
      authenticatedUsers.map(({ current_user }) => current_user),
      [names.schema, names.runtime, names.writer, names.lifecycle],
    );
    assert.equal(new Set(authenticatedUsers.map(({ session_user }) => session_user)).size, 4);

    const roleRows = (await loginPools.admin.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls
         FROM pg_roles
        WHERE rolname = ANY($1::name[])
        ORDER BY rolname`,
      [boundedLoginNames],
    )).rows;
    assert.equal(roleRows.length, 4);
    for (const role of roleRows) {
      assert.deepEqual(
        {
          rolcanlogin: role.rolcanlogin,
          rolsuper: role.rolsuper,
          rolcreatedb: role.rolcreatedb,
          rolcreaterole: role.rolcreaterole,
          rolreplication: role.rolreplication,
          rolbypassrls: role.rolbypassrls,
        },
        {
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
        },
      );
    }
    const authorityState = (await loginPools.admin.query(
      `SELECT
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = $1::regrole
               AND roleid = 'falcone_webhook_key_lifecycle'::regrole
          ) AS schema_lifecycle,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = $1::regrole
               AND roleid = 'falcone_webhook_key_writer'::regrole
          ) AS schema_writer,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = $2::regrole
               AND roleid = 'falcone_webhook_key_lifecycle'::regrole
          ) AS runtime_lifecycle,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = $2::regrole
               AND roleid = 'falcone_webhook_key_writer'::regrole
          ) AS runtime_writer,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = $3::regrole
               AND roleid = 'falcone_webhook_key_writer'::regrole
          ) AS writer_writer,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = $4::regrole
               AND roleid = 'falcone_webhook_key_lifecycle'::regrole
          ) AS lifecycle_lifecycle,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = 'falcone_app'::regrole
               AND roleid = 'falcone_webhook_key_lifecycle'::regrole
          ) AS app_lifecycle,
          EXISTS (
            SELECT 1 FROM pg_auth_members
             WHERE member = 'falcone_app'::regrole
               AND roleid = 'falcone_webhook_key_writer'::regrole
          ) AS app_writer`,
      [names.schema, names.runtime, names.writer, names.lifecycle],
    )).rows[0];
    assert.deepEqual(authorityState, {
      schema_lifecycle: false,
      schema_writer: false,
      runtime_lifecycle: false,
      runtime_writer: false,
      writer_writer: true,
      lifecycle_lifecycle: true,
      app_lifecycle: false,
      app_writer: false,
    });
    const relationState = (await loginPools.admin.query(
      `SELECT pg_get_userbyid(relowner) AS table_owner,
              relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.webhook_signing_secrets'::regclass`,
    )).rows[0];
    assert.equal(relationState.table_owner, names.schema);
    assert.notEqual(relationState.table_owner, names.runtime);
    assert.equal(relationState.relrowsecurity, rlsEnabled);
    assert.equal(relationState.relforcerowsecurity, rlsEnabled);

    for (const candidate of [loginPools.schema, loginPools.runtime]) {
      for (const authority of [
        'falcone_webhook_key_lifecycle',
        'falcone_webhook_key_writer',
      ]) {
        await assert.rejects(
          candidate.query(`SET ROLE ${authority}`),
          { code: '42501' },
        );
      }
    }
    await assert.rejects(
      loginPools.runtime.query('SELECT * FROM webhook_master_key_state'),
      { code: '42501' },
    );
    for (const relation of [
      'webhook_master_key_state',
      'webhook_master_key_rotations',
    ]) {
      await assert.rejects(
        loginPools.lifecycle.query(`SELECT count(*) FROM ${relation}`),
        { code: '42501' },
        `${rlsLabel}: lifecycle LOGIN has no direct ${relation} access`,
      );
    }

    const variant = rlsEnabled ? 'rls' : 'plain';
    const legacyMaterial = `distinct-principal-${variant}-legacy-material`;
    const legacyKeyId = deriveWebhookKeyId(
      'test-ns',
      `distinct-${variant}-legacy`,
      'key',
    );
    const canonicalMaterial = formatCanonicalWebhookKey(
      Buffer.alloc(32, rlsEnabled ? 0x5a : 0x58),
    );
    const canonicalKeyId = deriveWebhookKeyId(
      'test-ns',
      `distinct-${variant}-canonical`,
      'key',
    );
    const wrongMaterial = formatCanonicalWebhookKey(
      Buffer.alloc(32, rlsEnabled ? 0x5b : 0x59),
    );
    const legacyContext = createLifecycleWebhookKeyContext({
      material: legacyMaterial,
      keyId: legacyKeyId,
      mode: 'legacy',
      purpose: 'adopt',
    });
    const canonicalContext = createCanonicalWebhookKeyContext(
      canonicalMaterial,
      canonicalKeyId,
    );
    const wrongContext = createCanonicalWebhookKeyContext(
      wrongMaterial,
      canonicalKeyId,
    );
    const idPrefix = rlsEnabled ? '94' : '93';
    const existingSubscription = `${idPrefix}000000-0000-4000-8000-000000000001`;
    const rejectedSubscription = `${idPrefix}000000-0000-4000-8000-000000000002`;
    await loginPools.admin.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES
         ($1,'tenant-distinct','workspace-distinct',
          'https://example.invalid/hook',ARRAY['document.created'],'principal-test'),
         ($2,'tenant-distinct','workspace-distinct',
          'https://example.invalid/hook',ARRAY['document.created'],'principal-test')`,
      [existingSubscription, rejectedSubscription],
    );
    const legacyEncrypted = encryptSecret(
      'distinct-principal-secret',
      legacyContext,
    );
    await withLifecycleFence(loginPools.admin, (client) => client.query(
      `INSERT INTO webhook_signing_secrets
         (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status)
       VALUES ($1,'tenant-distinct','workspace-distinct',$2,$3,'active')`,
      [existingSubscription, legacyEncrypted.cipher, legacyEncrypted.iv],
    ));

    const lifecycle = buildWebhookMasterKeyRepository(loginPools.lifecycle);
    assert.equal((await lifecycle.adopt({
      material: legacyMaterial,
      keyId: legacyKeyId,
      managed: false,
      requestId: `distinct-${variant}-adopt-001`,
    })).state, 'completed');
    assert.equal((await lifecycle.rotate({
      sourceMaterial: legacyMaterial,
      sourceKeyId: legacyKeyId,
      sourceMode: 'legacy',
      targetMaterial: canonicalMaterial,
      targetKeyId: canonicalKeyId,
      targetManaged: true,
      requestId: `distinct-${variant}-rotate-001`,
      rotationId: `distinct-${variant}-rotation-001`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    })).state, 'completed');

    await t.test(
      'bounded lifecycle LOGIN reads assume only the fixed authority and do not leak role state',
      async () => {
        const replayBinding = {
          requestId: `distinct-${variant}-rotate-001`,
          action: 'rotate',
          rotationId: `distinct-${variant}-rotation-001`,
          sourceKeyId: legacyKeyId,
          targetKeyId: canonicalKeyId,
          targetManaged: true,
          recoveryWindowSeconds: 3600,
        };
        const resolution = await lifecycle.getResolutionState();
        assert.equal(resolution.current_key_id, canonicalKeyId);
        assert.equal(resolution.current_mode, 'canonical-v1');

        const status = await lifecycle.status();
        assert.equal(status.configured, true);
        assert.equal(status.state.currentKeyId, canonicalKeyId);
        assert.equal(status.state.currentMode, 'canonical-v1');
        assert.ok(status.recent.some(
          ({ requestId, state }) => (
            requestId === replayBinding.requestId && state === 'completed'
          ),
        ));

        const authorized = await lifecycle.authorizeQuiescedReplay(
          replayBinding,
        );
        assert.equal(authorized.requestId, replayBinding.requestId);
        assert.equal(authorized.targetManaged, true);
        assert.equal(
          await lifecycle.authorizeQuiescedReplay({
            ...replayBinding,
            requestId: `distinct-${variant}-missing-replay`,
          }),
          null,
        );
        await assert.rejects(
          lifecycle.authorizeQuiescedReplay({
            ...replayBinding,
            targetManaged: false,
          }),
          { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
        );

        // Lease every connection in this two-session pool after both commit
        // and rollback paths. SET LOCAL ROLE and the read-only transaction must
        // be gone before either session returns to later pooled work.
        const laterClients = await Promise.all([
          loginPools.lifecycle.connect(),
          loginPools.lifecycle.connect(),
        ]);
        try {
          for (const client of laterClients) {
            assert.deepEqual((await client.query(
              `SELECT session_user::text AS session_user,
                      current_user::text AS current_user,
                      current_setting('transaction_read_only') AS transaction_read_only`,
            )).rows[0], {
              session_user: names.lifecycle,
              current_user: names.lifecycle,
              transaction_read_only: 'off',
            });
            for (const relation of [
              'webhook_master_key_state',
              'webhook_master_key_rotations',
            ]) {
              await assert.rejects(
                client.query(`SELECT count(*) FROM ${relation}`),
                { code: '42501' },
              );
            }
          }
        } finally {
          laterClients.forEach((client) => client.release());
        }
        t.diagnostic(
          `${rlsLabel}: direct lifecycle-table reads stayed denied; `
            + 'resolution/status/replay reads succeeded through transaction-local authority; '
            + 'both pooled sessions reset after commit and rollback',
        );
      },
    );

    const writerDb = buildWebhookDb(loginPools.runtime, {
      writePool: loginPools.writer,
    });
    const staleRuntimeContext = createRuntimeWebhookKeyContext({
      material: legacyMaterial,
      keyId: legacyKeyId,
      mode: 'legacy',
      lifecycleState: {
        lifecycle_state: 'serving',
        current_key_id: legacyKeyId,
        current_mode: 'legacy',
      },
    });
    const canonicalRuntimeContext = createRuntimeWebhookKeyContext({
      material: canonicalMaterial,
      keyId: canonicalKeyId,
      mode: 'canonical-v1',
      lifecycleState: {
        lifecycle_state: 'serving',
        current_key_id: canonicalKeyId,
        current_mode: 'canonical-v1',
      },
    });
    const rotationEvents = [];
    const rotationParams = {
      db: writerDb,
      kafka: {
        publish: async (topic, payload) => rotationEvents.push({ topic, payload }),
      },
      env: {},
      auth: {
        tenantId: 'tenant-distinct',
        workspaceId: 'workspace-distinct',
        actorId: 'principal-test',
      },
      method: 'POST',
      path: `/v1/webhooks/subscriptions/${existingSubscription}/rotate-secret`,
      body: { gracePeriodSeconds: 60 },
    };
    const beforeStaleRotation = (await loginPools.admin.query(
      `SELECT id, status, secret_cipher, secret_iv, encryption_key_id,
              grace_expires_at
         FROM webhook_signing_secrets
        WHERE subscription_id = $1
        ORDER BY id`,
      [existingSubscription],
    )).rows;
    const staleRotation = await managementMain({
      ...rotationParams,
      keyContext: staleRuntimeContext,
    });
    assert.deepEqual(staleRotation, {
      statusCode: 503,
      body: {
        code: 'WEBHOOK_KEY_UNAVAILABLE',
        message: 'Webhook key lifecycle is not ready',
      },
    });
    assert.deepEqual((await loginPools.admin.query(
      `SELECT id, status, secret_cipher, secret_iv, encryption_key_id,
              grace_expires_at
         FROM webhook_signing_secrets
        WHERE subscription_id = $1
        ORDER BY id`,
      [existingSubscription],
    )).rows, beforeStaleRotation);
    assert.equal(rotationEvents.length, 0);
    assert.doesNotMatch(
      JSON.stringify(staleRotation),
      /55000|WRITE_FENCED|distinct-|cipher|secret_iv|key_id|postgres|dsn/i,
    );
    const retriedRotation = await managementMain({
      ...rotationParams,
      keyContext: canonicalRuntimeContext,
    });
    assert.equal(retriedRotation.statusCode, 200);
    assert.equal(typeof retriedRotation.body.newSigningSecret, 'string');
    assert.equal(rotationEvents.length, 1);
    assert.equal(rotationEvents[0].topic, 'console.webhook.secret.rotated');
    t.diagnostic(
      `${rlsLabel}: stale per-subscription rotation left rows/events unchanged; `
        + 'current-key retry succeeded through distinct bounded writer login',
    );

    const wrongCipher = encryptSecret('wrong-key-bytes', wrongContext);
    const constrainedAttack = async (sql, params) => {
      const client = await loginPools.runtime.connect();
      let transactionStarted = false;
      try {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query('SET LOCAL ROLE falcone_app');
        const identity = (await client.query(
          'SELECT session_user AS session_user, current_user AS current_user',
        )).rows[0];
        assert.deepEqual(identity, {
          session_user: names.runtime,
          current_user: 'falcone_app',
        });
        await client.query(
          "SELECT set_config('app.tenant_id', 'tenant-distinct', true), set_config('app.workspace_id', 'workspace-distinct', true)",
        );
        // This is the removed, caller-controlled proof from round 9. Supplying
        // it now has no production effect.
        await client.query(
          "SELECT set_config('falcone.webhook_key_write_id', $1, true)",
          [canonicalKeyId],
        );
        await client.query(
          'SELECT pg_advisory_xact_lock($1, $2)',
          [723661, 25],
        );
        await client.query(sql, params);
        await client.query('COMMIT');
        transactionStarted = false;
        assert.fail('same-current-ID wrong-cipher attack unexpectedly committed');
      } catch (caught) {
        assert.ok(
          ['42501', '55000'].includes(caught.code),
          'runtime is denied by exact column grants or the encrypted-row fence',
        );
      } finally {
        if (transactionStarted) {
          try { await client.query('ROLLBACK'); } catch { /* preserve trigger result */ }
        }
        client.release();
      }
    };
    await constrainedAttack(
      `INSERT INTO webhook_signing_secrets
         (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv,
          status, encryption_key_id)
       VALUES ($1,'tenant-distinct','workspace-distinct',$2,$3,'active',$4)`,
      [rejectedSubscription, wrongCipher.cipher, wrongCipher.iv, canonicalKeyId],
    );
    await constrainedAttack(
      `UPDATE webhook_signing_secrets
          SET secret_cipher = $2, secret_iv = $3, encryption_key_id = $4
        WHERE subscription_id = $1`,
      [existingSubscription, wrongCipher.cipher, wrongCipher.iv, canonicalKeyId],
    );

    const rowsAfterAttacks = (await loginPools.admin.query(
      `SELECT subscription_id, secret_cipher, secret_iv, encryption_key_id
         FROM webhook_signing_secrets ORDER BY subscription_id`,
    )).rows;
    assert.equal(rowsAfterAttacks.length, 2);
    assert.ok(rowsAfterAttacks.every(
      (row) => row.subscription_id === existingSubscription,
    ));
    assert.ok(rowsAfterAttacks.every(
      (row) => row.encryption_key_id === canonicalKeyId,
    ));
    assert.deepEqual(
      rowsAfterAttacks
        .map((row) => decryptSecret(
          row.secret_cipher,
          row.secret_iv,
          canonicalContext,
        ))
        .sort(),
      [
        'distinct-principal-secret',
        retriedRotation.body.newSigningSecret,
      ].sort(),
    );

    const recoveryNow = new Date();
    assert.equal((await lifecycle.recover({
      currentMaterial: canonicalMaterial,
      currentKeyId: canonicalKeyId,
      currentMode: 'canonical-v1',
      targetMaterial: legacyMaterial,
      targetKeyId: legacyKeyId,
      targetMode: 'legacy',
      targetManaged: false,
      requestId: `distinct-${variant}-recover-001`,
      rotationId: `distinct-${variant}-recovery-001`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
      now: recoveryNow,
    })).state, 'completed');
    assert.equal((await lifecycle.finalize({
      material: legacyMaterial,
      keyId: legacyKeyId,
      mode: 'legacy',
      recoveryKeyId: canonicalKeyId,
      requestId: `distinct-${variant}-finalize-001`,
      now: new Date(recoveryNow.getTime() + 7_200_000),
    })).state, 'completed');

    // The dedicated writer login can assume only its fixed effective role and
    // produce a normal post-lifecycle encrypted write through the adapter.
    const postLifecycleSubscription = {
      id: `${idPrefix}000000-0000-4000-8000-000000000003`,
      tenant_id: 'tenant-distinct',
      workspace_id: 'workspace-distinct',
      target_url: 'https://example.invalid/post-lifecycle',
      event_types: ['document.created'],
      status: 'active',
      consecutive_failures: 0,
      max_consecutive_failures: 5,
      description: null,
      created_by: 'principal-test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    };
    await writerDb.insertSubscriptionWithSecret(
      postLifecycleSubscription,
      encryptSecret('authorized-writer-secret', legacyContext),
      legacyKeyId,
    );
    assert.equal((await loginPools.admin.query(
      `SELECT count(*)::int AS count
         FROM webhook_signing_secrets
        WHERE subscription_id = $1 AND encryption_key_id = $2`,
      [postLifecycleSubscription.id, legacyKeyId],
    )).rows[0].count, 1);

    // The ordinary runtime contract is supplied by migration 004 itself in
    // both variants; no fixture-only GRANT is involved. Runtime can perform
    // tenant-scoped non-secret work and read serving ciphertext, while the
    // writer pool remains the only encrypted-row writer.
    assert.equal(
      await writerDb.getWorkspaceSubscriptionCount(
        'tenant-distinct',
        'workspace-distinct',
      ),
      3,
    );
    assert.equal((await writerDb.listSubscriptions({
      tenantId: 'tenant-distinct',
      workspaceId: 'workspace-distinct',
    })).length, 3);
    assert.equal((await writerDb.getSubscription(
      postLifecycleSubscription.id,
      'tenant-distinct',
      'workspace-distinct',
    )).id, postLifecycleSubscription.id);
    assert.equal((await writerDb.updateSubscription(
      postLifecycleSubscription.id,
      {
        target_url: 'https://example.invalid/post-lifecycle-updated',
        event_types: ['document.updated'],
      },
      'tenant-distinct',
      'workspace-distinct',
    )).target_url, 'https://example.invalid/post-lifecycle-updated');

    const deliveryId = `${idPrefix}000000-0000-4000-8000-000000000004`;
    const runtimeClient = await loginPools.runtime.connect();
    try {
      await runtimeClient.query('BEGIN');
      await runtimeClient.query(
        "SELECT set_config('app.tenant_id', 'tenant-distinct', true), set_config('app.workspace_id', 'workspace-distinct', true)",
      );
      await runtimeClient.query(
        `INSERT INTO webhook_deliveries
           (id, subscription_id, tenant_id, workspace_id, event_type, event_id)
         VALUES ($1,$2,'tenant-distinct','workspace-distinct',
           'document.created','ordinary-event')`,
        [deliveryId, postLifecycleSubscription.id],
      );
      const signingRows = await runtimeClient.query(
        `SELECT count(*)::int AS count
           FROM webhook_signing_secrets
          WHERE subscription_id = $1
            AND tenant_id = 'tenant-distinct'
            AND workspace_id = 'workspace-distinct'`,
        [postLifecycleSubscription.id],
      );
      assert.equal(signingRows.rows[0].count, 1);
      await runtimeClient.query('COMMIT');
    } catch (caught) {
      try { await runtimeClient.query('ROLLBACK'); } catch { /* preserve failure */ }
      throw caught;
    } finally {
      runtimeClient.release();
    }
    assert.equal((await writerDb.listDeliveries(
      postLifecycleSubscription.id,
      {},
      'tenant-distinct',
      'workspace-distinct',
    )).length, 1);
    assert.equal((await writerDb.getDelivery(
      postLifecycleSubscription.id,
      deliveryId,
      'tenant-distinct',
      'workspace-distinct',
    )).id, deliveryId);
    await writerDb.cancelPendingDeliveries(
      postLifecycleSubscription.id,
      'tenant-distinct',
      'workspace-distinct',
    );

    await migration('004-webhook-master-key-lifecycle.sql');
    assert.deepEqual(
      await verifyWebhookDatabasePrincipalConnections(principalOptions),
      {
        schemaExecutor: names.schema,
        runtime: names.runtime,
        writer: names.writer,
        lifecycle: names.lifecycle,
      },
    );
    assert.equal((await lifecycle.initializeOrVerify({
      material: legacyMaterial,
      keyId: legacyKeyId,
      mode: 'legacy',
      managed: false,
    })).keyId, legacyKeyId);
  });
}

test('global control-plane capabilities and four webhook-only principals remain separated on PostgreSQL', {
  skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
  timeout: 90_000,
}, async (t) => {
  const baseAdminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  const suffix = `${process.pid}_control_plane`;
  const databaseName = `c25_global_boundary_${suffix}`;
  const names = {
    schema: `c25_schema_${suffix}`,
    runtime: `c25_runtime_${suffix}`,
    writer: `c25_writer_${suffix}`,
    lifecycle: `c25_lifecycle_${suffix}`,
    grantor: new URL(databaseUrl).username,
  };
  const globalRole = `c25_global_${suffix}`;
  const rolePasswords = {
    [globalRole]: `GlobalSynthetic${suffix}x9`,
    [names.schema]: `SchemaSynthetic${suffix}x9`,
    [names.runtime]: `RuntimeSynthetic${suffix}x9`,
    [names.writer]: `WriterSynthetic${suffix}x9`,
    [names.lifecycle]: `LifecycleSynthetic${suffix}x9`,
  };
  const pools = {};
  let databaseCreated = false;
  let workspaceDatabaseName = null;
  t.after(async () => {
    await Promise.allSettled(Object.values(pools).map((candidate) => candidate.end()));
    try {
      for (const [authority, member] of [
        ['falcone_app', names.runtime],
        ['falcone_webhook_key_writer', names.writer],
        ['falcone_webhook_key_lifecycle', names.lifecycle],
      ]) {
        try {
          await baseAdminPool.query(
            `REVOKE ${quoteRole(authority)} FROM ${quoteRole(member)}`,
          );
        } catch { /* preserve the primary test outcome */ }
      }
      if (workspaceDatabaseName) {
        await baseAdminPool.query(
          `DROP DATABASE IF EXISTS ${quoteRole(workspaceDatabaseName)} WITH (FORCE)`,
        );
      }
      if (databaseCreated) {
        await baseAdminPool.query(
          `DROP DATABASE IF EXISTS ${quoteRole(databaseName)} WITH (FORCE)`,
        );
      }
      for (const roleName of [
        names.schema,
        names.runtime,
        names.writer,
        names.lifecycle,
        globalRole,
      ]) {
        await baseAdminPool.query(`DROP ROLE IF EXISTS ${quoteRole(roleName)}`);
      }
    } finally {
      await baseAdminPool.end();
    }
  });

  await ensureFixedAuthorities(baseAdminPool, { bindFixture: false });
  await baseAdminPool.query(
    `CREATE ROLE ${quoteRole(globalRole)}
       LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${rolePasswords[globalRole]}';
     CREATE ROLE ${quoteRole(names.schema)}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${rolePasswords[names.schema]}';
     CREATE ROLE ${quoteRole(names.runtime)}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${rolePasswords[names.runtime]}';
     CREATE ROLE ${quoteRole(names.writer)}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${rolePasswords[names.writer]}';
     CREATE ROLE ${quoteRole(names.lifecycle)}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${rolePasswords[names.lifecycle]}';
     GRANT falcone_app TO ${quoteRole(names.runtime)}
       WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
     GRANT falcone_webhook_key_writer TO ${quoteRole(names.writer)}
       WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
     GRANT falcone_webhook_key_lifecycle TO ${quoteRole(names.lifecycle)}
       WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
  );
  await baseAdminPool.query(
    `CREATE DATABASE ${quoteRole(databaseName)} OWNER ${quoteRole(globalRole)}`,
  );
  databaseCreated = true;

  const urlFor = (roleName) => databaseUrlForDatabaseAndLogin(
    databaseUrl,
    databaseName,
    roleName,
    rolePasswords[roleName],
  );
  pools.global = new Pool({
    connectionString: urlFor(globalRole),
    application_name: 'c25-global-control-plane',
    max: 4,
  });
  pools.schema = new Pool({
    connectionString: urlFor(names.schema),
    application_name: 'c25-webhook-schema',
    max: 2,
  });
  pools.runtime = new Pool({
    connectionString: urlFor(names.runtime),
    application_name: 'c25-webhook-runtime',
    max: 2,
  });
  pools.writer = new Pool({
    connectionString: urlFor(names.writer),
    application_name: 'c25-webhook-writer',
    max: 2,
  });
  pools.lifecycle = new Pool({
    connectionString: urlFor(names.lifecycle),
    application_name: 'c25-webhook-lifecycle',
    max: 2,
  });
  pools.admin = new Pool({
    connectionString: databaseUrlForDatabaseAndLogin(
      databaseUrl,
      databaseName,
      names.grantor,
      new URL(databaseUrl).password,
    ),
    application_name: 'c25-boundary-admin',
    max: 2,
  });
  await pools.admin.query(
    `GRANT USAGE, CREATE ON SCHEMA public TO ${quoteRole(names.schema)}`,
  );

  // Upgrade-shaped handoff: the historical global `falcone` identity owns the
  // four pre-C-25 webhook tables. The one-shot administrator transfers only
  // those enumerated objects to the new bounded schema login.
  await pools.global.query(await readFile(
    new URL('../../packages/webhook-engine/migrations/001-webhook-subscriptions.sql', import.meta.url),
    'utf8',
  ));
  await pools.global.query(await readFile(
    new URL('../../packages/webhook-engine/migrations/002-signing-secret-tenant-scope.sql', import.meta.url),
    'utf8',
  ));
  for (const relation of [
    'webhook_subscriptions',
    'webhook_signing_secrets',
    'webhook_deliveries',
    'webhook_delivery_attempts',
  ]) {
    await pools.admin.query(
      `ALTER TABLE public.${quoteRole(relation)} OWNER TO ${quoteRole(names.schema)}`,
    );
  }

  let recoveryPool = null;
  const recovered = await prepareControlPlaneDatabases({
    controlPlanePool: pools.global,
    webhookSchemaPool: pools.schema,
    webhookRuntimePool: pools.runtime,
    webhookWritePool: pools.writer,
    webhookLifecyclePool: pools.lifecycle,
    webhookDatabasePrincipals: names,
    attempt: 1,
    dependencies: {
      applyGovernanceSchema: (candidate) => applyGovernanceSchema(candidate, {
        repoRoot: fileURLToPath(new URL('../..', import.meta.url)),
        log: { log() {} },
      }),
      applyWebhookSchema: (candidate, options) => applyWebhookSchema(candidate, {
        ...options,
        repoRoot: fileURLToPath(new URL('../..', import.meta.url)),
        log: { log() {} },
      }),
      async recoverSagas(candidate) {
        recoveryPool = candidate;
        await candidate.query(
          `INSERT INTO saga_runs
             (id, kind, status, created_at, updated_at)
           VALUES
             ('c25-global-recovery', 'boundary', 'running',
              now() - interval '10 minutes', now() - interval '10 minutes')`,
        );
        return recoverControlPlaneSagas(candidate, { olderThanSeconds: 1 });
      },
    },
  });
  assert.equal(recovered, 1);
  assert.strictEqual(recoveryPool, pools.global);
  assert.equal((await pools.global.query(
    `SELECT status FROM saga_runs WHERE id = 'c25-global-recovery'`,
  )).rows[0].status, 'recovered');
  assert.equal((await pools.global.query('SELECT count(*)::int AS count FROM tenants')).rows[0].count, 0);
  assert.equal((await pools.global.query('SELECT count(*)::int AS count FROM plans')).rows[0].count, 0);

  const webhookDb = buildWebhookDb(pools.runtime, { writePool: pools.writer });
  assert.deepEqual(await webhookDb.listSubscriptions({
    tenantId: 'tenant-boundary',
    workspaceId: 'workspace-boundary',
  }), []);

  for (const authority of [
    'falcone_webhook_key_writer',
    'falcone_webhook_key_lifecycle',
  ]) {
    await assert.rejects(pools.global.query(`SET ROLE ${authority}`), { code: '42501' });
  }
  await assert.rejects(
    pools.global.query('SELECT * FROM webhook_master_key_state'),
    { code: '42501' },
  );
  await assert.rejects(
    pools.runtime.query(`CREATE DATABASE ${quoteRole(`c25_forbidden_${suffix}`)}`),
    { code: '42501' },
  );

  const workspace = await provisionWorkspaceDatabase(pools.global, {
    tenantSlug: `c25_${process.pid}`,
    wsSlug: 'global_boundary',
  });
  workspaceDatabaseName = workspace.database;
  assert.equal(workspace.mode, 'shared');
  assert.equal((await pools.global.query(
    'SELECT count(*)::int AS count FROM pg_database WHERE datname = $1',
    [workspace.database],
  )).rows[0].count, 1);
  await dropWorkspaceDatabase(pools.global, workspace.database);
  workspaceDatabaseName = null;

  for (const [kind, authority] of [
    ['writer', 'falcone_webhook_key_writer'],
    ['lifecycle', 'falcone_webhook_key_lifecycle'],
  ]) {
    const client = await pools[kind].connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${authority}`);
      assert.equal((await client.query(
        'SELECT current_user::text AS current_user',
      )).rows[0].current_user, authority);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  const ownership = (await pools.admin.query(
    `SELECT class.relname AS object_name,
            pg_get_userbyid(class.relowner) AS owner_name
       FROM pg_class class
       JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p')
        AND class.relname = ANY($1::name[])
      ORDER BY class.relname`,
    [[
      'webhook_subscriptions',
      'webhook_signing_secrets',
      'webhook_deliveries',
      'webhook_delivery_attempts',
      'webhook_master_key_state',
      'webhook_master_key_rotations',
      'saga_runs',
      'tenants',
      'plans',
    ]],
  )).rows;
  for (const row of ownership) {
    const expectedOwner = row.object_name.startsWith('webhook_')
      ? names.schema
      : globalRole;
    assert.equal(row.owner_name, expectedOwner, `${row.object_name} owner`);
  }
});

test('POST create commits or rolls back subscription and signing secret together on PostgreSQL', {
  skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
  timeout: 30_000,
}, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const schemaPool = fixtureSchemaPool(databaseUrl);
  const runtimePool = new Pool({
    connectionString: databaseUrlForLogin(
      databaseUrl,
      FIXTURE_AUTHORITY_MEMBERS.falcone_app,
      FIXTURE_RUNTIME_PASSWORD,
    ),
    application_name: 'c25-atomic-bounded-runtime',
    max: 2,
  });
  const writerPool = new Pool({
    connectionString: databaseUrlForLogin(
      databaseUrl,
      FIXTURE_AUTHORITY_MEMBERS.falcone_webhook_key_writer,
      FIXTURE_WRITER_PASSWORD,
    ),
    application_name: 'c25-atomic-bounded-writer',
    max: 2,
  });
  const rejectConstraint = 'c25_reject_atomic_create_fixture';
  t.after(async () => {
    try {
      await pool.query(
        `ALTER TABLE webhook_signing_secrets
           DROP CONSTRAINT IF EXISTS ${rejectConstraint}`,
      );
      await pool.query(
        `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
                  webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
           RESTART IDENTITY CASCADE`,
      );
    } finally {
      await runtimePool.end();
      await writerPool.end();
      await schemaPool.end();
      await pool.end();
    }
  });
  await ensureFixedAuthorities(pool);
  const migration = (name) => applyMigration(
    schemaPool,
    name,
    fixturePrincipalNames(databaseUrl),
  );
  await migration('001-webhook-subscriptions.sql');
  await migration('002-signing-secret-tenant-scope.sql');
  await migration('003-rls-webhook-tables.sql');
  await migration('004-webhook-master-key-lifecycle.sql');
  await pool.query(
    `ALTER TABLE webhook_signing_secrets
       DROP CONSTRAINT IF EXISTS ${rejectConstraint}`,
  );
  await pool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state
       RESTART IDENTITY CASCADE`,
  );

  const sourceMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x41));
  const sourceKeyId = deriveWebhookKeyId('test-ns', 'atomic-source', 'key');
  const sourceContext = await buildWebhookMasterKeyRepository(pool).initializeOrVerify({
    material: sourceMaterial,
    keyId: sourceKeyId,
    mode: 'canonical-v1',
    managed: true,
  });
  const foreignMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x42));
  const foreignKeyId = deriveWebhookKeyId('test-ns', 'atomic-foreign', 'key');
  const foreignContext = createRuntimeWebhookKeyContext({
    material: foreignMaterial,
    keyId: foreignKeyId,
    mode: 'canonical-v1',
    lifecycleState: {
      lifecycle_state: 'serving',
      current_key_id: foreignKeyId,
      current_mode: 'canonical-v1',
    },
  });
  assert.throws(
    () => buildWebhookDb(runtimePool),
    { code: 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED' },
  );
  assert.throws(
    () => buildWebhookDb(runtimePool, { writePool: runtimePool }),
    { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' },
  );
  assert.throws(
    () => assertWebhookDatabasePoolBoundary(
      runtimePool,
      pool,
      { controlPlanePool: pool },
    ),
    { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' },
  );
  assert.deepEqual((await pool.query(
    `SELECT
       (SELECT count(*)::int FROM webhook_subscriptions) AS subscriptions,
       (SELECT count(*)::int FROM webhook_signing_secrets) AS secrets`,
  )).rows[0], {
    subscriptions: 0,
    secrets: 0,
  });
  const db = buildWebhookDb(runtimePool, { writePool: writerPool });
  const events = [];
  const create = (keyContext, tenantId, workspaceId) => managementMain({
    db,
    kafka: { publish: async (topic, payload) => events.push({ topic, payload }) },
    keyContext,
    env: { WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '1' },
    auth: { tenantId, workspaceId, actorId: 'postgres-atomic-test' },
    resolver: async () => ['93.184.216.34'],
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: {
      targetUrl: 'https://example.com/hook',
      eventTypes: ['document.created'],
    },
  });
  const counts = async (tenantId, workspaceId) => (await pool.query(
    `SELECT
       (SELECT count(*)::int
          FROM webhook_subscriptions
         WHERE tenant_id = $1 AND workspace_id = $2) AS subscriptions,
       (SELECT count(*)::int
          FROM webhook_signing_secrets
         WHERE tenant_id = $1 AND workspace_id = $2) AS secrets`,
    [tenantId, workspaceId],
  )).rows[0];

  const fenced = await create(foreignContext, 'tenant-atomic-fence', 'workspace-atomic-fence');
  assert.deepEqual(fenced, {
    statusCode: 503,
    body: {
      code: 'WEBHOOK_KEY_UNAVAILABLE',
      message: 'Webhook key lifecycle is not ready',
    },
  });
  assert.deepEqual(await counts('tenant-atomic-fence', 'workspace-atomic-fence'), {
    subscriptions: 0,
    secrets: 0,
  });
  assert.equal(events.length, 0);
  assert.doesNotMatch(JSON.stringify(fenced), /55000|WRITE_FENCED|atomic-foreign|cipher|secret_iv/);

  const corrected = await create(sourceContext, 'tenant-atomic-fence', 'workspace-atomic-fence');
  assert.equal(corrected.statusCode, 201);
  assert.deepEqual(await counts('tenant-atomic-fence', 'workspace-atomic-fence'), {
    subscriptions: 1,
    secrets: 1,
  });
  assert.equal(events.length, 1);

  await pool.query(
    `ALTER TABLE webhook_signing_secrets
       ADD CONSTRAINT ${rejectConstraint}
       CHECK (tenant_id <> 'tenant-atomic-db-failure') NOT VALID`,
  );
  const rejectedInsert = await create(
    sourceContext,
    'tenant-atomic-db-failure',
    'workspace-atomic-db-failure',
  );
  assert.deepEqual(rejectedInsert, {
    statusCode: 500,
    body: {
      code: 'WEBHOOK_CREATE_FAILED',
      message: 'Webhook subscription could not be created',
    },
  });
  assert.deepEqual(await counts('tenant-atomic-db-failure', 'workspace-atomic-db-failure'), {
    subscriptions: 0,
    secrets: 0,
  });
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(rejectedInsert), /23514|constraint|tenant-atomic-db-failure|cipher/);

  await pool.query(
    `ALTER TABLE webhook_signing_secrets
       DROP CONSTRAINT ${rejectConstraint}`,
  );
  const retried = await create(
    sourceContext,
    'tenant-atomic-db-failure',
    'workspace-atomic-db-failure',
  );
  assert.equal(retried.statusCode, 201);
  assert.deepEqual(await counts('tenant-atomic-db-failure', 'workspace-atomic-db-failure'), {
    subscriptions: 1,
    secrets: 1,
  });
  assert.equal(events.length, 2);
  assert.deepEqual(await counts('tenant-adjacent', 'workspace-adjacent'), {
    subscriptions: 0,
    secrets: 0,
  });
});
