-- Row-Level Security for the webhook-engine tenant-scoped tables.
-- See packages/scheduling-engine/migrations/002-rls-scheduling-tables.sql for the
-- mechanism (session GUCs app.tenant_id/app.workspace_id, fail-closed, FORCE RLS).
--
-- webhook_signing_secrets DOES carry (tenant_id, workspace_id) since
-- 002-signing-secret-tenant-scope.sql, so it gets a direct policy (no join needed).
-- webhook_delivery_attempts has no tenant columns; it is isolated transitively via
-- a policy that joins to its parent webhook_deliveries on delivery_id.

DO $$
DECLARE
  application_role RECORD;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls
    INTO application_role
    FROM pg_roles
   WHERE rolname = 'falcone_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_RUNTIME_ROLE_REQUIRED';
  END IF;
  IF application_role.rolcanlogin
     OR application_role.rolsuper
     OR application_role.rolcreatedb
     OR application_role.rolcreaterole
     OR application_role.rolreplication
     OR application_role.rolbypassrls THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WEBHOOK_RUNTIME_ROLE_INVALID';
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO falcone_app;

-- webhook_subscriptions: tenant + workspace scoped.
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_subscriptions_tenant_isolation ON webhook_subscriptions;
CREATE POLICY webhook_subscriptions_tenant_isolation ON webhook_subscriptions
  TO falcone_app
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, UPDATE, DELETE ON webhook_subscriptions TO falcone_app;

-- webhook_signing_secrets: tenant + workspace scoped (columns added in migration 002).
ALTER TABLE webhook_signing_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_signing_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_signing_secrets_tenant_isolation ON webhook_signing_secrets;
CREATE POLICY webhook_signing_secrets_tenant_isolation ON webhook_signing_secrets
  TO falcone_app
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT ON webhook_signing_secrets TO falcone_app;

-- webhook_deliveries: tenant + workspace scoped.
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_deliveries_tenant_isolation ON webhook_deliveries;
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  TO falcone_app
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO falcone_app;

-- webhook_delivery_attempts: no tenant columns -> isolate via parent delivery.
-- A row is visible only when its delivery is visible under the parent policy
-- (which itself is tenant+workspace scoped). EXISTS short-circuits per row.
ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_delivery_attempts_tenant_isolation ON webhook_delivery_attempts;
CREATE POLICY webhook_delivery_attempts_tenant_isolation ON webhook_delivery_attempts
  TO falcone_app
  USING (EXISTS (
           SELECT 1 FROM webhook_deliveries d
            WHERE d.id = webhook_delivery_attempts.delivery_id
              AND d.tenant_id = current_setting('app.tenant_id', true)
              AND d.workspace_id = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (
           SELECT 1 FROM webhook_deliveries d
            WHERE d.id = webhook_delivery_attempts.delivery_id
              AND d.tenant_id = current_setting('app.tenant_id', true)
              AND d.workspace_id = current_setting('app.workspace_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_delivery_attempts TO falcone_app;
