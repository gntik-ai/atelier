import { createHash, randomUUID } from 'node:crypto';

// Tenant registry (domain B) — pg-backed CRUD over the `tenants` table.
//
// No in-repo migration creates `tenants` (it is deployment-owned), yet the real
// plan/quota actions key on it (e.g. plan-assign.mjs::ensureTenantExists does
// `SELECT 1 FROM tenants WHERE id=$1 OR tenant_id=$1`). ensureSchema() creates a
// minimal table compatible with that check; `tenant_id` mirrors `id` so a caller
// passing the tenant uuid as tenantId matches.
export async function ensureSchema(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  // id is TEXT (not uuid): the product actions compare `id = $1` with a text
  // param (e.g. plan-assign.ensureTenantExists `WHERE id=$1 OR tenant_id=$1`),
  // and the whole plan/quota schema keys the tenant as VARCHAR text. A uuid id
  // column breaks those with "operator does not exist: text = uuid".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      slug TEXT UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      iam_realm TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  await pool.query(`UPDATE tenants SET tenant_id = id WHERE tenant_id IS NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      slug TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      environment TEXT NOT NULL DEFAULT 'dev',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (tenant_id, slug)
    )`);
  // First-class environment (add-environment-first-class-isolation, #503): a workspace is the
  // delivery boundary for ONE runtime environment (prod/staging/dev/...). Backfill the column on
  // pre-existing tables; carry it on the workspace_databases registry so the per-workspace
  // database (D2) is attributable to its environment.
  await pool.query("ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'dev'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_accounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      iam_realm TEXT NOT NULL,
      kc_client_id TEXT NOT NULL,
      kc_client_uuid TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  // Revocation propagation cutoff (fix-sa-credential-revocation-invalidate-tokens, #684):
  // a "not-before" watermark for the SA's already-issued access tokens. Set to NOW() when the
  // credential is revoked OR its secret is rotated; the auth path then rejects any presented SA
  // token whose `iat` predates this watermark (bounded by a short cache TTL). Additive backfill
  // on pre-existing tables (mirrors the `environment` column precedent above).
  await pool.query('ALTER TABLE service_accounts ADD COLUMN IF NOT EXISTS credentials_invalidated_at TIMESTAMPTZ');
  // The auth-path revocation check resolves the SA by (iam_realm, kc_client_id) — the client id alone
  // is NOT globally unique (`sa-<ws-slug>-<name>` collides across tenants since the workspace slug is
  // only UNIQUE per tenant), so it must be scoped by the realm to avoid resolving another tenant's row
  // (a cross-tenant breach). Index that composite pair so the per-request check is a single-row index
  // probe, not a sequential scan. Defense-in-depth: make it UNIQUE — within a realm the client id is
  // already unique (createServiceAccount 409s on a per-realm findClient), so this codifies the
  // invariant. On a pre-existing table that somehow holds a legacy duplicate, a UNIQUE index would
  // throw at boot and crash the control-plane, so we fall back to a NON-unique composite index there
  // (the auth read's ORDER BY created_at DESC LIMIT 1 stays a safe backstop either way).
  try {
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS service_accounts_realm_client_id_uidx ON service_accounts (iam_realm, kc_client_id)');
  } catch (e) {
    if (e?.code === '23505') {
      await pool.query(
        'CREATE INDEX IF NOT EXISTS service_accounts_realm_client_id_idx ON service_accounts (iam_realm, kc_client_id)');
    } else {
      throw e;
    }
  }
  // ---- identity: external applications + federated providers ---------------
  // The public route catalog and web console both expose workspace-scoped
  // external application management. In kind, keep the canonical application
  // document in JSONB while indexing the routing/authorization fields here.
  // Federated providers are stored inside app_json.federatedProviders so this
  // shim stays minimal and durable without introducing a second table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_applications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      protocol TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      app_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      updated_by TEXT,
      UNIQUE (workspace_id, slug)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS external_applications_scope_idx ON external_applications (tenant_id, workspace_id, state)');
  // ---- identity: tenant/workspace invitations ------------------------------
  // POST /v1/tenants/{tenantId}/invitations is public-contract surface used by
  // the web console. Persist masked email + hash only; never store the raw
  // invitee address in the control-plane registry.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_invitations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT,
      email_hash TEXT NOT NULL,
      masked_email TEXT,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      target_bindings JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS tenant_invitations_scope_idx ON tenant_invitations (tenant_id, workspace_id, status, created_at DESC)');
  // ---- data plane: one provisioned database per workspace ------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_databases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT 'postgresql',
      database_name TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      username TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  await pool.query("ALTER TABLE workspace_databases ADD COLUMN IF NOT EXISTS environment TEXT");
  // ---- data plane: FerretDB (mongo) databases provisioned for a workspace ---
  // The document store is ONE shared FerretDB cluster keyed only by a `tenantId`
  // document field — its db/collection NAMES are caller-supplied and SHARED across
  // tenants (fix-tenant-purge-ferretdb-cascade, #682). This registry exists ONLY so
  // tenant-purge / workspace-delete can DISCOVER a tenant's provisioned mongo
  // databases for an isolation-safe teardown (delete this tenant's documents by
  // tenantId, drop the db only when empty across ALL tenants). It MUST be its OWN
  // table — NOT workspace_databases, whose `database_name` is globally UNIQUE and
  // feeds the Postgres dropWorkspaceDatabase/getWorkspaceDatabase/databaseWorkspaceMap
  // consumers; mongo db names are shared across tenants and would collide there +
  // corrupt those Postgres consumers. The key is per-workspace, NOT global
  // (UNIQUE (workspace_id, database_name)), so the SAME db name provisioned by two
  // tenants/workspaces records two distinct rows (idempotent re-provision in one
  // workspace is a no-op via ON CONFLICT DO NOTHING).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_mongo_databases (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      database_name TEXT NOT NULL,
      collections JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (workspace_id, database_name)
    )`);
  // ---- data plane: object-store buckets mapped to a workspace -------------
  // CANONICAL tenant-to-bucket mapping (bucket-per-workspace). This table is the
  // single source of truth for storage reconciliation (add-seaweedfs-bucket-
  // lifecycle-migration). Coverage note: `bucket_name` is globally UNIQUE but
  // `workspace_id` is NOT unique here, so a workspace may map to 0..N buckets and a
  // bucket created out-of-band on the backend may have no row — the migration
  // reconciler's discover-and-merge step backfills those missing rows.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_buckets (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      bucket_name TEXT NOT NULL UNIQUE,
      region TEXT NOT NULL DEFAULT 'us-east-1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // ---- data plane: event topics mapped to a workspace (resourceId <-> kafka) -
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_topics (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      topic_name TEXT NOT NULL,
      physical_topic_name TEXT NOT NULL UNIQUE,
      partitions INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, topic_name)
    )`);
  // ---- data plane: function registry (execution pends executor/Knative) ----
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_functions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'nodejs:20',
      handler TEXT,
      source_ref TEXT,
      runtime_status TEXT NOT NULL DEFAULT 'pending_data_plane',
      status TEXT NOT NULL DEFAULT 'registered',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (workspace_id, name)
    )`);
  // ---- data plane: deployed function actions + activations (real executor) --
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fn_actions (
      resource_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'nodejs:22',
      entrypoint TEXT NOT NULL DEFAULT 'main',
      source_code TEXT NOT NULL,
      parameters JSONB,
      memory_mb INTEGER NOT NULL DEFAULT 256,
      timeout_ms INTEGER NOT NULL DEFAULT 60000,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (workspace_id, action_name)
    )`);
  // Knative-backed functions: the ksvc name (added after the Job-era table).
  await pool.query('ALTER TABLE fn_actions ADD COLUMN IF NOT EXISTS ksvc_name TEXT');
  await pool.query("ALTER TABLE fn_actions ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'");
  await pool.query('ALTER TABLE fn_actions ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fn_action_versions (
      version_id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'historical',
      origin_type TEXT NOT NULL DEFAULT 'publish',
      origin_version_id TEXT,
      runtime TEXT NOT NULL DEFAULT 'nodejs:22',
      entrypoint TEXT NOT NULL DEFAULT 'main',
      source_code TEXT NOT NULL,
      parameters JSONB,
      memory_mb INTEGER NOT NULL DEFAULT 256,
      timeout_ms INTEGER NOT NULL DEFAULT 60000,
      ksvc_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMPTZ,
      created_by TEXT,
      UNIQUE (resource_id, version_number)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS fn_action_versions_resource_idx ON fn_action_versions (resource_id, version_number DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS fn_action_versions_scope_idx ON fn_action_versions (tenant_id, workspace_id, resource_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fn_activations (
      activation_id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      result JSONB,
      logs JSONB,
      duration_ms INTEGER,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )`);
  // Durable runtime cleanup obligations are shared by Knative-backed capabilities. Function
  // outage deletion uses them now; hosted MCP can use the same tenant-scoped/idempotent repository
  // without inventing a second lifecycle queue.
  await pool.query(`
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
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS runtime_cleanup_pending_idx
    ON runtime_cleanup_obligations (resource_type, status, created_at, obligation_id)`);

  // ---- product schema: plan catalog (finding F3) ---------------------------
  // The plan/quota actions are the REAL provisioning-orchestrator modules (wired in routes.mjs),
  // but no in-repo migration runs in this hand-built runtime, so `plans` never existed and
  // GET /v1/plans (plan-list) 500'd with relation "plans" does not exist (42P01). Mirror the
  // canonical migration 097 (plan-entity-tenant-assignment) so the whole /v1/plans family
  // (list/create/change-history) resolves against a real schema. Idempotent (IF NOT EXISTS / OR
  // REPLACE / DROP TRIGGER IF EXISTS), so re-running on an existing deployment is a no-op.
  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION enforce_plan_status_forward_transition()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP <> 'UPDATE' OR NEW.status = OLD.status THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'draft' AND NEW.status = 'active' THEN
        RETURN NEW;
      ELSIF OLD.status = 'active' AND NEW.status = 'deprecated' THEN
        RETURN NEW;
      ELSIF OLD.status = 'deprecated' AND NEW.status = 'archived' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Invalid plan status transition from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END;
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR(64) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
      capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
      quota_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by VARCHAR(255) NOT NULL,
      updated_by VARCHAR(255) NOT NULL
    )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_slug_lower ON plans (LOWER(slug))');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_plans_status ON plans (status)');
  await pool.query('DROP TRIGGER IF EXISTS trg_plans_set_updated_at ON plans');
  await pool.query(`
    CREATE TRIGGER trg_plans_set_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp()`);
  await pool.query('DROP TRIGGER IF EXISTS trg_plans_enforce_status_forward_only ON plans');
  await pool.query(`
    CREATE TRIGGER trg_plans_enforce_status_forward_only
    BEFORE UPDATE OF status ON plans
    FOR EACH ROW EXECUTE FUNCTION enforce_plan_status_forward_transition()`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_plan_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(255) NOT NULL,
      plan_id UUID NOT NULL REFERENCES plans(id),
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      superseded_at TIMESTAMPTZ,
      assigned_by VARCHAR(255) NOT NULL,
      assignment_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_plan_assignments_current
    ON tenant_plan_assignments (tenant_id) WHERE superseded_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tenant_plan_assignments_tenant_history
    ON tenant_plan_assignments (tenant_id, effective_from DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tenant_plan_assignments_plan_id
    ON tenant_plan_assignments (plan_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plan_audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_type VARCHAR(64) NOT NULL,
      actor_id VARCHAR(255) NOT NULL,
      tenant_id VARCHAR(255),
      plan_id UUID REFERENCES plans(id),
      previous_state JSONB,
      new_state JSONB NOT NULL,
      correlation_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // Audit integrity (#644): the TRUE outcome + the per-tenant append-only hash chain
  // (prev_hash/row_hash). Added idempotently so an existing install gains them on the
  // next boot; legacy rows keep NULL (read as 'unknown'; the chain verifies from the
  // first hashed row).
  await pool.query("ALTER TABLE plan_audit_events ADD COLUMN IF NOT EXISTS outcome VARCHAR(32)");
  await pool.query("ALTER TABLE plan_audit_events ADD COLUMN IF NOT EXISTS prev_hash TEXT");
  await pool.query("ALTER TABLE plan_audit_events ADD COLUMN IF NOT EXISTS row_hash TEXT");
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plan_audit_events_actor_created
    ON plan_audit_events (actor_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plan_audit_events_tenant_created
    ON plan_audit_events (tenant_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plan_audit_events_action_created
    ON plan_audit_events (action_type, created_at DESC)`);

  // ---- product schema: quota dimension catalog + overrides (finding F4) -----
  // The console Quotas page (/v1/metrics/tenants/{id}/quotas) resolves real limits via the
  // tenant-effective-entitlements action, whose quantitative query reads quota_dimension_catalog,
  // quota_overrides and plans.quota_type_config. None existed in this runtime, so an authorized
  // tenant's own quota view 500'd with 42P01. Mirror migrations 098 (base limits) + 103 (hard/soft
  // overrides) for exactly those relations so the entitlements query resolves (empty catalog ->
  // empty limits on a fresh platform, which is correct). Idempotent.
  await pool.query("ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_type_config JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quota_dimension_catalog (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dimension_key VARCHAR(64) NOT NULL UNIQUE,
      display_label VARCHAR(255) NOT NULL,
      unit VARCHAR(20) NOT NULL CHECK (unit IN ('count', 'bytes')),
      default_value BIGINT NOT NULL CHECK (default_value >= -1),
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by VARCHAR(255) NOT NULL DEFAULT 'system'
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quota_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(255) NOT NULL,
      dimension_key VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
      override_value BIGINT NOT NULL CHECK (override_value >= -1),
      quota_type VARCHAR(10) NOT NULL DEFAULT 'hard' CHECK (quota_type IN ('hard', 'soft')),
      grace_margin INTEGER NOT NULL DEFAULT 0 CHECK (grace_margin >= 0),
      justification TEXT NOT NULL CHECK (length(trim(justification)) BETWEEN 1 AND 1000),
      expires_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'revoked', 'expired')),
      created_by VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      superseded_by UUID REFERENCES quota_overrides(id),
      revoked_by VARCHAR(255),
      revoked_at TIMESTAMPTZ,
      revocation_justification TEXT CHECK (revocation_justification IS NULL OR length(trim(revocation_justification)) <= 1000),
      modified_by VARCHAR(255),
      modified_at TIMESTAMPTZ,
      modification_justification TEXT CHECK (modification_justification IS NULL OR length(trim(modification_justification)) <= 1000)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_quota_overrides_tenant_active ON quota_overrides (tenant_id) WHERE status = \'active\'');
}

// ---- function actions (real executor) --------------------------------------
function newFnVersionId() {
  return `fnv_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function syntheticFnVersionId(action) {
  const digest = createHash('sha256')
    .update(`${action?.resource_id ?? 'unknown'}:${Number(action?.version ?? 1) || 1}`)
    .digest('hex')
    .slice(0, 20);
  return `fnv_${digest}`;
}

function legacyFnVersionSummary(action) {
  return {
    activeVersionId: syntheticFnVersionId(action),
    activeVersionNumber: Number(action?.version ?? 1) || 1,
    versionCount: 1,
    rollbackAvailable: false,
    hasHistory: false
  };
}

async function snapshotFnActionVersion(pool, row, { createdBy = null, originType = 'publish', originVersionId = null } = {}) {
  const versionId = newFnVersionId();
  const { rows } = await pool.query(
    `INSERT INTO fn_action_versions (
       version_id, resource_id, workspace_id, tenant_id, action_name, version_number,
       status, origin_type, origin_version_id, runtime, entrypoint, source_code,
       parameters, memory_mb, timeout_ms, ksvc_name, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,'historical',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (resource_id, version_number) DO UPDATE SET
       action_name=EXCLUDED.action_name,
       origin_type=EXCLUDED.origin_type,
       origin_version_id=EXCLUDED.origin_version_id,
       runtime=EXCLUDED.runtime,
       entrypoint=EXCLUDED.entrypoint,
       source_code=EXCLUDED.source_code,
       parameters=EXCLUDED.parameters,
       memory_mb=EXCLUDED.memory_mb,
       timeout_ms=EXCLUDED.timeout_ms,
       ksvc_name=EXCLUDED.ksvc_name,
       updated_at=NOW(),
       created_by=COALESCE(EXCLUDED.created_by, fn_action_versions.created_by)
     RETURNING *`,
    [
      versionId,
      row.resource_id,
      row.workspace_id,
      row.tenant_id,
      row.action_name,
      row.version,
      originType,
      originVersionId,
      row.runtime,
      row.entrypoint,
      row.source_code,
      row.parameters ? JSON.stringify(row.parameters) : null,
      row.memory_mb,
      row.timeout_ms,
      row.ksvc_name ?? null,
      createdBy
    ]);
  const version = rows[0];
  if (!version) return null;
  await pool.query(
    `UPDATE fn_action_versions
        SET status='historical', updated_at=NOW()
      WHERE resource_id=$1 AND version_id<>$2 AND status='active'`,
    [row.resource_id, version.version_id]);
  const { rows: activeRows } = await pool.query(
    `UPDATE fn_action_versions
        SET status='active', activated_at=NOW(), updated_at=NOW()
      WHERE version_id=$1
      RETURNING *`,
    [version.version_id]);
  return activeRows[0] ?? version;
}

export async function upsertFnAction(pool, a) {
  const { rows: existingRows } = await pool.query(
    'SELECT * FROM fn_actions WHERE workspace_id=$1 AND action_name=$2 LIMIT 1',
    [a.workspaceId, a.actionName]);
  const existing = existingRows[0] ?? null;
  if (existing) {
    const existingVersions = await listFnActionVersions(pool, existing.resource_id);
    if (!existingVersions.length) {
      await snapshotFnActionVersion(pool, existing, { createdBy: existing.created_by ?? a.createdBy, originType: 'publish' });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO fn_actions (resource_id, workspace_id, tenant_id, action_name, runtime, entrypoint, source_code, parameters, memory_mb, timeout_ms, ksvc_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (workspace_id, action_name) DO UPDATE SET
       source_code=EXCLUDED.source_code, runtime=EXCLUDED.runtime, entrypoint=EXCLUDED.entrypoint,
       parameters=EXCLUDED.parameters, memory_mb=EXCLUDED.memory_mb, timeout_ms=EXCLUDED.timeout_ms,
       ksvc_name=EXCLUDED.ksvc_name, version=fn_actions.version+1, updated_at=NOW()
     RETURNING *`,
    [a.resourceId, a.workspaceId, a.tenantId, a.actionName, a.runtime, a.entrypoint, a.sourceCode,
     a.parameters ? JSON.stringify(a.parameters) : null, a.memoryMb, a.timeoutMs, a.ksvcName, a.createdBy]);
  const row = rows[0];
  if (row) await snapshotFnActionVersion(pool, row, { createdBy: a.createdBy, originType: 'publish' });
  return row;
}
export async function getFnAction(pool, resourceId, tenantId = null) {
  if (tenantId != null) {
    const { rows } = await pool.query(
      'SELECT * FROM fn_actions WHERE resource_id=$1 AND tenant_id=$2 LIMIT 1',
      [resourceId, tenantId]);
    return rows[0] ?? null;
  }
  const { rows } = await pool.query('SELECT * FROM fn_actions WHERE resource_id=$1 LIMIT 1', [resourceId]);
  return rows[0] ?? null;
}
export async function listFnActions(pool, workspaceId, tenantId = null) {
  if (tenantId != null) {
    const { rows } = await pool.query(
      'SELECT * FROM fn_actions WHERE workspace_id=$1 AND tenant_id=$2 ORDER BY created_at DESC',
      [workspaceId, tenantId]);
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM fn_actions WHERE workspace_id=$1 ORDER BY created_at DESC', [workspaceId]);
  return rows;
}
export async function listFnActionVersions(pool, resourceId) {
  const { rows } = await pool.query(
    'SELECT * FROM fn_action_versions WHERE resource_id=$1 ORDER BY version_number DESC, created_at DESC',
    [resourceId]);
  return rows;
}
export async function getFnActionVersion(pool, resourceId, versionId, tenantId = null) {
  if (tenantId != null) {
    const { rows } = await pool.query(
      'SELECT * FROM fn_action_versions WHERE resource_id=$1 AND version_id=$2 AND tenant_id=$3 LIMIT 1',
      [resourceId, versionId, tenantId]);
    return rows[0] ?? null;
  }
  const { rows } = await pool.query(
    'SELECT * FROM fn_action_versions WHERE resource_id=$1 AND version_id=$2 LIMIT 1',
    [resourceId, versionId]);
  return rows[0] ?? null;
}
export async function getFnActionVersionSummary(pool, action) {
  const rows = await listFnActionVersions(pool, action.resource_id);
  if (!rows.length) return legacyFnVersionSummary(action);
  const active = rows.find((row) => row.status === 'active') ?? rows[0];
  const activeVersionNumber = Number(active.version_number ?? action.version ?? 1) || 1;
  return {
    activeVersionId: active.version_id,
    activeVersionNumber,
    versionCount: rows.length,
    rollbackAvailable: rows.some((row) => Number(row.version_number ?? 0) < activeVersionNumber),
    hasHistory: true
  };
}
export async function deleteFnAction(pool, action) {
  if (!action?.resource_id || !action?.tenant_id || !action?.workspace_id) return null;
  await pool.query(
    'DELETE FROM fn_activations WHERE resource_id=$1 AND workspace_id=$2',
    [action.resource_id, action.workspace_id]);
  await pool.query(
    'DELETE FROM fn_action_versions WHERE resource_id=$1 AND tenant_id=$2',
    [action.resource_id, action.tenant_id]);
  const { rows } = await pool.query(
    'DELETE FROM fn_actions WHERE resource_id=$1 AND tenant_id=$2 RETURNING *',
    [action.resource_id, action.tenant_id]);
  return rows[0] ?? null;
}
export async function activateFnActionVersion(pool, action, version) {
  if (!action || !version || action.resource_id !== version.resource_id || action.tenant_id !== version.tenant_id) {
    return null;
  }
  await pool.query(
    `UPDATE fn_action_versions
        SET status='historical', updated_at=NOW()
      WHERE resource_id=$1 AND version_id<>$2 AND status='active'`,
    [action.resource_id, version.version_id]);
  const { rows: versionRows } = await pool.query(
    `UPDATE fn_action_versions
        SET status='active', activated_at=NOW(), updated_at=NOW()
      WHERE resource_id=$1 AND version_id=$2
      RETURNING *`,
    [action.resource_id, version.version_id]);
  const activeVersion = versionRows[0] ?? version;
  const { rows } = await pool.query(
    `UPDATE fn_actions SET
       source_code=$3,
       runtime=$4,
       entrypoint=$5,
       parameters=$6,
       memory_mb=$7,
       timeout_ms=$8,
       ksvc_name=COALESCE($9, ksvc_name),
       updated_at=NOW()
     WHERE resource_id=$1 AND tenant_id=$2
     RETURNING *`,
    [
      action.resource_id,
      action.tenant_id,
      activeVersion.source_code,
      activeVersion.runtime,
      activeVersion.entrypoint,
      activeVersion.parameters ? JSON.stringify(activeVersion.parameters) : null,
      activeVersion.memory_mb,
      activeVersion.timeout_ms,
      activeVersion.ksvc_name ?? null
    ]);
  return rows[0] ?? null;
}
export async function insertFnActivation(pool, a) {
  const { rows } = await pool.query(
    `INSERT INTO fn_activations (activation_id, resource_id, workspace_id, status, status_code, result, logs, duration_ms, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [a.activationId, a.resourceId, a.workspaceId, a.status, a.statusCode,
     a.result != null ? JSON.stringify(a.result) : null, a.logs != null ? JSON.stringify(a.logs) : null,
     a.durationMs, a.startedAt, a.finishedAt]);
  return rows[0];
}
export async function listFnActivations(pool, resourceId, limit = 50) {
  const { rows } = await pool.query('SELECT * FROM fn_activations WHERE resource_id=$1 ORDER BY started_at DESC LIMIT $2', [resourceId, limit]);
  return rows;
}
export async function getFnActivation(pool, activationId) {
  const { rows } = await pool.query('SELECT * FROM fn_activations WHERE activation_id=$1 LIMIT 1', [activationId]);
  return rows[0] ?? null;
}
export async function latestFnActivation(pool, resourceId) {
  const { rows } = await pool.query('SELECT * FROM fn_activations WHERE resource_id=$1 ORDER BY started_at DESC LIMIT 1', [resourceId]);
  return rows[0] ?? null;
}

// ---- workspace databases ---------------------------------------------------
export async function insertWorkspaceDatabase(pool, d) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_databases (id, workspace_id, tenant_id, engine, database_name, mode, username, host, port, environment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, workspace_id, tenant_id, engine, database_name, mode, username, host, port, environment, status, created_at, created_by`,
    [d.id, d.workspaceId, d.tenantId, d.engine, d.databaseName, d.mode, d.username, d.host, d.port, d.environment ?? 'dev', d.createdBy]);
  return rows[0];
}
export async function databaseWorkspaceMap(pool) {
  const { rows } = await pool.query('SELECT database_name, workspace_id, tenant_id FROM workspace_databases');
  const map = {};
  for (const r of rows) map[r.database_name] = r;
  return map;
}
export async function getWorkspaceDatabase(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, engine, database_name, mode, username, host, port, status, created_at, created_by
       FROM workspace_databases WHERE workspace_id=$1 LIMIT 1`, [workspaceId]);
  return rows[0] ?? null;
}
export async function deleteWorkspaceDatabaseRecord(pool, id) {
  await pool.query('DELETE FROM workspace_databases WHERE id=$1', [id]);
}

// ---- workspace mongo (FerretDB) databases ----------------------------------
// Record a workspace's provisioned FerretDB database so purge/delete can discover
// it for an isolation-safe teardown (fix-tenant-purge-ferretdb-cascade, #682).
// Idempotent: a same-workspace re-provision of the same db name is a no-op (ON
// CONFLICT DO NOTHING), returning the existing row. NEVER reassigns the owner —
// the (workspace_id, database_name) conflict is always a same-workspace re-provision
// (mongo db names are shared across tenants, but the workspace id is globally unique).
export async function insertMongoDatabase(pool, { workspaceId, tenantId, databaseName, collections, createdBy }) {
  const cols = JSON.stringify(Array.isArray(collections) ? collections : []);
  const { rows } = await pool.query(
    `INSERT INTO workspace_mongo_databases (workspace_id, tenant_id, database_name, collections, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (workspace_id, database_name) DO NOTHING
     RETURNING id, workspace_id, tenant_id, database_name, collections, created_at, created_by`,
    [workspaceId, tenantId, databaseName, cols, createdBy ?? null]);
  if (rows[0]) return rows[0];
  // Conflict: the row already exists for this (workspace, db) — return it so the
  // caller still observes the recorded database (re-provision stays idempotent).
  const { rows: existing } = await pool.query(
    `SELECT id, workspace_id, tenant_id, database_name, collections, created_at, created_by
       FROM workspace_mongo_databases WHERE workspace_id=$1 AND database_name=$2 LIMIT 1`,
    [workspaceId, databaseName]);
  return existing[0] ?? null;
}
// Distinct FerretDB database names a tenant has provisioned (across all its workspaces).
// De-duplicated: the same db name may be recorded under several workspaces of the tenant,
// but the teardown only needs to delete the tenant's documents from each db once.
export async function collectTenantMongoDatabases(pool, tenantId) {
  const { rows } = await pool.query(
    'SELECT DISTINCT database_name FROM workspace_mongo_databases WHERE tenant_id=$1', [tenantId]);
  return rows.map((r) => r.database_name);
}
// FerretDB database names recorded for a single workspace (workspace-delete teardown).
export async function collectWorkspaceMongoDatabases(pool, workspaceId) {
  const { rows } = await pool.query(
    'SELECT DISTINCT database_name FROM workspace_mongo_databases WHERE workspace_id=$1', [workspaceId]);
  return rows.map((r) => r.database_name);
}

// ---- workspace buckets (object store mapping) ------------------------------
export async function insertBucket(pool, { workspaceId, tenantId, bucketName, region }) {
  // ON CONFLICT must NEVER reassign workspace_id/tenant_id: the previous
  // `SET workspace_id=EXCLUDED..., tenant_id=EXCLUDED...` let a second tenant whose
  // slug-derived bucket name collided HIJACK the first tenant's registry row, so
  // the first tenant's bucket vanished from their list (P1 tenant-isolation). Bucket
  // names are now workspace-id-scoped (see storage-handlers deriveBucketName), so a
  // conflict is always a same-workspace re-provision: keep the owner intact and just
  // refresh region (idempotent), returning the existing row.
  const { rows } = await pool.query(
    `INSERT INTO workspace_buckets (workspace_id, tenant_id, bucket_name, region)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (bucket_name) DO UPDATE SET region=EXCLUDED.region
     RETURNING id, workspace_id, tenant_id, bucket_name, region, created_at`,
    [workspaceId, tenantId, bucketName, region]);
  return rows[0];
}
export async function listBucketsForWorkspace(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, bucket_name, region, created_at
       FROM workspace_buckets WHERE workspace_id=$1 ORDER BY created_at`, [workspaceId]);
  return rows;
}
export async function bucketWorkspaceMap(pool) {
  const { rows } = await pool.query('SELECT bucket_name, workspace_id, tenant_id, region, created_at FROM workspace_buckets');
  const map = {};
  for (const r of rows) map[r.bucket_name] = r;
  return map;
}
export async function getBucketRecord(pool, bucketName) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, bucket_name, region, created_at
       FROM workspace_buckets WHERE bucket_name=$1 LIMIT 1`, [bucketName]);
  return rows[0] ?? null;
}
// Remove the registry row for a SINGLE bucket (#676 per-bucket delete). The physical
// SeaweedFS bucket is dropped by storage-handlers::deleteBucket; this drops only the
// `workspace_buckets` mapping row so the bucket disappears from list/usage. Idempotent:
// deleting an absent row affects 0 rows and is a clean no-op. Keyed on the
// globally-unique physical bucket name (no tenant/workspace scoping needed — the caller
// has already passed the ownership gate). Returns the deleted row (or null).
export async function deleteBucketRecord(pool, bucketName) {
  const { rows } = await pool.query(
    `DELETE FROM workspace_buckets WHERE bucket_name=$1
       RETURNING id, workspace_id, tenant_id, bucket_name, region, created_at`, [bucketName]);
  return rows[0] ?? null;
}

// ---- workspace topics (event store mapping) --------------------------------
export async function insertTopic(pool, { id, workspaceId, tenantId, topicName, physicalTopicName, partitions }) {
  // Idempotency is keyed on (workspace_id, topic_name): re-provisioning the same
  // logical topic in the SAME workspace returns the existing row (original
  // resourceId). We must NOT key on physical_topic_name alone — that let a second
  // tenant's slug-derived collision UPDATE/return the first tenant's row (P1
  // ISO-EVENTS). The conflict can no longer cross tenants because the physical
  // name now embeds the globally-unique workspace id (see kafka-handlers
  // physicalTopicName), so a (workspace_id, topic_name) match is always same-tenant.
  const { rows } = await pool.query(
    `INSERT INTO workspace_topics (id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (workspace_id, topic_name) DO UPDATE SET partitions=EXCLUDED.partitions
     RETURNING id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions, created_at`,
    [id, workspaceId, tenantId, topicName, physicalTopicName, partitions]);
  return rows[0];
}
export async function listTopicsForWorkspace(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions, created_at
       FROM workspace_topics WHERE workspace_id=$1 ORDER BY created_at`, [workspaceId]);
  return rows;
}
export async function getTopicByResourceId(pool, resourceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions, created_at
       FROM workspace_topics WHERE id=$1 LIMIT 1`, [resourceId]);
  return rows[0] ?? null;
}

// ---- workspace functions (registry) ----------------------------------------
export async function functionNameTaken(pool, workspaceId, name) {
  const { rows } = await pool.query('SELECT 1 FROM workspace_functions WHERE workspace_id=$1 AND name=$2 LIMIT 1', [workspaceId, name]);
  return rows.length > 0;
}
export async function insertFunction(pool, f) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_functions (id, workspace_id, tenant_id, name, runtime, handler, source_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, workspace_id, tenant_id, name, runtime, handler, source_ref, runtime_status, status, created_at, created_by`,
    [f.id, f.workspaceId, f.tenantId, f.name, f.runtime, f.handler, f.sourceRef, f.createdBy]);
  return rows[0];
}
export async function listFunctions(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, name, runtime, handler, source_ref, runtime_status, status, created_at, created_by
       FROM workspace_functions WHERE workspace_id=$1 ORDER BY created_at DESC`, [workspaceId]);
  return { items: rows, total: rows.length };
}

// ---- workspaces ------------------------------------------------------------
export async function workspaceSlugTaken(pool, tenantId, slug) {
  const { rows } = await pool.query('SELECT 1 FROM workspaces WHERE tenant_id=$1 AND slug=$2 LIMIT 1', [tenantId, slug]);
  return rows.length > 0;
}
// Current workspace count for the tenant — the usage figure the max_workspaces
// quota gate compares against (#556).
export async function countTenantWorkspaces(pool, tenantId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM workspaces WHERE tenant_id=$1', [tenantId]);
  return rows[0]?.n ?? 0;
}
export async function insertWorkspace(pool, { id, tenantId, slug, displayName, environment = 'dev', createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO workspaces (id, tenant_id, slug, display_name, environment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, tenant_id, slug, display_name, status, environment, created_at, created_by`,
    [id, tenantId, slug, displayName, environment, createdBy]);
  return rows[0];
}
export async function listWorkspaces(pool, { tenantId = null, allTenants = false, limit = 100, offset = 0 } = {}) {
  // Fail-closed (#800): the unscoped (all-tenants) query runs ONLY on an explicit allTenants intent
  // (superadmin/internal). A falsy tenantId without it returns no rows, so a missing tenant scope can
  // never silently drop the WHERE predicate and leak every tenant's workspaces.
  if (!tenantId && !allTenants) return { items: [], total: 0 };
  const where = tenantId ? 'WHERE tenant_id = $3' : '';
  const params = tenantId ? [limit, offset, tenantId] : [limit, offset];
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, environment, created_at, created_by, COUNT(*) OVER() AS total
       FROM workspaces ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, params);
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}
export async function getWorkspace(pool, idOrSlug) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, environment, created_at, created_by
       FROM workspaces WHERE id = $1 OR slug = $1 LIMIT 1`, [idOrSlug]);
  return rows[0] ?? null;
}
export async function insertInvitation(pool, invitation) {
  const { rows } = await pool.query(
    `INSERT INTO tenant_invitations (
       id, tenant_id, workspace_id, email_hash, masked_email, role, status,
       expires_at, metadata, target_bindings, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
     RETURNING id, tenant_id, workspace_id, email_hash, masked_email, role,
       status, expires_at, metadata, target_bindings, created_at, created_by`,
    [
      invitation.id,
      invitation.tenantId,
      invitation.workspaceId ?? null,
      invitation.emailHash,
      invitation.maskedEmail ?? null,
      invitation.role,
      invitation.status ?? 'pending',
      invitation.expiresAt,
      JSON.stringify(invitation.metadata ?? {}),
      JSON.stringify(invitation.targetBindings ?? []),
      invitation.createdBy ?? null
    ]);
  return rows[0] ?? null;
}
// List a tenant's first-class environments (#503): one entry per environment, each with its
// workspaces + provisioned databases — proving multiple isolated environments per project, every
// environment carrying its own isolated resource set (the per-workspace wsdb_* DB from D2/#502).
export async function listTenantEnvironments(pool, tenantId) {
  const { rows } = await pool.query(
    `SELECT w.environment,
            COUNT(*)::int AS workspace_count,
            json_agg(json_build_object('workspaceId', w.id, 'slug', w.slug, 'displayName', w.display_name,
                                       'database', d.database_name) ORDER BY w.created_at) AS workspaces
       FROM workspaces w
       LEFT JOIN workspace_databases d ON d.workspace_id = w.id
      WHERE w.tenant_id = $1
      GROUP BY w.environment
      ORDER BY w.environment`, [tenantId]);
  return rows.map((r) => ({ environment: r.environment, workspaceCount: r.workspace_count, workspaces: r.workspaces }));
}

// ---- service accounts ------------------------------------------------------
export async function insertServiceAccount(pool, sa) {
  const { rows } = await pool.query(
    `INSERT INTO service_accounts (id, workspace_id, tenant_id, iam_realm, kc_client_id, kc_client_uuid, display_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, workspace_id, tenant_id, kc_client_id, display_name, status, created_at, created_by`,
    [sa.id, sa.workspaceId, sa.tenantId, sa.iamRealm, sa.kcClientId, sa.kcClientUuid, sa.displayName, sa.createdBy]);
  return rows[0];
}
export async function getServiceAccount(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, iam_realm, kc_client_id, kc_client_uuid, display_name, status, created_at, created_by
       FROM service_accounts WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}
export async function listServiceAccounts(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, iam_realm, kc_client_id, display_name, status, created_at, created_by
       FROM service_accounts WHERE workspace_id = $1 ORDER BY created_at DESC`, [workspaceId]);
  return { items: rows, total: rows.length };
}

// ---- external applications -------------------------------------------------
export async function listExternalApplications(pool, {
  workspaceId,
  tenantId,
  limit = 100,
  offset = 0,
  protocol = null,
  state = null,
} = {}) {
  const clauses = ['workspace_id = $1', 'tenant_id = $2'];
  const params = [workspaceId, tenantId];
  if (protocol) {
    params.push(protocol);
    clauses.push(`protocol = $${params.length}`);
  }
  if (state) {
    params.push(state);
    clauses.push(`state = $${params.length}`);
  }
  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, slug, protocol, state, app_json, created_at, updated_at, created_by, updated_by,
            COUNT(*) OVER() AS total
       FROM external_applications
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params);
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

export async function getExternalApplication(pool, { workspaceId, tenantId, applicationId }) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, slug, protocol, state, app_json, created_at, updated_at, created_by, updated_by
       FROM external_applications
      WHERE workspace_id = $1
        AND tenant_id = $2
        AND (id = $3 OR slug = $3)
      LIMIT 1`,
    [workspaceId, tenantId, applicationId]);
  return rows[0] ?? null;
}

export async function upsertExternalApplication(pool, {
  id,
  workspaceId,
  tenantId,
  slug,
  protocol,
  state = 'active',
  appJson,
  actorId = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO external_applications (id, workspace_id, tenant_id, slug, protocol, state, app_json, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
     ON CONFLICT (id) DO UPDATE
       SET slug = EXCLUDED.slug,
           protocol = EXCLUDED.protocol,
           state = EXCLUDED.state,
           app_json = EXCLUDED.app_json,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
      WHERE external_applications.workspace_id = EXCLUDED.workspace_id
        AND external_applications.tenant_id = EXCLUDED.tenant_id
     RETURNING id, workspace_id, tenant_id, slug, protocol, state, app_json, created_at, updated_at, created_by, updated_by`,
    [id, workspaceId, tenantId, slug, protocol, state, JSON.stringify(appJson ?? {}), actorId]);
  return rows[0] ?? null;
}

export async function setServiceAccountStatus(pool, id, status) {
  await pool.query('UPDATE service_accounts SET status=$2 WHERE id=$1', [id, status]);
}
// Granular service-account delete (#687): remove the persistence row by id. The caller
// (b-handlers.mjs::deleteServiceAccount) has already authorized own-tenant + resolved the row by
// (id, workspace_id), so this is a plain delete-by-id; idempotent (a missing id deletes 0 rows).
export async function deleteServiceAccount(pool, id) {
  await pool.query('DELETE FROM service_accounts WHERE id = $1', [id]);
}
// Stamp the revocation-propagation cutoff for a SA (fix-sa-credential-revocation-invalidate-tokens,
// #684). Called on credential revoke AND rotate so every access token minted before NOW() is then
// rejected by the auth path's not-before check. NOW() is the database clock — the same source the
// cutoff is compared against, so it is independent of any control-plane replica's wall clock.
export async function markServiceAccountCredentialsInvalidated(pool, id) {
  await pool.query('UPDATE service_accounts SET credentials_invalidated_at = NOW() WHERE id = $1', [id]);
}
// Auth-path read for the SA revocation check (fix-sa-credential-revocation-invalidate-tokens, #684):
// resolve a SA by its Keycloak client id (the token's `azp`) AND its realm (== tenant id, taken from
// the verified token issuer) to its revocation-relevant state. Returns { status,
// credentials_invalidated_at } or null when no such SA exists (e.g. a non-SA token, or an unknown
// client). kc_client_id is NOT globally unique — `sa-<ws-slug>-<name>` collides across tenants because
// the workspace slug is only `UNIQUE (tenant_id, slug)` — so the realm scope is REQUIRED to avoid
// resolving another tenant's same-named SA (a cross-tenant breach + a way to defeat the check). The
// (iam_realm, kc_client_id) pair IS unique (createServiceAccount 409s on a per-realm findClient);
// LIMIT 1 is a defensive backstop for any legacy duplicate.
export async function getServiceAccountAuthStateByClientId(pool, kcClientId, realm) {
  const { rows } = await pool.query(
    `SELECT status, credentials_invalidated_at
       FROM service_accounts WHERE kc_client_id = $1 AND iam_realm = $2
      ORDER BY created_at DESC LIMIT 1`, [kcClientId, realm]);
  return rows[0] ?? null;
}

export async function slugTaken(pool, slug) {
  const { rows } = await pool.query('SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
  return rows.length > 0;
}

export async function insertTenant(pool, { id, slug, displayName, iamRealm, createdBy }) {
  const { rows } = await pool.query(
    // $1 arrives as text; cast explicitly so it is not deduced as both uuid and text.
    `INSERT INTO tenants (id, tenant_id, slug, display_name, iam_realm, created_by)
     VALUES ($1, $1, $2, $3, $4, $5)
     RETURNING id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by`,
    [id, slug, displayName, iamRealm, createdBy]
  );
  return rows[0];
}

export async function listTenants(pool, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by,
            COUNT(*) OVER() AS total
       FROM tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

export async function getTenant(pool, idOrSlug) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by
       FROM tenants WHERE id = $1 OR slug = $1 LIMIT 1`, [idOrSlug]);
  return rows[0] ?? null;
}

// Resolve the tenant that owns a Keycloak realm — used to authorize a tenant
// owner/admin to manage end-users in their own realm (#567).
export async function getTenantByRealm(pool, realm) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by
       FROM tenants WHERE iam_realm = $1 LIMIT 1`, [realm]);
  return rows[0] ?? null;
}

export async function deleteTenant(pool, id) {
  await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
}

export async function listRuntimeOwnership(pool, { tenantId, workspaceId }) {
  const where = tenantId ? 'tenant_id=$1' : 'workspace_id=$1';
  const { rows: functions } = await pool.query(`SELECT tenant_id AS "tenantId", workspace_id AS "workspaceId", resource_id AS "resourceId", ksvc_name AS "ksvcName" FROM fn_actions WHERE ${where} AND ksvc_name IS NOT NULL`, [tenantId ?? workspaceId]);
  let mcpState = null;
  try { const r = await pool.query('SELECT state FROM falcone_mcp_state WHERE id=$1', [tenantId ?? 'global']); mcpState = r.rows[0]?.state ?? null; } catch { mcpState = null; }
  return { tenantId: tenantId ?? functions[0]?.tenantId, workspaceId, functions, mcpState };
}

export async function deferAggregateCleanup(pool, { tenantId, workspaceId, resources = [], correlationId }) {
  for (const resource of resources) {
    await pool.query(`INSERT INTO runtime_cleanup_obligations (obligation_id,resource_type,operation,tenant_id,workspace_id,resource_id,runtime_resource_name,correlation_id,status) VALUES ($1,$2,'delete',$3,$4,$5,$6,$7,'pending') ON CONFLICT (obligation_id) DO UPDATE SET updated_at=NOW()`, [`aggregate:${resource.resourceId ?? resource.name ?? resource}`, resource.type ?? 'aggregate', tenantId, workspaceId, resource.resourceId ?? String(resource), resource.ksvcName ?? resource.name ?? String(resource), correlationId ?? null]);
  }
}

// Soft delete: mark the tenant 'deleted' (offboarding without destroying data yet).
export async function markTenantDeleted(pool, id) {
  const { rows } = await pool.query(
    `UPDATE tenants SET status='deleted' WHERE id=$1 RETURNING id, slug, display_name, status, iam_realm`, [id]);
  return rows[0] ?? null;
}

// Cascading teardown of a SINGLE workspace (add-deploy-completeness-cluster, #562). Mirrors
// purgeTenant's collect-then-delete, scoped to one workspace_id (NOT a whole tenant): collects
// the physical resources the caller must tear down (its per-workspace wsdb_* database, bucket(s),
// topic(s)) BEFORE deleting the registry rows, then deletes the child rows and finally the
// workspace row. Each delete is best-effort against a table that may be absent in this hand-built
// runtime (42P01 ignored), keeping the operation idempotent and retryable. The workspace's tenant
// ownership is enforced by the CALLER (deleteWorkspace) before this runs — this function performs
// no authorization, only the workspace-scoped row teardown.
export async function purgeWorkspace(pool, workspaceId) {
  const collect = async (sql) => { try { return (await pool.query(sql, [workspaceId])).rows; } catch { return []; } };
  const databases = (await collect('SELECT database_name FROM workspace_databases WHERE workspace_id=$1')).map((r) => r.database_name);
  // FerretDB (mongo) databases recorded for this workspace — collected for an
  // isolation-safe document teardown (fix-tenant-purge-ferretdb-cascade, #682).
  const mongoDatabases = (await collect('SELECT DISTINCT database_name FROM workspace_mongo_databases WHERE workspace_id=$1')).map((r) => r.database_name);
  const buckets = (await collect('SELECT bucket_name FROM workspace_buckets WHERE workspace_id=$1')).map((r) => r.bucket_name);
  const topics = (await collect('SELECT physical_topic_name FROM workspace_topics WHERE workspace_id=$1')).map((r) => r.physical_topic_name);
  const ksvcs = (await collect("SELECT ksvc_name FROM fn_actions WHERE workspace_id=$1 AND ksvc_name IS NOT NULL")).map((r) => r.ksvc_name);

  const del = async (sql, params) => { try { await pool.query(sql, params); } catch (e) { if (e.code !== '42P01') throw e; } }; // ignore undefined_table
  // Child rows first (every workspace-owned table is keyed by workspace_id), then the workspace.
  for (const t of ['fn_activations', 'fn_action_versions', 'fn_actions', 'workspace_functions', 'workspace_topics',
                   'workspace_buckets', 'workspace_databases', 'workspace_mongo_databases',
                   'workspace_api_keys', 'service_accounts', 'external_applications', 'tenant_invitations']) {
    await del(`DELETE FROM ${t} WHERE workspace_id = $1`, [workspaceId]);
  }
  await del('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  return { databases, mongoDatabases, buckets, topics, ksvcs, workspaceId };
}

// Cascading purge of every row a tenant owns (add-tenant-delete-purge-cascade, #501). Collects
// the physical resources the caller must tear down (databases/buckets/topics/ksvcs) BEFORE
// deleting the registry rows, then deletes child rows before parents. Each table delete is
// best-effort (a table absent in this hand-built runtime — e.g. product-migration plan tables —
// must not abort the purge); the operation is idempotent, so a partial run can simply be retried.
export async function purgeTenant(pool, tenantId) {
  const collect = async (sql) => { try { return (await pool.query(sql, [tenantId])).rows; } catch { return []; } };
  const databases = (await collect('SELECT database_name FROM workspace_databases WHERE tenant_id=$1')).map((r) => r.database_name);
  // FerretDB (mongo) databases recorded for this tenant — collected (de-duplicated)
  // for an isolation-safe document teardown (fix-tenant-purge-ferretdb-cascade, #682).
  const mongoDatabases = (await collect('SELECT DISTINCT database_name FROM workspace_mongo_databases WHERE tenant_id=$1')).map((r) => r.database_name);
  const buckets = (await collect('SELECT bucket_name FROM workspace_buckets WHERE tenant_id=$1')).map((r) => r.bucket_name);
  const topics = (await collect('SELECT physical_topic_name FROM workspace_topics WHERE tenant_id=$1')).map((r) => r.physical_topic_name);
  const ksvcs = (await collect("SELECT ksvc_name FROM fn_actions WHERE tenant_id=$1 AND ksvc_name IS NOT NULL")).map((r) => r.ksvc_name);
  const workspaceIds = (await collect('SELECT id FROM workspaces WHERE tenant_id=$1')).map((r) => r.id);

  const del = async (sql, params) => { try { await pool.query(sql, params); } catch (e) { if (e.code !== '42P01') throw e; } }; // ignore undefined_table
  // fn_activations has no tenant_id — scope by the tenant's workspaces.
  if (workspaceIds.length) await del('DELETE FROM fn_activations WHERE workspace_id = ANY($1)', [workspaceIds]);
  for (const t of ['fn_action_versions', 'fn_actions', 'workspace_functions', 'workspace_topics', 'workspace_buckets',
                   'workspace_databases', 'workspace_mongo_databases', 'workspace_api_keys', 'service_accounts',
                   'external_applications', 'tenant_invitations',
                   'async_operation_log_entries', 'async_operation_transitions', 'async_operations',
                   'tenant_plan_assignments', 'tenant_custom_roles', 'effective_entitlements']) {
    await del(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
  }
  await del('DELETE FROM workspaces WHERE tenant_id = $1', [tenantId]);
  await del('DELETE FROM tenants WHERE id = $1', [tenantId]);
  return { databases, mongoDatabases, buckets, topics, ksvcs, workspaceIds };
}
