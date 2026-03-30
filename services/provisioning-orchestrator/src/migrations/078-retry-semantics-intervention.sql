ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS failure_category TEXT,
  ADD COLUMN IF NOT EXISTS failure_error_code TEXT,
  ADD COLUMN IF NOT EXISTS failure_description TEXT,
  ADD COLUMN IF NOT EXISTS failure_suggested_actions JSONB,
  ADD COLUMN IF NOT EXISTS manual_intervention_required BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_async_operations_failure_category'
  ) THEN
    ALTER TABLE async_operations
      ADD CONSTRAINT chk_async_operations_failure_category
      CHECK (failure_category IS NULL OR failure_category IN ('transient', 'permanent', 'requires_intervention', 'unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS failure_code_mappings (
  mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_code TEXT NOT NULL,
  operation_type TEXT,
  failure_category TEXT NOT NULL CHECK (failure_category IN ('transient', 'permanent', 'requires_intervention', 'unknown')),
  description TEXT NOT NULL,
  suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_failure_code_operation UNIQUE (error_code, operation_type)
);

CREATE TABLE IF NOT EXISTS retry_semantics_profiles (
  profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL UNIQUE,
  max_retries INT NOT NULL DEFAULT 5,
  backoff_strategy TEXT NOT NULL DEFAULT 'exponential' CHECK (backoff_strategy IN ('fixed', 'linear', 'exponential')),
  backoff_base_seconds INT NOT NULL DEFAULT 30,
  intervention_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_categories JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manual_intervention_flags (
  flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES async_operations(operation_id),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  attempt_count_at_flag INT NOT NULL,
  last_error_code TEXT,
  last_error_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  last_notification_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_method TEXT,
  CONSTRAINT uq_manual_intervention_operation UNIQUE (operation_id),
  CONSTRAINT chk_manual_intervention_resolution_method CHECK (
    resolution_method IS NULL OR resolution_method IN ('override', 'manual_fix', 'auto')
  )
);

CREATE TABLE IF NOT EXISTS retry_overrides (
  override_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES async_operations(operation_id),
  flag_id UUID NOT NULL REFERENCES manual_intervention_flags(flag_id),
  tenant_id TEXT NOT NULL,
  superadmin_id TEXT NOT NULL,
  justification TEXT NOT NULL,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_async_op_manual_intervention
  ON async_operations (tenant_id)
  WHERE manual_intervention_required = TRUE;

CREATE INDEX IF NOT EXISTS idx_failure_code_mappings_category
  ON failure_code_mappings (failure_category);

CREATE INDEX IF NOT EXISTS idx_manual_int_tenant_status
  ON manual_intervention_flags (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_manual_int_last_notification
  ON manual_intervention_flags (last_notification_at);

CREATE INDEX IF NOT EXISTS idx_retry_override_op_status
  ON retry_overrides (operation_id, status);

CREATE INDEX IF NOT EXISTS idx_retry_override_tenant
  ON retry_overrides (tenant_id);

INSERT INTO retry_semantics_profiles (
  operation_type,
  max_retries,
  backoff_strategy,
  backoff_base_seconds,
  intervention_conditions,
  failure_categories,
  is_default
)
VALUES (
  '__default__',
  5,
  'exponential',
  30,
  '[{"condition":"attempt_count >= max_retries","action":"require_intervention"},{"condition":"failure_category == requires_intervention","action":"require_intervention"}]'::jsonb,
  '{}'::jsonb,
  TRUE
)
ON CONFLICT (operation_type) DO NOTHING;

INSERT INTO failure_code_mappings (error_code, operation_type, failure_category, description, suggested_actions, priority)
VALUES
  ('HTTP_500', NULL, 'transient', 'Downstream service returned a server error.', '["Retry the operation","Check downstream service health"]'::jsonb, 100),
  ('HTTP_503', NULL, 'transient', 'Service temporarily unavailable.', '["Retry the operation","Verify service availability"]'::jsonb, 90),
  ('HTTP_400', NULL, 'permanent', 'Client request is invalid and requires correction.', '["Review request payload","Correct invalid input before retrying"]'::jsonb, 100),
  ('HTTP_404', NULL, 'permanent', 'Requested resource was not found.', '["Verify referenced resources exist","Correct identifiers before retrying"]'::jsonb, 100),
  ('INFRA_FAILURE', NULL, 'requires_intervention', 'Infrastructure failure requires operator attention.', '["Escalate to platform operations","Request supervised retry override if safe"]'::jsonb, 10)
ON CONFLICT (error_code, operation_type) DO NOTHING;

-- Rollback:
-- DROP TABLE IF EXISTS retry_overrides;
-- DROP TABLE IF EXISTS manual_intervention_flags;
-- DROP TABLE IF EXISTS retry_semantics_profiles;
-- DROP TABLE IF EXISTS failure_code_mappings;
-- ALTER TABLE async_operations
--   DROP COLUMN IF EXISTS failure_category,
--   DROP COLUMN IF EXISTS failure_error_code,
--   DROP COLUMN IF EXISTS failure_description,
--   DROP COLUMN IF EXISTS failure_suggested_actions,
--   DROP COLUMN IF EXISTS manual_intervention_required;
