# Tasks: Effective Limit Resolution

**Branch**: `105-effective-limit-resolution` | **Generated**: 2026-03-31
**Task ID**: US-PLAN-02-T03 | **Epic**: EP-19 | **Story**: US-PLAN-02
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Depends on**: US-PLAN-02-T01 (`103-hard-soft-quota-overrides`), US-PLAN-02-T02 (`104-plan-boolean-capabilities`)

---

## Implement Constraints (mandatory — enforced during `speckit.implement`)

1. **TARGETED FILE READS ONLY** — implement reads only the files listed in the File Path Map below; no broad repo reads (`find`, `ls`, or glob beyond the map).
2. **NO FULL OPENAPI** — never read `apps/control-plane/openapi/control-plane.openapi.json`; if an API contract surface must be verified, read only `apps/control-plane/openapi/families/platform.openapi.json` for the relevant endpoint family.
3. **MINIMAL SPEC CONTEXT** — the implement step receives only `plan.md` and `tasks.md`; do NOT open `spec.md`, `research.md`, `data-model.md`, or `quickstart.md`.
4. **FOCUSED HELPER READS** — for any helper module, read only the first 100 lines plus the exact function-signature slice needed; never read a full helper file beyond that unless a specific function body is required for integration.
5. **FOCUSED TEST READS** — for any existing test, read only the import block plus the first relevant test case for pattern reference; do not read full test files.
6. **NO EXPLORATORY BROWSING** — the File Path Map below is the complete navigation map; do not add ad-hoc reads outside it.
7. **Preserve unrelated untracked artifacts** — do not touch or stage `specs/070-saga-compensation-workflows/plan.md`, `specs/070-saga-compensation-workflows/tasks.md`, or `specs/072-workflow-e2e-compensation/tasks.md`.

---

## File Path Map

> All paths are relative to `/root/projects/atelier`.
> During `speckit.implement`, read only the paths listed here plus `plan.md` and `tasks.md`.

### Read-only reference files (targeted slices only)

```text
services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql       ← quota_overrides DDL, trigger pattern
services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql       ← boolean_capability_catalog DDL + seed pattern
services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql                ← quota_dimension_catalog DDL + seed
services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql   ← plans / tenant_plan_assignments schema
services/provisioning-orchestrator/src/models/quota-dimension.mjs                         ← sentinel helpers (-1, 0, positive int validation)
services/provisioning-orchestrator/src/models/quota-override.mjs                          ← override value validation pattern
services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs ← toCapabilityList + resolveEffectiveEntitlements (full — small file; this is the primary extension target)
services/provisioning-orchestrator/src/repositories/quota-override-repository.mjs         ← serializable TX + FOR UPDATE pattern
services/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs← catalog lookup pattern
services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs            ← TX + audit + optimistic lock pattern
services/provisioning-orchestrator/src/repositories/boolean-capability-catalog-repository.mjs ← catalog boolean query pattern
services/provisioning-orchestrator/src/actions/quota-override-create.mjs                  ← auth + upsert + Kafka + audit action shape
services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs      ← tenant auth + capability response shape (T02)
services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs                 ← tenant-scoped profile action pattern
services/provisioning-orchestrator/src/events/quota-override-events.mjs                   ← Kafka envelope emit pattern
services/provisioning-orchestrator/src/events/plan-capability-events.mjs                  ← secondary Kafka emit pattern
tests/integration/104-plan-boolean-capabilities/fixtures/seed-plans-with-capabilities.mjs ← fixture/fakeDb pattern (imports + first case only)
tests/integration/103-hard-soft-quota-overrides/fixtures/seed-overrides.mjs               ← override seed pattern (imports + first case only)
tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs              ← test structure (imports + first test block only)
tests/integration/104-plan-boolean-capabilities/tenant-effective-capabilities.test.mjs    ← capability resolution test structure (imports + first block only)
```

### New files to create

