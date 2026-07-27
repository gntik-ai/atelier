const LOGIN_NAME = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const AUTHORITY_ROLES = Object.freeze({
  runtime: 'falcone_app',
  writer: 'falcone_webhook_key_writer',
  lifecycle: 'falcone_webhook_key_lifecycle',
});
const WEBHOOK_RELATIONS = Object.freeze([
  'webhook_subscriptions',
  'webhook_signing_secrets',
  'webhook_deliveries',
  'webhook_delivery_attempts',
  'webhook_master_key_state',
  'webhook_master_key_rotations',
]);
const WEBHOOK_FUNCTIONS = Object.freeze([
  'falcone_webhook_key_write_current_id',
  'falcone_webhook_signing_secret_write_statement_fence',
  'falcone_webhook_signing_secret_write_fence',
]);
const EXPECTED_RELATION_PRIVILEGES = Object.freeze([
  'webhook_subscriptions:falcone_app:DELETE',
  'webhook_subscriptions:falcone_app:SELECT',
  'webhook_subscriptions:falcone_app:UPDATE',
  'webhook_subscriptions:falcone_webhook_key_writer:INSERT',
  'webhook_signing_secrets:falcone_app:SELECT',
  'webhook_signing_secrets:falcone_webhook_key_lifecycle:SELECT',
  'webhook_signing_secrets:falcone_webhook_key_lifecycle:UPDATE',
  'webhook_signing_secrets:falcone_webhook_key_writer:INSERT',
  'webhook_signing_secrets:falcone_webhook_key_writer:SELECT',
  'webhook_signing_secrets:falcone_webhook_key_writer:UPDATE',
  'webhook_deliveries:falcone_app:DELETE',
  'webhook_deliveries:falcone_app:INSERT',
  'webhook_deliveries:falcone_app:SELECT',
  'webhook_deliveries:falcone_app:UPDATE',
  'webhook_delivery_attempts:falcone_app:DELETE',
  'webhook_delivery_attempts:falcone_app:INSERT',
  'webhook_delivery_attempts:falcone_app:SELECT',
  'webhook_delivery_attempts:falcone_app:UPDATE',
  'webhook_master_key_state:falcone_webhook_key_lifecycle:INSERT',
  'webhook_master_key_state:falcone_webhook_key_lifecycle:SELECT',
  'webhook_master_key_state:falcone_webhook_key_lifecycle:UPDATE',
  'webhook_master_key_rotations:falcone_webhook_key_lifecycle:INSERT',
  'webhook_master_key_rotations:falcone_webhook_key_lifecycle:SELECT',
  'webhook_master_key_rotations:falcone_webhook_key_lifecycle:UPDATE',
].sort());
const EXPECTED_FUNCTION_PRIVILEGES = Object.freeze([
  'falcone_webhook_key_write_current_id:falcone_webhook_key_writer:EXECUTE',
]);
const TENANT_POLICY_EXPRESSION = Object.freeze({
  using: "((tenant_id = current_setting('app.tenant_id'::text, true)) AND (workspace_id = current_setting('app.workspace_id'::text, true)))",
  check: "((tenant_id = current_setting('app.tenant_id'::text, true)) AND (workspace_id = current_setting('app.workspace_id'::text, true)))",
});
const EXPECTED_RLS_POLICIES = Object.freeze({
  'webhook_subscriptions:webhook_subscriptions_tenant_isolation': {
    roles: ['falcone_app'],
    using: TENANT_POLICY_EXPRESSION.using,
    check: TENANT_POLICY_EXPRESSION.check,
  },
  'webhook_subscriptions:webhook_subscriptions_key_writer': {
    roles: ['falcone_webhook_key_writer'],
    using: TENANT_POLICY_EXPRESSION.using,
    check: TENANT_POLICY_EXPRESSION.check,
  },
  'webhook_signing_secrets:webhook_signing_secrets_tenant_isolation': {
    roles: ['falcone_app'],
    using: TENANT_POLICY_EXPRESSION.using,
    check: TENANT_POLICY_EXPRESSION.check,
  },
  'webhook_signing_secrets:webhook_signing_secrets_key_lifecycle': {
    roles: ['falcone_webhook_key_lifecycle'],
    using: 'true',
    check: 'true',
  },
  'webhook_signing_secrets:webhook_signing_secrets_key_writer': {
    roles: ['falcone_webhook_key_writer'],
    using: TENANT_POLICY_EXPRESSION.using,
    check: TENANT_POLICY_EXPRESSION.check,
  },
  'webhook_deliveries:webhook_deliveries_tenant_isolation': {
    roles: ['falcone_app'],
    using: TENANT_POLICY_EXPRESSION.using,
    check: TENANT_POLICY_EXPRESSION.check,
  },
  'webhook_delivery_attempts:webhook_delivery_attempts_tenant_isolation': {
    roles: ['falcone_app'],
    using: "(EXISTS ( SELECT 1\n   FROM webhook_deliveries d\n  WHERE ((d.id = webhook_delivery_attempts.delivery_id) AND (d.tenant_id = current_setting('app.tenant_id'::text, true)) AND (d.workspace_id = current_setting('app.workspace_id'::text, true)))))",
    check: "(EXISTS ( SELECT 1\n   FROM webhook_deliveries d\n  WHERE ((d.id = webhook_delivery_attempts.delivery_id) AND (d.tenant_id = current_setting('app.tenant_id'::text, true)) AND (d.workspace_id = current_setting('app.workspace_id'::text, true)))))",
  },
});

