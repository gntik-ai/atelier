# Implementation Plan: Effective Limit Resolution

**Branch**: `105-effective-limit-resolution` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-PLAN-02-T03 | **Epic**: EP-19 | **Story**: US-PLAN-02
**Depends on**: US-PLAN-02-T01 (`103-hard-soft-quota-overrides`), US-PLAN-02-T02 (`104-plan-boolean-capabilities`)
**Input**: Feature specification from `specs/105-effective-limit-resolution/spec.md`

## Summary

Introduce a **unified effective entitlements layer** that surfaces both quantitative limits and boolean capabilities for a tenant in a single resolved response, adds **workspace sub-quota management** (allocation of a portion of a tenant's effective limits to individual workspaces), **workspace-level effective limit resolution**, and **sub-quota inconsistency detection** with warning events. Resolution is compute-on-query (no materialized state); sub-quotas are the only new persisted entity. Every sub-quota lifecycle event is audited. This task does NOT cover console visualization (T04), gateway enforcement of capabilities (T05), or end-to-end enforcement tests (T06).

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (established in `services/provisioning-orchestrator`)
**Storage**: PostgreSQL — depends on `quota_dimension_catalog`, `quota_overrides`, `plans`, `tenant_plan_assignments` (T01) and `boolean_capability_catalog` (T02); new table `workspace_sub_quotas`
**Testing**: `node:test` (Node 20 native), `node:assert`, `pg` (fixture queries), `kafkajs` (event verification), `undici` (HTTP contract tests)
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless
**Project Type**: Multi-tenant BaaS platform (web-service)
**Performance Goals**: Unified entitlements resolution < 30 ms p95 (single SQL join); workspace-level resolution < 20 ms p95; sub-quota write < 50 ms p95
**Constraints**: Serializable concurrency on sub-quota allocation; multi-tenant isolation enforced at DB layer; unlimited sentinel (`-1`) handled correctly; inconsistencies flagged, not auto-corrected; no separate recalculation trigger
**Scale/Scope**: ≥200 tenants, ≤10 workspaces per tenant, 8+ quota dimensions, 7 capability keys

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | All new logic under `services/provisioning-orchestrator`; migrations in `src/migrations/`; contracts in `specs/105-effective-limit-resolution/contracts/` |
| II. Incremental Delivery | ✅ PASS | Delivers unified entitlement resolution + workspace sub-quota CRUD + inconsistency detection only; console visualization deferred to T04; gateway enforcement deferred to T05 |
| III. K8s / OpenShift Compatibility | ✅ PASS | No new Helm charts; existing `provisioning-orchestrator` deployment pattern applies; new Kafka topics declared declaratively |
| IV. Quality Gates | ✅ PASS | New `node:test` integration tests; root CI scripts extended |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, research.md, data-model.md, quickstart.md, contracts/, and migration SQL constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new frameworks introduced.

---

## Project Structure

### Documentation (this feature)

```text
specs/105-effective-limit-resolution/
├── plan.md              ← This file
├── spec.md              ← Feature specification (already materialized)
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
└── contracts/
    ├── tenant-effective-entitlements-get.json  ← Unified quantitative + capability resolution
    ├── workspace-sub-quota-set.json            ← Allocate/modify sub-quota for a workspace
    ├── workspace-sub-quota-remove.json         ← Remove sub-quota for a workspace dimension
    ├── workspace-sub-quota-list.json           ← List sub-quotas for tenant/workspace
    └── workspace-effective-limits-get.json     ← Workspace-level effective limit resolution
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── tenant-effective-entitlements-get.mjs   ← NEW: unified quant+capability resolution (FR-005)
│   │   ├── workspace-sub-quota-set.mjs             ← NEW: allocate or modify sub-quota (FR-006/FR-007)
│   │   ├── workspace-sub-quota-remove.mjs          ← NEW: remove sub-quota (FR-013)
│   │   ├── workspace-sub-quota-list.mjs            ← NEW: list sub-quotas for tenant/workspace
│   │   └── workspace-effective-limits-get.mjs      ← NEW: workspace-level resolution (FR-009)
│   ├── models/
│   │   ├── workspace-sub-quota.mjs                 ← NEW: WorkspaceSubQuota entity + validation
│   │   └── effective-entitlements.mjs              ← NEW: EntitlementProfile composite model
│   ├── repositories/
│   │   ├── workspace-sub-quota-repository.mjs      ← NEW: sub-quota CRUD with serializable writes
│   │   └── effective-entitlements-repository.mjs   ← EXTEND: add unified resolution + workspace resolution
│   └── events/
│       └── workspace-sub-quota-events.mjs          ← NEW: Kafka events for sub-quota lifecycle
│   └── migrations/
│       └── 105-effective-limit-resolution.sql      ← NEW: DDL for workspace_sub_quotas

tests/
└── integration/
    └── 105-effective-limit-resolution/
        ├── fixtures/
        │   ├── seed-plans-with-quotas-and-capabilities.mjs  ← combined plan seed
        │   ├── seed-overrides.mjs                           ← active overrides for resolution tests
        │   └── seed-sub-quotas.mjs                          ← pre-existing sub-quotas
        ├── unified-entitlements.test.mjs           ← US-1, US-2: resolution of quant + capability
        ├── workspace-sub-quota-crud.test.mjs       ← US-3, US-6: CRUD + audit trail
        ├── workspace-effective-limits.test.mjs     ← US-4: workspace-level resolution
        ├── upstream-change-reflection.test.mjs     ← US-5: plan change / override revoke
        ├── inconsistency-detection.test.mjs        ← US-5 SC-5: inconsistency flagging
        ├── concurrency.test.mjs                    ← concurrent allocation rejection (FR-018 / SC-002)
        └── isolation.test.mjs                      ← cross-tenant sub-quota isolation (FR-015)
```

**Structure Decision**: Extends `services/provisioning-orchestrator` following the established pattern from 097–104. The `effective-entitlements-repository.mjs` that was introduced in T02 (104) is extended — it already resolves capabilities; T03 adds unified output and workspace-level resolution on top of it.

---

## Phase 0: Research Findings

See [research.md](./research.md) for full decision log.

### Key Decisions Summary

| # | Decision | Rationale |
|---|----------|-----------|
| R-01 | `workspace_sub_quotas` — new dedicated table, not JSONB on workspace | Independent lifecycle, concurrent-safe with row-level locking |
| R-02 | Unified resolution = single SQL join across `quota_dimension_catalog`, `quota_overrides`, `plans`, `tenant_plan_assignments`, `boolean_capability_catalog`, `workspace_sub_quotas` | Single query, no separate calls, < 30 ms p95 at expected scale |
| R-03 | Concurrency control via `SELECT SUM(...) FOR UPDATE` on `workspace_sub_quotas` within `SERIALIZABLE` transaction | Prevents over-allocation under concurrent requests (FR-018 / SC-002) |
| R-04 | Inconsistencies flagged in response + Kafka event; never auto-corrected | Operators must remediate; spec explicitly prohibits auto-revocation (FR-012) |
| R-05 | `toCapabilityList` in `effective-entitlements-repository.mjs` already resolves capabilities (T02) — T03 wraps it alongside the quantitative resolution into a unified response shape | Avoids duplicating T02 logic; single repo that owns the resolution |
| R-06 | `workspace-sub-quota-set` is an upsert (INSERT … ON CONFLICT UPDATE) with allocation sum check inside a SERIALIZABLE transaction | Handles create + modify atomically; concurrent second request rolls back on sum violation |
| R-07 | Boolean capabilities are **not** workspace-scoped — capability flags are resolved at tenant-plan level only (FR-010, Acceptance US-4-4) | Prevents workspace admins from bypassing plan-level feature gates |
| R-08 | Unlimited sentinel (`-1`) at tenant level always permits finite workspace sub-quotas; `workspace sub-quota = -1` is rejected (FR-016) | Unlimited means no cap at tenant, but workspace allocations must still be finite integers |
| R-09 | No separate recalculation trigger; all resolution is computed at query time from current DB state (FR-011) | Avoids cache invalidation complexity; acceptable given query performance target |
| R-10 | Three new Kafka topics (30d retention); one new PostgreSQL table; no new Helm charts | Incremental delivery (Constitution Principle II) |

---

## Phase 1: Data Model

See [data-model.md](./data-model.md) for full DDL and entity reference.

### New Entity: `workspace_sub_quotas`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, `gen_random_uuid()` | Stable identifier |
| `tenant_id` | `VARCHAR(255)` | NOT NULL | Tenant scoping |
| `workspace_id` | `VARCHAR(255)` | NOT NULL | Workspace scoping |
| `dimension_key` | `VARCHAR(64)` | NOT NULL, FK → `quota_dimension_catalog.dimension_key` | Must be a recognized dimension |
| `allocated_value` | `INTEGER` | NOT NULL, CHECK ≥ 0 | Finite allocation; `-1` not permitted |
| `created_by` | `VARCHAR(255)` | NOT NULL | Actor |
| `updated_by` | `VARCHAR(255)` | NOT NULL | Actor |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Auto-updated via trigger |

**Constraints**:
- `UNIQUE (tenant_id, workspace_id, dimension_key)` — one sub-quota per workspace per dimension
- `CHECK (allocated_value >= 0)` — no negative allocations; `-1` is rejected at action layer

**No new columns on existing tables.** Reads from `plans`, `quota_overrides`, `quota_dimension_catalog`, `tenant_plan_assignments`, `boolean_capability_catalog` (all pre-existing from T01/T02).

### Effective Resolution Queries (computed, not persisted)

**Tenant unified entitlements** (single SQL join):

```sql
-- Quantitative: override > plan > catalog default
SELECT
  c.dimension_key,
  c.display_label,
  c.unit,
  COALESCE(o.override_value::text, p.quota_dimensions->>c.dimension_key, c.default_value::text)::int
    AS effective_value,
  CASE
    WHEN o.id IS NOT NULL THEN 'override'
    WHEN p.quota_dimensions ? c.dimension_key THEN 'plan'
    ELSE 'catalog_default'
  END AS source,
  COALESCE(o.quota_type,
    (p.quota_type_config->>c.dimension_key)::jsonb->>'type', 'hard') AS quota_type,
  COALESCE(o.grace_margin,
    ((p.quota_type_config->>c.dimension_key)::jsonb->>'graceMargin')::int, 0) AS grace_margin
FROM quota_dimension_catalog c
LEFT JOIN tenant_plan_assignments tpa ON tpa.tenant_id = $tenantId AND tpa.is_current = true
LEFT JOIN plans p ON p.id = tpa.plan_id
LEFT JOIN quota_overrides o
  ON o.tenant_id = $tenantId
  AND o.dimension_key = c.dimension_key
  AND o.status = 'active'
  AND (o.expires_at IS NULL OR o.expires_at > NOW())
WHERE c.is_active = true
ORDER BY c.sort_order;

-- Capabilities: plan explicit > catalog default (delegated to toCapabilityList from T02)
```

**Workspace-level effective limits** (adds sub-quota layer on top of tenant resolution):

```sql
SELECT
  ent.*,                               -- tenant effective limit from above
  wsq.allocated_value AS sub_quota,
  CASE WHEN wsq.id IS NOT NULL THEN 'workspace_sub_quota' ELSE 'tenant_shared_pool' END AS workspace_source,
  -- Inconsistency flag:
  CASE
    WHEN wsq.id IS NOT NULL
     AND ent.effective_value <> -1
     AND wsq.allocated_value > ent.effective_value
    THEN true ELSE false
  END AS is_inconsistent
FROM (<tenant_effective_limits_subquery>) ent
LEFT JOIN workspace_sub_quotas wsq
  ON wsq.tenant_id = $tenantId
  AND wsq.workspace_id = $workspaceId
  AND wsq.dimension_key = ent.dimension_key;
```

**Sub-quota allocation sum check** (inside SERIALIZABLE transaction):

```sql
SELECT COALESCE(SUM(allocated_value), 0)
FROM workspace_sub_quotas
WHERE tenant_id = $tenantId AND dimension_key = $dimensionKey
  AND workspace_id <> $workspaceId   -- exclude current workspace (for upsert)
FOR UPDATE;
-- Then: if sum + newValue > tenantEffectiveLimit AND tenantEffectiveLimit <> -1 → REJECT
```

### Kafka Topics (new, 30d retention)

| Topic | Trigger | Payload summary |
|-------|---------|-----------------|
| `console.quota.sub_quota.set` | Sub-quota created or modified | tenantId, workspaceId, dimensionKey, previousValue, newValue, actor, timestamp |
| `console.quota.sub_quota.removed` | Sub-quota explicitly removed | tenantId, workspaceId, dimensionKey, previousValue, actor, timestamp |
| `console.quota.sub_quota.inconsistency_detected` | Inconsistency flagged during workspace resolution | tenantId, workspaceId, dimensionKey, subQuotaValue, tenantEffectiveLimit, timestamp |

### Environment Variables (new)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUB_QUOTA_KAFKA_TOPIC_SET` | `console.quota.sub_quota.set` | Topic for set lifecycle events |
| `SUB_QUOTA_KAFKA_TOPIC_REMOVED` | `console.quota.sub_quota.removed` | Topic for removal events |
| `SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY` | `console.quota.sub_quota.inconsistency_detected` | Topic for inconsistency warnings |
| `SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS` | `5000` | Max wait for serializable lock acquisition |

---

## Actions (OpenWhisk)

### `tenant-effective-entitlements-get`

**Purpose**: Unified tenant entitlement profile (quantitative limits + boolean capabilities).
**Auth**: `superadmin` or `tenant_owner` scoped to same tenant.
**Input**: `{ tenantId: string }`
**Output**: `{ tenantId, planSlug, planStatus, quantitativeLimits: [...], capabilities: [...] }`
**Behavior**:
1. Resolve `quantitativeLimits` via single join query (override > plan > catalog default).
2. Resolve `capabilities` via `toCapabilityList` (from T02 `effective-entitlements-repository.mjs`).
3. Merge into unified response.
4. If tenant has no plan assignment, all quantitative limits default to catalog defaults (source: `catalog_default`), all capabilities default to catalog defaults.

### `workspace-sub-quota-set`

**Purpose**: Allocate or modify the sub-quota for a specific workspace + dimension.
**Auth**: `superadmin`, `tenant_owner`, or `workspace_admin` (workspace_admin scoped to own workspace only).
**Input**: `{ tenantId, workspaceId, dimensionKey, allocatedValue: integer ≥ 0 }`
**Output**: `{ subQuotaId, tenantId, workspaceId, dimensionKey, allocatedValue, createdBy, updatedAt }`
**Behavior**:
1. Validate `dimensionKey` exists in `quota_dimension_catalog`.
2. Validate `allocatedValue >= 0` (not -1).
3. Resolve tenant effective limit for `dimensionKey`.
4. Open SERIALIZABLE transaction:
   a. `SELECT SUM(allocated_value) … FOR UPDATE` (excluding current workspace).
   b. If `tenantEffectiveLimit != -1` and `existingSum + allocatedValue > tenantEffectiveLimit` → `REJECT 422 SUB_QUOTA_EXCEEDS_TENANT_LIMIT`.
   c. `INSERT … ON CONFLICT (tenant_id, workspace_id, dimension_key) DO UPDATE`.
5. Emit `console.quota.sub_quota.set` Kafka event.
6. Persist audit record to `plan_audit_events` (action_type: `quota.sub_quota.set`).

### `workspace-sub-quota-remove`

**Purpose**: Remove an existing sub-quota (workspace reverts to shared tenant pool).
**Auth**: `superadmin`, `tenant_owner`, or `workspace_admin` (own workspace).
**Input**: `{ tenantId, workspaceId, dimensionKey }`
**Output**: `{ removed: true, tenantId, workspaceId, dimensionKey, previousValue }`
**Behavior**:
1. Fetch current record; if not found → `404 SUB_QUOTA_NOT_FOUND`.
2. `DELETE FROM workspace_sub_quotas`.
3. Emit `console.quota.sub_quota.removed` Kafka event.
4. Persist audit record (`action_type: quota.sub_quota.removed`).

### `workspace-sub-quota-list`

**Purpose**: List all sub-quotas for a tenant, optionally filtered by workspace.
**Auth**: `superadmin` or `tenant_owner`; `workspace_admin` (own workspace only).
**Input**: `{ tenantId, workspaceId?: string, dimensionKey?: string, limit?: int, offset?: int }`
**Output**: `{ items: [...], total, limit, offset }`

### `workspace-effective-limits-get`

**Purpose**: Resolve effective limits for a specific workspace, combining tenant-level resolution with sub-quota layer.
**Auth**: `superadmin`, `tenant_owner`, `workspace_admin` (own workspace).
**Input**: `{ tenantId, workspaceId }`
**Output**: `{ tenantId, workspaceId, dimensions: [{ dimensionKey, tenantEffectiveValue, tenantSource, workspaceLimit, workspaceSource, isInconsistent }], inconsistentDimensions: [...] }`
**Behavior**:
1. Resolve tenant effective limits for all active dimensions.
2. Join with `workspace_sub_quotas` for this workspace.
3. For each dimension: set `workspaceLimit = subQuota.allocatedValue` if set, else `null` (shared pool).
4. Flag `isInconsistent = true` where `workspaceLimit > tenantEffectiveValue AND tenantEffectiveValue != -1`.
5. If any `isInconsistent = true`, emit `console.quota.sub_quota.inconsistency_detected` per inconsistent dimension.

---

## Strategy de Pruebas

### Unit Tests (inline with `node:test`)

- `workspace-sub-quota.mjs` model validation: negative values rejected, -1 rejected, non-catalog dimension keys rejected.
- `effective-entitlements.mjs`: override > plan > catalog precedence logic.
- Inconsistency detection function: all edge cases (unlimited tenant, zero tenant limit, plan downgrade scenario).

### Integration Tests (`tests/integration/105-effective-limit-resolution/`)

| Test File | Coverage |
|-----------|----------|
| `unified-entitlements.test.mjs` | US-1 (quantitative), US-2 (capabilities), no-plan fallback, `-1` unlimited passthrough, `0` blocked |
| `workspace-sub-quota-crud.test.mjs` | Create sub-quota, update, remove, idempotent re-set to same value, audit event verification |
| `workspace-effective-limits.test.mjs` | Sub-quota-bound workspace, shared-pool workspace, capability not inherited at workspace level |
| `upstream-change-reflection.test.mjs` | Plan upgrade/downgrade, override revocation → re-query reflects new state immediately |
| `inconsistency-detection.test.mjs` | Triggered by plan downgrade: sub-quota stays, inconsistency flag appears in response + Kafka event |
| `concurrency.test.mjs` | Two concurrent allocations that together exceed tenant limit → only one succeeds (SC-002) |
| `isolation.test.mjs` | workspace_admin cannot read/write sub-quotas for another tenant's workspaces |

### Contract Tests

- Each action contract JSON validated by existing contract-validation script.
- `tenant-effective-entitlements-get` contract tested for both "with plan" and "no plan" scenarios.

### Operational Validations (done criterion evidence)

- Sub-quota sum never exceeds tenant effective limit under concurrent load (verified by `concurrency.test.mjs`).
- Inconsistency events appear in Kafka within 5s of resolution query that detects them (SC-004).
- `workspace-effective-limits-get` response includes `isInconsistent: true` for any dimension where sub-quota > tenant limit.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Serializable transaction contention under burst workspace creation | Low (≤10 ws/tenant) | Medium | `SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS` configurable; return `503 LOCK_TIMEOUT` with retry guidance |
| T01/T02 migrations not yet applied in test environment | Medium | High | Integration fixture `seed-plans-with-quotas-and-capabilities.mjs` verifies prerequisites; test setup fails fast with clear message |
| `effective-entitlements-repository.mjs` (T02) API surface changes | Low | Medium | Import from a specific named export; any breaking change is a compile-time failure |
| Inconsistency Kafka events being emitted on every read if plan was downgraded | Medium | Low | Dedup: emit only if this workspace+dimension hasn't already emitted an inconsistency event in the last 5 minutes (in-memory or short TTL idempotency key) |
| `quota_dimension_catalog` not including `dimension_key` as text FK | Low | Low | Migration verifies foreign key exists; action validates dimension before insert |

### Rollback

- The migration adds one new table. Rolling back drops `workspace_sub_quotas`. No existing tables are modified.
- New actions can be undeployed without affecting existing T01/T02 actions.
- Kafka topics can be retained or cleaned up independently.

### Idempotency

- `workspace-sub-quota-set` is an upsert — calling it twice with the same value is a no-op (no duplicate audit/Kafka event if value unchanged).
- `workspace-sub-quota-remove` on a non-existent record returns `404` — callers can safely retry after a timeout.

### Observability

- All sub-quota lifecycle events are on dedicated Kafka topics (grep-friendly).
- Inconsistency events surface the exact dimension, workspace, and limit delta.
- Integration test file `inconsistency-detection.test.mjs` is the canonical operational smoke test.

---

## Dependencies & Sequencing

```text
T01 (103-hard-soft-quota-overrides)   ←──┐
T02 (104-plan-boolean-capabilities)   ←──┤── T03 (105-effective-limit-resolution) ←── T04 (console visualization)
                                          │                                        ←── T05 (gateway enforcement)
                                          │                                        ←── T06 (E2E tests)
```

**Prerequisites** (must be merged/applied before starting T03):
- `quota_dimension_catalog` table populated (T01 migration 103)
- `quota_overrides` table created (T01 migration 103)
- `boolean_capability_catalog` table populated with 7 initial capabilities (T02 migration 104)
- `plans.quota_type_config` column added (T01)
- `effective-entitlements-repository.mjs` present with `toCapabilityList` (T02)

**Parallelizable within T03**:
- Contracts authoring and migration DDL can be done in parallel.
- Integration test fixtures can be authored while actions are being implemented.

**Recommended implementation order**:
1. `105-effective-limit-resolution.sql` migration (table + trigger + index)
2. `workspace-sub-quota.mjs` model + `workspace-sub-quota-repository.mjs`
3. Extend `effective-entitlements-repository.mjs` with unified resolution + workspace resolution methods
4. `tenant-effective-entitlements-get.mjs` action
5. `workspace-sub-quota-set.mjs` + `workspace-sub-quota-remove.mjs` + `workspace-sub-quota-list.mjs`
6. `workspace-effective-limits-get.mjs` action
7. `workspace-sub-quota-events.mjs` Kafka event emitters
8. Integration tests (all files)

---

## Criteria de Done (verificables)

| # | Criterion | Evidence |
|---|-----------|---------|
| CD-01 | `tenant-effective-entitlements-get` returns all active quota dimensions with correct precedence (override > plan > catalog) and all capabilities with correct source | `unified-entitlements.test.mjs` passes |
| CD-02 | Concurrent sub-quota allocations that together exceed the tenant limit: exactly one succeeds, the other returns `422 SUB_QUOTA_EXCEEDS_TENANT_LIMIT` | `concurrency.test.mjs` passes |
| CD-03 | Sub-quota CRUD emits Kafka events on `console.quota.sub_quota.set` and `console.quota.sub_quota.removed` within 5s | `workspace-sub-quota-crud.test.mjs` verifies Kafka event |
| CD-04 | Workspace with sub-quota returns `workspaceSource: workspace_sub_quota`; workspace without returns `workspaceSource: tenant_shared_pool` | `workspace-effective-limits.test.mjs` passes |
| CD-05 | After plan downgrade, re-querying workspace effective limits surfaces `isInconsistent: true` for affected dimensions; sub-quota value is unchanged | `inconsistency-detection.test.mjs` passes |
| CD-06 | `workspace_admin` cannot read or modify sub-quotas for workspaces in a different tenant | `isolation.test.mjs` passes |
| CD-07 | Allocating workspace sub-quota `-1` returns `400 INVALID_SUB_QUOTA_VALUE` | `workspace-sub-quota-crud.test.mjs` edge case assertion |
| CD-08 | When tenant dimension is unlimited (`-1`), any finite workspace sub-quota is accepted | `workspace-sub-quota-crud.test.mjs` assertion |
| CD-09 | All five action contracts validated by contract-validation script | CI run passes contract lint step |
| CD-10 | Migration `105-effective-limit-resolution.sql` is idempotent (`IF NOT EXISTS` guards) and rolls back cleanly | Manual rollback test in `quickstart.md` |
