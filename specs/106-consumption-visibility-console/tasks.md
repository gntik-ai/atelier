# Tasks: Consumption Visibility Console

**Feature Branch**: `106-consumption-visibility-console`
**Task ID**: US-PLAN-02-T04
**Epic**: EP-19 — Planes, límites y packaging del producto
**Story**: US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo
**Depends on**: US-PLAN-02-T01 (103), US-PLAN-02-T02 (104), US-PLAN-02-T03 (105)
**Generated**: 2026-03-31
**Plan ref**: [plan.md](./plan.md) | **Spec ref**: [spec.md](./spec.md)

---

## ⚠ Constrained Implement Rules (mandatory — carry forward to all sub-agents)

> These rules MUST be respected by every agent executing tasks in this feature:
>
> 1. **Targeted file reads only** — Read only the files explicitly listed in each task's "Files to read" section. Do not speculatively open unrelated source files.
> 2. **No full control-plane OpenAPI reads** — Do not open or scan the full control-plane OpenAPI spec. Use only the family-scoped OpenAPI artifacts listed per task.
> 3. **Family OpenAPI only** — When API contract context is needed, read only the plan-management family route file (`services/gateway-config/routes/plan-management-routes.yaml`) and the contracts in `specs/106-consumption-visibility-console/contracts/`.
> 4. **No broad browsing** — Do not glob-search, `find`, or `ls -R` the entire repository. Navigation is guided by the File Path Map below and the explicit per-task file lists.
> 5. **Plan and tasks as primary spec context** — During implementation, use `plan.md` and `tasks.md` as the primary reference documents. Read `spec.md` only when a specific acceptance scenario requires clarification.

---

## File Path Map

> Implementation-ready reference. All paths relative to repo root `/root/projects/falcone`.

### Backend — provisioning-orchestrator

| File | Status | Purpose |
|------|--------|---------|
| `services/provisioning-orchestrator/src/repositories/consumption-repository.mjs` | **NEW** | Dimension-to-table query registry; parallel COUNT queries per tenant/workspace |
| `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` | **EXTEND** | Add `resolveTenantConsumption`, `resolveWorkspaceConsumption` exports |
| `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` | **EXTEND** | Add `?include=consumption` branch; calls `resolveTenantConsumption` |
| `services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs` | **NEW** | Standalone action: current resource counts per dimension for a tenant |
| `services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs` | **NEW** | Workspace-level limits + consumption (sub-quota or shared-pool) |
| `services/provisioning-orchestrator/src/actions/tenant-workspace-allocation-summary-get.mjs` | **NEW** | Per-dimension allocation aggregation across workspaces |

### Gateway config

| File | Status | Purpose |
|------|--------|---------|
| `services/gateway-config/routes/plan-management-routes.yaml` | **EXTEND** | Add 5 new consumption APISIX routes |

### Console — pages

| File | Status | Purpose |
|------|--------|---------|
| `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` | **EXTEND** | Wire `?include=consumption`; render `QuotaConsumptionTable` + `CapabilityStatusGrid` |
| `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` | **EXTEND** | Add superadmin entitlement+consumption panel with `showOverrideDetails` |
| `apps/web-console/src/pages/ConsoleWorkspaceDashboardPage.tsx` | **NEW** (P2) | Workspace-level consumption dashboard |
| `apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx` | **NEW** (P2) | Tenant allocation summary per dimension |

### Console — components

| File | Status | Purpose |
|------|--------|---------|
| `apps/web-console/src/components/console/ConsumptionBar.tsx` | **NEW** | Progress bar + color status (green/amber/red/unlimited/unavailable) |
| `apps/web-console/src/components/console/ConsumptionBar.test.tsx` | **NEW** | Component unit tests |
| `apps/web-console/src/components/console/QuotaConsumptionTable.tsx` | **NEW** | Per-dimension rows with bar, badges, source, override details |
| `apps/web-console/src/components/console/QuotaConsumptionTable.test.tsx` | **NEW** | Component unit tests |
| `apps/web-console/src/components/console/CapabilityStatusGrid.tsx` | **NEW** | Capability grid: enabled/disabled + source badges |
| `apps/web-console/src/components/console/CapabilityStatusGrid.test.tsx` | **NEW** | Component unit tests |
| `apps/web-console/src/components/console/OverrideIndicatorBadge.tsx` | **NEW** | Amber badge + tooltip showing original plan value |
| `apps/web-console/src/components/console/OverrideIndicatorBadge.test.tsx` | **NEW** | Component unit tests |
| `apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx` | **NEW** (P2) | Allocation summary table |
| `apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.test.tsx` | **NEW** (P2) | Component unit tests |

### Console — API service + router

| File | Status | Purpose |
|------|--------|---------|
| `apps/web-console/src/services/planManagementApi.ts` | **EXTEND** | Add `ConsumptionSnapshot`, `WorkspaceConsumptionResponse`, `AllocationSummary` types + 3 new fetch functions |
| `apps/web-console/src/router.tsx` | **EXTEND** | Add routes for workspace dashboard + allocation summary |

### Integration tests

