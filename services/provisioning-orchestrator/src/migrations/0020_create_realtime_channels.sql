-- up
CREATE TABLE IF NOT EXISTS realtime_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  channel_type VARCHAR(64) NOT NULL,
  data_source_kind VARCHAR(32) NOT NULL,
  data_source_ref VARCHAR(255) NOT NULL,
  display_name VARCHAR(128),
  description TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  kafka_topic_pattern VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel_type, data_source_ref)
);
CREATE INDEX IF NOT EXISTS idx_realtime_channels_workspace ON realtime_channels (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_realtime_channels_tenant ON realtime_channels (tenant_id, status);

-- down
DROP TABLE IF EXISTS realtime_channels;
