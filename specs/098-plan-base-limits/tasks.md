# Tasks: Plan Base Limits Definition

**Branch**: `098-plan-base-limits` | **Generated**: 2026-03-31  
**Task ID**: US-PLAN-01-T02 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment`)

---

## File Path Map

> All paths are relative to the repository root `/root/projects/falcone`.

| Artifact | Path | Type |
|----------|------|------|
| Migration SQL | `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql` | NEW |
| QuotaDimension model | `services/provisioning-orchestrator/src/models/quota-dimension.mjs` | NEW |
| Catalog repository | `services/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs` | NEW |
| Plan limits repository | `services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs` | NEW |
| Kafka events | `services/provisioning-orchestrator/src/events/plan-limit-events.mjs` | NEW |
| Action: catalog list | `services/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs` | NEW |
| Action: limit set | `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs` | NEW |
| Action: limit remove | `services/provisioning-orchestrator/src/actions/plan-limits-remove.mjs` | NEW |
| Action: profile (superadmin) | `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` | NEW |
| Action: profile (tenant) | `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs` | NEW |
| Contract: catalog list | `specs/098-plan-base-limits/contracts/quota-dimension-catalog-list.json` | NEW |
| Contract: limit set | `specs/098-plan-base-limits/contracts/plan-limits-set.json` | NEW |
| Contract: limit remove | `specs/098-plan-base-limits/contracts/plan-limits-remove.json` | NEW |
| Contract: profile (superadmin) | `specs/098-plan-base-limits/contracts/plan-limits-profile-get.json` | NEW |
| Contract: profile (tenant) | `specs/098-plan-base-limits/contracts/plan-limits-tenant-get.json` | NEW |
| Data model docs | `specs/098-plan-base-limits/data-model.md` | NEW |
| Quickstart docs | `specs/098-plan-base-limits/quickstart.md` | NEW |
| Test fixtures: catalog seed | `tests/integration/098-plan-base-limits/fixtures/seed-catalog.mjs` | NEW |
| Test fixtures: plans seed | `tests/integration/098-plan-base-limits/fixtures/seed-plans.mjs` | NEW |
| Test: catalog | `tests/integration/098-plan-base-limits/catalog.test.mjs` | NEW |
| Test: limit set | `tests/integration/098-plan-base-limits/plan-limits-set.test.mjs` | NEW |
| Test: limit profile | `tests/integration/098-plan-base-limits/plan-limits-profile.test.mjs` | NEW |
| Test: audit | `tests/integration/098-plan-base-limits/plan-limits-audit.test.mjs` | NEW |
| Test: isolation | `tests/integration/098-plan-base-limits/plan-limits-isolation.test.mjs` | NEW |
| AGENTS.md update | `AGENTS.md` | MODIFY |

---

## Tasks

### T01 — Migration: `quota_dimension_catalog` DDL + seed data

**File**: `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql`  
**DoD**: DOD-01  
**Prereq**: Migration 097 must have run (`plans`, `plan_audit_events` tables exist).

Create the `quota_dimension_catalog` table and seed the 8 initial dimensions:

```sql
CREATE TABLE IF NOT EXISTS quota_dimension_catalog (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension_key  VARCHAR(64)  NOT NULL UNIQUE,
  display_label  VARCHAR(255) NOT NULL,
  unit           VARCHAR(20)  NOT NULL CHECK (unit IN ('count', 'bytes')),
  default_value  BIGINT       NOT NULL CHECK (default_value >= -1),
  description    TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by     VARCHAR(255) NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_quota_dimension_catalog_key
  ON quota_dimension_catalog (dimension_key);

-- updated_at trigger (reuse platform pattern)
CREATE OR REPLACE TRIGGER trg_quota_dimension_catalog_updated_at
  BEFORE UPDATE ON quota_dimension_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed 8 initial dimensions (idempotent)
INSERT INTO quota_dimension_catalog (dimension_key, display_label, unit, default_value, description)
VALUES
  ('max_workspaces',        'Maximum Workspaces',              'count', 3,          'Maximum number of workspaces per tenant'),
  ('max_pg_databases',      'Maximum PostgreSQL Databases',    'count', 5,          'Maximum number of PostgreSQL databases per tenant'),
  ('max_mongo_databases',   'Maximum MongoDB Databases',       'count', 2,          'Maximum number of MongoDB databases per tenant'),
  ('max_kafka_topics',      'Maximum Kafka Topics',            'count', 10,         'Maximum number of Kafka topics per tenant'),
  ('max_functions',         'Maximum Functions',               'count', 50,         'Maximum number of serverless functions per tenant'),
  ('max_storage_bytes',     'Maximum Storage',                 'bytes', 5368709120, 'Maximum object storage capacity per tenant in bytes (default 5 GiB)'),
  ('max_api_keys',          'Maximum API Keys',                'count', 20,         'Maximum number of API keys per tenant'),
  ('max_workspace_members', 'Maximum Workspace Members',       'count', 10,         'Maximum number of members per workspace')
ON CONFLICT (dimension_key) DO NOTHING;
```

**Acceptance**: `SELECT COUNT(*) FROM quota_dimension_catalog;` returns 8 on a fresh DB.

---

### T02 — Model: `quota-dimension.mjs`

**File**: `services/provisioning-orchestrator/src/models/quota-dimension.mjs`  
**DoD**: Unit-level validation helpers used by repository and actions.

Implement and export:

- `UNLIMITED_SENTINEL = -1`
- `isValidLimitValue(v)` → boolean: accepts `-1`, `0`, or positive integer; rejects floats, other negatives, non-numbers
- `isUnlimited(v)` → boolean: `v === -1`
- `isInherited(v)` → boolean: `v === null || v === undefined`
- `isValidDimensionKey(key)` → boolean: matches `/^[a-z][a-z0-9_]{1,62}$/`
- `class QuotaDimension` with fields: `dimensionKey`, `displayLabel`, `unit`, `defaultValue`, `description`
- `formatProfileEntry({ dimension, explicitValue })` → `{ dimensionKey, displayLabel, unit, effectiveValue, source: 'explicit'|'default', unlimitedSentinel: boolean }`

---

### T03 — Repository: `quota-dimension-catalog-repository.mjs`

**File**: `services/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs`  
**DoD**: DOD-02; used by catalog list action and validation in plan-limits-repository.

Implement and export (all functions accept a `pgClient` parameter):

- `listAllDimensions(pgClient)` → `QuotaDimension[]` ordered by `dimension_key`
- `getDimensionByKey(pgClient, dimensionKey)` → `QuotaDimension | null`
- `dimensionKeyExists(pgClient, dimensionKey)` → `boolean` (thin wrapper around `getDimensionByKey`)
- `getDefaultValue(pgClient, dimensionKey)` → `BIGINT | null`

Uses `SELECT` from `quota_dimension_catalog`. No writes (catalog is operator-managed via migrations).

---

### T04 — Repository: `plan-limits-repository.mjs`

**File**: `services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs`  
**DoD**: DOD-03, DOD-07, DOD-09; implements lifecycle-aware mutation guard (R-03).

Implement and export (all functions accept a `pgClient` parameter):

- `getPlanWithLock(pgClient, planId)` → `{ id, status, quota_dimensions, slug }` via `SELECT ... FOR UPDATE`; returns `null` if not found
- `getPlanById(pgClient, planId)` → `{ id, status, quota_dimensions, slug }` (no lock; for read-only)
- `setLimit(pgClient, { planId, dimensionKey, value })`:
  1. `BEGIN`
  2. `getPlanWithLock` → error `PLAN_NOT_FOUND` if null
  3. Lifecycle guard: `deprecated`/`archived` → throw `{ code: 'PLAN_LIMITS_FROZEN' }`
  4. Read `previousValue = quota_dimensions[dimensionKey] ?? null`
  5. `UPDATE plans SET quota_dimensions = quota_dimensions || jsonb_build_object($key, $value) WHERE id = $planId`
  6. Insert `plan_audit_events` row: `action_type = 'plan.limit.set'`, `previous_state = { dimensionKey, previousValue }`, `new_state = { dimensionKey, newValue: value }`
  7. `COMMIT`
  8. Return `{ planId, dimensionKey, previousValue, newValue: value, planStatus }`
- `removeLimit(pgClient, { planId, dimensionKey })`:
  1. `BEGIN`
  2. `getPlanWithLock` → error `PLAN_NOT_FOUND` if null
  3. Lifecycle guard: `deprecated`/`archived` → throw `{ code: 'PLAN_LIMITS_FROZEN' }`
  4. Check `quota_dimensions ? dimensionKey` → throw `LIMIT_NOT_SET` if absent
  5. Read `previousValue = quota_dimensions[dimensionKey]`
  6. `UPDATE plans SET quota_dimensions = quota_dimensions - $key WHERE id = $planId`
  7. Insert `plan_audit_events` row: `action_type = 'plan.limit.removed'`, `previous_state = { dimensionKey, previousValue }`, `new_state = { dimensionKey, effectiveValue: <catalog default> }`
  8. `COMMIT`
  9. Return `{ planId, dimensionKey, removedValue: previousValue, planStatus }`
- `getExplicitLimits(pgClient, planId)` → `{ quota_dimensions: Record<string, number> }` (raw JSONB map) or null
- `getLimitsByTenantCurrentPlan(pgClient, tenantId)` → joins `tenant_plan_assignments` (where `is_current = true`) → `plans`; returns `{ planId, planSlug, planStatus, quota_dimensions }` or `null`

**Lock timeout**: set `SET LOCAL lock_timeout = $PLAN_LIMITS_LOCK_TIMEOUT_MS` before `SELECT FOR UPDATE`.

---

### T05 — Events: `plan-limit-events.mjs`

**File**: `services/provisioning-orchestrator/src/events/plan-limit-events.mjs`  
**DoD**: DOD-06; Kafka events emitted only for active-plan mutations (FR-005, FR-011).

Implement and export:

- `emitLimitUpdated(kafkaProducer, { planId, dimensionKey, previousValue, newValue, actorId, correlationId })`:
  - Topic: `process.env.PLAN_LIMITS_KAFKA_TOPIC_UPDATED ?? 'console.plan.limit_updated'`
  - Only call this function for `active` plan mutations (guard at action layer)
  - Envelope (matches platform pattern from T01):

    ```json
    {
      "eventType": "console.plan.limit_updated",
      "correlationId": "<uuid>",
      "actorId": "<actor>",
      "tenantId": null,
      "planId": "<uuid>",
      "timestamp": "<ISO8601>",
      "previousState": { "dimensionKey": "<key>", "previousValue": "<v>" },
      "newState": { "dimensionKey": "<key>", "newValue": "<v>" }
    }
    ```

  - Fire-and-forget: log emit errors, do not throw (platform pattern)

---

### T06 — Action: `quota-dimension-catalog-list.mjs`

**File**: `services/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs`  
**DoD**: DOD-02, FR-001, FR-002, FR-015.

OpenWhisk action pattern. Main function:

1. Auth guard: require superadmin JWT claim
2. Open `pgClient`
3. `listAllDimensions(pgClient)` from catalog repository
4. Return `{ dimensions: [...], total: <n> }` (200)
5. On error: `403 FORBIDDEN`, `500 INTERNAL_ERROR`

Response per dimension: `{ dimensionKey, displayLabel, unit, defaultValue, description }`.

---

### T07 — Action: `plan-limits-set.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs`  
**DoD**: DOD-03, DOD-05, DOD-06, DOD-07, DOD-09, FR-003–FR-006, FR-008, FR-011, FR-014.

OpenWhisk action pattern. Input: `{ planId, dimensionKey, value }`. Main function:

1. Auth guard: require superadmin JWT claim; capture `actorId`
2. Validate `dimensionKey` format via `isValidDimensionKey()`; error `400 INVALID_DIMENSION_KEY`
3. Validate `value` via `isValidLimitValue()`; error `400 INVALID_LIMIT_VALUE`
4. Open `pgClient` + `kafkaProducer`
5. `dimensionKeyExists(pgClient, dimensionKey)` → if false, error `400 INVALID_DIMENSION_KEY` (catalog guard)
6. `setLimit(pgClient, { planId, dimensionKey, value })` → catch `PLAN_NOT_FOUND` (404), `PLAN_LIMITS_FROZEN` (409)
7. If `planStatus === 'active'`, call `emitLimitUpdated(...)` with `correlationId` from request context
8. Return `{ planId, dimensionKey, previousValue, newValue, source: 'explicit' }` (200)

---

### T08 — Action: `plan-limits-remove.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-limits-remove.mjs`  
**DoD**: DOD-06, DOD-07, FR-003, FR-005, FR-006, FR-011.

OpenWhisk action pattern. Input: `{ planId, dimensionKey }`. Main function:

1. Auth guard: superadmin JWT
2. Validate `dimensionKey` format; error `400 INVALID_DIMENSION_KEY`
3. Open `pgClient` + `kafkaProducer`
4. `dimensionKeyExists(pgClient, dimensionKey)` → if false, error `400 INVALID_DIMENSION_KEY`
5. `getDefaultValue(pgClient, dimensionKey)` → capture `effectiveValue` (catalog default)
6. `removeLimit(pgClient, { planId, dimensionKey })` → catch `PLAN_NOT_FOUND` (404), `PLAN_LIMITS_FROZEN` (409), `LIMIT_NOT_SET` (404)
7. If `planStatus === 'active'`, call `emitLimitUpdated(...)` with `newValue: effectiveValue` (reverted to default)
8. Return `{ planId, dimensionKey, removedValue, effectiveValue, source: 'default' }` (200)

---

### T09 — Action: `plan-limits-profile-get.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs`  
**DoD**: DOD-04, FR-007, FR-009, SC-002.

OpenWhisk action pattern. Input: `{ planId }`. Main function:

1. Auth guard: superadmin JWT
2. Open `pgClient`
3. `getPlanById(pgClient, planId)` → if null, `404 PLAN_NOT_FOUND`
4. `listAllDimensions(pgClient)` → full catalog
5. For each dimension, `formatProfileEntry({ dimension, explicitValue: quota_dimensions[dimensionKey] ?? null })`
6. Return `{ planId, planSlug, planStatus, profile: [...] }` (200)

Profile entry shape per `formatProfileEntry`: `{ dimensionKey, displayLabel, unit, effectiveValue, source: 'explicit'|'default', unlimitedSentinel }`.

---

### T10 — Action: `plan-limits-tenant-get.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs`  
**DoD**: DOD-08, FR-010, FR-013, SC-003.

OpenWhisk action pattern. Input: `{ tenantId }` (validated against JWT `tenantId` claim). Main function:

1. Auth guard: tenant owner JWT; validate `tenantId` matches JWT claim → `403 FORBIDDEN` otherwise
2. Open `pgClient`
3. `getLimitsByTenantCurrentPlan(pgClient, tenantId)`:
   - If null (no current assignment) → return `{ tenantId, noAssignment: true, profile: [] }` (200)
4. `listAllDimensions(pgClient)`
5. For each dimension, `formatProfileEntry(...)` using `quota_dimensions` from plan
6. Strip internal metadata: response MUST NOT include `actorId`, `createdBy`, `correlationId`
7. Return `{ tenantId, planSlug, planStatus, profile: [...] }` (200)

---

### T11 — Contract JSON files (5 files)

**Directory**: `specs/098-plan-base-limits/contracts/`  
**DoD**: DOD-10.

Create one JSON schema/contract file per action. Each file documents:
- `action`: action name
- `auth`: required role
- `input`: JSON Schema for input params
- `output`: JSON Schema for success response (200)
- `errors`: array of `{ code, httpStatus, description }`

Files:
1. `quota-dimension-catalog-list.json` — see plan Phase 1 contract summary
2. `plan-limits-set.json`
3. `plan-limits-remove.json`
4. `plan-limits-profile-get.json`
5. `plan-limits-tenant-get.json`

---

### T12 — Docs: `data-model.md`

**File**: `specs/098-plan-base-limits/data-model.md`  
**DoD**: DOD-11.

Document:
- `quota_dimension_catalog` full DDL, column descriptions, indexes
- `plans.quota_dimensions` JSONB semantics: absent key / 0 / positive / -1 (unlimited)
- `plan_audit_events` new `action_type` values: `plan.limit.set`, `plan.limit.removed`, fields used
- Kafka topic `console.plan.limit_updated`: event envelope schema, retention, trigger conditions
- Unlimited sentinel decision (R-02): why `-1`, why not null
- Platform default inheritance behavior (FR-007, edge case)

---

### T13 — Docs: `quickstart.md`

**File**: `specs/098-plan-base-limits/quickstart.md`  
**DoD**: DOD-11.

Document:
- How to run migration `098-plan-base-limits.sql` locally
- Required env vars: `PLAN_LIMITS_KAFKA_TOPIC_UPDATED`, `PLAN_LIMITS_LOCK_TIMEOUT_MS`
- How to run integration tests: `node --test tests/integration/098-plan-base-limits/`
- Example invocations for each of the 5 actions (curl / OpenWhisk CLI)
- Behavior when platform default for a dimension changes (edge case documentation)
- "Unlimited sentinel" semantics: how downstream consumers (enforcement layer) must interpret `unlimitedSentinel: true`

---

### T14 — Integration test fixtures

**Files**:
- `tests/integration/098-plan-base-limits/fixtures/seed-catalog.mjs`
- `tests/integration/098-plan-base-limits/fixtures/seed-plans.mjs`

**DoD**: Prereq for all test tasks (T15–T19).

`seed-catalog.mjs`:
- Runs migration `098-plan-base-limits.sql` or inserts the 8 catalog entries via `INSERT ... ON CONFLICT DO NOTHING`
- Exports `ensureCatalogSeeded(pgClient)`

`seed-plans.mjs`:
- Creates plans in all relevant lifecycle states: `draft`, `active`, `deprecated`, `archived`
- Creates a test tenant and a `tenant_plan_assignments` row for tenant-owner tests
- Exports `seedPlans(pgClient)` → `{ draftPlan, activePlan, deprecatedPlan, archivedPlan, testTenantId }`
- Cleans up via exported `cleanupPlans(pgClient)`

---

### T15 — Integration test: `catalog.test.mjs`

**File**: `tests/integration/098-plan-base-limits/catalog.test.mjs`  
**DoD**: DOD-02, DOD-05; covers FR-001, FR-002, FR-004, FR-012, FR-015, SC-005, SC-007.

Test cases:
1. `quota-dimension-catalog-list` returns all 8 seeded dimensions with correct `dimensionKey`, `displayLabel`, `unit`, `defaultValue`
2. All 8 required keys from FR-002 present
3. Each dimension has unique key, non-empty label, valid unit (`count`|`bytes`), non-negative defaultValue or `-1`
4. `plan-limits-set` with unrecognized dimension key returns `400 INVALID_DIMENSION_KEY` (SC-005 — 100%)
5. Adding a 9th dimension via SQL does not affect existing plans' explicit limits (FR-012)
6. Superadmin auth required; anonymous request returns `403 FORBIDDEN`

---

### T16 — Integration test: `plan-limits-set.test.mjs`

**File**: `tests/integration/098-plan-base-limits/plan-limits-set.test.mjs`  
**DoD**: DOD-03, DOD-05, DOD-06, DOD-07, DOD-09; covers FR-003, FR-004–FR-006, FR-008, FR-014, SC-001, SC-004.

Test cases:
1. Set explicit limit on `draft` plan → persisted in `quota_dimensions`; no Kafka event emitted (FR-005)
2. Set explicit limit on `active` plan → persisted; Kafka event on `console.plan.limit_updated` (FR-005)
3. Update existing limit on `active` plan → `previousValue` correctly captured in audit event (FR-011)
4. Attempt `plan-limits-set` on `deprecated` plan → `409 PLAN_LIMITS_FROZEN` (FR-006, SC-006)
5. Attempt `plan-limits-set` on `archived` plan → `409 PLAN_LIMITS_FROZEN` (FR-006, SC-006)
6. Set `value: -1` (unlimited sentinel) → accepted, stored, profile returns `unlimitedSentinel: true` (FR-008, DOD-09)
7. Set `value: 0` (zero capacity) → accepted and stored, `unlimitedSentinel: false` (FR-014)
8. Set `value: -2` → `400 INVALID_LIMIT_VALUE` (FR-014)
9. Set `value: 1.5` (float) → `400 INVALID_LIMIT_VALUE` (FR-014)
10. Concurrent `plan-limits-set` for same plan/dimension from two simultaneous requests → exactly one value wins; no corrupted state (R-03)
11. Response time for each `plan-limits-set` operation < 5s (SC-001)

---

### T17 — Integration test: `plan-limits-profile.test.mjs`

**File**: `tests/integration/098-plan-base-limits/plan-limits-profile.test.mjs`  
**DoD**: DOD-04, DOD-08; covers FR-007, FR-009, FR-010, SC-002, SC-003.

Test cases:
1. Profile for plan with all 8 explicit limits → 8 entries all with `source: 'explicit'`, correct values (FR-009, SC-002)
2. Profile for plan with 0 explicit limits → 8 entries all with `source: 'default'`, catalog default values (FR-007)
3. Profile for mixed plan → explicit dimensions show `source: 'explicit'`, absent dimensions show `source: 'default'` with catalog default (FR-007, FR-009)
4. Profile entry where explicit value is `-1` → `unlimitedSentinel: true`, `effectiveValue: -1` (FR-008)
5. Plan with no active assignment for `plan-limits-tenant-get` → `{ noAssignment: true, profile: [] }` (US-3 scenario 2)
6. Profile response includes all 8 catalog dimensions regardless of how many are explicitly set (SC-002)
7. Superadmin can query profile for any plan (FR-013)
8. Tenant owner can query own plan's profile (FR-010)
9. `plan-limits-profile-get` on non-existent planId → `404 PLAN_NOT_FOUND`
10. SC-007 load scenario: fixture with ≥100 plans each with 8 explicit limits; profile query p95 < 50 ms

---

### T18 — Integration test: `plan-limits-audit.test.mjs`

**File**: `tests/integration/098-plan-base-limits/plan-limits-audit.test.mjs`  
**DoD**: DOD-06; covers FR-011, SC-004.

Test cases:
1. `plan-limits-set` on `active` plan → `plan_audit_events` row inserted with:
   - `action_type = 'plan.limit.set'`
   - `previous_state.dimensionKey` and `previousValue` correct
   - `new_state.dimensionKey` and `newValue` correct
   - `actor_id` non-null
   - `correlation_id` non-null
   - `created_at` timestamp recent
2. `plan-limits-set` on `active` plan → Kafka event received on `console.plan.limit_updated` within 5s with matching `planId`, `dimensionKey`, `previousState`, `newState`, `actorId`, `correlationId`
3. `plan-limits-remove` on `active` plan → `plan_audit_events` row with `action_type = 'plan.limit.removed'`; Kafka event emitted (FR-011)
4. `plan-limits-set` on `draft` plan → `plan_audit_events` row inserted BUT no Kafka event emitted (FR-005)
5. 100% of active-plan mutations produce audit events (SC-004): run 10 consecutive mutations; assert 10 audit rows

---

### T19 — Integration test: `plan-limits-isolation.test.mjs`

**File**: `tests/integration/098-plan-base-limits/plan-limits-isolation.test.mjs`  
**DoD**: DOD-08; covers FR-013, SC-003.

Test cases:
1. Tenant A JWT cannot call `plan-limits-tenant-get` with `tenantId` of Tenant B → `403 FORBIDDEN`
2. Tenant owner profile response does NOT include internal fields: `createdBy`, `actorId`, `correlationId`, `id` (UUID of catalog entry)
3. Tenant owner profile includes `displayLabel`, `unit`, `effectiveValue`, `source`, `unlimitedSentinel` — display-friendly fields only (FR-010)
4. Superadmin can view profile for any plan including plans assigned to other tenants (FR-013)

---

### T20 — AGENTS.md update

**File**: `AGENTS.md`  
**DoD**: DOD-12.

Append a new section `## Plan Base Limits (098-plan-base-limits)` to the `<!-- MANUAL ADDITIONS START -->` block (after the `## Plan Entity & Tenant Plan Assignment` section) documenting:

- New `quota_dimension_catalog` table (8 initial seed entries)
- `plans.quota_dimensions` JSONB semantics formalized (absent key / 0 / positive / -1 unlimited)
- New `action_type` values in `plan_audit_events`: `plan.limit.set`, `plan.limit.removed`
- New Kafka topic: `console.plan.limit_updated` (30d)
- 5 new OpenWhisk actions: `quota-dimension-catalog-list`, `plan-limits-set`, `plan-limits-remove`, `plan-limits-profile-get`, `plan-limits-tenant-get`
- New env vars: `PLAN_LIMITS_KAFKA_TOPIC_UPDATED` (default `console.plan.limit_updated`), `PLAN_LIMITS_LOCK_TIMEOUT_MS` (default `5000`)
- Unlimited sentinel: `-1` = unlimited, `0` = explicitly zero, absent key = inherits catalog default

---

## Execution Order

```text
T01  (migration SQL)
 └─► T02  (model: quota-dimension.mjs)
      ├─► T03  (catalog repository)
      │    └─► T06  (action: catalog-list)
      └─► T04  (plan-limits repository)
           ├─► T05  (events: plan-limit-events.mjs)
           │    ├─► T07  (action: plan-limits-set)
           │    └─► T08  (action: plan-limits-remove)
           ├─► T09  (action: plan-limits-profile-get)
           └─► T10  (action: plan-limits-tenant-get)

T11  (contracts — can begin after Phase 1 plan is reviewed; no code dependency)
T12  (data-model.md — can begin with T01)
T13  (quickstart.md — can begin after T07-T10)

T14  (fixtures — prereq for T15-T19; requires T01 applied)
 ├─► T15  (catalog tests; requires T06)
 ├─► T16  (set tests; requires T07)
 ├─► T17  (profile tests; requires T09, T10)
 ├─► T18  (audit tests; requires T07, T08, T05)
 └─► T19  (isolation tests; requires T10)

T20  (AGENTS.md — after all source tasks complete)
```

**Parallelizable groups**:
- `T11`, `T12` can proceed concurrently with `T01–T10`
- `T03` and `T04` can proceed concurrently after `T02`
- `T06`, `T07`, `T08`, `T09`, `T10` can proceed concurrently after their respective repository prereqs
- `T15`–`T19` can proceed concurrently after `T14`

---

## Criteria of Done (summary)

| ID | Criterion |
|----|-----------|
| DOD-01 | `098-plan-base-limits.sql` applied cleanly; `quota_dimension_catalog` has 8 seeded rows |
| DOD-02 | `quota-dimension-catalog-list` returns all 8 initial dimensions |
| DOD-03 | `plan-limits-set` persists limits for all 8 dimensions, each < 5s (SC-001) |
| DOD-04 | `plan-limits-profile-get` returns all 8 dimensions including default-inherited (SC-002) |
| DOD-05 | Unrecognized dimension key rejected 100% of the time with `400 INVALID_DIMENSION_KEY` |
| DOD-06 | Every active-plan limit mutation emits `plan_audit_events` row + Kafka event |
| DOD-07 | `deprecated`/`archived` plan mutations rejected with `409 PLAN_LIMITS_FROZEN` |
| DOD-08 | Tenant owner sees only own plan limits; no internal metadata; other-tenant access blocked |
| DOD-09 | Unlimited sentinel `-1` accepted and round-tripped as `unlimitedSentinel: true` |
| DOD-10 | 5 contract JSON files present in `specs/098-plan-base-limits/contracts/` |
| DOD-11 | `data-model.md` and `quickstart.md` present and accurate |
| DOD-12 | `AGENTS.md` updated with new env vars, Kafka topic, and action list |
| DOD-13 | ≥100 plans × 8 limits; profile query p95 < 50 ms |
| DOD-14 | Unrelated untracked artifacts 070/072 preserved; `git status` confirms unmodified |
