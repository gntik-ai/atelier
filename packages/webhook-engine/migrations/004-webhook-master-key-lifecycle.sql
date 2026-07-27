-- 004-webhook-master-key-lifecycle
--
-- Additive platform lifecycle metadata for the AES-GCM key that wraps each
-- tenant-scoped per-subscription webhook secret. Existing rows deliberately
-- remain unlabeled until an explicit legacy adoption transaction proves that
-- every row decrypts with the operator-supplied historical key.

-- These NOLOGIN group roles are the least-privilege database authorities for
-- lifecycle transforms, ordinary runtime work, and ciphertext writes. A
-- separately authenticated, one-shot installation bootstrap must create and
-- exactly bind them before application schema DDL runs. This migration never
-- creates, alters, grants, revokes, binds, or repairs global PostgreSQL roles:
-- an object owner cannot reliably revoke memberships granted by another
-- grantor, and long-running application credentials must never need CREATEROLE.
DO $$
DECLARE
  schema_name name := nullif(
    current_setting('falcone.webhook_schema_role', true),
    ''
  )::name;
  runtime_name name := nullif(
    current_setting('falcone.webhook_runtime_role', true),
    ''
  )::name;
  writer_name name := nullif(
    current_setting('falcone.webhook_writer_role', true),
    ''
  )::name;
  lifecycle_name name := nullif(
    current_setting('falcone.webhook_lifecycle_role', true),
    ''
  )::name;
  grantor_name name := nullif(
    current_setting('falcone.webhook_authority_grantor_role', true),
    ''
  )::name;
  role_row RECORD;
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_POSTGRESQL_16_REQUIRED';
  END IF;

  IF schema_name IS NULL
     OR runtime_name IS NULL
     OR writer_name IS NULL
     OR lifecycle_name IS NULL
     OR grantor_name IS NULL
     OR current_user <> schema_name
     OR (
       SELECT count(DISTINCT role_name)
         FROM unnest(ARRAY[
           schema_name,
           runtime_name,
           writer_name,
           lifecycle_name,
           grantor_name
         ]) AS roles(role_name)
     ) <> 5
     OR ARRAY[
       schema_name,
       runtime_name,
       writer_name,
       lifecycle_name,
       grantor_name
     ] && ARRAY[
       'falcone_app'::name,
       'falcone_webhook_key_lifecycle'::name,
       'falcone_webhook_key_writer'::name
     ] THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID';
  END IF;

  FOR role_row IN
    SELECT required.role_name,
           required.can_login,
           role.rolcanlogin,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls
      FROM (VALUES
        ('falcone_app'::name, false),
        ('falcone_webhook_key_lifecycle'::name, false),
        ('falcone_webhook_key_writer'::name, false),
        (schema_name, true),
        (runtime_name, true),
        (writer_name, true),
        (lifecycle_name, true)
      ) AS required(role_name, can_login)
      LEFT JOIN pg_roles role ON role.rolname = required.role_name
  LOOP
    IF role_row.rolcanlogin IS NULL
       OR role_row.rolcanlogin IS DISTINCT FROM role_row.can_login
       OR role_row.rolsuper
       OR role_row.rolcreatedb
       OR role_row.rolcreaterole
       OR role_row.rolreplication
       OR role_row.rolbypassrls THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID';
    END IF;
  END LOOP;

  SELECT rolcanlogin, rolsuper
    INTO role_row
    FROM pg_roles
   WHERE rolname = grantor_name;
  IF NOT FOUND OR NOT role_row.rolcanlogin OR NOT role_row.rolsuper THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles grantor ON grantor.oid = membership.grantor
      JOIN (VALUES
        ('falcone_app'::name, runtime_name, false, true, false),
        ('falcone_webhook_key_writer'::name, writer_name, false, false, true),
        ('falcone_webhook_key_lifecycle'::name, lifecycle_name, false, false, true)
      ) AS expected(
        granted_name,
        member_name,
        admin_option,
        inherit_option,
        set_option
      )
        ON expected.granted_name = granted.rolname
       AND expected.member_name = member.rolname
       AND expected.admin_option = membership.admin_option
       AND expected.inherit_option = membership.inherit_option
       AND expected.set_option = membership.set_option
     WHERE grantor.rolname = grantor_name
  ) <> 3
     OR (
       WITH protected_principals AS (
         SELECT oid
           FROM pg_roles
          WHERE rolname = ANY(ARRAY[
            'falcone_app'::name,
            'falcone_webhook_key_writer'::name,
            'falcone_webhook_key_lifecycle'::name,
            schema_name,
            runtime_name,
            writer_name,
            lifecycle_name
          ])
       )
       SELECT count(*)
         FROM pg_auth_members membership
        WHERE membership.roleid IN (SELECT oid FROM protected_principals)
           OR membership.member IN (SELECT oid FROM protected_principals)
     ) <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_DATABASE_ROLE_GRAPH_INVALID';
  END IF;