```text
services/provisioning-orchestrator/src/migrations/105-effective-limit-resolution.sql
services/provisioning-orchestrator/src/models/workspace-sub-quota.mjs
services/provisioning-orchestrator/src/models/effective-entitlements.mjs
services/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs
services/provisioning-orchestrator/src/events/workspace-sub-quota-events.mjs
services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs
services/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs
services/provisioning-orchestrator/src/actions/workspace-sub-quota-remove.mjs
services/provisioning-orchestrator/src/actions/workspace-sub-quota-list.mjs
services/provisioning-orchestrator/src/actions/workspace-effective-limits-get.mjs
tests/integration/105-effective-limit-resolution/fixtures/seed-plans-with-quotas-and-capabilities.mjs
tests/integration/105-effective-limit-resolution/fixtures/seed-overrides.mjs
tests/integration/105-effective-limit-resolution/fixtures/seed-sub-quotas.mjs
tests/integration/105-effective-limit-resolution/unified-entitlements.test.mjs
tests/integration/105-effective-limit-resolution/workspace-sub-quota-crud.test.mjs
tests/integration/105-effective-limit-resolution/workspace-effective-limits.test.mjs
tests/integration/105-effective-limit-resolution/upstream-change-reflection.test.mjs
tests/integration/105-effective-limit-resolution/inconsistency-detection.test.mjs
tests/integration/105-effective-limit-resolution/concurrency.test.mjs
tests/integration/105-effective-limit-resolution/isolation.test.mjs
```

### Files to modify

```text
services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs ← add unified resolution (quant + capabilities) + workspace-level resolution methods
AGENTS.md                                                                                   ← add 105-effective-limit-resolution section
```

### Contract files (already committed — validate only)

```text
specs/105-effective-limit-resolution/contracts/tenant-effective-entitlements-get.json
specs/105-effective-limit-resolution/contracts/workspace-sub-quota-set.json
specs/105-effective-limit-resolution/contracts/workspace-sub-quota-remove.json
specs/105-effective-limit-resolution/contracts/workspace-sub-quota-list.json
specs/105-effective-limit-resolution/contracts/workspace-effective-limits-get.json
```

---

## Tasks

### Phase 1 — Schema and domain models

**Goal**: Create the `workspace_sub_quotas` table and the reusable domain helpers that every higher layer depends on.

**Independent test criteria**: migration applies cleanly with `IF NOT EXISTS` guards and rolls back without error; model validators reject `-1`, negative values, and unknown dimension keys; the unlimited sentinel (`-1`) at tenant level is correctly distinguished from workspace sub-quota values.

---

- [ ] T01 — Create `services/provisioning-orchestrator/src/migrations/105-effective-limit-resolution.sql`

  **Pattern reference**: `services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql` (first 40 lines — `CREATE TABLE IF NOT EXISTS`, trigger wire-up)

  **DDL to implement**:

  ```sql
  CREATE TABLE IF NOT EXISTS workspace_sub_quotas (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(255) NOT NULL,
    workspace_id    VARCHAR(255) NOT NULL,
    dimension_key   VARCHAR(64)  NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
    allocated_value INTEGER      NOT NULL CHECK (allocated_value >= 0),
    created_by      VARCHAR(255) NOT NULL,
    updated_by      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_sub_quota UNIQUE (tenant_id, workspace_id, dimension_key)
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_sub_quotas_tenant
    ON workspace_sub_quotas (tenant_id, dimension_key);

  DROP TRIGGER IF EXISTS trg_workspace_sub_quotas_updated_at ON workspace_sub_quotas;
  CREATE TRIGGER trg_workspace_sub_quotas_updated_at
    BEFORE UPDATE ON workspace_sub_quotas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
  ```

  **Must be idempotent** (`IF NOT EXISTS` on all DDL; `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`).

---

