-- up
CREATE TABLE IF NOT EXISTS subscription_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID,
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_identity VARCHAR(255) NOT NULL,
  action VARCHAR(32) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id VARCHAR(128)
);
CREATE INDEX IF NOT EXISTS idx_sub_audit_subscription ON subscription_audit_log (subscription_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_sub_audit_workspace ON subscription_audit_log (workspace_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_sub_audit_tenant ON subscription_audit_log (tenant_id, occurred_at);

-- down
DROP TABLE IF EXISTS subscription_audit_log;