END;
$$;

ALTER TABLE webhook_signing_secrets
  ADD COLUMN IF NOT EXISTS encryption_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wss_encryption_key_id
  ON webhook_signing_secrets (encryption_key_id);

CREATE TABLE IF NOT EXISTS webhook_master_key_state (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN
    ('serving', 'rotation_in_progress', 'recovery_required')),
  current_key_id TEXT NOT NULL,
  current_mode TEXT NOT NULL CHECK (current_mode IN ('canonical-v1', 'legacy')),
  current_managed BOOLEAN NOT NULL DEFAULT false,
  current_verification_cipher TEXT NOT NULL,
  current_verification_iv TEXT NOT NULL,
  recovery_key_id TEXT,
  recovery_mode TEXT CHECK (recovery_mode IS NULL OR recovery_mode IN ('canonical-v1', 'legacy')),
  recovery_managed BOOLEAN,
  recovery_verification_cipher TEXT,
  recovery_verification_iv TEXT,
  recovery_deadline TIMESTAMPTZ,
  active_request_id TEXT,
  active_rotation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((recovery_key_id IS NULL AND recovery_mode IS NULL
          AND recovery_managed IS NULL AND recovery_verification_cipher IS NULL
          AND recovery_verification_iv IS NULL AND recovery_deadline IS NULL)
      OR (recovery_key_id IS NOT NULL AND recovery_mode IS NOT NULL
          AND recovery_managed IS NOT NULL AND recovery_verification_cipher IS NOT NULL
          AND recovery_verification_iv IS NOT NULL AND recovery_deadline IS NOT NULL))
);

-- The dedicated writer can read the one durable serving identity without
-- receiving SELECT on the platform-global lifecycle table. It deliberately
-- accepts no caller-supplied identity; comparing two caller-controlled values is
-- not authorization or ciphertext provenance.
DROP FUNCTION IF EXISTS falcone_webhook_key_write_is_authorized(TEXT);
CREATE OR REPLACE FUNCTION falcone_webhook_key_write_current_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT current_key_id
    FROM public.webhook_master_key_state
   WHERE singleton_id = 1
     AND lifecycle_state = 'serving';
$$;

REVOKE ALL ON FUNCTION falcone_webhook_key_write_current_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION falcone_webhook_key_write_current_id()
  TO falcone_webhook_key_writer;

-- Database-enforced side of the ordinary-writer/lifecycle fence. Current
-- adapters acquire this shared advisory lock before writing, but the trigger
-- also protects the legacy binary during adoption and any bounded direct writer
-- that does not yet know the application helper. CREATE TRIGGER itself waits for
-- pre-existing row-writing transactions, so migration completion is also a
-- boundary after which every encrypted INSERT/UPDATE participates.
CREATE OR REPLACE FUNCTION falcone_webhook_signing_secret_write_statement_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  -- Take the shared lock before PostgreSQL finds or locks any target rows. A
  -- row-level-only lock can be too late for UPDATE and can invert lock ordering
  -- against a lifecycle transaction that already owns the exclusive fence. An
  -- ordinary role can acquire the same advisory-lock shape, so lock possession
  -- bypasses the shared fence only for an independently privileged effective
  -- role. current_user (rather than session_user) makes SET ROLE fail closed.
  IF NOT (
    EXISTS (
      SELECT 1
        FROM pg_locks
       WHERE locktype = 'advisory'
         AND pid = pg_backend_pid()
         AND classid = 723661
         AND objid = 25
         AND mode = 'ExclusiveLock'
         AND granted
    )
    AND (
      current_user = 'falcone_webhook_key_lifecycle'
      OR EXISTS (
        SELECT 1 FROM pg_roles
         WHERE rolname = current_user AND rolsuper
      )
      OR EXISTS (
        SELECT 1
          FROM pg_class
         WHERE oid = 'public.webhook_signing_secrets'::regclass
           AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      )
    )
  ) THEN
    PERFORM pg_advisory_xact_lock_shared(723661, 25);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION falcone_webhook_signing_secret_write_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  durable_key_id TEXT;