- [ ] T02 — Create `services/provisioning-orchestrator/src/models/workspace-sub-quota.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/models/quota-dimension.mjs` (sentinel helpers)

  **Responsibilities**:
  - Export `class WorkspaceSubQuota` with fields: `id`, `tenantId`, `workspaceId`, `dimensionKey`, `allocatedValue`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`.
  - Export `validateSubQuotaValue(value)`: throws `INVALID_SUB_QUOTA_VALUE` if `value < 0` or `value === -1` (FR-016).
  - Export `validateDimensionKey(key)`: throws `INVALID_DIMENSION_KEY` if falsy or not a string.
  - Export `fromRow(row)`: maps a DB row to `WorkspaceSubQuota`.

---

- [ ] T03 — Create `services/provisioning-orchestrator/src/models/effective-entitlements.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/models/quota-dimension.mjs`

  **Responsibilities**:
  - Export `class QuantitativeLimitEntry` with fields: `dimensionKey`, `displayLabel`, `unit`, `effectiveValue`, `source` (enum: `'override'|'plan'|'catalog_default'`), `quotaType` (`'hard'|'soft'`), `graceMargin`.
  - Export `class CapabilityEntry` with fields: `capabilityKey`, `displayLabel`, `effectiveState`, `source` (enum: `'plan'|'catalog_default'`).
  - Export `class WorkspaceLimitEntry` with fields: `dimensionKey`, `tenantEffectiveValue`, `tenantSource`, `workspaceLimit` (integer or `null`), `workspaceSource` (enum: `'workspace_sub_quota'|'tenant_shared_pool'`), `isInconsistent`.
  - Export `class EffectiveEntitlementProfile` with fields: `tenantId`, `planSlug`, `planStatus`, `quantitativeLimits: QuantitativeLimitEntry[]`, `capabilities: CapabilityEntry[]`.
  - Export `resolveSource(override, planHasDimension)`: pure function returning `'override'|'plan'|'catalog_default'`.
  - Export `isInconsistentSubQuota(subQuotaValue, tenantEffectiveValue)`: returns `true` iff `tenantEffectiveValue !== -1 && subQuotaValue > tenantEffectiveValue`.

---

**Phase 1 checkpoint**: migration, sub-quota model, and entitlement models are ready for repository and action implementation.

---

### Phase 2 — Repository and event emitter

**Goal**: Build the `workspace_sub_quotas` persistence layer with serializable concurrency control, and the Kafka event emitters.

**Independent test criteria**: upsert with sum check rejects second concurrent allocation that would exceed tenant limit; remove returns previous value; catalog key validation is enforced at DB layer via FK.

---

- [ ] T04 — Create `services/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/repositories/quota-override-repository.mjs` (serializable TX + `FOR UPDATE`)

  **Methods to implement**:

  1. `upsertSubQuota({ tenantId, workspaceId, dimensionKey, allocatedValue, actorId }, tenantEffectiveLimit, pgClient)` — runs inside **SERIALIZABLE** transaction:
     - `SELECT COALESCE(SUM(allocated_value), 0) FROM workspace_sub_quotas WHERE tenant_id=$1 AND dimension_key=$2 AND workspace_id<>$3 FOR UPDATE`
     - If `tenantEffectiveLimit !== -1` and `existingSum + allocatedValue > tenantEffectiveLimit` → throw `SUB_QUOTA_EXCEEDS_TENANT_LIMIT` (code `422`).
     - `INSERT INTO workspace_sub_quotas … ON CONFLICT (tenant_id, workspace_id, dimension_key) DO UPDATE SET allocated_value=$…, updated_by=$…, updated_at=NOW()`.
     - Returns `{ subQuota: WorkspaceSubQuota, isNew: boolean, previousValue: number|null }`.

  2. `removeSubQuota({ tenantId, workspaceId, dimensionKey }, pgClient)` — `DELETE … RETURNING *`; returns `WorkspaceSubQuota`; throws `SUB_QUOTA_NOT_FOUND` (code `404`) if no row deleted.

  3. `listSubQuotas({ tenantId, workspaceId?, dimensionKey?, limit, offset }, pgClient)` — paginated SELECT with optional filters; returns `{ items: WorkspaceSubQuota[], total }`.

  4. `getSubQuotasForWorkspace({ tenantId, workspaceId }, pgClient)` — returns all `WorkspaceSubQuota[]` for a workspace; used by workspace-level resolution.

  5. `getTotalAllocatedExcluding({ tenantId, dimensionKey, excludeWorkspaceId }, pgClient)` — `SELECT SUM(allocated_value) … FOR UPDATE`; used internally by `upsertSubQuota`.

---

- [ ] T05 — Create `services/provisioning-orchestrator/src/events/workspace-sub-quota-events.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/events/quota-override-events.mjs` (Kafka envelope structure)

  **Events to implement**:

  1. `emitSubQuotaSet({ tenantId, workspaceId, dimensionKey, previousValue, newValue, actor, timestamp }, kafkaProducer)` → topic `SUB_QUOTA_KAFKA_TOPIC_SET` (default: `console.quota.sub_quota.set`).
  2. `emitSubQuotaRemoved({ tenantId, workspaceId, dimensionKey, previousValue, actor, timestamp }, kafkaProducer)` → topic `SUB_QUOTA_KAFKA_TOPIC_REMOVED` (default: `console.quota.sub_quota.removed`).
  3. `emitSubQuotaInconsistency({ tenantId, workspaceId, dimensionKey, subQuotaValue, tenantEffectiveLimit, timestamp }, kafkaProducer)` → topic `SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY` (default: `console.quota.sub_quota.inconsistency_detected`).

  **Env vars consumed**: `SUB_QUOTA_KAFKA_TOPIC_SET`, `SUB_QUOTA_KAFKA_TOPIC_REMOVED`, `SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY`, `SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS` (default `5000`).

---

- [ ] T06 — Extend `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs`

  **This is the primary extension target for T03.** Read the full file before editing (it is described as small in `plan.md`).

  **Methods to add**:

  1. `resolveUnifiedEntitlements({ tenantId }, pgClient)` → `EffectiveEntitlementProfile`:
     - Execute the quantitative resolution SQL from `plan.md` § "Tenant unified entitlements".
     - Call existing `toCapabilityList({ tenantId }, pgClient)` for capabilities.
     - Merge into `EffectiveEntitlementProfile`.
     - If no plan assignment exists, all quantitative limits use `catalog_default` source; capabilities use `catalog_default` source.

  2. `resolveWorkspaceLimits({ tenantId, workspaceId }, pgClient)` → `WorkspaceLimitEntry[]`:
     - Execute the workspace-level join SQL from `plan.md` § "Workspace-level effective limits".
     - For each dimension, set `workspaceSource = 'workspace_sub_quota'` if sub-quota row exists, else `'tenant_shared_pool'`.
     - Compute `isInconsistent` using `isInconsistentSubQuota` from `effective-entitlements.mjs`.
     - Returns array sorted by `sort_order`.

  **Do not remove or break** the existing `resolveEffectiveEntitlements` or `toCapabilityList` exports — they are consumed by T02 actions that are already deployed.

---

**Phase 2 checkpoint**: persistence, events, and unified resolution query are ready for action implementation.

---

### Phase 3 — User Story 1 & 2: Unified tenant entitlement resolution (P1)

**Goal**: `tenant-effective-entitlements-get` returns the complete tenant entitlement profile (all quantitative limits with source + all boolean capabilities with source) in a single query.

**Independent test criteria**: all catalog dimensions appear with correct precedence; capabilities appear with correct source; no-plan fallback uses catalog defaults; unlimited sentinel (`-1`) passes through; `0` (blocked) passes through.

---

- [ ] T07 — [US1] [US2] Create `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs` (auth shape) and `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs` (tenant-scoped profile)

  **Input**: `{ tenantId: string }`

  **Auth**: `superadmin` OR `tenant_owner` scoped to `params.tenantId`.

  **Behavior**:
  1. Auth check — reject if caller is neither superadmin nor the tenant owner for `tenantId`.
  2. Call `resolveUnifiedEntitlements({ tenantId }, db)` from extended `effective-entitlements-repository.mjs`.
  3. Return `EffectiveEntitlementProfile` serialized to JSON.
  4. No Kafka event (resolution is read-only; high-frequency paths are not audited per spec FR).

  **Output shape** (matches `specs/105-effective-limit-resolution/contracts/tenant-effective-entitlements-get.json`):

  ```json
  {
    "tenantId": "...",
    "planSlug": "...",
    "planStatus": "...",
    "quantitativeLimits": [
      { "dimensionKey": "max_workspaces", "displayLabel": "...", "unit": "...",
        "effectiveValue": 10, "source": "override", "quotaType": "hard", "graceMargin": 0 }
    ],
    "capabilities": [
      { "capabilityKey": "realtime", "displayLabel": "...", "effectiveState": true, "source": "plan" }
    ]
  }
  ```

---

- [ ] T08 — [P] [US1] [US2] Create `tests/integration/105-effective-limit-resolution/unified-entitlements.test.mjs`

  **Pattern reference**: `tests/integration/104-plan-boolean-capabilities/tenant-effective-capabilities.test.mjs` (imports + first test block structure only)

  **Fixtures consumed**: `seed-plans-with-quotas-and-capabilities.mjs`, `seed-overrides.mjs`

  **Test cases** (one `test()` block per scenario):
  - `acme-corp on starter plan with override for max_workspaces → override source returned for that dimension, plan source for others` (US-1 scenario 2)
  - `acme-corp on starter plan, max_kafka_topics absent from plan → catalog_default source` (US-1 scenario 3)
  - `dimension set to -1 at plan level → effectiveValue -1, source plan` (US-1 scenario 4)
  - `override sets dimension to 0 → effectiveValue 0, source override` (US-1 scenario 5)
  - `tenant has no plan assigned → all quantitative dims have source catalog_default` (edge case)
  - `professional plan with realtime+webhooks+sql_admin_api → those capabilities source plan; remaining 4 source catalog_default` (US-2 scenario 1)
  - `new catalog capability batch_exports not in any plan → catalog_default false for all tenants` (US-2 scenario 3)

  Also create `tests/integration/105-effective-limit-resolution/fixtures/seed-plans-with-quotas-and-capabilities.mjs` (combined seed: creates plan with quota_dimensions + quota_type_config + capabilities set) and `tests/integration/105-effective-limit-resolution/fixtures/seed-overrides.mjs` (inserts active quota_overrides for specific tenant/dimension combos).

---

**Phase 3 checkpoint**: unified entitlement resolution is tested end-to-end.

---

### Phase 4 — User Story 3: Workspace sub-quota CRUD (P1)

**Goal**: Workspace admins and tenant owners can allocate, modify, and remove sub-quotas; the total across workspaces never exceeds the tenant effective limit.

**Independent test criteria**: create persists correctly; re-set is an upsert (no duplicate events if value unchanged); remove returns previous value; allocation exceeding tenant limit is rejected `422`; allocating sub-quota for unlimited (`-1`) tenant dimension is accepted; allocating `-1` as sub-quota value is rejected `400`.

---

- [ ] T09 — [US3] Create `services/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/actions/quota-override-create.mjs` (auth + upsert + Kafka + audit pattern)

  **Input**: `{ tenantId, workspaceId, dimensionKey, allocatedValue: integer >= 0 }`

  **Auth**: `superadmin` OR `tenant_owner` (any workspace in tenant) OR `workspace_admin` (own `workspaceId` only).

  **Behavior**:
  1. Validate `allocatedValue >= 0` (not `-1`) via `validateSubQuotaValue` — return `400 INVALID_SUB_QUOTA_VALUE` if violated.
  2. Validate `dimensionKey` exists in `quota_dimension_catalog` — return `404 DIMENSION_NOT_FOUND` if absent.
  3. Resolve tenant effective limit for `dimensionKey` via `resolveUnifiedEntitlements`.
  4. Call `upsertSubQuota(...)` inside SERIALIZABLE TX (passing the resolved tenant effective limit).
  5. If value is unchanged from previous → skip Kafka emit and audit write (no-op idempotent case).
  6. Emit `emitSubQuotaSet(...)` (include `previousValue: null` for new records).
  7. Write `plan_audit_events` row with `action_type: 'quota.sub_quota.set'`.
  8. Return persisted `WorkspaceSubQuota` record.

  **Error responses**: `422 SUB_QUOTA_EXCEEDS_TENANT_LIMIT`, `400 INVALID_SUB_QUOTA_VALUE`, `404 DIMENSION_NOT_FOUND`, `503 LOCK_TIMEOUT`.

---

- [ ] T10 — [US3] Create `services/provisioning-orchestrator/src/actions/workspace-sub-quota-remove.mjs`

  **Pattern reference**: same as T09 (auth + delete + Kafka)

  **Input**: `{ tenantId, workspaceId, dimensionKey }`

  **Auth**: same as T09.

  **Behavior**:
  1. Call `removeSubQuota(...)` — propagate `404 SUB_QUOTA_NOT_FOUND` if no row.
  2. Emit `emitSubQuotaRemoved(...)`.
  3. Write `plan_audit_events` row with `action_type: 'quota.sub_quota.removed'`.
  4. Return `{ removed: true, tenantId, workspaceId, dimensionKey, previousValue }`.

---

- [ ] T11 — [P] [US3] Create `services/provisioning-orchestrator/src/actions/workspace-sub-quota-list.mjs`

  **Input**: `{ tenantId, workspaceId?: string, dimensionKey?: string, limit?: int, offset?: int }`

  **Auth**: `superadmin` or `tenant_owner`; `workspace_admin` filtered to own `workspaceId` only.

  **Behavior**: call `listSubQuotas(...)` and return paginated `{ items, total, limit, offset }`.

---

- [ ] T12 — [P] [US3] [US6] Create `tests/integration/105-effective-limit-resolution/workspace-sub-quota-crud.test.mjs`

  **Pattern reference**: `tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs` (imports + first test block only)

  **Fixtures consumed**: `seed-plans-with-quotas-and-capabilities.mjs`; `seed-sub-quotas.mjs`

  **Test cases**:
  - Create sub-quota for `ws-dev: max_pg_databases=4` → persisted, Kafka event emitted on `console.quota.sub_quota.set` within 5s (SC-004 / CD-03)
  - Re-set same value → no duplicate Kafka event (idempotency)
  - Modify from `4` to `6` → `previousValue: 4`, new Kafka event
  - Remove sub-quota → `removed: true`, Kafka event on `console.quota.sub_quota.removed`, audit record
  - Allocate `-1` → `400 INVALID_SUB_QUOTA_VALUE` (CD-07)
  - Allocate finite value when tenant dimension is unlimited (`-1`) → accepted (CD-08)
  - Remove non-existent → `404 SUB_QUOTA_NOT_FOUND`

  Also create `tests/integration/105-effective-limit-resolution/fixtures/seed-sub-quotas.mjs` (seeds a tenant with two workspaces and pre-existing sub-quota records for test isolation scenarios).

---

**Phase 4 checkpoint**: sub-quota CRUD lifecycle is fully tested including Kafka audit.

---

### Phase 5 — User Story 4: Workspace-level effective limit resolution (P1)

**Goal**: `workspace-effective-limits-get` resolves per-dimension limits for a specific workspace, combining tenant-level resolution with the sub-quota layer, and flags inconsistencies.

**Independent test criteria**: sub-quota-bound workspace returns `workspaceSource: workspace_sub_quota`; unbound workspace returns `workspaceSource: tenant_shared_pool`; capability `realtime: false` at tenant level propagates to workspace regardless of any workspace setting (US-4 scenario 4).

---

- [ ] T13 — [US4] Create `services/provisioning-orchestrator/src/actions/workspace-effective-limits-get.mjs`

  **Pattern reference**: `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs` (auth pattern)

  **Input**: `{ tenantId, workspaceId }`

  **Auth**: `superadmin`, `tenant_owner`, or `workspace_admin` (own `workspaceId`).

  **Behavior**:
  1. Call `resolveWorkspaceLimits({ tenantId, workspaceId }, db)`.
  2. Collect any entries where `isInconsistent === true`.
  3. For each inconsistent dimension, call `emitSubQuotaInconsistency(...)` (fire-and-forget; dedup: skip if same workspace+dimension emitted within last 5 min via in-memory TTL map).
  4. Return `{ tenantId, workspaceId, dimensions: WorkspaceLimitEntry[], inconsistentDimensions: string[] }`.
  5. Boolean capabilities are resolved at tenant level only — this action does NOT include per-workspace capability overrides (FR-010).

  **Output shape** (matches `specs/105-effective-limit-resolution/contracts/workspace-effective-limits-get.json`):

  ```json
  {
    "tenantId": "acme-corp",
    "workspaceId": "ws-prod",
    "dimensions": [
      { "dimensionKey": "max_pg_databases", "tenantEffectiveValue": 10, "tenantSource": "override",
        "workspaceLimit": 6, "workspaceSource": "workspace_sub_quota", "isInconsistent": false }
    ],
    "inconsistentDimensions": []
  }
  ```

---

- [ ] T14 — [P] [US4] Create `tests/integration/105-effective-limit-resolution/workspace-effective-limits.test.mjs`

  **Fixtures consumed**: `seed-plans-with-quotas-and-capabilities.mjs`, `seed-sub-quotas.mjs`

  **Test cases**:
  - `ws-prod with sub-quota max_pg_databases=6, tenant effective=10 → workspaceSource workspace_sub_quota, isInconsistent false` (US-4 scenario 1, CD-04)
  - `ws-dev without sub-quota for max_pg_databases → workspaceSource tenant_shared_pool, workspaceLimit null` (US-4 scenario 2, CD-04)
  - `ws-prod sub-quota max_functions=30, tenant effective=50 → workspaceLimit 30, source workspace_sub_quota` (US-4 scenario 3)
  - `capability realtime=false at tenant level → not overridable at workspace level; workspace response omits capabilities or reports tenant-level value` (US-4 scenario 4)
  - `workspace with zero sub-quota for dimension → workspaceLimit 0, not inconsistent when tenant limit >= 0`

---

**Phase 5 checkpoint**: workspace-level resolution is tested for sub-quota-bound and shared-pool workspaces.

---

### Phase 6 — User Story 5: Upstream change reflection and inconsistency detection (P2)

**Goal**: After a plan upgrade/downgrade or override revocation, the next resolution query reflects the new state immediately. Inconsistencies are flagged but never auto-corrected.

---

- [ ] T15 — [P] [US5] Create `tests/integration/105-effective-limit-resolution/upstream-change-reflection.test.mjs`

  **Fixtures consumed**: `seed-plans-with-quotas-and-capabilities.mjs`, `seed-overrides.mjs`

  **Test cases**:
  - Tenant upgrades from `starter` (`max_functions: 50`) to `professional` (`max_functions: 200`) → next `tenant-effective-entitlements-get` call returns `200, source: plan` (US-5 scenario 2)
  - Override revoked → next call returns plan base value (US-5 scenario 1)
  - Sub-quota value unchanged after plan downgrade → sub-quota row unmodified in DB (FR-012)

---

- [ ] T16 — [P] [US5] Create `tests/integration/105-effective-limit-resolution/inconsistency-detection.test.mjs`

  **Fixtures consumed**: `seed-plans-with-quotas-and-capabilities.mjs`, `seed-overrides.mjs`, `seed-sub-quotas.mjs`

  **Test cases**:
  - Sub-quota `ws-prod: max_workspaces=7`, tenant effective reverted to `3` (override revoked) → `resolveWorkspaceLimits` returns `isInconsistent: true` for `max_workspaces`; sub-quota value `7` unchanged in DB (CD-05)
  - Inconsistency triggers Kafka event on `console.quota.sub_quota.inconsistency_detected` (FR-014)
  - Subsequent query within 5 min dedup window does NOT emit a second inconsistency Kafka event
  - `isInconsistentSubQuota(-1, 3)` → not inconsistent (unlimited tenant permits any sub-quota value — but actually this should not occur since sub-quota cannot be -1)
  - `isInconsistentSubQuota(7, -1)` → not inconsistent (tenant unlimited)

---

### Phase 7 — Concurrency and isolation (SC-002, FR-015, FR-018)

**Goal**: Concurrent sub-quota allocations never collectively exceed the tenant effective limit; workspace admins cannot access other tenants' sub-quotas.

---

- [ ] T17 — [P] [FR-018] [SC-002] Create `tests/integration/105-effective-limit-resolution/concurrency.test.mjs`

  **Test case**: two concurrent `workspace-sub-quota-set` calls for same tenant + dimension, together exceeding tenant limit → exactly one succeeds, the other returns `422 SUB_QUOTA_EXCEEDS_TENANT_LIMIT` (CD-02). Implemented as two `Promise.all`-raced requests against the action with a shared test DB.

---

- [ ] T18 — [P] [FR-015] Create `tests/integration/105-effective-limit-resolution/isolation.test.mjs`

  **Fixtures consumed**: `seed-sub-quotas.mjs` (seeds two tenants with separate sub-quotas)

  **Test cases**:
  - `workspace_admin` for `tenant-A / ws-1` calling `workspace-sub-quota-set` with `tenantId: tenant-B` → `403 FORBIDDEN` (CD-06)
  - `workspace_admin` calling `workspace-sub-quota-list` returns only own tenant's records
  - `tenant_owner` for tenant-A cannot read/modify tenant-B's sub-quotas

---

**Phase 7 checkpoint**: concurrency safety and cross-tenant isolation are verified.

---

### Phase 8 — Contracts, docs, and AGENTS metadata (P2)

**Goal**: Contract files match final action shapes; AGENTS.md records the new feature slice and its implement-read constraints.

---

- [ ] T19 — [P] Validate all five contracts in `specs/105-effective-limit-resolution/contracts/` against the final action output shapes from T07, T09, T10, T11, T13. Update any contract JSON that diverges from the implemented payload (schema fields, error codes, pagination envelope). Run the existing contract-validation script to confirm no regressions (CD-09).

---

- [ ] T20 — [P] Update `AGENTS.md` — add an `## Effective Limit Resolution (105-effective-limit-resolution)` section documenting:
  - New table `workspace_sub_quotas` and its constraints.
  - Three new Kafka topics: `console.quota.sub_quota.set`, `console.quota.sub_quota.removed`, `console.quota.sub_quota.inconsistency_detected`.
  - New env vars: `SUB_QUOTA_KAFKA_TOPIC_SET`, `SUB_QUOTA_KAFKA_TOPIC_REMOVED`, `SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY`, `SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS`.
  - Resolution hierarchy: `override > plan > catalog_default`; workspace layer: `workspace_sub_quota > tenant_shared_pool`.
  - Implement-read constraint for this branch (targeted file reads only; no full OpenAPI; plan.md + tasks.md only).
  - Preserve-untracked note: `specs/070-saga-compensation-workflows/plan.md`, `specs/070-saga-compensation-workflows/tasks.md`, `specs/072-workflow-e2e-compensation/tasks.md`.

