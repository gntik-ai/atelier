# Data Model: Effective Limit Resolution (105)

## Summary

This feature introduces one new PostgreSQL table (`workspace_sub_quotas`) and extends `effective-entitlements-repository.mjs` with two new resolution functions. All other tables referenced here (`quota_dimension_catalog`, `quota_overrides`, `plans`, `tenant_plan_assignments`, `boolean_capability_catalog`, `plan_audit_events`) are pre-existing from T01 (103) and T02 (104).

---

## New Table: `workspace_sub_quotas`

```sql
CREATE TABLE IF NOT EXISTS workspace_sub_quotas (
  id              UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       VARCHAR(255)  NOT NULL,
  workspace_id    VARCHAR(255)  NOT NULL,
  dimension_key   VARCHAR(64)   NOT NULL
                    REFERENCES quota_dimension_catalog(dimension_key)
                    ON DELETE RESTRICT,
  allocated_value INTEGER       NOT NULL CHECK (allocated_value >= 0),
  created_by      VARCHAR(255)  NOT NULL,
  updated_by      VARCHAR(255)  NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One allocation per workspace per dimension
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_sub_quota
  ON workspace_sub_quotas (tenant_id, workspace_id, dimension_key);

-- Efficient tenant-dimension sum queries (used in allocation check)
CREATE INDEX IF NOT EXISTS idx_wsq_tenant_dimension
  ON workspace_sub_quotas (tenant_id, dimension_key);

-- Efficient per-workspace lookups
CREATE INDEX IF NOT EXISTS idx_wsq_workspace
  ON workspace_sub_quotas (tenant_id, workspace_id);

-- Auto-update updated_at
CREATE TRIGGER trg_workspace_sub_quotas_updated_at
  BEFORE UPDATE ON workspace_sub_quotas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
```

### Constraints Summary

| Constraint | Details |
|-----------|---------|
| PK | `id` UUID |
| Unique | `(tenant_id, workspace_id, dimension_key)` — one sub-quota per workspace per dimension |
| FK | `dimension_key` → `quota_dimension_catalog(dimension_key)` — only recognized dimensions |
| CHECK | `allocated_value >= 0` — no negative allocations; `-1` rejected at action layer |
| Trigger | `updated_at` auto-updated via `set_updated_at_timestamp()` (shared trigger function) |

---

## Key Resolution Queries (computed views, not persisted)

### 1. Tenant Effective Quantitative Limits

Precedence: **active override → plan base limit → catalog platform default**

```sql
SELECT
  c.dimension_key,
  c.display_label,
  c.unit,
  COALESCE(
    o.override_value,
    (p.quota_dimensions ->> c.dimension_key)::int,
    c.default_value
  ) AS effective_value,
  CASE
    WHEN o.id IS NOT NULL           THEN 'override'
    WHEN p.quota_dimensions ? c.dimension_key THEN 'plan'
    ELSE                                 'catalog_default'
  END AS source,
  COALESCE(
    o.quota_type,
    (p.quota_type_config ->> c.dimension_key)::jsonb ->> 'type',
    'hard'
  ) AS quota_type,
  COALESCE(
    o.grace_margin,
    ((p.quota_type_config ->> c.dimension_key)::jsonb ->> 'graceMargin')::int,
    0
  ) AS grace_margin
FROM quota_dimension_catalog c
LEFT JOIN tenant_plan_assignments tpa
  ON tpa.tenant_id = $1 AND tpa.is_current = true
LEFT JOIN plans p
  ON p.id = tpa.plan_id
LEFT JOIN quota_overrides o
  ON o.tenant_id = $1
  AND o.dimension_key = c.dimension_key
  AND o.status = 'active'
  AND (o.expires_at IS NULL OR o.expires_at > NOW())
WHERE c.is_active = true
ORDER BY c.sort_order;
```

**Special values**:
- `effective_value = -1` → unlimited; downstream consumers skip quota check for this dimension
- `effective_value = 0` → fully blocked; no resources of this type permitted

### 2. Workspace Effective Limits (adds sub-quota layer)

```sql
SELECT
  ent.dimension_key,
  ent.display_label,
  ent.unit,
  ent.effective_value      AS tenant_effective_value,
  ent.source               AS tenant_source,
  ent.quota_type,
  ent.grace_margin,
  wsq.allocated_value      AS workspace_limit,
  CASE
    WHEN wsq.id IS NOT NULL THEN 'workspace_sub_quota'
    ELSE                         'tenant_shared_pool'
  END                      AS workspace_source,
  CASE
    WHEN wsq.id IS NOT NULL
     AND ent.effective_value <> -1
     AND wsq.allocated_value > ent.effective_value
    THEN true
    ELSE false
  END                      AS is_inconsistent
FROM (<tenant_effective_limits>) ent
LEFT JOIN workspace_sub_quotas wsq
  ON wsq.tenant_id = $1
  AND wsq.workspace_id = $2
  AND wsq.dimension_key = ent.dimension_key;
```

### 3. Sub-Quota Allocation Sum Check (inside SERIALIZABLE TX)

```sql
SELECT COALESCE(SUM(allocated_value), 0) AS allocated_sum
FROM workspace_sub_quotas
WHERE tenant_id = $1
  AND dimension_key = $2
  AND workspace_id <> $3   -- exclude target workspace (upsert: don't count current value)
FOR UPDATE;
-- Reject if: allocated_sum + newValue > tenantEffectiveValue AND tenantEffectiveValue <> -1
```

---

## Audit Events: `plan_audit_events` (extended)

New `action_type` values:

| action_type | Trigger | Key payload fields |
|------------|---------|-------------------|
| `quota.sub_quota.set` | Sub-quota created or updated | `tenant_id`, `workspace_id`, `dimension_key`, `previous_value` (null if new), `new_value`, `actor` |
| `quota.sub_quota.removed` | Sub-quota deleted | `tenant_id`, `workspace_id`, `dimension_key`, `previous_value`, `actor` |

---

## Kafka Topics (new, 30d retention)

| Topic | Description |
|-------|-------------|
| `console.quota.sub_quota.set` | Sub-quota created or modified (includes previous + new value) |
| `console.quota.sub_quota.removed` | Sub-quota removed; workspace reverts to shared pool |
| `console.quota.sub_quota.inconsistency_detected` | Workspace sub-quota exceeds tenant effective limit (warning) |

**Event envelope** (consistent with platform audit event pattern):

```json
{
  "eventId": "<uuid>",
  "topic": "console.quota.sub_quota.set",
  "timestamp": "2026-03-31T17:00:00.000Z",
  "tenantId": "acme-corp",
  "workspaceId": "ws-prod",
  "dimensionKey": "max_pg_databases",
  "previousValue": null,
  "newValue": 6,
  "actor": "user@example.com",
  "source": "workspace-sub-quota-set"
}
```

---

## Entity Relationships (this feature in context)

```text
quota_dimension_catalog ──< workspace_sub_quotas >── workspace (logical)
                        ──< quota_overrides       >── tenant
                        
plans ──< tenant_plan_assignments >── tenant
      └── quota_dimensions (JSONB)
      └── quota_type_config (JSONB)
      └── capabilities (JSONB) ──validated against── boolean_capability_catalog

Computed (not persisted):
  tenant_effective_entitlements = f(plans, quota_overrides, quota_dimension_catalog, boolean_capability_catalog)
  workspace_effective_limits    = f(tenant_effective_entitlements, workspace_sub_quotas)
```