function configurationError(
  code = 'WEBHOOK_DATABASE_PRINCIPALS_INVALID',
  reason = null,
) {
  return Object.assign(
    new Error('Webhook database principal configuration is invalid'),
    { code, ...(reason ? { reason } : {}) },
  );
}

function requireLoginName(value) {
  const name = String(value ?? '');
  if (!LOGIN_NAME.test(name)) throw configurationError();
  return name;
}

export function resolveWebhookDatabasePrincipalNames(env = process.env) {
  const names = Object.freeze({
    schema: requireLoginName(env.WEBHOOK_SCHEMA_DATABASE_ROLE),
    runtime: requireLoginName(env.WEBHOOK_RUNTIME_DATABASE_ROLE),
    writer: requireLoginName(env.WEBHOOK_KEY_WRITE_DATABASE_ROLE),
    lifecycle: requireLoginName(env.WEBHOOK_KEY_LIFECYCLE_DATABASE_ROLE),
    grantor: requireLoginName(env.WEBHOOK_DATABASE_AUTHORITY_GRANTOR_ROLE),
  });
  if (new Set(Object.values(names)).size !== 5
      || Object.values(names).some((name) => Object.values(AUTHORITY_ROLES).includes(name))) {
    throw configurationError();
  }
  return names;
}

function assertBoundedLogin(identity) {
  if (!identity
      || !LOGIN_NAME.test(identity.session_user)
      || identity.session_user !== identity.current_user
      || !identity.rolcanlogin
      || identity.rolsuper
      || identity.rolcreatedb
      || identity.rolcreaterole
      || identity.rolreplication
      || identity.rolbypassrls) {
    throw configurationError();
  }
}

function assertControlPlaneLogin(identity) {
  if (!identity
      || !LOGIN_NAME.test(identity.session_user)
      || identity.session_user !== identity.current_user
      || !identity.rolcanlogin
      || identity.rolsuper
      || identity.rolcreaterole
      || identity.rolreplication
      || identity.rolbypassrls) {
    throw configurationError();
  }
}

async function readAuthenticatedIdentity(client, { controlPlane = false } = {}) {
  const { rows } = await client.query(
    `SELECT session_user::text AS session_user,
            current_user::text AS current_user,
            session_role.rolcanlogin,
            session_role.rolsuper,
            session_role.rolcreatedb,
            session_role.rolcreaterole,
            session_role.rolreplication,
            session_role.rolbypassrls
       FROM pg_roles session_role
      WHERE session_role.rolname = session_user`,
  );
  const identity = rows[0];
  if (controlPlane) assertControlPlaneLogin(identity);
  else assertBoundedLogin(identity);
  return identity;
}

async function acquire(pool, leases) {
  if (!pool?.query) throw configurationError();
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  leases.push({ client, releasable: client !== pool });
  return client;
}

