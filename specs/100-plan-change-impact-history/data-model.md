# Data model — 100-plan-change-impact-history

## Core entities

### PlanChangeHistoryEntry

Immutable header record for one committed tenant plan change.

- `id`: UUID
- `planAssignmentId`: UUID of the new committed assignment row
- `tenantId`: tenant identifier
- `previousPlanId`: nullable UUID when the tenant had no prior plan
- `newPlanId`: UUID
- `actorId`: identifier of the initiating operator or service principal
- `effectiveAt`: timestamp when the new assignment became effective
- `correlationId`: trace/correlation identifier
- `changeReason`: optional business reason or source metadata
- `changeDirection`: `upgrade | downgrade | lateral | equivalent | initial_assignment`
- `usageCollectionStatus`: `complete | partial | unavailable`
- `overLimitDimensionCount`: integer
- `quotaDimensionCount`: integer
- `capabilityCount`: integer
- `createdAt`: persistence timestamp

### QuotaImpactLineItem

Point-in-time per-dimension comparison within a history entry.

- `historyEntryId`
- `dimensionKey`
- `displayLabel`
- `unit`
- `previousEffectiveValueKind`: `bounded | unlimited | missing`
- `previousEffectiveValue`: nullable integer/string depending on representation
- `newEffectiveValueKind`: `bounded | unlimited | missing`
- `newEffectiveValue`: nullable integer/string depending on representation
- `comparison`: `increased | decreased | unchanged | added | removed`
- `observedUsage`: nullable integer
- `usageObservedAt`: nullable timestamp
- `usageSource`: nullable string
- `usageStatus`: `within_limit | at_limit | over_limit | unknown`
- `usageUnknownReason`: nullable enum/text
- `isHardDecrease`: boolean helper flag for UI/analytics

### CapabilityImpactLineItem

Point-in-time per-capability comparison within a history entry.

- `historyEntryId`
- `capabilityKey`
- `displayLabel`
- `previousState`: boolean or nullable when previously absent
- `newState`: boolean or nullable when removed/unsupported
- `comparison`: `enabled | disabled | unchanged`

### CurrentEffectiveEntitlementSummary

Live read model for the tenant-owner and superadmin summary endpoint.

- `tenantId`
- `currentAssignmentId`
- `planId`
- `planSlug`
- `planDisplayName`
- `effectiveFrom`
- `latestHistoryEntryId`
- `latestPlanChangeAt`
- `quotaDimensions[]`: current effective value + usage status rows
- `capabilities[]`: current effective capability rows

## Suggested PostgreSQL tables

### `tenant_plan_change_history`

Header table.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `plan_assignment_id` | `UUID` | NOT NULL, UNIQUE, FK → `tenant_plan_assignments(id)` |
| `tenant_id` | `VARCHAR(255)` | NOT NULL |
| `previous_plan_id` | `UUID` | nullable, FK → `plans(id)` |
| `new_plan_id` | `UUID` | NOT NULL, FK → `plans(id)` |
| `actor_id` | `VARCHAR(255)` | NOT NULL |
| `effective_at` | `TIMESTAMPTZ` | NOT NULL |
| `correlation_id` | `VARCHAR(255)` | nullable |
| `change_reason` | `TEXT` | nullable |
| `change_direction` | `VARCHAR(32)` | NOT NULL |
| `usage_collection_status` | `VARCHAR(32)` | NOT NULL |
| `over_limit_dimension_count` | `INTEGER` | NOT NULL DEFAULT 0 |
| `quota_dimension_count` | `INTEGER` | NOT NULL |
| `capability_count` | `INTEGER` | NOT NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT NOW() |

**Indexes**:
- `(tenant_id, effective_at DESC, id DESC)`
- `(actor_id, effective_at DESC)`
- `(correlation_id)`
- optional `(new_plan_id, effective_at DESC)` for analytics

### `tenant_plan_quota_impacts`

Immutable per-dimension rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PK |
| `history_entry_id` | `UUID` | NOT NULL, FK → `tenant_plan_change_history(id)` ON DELETE CASCADE |
| `dimension_key` | `VARCHAR(128)` | NOT NULL |
| `display_label` | `VARCHAR(255)` | NOT NULL |
| `unit` | `VARCHAR(64)` | NOT NULL |
| `previous_value_kind` | `VARCHAR(32)` | NOT NULL |
| `previous_value` | `BIGINT` | nullable |
| `new_value_kind` | `VARCHAR(32)` | NOT NULL |
| `new_value` | `BIGINT` | nullable |
| `comparison` | `VARCHAR(32)` | NOT NULL |
| `observed_usage` | `BIGINT` | nullable |
| `usage_observed_at` | `TIMESTAMPTZ` | nullable |
| `usage_source` | `VARCHAR(128)` | nullable |
| `usage_status` | `VARCHAR(32)` | NOT NULL |
| `usage_unknown_reason` | `VARCHAR(128)` | nullable |
| `is_hard_decrease` | `BOOLEAN` | NOT NULL DEFAULT false |

**Indexes**:
- `(history_entry_id, dimension_key)` UNIQUE
- `(history_entry_id, usage_status)`
- `(dimension_key, usage_status, history_entry_id)` for downgrade analytics

### `tenant_plan_capability_impacts`

Immutable per-capability rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PK |
| `history_entry_id` | `UUID` | NOT NULL, FK → `tenant_plan_change_history(id)` ON DELETE CASCADE |
| `capability_key` | `VARCHAR(128)` | NOT NULL |
| `display_label` | `VARCHAR(255)` | NOT NULL |
| `previous_state` | `BOOLEAN` | nullable |
| `new_state` | `BOOLEAN` | nullable |
| `comparison` | `VARCHAR(32)` | NOT NULL |

**Indexes**:
- `(history_entry_id, capability_key)` UNIQUE

## Query/read model notes

### History query ordering

Use:
- primary sort: `effective_at DESC`
- tiebreaker: `id DESC`

This guarantees stable pagination even when multiple plan changes happen close together.

### Current entitlement summary computation

Derive current summary from:
1. current `tenant_plan_assignments` row,
2. resolved plan limits (`plans.quota_dimensions` + `quota_dimension_catalog.default_value`),
3. supported tenant-specific adjustments/overrides,
4. current observed usage by dimension.

The response should optionally include `latestHistoryEntryId` and `latestPlanChangeAt` to let the UI link current state to the most recent historical record.

## Event payload reference

### `console.plan.change-impact-recorded`

```json
{
  "eventType": "console.plan.change-impact-recorded",
  "historyEntryId": "uuid",
  "planAssignmentId": "uuid",
  "tenantId": "acme-corp",
  "previousPlanId": "uuid-or-null",
  "newPlanId": "uuid",
  "actorId": "superadmin:user-123",
  "effectiveAt": "2026-03-31T09:40:00Z",
  "correlationId": "corr-123",
  "changeDirection": "downgrade",
  "usageCollectionStatus": "partial",
  "overLimitDimensionCount": 2,
  "quotaDimensionCount": 8,
  "capabilityCount": 5
}
```

The Kafka event is intentionally summary-level; detailed line items remain queryable from PostgreSQL/API reads.
