-- Migration: 003_backup_audit_events
-- Feature: US-BKP-01-T03 — Backup audit trail for recovery actions
-- Date: 2026-04-01

CREATE TYPE backup_audit_event_type AS ENUM (
  'backup.requested',
  'backup.started',
  'backup.completed',
  'backup.failed',
  'backup.rejected',
  'restore.requested',
  'restore.started',
  'restore.completed',
  'restore.failed',
  'restore.rejected'
);

CREATE TABLE backup_audit_events (
  id                      UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version          TEXT                      NOT NULL DEFAULT '1',
  event_type              backup_audit_event_type   NOT NULL,
  operation_id            UUID,
  correlation_id          UUID                      NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               TEXT                      NOT NULL,
  component_type          TEXT                      NOT NULL,
  instance_id             TEXT                      NOT NULL,
  snapshot_id             TEXT,
  actor_id                TEXT                      NOT NULL,
  actor_role              TEXT                      NOT NULL,
  session_id              TEXT,
  source_ip               TEXT,
  user_agent              TEXT,
  session_context_status  TEXT                      NOT NULL DEFAULT 'full',
  result                  TEXT,
  rejection_reason        TEXT,
  rejection_reason_public TEXT,
  detail                  TEXT,
  detail_truncated        BOOLEAN                   NOT NULL DEFAULT FALSE,
  destructive             BOOLEAN                   NOT NULL DEFAULT FALSE,
  occurred_at             TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  published_at            TIMESTAMPTZ,
  publish_attempts        INTEGER                   NOT NULL DEFAULT 0,
  publish_last_error      TEXT
);

CREATE INDEX idx_audit_tenant_time
  ON backup_audit_events(tenant_id, occurred_at DESC);

CREATE INDEX idx_audit_operation
  ON backup_audit_events(operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX idx_audit_pending_publish
  ON backup_audit_events(publish_attempts, occurred_at)
  WHERE published_at IS NULL;

CREATE INDEX idx_audit_actor
  ON backup_audit_events(actor_id, occurred_at DESC);

CREATE INDEX idx_audit_event_type
  ON backup_audit_events(event_type, occurred_at DESC);

-- Rollback: DROP TABLE backup_audit_events; DROP TYPE backup_audit_event_type;