async function releaseAll(leases) {
  await Promise.allSettled(
    [...new Set(leases.filter(({ releasable }) => releasable).map(({ client }) => client))]
      .map(async (client) => client.release?.()),
  );
}

async function assertRequiredRolesAndExactGraph(
  client,
  schemaExecutor,
  names,
  controlPlaneExecutor = null,
) {
  const { rows: versionRows } = await client.query(
    `SELECT current_setting('server_version_num')::integer
            AS server_version_num`,
  );
  if (Number(versionRows[0]?.server_version_num) < 160000) {
    throw configurationError('WEBHOOK_POSTGRESQL_16_REQUIRED');
  }

  const requiredRoles = Object.values(AUTHORITY_ROLES);
  const { rows: roles } = await client.query(
    `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
       FROM pg_roles
      WHERE rolname = ANY($1::name[])`,
    [requiredRoles],
  );
  if (roles.length !== requiredRoles.length
      || roles.some((role) => role.rolcanlogin
        || role.rolsuper
        || role.rolcreatedb
        || role.rolcreaterole
        || role.rolreplication
        || role.rolbypassrls)) {
    throw configurationError();
  }

  const { rows: grantors } = await client.query(
    `SELECT rolname, rolcanlogin, rolsuper
       FROM pg_roles
      WHERE rolname = $1`,
    [names.grantor],
  );
  if (grantors.length !== 1
      || !grantors[0].rolcanlogin
      || !grantors[0].rolsuper) {
    throw configurationError();
  }

  const boundedNames = [names.schema, names.runtime, names.writer, names.lifecycle];
  const principals = [
    schemaExecutor,
    controlPlaneExecutor,
    ...boundedNames,
    ...requiredRoles,
  ].filter(Boolean);
  const { rows: memberships } = await client.query(
    `SELECT granted.rolname AS granted_role,
            member.rolname AS member_role,
            grantor.rolname AS grantor_role,
            membership.admin_option,
            membership.inherit_option,
            membership.set_option
       FROM pg_auth_members membership
       JOIN pg_roles granted ON granted.oid = membership.roleid
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles grantor ON grantor.oid = membership.grantor
      WHERE granted.rolname = ANY($1::name[])
         OR member.rolname = ANY($1::name[])
      ORDER BY granted.rolname, member.rolname`,
    [principals],
  );
  const actual = memberships.map((row) => (
    `${row.granted_role}:${row.member_role}`
      + `:${row.admin_option ? 'admin' : 'no-admin'}`
      + `:${row.inherit_option ? 'inherit' : 'no-inherit'}`
      + `:${row.set_option ? 'set' : 'no-set'}`
      + `:${row.grantor_role}`
  ));
  const expected = [
    `${AUTHORITY_ROLES.runtime}:${names.runtime}:no-admin:inherit:no-set:${names.grantor}`,
    `${AUTHORITY_ROLES.writer}:${names.writer}:no-admin:no-inherit:set:${names.grantor}`,
    `${AUTHORITY_ROLES.lifecycle}:${names.lifecycle}:no-admin:no-inherit:set:${names.grantor}`,
  ].sort();
  if (actual.sort().join('\n') !== expected.join('\n')) {
    throw configurationError();
  }
}

async function assertWebhookObjectOwnership(client, schemaExecutor) {
  const { rows: relations } = await client.query(
    `SELECT class.relname AS object_name,
            pg_get_userbyid(class.relowner) AS owner_name
       FROM pg_class class
       JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p')
        AND class.relname = ANY($1::name[])`,
    [WEBHOOK_RELATIONS],
  );
  const { rows: functions } = await client.query(
    `SELECT procedure.proname AS object_name,
            pg_get_userbyid(procedure.proowner) AS owner_name
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = ANY($1::name[])`,
    [WEBHOOK_FUNCTIONS],
  );
  if (relations.length !== WEBHOOK_RELATIONS.length
      || functions.length !== WEBHOOK_FUNCTIONS.length
      || [...relations, ...functions].some(({ owner_name: owner }) => owner !== schemaExecutor)) {
    throw configurationError();
  }
}

