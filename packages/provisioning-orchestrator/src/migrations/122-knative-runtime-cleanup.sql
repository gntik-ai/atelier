-- Durable, tenant-scoped cleanup obligations for Knative-dependent resources.
-- Function outage deletion uses this table first; hosted MCP may use resource_type='mcp' through
-- the same idempotent contract. No source, credentials, endpoints, logs, or tenant-controlled labels
-- are stored here.

ALTER TABLE IF EXISTS fn_actions
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE IF EXISTS fn_actions
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS runtime_cleanup_obligations (
  obligation_id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('function', 'mcp')),
  operation TEXT NOT NULL CHECK (operation = 'delete'),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT,
  resource_id TEXT NOT NULL,
  runtime_resource_name TEXT,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (resource_type, tenant_id, resource_id, operation)
);

CREATE INDEX IF NOT EXISTS runtime_cleanup_pending_idx
  ON runtime_cleanup_obligations (resource_type, status, created_at, obligation_id);