---

**Phase 8 checkpoint**: all contracts validated; AGENTS.md current; feature branch is implementation-ready.

---

## Dependency Graph

```text
T01 (migration)
 ├─► T02 (workspace-sub-quota model)
 │    └─► T04 (workspace-sub-quota-repository)
 └─► T03 (effective-entitlements model)
      └─► T06 (extend effective-entitlements-repository)

T04 + T05 + T06
 ├─► T07 (tenant-effective-entitlements-get action)  ──► T08 (unified-entitlements tests)
 ├─► T09 (workspace-sub-quota-set action)            ──► T12 (crud tests)
 ├─► T10 (workspace-sub-quota-remove action)         ──► T12
 ├─► T11 (workspace-sub-quota-list action)           ──► T12
 └─► T13 (workspace-effective-limits-get action)     ──► T14 (workspace-limits tests)

T12 + T14 ──► T15 (upstream-change-reflection tests)
T12 + T14 ──► T16 (inconsistency-detection tests)
T12        ──► T17 (concurrency tests)
T12        ──► T18 (isolation tests)

T07 + T09 + T10 + T11 + T13 ──► T19 (contract validation)
All                           ──► T20 (AGENTS.md update)
```

## Parallel Execution Opportunities

- `T02` and `T03` can run in parallel after `T01` (migration) is applied.
- `T05` (events) can run in parallel with `T04` (repository) once the model shape from `T02` is defined.
- `T07`, `T09`, `T10`, `T11`, `T13` can be started in parallel once `T04`, `T05`, `T06` are in place.
- `T08`, `T12`, `T14` can be authored while the actions they test are being implemented (fixture-first TDD).
- `T15`, `T16`, `T17`, `T18` can run in parallel once their respective fixtures are available.
- `T19` and `T20` are final and can be parallelized with each other.