BEGIN
  -- Lifecycle transformations already hold the matching transaction-scoped
  -- exclusive advisory lock. Lock shape alone is not authority: current_user
  -- must also be the dedicated lifecycle role, the effective table owner, or an
  -- effective superuser. In particular, a superuser session that SET ROLEs to
  -- falcone_app is constrained as falcone_app here.
  IF EXISTS (
      SELECT 1
        FROM pg_locks
       WHERE locktype = 'advisory'
         AND pid = pg_backend_pid()
         AND classid = 723661
         AND objid = 25
         AND mode = 'ExclusiveLock'
         AND granted
    )
    AND (
      current_user = 'falcone_webhook_key_lifecycle'
      OR EXISTS (
        SELECT 1 FROM pg_roles
         WHERE rolname = current_user AND rolsuper
      )
      OR EXISTS (
        SELECT 1
          FROM pg_class
         WHERE oid = 'public.webhook_signing_secrets'::regclass
           AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      )
  ) THEN
    RETURN NEW;
  END IF;

  -- The non-forgeable production authorization is the effective database role
  -- selected by the dedicated writer credential. Mere membership is not enough:
  -- this security-invoker trigger observes current_user after SET LOCAL ROLE.
  -- Ordinary runtime/schema logins, caller-controlled GUCs, NEW values, and the
  -- advisory-lock shape cannot impersonate this authority.
  IF current_user <> 'falcone_webhook_key_writer' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_KEY_WRITE_FENCED';
  END IF;

  PERFORM pg_advisory_xact_lock_shared(723661, 25);
  durable_key_id := public.falcone_webhook_key_write_current_id();

  IF durable_key_id IS NULL
     OR NEW.encryption_key_id IS DISTINCT FROM durable_key_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_KEY_WRITE_FENCED';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_webhook_signing_secret_write_statement_fence'
       AND tgrelid = 'webhook_signing_secrets'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_webhook_signing_secret_write_statement_fence
      BEFORE INSERT OR UPDATE OF secret_cipher, secret_iv, encryption_key_id
      ON webhook_signing_secrets
      FOR EACH STATEMENT
      EXECUTE FUNCTION falcone_webhook_signing_secret_write_statement_fence();
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_webhook_signing_secret_write_fence'
       AND tgrelid = 'webhook_signing_secrets'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_webhook_signing_secret_write_fence
      BEFORE INSERT OR UPDATE OF secret_cipher, secret_iv, encryption_key_id
      ON webhook_signing_secrets
      FOR EACH ROW
      EXECUTE FUNCTION falcone_webhook_signing_secret_write_fence();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS webhook_master_key_rotations (
  request_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('adopt', 'rotate', 'recover', 'finalize')),
  rotation_id TEXT,
  source_key_id TEXT,
  target_key_id TEXT,
  source_mode TEXT CHECK (source_mode IS NULL OR source_mode IN ('canonical-v1', 'legacy')),
  target_mode TEXT CHECK (target_mode IS NULL OR target_mode IN ('canonical-v1', 'legacy')),
  source_managed BOOLEAN,
  target_managed BOOLEAN,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN
    ('started', 'completed', 'failed', 'recovery_required')),
  affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  verified_count INTEGER NOT NULL DEFAULT 0 CHECK (verified_count >= 0),
  recovery_window_seconds INTEGER,
  recovery_deadline TIMESTAMPTZ,
  error_code VARCHAR(64),
  error_message VARCHAR(160),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]+$'),
  CHECK (error_message IS NULL OR length(error_message) <= 160)
);

