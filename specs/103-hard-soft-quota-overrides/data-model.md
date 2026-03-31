# Data Model: Hard & Soft Quotas with Superadmin Override

**Feature**: 103-hard-soft-quota-overrides | **Date**: 2026-03-31

## New Table: `quota_overrides`

Per-tenant, per-dimension exceptions to base plan limits.

```sql
CREATE TABLE quota_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR(255) NOT NULL,
  dimension_key   VARCHAR(64) NOT NULL
    REFERENCES quota_dimension_catalog(dimension_key),
  override_value  BIGINT NOT NULL CHECK (override_value >= -1),
  quota_type      VARCHAR(10) NOT NULL DEFAULT 'hard'
    CHECK (quota_type IN ('hard', 'soft')),
  grace_margin    INTEGER NOT NULL DEFAULT 0 CHECK (grace_margin >= 0),
  justification   TEXT NOT NULL CHECK (char_length(justification) > 0
    AND char_length(justification) <= 1000),
  expires_at      TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'revoked', 'expired')),
  created_by      VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by   UUID REFERENCES quota_overrides(id),
  revoked_by      VARCHAR(255),
  revoked_at      TIMESTAMPTZ,
  revocation_justification TEXT CHECK (
    revocation_justification IS NULL
    OR char_length(revocation_justification) <= 1000
  )
);

-- Enforces single active override per tenant per dimension
CREATE UNIQUE INDEX uq_active_override_per_tenant_dimension
  ON quota_overrides (tenant_id, dimension_key)
  WHERE status = 'active';

-- Efficient per-tenant active override lookups
CREATE INDEX idx_quota_overrides_tenant_status
  ON quota_overrides (tenant_id, status);

-- Efficient expiry sweep queries
CREATE INDEX idx_quota_overrides_expiry_sweep
  ON quota_overrides (status, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- Filter by dimension across tenants
CREATE INDEX idx_quota_overrides_dimension
  ON quota_overrides (dimension_key);
```

### Status Transitions

```text
active → superseded  (when a new override is created for same tenant+dimension)
active → revoked     (when a superadmin explicitly revokes)
active → expired     (when expires_at passes and sweep runs, or detected at query time)
```

No reverse transitions. Superseded/revoked/expired are terminal states.

### Sentinel Values

| Value | Meaning |
|-------|---------|
| `-1` | Unlimited — no quota check for this dimension |
| `0` | Explicitly zero capacity — hard block on any creation |
| `> 0` | Explicit positive limit |

## Extended Table: `plans` — New Column

```sql
ALTER TABLE plans
  ADD COLUMN quota_type_config JSONB NOT NULL DEFAULT '{}'::jsonb;
```

### `quota_type_config` Schema

Maps dimension keys to their quota type classification and grace margin:

```json
{
  "max_workspaces": { "type": "hard" },
  "max_kafka_topics": { "type": "soft", "graceMargin": 5 },
  "max_mongo_databases": { "type": "soft", "graceMargin": 2 }
}
```

**Rules**:
- Absent key → defaults to `{ "type": "hard" }` (FR-005)
- `graceMargin` is mandatory when `type = "soft"`, must be non-negative integer
- `graceMargin = 0` with `type = "soft"` → behaves as hard at runtime, classified as soft for reporting
- Every key must exist in `quota_dimension_catalog`
- Subject to same lifecycle mutation guard as `quota_dimensions`

## Extended Table: `plan_audit_events` — New Action Types

No DDL change. New `action_type` values:

| action_type | Trigger |
|-------------|---------|
| `quota.override.created` | New override created |
| `quota.override.modified` | Active override modified |
| `quota.override.revoked` | Override revoked by superadmin |
| `quota.override.expired` | Override expired (sweep or query-time) |
| `quota.override.superseded` | Override replaced by new one |
| `plan.quota_type.set` | Dimension quota type set/updated on plan |

## Effective Limit Resolution

