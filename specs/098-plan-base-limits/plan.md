# Implementation Plan: Plan Base Limits Definition

**Branch**: `098-plan-base-limits` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-PLAN-01-T02 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment`)  
**Input**: Feature specification from `specs/098-plan-base-limits/spec.md`

## Summary

Define, govern, and expose **base limits per plan** across every quota dimension the platform supports: workspaces, PostgreSQL databases, MongoDB databases, Kafka topics, serverless functions, storage, API keys, and workspace memberships. This task introduces a **Quota Dimension Catalog** (governed registry of recognized dimension keys), extends the existing `plans.quota_dimensions` JSONB with lifecycle-aware mutation actions and catalog validation, and exposes read-only limit profiles to superadmins and tenant owners. Enforcement of limits against actual resource consumption, tenant-level overrides, and UI screens are explicitly out of scope.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (established in `services/provisioning-orchestrator`)  
**Storage**: PostgreSQL — new `quota_dimension_catalog` table; extends existing `plans.quota_dimensions` JSONB (from T01)  
**Testing**: `node:test` (Node 20 native), `node:assert`, `pg` (fixture queries), `kafkajs` (event verification), `undici` (HTTP contract tests)  
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless  
**Performance Goals**: Catalog listing of all dimensions < 50 ms p95; full limit profile for any plan < 50 ms p95; catalog supports ≥50 dimension entries (SC-007)  
**Constraints**: Multi-tenant isolation at query level; lifecycle-aware mutation guard; all active-plan mutations audited; unlimited sentinel = `-1`; absent key = inherits catalog default  
**Scale/Scope**: ≥100 plans each with explicit values for all 8 initial dimensions (SC-007)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | All new logic under `services/provisioning-orchestrator`; migration in `src/migrations/`; contracts in `specs/098-plan-base-limits/contracts/` |
| II. Incremental Delivery | ✅ PASS | Delivers catalog + limit mutation + profile query only; enforcement deferred to US-PLAN-02 |
| III. K8s / OpenShift Compatibility | ✅ PASS | No new Helm charts; existing `provisioning-orchestrator` deployment pattern applies |
| IV. Quality Gates | ✅ PASS | New `node:test` integration tests; root CI scripts updated |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, data-model.md, contracts/, quickstart.md, and migration SQL constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new frameworks introduced.

## Project Structure

### Documentation (this feature)

```text
specs/098-plan-base-limits/
├── plan.md              ← This file (Phase 2 planning output)
├── spec.md              ← Feature specification (already materialized)
├── data-model.md        ← Phase 1 output (entities, DDL, catalog seed data)
├── quickstart.md        ← Phase 1 output (local dev and test execution)
└── contracts/
    ├── quota-dimension-catalog-list.json   ← List all catalog entries
    ├── plan-limits-set.json                ← Set/update a dimension limit on a plan
    ├── plan-limits-remove.json             ← Remove explicit limit (revert to default)
    ├── plan-limits-profile-get.json        ← Full profile for any plan (superadmin)
    └── plan-limits-tenant-get.json         ← Profile for tenant's current plan (tenant owner)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── quota-dimension-catalog-list.mjs   ← NEW: list all catalog entries
│   │   ├── plan-limits-set.mjs                ← NEW: set/update a base limit (lifecycle-aware)
│   │   ├── plan-limits-remove.mjs             ← NEW: remove explicit limit (revert to default)
│   │   ├── plan-limits-profile-get.mjs        ← NEW: full profile query (superadmin)
│   │   └── plan-limits-tenant-get.mjs         ← NEW: tenant's own plan limits (tenant owner)
│   ├── models/
│   │   └── quota-dimension.mjs                ← NEW: QuotaDimension entity model + catalog validation helpers
│   ├── repositories/
│   │   ├── quota-dimension-catalog-repository.mjs  ← NEW: CRUD + list for catalog entries
│   │   └── plan-limits-repository.mjs              ← NEW: lifecycle-aware get/set/remove on plans.quota_dimensions
│   ├── events/
│   │   └── plan-limit-events.mjs              ← NEW: Kafka events for active-plan limit mutations
│   └── migrations/
│       └── 098-plan-base-limits.sql           ← NEW: quota_dimension_catalog DDL + seed data