ALTER TABLE webhook_master_key_rotations
  ADD COLUMN IF NOT EXISTS source_managed BOOLEAN,
  ADD COLUMN IF NOT EXISTS target_managed BOOLEAN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_master_key_rotation_id
  ON webhook_master_key_rotations (rotation_id)
  WHERE rotation_id IS NOT NULL;

-- Reconcile every C-25 object to one exact authorization graph. Table-level
-- REVOKE does not remove column grants, so reset both catalogs explicitly.
-- The bounded schema login owns these exact objects and uses CASCADE at each
-- enumerated object/grantee boundary so alternate-grantor dependent ACL chains
-- cannot block replay or survive downstream. CASCADE is deliberately confined
-- to these six relations/columns and three functions; it never changes role
-- memberships or privileges on a non-enumerated object.
DO $$
DECLARE
  acl_entry RECORD;
BEGIN
  FOR acl_entry IN
    SELECT DISTINCT
           namespace.nspname AS schema_name,
           class.relname AS object_name,
           privilege.grantee,
           grantee.rolname AS grantee_name
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(class.relacl, acldefault('r', class.relowner))
      ) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'webhook_subscriptions',
         'webhook_signing_secrets',
         'webhook_deliveries',
         'webhook_delivery_attempts',
         'webhook_master_key_state',
         'webhook_master_key_rotations'
       )
       AND privilege.grantee <> class.relowner
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %s CASCADE',
      acl_entry.schema_name,
      acl_entry.object_name,
      CASE
        WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(acl_entry.grantee_name)
      END
    );
  END LOOP;

  FOR acl_entry IN
    SELECT DISTINCT
           namespace.nspname AS schema_name,
           class.relname AS object_name,
           attribute.attname AS column_name,
           privilege.grantee,
           grantee.rolname AS grantee_name
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      JOIN pg_attribute attribute
        ON attribute.attrelid = class.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      CROSS JOIN LATERAL aclexplode(attribute.attacl) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'webhook_subscriptions',
         'webhook_signing_secrets',
         'webhook_deliveries',
         'webhook_delivery_attempts',
         'webhook_master_key_state',
         'webhook_master_key_rotations'
       )
       AND privilege.grantee <> class.relowner
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %s CASCADE',
      acl_entry.column_name,
      acl_entry.schema_name,
      acl_entry.object_name,
      CASE
        WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(acl_entry.grantee_name)
      END
    );
  END LOOP;

  FOR acl_entry IN
    SELECT DISTINCT
           namespace.nspname AS schema_name,
           procedure.proname AS object_name,
           pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
           privilege.grantee,
           grantee.rolname AS grantee_name
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'falcone_webhook_key_write_current_id',
         'falcone_webhook_signing_secret_write_statement_fence',
         'falcone_webhook_signing_secret_write_fence'
       )
       AND privilege.grantee <> procedure.proowner
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %I.%I(%s) FROM %s CASCADE',
      acl_entry.schema_name,
      acl_entry.object_name,
      acl_entry.identity_arguments,
      CASE
        WHEN acl_entry.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(acl_entry.grantee_name)
      END
    );
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES ON webhook_subscriptions, webhook_signing_secrets,
  webhook_deliveries, webhook_delivery_attempts, webhook_master_key_state,
  webhook_master_key_rotations
  FROM PUBLIC, falcone_app, falcone_webhook_key_writer,
       falcone_webhook_key_lifecycle
  CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION falcone_webhook_key_write_current_id(),
  falcone_webhook_signing_secret_write_statement_fence(),
  falcone_webhook_signing_secret_write_fence()
  FROM PUBLIC, falcone_app, falcone_webhook_key_writer,
       falcone_webhook_key_lifecycle
  CASCADE;

-- Ordinary runtime permissions are exact in both migration-003/FORCE-RLS and
-- RLS-absent paths. Runtime can read signing ciphertext and mutate only
-- non-secret webhook state. It has no lifecycle-table or encrypted-write path.
GRANT USAGE ON SCHEMA public TO falcone_app;
GRANT SELECT, UPDATE, DELETE ON webhook_subscriptions TO falcone_app;
GRANT SELECT ON webhook_signing_secrets TO falcone_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON webhook_deliveries, webhook_delivery_attempts
  TO falcone_app;