| File | Status | Purpose |
|------|--------|---------|
| `tests/integration/106-consumption-visibility-console/fixtures/seed-tenant-with-plan-and-resources.mjs` | **NEW** | Provision measurable resources per dimension |
| `tests/integration/106-consumption-visibility-console/fixtures/seed-workspace-with-sub-quotas.mjs` | **NEW** | Workspace sub-quotas + resources |
| `tests/integration/106-consumption-visibility-console/tenant-consumption-snapshot.test.mjs` | **NEW** | US-1, US-2: counts, usageStatus thresholds, no-plan tenant |
| `tests/integration/106-consumption-visibility-console/workspace-consumption.test.mjs` | **NEW** | US-4: workspace-level limits + consumption |
| `tests/integration/106-consumption-visibility-console/allocation-summary.test.mjs` | **NEW** | US-5: allocation arithmetic |
| `tests/integration/106-consumption-visibility-console/unlimited-dimension.test.mjs` | **NEW** | SC-4: `-1` sentinel never shows percentage |
| `tests/integration/106-consumption-visibility-console/over-limit.test.mjs` | **NEW** | SC-3: usage > limit → `over_limit` status |
| `tests/integration/106-consumption-visibility-console/isolation.test.mjs` | **NEW** | Cross-tenant isolation for all new endpoints |

### Spec artifacts

| File | Status | Purpose |
|------|--------|---------|
| `specs/106-consumption-visibility-console/contracts/tenant-consumption-snapshot-get.json` | **NEW** | API contract: consumption snapshot shape |
| `specs/106-consumption-visibility-console/contracts/workspace-consumption-get.json` | **NEW** | API contract: workspace consumption shape |
| `specs/106-consumption-visibility-console/contracts/tenant-workspace-allocation-summary-get.json` | **NEW** | API contract: allocation summary shape |

---

## Implementation Tasks

### TASK-01 — `consumption-repository.mjs`: dimension-to-table registry

**Execution unit**: backend / independent
**Depends on**: nothing (reads only PostgreSQL tables from T01–T03)
**Priority**: P1

**Objective**: Implement `consumption-repository.mjs` with a static dimension-to-query registry and a `resolveDimensionCounts(client, tenantId, dimensionKeys)` function that runs all queries in parallel with per-dimension failure isolation.

**Implementation**:

1. Create `services/provisioning-orchestrator/src/repositories/consumption-repository.mjs`.
2. Implement `DIMENSION_QUERY_MAP` with the 8 initial catalog dimensions:
   - `max_workspaces` → `COUNT(*) FROM workspaces WHERE tenant_id = $1`
   - `max_pg_databases` → `COUNT(*) FROM pg_databases WHERE tenant_id = $1`
   - `max_functions` → `COUNT(*) FROM functions WHERE tenant_id = $1`
   - `max_kafka_topics` → `COUNT(*) FROM kafka_topics WHERE tenant_id = $1`
   - `max_realtime_channels` → `COUNT(*) FROM realtime_channels WHERE tenant_id = $1`
   - `max_storage_gb` → `SUM(size_bytes) / 1e9 FROM storage_objects WHERE tenant_id = $1` (returns `0` if NULL)
   - `max_monthly_api_calls` → `COUNT(*) FROM api_call_logs WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW())`
   - `max_members` → `COUNT(*) FROM workspace_members WHERE tenant_id = $1`
3. For workspace-scoped queries add `AND workspace_id = $2` variant.
4. Export `resolveDimensionCounts(client, tenantId, dimensionKeys, workspaceId?)`:
   - Build query promises from `DIMENSION_QUERY_MAP` for each key in `dimensionKeys`.
   - Unknown keys → `{ currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'NO_QUERY_MAPPING' }`.
   - Execute all via `Promise.allSettled` with a 500 ms per-dimension timeout (use `Promise.race` with a timeout reject).
   - Failed/timed-out dimensions → `{ currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'CONSUMPTION_QUERY_FAILED' }`.
   - Return `Map<dimensionKey, { currentUsage: number|null, usageStatus, usageUnknownReason }>`.

**`usageStatus` computation** (performed in this repository):

```text
if currentUsage === null → 'unknown'
if effectiveLimit === -1 → 'within_limit'  (unlimited)
if currentUsage > effectiveLimit → 'over_limit'
if currentUsage === effectiveLimit → 'at_limit'
if currentUsage / effectiveLimit >= 0.80 → 'approaching_limit'
else → 'within_limit'
```

**Files to read**:
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Data Model section (dimension map)
- `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` — existing pattern reference (read selectively, only the export/import structure)

**Files to write**:
- `services/provisioning-orchestrator/src/repositories/consumption-repository.mjs` (new)

**Acceptance**:
- [ ] All 8 dimension keys resolve to non-null counts when provisioning tables are populated
- [ ] Unknown dimension key returns `usageStatus: 'unknown'` with `usageUnknownReason: 'NO_QUERY_MAPPING'`
- [ ] A simulated query timeout returns `usageStatus: 'unknown'` with `usageUnknownReason: 'CONSUMPTION_QUERY_FAILED'`
- [ ] `Promise.allSettled` ensures one failing dimension does not block others

---

### TASK-02 — Extend `effective-entitlements-repository.mjs`

**Execution unit**: backend / sequential after TASK-01
**Depends on**: TASK-01

**Objective**: Add `resolveTenantConsumption` and `resolveWorkspaceConsumption` exports that compose entitlement resolution (already existing) with the new `consumption-repository.mjs`.

**Implementation**:

