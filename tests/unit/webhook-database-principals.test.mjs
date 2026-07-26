import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyWebhookDatabasePrincipalConnections,
  verifyWebhookDatabasePrincipalSessions,
  verifyWebhookLifecyclePrincipalConnections,
  verifyWebhookLifecyclePrincipalSessions,
} from '../../apps/control-plane/webhook-database-principals.mjs';

const names = {
  schema: 'c25_schema',
  runtime: 'c25_runtime',
  writer: 'c25_writer',
  lifecycle: 'c25_lifecycle',
  grantor: 'c25_admin',
};

function boundedIdentity(sessionUser, overrides = {}) {
  return {
    session_user: sessionUser,
    current_user: sessionUser,
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    ...overrides,
  };
}

function exactMemberships() {
  return [
    {
      granted_role: 'falcone_app',
      member_role: names.runtime,
      grantor_role: names.grantor,
      admin_option: false,
      inherit_option: true,
      set_option: false,
    },
    {
      granted_role: 'falcone_webhook_key_writer',
      member_role: names.writer,
      grantor_role: names.grantor,
      admin_option: false,
      inherit_option: false,
      set_option: true,
    },
    {
      granted_role: 'falcone_webhook_key_lifecycle',
      member_role: names.lifecycle,
      grantor_role: names.grantor,
      admin_option: false,
      inherit_option: false,
      set_option: true,
    },
  ];
}

