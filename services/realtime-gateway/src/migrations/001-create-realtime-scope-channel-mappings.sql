CREATE TABLE IF NOT EXISTS realtime_scope_channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scope_name TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_id, scope_name, channel_type)
);

CREATE INDEX IF NOT EXISTS idx_rscm_tenant_workspace
  ON realtime_scope_channel_mappings (tenant_id, workspace_id);