Resolution order (first non-null wins):

1. **Active override** (`quota_overrides` WHERE `status = 'active'` AND `(expires_at IS NULL OR expires_at > NOW())`)
2. **Plan explicit value** (`plans.quota_dimensions->>dimension_key`)
3. **Catalog default** (`quota_dimension_catalog.default_value`)

Quota type resolution follows the same hierarchy:

1. **Override quota type** (`quota_overrides.quota_type`)
2. **Plan quota type config** (`plans.quota_type_config->>dimension_key->>'type'`)
3. **Default**: `hard`

Grace margin resolution:

1. **Override grace margin** (`quota_overrides.grace_margin`)
2. **Plan grace margin** (`plans.quota_type_config->>dimension_key->>'graceMargin'`)
3. **Default**: `0`

### Resolution Query

```sql
SELECT
  c.dimension_key,
  c.display_label,
  c.unit,
  COALESCE(
    o.override_value,
    (p.quota_dimensions->>c.dimension_key)::bigint,
    c.default_value
  ) AS effective_value,
  CASE
    WHEN o.id IS NOT NULL THEN 'override'
    WHEN p.quota_dimensions ? c.dimension_key THEN 'plan'
    ELSE 'default'
  END AS source,
  COALESCE(
    o.quota_type,
    (p.quota_type_config->c.dimension_key->>'type'),
    'hard'
  ) AS effective_quota_type,
  COALESCE(
    o.grace_margin,
    ((p.quota_type_config->c.dimension_key->>'graceMargin')::int),
    0
  ) AS effective_grace_margin,
  o.id AS override_id,
  o.expires_at AS override_expires_at,
  o.justification AS override_justification
FROM quota_dimension_catalog c
LEFT JOIN plans p ON p.id = (
  SELECT plan_id FROM tenant_plan_assignments
  WHERE tenant_id = $1 AND is_current = true
)
LEFT JOIN quota_overrides o
  ON o.tenant_id = $1
  AND o.dimension_key = c.dimension_key
  AND o.status = 'active'
  AND (o.expires_at IS NULL OR o.expires_at > NOW())
ORDER BY c.dimension_key;
```

## Enforcement Decision Logic

```text
function enforce(effectiveValue, quotaType, graceMargin, currentUsage):
  if effectiveValue == -1:
    return { allowed: true, decision: "unlimited" }

  if quotaType == "hard":
    if currentUsage >= effectiveValue:
      return { allowed: false, decision: "hard_blocked" }
    return { allowed: true, decision: "allowed" }

  if quotaType == "soft":
    ceiling = effectiveValue + graceMargin
    if currentUsage >= ceiling:
      return { allowed: false, decision: "soft_grace_exhausted" }
    if currentUsage >= effectiveValue:
      return { allowed: true, decision: "soft_grace_allowed", warning: "..." }
    return { allowed: true, decision: "allowed" }
```

## Kafka Topics

| Topic | Retention | Schema Key Fields |
|-------|-----------|-------------------|
| `console.quota.override.created` | 30d | tenantId, dimensionKey, overrideValue, quotaType, justification |
| `console.quota.override.modified` | 30d | tenantId, dimensionKey, previousState, newState |
| `console.quota.override.revoked` | 30d | tenantId, dimensionKey, revokedValue, justification |
| `console.quota.override.expired` | 30d | tenantId, dimensionKey, expiredValue |
| `console.quota.hard_limit.blocked` | 30d | tenantId, workspaceId, dimensionKey, currentUsage, effectiveLimit |
| `console.quota.soft_limit.exceeded` | 30d | tenantId, workspaceId, dimensionKey, currentUsage, effectiveLimit, graceMargin |

## Migration File

`services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql`

Applies after `098-plan-base-limits.sql`. Contains:
1. `ALTER TABLE plans ADD COLUMN quota_type_config ...`
2. `CREATE TABLE quota_overrides ...`
3. All indexes listed above