1. Import `resolveDimensionCounts` from `./consumption-repository.mjs`.
2. Add `resolveTenantConsumption(client, tenantId)`:
   - Fetch the tenant's effective quantitative limits (call existing `resolveTenantEffectiveEntitlements` — read only the quota dimensions output, not capabilities).
   - Extract `dimensionKeys` from the resolved limits.
   - Call `resolveDimensionCounts(client, tenantId, dimensionKeys)`.
   - Merge consumption into the resolved limits: each dimension gains `currentUsage`, `usageStatus`, `usageUnknownReason`.
   - Return merged structure.
3. Add `resolveWorkspaceConsumption(client, tenantId, workspaceId)`:
   - Fetch workspace sub-quotas from `workspace_sub_quotas WHERE tenant_id = $1 AND workspace_id = $2`.
   - Fetch tenant effective limits (for shared-pool fallback).
   - For each dimension: if sub-quota exists → `workspaceLimit = sub_quota.allocated_value`, `workspaceSource = 'workspace_sub_quota'`; else → `workspaceLimit = tenantEffectiveValue`, `workspaceSource = 'tenant_shared_pool'`.
   - Call `resolveDimensionCounts(client, tenantId, dimensionKeys, workspaceId)` for workspace-scoped counts.
   - Return merged structure per workspace dimension.

**Files to read**:
- `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` — existing exports (read only the function signatures/exports, not the full file body unless needed)
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Data Model: workspace consumption shape

**Files to write**:
- `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` (extend, additive only)

**Acceptance**:
- [ ] `resolveTenantConsumption` returns merged entitlement + consumption without breaking existing exports
- [ ] `resolveWorkspaceConsumption` returns `workspaceSource: 'workspace_sub_quota'` for allocated dimensions, `'tenant_shared_pool'` for unallocated
- [ ] No existing caller of `effective-entitlements-repository` is affected (additive exports only)

---

### TASK-03 — New action: `tenant-consumption-snapshot-get.mjs`

**Execution unit**: backend / parallel with TASK-04 and TASK-05 after TASK-02
**Depends on**: TASK-02

**Objective**: Create standalone OpenWhisk action that returns the current consumption snapshot for a tenant.

**Implementation**:

1. Create `services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs`.
2. Extract `tenantId` from JWT claim (`tenant_owner` role) or from path param (`superadmin` role, pattern from existing actions).
3. Validate `tenantId` scope — tenant owner must only access own tenant; superadmin may specify any.
4. Call `resolveTenantConsumption(client, tenantId)` from TASK-02.
5. Return response shape:

   ```json
   {
     "tenantId": "<string>",
     "snapshotAt": "<ISO-8601>",
     "dimensions": [
       {
         "dimensionKey": "<string>",
         "displayLabel": "<string>",
         "unit": "<string|null>",
         "currentUsage": "<number|null>",
         "usageStatus": "<within_limit|approaching_limit|at_limit|over_limit|unknown>",
         "usageUnknownReason": "<string|null>"
       }
     ]
   }
   ```

6. Return HTTP 200 on success; HTTP 404 if tenant not found; HTTP 403 on scope violation.
7. No Kafka events emitted (pure read).

**Files to read**:
- `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` — existing action pattern (read only the parameter extraction and auth check pattern, ~top 40 lines)
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Data Model: consumption snapshot shape
- `specs/106-consumption-visibility-console/contracts/tenant-consumption-snapshot-get.json` — if already materialized

**Files to write**:
- `services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs` (new)

**Acceptance**:
- [ ] Tenant owner calling `GET /v1/tenant/plan/consumption` receives own snapshot with correct counts
- [ ] Superadmin calling `GET /v1/tenants/{tenantId}/plan/consumption` receives target tenant snapshot
- [ ] Tenant owner attempting another tenant's consumption receives HTTP 403
- [ ] Tenant with no plan returns catalog-default effective limits with consumption counts

---

### TASK-04 — Extend `tenant-effective-entitlements-get.mjs` with `?include=consumption`

**Execution unit**: backend / parallel with TASK-03 and TASK-05 after TASK-02
**Depends on**: TASK-02

**Objective**: Extend the existing `tenant-effective-entitlements-get` action with an optional `?include=consumption` query parameter that adds consumption fields to the existing response.

**Implementation**:

1. Open `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs`.
2. Check for `params.include === 'consumption'` (or comma-separated list membership).
3. If present: after existing entitlement resolution, call `resolveTenantConsumption` and merge `currentUsage`, `usageStatus`, `usageUnknownReason` into each `quantitativeLimits` item.
4. If absent: no change to existing response (backwards compatible).
5. The merged fields map to the existing `observedUsage` / `usageStatus` / `usageUnknownReason` optional fields already present in the `CurrentEffectiveEntitlementSummary` TypeScript type.

**Files to read**:
- `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` — full file (one targeted read)
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Data Model, extended entitlements response section

**Files to write**:
- `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` (extend, additive branch only)

**Acceptance**:
- [ ] `GET /v1/tenant/plan/effective-entitlements` (without param) returns identical response to pre-T04 (regression-safe)
- [ ] `GET /v1/tenant/plan/effective-entitlements?include=consumption` returns entitlements + `currentUsage`/`usageStatus` per dimension
- [ ] `usageUnknownReason` is populated when a dimension query fails

---

### TASK-05 — New actions: `workspace-consumption-get` and `tenant-workspace-allocation-summary-get`

**Execution unit**: backend / parallel with TASK-03 and TASK-04 after TASK-02
**Depends on**: TASK-02

**Objective**: Implement two new OpenWhisk actions for P2 workspace-level views.

