CREATE TABLE IF NOT EXISTS boolean_capability_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key VARCHAR(64) NOT NULL UNIQUE,
  display_label VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  platform_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boolean_capability_catalog_active_sort
  ON boolean_capability_catalog (is_active, sort_order);

DROP TRIGGER IF EXISTS trg_boolean_capability_catalog_updated_at ON boolean_capability_catalog;
CREATE TRIGGER trg_boolean_capability_catalog_updated_at
BEFORE UPDATE ON boolean_capability_catalog
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

INSERT INTO boolean_capability_catalog (capability_key, display_label, description, platform_default, is_active, sort_order)
VALUES
  ('sql_admin_api', 'SQL Admin API', 'Enables direct SQL admin access to the tenant''s PostgreSQL databases', false, true, 10),
  ('passthrough_admin', 'Passthrough Admin Proxy', 'Enables the passthrough admin proxy for direct database management', false, true, 20),
  ('realtime', 'Realtime Subscriptions', 'Enables WebSocket-based realtime subscription channels', false, true, 30),
  ('webhooks', 'Outbound Webhooks', 'Enables outbound webhook delivery for event notifications', false, true, 40),
  ('public_functions', 'Public Serverless Functions', 'Enables public HTTP endpoints for serverless functions', false, true, 50),
  ('custom_domains', 'Custom Domains', 'Enables custom domain configuration for tenant endpoints', false, true, 60),
  ('scheduled_functions', 'Scheduled Functions', 'Enables cron-scheduled execution of serverless functions', false, true, 70)
ON CONFLICT (capability_key) DO NOTHING;
