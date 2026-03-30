-- up
CREATE TABLE IF NOT EXISTS subscription_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID,
  max_subscriptions INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_quotas_tenant ON subscription_quotas (tenant_id);

-- down
DROP TABLE IF EXISTS subscription_quotas;
