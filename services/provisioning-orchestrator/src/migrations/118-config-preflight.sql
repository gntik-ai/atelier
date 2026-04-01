-- Migration 118: Pre-flight conflict check audit log
-- Feature: US-BKP-02-T04 — Export conflict prechecks
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS config_preflight_audit_log (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       TEXT        NOT NULL,
  source_tenant_id                TEXT        NOT NULL,
  actor_id                        TEXT        NOT NULL,
  actor_type                      TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  domains_requested               TEXT[]      NOT NULL DEFAULT '{}',
  domains_analyzed                TEXT[]      NOT NULL DEFAULT '{}',
  domains_skipped                 TEXT[]      NOT NULL DEFAULT '{}',
  risk_level                      TEXT        NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  conflict_count_low              INT         NOT NULL DEFAULT 0,
  conflict_count_medium           INT         NOT NULL DEFAULT 0,
  conflict_count_high             INT         NOT NULL DEFAULT 0,
  conflict_count_critical         INT         NOT NULL DEFAULT 0,
  compatible_count                INT         NOT NULL DEFAULT 0,
  compatible_with_redacted_count  INT         NOT NULL DEFAULT 0,
  total_resources_analyzed        INT         NOT NULL DEFAULT 0,
  incomplete_analysis             BOOLEAN     NOT NULL DEFAULT FALSE,
  identifier_map_provided         BOOLEAN     NOT NULL DEFAULT FALSE,
  identifier_map_hash             TEXT,
  artifact_checksum               TEXT,
  format_version                  TEXT        NOT NULL,
  correlation_id                  TEXT        NOT NULL,
  executed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_tenant
  ON config_preflight_audit_log(tenant_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_preflight_audit_source_tenant
  ON config_preflight_audit_log(source_tenant_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_preflight_audit_correlation
  ON config_preflight_audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_preflight_audit_risk
  ON config_preflight_audit_log(risk_level, executed_at DESC);
