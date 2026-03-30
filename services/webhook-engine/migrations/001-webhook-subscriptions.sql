CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INT NOT NULL DEFAULT 0,
  max_consecutive_failures INT NOT NULL DEFAULT 5,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ws_tenant_workspace ON webhook_subscriptions (tenant_id, workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ws_status ON webhook_subscriptions (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ws_event_types ON webhook_subscriptions USING GIN (event_types) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS webhook_signing_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  secret_cipher TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  grace_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wss_subscription ON webhook_signing_secrets (subscription_id) WHERE status IN ('active', 'grace');

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_ref TEXT,
  payload_size INT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_wd_subscription ON webhook_deliveries (subscription_id);
CREATE INDEX IF NOT EXISTS idx_wd_status_next ON webhook_deliveries (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wd_tenant_workspace ON webhook_deliveries (tenant_id, workspace_id);

CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
  id UUID PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES webhook_deliveries(id),
  attempt_num INT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  http_status INT,
  response_ms INT,
  error_detail TEXT,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wda_delivery ON webhook_delivery_attempts (delivery_id);
