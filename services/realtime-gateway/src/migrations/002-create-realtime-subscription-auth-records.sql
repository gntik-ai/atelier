CREATE TABLE IF NOT EXISTS realtime_subscription_auth_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  subscription_id TEXT,
  channel_type TEXT NOT NULL,
  action TEXT NOT NULL,
  denial_reason TEXT,
  scopes_evaluated JSONB NOT NULL,
  filter_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsar_tenant_workspace
  ON realtime_subscription_auth_records (tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_rsar_actor
  ON realtime_subscription_auth_records (actor_identity);

CREATE INDEX IF NOT EXISTS idx_rsar_created_at
  ON realtime_subscription_auth_records (created_at DESC);
