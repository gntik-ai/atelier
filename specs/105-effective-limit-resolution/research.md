# Research: Effective Limit Resolution (105)

## R-01 — `workspace_sub_quotas` as a Dedicated Table

**Decision**: New PostgreSQL table `workspace_sub_quotas` with `UNIQUE(tenant_id, workspace_id, dimension_key)`.
**Rationale**: Independent lifecycle (sub-quotas survive plan changes; only the _effective limit_ changes); row-level locking (`SELECT … FOR UPDATE`) is needed for safe concurrent allocation checks — impossible with JSONB blobs; queryable per-dimension for the `workspace-sub-quota-list` action.
**Alternatives considered**: (1) JSONB column on a `workspaces` table — rejected: no row-level locking per dimension, no FK to catalog, complex sum queries. (2) Extension of `tenant_plan_assignments` — rejected: assignments are plan-scoped, sub-quotas are workspace-scoped and survive plan changes.

## R-02 — Unified Entitlements Query Architecture

**Decision**: Single SQL join for quantitative resolution; delegate capability resolution to `toCapabilityList` exported from `effective-entitlements-repository.mjs` (introduced in T02). Merge results in the action layer before returning.
**Rationale**: The quantitative and capability resolution use different source tables. A single mega-join would be harder to test and maintain. Two well-separated queries, composed at the action layer, are cleaner and independently testable.
**Performance**: At expected scale (≤8 dimensions × ≤7 capabilities per tenant), two sequential queries total < 10 ms each. Well within the 30 ms p95 target.
**Alternatives considered**: Single mega-join — rejected for maintainability; materialized view — rejected per Constitution Principle II (premature optimization).

## R-03 — Serializable Transaction for Sub-Quota Allocation

**Decision**: `workspace-sub-quota-set` uses a SERIALIZABLE isolation transaction: (1) `SELECT SUM(allocated_value) … WHERE tenant_id = $t AND dimension_key = $d AND workspace_id <> $w FOR UPDATE` to lock the dimension's allocation pool; (2) check sum + new value ≤ tenant effective limit; (3) upsert.
**Rationale**: `FOR UPDATE` on the aggregate prevents two concurrent allocations from both seeing a "safe" sum before either commits. SERIALIZABLE catches any phantom read edge cases if the lock set is insufficient.
**Alternatives considered**: Application-level mutex (per-tenant Kafka topic as a lock) — rejected: fragile across OpenWhisk instances; advisory locks (pg_advisory_lock) — viable but SERIALIZABLE + FOR UPDATE is the established pattern in this codebase (see T01 override concurrency).

## R-04 — Inconsistency Handling: Flag, Don't Fix

**Decision**: When workspace resolution detects `sub_quota > tenant_effective_limit`, set `isInconsistent: true` in the response for that dimension and emit a `console.quota.sub_quota.inconsistency_detected` Kafka event. Do not modify the sub-quota.
**Rationale**: Directly from spec FR-012 and US-5 edge cases. Auto-correction would silently reduce workspace capacity, which is a breaking change for running workloads. Operators must remediate consciously.
**Dedup**: To avoid emitting an inconsistency event on every resolution call (which could be high-frequency), the action maintains a short-lived in-memory set of `{tenantId}:{workspaceId}:{dimensionKey}` keys that have already been flagged in this process instance, with a 5-minute TTL. Across multiple action instances, events may be duplicated but are idempotent for consumers.

## R-05 — Boolean Capabilities Are Tenant-Scoped Only

**Decision**: `workspace-effective-limits-get` returns quantitative workspace limits only. Capabilities (from T02) are always resolved at tenant level and are NOT workspace-scoped.
**Rationale**: Spec FR-010 and acceptance scenario US-4-4 are explicit: a disabled capability at tenant level is disabled for all workspaces regardless of any workspace setting. No storage or resolution layer for workspace-level capability overrides is introduced in this task.

## R-06 — Upsert Semantics for `workspace-sub-quota-set`

**Decision**: `INSERT INTO workspace_sub_quotas … ON CONFLICT (tenant_id, workspace_id, dimension_key) DO UPDATE SET allocated_value = EXCLUDED.allocated_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`. Detect no-op by comparing new value to existing before the transaction; if equal, return `{ changed: false }` with no DB write, no Kafka event, no audit record.
**Rationale**: Idempotent API surface. Consistent with the no-op detection pattern in T02 (`plan-capability-set.mjs`).

## R-07 — Audit via `plan_audit_events`

**Decision**: Reuse `plan_audit_events` table with new `action_type` values: `quota.sub_quota.set` and `quota.sub_quota.removed`. Record `tenant_id`, `workspace_id`, `dimension_key`, `previous_value`, `new_value`, `actor`, `timestamp`.
**Rationale**: Centralizes all quota/plan audit history in one queryable table. No new audit table needed. Consistent with T01 (which uses `plan_audit_events` for override lifecycle events).

## R-08 — Unlimited Sentinel Semantics

**Decision**: Tenant effective limit of `-1` (unlimited) means no cap; any finite (`≥ 0`) workspace sub-quota is accepted regardless of sum check. Workspace sub-quota of `-1` is rejected at the action layer with `400 INVALID_SUB_QUOTA_VALUE` — only the tenant level can carry the unlimited sentinel.
**Rationale**: FR-016. The unlimited sentinel should not propagate to workspace level because it would make the allocation sum check meaningless and could mask future plan changes from affecting workspace behavior.

## R-09 — No New Infrastructure

**Decision**: Three new Kafka topics (30d retention), one new PostgreSQL table, no new Helm charts, no new top-level service.
**Rationale**: Constitution Principle II. `services/provisioning-orchestrator` is the established home for all plan/quota/entitlements logic.

## R-10 — `effective-entitlements-repository.mjs` Extension Strategy

**Decision**: Add two new exported functions to the existing repository module: `resolveTenantEffectiveLimits(client, tenantId)` (quantitative only) and `resolveWorkspaceEffectiveLimits(client, tenantId, workspaceId)` (quantitative + sub-quota layer). The existing `toCapabilityList` stays as-is. The `tenant-effective-entitlements-get` action calls both and merges.
**Rationale**: Avoids a new repository file; keeps all entitlement resolution in one module. Each function is independently testable.
