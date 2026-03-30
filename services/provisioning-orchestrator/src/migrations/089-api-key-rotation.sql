CREATE TABLE IF NOT EXISTS service_account_rotation_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  service_account_id TEXT NOT NULL,
  new_credential_id TEXT NOT NULL,
  old_credential_id TEXT NOT NULL,
  rotation_type TEXT NOT NULL CHECK (rotation_type IN ('grace_period', 'immediate')),
  grace_period_seconds INTEGER NOT NULL DEFAULT 0,
  deprecated_expires_at TIMESTAMPTZ,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initiated_by TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'completed', 'force_completed', 'expired')),
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  rotation_lock_version INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rotation_in_progress
  ON service_account_rotation_states (service_account_id)
  WHERE state = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_rotation_expiry
  ON service_account_rotation_states (deprecated_expires_at)
  WHERE state = 'in_progress' AND deprecated_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_account_rotation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  service_account_id TEXT NOT NULL,
  rotation_state_id UUID REFERENCES service_account_rotation_states(id),
  rotation_type TEXT NOT NULL,
  grace_period_seconds INTEGER NOT NULL DEFAULT 0,
  old_credential_id TEXT,
  new_credential_id TEXT,
  initiated_by TEXT NOT NULL,
  initiated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  completion_reason TEXT CHECK (completion_reason IN ('expired', 'force_completed', 'immediate'))
);

CREATE INDEX IF NOT EXISTS idx_rotation_history_sa
  ON service_account_rotation_history (service_account_id, initiated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_rotation_policies (
  tenant_id TEXT PRIMARY KEY,
  max_credential_age_days INTEGER,
  max_grace_period_seconds INTEGER,
  warn_before_expiry_days INTEGER DEFAULT 14,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL
);
