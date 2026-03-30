-- up
CREATE TABLE IF NOT EXISTS pg_capture_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  data_source_ref VARCHAR(255) NOT NULL,
  schema_name VARCHAR(128) NOT NULL DEFAULT 'public',
  table_name VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','errored','disabled')),
  activation_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivation_ts TIMESTAMPTZ,
  actor_identity VARCHAR(255) NOT NULL,
  last_error TEXT,
  lsn_start PG_LSN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_pg_capture_workspace ON pg_capture_configs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_capture_tenant ON pg_capture_configs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_capture_datasource ON pg_capture_configs (data_source_ref, status);

CREATE TABLE IF NOT EXISTS pg_capture_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('workspace','tenant')),
  scope_id UUID NOT NULL,
  max_tables INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id)
);

CREATE TABLE IF NOT EXISTS pg_capture_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id UUID REFERENCES pg_capture_configs(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_identity VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_capture_audit_workspace ON pg_capture_audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_capture_audit_tenant ON pg_capture_audit_log (tenant_id, created_at DESC);

-- down
DROP TABLE IF EXISTS pg_capture_audit_log;
DROP TABLE IF EXISTS pg_capture_quotas;
DROP TABLE IF EXISTS pg_capture_configs;
