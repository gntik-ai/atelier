-- Migration 074: async_operation_log_entries
-- Adds the log entries table for async operation progress (US-UIB-02-T02).
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Rollback: DROP TABLE IF EXISTS async_operation_log_entries;

CREATE TABLE IF NOT EXISTS async_operation_log_entries (
  log_entry_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id   UUID        NOT NULL REFERENCES async_operations(operation_id) ON DELETE CASCADE,
  tenant_id      TEXT        NOT NULL,
  level          TEXT        NOT NULL DEFAULT 'info',
  message        TEXT        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB,
  CONSTRAINT async_op_log_entries_level_check
    CHECK (level IN ('info', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_async_op_log_entries_operation
  ON async_operation_log_entries(operation_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_async_op_log_entries_tenant
  ON async_operation_log_entries(tenant_id);
