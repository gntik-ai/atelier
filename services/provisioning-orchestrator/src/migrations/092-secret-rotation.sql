CREATE TABLE IF NOT EXISTS secret_version_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  domain TEXT NOT NULL,
  tenant_id UUID,
  secret_name TEXT NOT NULL,
  vault_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','grace','expired','revoked')),
  grace_period_seconds INTEGER NOT NULL DEFAULT 0,
  grace_expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ,
  initiated_by TEXT NOT NULL,
  revocation_justification TEXT,
  rotation_lock_version INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_secret_active_version
  ON secret_version_states (secret_path)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_svs_grace_expiry
  ON secret_version_states (grace_expires_at)
  WHERE state = 'grace' AND grace_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_svs_domain_tenant
  ON secret_version_states (domain, tenant_id);

CREATE TABLE IF NOT EXISTS secret_consumer_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  consumer_id TEXT NOT NULL,
  consumer_namespace TEXT NOT NULL,
  eso_external_secret_name TEXT,
  reload_mechanism TEXT NOT NULL CHECK (reload_mechanism IN ('eso_annotation','sighup','api_reload','pool_refresh')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_by TEXT NOT NULL,
  UNIQUE (secret_path, consumer_id)
);

CREATE TABLE IF NOT EXISTS secret_propagation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  vault_version INTEGER NOT NULL,
  consumer_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','confirmed','timeout','failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_spe_pending
  ON secret_propagation_events (secret_path, vault_version)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS secret_rotation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  domain TEXT NOT NULL,
  tenant_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'initiated','grace_started','consumer_reload_requested','consumer_reload_confirmed','consumer_reload_timeout','grace_expired','revoked','revoke_confirmed','rotation_failed'
  )),
  vault_version_new INTEGER,
  vault_version_old INTEGER,
  grace_period_seconds INTEGER,
  actor_id TEXT NOT NULL,
  actor_roles TEXT[],
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sre_path_time
  ON secret_rotation_events (secret_path, occurred_at DESC);