function normalizedPolicyExpression(value) {
  return value == null ? null : String(value).replace(/[ \t]+/g, ' ').trim();
}

async function assertWebhookObjectAuthorization(client, schemaExecutor) {
  const { rows: relationPrivileges } = await client.query(
    `SELECT class.relname AS object_name,
            COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name,
            privilege.privilege_type,
            pg_get_userbyid(privilege.grantor) AS grantor_name,
            privilege.is_grantable
       FROM pg_class class
       CROSS JOIN LATERAL aclexplode(
         COALESCE(class.relacl, acldefault('r', class.relowner))
       ) privilege
       LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
       JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p')
        AND class.relname = ANY($1::name[])
        AND privilege.grantee <> class.relowner
      ORDER BY class.relname, grantee_name, privilege.privilege_type`,
    [WEBHOOK_RELATIONS],
  );
  const actualRelationPrivileges = relationPrivileges.map((row) => (
    `${row.object_name}:${row.grantee_name}:${row.privilege_type}`
  )).sort();
  if (actualRelationPrivileges.join('\n') !== EXPECTED_RELATION_PRIVILEGES.join('\n')
      || relationPrivileges.some((row) => (
        row.grantor_name !== schemaExecutor || row.is_grantable
      ))) {
    throw configurationError();
  }

  const { rows: columnPrivileges } = await client.query(
    `SELECT class.relname AS object_name,
            attribute.attname AS column_name,
            COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name,
            privilege.privilege_type
       FROM pg_class class
       JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
       JOIN pg_attribute attribute
         ON attribute.attrelid = class.oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
       CROSS JOIN LATERAL aclexplode(attribute.attacl) privilege
       LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE namespace.nspname = 'public'
        AND class.relname = ANY($1::name[])
        AND privilege.grantee <> class.relowner`,
    [WEBHOOK_RELATIONS],
  );
  if (columnPrivileges.length !== 0) throw configurationError();

  const { rows: functionPrivileges } = await client.query(
    `SELECT procedure.proname AS object_name,
            COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name,
            privilege.privilege_type,
            pg_get_userbyid(privilege.grantor) AS grantor_name,
            privilege.is_grantable
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       CROSS JOIN LATERAL aclexplode(
         COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
       ) privilege
       LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE namespace.nspname = 'public'
        AND procedure.proname = ANY($1::name[])
        AND procedure.pronargs = 0
        AND privilege.grantee <> procedure.proowner
      ORDER BY procedure.proname, grantee_name, privilege.privilege_type`,
    [WEBHOOK_FUNCTIONS],
  );
  const actualFunctionPrivileges = functionPrivileges.map((row) => (
    `${row.object_name}:${row.grantee_name}:${row.privilege_type}`
  )).sort();
  if (actualFunctionPrivileges.join('\n') !== EXPECTED_FUNCTION_PRIVILEGES.join('\n')
      || functionPrivileges.some((row) => (
        row.grantor_name !== schemaExecutor || row.is_grantable
      ))) {
    throw configurationError();
  }

  const { rows: relationSecurity } = await client.query(
    `SELECT class.relname AS object_name,
            class.relrowsecurity,
            class.relforcerowsecurity
       FROM pg_class class
       JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p')
        AND class.relname = ANY($1::name[])
      ORDER BY class.relname`,
    [WEBHOOK_RELATIONS],
  );
  if (relationSecurity.length !== WEBHOOK_RELATIONS.length) throw configurationError();
  const tenantRelations = relationSecurity.filter(({ object_name: name }) => (
    !name.startsWith('webhook_master_key_')
  ));
  const lifecycleRelations = relationSecurity.filter(({ object_name: name }) => (
    name.startsWith('webhook_master_key_')
  ));
  const rlsEnabled = tenantRelations.every((row) => (
    row.relrowsecurity && row.relforcerowsecurity
  ));
  const rlsDisabled = tenantRelations.every((row) => (
    !row.relrowsecurity && !row.relforcerowsecurity
  ));
  if ((!rlsEnabled && !rlsDisabled)
      || lifecycleRelations.some((row) => (
        row.relrowsecurity || row.relforcerowsecurity
      ))) {
    throw configurationError();
  }

  const { rows: policies } = await client.query(
    `SELECT class.relname AS object_name,
            policy.polname AS policy_name,
            policy.polpermissive,
            policy.polcmd,
            ARRAY(
              SELECT role.rolname
                FROM unnest(policy.polroles) policy_role(oid)
                JOIN pg_roles role ON role.oid = policy_role.oid
               ORDER BY role.rolname
            )::text[] AS role_names,
            pg_get_expr(policy.polqual, policy.polrelid, false) AS using_expression,
            pg_get_expr(policy.polwithcheck, policy.polrelid, false) AS check_expression
       FROM pg_policy policy
       JOIN pg_class class ON class.oid = policy.polrelid
       JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relname = ANY($1::name[])
      ORDER BY class.relname, policy.polname`,
    [WEBHOOK_RELATIONS],
  );
  if (rlsDisabled) {
    if (policies.length !== 0) throw configurationError();
    return;
  }
  if (policies.length !== Object.keys(EXPECTED_RLS_POLICIES).length) {
    throw configurationError(undefined, 'policy_inventory');
  }
  for (const policy of policies) {
    const expected = EXPECTED_RLS_POLICIES[
      `${policy.object_name}:${policy.policy_name}`
    ];
    if (!expected
        || !policy.polpermissive
        || policy.polcmd !== '*'
        || policy.role_names.join('\n') !== expected.roles.join('\n')
        || normalizedPolicyExpression(policy.using_expression)
          !== normalizedPolicyExpression(expected.using)
        || normalizedPolicyExpression(policy.check_expression)
          !== normalizedPolicyExpression(expected.check)) {
      throw configurationError(
        undefined,
        `policy_definition:${policy.object_name}:${policy.policy_name}`,
      );
    }
  }
}

