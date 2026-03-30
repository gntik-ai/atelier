CREATE TABLE IF NOT EXISTS realtime_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  token_jti TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rs_token_jti
  ON realtime_sessions (token_jti);

CREATE INDEX IF NOT EXISTS idx_rs_status
  ON realtime_sessions (status, last_validated_at);
