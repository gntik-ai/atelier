CREATE TABLE IF NOT EXISTS scope_enforcement_denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous')),
  denial_type TEXT NOT NULL CHECK (denial_type IN ('SCOPE_INSUFFICIENT','PLAN_ENTITLEMENT_DENIED','WORKSPACE_SCOPE_MISMATCH','CONFIG_ERROR')),
  http_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  required_scopes TEXT[],
  presented_scopes TEXT[],
  missing_scopes TEXT[],
  required_entitlement TEXT,
  current_plan_id TEXT,
  source_ip INET,
  correlation_id TEXT NOT NULL,
  denied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sed_correlation_denied_at
  ON scope_enforcement_denials (correlation_id, denied_at);

CREATE INDEX IF NOT EXISTS idx_sed_tenant_denied_at
  ON scope_enforcement_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_sed_workspace_denied_at
  ON scope_enforcement_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sed_denial_type
  ON scope_enforcement_denials (denial_type, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_sed_actor
  ON scope_enforcement_denials (actor_id, tenant_id, denied_at DESC);

CREATE TABLE IF NOT EXISTS endpoint_scope_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  http_method TEXT NOT NULL,
  path_pattern TEXT NOT NULL,
  required_scopes TEXT[] NOT NULL,
  required_entitlements TEXT[],
  workspace_scoped BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  declared_by TEXT NOT NULL CHECK (declared_by IN ('config','migration','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (http_method, path_pattern)
);

CREATE INDEX IF NOT EXISTS idx_esr_method_path
  ON endpoint_scope_requirements (http_method, path_pattern);

INSERT INTO endpoint_scope_requirements (
  http_method, path_pattern, required_scopes, required_entitlements, workspace_scoped, description, declared_by
) VALUES
  ('POST', '/v1/functions/:id/deploy', ARRAY['functions:deploy'], ARRAY[]::TEXT[], true, 'Deploy functions requires deploy scope', 'migration'),
  ('GET', '/v1/db/collections', ARRAY['db:read'], ARRAY[]::TEXT[], true, 'Read collections requires db:read', 'migration'),
  ('POST', '/v1/realtime/subscriptions', ARRAY['realtime:subscribe'], ARRAY['realtime:subscribe'], true, 'Realtime subscriptions require scope and plan entitlement', 'migration')
ON CONFLICT (http_method, path_pattern) DO UPDATE SET
  required_scopes = EXCLUDED.required_scopes,
  required_entitlements = EXCLUDED.required_entitlements,
  workspace_scoped = EXCLUDED.workspace_scoped,
  description = EXCLUDED.description,
  declared_by = EXCLUDED.declared_by;
