-- Migration: 002_backup_operations
-- Feature: US-BKP-01-T02 — Backup admin endpoints for triggering backups and restores
-- Date: 2026-04-01

CREATE TYPE backup_operation_type AS ENUM ('backup', 'restore');
CREATE TYPE backup_operation_status AS ENUM (
  'accepted',
  'in_progress',
  'completed',
  'failed',
  'rejected'
);

CREATE TABLE backup_operations (
  id                    UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  backup_operation_type   NOT NULL,
  tenant_id             TEXT                    NOT NULL,
  component_type        TEXT                    NOT NULL,
  instance_id           TEXT                    NOT NULL,
  status                backup_operation_status NOT NULL DEFAULT 'accepted',
  requester_id          TEXT                    NOT NULL,
  requester_role        TEXT                    NOT NULL,
  snapshot_id           TEXT,
  failure_reason        TEXT,
  failure_reason_public TEXT,
  adapter_operation_id  TEXT,
  accepted_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  in_progress_at        TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  metadata              JSONB
);

CREATE INDEX idx_backup_ops_tenant
  ON backup_operations(tenant_id, accepted_at DESC);

CREATE INDEX idx_backup_ops_active
  ON backup_operations(tenant_id, component_type, instance_id, type, status)
  WHERE status IN ('accepted', 'in_progress');

CREATE INDEX idx_backup_ops_requester
  ON backup_operations(requester_id, accepted_at DESC);

-- ROLLBACK:
-- DROP TABLE backup_operations;
-- DROP TYPE backup_operation_status;
-- DROP TYPE backup_operation_type;
