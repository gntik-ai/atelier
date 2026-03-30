CREATE TABLE IF NOT EXISTS async_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  workspace_id TEXT,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_summary JSONB,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  saga_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT async_operations_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_async_ops_tenant_status
  ON async_operations (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_async_ops_correlation
  ON async_operations (correlation_id);

CREATE INDEX IF NOT EXISTS idx_async_ops_idempotency
  ON async_operations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_async_ops_saga
  ON async_operations (saga_id)
  WHERE saga_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS async_operation_transitions (
  transition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES async_operations(operation_id),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_async_op_transitions_operation
  ON async_operation_transitions (operation_id, transitioned_at);