GRANT USAGE ON SCHEMA public TO falcone_webhook_key_lifecycle;
GRANT SELECT, UPDATE ON webhook_signing_secrets TO falcone_webhook_key_lifecycle;
GRANT SELECT, INSERT, UPDATE
  ON webhook_master_key_state, webhook_master_key_rotations
  TO falcone_webhook_key_lifecycle;

GRANT USAGE ON SCHEMA public TO falcone_webhook_key_writer;
GRANT INSERT ON webhook_subscriptions TO falcone_webhook_key_writer;
GRANT SELECT, INSERT, UPDATE ON webhook_signing_secrets
  TO falcone_webhook_key_writer;
GRANT EXECUTE ON FUNCTION falcone_webhook_key_write_current_id()
  TO falcone_webhook_key_writer;

-- Migration 003 is an all-or-nothing FORCE-RLS variant. Mixed enable/force
-- state is drift and fails closed. Replay removes every policy on the six C-25
-- relations, then recreates exactly the role-bound allowlist for the RLS
-- variant. The non-RLS variant retains no dormant alternate policy path.
DO $$
DECLARE
  relation_count integer;
  enabled_count integer;
  disabled_count integer;
  policy_entry RECORD;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE class.relrowsecurity AND class.relforcerowsecurity),
         count(*) FILTER (WHERE NOT class.relrowsecurity AND NOT class.relforcerowsecurity)
    INTO relation_count, enabled_count, disabled_count
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN (
       'webhook_subscriptions',
       'webhook_signing_secrets',
       'webhook_deliveries',
       'webhook_delivery_attempts'
     );

  IF relation_count <> 4
     OR (enabled_count <> 4 AND disabled_count <> 4) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_RLS_STATE_INVALID';
  END IF;

  FOR policy_entry IN
    SELECT namespace.nspname AS schema_name,
           class.relname AS object_name,
           policy.polname AS policy_name
      FROM pg_policy policy
      JOIN pg_class class ON class.oid = policy.polrelid
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'webhook_subscriptions',
         'webhook_signing_secrets',
         'webhook_deliveries',
         'webhook_delivery_attempts',
         'webhook_master_key_state',
         'webhook_master_key_rotations'
       )
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_entry.policy_name,
      policy_entry.schema_name,
      policy_entry.object_name
    );
  END LOOP;

  IF enabled_count = 4 THEN
    CREATE POLICY webhook_subscriptions_tenant_isolation
      ON webhook_subscriptions
      TO falcone_app
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      )
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      );
    CREATE POLICY webhook_subscriptions_key_writer
      ON webhook_subscriptions
      TO falcone_webhook_key_writer
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      )
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      );
    CREATE POLICY webhook_signing_secrets_tenant_isolation
      ON webhook_signing_secrets
      TO falcone_app
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      )
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      );
    CREATE POLICY webhook_signing_secrets_key_lifecycle
      ON webhook_signing_secrets
      TO falcone_webhook_key_lifecycle
      USING (true)
      WITH CHECK (true);
    CREATE POLICY webhook_signing_secrets_key_writer
      ON webhook_signing_secrets
      TO falcone_webhook_key_writer
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      )
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      );
    CREATE POLICY webhook_deliveries_tenant_isolation
      ON webhook_deliveries
      TO falcone_app
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      )
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)
        AND workspace_id = current_setting('app.workspace_id', true)
      );
    CREATE POLICY webhook_delivery_attempts_tenant_isolation
      ON webhook_delivery_attempts
      TO falcone_app
      USING (
        EXISTS (
          SELECT 1
            FROM webhook_deliveries d
           WHERE d.id = webhook_delivery_attempts.delivery_id
             AND d.tenant_id = current_setting('app.tenant_id', true)
             AND d.workspace_id = current_setting('app.workspace_id', true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
            FROM webhook_deliveries d
           WHERE d.id = webhook_delivery_attempts.delivery_id
             AND d.tenant_id = current_setting('app.tenant_id', true)
             AND d.workspace_id = current_setting('app.workspace_id', true)
        )
      );
  END IF;
END;
$$;
