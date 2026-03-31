# Data Model — 098 Plan Base Limits

## quota_dimension_catalog

`quota_dimension_catalog` is the governed registry of quota dimensions recognized by the platform.

```sql
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
);
```

Indexes:
- `UNIQUE (dimension_key)`
- `idx_quota_dimension_catalog_key (dimension_key)`

Seeded dimensions:
- `max_workspaces`
- `max_pg_databases`
- `max_mongo_databases`
- `max_kafka_topics`
- `max_functions`
- `max_storage_bytes`
- `max_api_keys`
- `max_workspace_members`

## plans.quota_dimensions JSONB semantics

`plans.quota_dimensions` stores explicit plan-level overrides keyed by `dimension_key`.

Semantics:
- absent key → inherit `quota_dimension_catalog.default_value`
- `0` → explicit zero capacity
- positive integer → explicit bounded limit
- `-1` → unlimited sentinel

The repository layer validates that every written key exists in `quota_dimension_catalog`.

## plan_audit_events additions

New `action_type` values:
- `plan.limit.set`
- `plan.limit.removed`

Stored state payloads:
- `previous_state`: `{ dimensionKey, previousValue }`
- `new_state` on set: `{ dimensionKey, newValue }`
- `new_state` on remove: `{ dimensionKey, effectiveValue }`

Active-plan mutations are still written to PostgreSQL first so the durable audit record exists even if Kafka publication later fails.

## Kafka topic

Topic: `console.plan.limit_updated`

Retention target: 30 days.

Trigger:
- emitted only when a limit is set or removed on an `active` plan

Envelope:

```json
{
  "eventType": "console.plan.limit_updated",
  "correlationId": "<uuid>",
  "actorId": "<actor>",
  "tenantId": null,
  "planId": "<uuid>",
  "timestamp": "<ISO8601>",
  "previousState": { "dimensionKey": "max_workspaces", "previousValue": 5 },
  "newState": { "dimensionKey": "max_workspaces", "newValue": 10 }
}
```

## Unlimited sentinel decision

`-1` is the canonical unlimited marker because it is unambiguous, JSON-safe, and distinct from:
- `null` / missing → inheritance
- `0` → intentionally zero capacity

Downstream enforcement must not treat `-1` as a negative capacity. It means no upper bound.

## Default inheritance behavior

If a plan does not define a dimension key explicitly, profile reads compute the effective value from the current catalog default at read time. That means catalog default changes affect inherited values without rewriting every plan row.
