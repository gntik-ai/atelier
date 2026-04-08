-- Function audit records baseline migration for US-FN-03-T06
-- Idempotent by design so the existing Helm-side migration workflow can reapply safely.

CREATE TABLE IF NOT EXISTS function_audit_records (
  id uuid PRIMARY KEY,
  action_type varchar(64) NOT NULL,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  function_id uuid,
  actor varchar(256) NOT NULL,
  correlation_id varchar(128),
  initiating_surface varchar(64),
  detail jsonb,
  created_at timestamptz NOT NULL,
  schema_version varchar(16) NOT NULL
);

CREATE INDEX IF NOT EXISTS function_audit_records_scope_action_created_idx
  ON function_audit_records (tenant_id, workspace_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS function_audit_records_tenant_idx
  ON function_audit_records (tenant_id);

CREATE INDEX IF NOT EXISTS function_audit_records_workspace_idx
  ON function_audit_records (workspace_id);

CREATE INDEX IF NOT EXISTS function_audit_records_correlation_idx
  ON function_audit_records (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS function_audit_records_created_at_idx
  ON function_audit_records (created_at DESC);
