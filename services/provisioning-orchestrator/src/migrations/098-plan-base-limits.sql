CREATE TABLE IF NOT EXISTS quota_dimension_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension_key VARCHAR(64) NOT NULL UNIQUE,
  display_label VARCHAR(255) NOT NULL,
  unit VARCHAR(20) NOT NULL CHECK (unit IN ('count', 'bytes')),
  default_value BIGINT NOT NULL CHECK (default_value >= -1),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255) NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_quota_dimension_catalog_key
  ON quota_dimension_catalog (dimension_key);

DROP TRIGGER IF EXISTS trg_quota_dimension_catalog_updated_at ON quota_dimension_catalog;
CREATE TRIGGER trg_quota_dimension_catalog_updated_at
BEFORE UPDATE ON quota_dimension_catalog
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

INSERT INTO quota_dimension_catalog (dimension_key, display_label, unit, default_value, description)
VALUES
  ('max_workspaces', 'Maximum Workspaces', 'count', 3, 'Maximum number of workspaces per tenant'),
  ('max_pg_databases', 'Maximum PostgreSQL Databases', 'count', 5, 'Maximum number of PostgreSQL databases per tenant'),
  ('max_mongo_databases', 'Maximum MongoDB Databases', 'count', 2, 'Maximum number of MongoDB databases per tenant'),
  ('max_kafka_topics', 'Maximum Kafka Topics', 'count', 10, 'Maximum number of Kafka topics per tenant'),
  ('max_functions', 'Maximum Functions', 'count', 50, 'Maximum number of serverless functions per tenant'),
  ('max_storage_bytes', 'Maximum Storage', 'bytes', 5368709120, 'Maximum object storage capacity per tenant in bytes (default 5 GiB)'),
  ('max_api_keys', 'Maximum API Keys', 'count', 20, 'Maximum number of API keys per tenant'),
  ('max_workspace_members', 'Maximum Workspace Members', 'count', 10, 'Maximum number of members per workspace')
ON CONFLICT (dimension_key) DO NOTHING;
