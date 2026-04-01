-- Migration: 001_backup_status_snapshots
-- Feature: US-BKP-01-T01 — Backup status visibility for managed components
-- Date: 2026-03-31

CREATE TABLE IF NOT EXISTS backup_status_snapshots (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 TEXT          NOT NULL,
  component_type            TEXT          NOT NULL,
  instance_id               TEXT          NOT NULL,
  instance_label            TEXT,
  deployment_profile        TEXT,
  is_shared_instance        BOOLEAN       NOT NULL DEFAULT FALSE,
  status                    TEXT          NOT NULL
    CHECK (status IN (
      'success', 'failure', 'partial', 'in_progress',
      'not_configured', 'not_available', 'pending'
    )),
  last_successful_backup_at TIMESTAMPTZ,
  last_checked_at           TIMESTAMPTZ   NOT NULL,
  detail                    TEXT,
  adapter_metadata          JSONB,
  collected_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_backup_snapshot UNIQUE (tenant_id, component_type, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_tenant
  ON backup_status_snapshots(tenant_id, last_checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_status
  ON backup_status_snapshots(status, last_checked_at DESC);

-- ROLLBACK: DROP TABLE IF EXISTS backup_status_snapshots;