#### Sub-task A: `workspace-consumption-get.mjs`

1. Create `services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs`.
2. Extract `tenantId` and `workspaceId` from path params (and JWT for tenant-owner self-service).
3. Enforce: workspace admin may only access their own workspace; superadmin may specify any tenant+workspace.
4. Call `resolveWorkspaceConsumption(client, tenantId, workspaceId)`.
5. Return workspace consumption shape (see plan.md Phase 1 Data Model).
6. HTTP 404 if workspace not found; HTTP 403 on scope violation.

#### Sub-task B: `tenant-workspace-allocation-summary-get.mjs`

1. Create `services/provisioning-orchestrator/src/actions/tenant-workspace-allocation-summary-get.mjs`.
2. Extract `tenantId` from JWT (tenant owner) or path param (superadmin).
3. Fetch tenant effective limits via existing `resolveTenantEffectiveEntitlements`.
4. Fetch all `workspace_sub_quotas WHERE tenant_id = $1`, grouped by `dimension_key`.
5. For each dimension:
   - `tenantEffectiveValue`: from resolved entitlements (`-1` = unlimited)
   - `totalAllocated`: `SUM(allocated_value)` across all workspaces
   - `unallocated`: if `tenantEffectiveValue === -1` → `null`; else `tenantEffectiveValue - totalAllocated`
   - `isFullyAllocated`: `unallocated === 0`
   - `workspaces`: array of `{ workspaceId, allocatedValue }` from sub-quotas
6. Return allocation summary shape (see plan.md Phase 1 Data Model).

**Files to read**:
- `specs/106-consumption-visibility-console/plan.md` — workspace consumption shape + allocation summary shape (Phase 1 Data Model)
- `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` — auth pattern only (read top ~40 lines)

**Files to write**:
- `services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs` (new)
- `services/provisioning-orchestrator/src/actions/tenant-workspace-allocation-summary-get.mjs` (new)

**Acceptance**:
- [ ] Workspace with sub-quota returns `workspaceSource: 'workspace_sub_quota'` and `workspaceLimit` = sub-quota value
- [ ] Workspace without sub-quota returns `workspaceSource: 'tenant_shared_pool'` and tenant effective limit for reference
- [ ] Allocation summary: `totalAllocated + unallocated = tenantEffectiveValue` for every finite dimension
- [ ] Unlimited dimension (`-1`): `unallocated` is `null`, `totalAllocated` is sum of finite sub-quotas

---

### TASK-06 — APISIX route additions

**Execution unit**: gateway config / parallel with TASK-03–05
**Depends on**: nothing (declarative config)

**Objective**: Add 5 new consumption routes to `plan-management-routes.yaml`.

**Implementation**:

Add the following routes to `services/gateway-config/routes/plan-management-routes.yaml`, following the existing route pattern (auth plugin, upstream pointing to `provisioning-orchestrator`, path rewrite):

| Method | Public path | Auth | OpenWhisk action |
|--------|-------------|------|-----------------|
| `GET` | `/v1/tenant/plan/consumption` | tenant-owner JWT | `tenant-consumption-snapshot-get` |
| `GET` | `/v1/tenants/{tenantId}/plan/consumption` | superadmin JWT | `tenant-consumption-snapshot-get` |
| `GET` | `/v1/tenant/plan/allocation-summary` | tenant-owner JWT | `tenant-workspace-allocation-summary-get` |
| `GET` | `/v1/workspaces/{workspaceId}/consumption` | workspace-admin JWT | `workspace-consumption-get` |
| `GET` | `/v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption` | superadmin JWT | `workspace-consumption-get` |

Note: `tenant-effective-entitlements-get?include=consumption` reuses the existing `/v1/tenant/plan/effective-entitlements` route — no new route needed.

**Files to read**:
- `services/gateway-config/routes/plan-management-routes.yaml` — existing route entries (read file, reference pattern for 2–3 existing entries, then extend)

**Files to write**:
- `services/gateway-config/routes/plan-management-routes.yaml` (extend, append only)

**Acceptance**:
- [ ] 5 new route entries present in YAML, syntactically valid
- [ ] Auth scopes match the role requirements in the table above
- [ ] CI smoke test returns 200/401/403 (not 404) for each new route

---

### TASK-07 — Console API service: extend `planManagementApi.ts`

**Execution unit**: frontend / parallel with TASK-03–06
**Depends on**: nothing (types can be authored from plan.md contracts; implementation wires to routes from TASK-06)

**Objective**: Add TypeScript types and fetch functions for the three new consumption endpoints.

**Implementation**:

1. Open `apps/web-console/src/services/planManagementApi.ts`.
2. Add types (additive, no existing type changes):
   - `ConsumptionDimension`: `{ dimensionKey, displayLabel, unit, currentUsage: number|null, usageStatus, usageUnknownReason: string|null }`
   - `ConsumptionSnapshot`: `{ tenantId, snapshotAt, dimensions: ConsumptionDimension[] }`
   - `WorkspaceConsumptionDimension`: adds `tenantEffectiveValue, workspaceLimit, workspaceSource`
   - `WorkspaceConsumptionResponse`: `{ tenantId, workspaceId, snapshotAt, dimensions: WorkspaceConsumptionDimension[] }`
   - `AllocationSummaryDimension`: `{ dimensionKey, displayLabel, unit, tenantEffectiveValue, totalAllocated, unallocated: number|null, workspaces, isFullyAllocated }`
   - `AllocationSummary`: `{ tenantId, dimensions: AllocationSummaryDimension[] }`
   - `UsageStatus`: `'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'`
