ALTER TABLE async_operations
  DROP CONSTRAINT IF EXISTS async_operations_status_check;

ALTER TABLE async_operations
  ADD CONSTRAINT async_operations_status_check
    CHECK (status IN (
      'pending', 'running', 'completed', 'failed',
      'timed_out', 'cancelling', 'cancelled'
    ));

ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS timeout_policy_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS policy_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_async_ops_status_updated
  ON async_operations (status, updated_at)
  WHERE status IN ('running', 'pending', 'cancelling');

CREATE TABLE IF NOT EXISTS operation_policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL UNIQUE,
  timeout_minutes INT NOT NULL,
  orphan_threshold_minutes INT NOT NULL,
  cancelling_timeout_minutes INT NOT NULL DEFAULT 5,
  recovery_action TEXT NOT NULL DEFAULT 'fail',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO operation_policies (
  operation_type,
  timeout_minutes,
  orphan_threshold_minutes,
  cancelling_timeout_minutes
) VALUES ('*', 60, 30, 5)
ON CONFLICT (operation_type) DO NOTHING;

-- Rollback
-- ALTER TABLE async_operations
--   DROP COLUMN IF EXISTS cancelled_by,
--   DROP COLUMN IF EXISTS cancellation_reason,
--   DROP COLUMN IF EXISTS timeout_policy_snapshot,
--   DROP COLUMN IF EXISTS policy_applied_at;
-- DROP TABLE IF EXISTS operation_policies;
-- DROP INDEX IF EXISTS idx_async_ops_status_updated;
-- ALTER TABLE async_operations DROP CONSTRAINT IF EXISTS async_operations_status_check;
-- ALTER TABLE async_operations
--   ADD CONSTRAINT async_operations_status_check
--     CHECK (status IN ('pending', 'running', 'completed', 'failed'));
