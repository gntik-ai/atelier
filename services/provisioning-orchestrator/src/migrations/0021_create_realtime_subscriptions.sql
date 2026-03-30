-- up
CREATE TABLE IF NOT EXISTS realtime_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  channel_id UUID NOT NULL REFERENCES realtime_channels(id),
  channel_type VARCHAR(64) NOT NULL,
  owner_identity VARCHAR(255) NOT NULL,
  owner_client_id VARCHAR(255),
  event_filter JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_realtime_subs_workspace_status ON realtime_subscriptions (workspace_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_realtime_subs_tenant_status ON realtime_subscriptions (tenant_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_realtime_subs_channel_status ON realtime_subscriptions (channel_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_realtime_subs_owner ON realtime_subscriptions (workspace_id, owner_identity) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_realtime_subs_filter ON realtime_subscriptions USING GIN (event_filter) WHERE status = 'active';

-- down
DROP TABLE IF EXISTS realtime_subscriptions;
