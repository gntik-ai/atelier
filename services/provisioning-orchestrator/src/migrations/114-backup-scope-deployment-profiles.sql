-- Migration: 114-backup-scope-deployment-profiles
-- US-BKP-01-T06: Backup scope matrix and limits by deployment profile
-- Idempotent: safe to run multiple times

-- Table: deployment_profile_registry
CREATE TABLE IF NOT EXISTS deployment_profile_registry (
  profile_key   TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_deployment_profile_registry_updated_at ON deployment_profile_registry;
CREATE TRIGGER trg_deployment_profile_registry_updated_at
BEFORE UPDATE ON deployment_profile_registry
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Table: backup_scope_entries
CREATE TABLE IF NOT EXISTS backup_scope_entries (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_key                 TEXT NOT NULL,
  profile_key                   TEXT NOT NULL REFERENCES deployment_profile_registry(profile_key),
  coverage_status               TEXT NOT NULL CHECK (coverage_status IN ('platform-managed','operator-managed','not-supported','unknown')),
  backup_granularity            TEXT NOT NULL CHECK (backup_granularity IN ('full','incremental','config-only','none','unknown')),
  rpo_range_minutes             INT4RANGE,
  rto_range_minutes             INT4RANGE,
  max_backup_frequency_minutes  INT,
  max_retention_days            INT,
  max_concurrent_jobs           INT,
  max_backup_size_gb            NUMERIC,
  preconditions                 TEXT[],
  limitations                   TEXT[],
  air_gap_notes                 TEXT,
  plan_capability_key           TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (component_key, profile_key)
);

CREATE INDEX IF NOT EXISTS idx_backup_scope_profile ON backup_scope_entries(profile_key);
CREATE INDEX IF NOT EXISTS idx_backup_scope_component ON backup_scope_entries(component_key);

DROP TRIGGER IF EXISTS trg_backup_scope_entries_updated_at ON backup_scope_entries;
CREATE TRIGGER trg_backup_scope_entries_updated_at
BEFORE UPDATE ON backup_scope_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Seed: deployment profiles
INSERT INTO deployment_profile_registry (profile_key, display_name, description, is_active)
VALUES
  ('all-in-one', 'All-in-One', 'Single-node development and evaluation deployment', false),
  ('standard',   'Standard',   'Multi-node production deployment with standard redundancy', true),
  ('ha',         'HA',         'High-availability production deployment with full redundancy', false),
  ('unknown',    'Unknown',    'Undetected or unconfigured deployment profile', false)
ON CONFLICT (profile_key) DO NOTHING;

-- Seed: backup_scope_entries (7 components × 3 profiles = 21 rows)

-- PostgreSQL
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('postgresql', 'all-in-one', 'platform-managed', 'full', '[1440,1440]', '[120,240]', 1440, 7, 1, NULL, ARRAY['Requires pg_basebackup or compatible tool installed'], ARRAY['Single daily backup window only'], 'Full backup to local volume; no off-site replication in air-gap mode', NULL),
  ('postgresql', 'standard', 'platform-managed', 'incremental', '[60,240]', '[30,120]', 60, 30, 2, NULL, ARRAY['Requires pg_basebackup or compatible tool installed'], ARRAY[]::TEXT[], NULL, NULL),
  ('postgresql', 'ha', 'platform-managed', 'incremental', '[15,60]', '[15,60]', 15, 90, 4, NULL, ARRAY['Requires pg_basebackup or compatible tool installed', 'Streaming replication must be healthy'], ARRAY[]::TEXT[], 'Incremental backup with WAL archiving; air-gap requires local WAL storage', NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- MongoDB
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('mongodb', 'all-in-one', 'platform-managed', 'full', '[1440,1440]', '[120,240]', 1440, 7, 1, NULL, ARRAY['mongodump available in PATH'], ARRAY['Full dump only; no oplog-based incremental'], NULL, NULL),
  ('mongodb', 'standard', 'platform-managed', 'full', '[240,480]', '[60,120]', 240, 30, 2, NULL, ARRAY['mongodump available in PATH'], ARRAY[]::TEXT[], NULL, NULL),
  ('mongodb', 'ha', 'platform-managed', 'incremental', '[60,120]', '[30,60]', 60, 90, 4, NULL, ARRAY['mongodump available in PATH', 'Replica set must be healthy'], ARRAY[]::TEXT[], 'Oplog-based incremental; air-gap requires local oplog storage', NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- Kafka
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('kafka', 'all-in-one', 'not-supported', 'none', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY[]::TEXT[], ARRAY['Kafka is ephemeral in all-in-one profile; topic data not backed up'], 'No backup support in air-gap single-node', NULL),
  ('kafka', 'standard', 'operator-managed', 'none', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['Operator must configure MirrorMaker or equivalent'], ARRAY['Platform does not manage Kafka backup; operator responsibility'], NULL, NULL),
  ('kafka', 'ha', 'operator-managed', 'none', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['Operator must configure MirrorMaker or equivalent'], ARRAY['Platform does not manage Kafka backup; operator responsibility'], 'MirrorMaker replication across air-gapped clusters requires manual tunnel', NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- OpenWhisk
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('openwhisk', 'all-in-one', 'not-supported', 'none', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY[]::TEXT[], ARRAY['Function definitions stored in CouchDB; not backed up in all-in-one'], NULL, NULL),
  ('openwhisk', 'standard', 'operator-managed', 'config-only', NULL, NULL, NULL, 30, NULL, NULL, ARRAY['CouchDB export tool available'], ARRAY['Only action/trigger definitions backed up; activation logs excluded'], NULL, NULL),
  ('openwhisk', 'ha', 'operator-managed', 'config-only', NULL, NULL, NULL, 90, NULL, NULL, ARRAY['CouchDB export tool available', 'CouchDB cluster must be healthy'], ARRAY['Only action/trigger definitions backed up; activation logs excluded'], NULL, NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- S3
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('s3', 'all-in-one', 'platform-managed', 'full', '[1440,2880]', '[240,480]', 1440, 14, 1, 50, ARRAY['S3-compatible storage must be accessible'], ARRAY['Objects > 50 GB require manual export'], 'Local volume copy only in air-gap mode', NULL),
  ('s3', 'standard', 'platform-managed', 'incremental', '[240,480]', '[60,120]', 240, 30, 2, 100, ARRAY['S3-compatible storage must be accessible'], ARRAY[]::TEXT[], NULL, NULL),
  ('s3', 'ha', 'platform-managed', 'incremental', '[60,120]', '[30,60]', 60, 90, 4, NULL, ARRAY['S3-compatible storage must be accessible', 'Cross-region replication recommended'], ARRAY[]::TEXT[], 'Incremental sync to air-gapped S3 endpoint', NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- Keycloak
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('keycloak', 'all-in-one', 'platform-managed', 'config-only', NULL, NULL, NULL, 30, 1, NULL, ARRAY['Keycloak realm export CLI available'], ARRAY['Only realm configuration exported; user sessions not preserved'], NULL, NULL),
  ('keycloak', 'standard', 'platform-managed', 'config-only', NULL, NULL, NULL, 30, 1, NULL, ARRAY['Keycloak realm export CLI available'], ARRAY['Only realm configuration exported; user sessions not preserved'], NULL, NULL),
  ('keycloak', 'ha', 'platform-managed', 'config-only', NULL, NULL, NULL, 90, 2, NULL, ARRAY['Keycloak realm export CLI available', 'Infinispan cache must be stable'], ARRAY['Only realm configuration exported; user sessions not preserved'], 'Realm export to local volume in air-gap mode', NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- APISIX Config
INSERT INTO backup_scope_entries (component_key, profile_key, coverage_status, backup_granularity, rpo_range_minutes, rto_range_minutes, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions, limitations, air_gap_notes, plan_capability_key)
VALUES
  ('apisix_config', 'all-in-one', 'platform-managed', 'config-only', NULL, NULL, NULL, 30, 1, NULL, ARRAY['etcd snapshot tool available'], ARRAY['Only route/plugin configuration; access logs excluded'], NULL, NULL),
  ('apisix_config', 'standard', 'platform-managed', 'config-only', NULL, NULL, NULL, 30, 1, NULL, ARRAY['etcd snapshot tool available'], ARRAY['Only route/plugin configuration; access logs excluded'], NULL, NULL),
  ('apisix_config', 'ha', 'platform-managed', 'config-only', NULL, NULL, NULL, 90, 2, NULL, ARRAY['etcd snapshot tool available', 'etcd cluster must be healthy'], ARRAY['Only route/plugin configuration; access logs excluded'], 'etcd snapshot to local volume in air-gap mode', NULL)
ON CONFLICT (component_key, profile_key) DO NOTHING;

-- Extend boolean_capability_catalog with backup_scope_access
INSERT INTO boolean_capability_catalog (capability_key, display_label, description, platform_default, is_active, sort_order)
VALUES ('backup_scope_access', 'Backup Scope Access', 'Enables visibility into backup scope and limits for the tenant', false, true, 80)
ON CONFLICT (capability_key) DO NOTHING;
