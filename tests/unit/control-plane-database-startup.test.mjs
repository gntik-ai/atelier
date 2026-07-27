import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  prepareControlPlaneDatabases,
  reconcileWebhookLifecycleAuditAccess,
} from '../../apps/control-plane/control-plane-database-startup.mjs';

const CONTROL_PLANE_POOL = Object.freeze({ name: 'global-control-plane' });
const WEBHOOK_SCHEMA_POOL = Object.freeze({ name: 'webhook-schema' });
const WEBHOOK_RUNTIME_POOL = Object.freeze({ name: 'webhook-runtime' });
const WEBHOOK_WRITE_POOL = Object.freeze({ name: 'webhook-write' });
const WEBHOOK_LIFECYCLE_POOL = Object.freeze({ name: 'webhook-lifecycle' });
const PRINCIPALS = Object.freeze({
  schema: 'fixture_schema',
  runtime: 'fixture_runtime',
  writer: 'fixture_writer',
  lifecycle: 'fixture_lifecycle',
  grantor: 'fixture_grantor',
});

test('control-plane startup preserves global duties and routes only webhook DDL to schema', async () => {
  const events = [];
  const verificationOptions = [];
  const dependencies = {
    verifyWebhookDatabasePrincipalSessions: async (options) => {
      events.push('verify-sessions');
      verificationOptions.push(options);
    },
    ensureSchema: async (pool) => {
      assert.equal(pool, CONTROL_PLANE_POOL);
      events.push('tenant-global');
    },
    ensureSagaSchema: async (pool) => {
      assert.equal(pool, CONTROL_PLANE_POOL);
      events.push('saga-global');
    },
    applyGovernanceSchema: async (pool) => {
      assert.equal(pool, CONTROL_PLANE_POOL);
      events.push('governance-global');
    },
    reconcileWebhookLifecycleAuditAccess: async (pool) => {
      assert.equal(pool, CONTROL_PLANE_POOL);
      events.push('audit-global');
    },
    applyWebhookSchema: async (pool, options) => {
      assert.equal(pool, WEBHOOK_SCHEMA_POOL);
      assert.deepEqual(options, { principalNames: PRINCIPALS });
      events.push('webhook-schema-only');
    },
    verifyWebhookDatabasePrincipalConnections: async (options) => {
      events.push('verify-post-ddl');
      verificationOptions.push(options);
    },
    recoverSagas: async (pool) => {
      assert.equal(pool, CONTROL_PLANE_POOL);
      events.push('recover-global');
      return 2;
    },
  };

  const recovered = await prepareControlPlaneDatabases({
    controlPlanePool: CONTROL_PLANE_POOL,
    webhookSchemaPool: WEBHOOK_SCHEMA_POOL,
    webhookRuntimePool: WEBHOOK_RUNTIME_POOL,
    webhookWritePool: WEBHOOK_WRITE_POOL,
    webhookLifecyclePool: WEBHOOK_LIFECYCLE_POOL,
    webhookDatabasePrincipals: PRINCIPALS,
    attempt: 1,
    dependencies,
  });

  assert.equal(recovered, 2);
  assert.deepEqual(events, [
    'verify-sessions',
    'tenant-global',
    'saga-global',
    'governance-global',
    'audit-global',
    'webhook-schema-only',
    'verify-post-ddl',
    'recover-global',
  ]);
  assert.equal(verificationOptions.length, 2);
  for (const options of verificationOptions) {
    assert.equal(options.controlPlanePool, CONTROL_PLANE_POOL);
    assert.equal(options.schemaPool, WEBHOOK_SCHEMA_POOL);
    assert.equal(options.runtimePool, WEBHOOK_RUNTIME_POOL);
    assert.equal(options.writerPool, WEBHOOK_WRITE_POOL);
    assert.equal(options.lifecyclePool, WEBHOOK_LIFECYCLE_POOL);
    assert.equal(options.names, PRINCIPALS);
  }
});

test('global owner reconciles only lifecycle audit access outside webhook schema DDL', async () => {
  let statement = '';
  await reconcileWebhookLifecycleAuditAccess({
    query: async (sql) => {
      statement = sql;
    },
  });
  assert.match(statement, /REVOKE ALL PRIVILEGES ON TABLE plan_audit_events/);
  assert.match(statement, /GRANT SELECT, INSERT ON TABLE plan_audit_events/);
  assert.match(statement, /TO falcone_webhook_key_lifecycle/);
});

test('server and handler source keep the global pool separate from webhook runtime', async () => {
  const [serverSource, handlerSource] = await Promise.all([
    readFile(new URL('../../apps/control-plane/server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/control-plane/webhook-handlers.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(serverSource, /WEBHOOK_RUNTIME_DATABASE_URL/);
  assert.match(serverSource, /controlPlanePool:\s*pool/);
  assert.match(serverSource, /webhookRuntimePool/);
  assert.match(serverSource, /await webhookSchemaPool\.end\(\)/);
  assert.match(serverSource, /await webhookLifecyclePool\.end\(\)/);
  assert.match(handlerSource, /buildDb\(ctx\.webhookRuntimePool/);
  assert.doesNotMatch(handlerSource, /buildDb\(ctx\.pool/);
});
