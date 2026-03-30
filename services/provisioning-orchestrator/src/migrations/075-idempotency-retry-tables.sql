CREATE TABLE IF NOT EXISTS idempotency_key_records (
  record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_id UUID NOT NULL REFERENCES async_operations(operation_id),
  operation_type TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_idempotency_key_tenant UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ikey_tenant_key
  ON idempotency_key_records (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ikey_expires_at
  ON idempotency_key_records (expires_at);

CREATE TABLE IF NOT EXISTS retry_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES async_operations(operation_id),
  tenant_id TEXT NOT NULL,
  attempt_number INT NOT NULL,
  correlation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB,
  CONSTRAINT uq_retry_attempt_number UNIQUE (operation_id, attempt_number),
  CONSTRAINT retry_attempt_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_retry_attempts_operation
  ON retry_attempts (operation_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_retry_attempts_tenant_status
  ON retry_attempts (tenant_id, status);

ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries INT;

-- Rollback reference:
-- DROP TABLE IF EXISTS retry_attempts;
-- DROP TABLE IF EXISTS idempotency_key_records;
-- ALTER TABLE async_operations DROP COLUMN IF EXISTS attempt_count;
-- ALTER TABLE async_operations DROP COLUMN IF EXISTS max_retries;