3. Add fetch functions:
   - `getTenantConsumption(tenantId?: string): Promise<ConsumptionSnapshot>` — uses `/v1/tenant/plan/consumption` (tenant owner) or `/v1/tenants/${tenantId}/plan/consumption` (superadmin)
   - `getWorkspaceConsumption(workspaceId: string, tenantId?: string): Promise<WorkspaceConsumptionResponse>`
   - `getTenantAllocationSummary(tenantId?: string): Promise<AllocationSummary>`
4. Existing `getTenantEffectiveEntitlements` extended to accept optional `{ includeConsumption?: boolean }` option — when true, appends `?include=consumption` to the URL.

**Files to read**:
- `apps/web-console/src/services/planManagementApi.ts` — existing type definitions and fetch pattern (read selectively: type exports + fetch function signatures)
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Data Model: TypeScript type note on `CurrentEffectiveEntitlementSummary`

**Files to write**:
- `apps/web-console/src/services/planManagementApi.ts` (extend, additive)

**Acceptance**:
- [ ] `getTenantEffectiveEntitlements({ includeConsumption: true })` appends `?include=consumption`
- [ ] All 3 new functions compile without TypeScript errors
- [ ] Existing callers of `getTenantEffectiveEntitlements` without the new option continue to work

---

### TASK-08 — Console components (P1 set)

**Execution unit**: frontend / parallel with TASK-07
**Depends on**: nothing (components are self-contained; use shadcn/ui primitives)

**Objective**: Implement 4 new React components with unit tests.

#### Sub-task A: `ConsumptionBar.tsx`

Props: `{ current: number | null, limit: number, label?: string }`

Behavior:
- `limit === -1`: render current count + "Unlimited" label; no bar; no percentage.
- `current === null`: render muted bar with "Data unavailable" text; `aria-label` indicates unavailability.
- `limit === 0`: render `0 / 0` with a red indicator (no resources permitted).
- Otherwise: render HTML `<progress>` or shadcn/ui `Progress` at `Math.min(current/limit, 1) * 100`%.
- Color: `< 80%` → emerald, `80–99%` → amber, `≥ 100%` → red.
- Accessibility: `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax={limit}`, `aria-label`.

Test cases for `ConsumptionBar.test.tsx`:
- Renders at 30% with green color class
- Renders at 85% with amber color class
- Renders at 100% with red color class
- Renders at 115% (over-limit) clamped bar to 100% with red; text shows `115 / 100`
- Renders `null` usage with "Data unavailable" text
- Renders `limit = -1` with "Unlimited" label; no `<progress>` element

#### Sub-task B: `QuotaConsumptionTable.tsx`

Props: `{ rows: QuotaDimensionRow[], showOverrideDetails?: boolean }`

Behavior:
- One row per dimension: display label, effective limit badge, source badge (plan/override/catalog_default), consumption bar, `current / limit` text.
- When `showOverrideDetails=true` and `source === 'override'`: render `OverrideIndicatorBadge` with original plan value.
- When `usageStatus === 'unknown'`: render "Data unavailable" indicator (muted icon), not an error state.
- When `effectiveValue === 0`: display explicitly as `0 / 0` with red no-resources indicator.
- Unlimited row: show consumption count + "Unlimited"; no bar.

Test cases for `QuotaConsumptionTable.test.tsx`:
- Renders all rows from fixture data
- Override badge shown only when `showOverrideDetails=true` and `source === 'override'`
- Unknown data row shows indicator, not empty
- Unlimited row shows count + "Unlimited", no `<progress>`

#### Sub-task C: `CapabilityStatusGrid.tsx`

Props: `{ capabilities: CapabilityRow[] }`

Behavior:
- Responsive grid (CSS grid or flex-wrap).
- Each cell: display label + enabled badge (green check) or disabled badge (muted dash).
- Source badge: "plan" or "platform default" pill.

Test cases for `CapabilityStatusGrid.test.tsx`:
- All 7 capabilities rendered when 7 rows passed
- Enabled capabilities show green check badge
- Disabled capabilities show muted badge

#### Sub-task D: `OverrideIndicatorBadge.tsx`

Props: `{ overriddenFromValue: number, overrideValue: number }`

Behavior:
- Renders amber "Override" badge.
- Tooltip: `"Plan: {overriddenFromValue} → Override: {overrideValue}"`.
- Uses shadcn/ui `Tooltip` (or Radix `TooltipProvider`) following existing console badge patterns.

Test cases for `OverrideIndicatorBadge.test.tsx`:
- Badge text is "Override"
- Tooltip content contains both values in expected format

**Files to read**:
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Console Component Contracts section
- `apps/web-console/src/components/console/` — list one existing component file as pattern reference (e.g., `PlanStatusBadge.tsx` or `ConsoleQuotaPostureBadge.tsx` — read only that one file for import style and shadcn/ui usage)

