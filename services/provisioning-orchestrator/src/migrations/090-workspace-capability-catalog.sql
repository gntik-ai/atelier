BEGIN;

CREATE TABLE IF NOT EXISTS capability_catalog_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  catalog_version TEXT NOT NULL DEFAULT '1.0.0',
  dependencies JSONB NOT NULL DEFAULT '[]',
  common_operations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO capability_catalog_metadata (
  capability_key,
  display_name,
  category,
  description,
  dependencies
)
VALUES
  ('postgres-database', 'PostgreSQL', 'data', 'Relational database', '[]'),
  ('mongo-collection', 'MongoDB', 'data', 'Document database', '[]'),
  ('kafka-events', 'Event Streaming', 'messaging', 'Kafka-based event bus', '[]'),
  ('realtime-subscription', 'Realtime Subscriptions', 'messaging', 'WebSocket realtime channels', '["kafka-events"]'),
  ('serverless-function', 'Serverless Functions', 'compute', 'OpenWhisk function execution', '[]'),
  ('storage-bucket', 'Object Storage', 'storage', 'S3-compatible object storage', '[]')
ON CONFLICT (capability_key) DO NOTHING;

COMMIT;