function fixture({
  identity,
  schema = false,
  memberships = null,
  serverVersion = 160000,
} = {}) {
  const calls = [];
  let releases = 0;
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (/session_user::text/i.test(sql)) return { rows: [identity] };
      if (/server_version_num/i.test(sql)) {
        return { rows: [{ server_version_num: serverVersion }] };
      }
      if (/WHERE rolname = ANY/i.test(sql)) {
        return {
          rows: [
            { rolname: 'falcone_app', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
            { rolname: 'falcone_webhook_key_writer', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
            { rolname: 'falcone_webhook_key_lifecycle', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
          ],
        };
      }
      if (/WHERE rolname = \$1/i.test(sql)) {
        return {
          rows: [{
            rolname: names.grantor,
            rolcanlogin: true,
            rolsuper: true,
          }],
        };
      }
      if (/FROM pg_auth_members/i.test(sql)) {
        return {
          rows: memberships ?? exactMemberships(),
        };
      }
      if (/JOIN pg_attribute/i.test(sql)) return { rows: [] };
      if (/aclexplode/i.test(sql) && /FROM pg_class/i.test(sql)) {
        const privileges = {
          webhook_subscriptions: {
            falcone_app: ['DELETE', 'SELECT', 'UPDATE'],
            falcone_webhook_key_writer: ['INSERT'],
          },
          webhook_signing_secrets: {
            falcone_app: ['SELECT'],
            falcone_webhook_key_lifecycle: ['SELECT', 'UPDATE'],
            falcone_webhook_key_writer: ['INSERT', 'SELECT', 'UPDATE'],
          },
          webhook_deliveries: {
            falcone_app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
          },
          webhook_delivery_attempts: {
            falcone_app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
          },
          webhook_master_key_state: {
            falcone_webhook_key_lifecycle: ['INSERT', 'SELECT', 'UPDATE'],
          },
          webhook_master_key_rotations: {
            falcone_webhook_key_lifecycle: ['INSERT', 'SELECT', 'UPDATE'],
          },
        };
        return {
          rows: Object.entries(privileges).flatMap(([object_name, grantees]) => (
            Object.entries(grantees).flatMap(([grantee_name, allowed]) => (
              allowed.map((privilege_type) => ({
                object_name,
                grantee_name,
                privilege_type,
                grantor_name: names.schema,
                is_grantable: false,
              }))
            ))
          )),
        };
      }
      if (/aclexplode/i.test(sql) && /FROM pg_proc/i.test(sql)) {
        return {
          rows: [{
            object_name: 'falcone_webhook_key_write_current_id',
            grantee_name: 'falcone_webhook_key_writer',
            privilege_type: 'EXECUTE',
            grantor_name: names.schema,
            is_grantable: false,
          }],
        };
      }
      if (/class\.relrowsecurity/i.test(sql)) {
        return {
          rows: [
            'webhook_subscriptions',
            'webhook_signing_secrets',
            'webhook_deliveries',
            'webhook_delivery_attempts',
            'webhook_master_key_state',
            'webhook_master_key_rotations',
          ].map((object_name) => ({
            object_name,
            relrowsecurity: false,
            relforcerowsecurity: false,
          })),
        };
      }
      if (/FROM pg_policy/i.test(sql)) return { rows: [] };
      if (/FROM pg_class/i.test(sql)) {
        return {
          rows: [
            'webhook_subscriptions',
            'webhook_signing_secrets',
            'webhook_deliveries',
            'webhook_delivery_attempts',
            'webhook_master_key_state',
            'webhook_master_key_rotations',
          ].map((object_name) => ({ object_name, owner_name: 'c25_schema' })),
        };
      }
      if (/FROM pg_proc/i.test(sql)) {
        return {
          rows: [
            'falcone_webhook_key_write_current_id',
            'falcone_webhook_signing_secret_write_statement_fence',
            'falcone_webhook_signing_secret_write_fence',
          ].map((object_name) => ({ object_name, owner_name: 'c25_schema' })),
        };
      }
      assert.fail(`unexpected principal fixture query: ${sql}`);
    },
    release() { releases += 1; },
  };
  return {
    pool: {
      async query(...args) { return client.query(...args); },
      async connect() { return client; },
    },
    calls,
    get releases() { return releases; },
    schema,
  };
}

test('principal verifier authenticates four bounded sessions before graph and ownership checks', async () => {
  const schema = fixture({ identity: boundedIdentity('c25_schema'), schema: true });
  const runtime = fixture({ identity: boundedIdentity(names.runtime) });
  const writer = fixture({ identity: boundedIdentity(names.writer) });
  const lifecycle = fixture({ identity: boundedIdentity(names.lifecycle) });
  const result = await verifyWebhookDatabasePrincipalConnections({
    schemaPool: schema.pool,
    runtimePool: runtime.pool,
    writerPool: writer.pool,
    lifecyclePool: lifecycle.pool,
    names,
  });
  assert.deepEqual(result, {
    schemaExecutor: 'c25_schema',
    runtime: names.runtime,
    writer: names.writer,
    lifecycle: names.lifecycle,
  });
  for (const entry of [schema, runtime, writer, lifecycle]) {
    assert.match(entry.calls[0], /session_user::text/i);
    assert.equal(entry.releases, 1);
  }
  assert.ok(schema.calls.some((sql) => /FROM pg_class/i.test(sql)));
  assert.ok(schema.calls.some((sql) => /FROM pg_proc/i.test(sql)));
});

test('pre-DDL principal verifier rejects a startup-role alias and releases every lease', async () => {
  const schema = fixture({
    identity: boundedIdentity('postgres', { current_user: 'c25_schema' }),
  });
  const runtime = fixture({ identity: boundedIdentity(names.runtime) });
  const writer = fixture({ identity: boundedIdentity(names.writer) });
  const lifecycle = fixture({ identity: boundedIdentity(names.lifecycle) });
  await assert.rejects(verifyWebhookDatabasePrincipalSessions({
    schemaPool: schema.pool,
    runtimePool: runtime.pool,
    writerPool: writer.pool,
    lifecyclePool: lifecycle.pool,
    names,
  }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
  assert.deepEqual(
    [schema, runtime, writer, lifecycle].map((entry) => entry.releases),
    [1, 1, 1, 1],
  );
});

test('principal verifier rejects privileged sessions and any non-exact direct membership', async () => {
  const privilegedSchema = fixture({
    identity: boundedIdentity('c25_schema', { rolcreaterole: true }),
  });
  await assert.rejects(verifyWebhookDatabasePrincipalSessions({
    schemaPool: privilegedSchema.pool,
    runtimePool: fixture({ identity: boundedIdentity(names.runtime) }).pool,
    writerPool: fixture({ identity: boundedIdentity(names.writer) }).pool,
    lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
    names,
  }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });

  const schema = fixture({
    identity: boundedIdentity('c25_schema'),
    memberships: [
      {
        granted_role: 'falcone_app',
        member_role: names.runtime,
        grantor_role: names.grantor,
        admin_option: false,
        inherit_option: true,
        set_option: false,
      },
      {
        granted_role: 'falcone_webhook_key_writer',
        member_role: names.writer,
        grantor_role: names.grantor,
        admin_option: false,
        inherit_option: false,
        set_option: true,
      },
      {
        granted_role: 'falcone_webhook_key_lifecycle',
        member_role: names.lifecycle,
        grantor_role: names.grantor,
        admin_option: false,
        inherit_option: false,
        set_option: true,
      },
      {
        granted_role: 'falcone_webhook_key_writer',
        member_role: 'c25_schema',
        grantor_role: names.grantor,
        admin_option: true,
        inherit_option: false,
        set_option: true,
      },
    ],
  });
  await assert.rejects(verifyWebhookDatabasePrincipalSessions({
    schemaPool: schema.pool,
    runtimePool: fixture({ identity: boundedIdentity(names.runtime) }).pool,
    writerPool: fixture({ identity: boundedIdentity(names.writer) }).pool,
    lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
    names,
  }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
});

test('principal verifier rejects pre-PostgreSQL-16 catalogs with a bounded code', async () => {
  const schema = fixture({
    identity: boundedIdentity('c25_schema'),
    serverVersion: 150000,
  });
  await assert.rejects(verifyWebhookDatabasePrincipalSessions({
    schemaPool: schema.pool,
    runtimePool: fixture({ identity: boundedIdentity(names.runtime) }).pool,
    writerPool: fixture({ identity: boundedIdentity(names.writer) }).pool,
    lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
    names,
  }), { code: 'WEBHOOK_POSTGRESQL_16_REQUIRED' });
});

test('principal verifier rejects PostgreSQL 16 edge-option and grantor drift', async () => {
  const mutations = [
    (rows) => { rows[0].inherit_option = false; },
    (rows) => { rows[0].set_option = true; },
    (rows) => { rows[1].inherit_option = true; },
    (rows) => { rows[1].set_option = false; },
    (rows) => { rows[2].inherit_option = true; },
    (rows) => { rows[2].set_option = false; },
    (rows) => { rows[0].admin_option = true; },
    (rows) => { rows[1].grantor_role = 'other_admin'; },
    (rows) => {
      rows.push({
        ...rows[2],
        grantor_role: 'other_admin',
      });
    },
  ];
  for (const mutate of mutations) {
    const memberships = exactMemberships().map((row) => ({ ...row }));
    mutate(memberships);
    await assert.rejects(verifyWebhookDatabasePrincipalSessions({
      schemaPool: fixture({
        identity: boundedIdentity(names.schema),
        memberships,
      }).pool,
      runtimePool: fixture({ identity: boundedIdentity(names.runtime) }).pool,
      writerPool: fixture({ identity: boundedIdentity(names.writer) }).pool,
      lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
      names,
    }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
  }
});

test('global control-plane session is distinct, may retain CREATEDB, and has no webhook edge', async () => {
  const controlPlane = fixture({
    identity: boundedIdentity('falcone_global', { rolcreatedb: true }),
  });
  const result = await verifyWebhookDatabasePrincipalSessions({
    controlPlanePool: controlPlane.pool,
    schemaPool: fixture({ identity: boundedIdentity(names.schema) }).pool,
    runtimePool: fixture({ identity: boundedIdentity(names.runtime) }).pool,
    writerPool: fixture({ identity: boundedIdentity(names.writer) }).pool,
    lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
    names,
  });
  assert.equal(result.schemaExecutor, names.schema);

  await assert.rejects(verifyWebhookDatabasePrincipalSessions({
    controlPlanePool: fixture({
      identity: boundedIdentity(names.runtime, { rolcreatedb: true }),
    }).pool,
    schemaPool: fixture({ identity: boundedIdentity(names.schema) }).pool,
    runtimePool: fixture({ identity: boundedIdentity(names.runtime) }).pool,
    writerPool: fixture({ identity: boundedIdentity(names.writer) }).pool,
    lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
    names,
  }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
});

test('lifecycle-only verifier rejects lifecycle SET/INHERIT and grantor drift', async () => {
  for (const mutate of [
    (rows) => { rows[2].set_option = false; },
    (rows) => { rows[2].inherit_option = true; },
    (rows) => { rows[2].grantor_role = 'other_admin'; },
  ]) {
    const memberships = exactMemberships().map((row) => ({ ...row }));
    mutate(memberships);
    await assert.rejects(verifyWebhookLifecyclePrincipalSessions({
      schemaPool: fixture({
        identity: boundedIdentity(names.schema),
        memberships,
      }).pool,
      lifecyclePool: fixture({ identity: boundedIdentity(names.lifecycle) }).pool,
      names,
    }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
  }
});

test('lifecycle-only verification rejects one authenticated session hidden by current_user aliases', async () => {
  const schema = fixture({
    identity: boundedIdentity('postgres', { current_user: 'c25_schema' }),
  });
  const lifecycle = fixture({
    identity: boundedIdentity('postgres', { current_user: names.lifecycle }),
  });
  await assert.rejects(verifyWebhookLifecyclePrincipalConnections({
    schemaPool: schema.pool,
    lifecyclePool: lifecycle.pool,
    names,
  }), { code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID' });
  assert.equal(schema.releases, 1);
  assert.equal(lifecycle.releases, 1);
});