tests/
└── integration/
    └── 098-plan-base-limits/
        ├── fixtures/
        │   ├── seed-catalog.mjs           ← ensure catalog is seeded before tests
        │   └── seed-plans.mjs             ← create draft/active/deprecated plans for test scenarios
        ├── catalog.test.mjs               ← FR-001, FR-002, FR-004, FR-012, FR-015, SC-005, SC-007
        ├── plan-limits-set.test.mjs       ← FR-003, FR-004, FR-005, FR-006, FR-008, FR-014, SC-001, SC-004
        ├── plan-limits-profile.test.mjs   ← FR-007, FR-009, FR-010, SC-002, SC-003
        ├── plan-limits-audit.test.mjs     ← FR-011, SC-004
        └── plan-limits-isolation.test.mjs ← FR-013, SC-003
```

**Structure Decision**: Extends `services/provisioning-orchestrator` following the established pattern from 073, 075, 089, 092, 093, 096, and 097. The `plans.quota_dimensions` JSONB column introduced in T01 is repurposed as the live store of explicit base limit values validated against the new catalog.

---

## Phase 0: Research Findings

### R-01 — Base Limit Storage: Normalized Table vs JSONB Extension

**Decision**: Keep `plans.quota_dimensions JSONB` (introduced in T01) as the authoritative store for explicit base limit values. Add a new `quota_dimension_catalog` table as the governed registry.  
**Rationale**: T01 explicitly designed `quota_dimensions` as a `string → number` map (R-05 from 097 plan). Introducing a normalized junction table `plan_base_limits(plan_id, dimension_key, value)` would require dual-write coordination. Instead, catalog-key validation is applied at the action/repository layer before every JSONB write. Profile queries compute explicit vs default distinction at query time by comparing JSONB keys against the catalog.  
**Alternatives considered**: Normalized `plan_base_limits` table (rejected: dual-write complexity, migration needed to migrate existing data from T01's JSONB); separate `plan_limits` JSONB column (rejected: redundant; `quota_dimensions` already serves the purpose).

### R-02 — Unlimited Sentinel Representation

**Decision**: Use `-1` (integer negative one) as the canonical "unlimited" sentinel. Zero means "explicitly zero capacity." Absent key (not present in `quota_dimensions` JSONB) means "inherit catalog default."  
**Rationale**: `-1` is unambiguous and JSON-safe. SQL `NULL` inside JSONB is ambiguous. A separate boolean flag per dimension adds schema complexity. `-1` is a widely understood sentinel in quota systems.  
**Alternatives considered**: `null` JSONB value (rejected: ambiguous — does null mean unlimited or missing?); separate `unlimited_dimensions TEXT[]` array on plans (rejected: adds a second column to keep in sync); `9999999` magic number (rejected: not semantically clear).

### R-03 — Lifecycle-Aware Mutation Guard

**Decision**: The mutation guard is applied at the repository layer (`plan-limits-repository.mjs`) by reading plan status before any write. Status is read inside the same PostgreSQL transaction (`BEGIN ... SELECT plans FOR UPDATE ... UPDATE ... COMMIT`).  
**Rationale**: Applying the guard at the action layer only is insufficient — concurrent requests could pass the status check but race to mutate. The T01 `SELECT FOR UPDATE` pattern established for concurrent assignment is reused here.  
**Rule**: `draft` → unrestricted; `active` → allowed with mandatory audit event; `deprecated`/`archived` → rejected with `409 PLAN_LIMITS_FROZEN`.

### R-04 — Audit Event Strategy for Limit Changes

**Decision**: Reuse the existing `plan_audit_events` table (introduced in T01) with a new `action_type` value: `plan.limit.set` and `plan.limit.removed`. Emit a Kafka event to a new topic `console.plan.limit_updated` (30d retention) for `active` plan mutations only.  
**Rationale**: `plan_audit_events` is the established queryable audit log. The new Kafka topic keeps limit-related events separated from plan-lifecycle events for downstream consumers.  
**Draft plan mutations**: Written to `plan_audit_events` only in `action_type = plan.limit.set|removed` rows, but **no Kafka event** is emitted for draft-plan mutations (FR-005: no audit event requirement for draft plans).

### R-05 — Catalog Seeding Strategy

**Decision**: The 8 initial dimension entries (FR-002) are seeded via `INSERT ... ON CONFLICT DO NOTHING` in the migration file `098-plan-base-limits.sql`. This ensures idempotent re-runs.  
**Initial default values**:

| Dimension Key | Default Value | Unit |
|---------------|---------------|------|
| `max_workspaces` | `3` | count |
| `max_pg_databases` | `5` | count |
| `max_mongo_databases` | `2` | count |
| `max_kafka_topics` | `10` | count |
| `max_functions` | `50` | count |
| `max_storage_bytes` | `5368709120` (5 GiB) | bytes |
| `max_api_keys` | `20` | count |
| `max_workspace_members` | `10` | count |

**Rationale**: These defaults match the "starter" scenario used in the spec's acceptance criteria (US-1 scenario 1).

### R-06 — Read-Only Profile Computation

**Decision**: The "Plan Limit Profile" is computed at query time with a single SQL join: `SELECT c.dimension_key, c.display_label, c.unit, c.default_value, p.quota_dimensions->c.dimension_key AS explicit_value FROM quota_dimension_catalog c LEFT JOIN plans p ON p.id = $planId`.  
**Rationale**: No materialized view needed given ≤50 dimensions and sub-50ms goal. Simple join is transparent and low-maintenance.  
**Explicit vs default indication**: `explicit_value IS NOT NULL` → explicit; `IS NULL` → inherited default. Both cases include the effective value in the response.

### R-07 — No New Infrastructure

**Decision**: One new Kafka topic (`console.plan.limit_updated`, 30d); no new Helm charts; reuse existing `provisioning-orchestrator` deployment.  
**Rationale**: Incremental delivery (Constitution Principle II).

---

## Phase 1: Data Model

### New Entity: `quota_dimension_catalog`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Stable identifier |
| `dimension_key` | `VARCHAR(64)` | NOT NULL, UNIQUE | e.g., `max_workspaces` |
| `display_label` | `VARCHAR(255)` | NOT NULL | e.g., `"Maximum Workspaces"` |
| `unit` | `VARCHAR(20)` | NOT NULL, CHECK IN (`count`, `bytes`) | Measure unit |
| `default_value` | `BIGINT` | NOT NULL, CHECK >= -1 | Platform default; -1 = unlimited by default |
| `description` | `TEXT` | | Nullable, for operator reference |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | Via trigger |
| `created_by` | `VARCHAR(255)` | NOT NULL, DEFAULT `'system'` | |

**Indexes**:
- UNIQUE on `dimension_key`
- INDEX on `dimension_key` for fast catalog validation lookups

**Seeded on migration** (8 entries per R-05 table above, `created_by = 'system'`).

### Extended Entity: `plans` (from T01)

No DDL change. The `quota_dimensions JSONB` column already present is repurposed:

- **Semantics formalized**: `quota_dimensions` is now a validated map of `dimension_key → BIGINT` where:
  - Absent key → inherit `quota_dimension_catalog.default_value`
  - Value `= -1` → unlimited for that dimension on this plan
  - Value `= 0` → zero allocation (explicitly no capacity)
  - Value `> 0` → explicit positive limit
- **Mutation guard**: action layer enforces lifecycle rules before any write
- **Validation**: every key written must exist in `quota_dimension_catalog`

### Extended Entity: `plan_audit_events` (from T01)

No DDL change. Two new `action_type` values:

| action_type | Trigger | previous_state | new_state |
|-------------|---------|----------------|-----------|
| `plan.limit.set` | dimension added or updated on any plan | `{ dimensionKey, previousValue }` or `{ dimensionKey, previousValue: null }` | `{ dimensionKey, newValue }` |
| `plan.limit.removed` | explicit limit removed (reverts to default) | `{ dimensionKey, previousValue }` | `{ dimensionKey, effectiveValue: <catalog default> }` |

Rows are written for **all** lifecycle states. Kafka events are emitted **only for `active` plan mutations** (FR-005, FR-011).

### Kafka Topics

| Topic | Retention | Trigger |
|-------|-----------|---------|
| `console.plan.limit_updated` | 30d | Base limit set or removed on an `active` plan |

Kafka event envelope (follows platform audit event pattern from T01):

```json
{
  "eventType": "console.plan.limit_updated",
  "correlationId": "<uuid>",
  "actorId": "<actor>",
  "tenantId": null,
  "planId": "<uuid>",
  "timestamp": "<ISO8601>",
  "previousState": {
    "dimensionKey": "max_workspaces",
    "previousValue": 5
  },
  "newState": {
    "dimensionKey": "max_workspaces",
    "newValue": 10
  }
}
```

---

## Phase 1: Action Contracts (Summary)

Full JSON contract files are generated in `specs/098-plan-base-limits/contracts/`.

### `quota-dimension-catalog-list`

- **Auth**: superadmin JWT
- **Input**: `{}` (no pagination needed — catalog is bounded)
- **Output (200)**:

  ```json
  {
    "dimensions": [
      {
        "dimensionKey": "max_workspaces",
        "displayLabel": "Maximum Workspaces",
        "unit": "count",
        "defaultValue": 3,
        "description": "..."
      }
    ],
    "total": 8
  }
  ```

- **Errors**: `403 FORBIDDEN`

### `plan-limits-set`

- **Auth**: superadmin JWT
- **Input**: `{ planId, dimensionKey, value }` — `value` must be a non-negative integer or `-1` (unlimited)
- **Lifecycle guard**: Rejected if plan status is `deprecated` or `archived`
- **Catalog guard**: Rejected if `dimensionKey` not in `quota_dimension_catalog`
- **Value guard**: Rejected if `value < -1` or non-integer
- **Output (200)**:

  ```json
  {
    "planId": "<uuid>",
    "dimensionKey": "max_workspaces",
    "previousValue": 5,
    "newValue": 10,
    "source": "explicit"
  }
  ```

- **Errors**: `404 PLAN_NOT_FOUND`, `409 PLAN_LIMITS_FROZEN`, `400 INVALID_DIMENSION_KEY`, `400 INVALID_LIMIT_VALUE`, `403 FORBIDDEN`

### `plan-limits-remove`

- **Auth**: superadmin JWT
- **Input**: `{ planId, dimensionKey }`
- **Lifecycle guard**: Rejected if plan status is `deprecated` or `archived`
- **Catalog guard**: Rejected if `dimensionKey` not in catalog
- **Output (200)**:

  ```json
  {
    "planId": "<uuid>",
    "dimensionKey": "max_workspaces",
    "removedValue": 10,
    "effectiveValue": 3,
    "source": "default"
  }
  ```

- **Errors**: `404 PLAN_NOT_FOUND`, `409 PLAN_LIMITS_FROZEN`, `400 INVALID_DIMENSION_KEY`, `404 LIMIT_NOT_SET`, `403 FORBIDDEN`

### `plan-limits-profile-get`

- **Auth**: superadmin JWT
- **Input**: `{ planId }`
- **Output (200)**: Full computed profile across all catalog dimensions:

  ```json
  {
    "planId": "<uuid>",
    "planSlug": "starter",
    "planStatus": "active",
    "profile": [
      {
        "dimensionKey": "max_workspaces",
        "displayLabel": "Maximum Workspaces",
        "unit": "count",
        "effectiveValue": 3,
        "source": "explicit",
        "unlimitedSentinel": false
      },
      {
        "dimensionKey": "max_functions",
        "displayLabel": "Maximum Functions",
        "unit": "count",
        "effectiveValue": 50,
        "source": "default",
        "unlimitedSentinel": false
      }
    ]
  }
  ```

- **Errors**: `404 PLAN_NOT_FOUND`, `403 FORBIDDEN`

### `plan-limits-tenant-get`

- **Auth**: Tenant owner JWT (reads own tenant's current plan only)
- **Input**: `{ tenantId }` (from JWT claim; action validates caller owns the tenant)
- **Output (200)**:

  ```json
  {
    "tenantId": "acme-corp",
    "planSlug": "professional",
    "planStatus": "active",
    "profile": [
      {
        "dimensionKey": "max_workspaces",
        "displayLabel": "Maximum Workspaces",
        "unit": "count",
        "effectiveValue": 10,
        "source": "explicit",
        "unlimitedSentinel": false
      }
    ]
  }
  ```

- **No-plan case**: `{ "tenantId": "acme-corp", "noAssignment": true, "profile": [] }`
- **Isolation**: Action validates `tenantId` matches JWT; returns `403 FORBIDDEN` otherwise
- **Errors**: `403 FORBIDDEN`, `404 TENANT_NOT_FOUND`

---

## Testing Strategy

### Unit Tests

- `quota-dimension.mjs` model: valid dimension key format (alphanumeric + underscores), value validation (`-1`, `0`, positive integer accepted; negative other than `-1` rejected; floats rejected), `isUnlimited()` helper, `isInherited()` helper

### Integration Tests (node:test)

#### `catalog.test.mjs`

- Catalog list returns all 8 seeded dimensions with correct keys, labels, units, defaults (FR-001, FR-002, FR-015)
- Catalog is queryable and returns consistent structure for comparison across plans (US-2)
- Attempting `plan-limits-set` with an unrecognized key returns `400 INVALID_DIMENSION_KEY` (FR-004, SC-005)
- Catalog supports adding a 9th dimension without affecting existing plans (FR-012)

#### `plan-limits-set.test.mjs`

- Set explicit limit on draft plan: persisted, no Kafka event emitted (FR-003, FR-005)
- Set explicit limit on active plan: persisted, Kafka event emitted on `console.plan.limit_updated` (FR-003, FR-005, FR-011)
- Update existing limit on active plan: previous value captured in audit event (FR-011)
- Attempt set on deprecated plan: `409 PLAN_LIMITS_FROZEN` (FR-006)
- Attempt set on archived plan: `409 PLAN_LIMITS_FROZEN` (FR-006)
- Set `value: -1` (unlimited): accepted and stored (FR-008)
- Set `value: 0` (zero capacity): accepted and stored (FR-014)
- Set `value: -2` (invalid negative): `400 INVALID_LIMIT_VALUE` (FR-014)
- Set `value: 1.5` (float): `400 INVALID_LIMIT_VALUE` (FR-014)
- Concurrent set for same plan/dimension: exactly one value wins; no partial update (R-03)

#### `plan-limits-profile.test.mjs`

- Full profile for plan with all 8 explicit limits: all 8 dimensions returned with `source: "explicit"` (FR-009, SC-002)
- Profile for plan with 0 explicit limits: all 8 dimensions returned with `source: "default"` and catalog default values (FR-007)
- Profile for plan with mix: explicit dimensions show correct values, absent dimensions show catalog defaults (FR-007, FR-009)
- Profile includes `unlimitedSentinel: true` where `effectiveValue = -1` (FR-008)
- Superadmin can query profile for any plan regardless of tenant (FR-013)
- Tenant owner can query own plan's limits (FR-010, SC-003)
- Tenant owner cannot query another tenant's plan limits (FR-013, SC-003)
- Tenant with no plan assigned returns `noAssignment: true` (US-3 scenario 2)

#### `plan-limits-audit.test.mjs`

- Every `plan-limits-set` on active plan produces `plan_audit_events` row with correct `action_type`, `previous_state`, `new_state`, `actor_id`, `correlation_id` (FR-011, SC-004)
- Every `plan-limits-remove` on active plan produces `plan_audit_events` row + Kafka event (FR-011, SC-004)
- Mutations on draft plan produce `plan_audit_events` row but NO Kafka event (FR-005)

#### `plan-limits-isolation.test.mjs`

- JWT for tenant A cannot query plan limits for tenant B (FR-013, SC-003)
- Tenant owner sees no internal metadata (no `created_by`, no `actor_id` fields) in profile response (FR-010)

### Contract Tests

- Validate OpenWhisk action response shapes against JSON schemas in `contracts/`
- Verify error codes for all rejection scenarios

### Observability Validation

- Kafka event emission verified in integration tests via `kafkajs` consumer with 5s timeout
- `plan_audit_events` rows verified via `pg` direct query assertions

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Race between status check and quota_dimensions write allows mutation on frozen plan | Low | Medium | `SELECT FOR UPDATE` on `plans` row inside write transaction (R-03) |
| `quota_dimensions` JSONB key drift from catalog (keys set outside of actions) | Low | Medium | Repository layer is the single write path; no raw JSONB updates permitted; catalog validation applied at repository not only at action |
| Kafka publish failure after DB commit (active plan audit loss) | Low | Low | Fire-and-forget (platform pattern); `plan_audit_events` row is committed first, Kafka failure does not roll back |
| Platform default changes affecting plans using inherited values | Low | Medium | Document behavior in `quickstart.md`; defaults only change via catalog update (operator action); no silent re-computation at write time |
| Unlimited sentinel (`-1`) misinterpreted by enforcement layer | Medium | High | `source: "explicit"` + `unlimitedSentinel: true` flag in all profile responses; document in `data-model.md`; enforcement layer (US-PLAN-02) must check flag |
| `quota_dimensions` JSONB accepts arbitrary extra keys from T01 `plan-update` action | Medium | Medium | `plan-update` (T01) already accepts freeform JSONB — coordinate with T01 owners to add catalog validation to `plan-update` as a follow-on patch, or suppress unrecognized keys silently |

---

## Dependencies & Sequencing

### Prerequisites

- **US-PLAN-01-T01** (`097-plan-entity-tenant-assignment`): `plans` table, `plan_audit_events` table, `tenant_plan_assignments` table, `plan-events.mjs`, and `plan-assignment-get` action must be in place. This migration runs after `097`.
- **Migration ordering**: `098-plan-base-limits.sql` must run after `097-plan-entity-tenant-assignment.sql`.

### Parallelizable Work

- `quota_dimension_catalog` DDL + seed migration can be developed in parallel with catalog repository and action
- Limit profile query (read-only) can be developed in parallel with limit mutation actions
- Contract JSON files and integration test fixtures can be prepared before actions are complete

### Recommended Implementation Sequence

1. Write and apply migration `098-plan-base-limits.sql` (new table + 8 seed entries)
2. Implement `quota-dimension.mjs` model + `quota-dimension-catalog-repository.mjs`
3. Implement `quota-dimension-catalog-list.mjs` action
4. Implement `plan-limits-repository.mjs` (lifecycle-aware read/set/remove on `plans.quota_dimensions`)
5. Implement `plan-limit-events.mjs` (Kafka emit for active-plan mutations)
6. Implement `plan-limits-set.mjs` and `plan-limits-remove.mjs` actions
7. Implement `plan-limits-profile-get.mjs` and `plan-limits-tenant-get.mjs` actions
8. Write contract JSON files in `specs/098-plan-base-limits/contracts/`
9. Write integration tests; run against local PostgreSQL + Kafka fixtures
10. Update `AGENTS.md` with new env vars and Kafka topic

### New Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAN_LIMITS_KAFKA_TOPIC_UPDATED` | `console.plan.limit_updated` | Kafka topic for base limit mutations on active plans |
| `PLAN_LIMITS_LOCK_TIMEOUT_MS` | `5000` | Timeout for `SELECT FOR UPDATE` on plan row during limit mutation |