async function verifyGraph(
  client,
  schemaExecutor,
  names,
  verifyOwnership,
  controlPlaneExecutor = null,
) {
  await assertRequiredRolesAndExactGraph(
    client,
    schemaExecutor,
    names,
    controlPlaneExecutor,
  );
  if (verifyOwnership) {
    await assertWebhookObjectOwnership(client, schemaExecutor);
    await assertWebhookObjectAuthorization(client, schemaExecutor);
  }
}

/**
 * Verify the authenticated sessions behind all four production pools.
 *
 * This function is deliberately read-only. Credentialed LOGINs, fixed NOLOGIN
 * authorities, legacy-membership repair, and exact membership binding belong to
 * the separately authenticated one-shot chart bootstrap. The application never
 * creates, alters, grants, revokes, or re-provisions global PostgreSQL roles.
 */
async function verifyAllPrincipalConnections({
  controlPlanePool = null,
  schemaPool,
  runtimePool,
  writerPool,
  lifecyclePool,
  names,
}, verifyOwnership) {
  const resolved = resolveWebhookDatabasePrincipalNames({
    WEBHOOK_SCHEMA_DATABASE_ROLE: names?.schema,
    WEBHOOK_RUNTIME_DATABASE_ROLE: names?.runtime,
    WEBHOOK_KEY_WRITE_DATABASE_ROLE: names?.writer,
    WEBHOOK_KEY_LIFECYCLE_DATABASE_ROLE: names?.lifecycle,
    WEBHOOK_DATABASE_AUTHORITY_GRANTOR_ROLE: names?.grantor,
  });
  const leases = [];
  try {
    const clients = {
      ...(controlPlanePool
        ? { controlPlane: await acquire(controlPlanePool, leases) }
        : {}),
      schema: await acquire(schemaPool, leases),
      runtime: await acquire(runtimePool, leases),
      writer: await acquire(writerPool, leases),
      lifecycle: await acquire(lifecyclePool, leases),
    };
    // These are the first statements on every leased connection. A DSN that
    // authenticates one session and selects another startup role must fail
    // before any transaction-scoped SET LOCAL ROLE can occur.
    const identities = {};
    for (const kind of Object.keys(clients)) {
      identities[kind] = await readAuthenticatedIdentity(
        clients[kind],
        { controlPlane: kind === 'controlPlane' },
      );
    }
    const sessions = Object.fromEntries(
      Object.entries(identities).map(([kind, identity]) => [kind, identity.session_user]),
    );
    if (sessions.schema !== resolved.schema
        || sessions.runtime !== resolved.runtime
        || sessions.writer !== resolved.writer
        || sessions.lifecycle !== resolved.lifecycle
        || Object.values(AUTHORITY_ROLES).includes(sessions.schema)
        || sessions.controlPlane === resolved.grantor
        || new Set(Object.values(sessions)).size !== Object.values(sessions).length) {
      throw configurationError();
    }
    await verifyGraph(
      clients.schema,
      sessions.schema,
      resolved,
      verifyOwnership,
      sessions.controlPlane ?? null,
    );
    return Object.freeze({
      schemaExecutor: sessions.schema,
      runtime: sessions.runtime,
      writer: sessions.writer,
      lifecycle: sessions.lifecycle,
    });
  } catch (caught) {
    if (caught?.code === 'WEBHOOK_DATABASE_PRINCIPALS_INVALID'
        || caught?.code === 'WEBHOOK_POSTGRESQL_16_REQUIRED') {
      throw caught;
    }
    throw configurationError(
      undefined,
      caught?.code ? `catalog_query:${caught.code}` : 'catalog_query',
    );
  } finally {
    await releaseAll(leases);
  }
}

