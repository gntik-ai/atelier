#!/usr/bin/env bash
# Bring up the Falcone test environment (Postgres + Keycloak + Redpanda + MongoDB
# + SeaweedFS + OpenBao), wait for health, provision the Keycloak admin service account,
# apply known service migrations, initiate the Mongo replica set, create the SeaweedFS
# bucket, and enable the OpenBao file audit device.
# Idempotent: safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
KC=/opt/keycloak/bin/kcadm.sh

# Host-mounted OpenBao audit dir must exist + be writable before the container
# (which writes the file audit log) starts.
mkdir -p ./openbao/audit
chmod 777 ./openbao/audit 2>/dev/null || true

echo "==> docker compose up"
# --build so the action-runner shim image always reflects the current
# tests/env/action-runner/ source (routes.mjs/server.mjs). Without it, compose
# reuses a stale cached image and new routes silently 404.
docker compose up -d --build

echo "==> waiting for backing-service health (postgres, keycloak, redpanda)"
for i in $(seq 1 60); do
  pg=$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null || true)
  kc=$(docker compose ps keycloak --format '{{.Health}}' 2>/dev/null || true)
  rp=$(docker compose ps redpanda --format '{{.Health}}' 2>/dev/null || true)
  # Document store: gate on the DocumentDB ENGINE healthcheck (the FerretDB gateway image is
  # distroless and has no container healthcheck; it depends_on documentdb: service_healthy and
  # readiness is gated by the driver's connection retry).
  dd=$(docker compose ps documentdb --format '{{.Health}}' 2>/dev/null || true)
  sw=$(docker compose ps seaweedfs --format '{{.Health}}' 2>/dev/null || true)
  va=$(docker compose ps openbao --format '{{.Health}}' 2>/dev/null || true)
  tm=$(docker compose ps temporal --format '{{.Health}}' 2>/dev/null || true)
  [ "$pg" = "healthy" ] && [ "$kc" = "healthy" ] && [ "$rp" = "healthy" ] \
    && [ "$dd" = "healthy" ] && [ "$sw" = "healthy" ] && [ "$va" = "healthy" ] \
    && [ "$tm" = "healthy" ] && break
  sleep 5
done
[ "${pg:-}" = "healthy" ] && [ "${kc:-}" = "healthy" ] && [ "${rp:-}" = "healthy" ] \
  && [ "${dd:-}" = "healthy" ] && [ "${sw:-}" = "healthy" ] && [ "${va:-}" = "healthy" ] \
  && [ "${tm:-}" = "healthy" ] \
  || { echo "services not healthy (pg=$pg kc=$kc redpanda=$rp documentdb=$dd seaweedfs=$sw openbao=$va temporal=$tm)" >&2; exit 1; }

echo "==> provisioning Keycloak admin service account (falcone-admin)"
docker compose exec -T keycloak "$KC" config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin >/dev/null
docker compose exec -T keycloak "$KC" create clients -r master \
  -s clientId=falcone-admin -s enabled=true -s publicClient=false \
  -s serviceAccountsEnabled=true -s secret=falcone-admin-secret >/dev/null 2>&1 \
  && echo "   created client falcone-admin" || echo "   client falcone-admin already exists"
docker compose exec -T keycloak "$KC" add-roles -r master \
  --uusername service-account-falcone-admin --rolename admin >/dev/null
echo "   granted realm 'admin' role to service-account-falcone-admin"