**Files to write**:
- `apps/web-console/src/components/console/ConsumptionBar.tsx` (new)
- `apps/web-console/src/components/console/ConsumptionBar.test.tsx` (new)
- `apps/web-console/src/components/console/QuotaConsumptionTable.tsx` (new)
- `apps/web-console/src/components/console/QuotaConsumptionTable.test.tsx` (new)
- `apps/web-console/src/components/console/CapabilityStatusGrid.tsx` (new)
- `apps/web-console/src/components/console/CapabilityStatusGrid.test.tsx` (new)
- `apps/web-console/src/components/console/OverrideIndicatorBadge.tsx` (new)
- `apps/web-console/src/components/console/OverrideIndicatorBadge.test.tsx` (new)

**Acceptance**:
- [ ] All component unit tests pass (`vitest run`)
- [ ] `ConsumptionBar` renders correctly for all 6 visual states (see test cases)
- [ ] `QuotaConsumptionTable` passes `showOverrideDetails` down correctly
- [ ] `CapabilityStatusGrid` renders all catalog capabilities including disabled ones

---

### TASK-09 — Console P2 component: `WorkspaceAllocationSummaryTable.tsx`

**Execution unit**: frontend / parallel with TASK-08
**Depends on**: nothing
**Priority**: P2

**Objective**: Implement `WorkspaceAllocationSummaryTable` with unit tests.

Props: `{ rows: AllocationSummaryRow[] }`

Behavior:
- One row per dimension: display label, tenant effective limit, total allocated, unallocated, per-workspace breakdown (expandable or inline).
- `tenantEffectiveValue === -1`: show "Unlimited" in effective column; no allocated/unallocated percentage.
- `isFullyAllocated`: show distinct visual indicator (e.g., amber "Fully Allocated" badge).
- `unallocated === 0` with finite limit: same amber indicator.

Test cases:
- Sum row renders total/allocated/unallocated correctly
- Unlimited row shows "Unlimited"; no percentage
- Fully-allocated indicator shown when `isFullyAllocated = true`
- Zero-allocation row shows all effective limit as "Shared pool"

**Files to read**:
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 `WorkspaceAllocationSummaryTable` component contract

**Files to write**:
- `apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx` (new)
- `apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.test.tsx` (new)

**Acceptance**:
- [ ] All unit tests pass
- [ ] Unlimited row never shows percentage or progress bar

---

### TASK-10 — Extend console pages: `ConsoleTenantPlanOverviewPage` and `ConsoleTenantPlanPage`

**Execution unit**: frontend / sequential after TASK-07 and TASK-08
**Depends on**: TASK-07, TASK-08

**Objective**: Wire consumption data into the two existing P1 plan pages.

#### Sub-task A: `ConsoleTenantPlanOverviewPage.tsx`

1. Open the existing page.
2. Replace (or extend) the `getTenantEffectiveEntitlements` call to pass `{ includeConsumption: true }`.
3. Render plan identity section: name, status badge, description (from `planInfo` in entitlements response).
4. Render `QuotaConsumptionTable` with entitlements + consumption rows; `showOverrideDetails=false` (tenant owner view).
5. Render `CapabilityStatusGrid` below the quota table.
6. Handle no-plan state: show "No plan assigned" message + all dimensions at catalog defaults (FR-014).
7. Loading state: skeleton loaders for both sections.
8. Error state: show error boundary / retry; do not hide partial data.

#### Sub-task B: `ConsoleTenantPlanPage.tsx` (superadmin view)

1. Open the existing superadmin page.
2. Add an "Entitlements & Consumption" section using `QuotaConsumptionTable` with `showOverrideDetails=true`.
3. Call `getTenantConsumption(tenantId)` alongside the existing entitlements fetch.
4. Merge override context (`overriddenFromValue`, `originalPlanValue`) from entitlements into table rows.
5. Over-limit conditions should be immediately visible (red row + `OverrideIndicatorBadge` if override exists).

**Files to read**:
- `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` — full file (one targeted read, P1 page)
- `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` — full file (one targeted read, superadmin page)
- `apps/web-console/src/services/planManagementApi.ts` — only the updated type exports (from TASK-07 output)

**Files to write**:
- `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` (extend)
- `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` (extend)

**Acceptance**:
- [ ] Tenant overview page renders plan identity + quota table + capability grid
- [ ] "No plan assigned" state renders catalog defaults with message (FR-014)
- [ ] Superadmin page shows override indicators for overridden dimensions
- [ ] Loading and error states handled; no uncaught `undefined` crashes

---

### TASK-11 — New console pages: workspace dashboard and allocation summary (P2)

**Execution unit**: frontend / sequential after TASK-07 and TASK-08–09
**Depends on**: TASK-07, TASK-08, TASK-09
**Priority**: P2

**Objective**: Implement two new P2 console pages and register routes.

#### Sub-task A: `ConsoleWorkspaceDashboardPage.tsx`

1. Create the page; read `workspaceId` from router params.
2. Fetch workspace consumption via `getWorkspaceConsumption(workspaceId)`.
3. Render `QuotaConsumptionTable` adapted for workspace view (show `workspaceSource` badge: "workspace allocation" or "shared tenant pool").
4. Render capabilities as `CapabilityStatusGrid` (read-only, inherited from tenant).
5. Loading / error / no-workspace states handled.

#### Sub-task B: `ConsoleTenantAllocationSummaryPage.tsx`

1. Create the page.
2. Fetch allocation summary via `getTenantAllocationSummary()`.
3. Render `WorkspaceAllocationSummaryTable` with the response rows.
4. Handle empty state (no sub-quotas set for any dimension).

#### Sub-task C: `router.tsx` extensions