---

## Criteria of Done

| ID | Criterion | Evidence |
|----|-----------|---------|
| DOD-01 | Migration `098-plan-base-limits.sql` applied cleanly to a fresh DB (after 097) | `psql` schema dump shows `quota_dimension_catalog` table with 8 seeded rows |
| DOD-02 | `quota-dimension-catalog-list` returns all 8 initial dimensions with correct keys, labels, units, defaults | `catalog.test.mjs` assertion |
| DOD-03 | `plan-limits-set` persists limits for all 8 dimensions on a plan in a single session, each operation < 5s (SC-001) | Integration test timing |
| DOD-04 | `plan-limits-profile-get` returns all 8 dimensions in a single query including default-inherited ones (SC-002) | `plan-limits-profile.test.mjs` assertion |
| DOD-05 | Attempt to set limit with unrecognized key returns `400 INVALID_DIMENSION_KEY` 100% of the time (SC-005) | `catalog.test.mjs` assertion |
| DOD-06 | Every `plan-limits-set` or `plan-limits-remove` on an `active` plan emits a `plan_audit_events` row + Kafka event with previous value, new value, actor, timestamp (SC-004, FR-011) | `plan-limits-audit.test.mjs` DB + Kafka assertions |
| DOD-07 | Mutation attempts on `deprecated` or `archived` plans rejected with `409 PLAN_LIMITS_FROZEN` (SC-006) | `plan-limits-set.test.mjs` assertions |
| DOD-08 | Tenant owner can view own plan limits, sees display-friendly labels and units, sees NO internal metadata or other tenants' data (SC-003, FR-010, FR-013) | `plan-limits-isolation.test.mjs` assertions |
| DOD-09 | Unlimited sentinel (`value: -1`) accepted and round-tripped cleanly in profile responses as `unlimitedSentinel: true` (FR-008) | `plan-limits-set.test.mjs` assertion |
| DOD-10 | Contract JSON files present for all 5 actions | Files exist in `specs/098-plan-base-limits/contracts/` |
| DOD-11 | `data-model.md` and `quickstart.md` present and accurate | Files present in `specs/098-plan-base-limits/` |
| DOD-12 | `AGENTS.md` updated with new env vars and Kafka topic | `AGENTS.md` diff includes new section |
| DOD-13 | ≥100 plans each with all 8 explicit limits queryable without degradation (SC-007) | Load fixture test asserting profile query < 50 ms p95 |
| DOD-14 | Unrelated untracked artifacts preserved: `specs/070-saga-compensation-workflows/plan.md`, `specs/070-saga-compensation-workflows/tasks.md`, `specs/072-workflow-e2e-compensation/tasks.md` | `git status` confirms untracked, unmodified |

---

## Complexity Tracking

No constitution violations. No complexity exceptions required. One new table, five new actions, one new Kafka topic — all within the established `provisioning-orchestrator` footprint.
