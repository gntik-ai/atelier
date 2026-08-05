-- 122-privilege-domain-denial-history.sql
--
-- C-14: dedicated, forward-only bootstrap for the privilege-domain denial HISTORY table only.
--
-- The served read action privilege-domain-audit-query.mjs::main (via
-- privilege-domain-repository.mjs::queryDenials) reads `privilege_domain_denials`. That table is
-- DEFINED inside the broad migration 094-admin-data-privilege-separation.sql, which the governance
-- bootstrap deliberately does NOT run: 094 also creates assignment and assignment-history objects,
-- a structural-admin-count view, alters two other tables, and seeds endpoint classifications, all of
-- which are outside this read-route fix. This migration repeats ONLY the already-defined denial
-- table contract and its three directly associated indexes so the audit GET can boot without
-- pulling in 094's unrelated changes.
--
-- The DDL is idempotent (CREATE TABLE/INDEX IF NOT EXISTS) and data-preserving: it performs no row
-- mutation, no backfill, and no destructive statement, so re-running boot, or booting over a table
-- an operator already provisioned, leaves every existing row untouched. There is no FOREIGN KEY: a
-- historical denial record intentionally does not depend on a live workspace row, which is why an
-- authorized query for an unknown workspace returns an empty 200 rather than a not-found result.
-- Registered in GOVERNANCE_MIGRATIONS after 121 (its gen_random_uuid prerequisite is satisfied by
-- the whole preceding sequence, which already relies on it).

CREATE TABLE IF NOT EXISTS privilege_domain_denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous')),
  credential_domain TEXT CHECK (credential_domain IN ('structural_admin','data_access','none')),
  required_domain TEXT NOT NULL CHECK (required_domain IN ('structural_admin','data_access')),
  http_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  source_ip INET,
  correlation_id TEXT NOT NULL,
  denied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (correlation_id)
);

CREATE INDEX IF NOT EXISTS idx_pdd_tenant_denied_at
  ON privilege_domain_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdd_workspace_denied_at
  ON privilege_domain_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdd_required_domain
  ON privilege_domain_denials (required_domain, denied_at DESC);