Add routes:
- `/console/my-plan/allocation` → `ConsoleTenantAllocationSummaryPage`
- `/console/workspaces/:workspaceId` → `ConsoleWorkspaceDashboardPage`

Add nav links in relevant sidebar/breadcrumb sections (follow existing nav pattern — read only the sidebar nav section of the router/nav component, not the whole file).

**Files to read**:
- `apps/web-console/src/router.tsx` — existing route entries section only (targeted offset/limit read)
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Contracts: console route extensions

**Files to write**:
- `apps/web-console/src/pages/ConsoleWorkspaceDashboardPage.tsx` (new)
- `apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx` (new)
- `apps/web-console/src/router.tsx` (extend, additive routes only)

**Acceptance**:
- [ ] `ConsoleWorkspaceDashboardPage` shows `workspaceSource` context per dimension
- [ ] `ConsoleTenantAllocationSummaryPage` arithmetic display matches fixture data
- [ ] Both routes reachable from console nav; no 404 in dev

---

### TASK-12 — Backend integration tests

**Execution unit**: backend tests / sequential after TASK-03, TASK-04, TASK-05, TASK-06
**Depends on**: TASK-03, TASK-04, TASK-05, TASK-06

**Objective**: Implement integration tests covering all acceptance scenarios for the new backend endpoints.

**Test files to create**:

1. `tests/integration/106-consumption-visibility-console/fixtures/seed-tenant-with-plan-and-resources.mjs`
   - Creates tenant, assigns plan, inserts rows in each provisioning table (workspaces, pg_databases, functions, etc.)
   - Returns `{ tenantId, planId, resourceCounts }` for test assertions

2. `tests/integration/106-consumption-visibility-console/fixtures/seed-workspace-with-sub-quotas.mjs`
   - Creates workspace, sets sub-quotas for subset of dimensions, inserts workspace-scoped resources

3. `tests/integration/106-consumption-visibility-console/tenant-consumption-snapshot.test.mjs` — covers:
   - US-1 SC-1: plan identity visible
   - US-2 SC-1: `3 / 10` consumption with `within_limit` status
   - US-2 SC-2: `18 / 20` with `approaching_limit` (90%)
   - US-2 SC-3: `15 / 10` with `over_limit` status
   - US-2 SC-4: `-1` effective limit → `within_limit` with current count
   - US-2 SC-5: `0 / limit` present, not omitted
   - Edge: no plan assigned → catalog defaults returned

4. `tests/integration/106-consumption-visibility-console/workspace-consumption.test.mjs` — covers:
   - US-4 SC-1: sub-quota dimension shows `workspaceSource: 'workspace_sub_quota'`
   - US-4 SC-2: no sub-quota → `workspaceSource: 'tenant_shared_pool'`
   - US-4 SC-4: at-limit workspace shows `at_limit` status

5. `tests/integration/106-consumption-visibility-console/allocation-summary.test.mjs` — covers:
   - US-5 SC-1: `total=20, allocated=13, unallocated=7`
   - US-5 SC-2: fully allocated (`unallocated=0`)
   - US-5 SC-3: no sub-quotas → whole limit is shared pool
   - US-5 SC-4: unlimited tenant with finite sub-quotas

6. `tests/integration/106-consumption-visibility-console/unlimited-dimension.test.mjs`:
   - `-1` effective limit → no `usageStatus` percentage computation; `currentUsage` present
   - Workspace sub-quota attempt on unlimited tenant dimension → still valid sub-quota

7. `tests/integration/106-consumption-visibility-console/over-limit.test.mjs`:
   - Insert `15` resources against limit `10` → `usageStatus: 'over_limit'`
   - Superadmin view shows over-limit warning indicator data

8. `tests/integration/106-consumption-visibility-console/isolation.test.mjs`:
   - Tenant B's session receives HTTP 403 when requesting Tenant A's consumption snapshot
   - No cross-tenant data leakage in response body

**Files to read** (per fixture/test file, at time of writing):
- The relevant action file being tested (one targeted read)
- `specs/106-consumption-visibility-console/spec.md` — only the specific acceptance scenario block being implemented

**Files to write**: all test and fixture files listed above (new)

**Acceptance**:
- [ ] All 8 test files pass via `node --test tests/integration/106-consumption-visibility-console/`
- [ ] Isolation test confirms HTTP 403 for cross-tenant access
- [ ] Over-limit test confirms `over_limit` status and correct `currentUsage`/`effectiveLimit` values

---

### TASK-13 — API contract files

**Execution unit**: documentation / parallel with TASK-03–05
**Depends on**: nothing (authored from plan.md shapes)

**Objective**: Materialize the 3 JSON contract files for the new consumption endpoints.

**Implementation**: Create JSON Schema files capturing the exact response shapes defined in plan.md Phase 1 Data Model.

**Files to read**:
- `specs/106-consumption-visibility-console/plan.md` — Phase 1 Data Model section only (Consumption Snapshot Shape, Workspace Consumption Shape, Workspace Allocation Summary Shape)
- `specs/106-consumption-visibility-console/contracts/` — check if any files already exist (one `ls` or directory read)

**Files to write**:
- `specs/106-consumption-visibility-console/contracts/tenant-consumption-snapshot-get.json` (new)
- `specs/106-consumption-visibility-console/contracts/workspace-consumption-get.json` (new)
- `specs/106-consumption-visibility-console/contracts/tenant-workspace-allocation-summary-get.json` (new)