echo "==> applying backup-status migrations to Postgres"
for f in "$ROOT"/packages/backup-status/src/db/migrations/*.sql; do
  [ -f "$f" ] || continue
  docker compose exec -T postgres psql -v ON_ERROR_STOP=0 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $(basename "$f")" || echo "   skipped $(basename "$f") (already applied?)"
done

# FerretDB needs NO replica-set initiation (it is a stateless gateway over PostgreSQL/
# DocumentDB, not a mongod). The document store is ready once the ferretdb healthcheck
# passes (gated above) and the documentdb engine is healthy (ferretdb depends_on it).
# NOTE: FerretDB does not support change streams — realtime/CDC tests/env paths are deferred
# to add-ferretdb-realtime-cdc-remediation (#460). (add-ferretdb-data-access-cutover #459)
echo "==> document store: FerretDB gateway ready (no replica-set init required)"

echo "==> creating SeaweedFS bucket (falcone-test)"
# Create the bucket via `weed shell` inside the all-in-one container. Check-then-create
# keeps it idempotent regardless of s3.bucket.create's re-create behavior.
docker compose exec -T seaweedfs sh -c \
  'echo "s3.bucket.list" | weed shell -master localhost:9333 2>/dev/null | grep -qw falcone-test \
     || echo "s3.bucket.create -name falcone-test" | weed shell -master localhost:9333 >/dev/null 2>&1' \
  && echo "   bucket falcone-test ready" \
  || { echo "   failed to create SeaweedFS bucket" >&2; exit 1; }

echo "==> enabling OpenBao file audit device"
# Idempotent: enabling an already-enabled device returns an error we ignore.
# mode=0644 so the host test process (secret-audit-handler) can read the log;
# the dev container runs as a non-host uid and the default 0600 would lock it out.
docker compose exec -T -e BAO_ADDR=http://localhost:8200 -e BAO_TOKEN=root openbao \
  bao audit enable file file_path=/openbao/audit/openbao-audit.log mode=0644 >/dev/null 2>&1 \
  && echo "   file audit device enabled" || echo "   file audit device already enabled"
# Generate at least one audit entry so the host-visible log file exists + is non-empty.
docker compose exec -T -e BAO_ADDR=http://localhost:8200 -e BAO_TOKEN=root openbao \
  bao kv get -mount=secret nonexistent >/dev/null 2>&1 || true
docker compose exec -T -e BAO_ADDR=http://localhost:8200 -e BAO_TOKEN=root openbao \
  bao token lookup >/dev/null 2>&1 || true
if [ -s ./openbao/audit/openbao-audit.log ]; then
  echo "   audit log present on host: $(pwd)/openbao/audit/openbao-audit.log"
else
  echo "   openbao audit log missing or empty on host" >&2; exit 1
fi
echo "==> applying scheduling-engine migrations to Postgres"
# pgcrypto provides gen_random_uuid() used by the scheduling tables' defaults.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' >/dev/null 2>&1 || true
for f in "$ROOT"/packages/scheduling-engine/migrations/*.sql; do
  [ -f "$f" ] || continue
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $(basename "$f")" || echo "   skipped $(basename "$f") (already applied?)"
done

echo "==> applying provisioning-orchestrator async-operation migrations to Postgres"
# Only the migrations the async-operation HTTP slice needs: the async_operations
# table + the columns the create/query actions read. Applied in dependency order
# (073 creates the table other migrations ALTER / reference).
#   073 async_operations + transitions
#   074 async_operation_log_entries
#   075 idempotency_key_records + retry_attempts (+ attempt_count/max_retries cols)
#   076 timeout/cancel/recovery cols + operation_policies (+ status-check widening)
#   078 failure-classification + intervention cols/tables
#   079 result + terminal completion timestamp columns
PO_MIGRATIONS="$ROOT/packages/provisioning-orchestrator/src/migrations"
for m in 073-async-operation-tables 074-async-operation-log-entries \
         075-idempotency-retry-tables 076-timeout-cancel-recovery \
         078-retry-semantics-intervention 079-async-operation-results; do
  f="$PO_MIGRATIONS/$m.sql"
  [ -f "$f" ] || { echo "   MISSING $m.sql" >&2; continue; }
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $m" || echo "   skipped $m (already applied?)"
done

echo "==> applying provisioning-orchestrator plan + quota + entitlements migrations to Postgres"
# Only the migrations the plan/quota/entitlements HTTP slices need, in dependency
# order:
#   097 plans + tenant_plan_assignments + plan_audit_events
#       (+ set_updated_at_timestamp() function used by 098/104)
#   098 quota_dimension_catalog (+ seeds the 8 default dimensions the
#       quota-dimension-catalog-list action returns)
#   100 tenant_plan_change_history + quota/capability impacts (plan-change audit)
#   103 quota_overrides (+ plans.quota_type_config) — resolveUnifiedEntitlements
#       LEFT JOINs quota_overrides, so the entitlements query needs this table
#   104 boolean_capability_catalog (+ seeds) — resolveUnifiedEntitlements queries
#       it optionally (its 42P01 is caught), but seeding it exercises the full
#       capability-resolution path
#   105 workspace_sub_quotas (FK -> quota_dimension_catalog) — the table the
#       workspace-sub-quota set/list family writes/reads
for m in 097-plan-entity-tenant-assignment 098-plan-base-limits \
         100-plan-change-impact-history 103-hard-soft-quota-overrides \
         104-plan-boolean-capabilities 105-effective-limit-resolution; do
  f="$PO_MIGRATIONS/$m.sql"
  [ -f "$f" ] || { echo "   MISSING $m.sql" >&2; continue; }
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $m" || echo "   skipped $m (already applied?)"
done

# ---- HTTP request-chain slice (scheduling only) ----------------------------
# Concrete tenant/workspace the slice user is bound to (mirrors env.sh).
E2E_TENANT_ID="${E2E_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
E2E_WORKSPACE_ID="${E2E_WORKSPACE_ID:-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}"
# A DIFFERENT tenant used only as the owner of a SHARED-instance backup snapshot,
# to prove tenant A never sees another tenant's shared rows (data-layer probe).
E2E_TENANT_B_ID="${E2E_TENANT_B_ID:-22222222-2222-2222-2222-222222222222}"

# ---- backup-status fixtures (data-layer tenant-isolation probe) -------------
# Seed the backup_status_snapshots table (created by migration 001 above) so the
# backup-status family returns REAL rows instead of an empty "not enabled" 200,
# and so the smoke can prove the data layer — not just the auth gate — keeps
# tenants apart. Two rows:
#   A) tenant A, is_shared_instance=FALSE  -> tenant A's own-tenant view SEES it.
#   B) tenant B, is_shared_instance=TRUE   -> tenant A (read:own, no platform/
#      technical scope) MUST NOT see it: getByTenant(includeShared:false) filters
#      it at the SQL layer (WHERE tenant_id=$1 AND is_shared_instance=FALSE) and
#      two in-action belts drop it again. A technical-scoped global caller
#      (superadmin) DOES see it via getAll(includeShared:true).
# Idempotent: ON CONFLICT on the (tenant_id, component_type, instance_id) unique
# constraint does nothing on re-run.
echo "==> seeding backup_status_snapshots fixtures (tenant A own + tenant B shared)"
# if/then/else with the heredoc directly on the command line — avoids the bash
# heredoc + backslash-continuation footgun (where the body would be mis-collected).
if docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test >/dev/null 2>&1 <<SQL
INSERT INTO backup_status_snapshots
  (tenant_id, component_type, instance_id, instance_label, deployment_profile,
   is_shared_instance, status, last_successful_backup_at, last_checked_at, detail)
VALUES
  ('$E2E_TENANT_ID', 'postgres', 'pg-tenant-a-1', 'tenant-a-primary-db', 'dedicated',
   FALSE, 'success', NOW(), NOW(), 'tenant A dedicated database'),
  ('$E2E_TENANT_B_ID', 'object-store', 'seaweedfs-shared-1', 'shared-platform-objectstore', 'shared',
   TRUE, 'success', NOW(), NOW(), 'platform-shared object store owned by tenant B')
ON CONFLICT (tenant_id, component_type, instance_id) DO NOTHING;
SQL
then
  echo "   seeded backup snapshots (own=tenant-a-primary-db, shared=shared-platform-objectstore)"
else
  echo "   skipped backup snapshot seed (table missing or already seeded?)"
fi

# ---- entitlements fixtures (real plan-derived limits, not catalog defaults) -
# Assign a real plan to tenant A so tenant-effective-entitlements-get returns
# plan-derived limits (planSlug set, a dimension sourced from 'plan') instead of
# the catalog-default fallback. resolveUnifiedEntitlements LEFT JOINs
# tenant_plan_assignments (097) + plans (097); for any dimension present in the
# plan's quota_dimensions JSONB it reports source='plan' with the plan's value,
# else 'catalog_default'. We give the plan max_workspaces=50 (a seeded catalog
# dimension), so that dimension resolves to source='plan', effectiveValue=50.
# Idempotent: the plan upserts on its unique LOWER(slug) index and the assignment
# is guarded by NOT EXISTS (+ the partial unique index on the active row).
echo "==> seeding entitlements fixture (assign plan 'e2e-pro-plan' to tenant A)"
if docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test >/dev/null 2>&1 <<SQL
WITH plan_upsert AS (
  INSERT INTO plans (slug, display_name, description, status, quota_dimensions, capabilities, created_by, updated_by)
  VALUES ('e2e-pro-plan', 'E2E Pro Plan', 'Seeded by tests/env/up.sh for the entitlements slice', 'active',
          '{"max_workspaces": 50}'::jsonb, '{}'::jsonb, 'e2e-seed', 'e2e-seed')
  ON CONFLICT (LOWER(slug)) DO NOTHING
  RETURNING id
),
resolved AS (
  SELECT id FROM plan_upsert
  UNION ALL
  SELECT id FROM plans WHERE LOWER(slug) = LOWER('e2e-pro-plan')
)
INSERT INTO tenant_plan_assignments (tenant_id, plan_id, assigned_by)
SELECT '$E2E_TENANT_ID', (SELECT id FROM resolved LIMIT 1), 'e2e-seed'
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_plan_assignments WHERE tenant_id = '$E2E_TENANT_ID' AND superseded_at IS NULL
);
SQL
then
  echo "   assigned plan e2e-pro-plan (max_workspaces=50) to tenant A"
else
  echo "   skipped plan assignment seed (tables missing or already assigned?)"
fi

# ---- plan change-history fixture (per-tenant plan-change audit trail) -------
# Give tenant A a realistic plan-change trail WITHOUT disturbing its ACTIVE plan
# (still e2e-pro-plan, so the entitlements assertions hold): seed a PRIOR,
# superseded 'e2e-starter-plan' assignment, then two tenant_plan_change_history
# rows (migration 100) — an 'initial_assignment' onto starter and an 'upgrade'
# starter -> pro (the upgrade row keys off the existing ACTIVE pro assignment).
# plan-change-history-query reads this table. Idempotent: plan upserts on its
# unique LOWER(slug) index, the prior assignment is guarded by NOT EXISTS, and
# the history rows ON CONFLICT (plan_assignment_id) DO NOTHING.
echo "==> seeding plan change-history fixture (starter -> pro upgrade trail for tenant A)"
if docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test >/dev/null 2>&1 <<SQL
INSERT INTO plans (slug, display_name, description, status, quota_dimensions, capabilities, created_by, updated_by)
VALUES ('e2e-starter-plan', 'E2E Starter Plan', 'Seeded prior plan for the change-history slice', 'active',
        '{"max_workspaces": 5}'::jsonb, '{}'::jsonb, 'e2e-seed', 'e2e-seed')
ON CONFLICT (LOWER(slug)) DO NOTHING;

INSERT INTO tenant_plan_assignments (tenant_id, plan_id, effective_from, superseded_at, assigned_by)
SELECT '$E2E_TENANT_ID', p.id, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', 'e2e-seed'
FROM plans p
WHERE LOWER(p.slug) = LOWER('e2e-starter-plan')
  AND NOT EXISTS (
    SELECT 1 FROM tenant_plan_assignments tpa WHERE tpa.tenant_id = '$E2E_TENANT_ID' AND tpa.plan_id = p.id
  );

INSERT INTO tenant_plan_change_history
  (plan_assignment_id, tenant_id, previous_plan_id, new_plan_id, actor_id, effective_at, change_direction, usage_collection_status, over_limit_dimension_count)
SELECT tpa.id, '$E2E_TENANT_ID', NULL, sp.id, 'e2e-seed', NOW() - INTERVAL '2 days', 'initial_assignment', 'complete', 0
FROM tenant_plan_assignments tpa
JOIN plans sp ON sp.id = tpa.plan_id AND LOWER(sp.slug) = LOWER('e2e-starter-plan')
WHERE tpa.tenant_id = '$E2E_TENANT_ID'
ON CONFLICT (plan_assignment_id) DO NOTHING;

INSERT INTO tenant_plan_change_history
  (plan_assignment_id, tenant_id, previous_plan_id, new_plan_id, actor_id, effective_at, change_direction, usage_collection_status, over_limit_dimension_count)
SELECT pro_a.id, '$E2E_TENANT_ID', sp.id, pp.id, 'e2e-seed', NOW() - INTERVAL '1 day', 'upgrade', 'complete', 0
FROM tenant_plan_assignments pro_a
JOIN plans pp ON pp.id = pro_a.plan_id AND LOWER(pp.slug) = LOWER('e2e-pro-plan')
JOIN plans sp ON LOWER(sp.slug) = LOWER('e2e-starter-plan')
WHERE pro_a.tenant_id = '$E2E_TENANT_ID' AND pro_a.superseded_at IS NULL
ON CONFLICT (plan_assignment_id) DO NOTHING;
SQL
then
  echo "   seeded change history (initial_assignment starter + upgrade starter->pro) for tenant A"
else
  echo "   skipped change-history seed (tables missing or already seeded?)"
fi

echo "==> provisioning Keycloak realm falcone-e2e (ROPC client + user + claim mappers)"
E2E_TENANT_ID="$E2E_TENANT_ID" E2E_WORKSPACE_ID="$E2E_WORKSPACE_ID" bash ./keycloak-e2e-provision.sh

echo "==> waiting for slice health (action-runner, apisix)"
for i in $(seq 1 40); do
  ar=$(docker compose ps action-runner --format '{{.Health}}' 2>/dev/null || true)
  ax=$(docker compose ps apisix --format '{{.Health}}' 2>/dev/null || true)
  [ "$ar" = "healthy" ] && [ "$ax" = "healthy" ] && break
  sleep 3
done
[ "${ar:-}" = "healthy" ] && [ "${ax:-}" = "healthy" ] \
  || { echo "slice services not healthy (action-runner=$ar apisix=$ax)" >&2; exit 1; }
echo "   action-runner + apisix healthy"

echo
echo "Test environment is UP."
echo "  Keycloak admin console : http://localhost:8081  (admin/admin)"
echo "  Postgres               : postgres://falcone:falcone@localhost:55432/falcone_test"
echo "  Redpanda (Kafka)       : localhost:19092"
echo "  FerretDB (document API): mongodb://falcone:falcone@localhost:57017/   (MONGO_BACKEND=ferretdb)"
echo "  SeaweedFS S3 API       : http://localhost:58333  (falconedev/falconedevsecret, path-style), bucket falcone-test"
echo "  OpenBao (dev)          : http://localhost:58200  (token root)"
echo "  OpenBao audit log (host): $(pwd)/openbao/audit/openbao-audit.log"
echo "  API gateway (APISIX)   : http://localhost:9080  (routes /v1/scheduling/*, /v1/async-operations[/{id}], /v1/admin/config/format-versions, /v1/plans, /v1/plans/change-history, /v1/quota-dimensions, /v1/tenant/entitlements, /v1/workspace-sub-quotas, /v1/backups/status)"
echo "                            NOTE /v1/backups/status authenticates IN-ACTION (plain proxy, no gateway jwt-auth): the backup-status action verifies the Bearer JWT itself against the realm JWKS and reads tenant+scopes from the token's own claims."
echo "                            backup_status_snapshots seeded with a tenant-A own row + a tenant-B SHARED row -> the smoke proves tenant A never sees tenant B's shared row (data-layer isolation), while a technical-scoped global view sees both."
echo "  action-runner shim     : http://localhost:8090  (/healthz, bypasses gateway)"
echo "  Keycloak realm (slice) : falcone-e2e  client=falcone-e2e-client users=e2e-user/e2e-password (tenant_owner), e2e-superadmin/e2e-superadmin-password (superadmin)"
echo
echo "Point a shell/test at it with:  source tests/env/env.sh"
echo "Run the HTTP-slice smoke with:  bash tests/env/e2e-smoke/run.sh"