## Implementation Strategy

**MVP (CD-01 + CD-02 + CD-04)**:
- Complete `T01–T09` + `T13` to deliver unified resolution + sub-quota create/validate + workspace-level resolution.

**Second increment (CD-03 + CD-05 + CD-06 + CD-07 + CD-08)**:
- Complete `T10–T12` + `T14–T18` for full CRUD lifecycle, inconsistency detection, concurrency, and isolation.

**Final increment (CD-09 + CD-10)**:
- Complete `T19–T20` for contracts and documentation.

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 20 |
| Phase 1 (schema + models) | T01–T03 (3 tasks) |
| Phase 2 (repos + events + resolution) | T04–T06 (3 tasks) |
| Phase 3 (unified entitlements, US1+US2) | T07–T08 (2 tasks) |
| Phase 4 (sub-quota CRUD, US3) | T09–T12 (4 tasks) |
| Phase 5 (workspace resolution, US4) | T13–T14 (2 tasks) |
| Phase 6 (upstream changes + inconsistency, US5) | T15–T16 (2 tasks) |
| Phase 7 (concurrency + isolation) | T17–T18 (2 tasks) |
| Phase 8 (contracts + docs) | T19–T20 (2 tasks) |
| Parallel opportunities | 8+ task windows |
| Suggested MVP | T01–T09 + T13 |