**Acceptance**:
- [ ] All 3 files are valid JSON Schema (draft-07 or later)
- [ ] `usageStatus` enum values match those in `consumption-repository.mjs`
- [ ] `tenantEffectiveValue: -1` is representable in the schema (integer, `minimum: -1`)

---

### TASK-14 — AGENTS.md update

**Execution unit**: documentation / final step
**Depends on**: all prior tasks complete

**Objective**: Document T04 additions in `AGENTS.md` under the manual additions block.

**Content to add**:

```markdown
## Consumption Visibility Console (106-consumption-visibility-console)

- T04 is a read-only layer on top of T01–T03 data. No new PostgreSQL tables introduced.
- New OpenWhisk actions: `tenant-consumption-snapshot-get`, `workspace-consumption-get`, `tenant-workspace-allocation-summary-get`.
- `tenant-effective-entitlements-get` extended with `?include=consumption` query param (backwards compatible).
- `consumption-repository.mjs` provides the dimension-to-table query registry with parallel execution and per-dimension graceful degradation.
- New APISIX routes: 5 new consumption routes added to `plan-management-routes.yaml`.
- New console components: `ConsumptionBar`, `QuotaConsumptionTable`, `CapabilityStatusGrid`, `OverrideIndicatorBadge`, `WorkspaceAllocationSummaryTable`.
- New console pages: `ConsoleWorkspaceDashboardPage`, `ConsoleTenantAllocationSummaryPage`; extended: `ConsoleTenantPlanOverviewPage`, `ConsoleTenantPlanPage`.
- `planManagementApi.ts` extended with `ConsumptionSnapshot`, `WorkspaceConsumptionResponse`, `AllocationSummary` types and 3 new fetch functions.
- Progress bar thresholds: `< 80%` = green, `80–99%` = amber, `≥ 100%` = red; unlimited (`-1`) suppresses bar.
- Consumption unavailability degrades per-dimension to `usageStatus: 'unknown'`; row is never hidden (FR-018).
- No Kafka events emitted; pure read path.
- Implement-read constraints: targeted file reads only, no full control-plane OpenAPI reads, family OpenAPI only, no broad browsing.
```

**Files to read**:
- `AGENTS.md` — only the `<!-- MANUAL ADDITIONS END -->` boundary (tail read, ~30 lines)

**Files to write**:
- `AGENTS.md` (extend, insert before `<!-- MANUAL ADDITIONS END -->`)

**Acceptance**:
- [ ] AGENTS.md updated with T04 section
- [ ] No other sections of AGENTS.md modified

---

## Execution Order

```text
TASK-01  (consumption-repository.mjs)
  └── TASK-02  (extend effective-entitlements-repository)
        ├── TASK-03  (tenant-consumption-snapshot-get action)       ─┐
        ├── TASK-04  (extend tenant-effective-entitlements-get)      │ parallel
        └── TASK-05  (workspace-consumption + allocation-summary)   ─┘
                │
                ├── TASK-06  (APISIX routes)          ─┐ parallel with 03–05
                ├── TASK-07  (planManagementApi.ts)    │
                ├── TASK-08  (console components P1)   │
                └── TASK-09  (WorkspaceAllocationSummaryTable P2)
                        │
                        ├── TASK-10  (extend P1 pages)
                        ├── TASK-11  (new P2 pages + router)
                        └── TASK-12  (integration tests)
                                │
                                └── TASK-13  (contract files)  ─┐ can run earlier, parallel
                                └── TASK-14  (AGENTS.md)        │ final step
```

---

## Criteria of Done

| # | Criterion | Evidence |
|---|-----------|----------|
| DoD-01 | `tenant-consumption-snapshot-get` returns correct counts for all 8 initial dimensions | `tenant-consumption-snapshot.test.mjs` passes |
| DoD-02 | `tenant-effective-entitlements-get?include=consumption` returns merged entitlements + consumption | Extended T03 contract test passes; snapshot fields present |
| DoD-03 | `workspace-consumption-get` returns correct `workspaceSource` per dimension | `workspace-consumption.test.mjs` passes |
| DoD-04 | `tenant-workspace-allocation-summary-get` arithmetic: `totalAllocated + unallocated = tenantEffectiveValue` | `allocation-summary.test.mjs` passes |
| DoD-05 | `ConsumptionBar` handles all 6 visual states (within, approaching, over, unlimited, null, zero) | Component tests pass |
| DoD-06 | `ConsoleTenantPlanOverviewPage` shows plan identity + all quota rows + all 7 capabilities | Page test + manual QA |
| DoD-07 | Superadmin `ConsoleTenantPlanPage` shows override indicators and original plan values | Page test with `showOverrideDetails=true` |
| DoD-08 | `ConsoleWorkspaceDashboardPage` shows workspace-scoped consumption with source context | Page test + manual QA |
| DoD-09 | `ConsoleTenantAllocationSummaryPage` shows total/allocated/unallocated arithmetic | Page test + fixture assertion |
| DoD-10 | Cross-tenant isolation: HTTP 403 for cross-tenant consumption access | `isolation.test.mjs` passes |
| DoD-11 | Consumption query failure → "data unavailable" indicator, row not hidden | Unit test simulating per-dimension failure |
| DoD-12 | All 5 new APISIX routes return 200/401/403 (not 404) in CI smoke test | CI pipeline green |
| DoD-13 | `AGENTS.md` updated with T04 section | PR diff includes AGENTS.md change |