/**
 * Authenticate all four sessions and validate the pre-created global role graph
 * before the bounded schema owner executes any application DDL.
 */
export async function verifyWebhookDatabasePrincipalSessions(options) {
  return verifyAllPrincipalConnections(options, false);
}

/**
 * Repeat the session/graph checks after DDL and additionally prove ownership of
 * every enumerated webhook table and security function before listening.
 */
export async function verifyWebhookDatabasePrincipalConnections(options) {
  return verifyAllPrincipalConnections(options, true);
}

/**
 * Lifecycle-hook equivalent of the startup check. Only the bounded schema and
 * lifecycle DSNs are mounted into this one-shot job, so it authenticates both
 * sessions and verifies the same durable role graph/object ownership. Runtime
 * startup separately authenticates all four DSNs before listening.
 */
async function verifyLifecycleConnections({
  schemaPool,
  lifecyclePool,
  names,
}, verifyOwnership) {
  const resolved = resolveWebhookDatabasePrincipalNames({
    WEBHOOK_SCHEMA_DATABASE_ROLE: names?.schema,
    WEBHOOK_RUNTIME_DATABASE_ROLE: names?.runtime,
    WEBHOOK_KEY_WRITE_DATABASE_ROLE: names?.writer,
    WEBHOOK_KEY_LIFECYCLE_DATABASE_ROLE: names?.lifecycle,
    WEBHOOK_DATABASE_AUTHORITY_GRANTOR_ROLE: names?.grantor,
  });
  const leases = [];
  try {
    const schemaClient = await acquire(schemaPool, leases);
    const lifecycleClient = await acquire(lifecyclePool, leases);
    const schema = await readAuthenticatedIdentity(schemaClient);
    const lifecycle = await readAuthenticatedIdentity(lifecycleClient);
    if (schema.session_user !== resolved.schema
        || schema.session_user === lifecycle.session_user
        || lifecycle.session_user !== resolved.lifecycle
        || Object.values(AUTHORITY_ROLES).includes(schema.session_user)) {
      throw configurationError();
    }
    await verifyGraph(schemaClient, schema.session_user, resolved, verifyOwnership);
    return Object.freeze({
      schemaExecutor: schema.session_user,
      lifecycle: lifecycle.session_user,
    });
  } catch (caught) {
    if (caught?.code === 'WEBHOOK_DATABASE_PRINCIPALS_INVALID'
        || caught?.code === 'WEBHOOK_POSTGRESQL_16_REQUIRED') {
      throw caught;
    }
    throw configurationError(
      undefined,
      caught?.code ? `catalog_query:${caught.code}` : 'catalog_query',
    );
  } finally {
    await releaseAll(leases);
  }
}

export async function verifyWebhookLifecyclePrincipalSessions(options) {
  return verifyLifecycleConnections(options, false);
}

export async function verifyWebhookLifecyclePrincipalConnections(options) {
  return verifyLifecycleConnections(options, true);
}
