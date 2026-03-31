# Implementation Plan: Consumption Visibility Console

**Branch**: `106-consumption-visibility-console` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-PLAN-02-T04 | **Epic**: EP-19 | **Story**: US-PLAN-02
**Depends on**: US-PLAN-02-T01 (`103-hard-soft-quota-overrides`), US-PLAN-02-T02 (`104-plan-boolean-capabilities`), US-PLAN-02-T03 (`105-effective-limit-resolution`)
**Input**: Feature specification from `specs/106-consumption-visibility-console/spec.md`

## Summary

T04 is a **console + backend-extension task** that builds the consumption visibility layer on top of the entitlement resolution infrastructure delivered by T01–T03. It introduces three new OpenWhisk actions for consumption counting and aggregated workspace allocation, extends `tenant-effective-entitlements-get` with an optional consumption snapshot, and delivers four console pages (tenant plan overview with live consumption, superadmin tenant detail view, workspace dashboard, and tenant allocation summary). No new PostgreSQL tables are introduced — all storage was established by T01–T03.

Key design choices: (1) consumption counts are obtained by querying existing provisioning tables (`workspaces`, `pg_databases`, `functions`, etc.) via OpenWhisk actions — no new metering infrastructure; (2) the existing `CurrentEffectiveEntitlementSummary` shape in `planManagementApi.ts` already carries `observedUsage` and `usageStatus` fields anticipating this task; (3) new components (`ConsumptionBar`, `QuotaConsumptionTable`, `CapabilityStatusGrid`) compose with existing shadcn/ui primitives and the established `ConsoleQuotaPostureBadge`.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) / React 18 + TypeScript  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns; React + Tailwind CSS + shadcn/ui (console)  
**Storage**: PostgreSQL — read-only access to `quota_dimension_catalog`, `quota_overrides`, `plans`, `tenant_plan_assignments`, `boolean_capability_catalog`, `workspace_sub_quotas`, and existing provisioning resource tables (no new DDL in T04)  
**Testing**: `node:test` + `node:assert` (backend integration), `vitest` + React Testing Library (console unit tests), `undici` (HTTP contract tests against APISIX)  
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless  
**Project Type**: Multi-tenant BaaS platform — console web-service + serverless backend  
**Performance Goals**: Consumption snapshot resolution < 100 ms p95 per tenant (parallel dimension queries); page first meaningful paint within 2 s on standard connection  
**Constraints**: Multi-tenant isolation enforced at DB layer; unlimited sentinel (`-1`) renders as "Unlimited" with no progress bar; consumption data unavailability degrades gracefully; stale entitlement data must not persist across page loads (FR-017)  
**Scale/Scope**: ≥ 200 tenants, ≤ 10 workspaces per tenant, 8+ quota dimensions, 7 capability keys

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | Backend actions under `services/provisioning-orchestrator/src/actions/`; console pages under `apps/web-console/src/pages/`; components under `apps/web-console/src/components/console/`; contracts under `specs/106-consumption-visibility-console/contracts/`; no new top-level folders |
| II. Incremental Delivery | ✅ PASS | Pure read layer on T01–T03 data; no DDL changes; new pages compose from existing component library; enforcement (T05) deferred |
| III. K8s / OpenShift Compatibility | ✅ PASS | No new Helm charts; new actions registered in existing `provisioning-orchestrator` manifest; new APISIX routes extend existing `plan-management-routes.yaml` |
| IV. Quality Gates | ✅ PASS | New `node:test` integration tests in `tests/integration/106-consumption-visibility-console/`; new `vitest` component/page tests; root CI scripts extended |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, research.md, data-model.md, quickstart.md, and contracts/ constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new infrastructure services; no new frameworks.

---

## Project Structure

### Documentation (this feature)

```text
specs/106-consumption-visibility-console/
├── plan.md              ← This file
├── spec.md              ← Feature specification (already materialized)
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output (API surface, component props contracts)
├── quickstart.md        ← Phase 1 output (local dev and test execution)
└── contracts/
    ├── tenant-consumption-snapshot-get.json         ← Consumption counts per dimension for tenant
    ├── workspace-consumption-get.json               ← Workspace limits + consumption
    └── tenant-workspace-allocation-summary-get.json ← Per-dimension allocation aggregation
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── tenant-effective-entitlements-get.mjs    ← EXTEND: add optional ?include=consumption
│   │   ├── tenant-consumption-snapshot-get.mjs      ← NEW: current resource counts per dimension
│   │   ├── workspace-consumption-get.mjs            ← NEW: workspace limits + consumption
│   │   └── tenant-workspace-allocation-summary-get.mjs  ← NEW: allocation summary per dimension
│   └── repositories/
│       ├── effective-entitlements-repository.mjs    ← EXTEND: add resolveTenantConsumption,
│       │                                               resolveWorkspaceConsumption (new exports)
│       └── consumption-repository.mjs               ← NEW: per-dimension resource count queries

services/gateway-config/routes/
└── plan-management-routes.yaml                      ← EXTEND: add 3 new consumption routes

apps/web-console/src/
├── pages/
│   ├── ConsoleTenantPlanOverviewPage.tsx            ← EXTEND: wire consumption data, progress bars
│   ├── ConsoleTenantPlanPage.tsx                    ← EXTEND: add entitlement+consumption section for superadmin
│   ├── ConsoleWorkspaceDashboardPage.tsx            ← NEW: workspace-level consumption (P2)
│   └── ConsoleTenantAllocationSummaryPage.tsx       ← NEW: tenant allocation summary (P2)
├── components/console/
│   ├── ConsumptionBar.tsx                           ← NEW: progress bar + color status
│   ├── ConsumptionBar.test.tsx
│   ├── QuotaConsumptionTable.tsx                    ← NEW: per-dimension rows with bar + badges
│   ├── QuotaConsumptionTable.test.tsx
│   ├── CapabilityStatusGrid.tsx                     ← NEW: capability grid, enabled/disabled + source
│   ├── CapabilityStatusGrid.test.tsx
│   ├── OverrideIndicatorBadge.tsx                   ← NEW: superadmin override context badge
│   ├── OverrideIndicatorBadge.test.tsx
│   └── WorkspaceAllocationSummaryTable.tsx          ← NEW: allocation summary table (P2)
│   └── WorkspaceAllocationSummaryTable.test.tsx
├── services/
│   └── planManagementApi.ts                         ← EXTEND: ConsumptionSnapshot types + 3 new functions
└── router.tsx                                       ← EXTEND: add workspace dashboard + allocation summary routes

tests/integration/106-consumption-visibility-console/
├── fixtures/
│   ├── seed-tenant-with-plan-and-resources.mjs      ← provisions measurable resources per dimension
│   └── seed-workspace-with-sub-quotas.mjs           ← workspace sub-quotas + resources
├── tenant-consumption-snapshot.test.mjs             ← US-1, US-2: consumption counts + resolution
├── workspace-consumption.test.mjs                   ← US-4: workspace-level limits + consumption
├── allocation-summary.test.mjs                      ← US-5: per-dimension allocation arithmetic
├── unlimited-dimension.test.mjs                     ← US-2-SC-4: unlimited sentinel rendering
├── over-limit.test.mjs                              ← US-2-SC-3, US-3-SC-3: over-limit detection
└── isolation.test.mjs                               ← cross-tenant isolation for all new endpoints
```

**Structure Decision**: Extends `services/provisioning-orchestrator` and `apps/web-console` following the established pattern from 097–105. `consumption-repository.mjs` is a new module because consumption counting logic (joins against `workspaces`, `pg_databases`, etc.) is orthogonal to entitlement resolution logic and benefits from independent testability.

---

## Phase 0: Research Findings

See [research.md](./research.md) for full decision log.

### Key Decisions Summary

| # | Decision | Rationale |
|---|----------|-----------|
| R-01 | Consumption counts via new `consumption-repository.mjs` querying provisioning tables per dimension key | Keeps consumption logic isolated from entitlement resolution; each dimension maps to a COUNT query against the appropriate provisioning table |
| R-02 | `tenant-effective-entitlements-get` extended with `?include=consumption` query param; when absent, no consumption join (backwards compatible) | Existing callers from T03 are unaffected; T04 console passes `include=consumption` |
| R-03 | New `CurrentEffectiveEntitlementSummary` shape already carries `observedUsage`, `usageStatus`, `usageUnknownReason` — no TypeScript API client changes to types, only new functions needed | `planManagementApi.ts` was forward-designed in T03 to accommodate T04 |
| R-04 | Three new APISIX routes added to `plan-management-routes.yaml`: `GET /v1/tenant/consumption`, `GET /v1/tenants/{tenantId}/consumption`, `GET /v1/tenant/allocation-summary` — follows same route pattern as `effective-entitlements` | Consistent auth chain; no new Lua plugins needed |
| R-05 | Workspace consumption at `GET /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption` (superadmin) and `GET /v1/workspaces/{workspaceId}/consumption` (workspace admin) | Follows workspace routing conventions already established in the console router |
| R-06 | Progress bar thresholds: `< 80%` = normal (green), `80–99%` = warning (amber), `≥ 100%` = over-limit (red); unlimited (`-1`) suppresses bar | Matches `ConsoleQuotaPostureBadge` semantic palette already in the codebase |
| R-07 | `resolveWorkspaceConsumption` queries the same provisioning tables with an additional `WHERE workspace_id = $workspaceId` filter | Consistent with how workspace sub-quotas scope resource ownership |
| R-08 | Allocation summary is a pure computation: `SELECT workspace_id, dimension_key, SUM(allocated_value)` from `workspace_sub_quotas` grouped, joined against tenant effective limits | No new table; arithmetic performed in repository layer, not the action |
| R-09 | Consumption data unavailability (DB timeout or missing dimension mapping) returns `{ observedUsage: null, usageStatus: "unknown", usageUnknownReason: "CONSUMPTION_QUERY_FAILED" }` per dimension — never hides the row | FR-018: graceful degradation with "data unavailable" indicator |
| R-10 | No Kafka events emitted by T04 — all writes that produce audit trails were established in T01–T03; T04 is strictly read-only | Constitution Principle II: minimal incremental scope |

---

## Phase 1: Data Model

See [data-model.md](./data-model.md) for full API surface and component contracts.

### No New Tables

T04 reads from tables created in T01–T03:

| Table | Source Task | T04 Usage |
|-------|-------------|-----------|
| `quota_dimension_catalog` | T01 | Dimension display labels and keys |
| `plans` | T01 | Plan display name, slug, status, description |
| `tenant_plan_assignments` | T01 | Current assignment |
| `quota_overrides` | T01 | Active overrides (for superadmin view) |
| `boolean_capability_catalog` | T02 | Capability display labels |
| `workspace_sub_quotas` | T03 | Workspace allocation values |
| `workspaces` | Pre-existing | COUNT for `max_workspaces` dimension |
| `pg_databases` | Pre-existing | COUNT for `max_pg_databases` dimension |
| `functions` | Pre-existing | COUNT for `max_functions` dimension |
| *(other provisioning tables)* | Pre-existing | COUNTs per registered dimension key |

### Consumption Snapshot Shape

The `tenant-consumption-snapshot-get` action returns:

```json
{
  "tenantId": "string",
  "snapshotAt": "ISO-8601",
  "dimensions": [
    {
      "dimensionKey": "max_workspaces",
      "displayLabel": "Workspaces",
      "unit": "count",
      "currentUsage": 3,
      "usageStatus": "within_limit | approaching_limit | at_limit | over_limit | unknown",
      "usageUnknownReason": null
    }
  ]
}
```

`usageStatus` is computed server-side against the tenant's effective limit so the console can render status without re-fetching entitlements:
- `within_limit`: usage < 80 % of effective limit
- `approaching_limit`: 80 % ≤ usage < 100 % of effective limit  
- `at_limit`: usage == effective limit
- `over_limit`: usage > effective limit
- `unknown`: consumption query failed; `usageUnknownReason` is set

### Extended `tenant-effective-entitlements-get` Response (`?include=consumption`)

When `include=consumption` is passed, each `quantitativeLimits` item gains:

```json
{
  "currentUsage": 3,
  "usageStatus": "within_limit",
  "usageUnknownReason": null
}
```

The `CurrentEffectiveEntitlementSummary` TypeScript type in `planManagementApi.ts` already has these optional fields (`observedUsage`, `usageStatus`, `usageUnknownReason`) and requires no type changes.

### Workspace Consumption Shape

`workspace-consumption-get` (new action) returns:

```json
{
  "tenantId": "string",
  "workspaceId": "string",
  "snapshotAt": "ISO-8601",
  "dimensions": [
    {
      "dimensionKey": "max_pg_databases",
      "displayLabel": "PostgreSQL Databases",
      "unit": "count",
      "tenantEffectiveValue": 20,
      "workspaceLimit": 6,
      "workspaceSource": "workspace_sub_quota | tenant_shared_pool",
      "currentUsage": 4,
      "usageStatus": "within_limit"
    }
  ]
}
```

### Workspace Allocation Summary Shape

`tenant-workspace-allocation-summary-get` returns:

```json
{
  "tenantId": "string",
  "dimensions": [
    {
      "dimensionKey": "max_pg_databases",
      "displayLabel": "PostgreSQL Databases",
      "unit": "count",
      "tenantEffectiveValue": 20,
      "totalAllocated": 13,
      "unallocated": 7,
      "workspaces": [
        { "workspaceId": "ws-prod", "allocatedValue": 8 },
        { "workspaceId": "ws-dev",  "allocatedValue": 5 }
      ],
      "isFullyAllocated": false
    }
  ]
}
```

`tenantEffectiveValue = -1` (unlimited): `totalAllocated` is the sum of finite sub-quotas; `unallocated` is `null`; no percentage shown.

### New `consumption-repository.mjs` — Dimension-to-Table Mapping

```js
// Static registry — extensible as new dimensions are added to quota_dimension_catalog
const DIMENSION_QUERY_MAP = {
  max_workspaces:       (client, tenantId) => countQuery(client, 'workspaces',   { tenant_id: tenantId }),
  max_pg_databases:     (client, tenantId) => countQuery(client, 'pg_databases', { tenant_id: tenantId }),
  max_functions:        (client, tenantId) => countQuery(client, 'functions',     { tenant_id: tenantId }),
  max_kafka_topics:     (client, tenantId) => countQuery(client, 'kafka_topics',  { tenant_id: tenantId }),
  max_realtime_channels:(client, tenantId) => countQuery(client, 'realtime_channels', { tenant_id: tenantId }),
  max_storage_gb:       (client, tenantId) => sumQuery(client, 'storage_objects', 'size_bytes', tenantId, 1e9),
  max_monthly_api_calls:(client, tenantId) => monthlyCountQuery(client, 'api_call_logs', { tenant_id: tenantId }),
  max_members:          (client, tenantId) => countQuery(client, 'workspace_members', { tenant_id: tenantId }),
}
// Unknown dimension keys return { currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'NO_QUERY_MAPPING' }
```

All dimension queries are executed in parallel (`Promise.allSettled`) and individual failures degrade to `usageStatus: 'unknown'` without failing the whole request (R-09).

### Console Component Contracts

#### `ConsumptionBar`

```typescript
interface ConsumptionBarProps {
  current: number | null      // null → "data unavailable" render
  limit: number               // -1 → unlimited render
  label?: string              // accessibility label
}
// Colors: < 80% → emerald, 80–99% → amber, ≥ 100% → red, null → muted
// Unlimited: renders current count + "Unlimited" label, no bar
```

#### `QuotaConsumptionTable`

```typescript
interface QuotaDimensionRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  effectiveValue: number        // -1 = unlimited
  source: 'override' | 'plan' | 'catalog_default'
  quotaType: 'hard' | 'soft'
  currentUsage: number | null
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
  // Superadmin extras (optional)
  overriddenFromValue?: number | null
  originalPlanValue?: number | null
}
interface QuotaConsumptionTableProps {
  rows: QuotaDimensionRow[]
  showOverrideDetails?: boolean  // true for superadmin view
}
```

#### `CapabilityStatusGrid`

```typescript
interface CapabilityRow {
  capabilityKey: string
  displayLabel: string
  enabled: boolean
  source: 'plan' | 'catalog_default'
}
interface CapabilityStatusGridProps {
  capabilities: CapabilityRow[]
}
// Renders a responsive grid; enabled → green check badge, disabled → muted dash badge
```

#### `OverrideIndicatorBadge`

```typescript
interface OverrideIndicatorBadgeProps {
  overriddenFromValue: number   // original plan-level value
  overrideValue: number         // current effective value (override)
}
// Shows amber "Override" badge with tooltip: "Plan: {original} → Override: {current}"
```

#### `WorkspaceAllocationSummaryTable`

```typescript
interface AllocationSummaryRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  tenantEffectiveValue: number  // -1 = unlimited
  totalAllocated: number
  unallocated: number | null    // null when unlimited
  workspaces: { workspaceId: string; allocatedValue: number }[]
  isFullyAllocated: boolean
}
interface WorkspaceAllocationSummaryTableProps {
  rows: AllocationSummaryRow[]
}
```

---

## Phase 1: Contracts

See [`contracts/`](./contracts/) for full JSON schemas.

### API Routes (extensions to `plan-management-routes.yaml`)

| Method | Path | Auth | Action | Description |
|--------|------|------|--------|-------------|
| `GET` | `/v1/tenant/plan/consumption` | tenant owner JWT | `tenant-consumption-snapshot-get` | Tenant owner: own consumption snapshot |
| `GET` | `/v1/tenants/{tenantId}/plan/consumption` | superadmin JWT | `tenant-consumption-snapshot-get` | Superadmin: any tenant's consumption |
| `GET` | `/v1/tenant/plan/allocation-summary` | tenant owner JWT | `tenant-workspace-allocation-summary-get` | Tenant owner: allocation summary |
| `GET` | `/v1/workspaces/{workspaceId}/consumption` | workspace admin JWT | `workspace-consumption-get` | Workspace admin: own workspace consumption |
| `GET` | `/v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption` | superadmin JWT | `workspace-consumption-get` | Superadmin: any workspace consumption |

Note: `tenant-effective-entitlements-get` is extended via `?include=consumption` — no new APISIX route needed for the combined view; the existing route is reused.

### Console Route Extensions (`router.tsx`)

```text
/console/my-plan                     → ConsoleTenantPlanOverviewPage  (EXTEND: consumption)
/console/my-plan/allocation          → ConsoleTenantAllocationSummaryPage  (NEW, P2)
/console/workspaces/:workspaceId     → ConsoleWorkspaceDashboardPage  (NEW, P2)
/console/tenants/:tenantId/plan      → ConsoleTenantPlanPage  (EXTEND: entitlement+consumption superadmin view)
```

---

## Implementation Sequence

1. **Step 1 — `consumption-repository.mjs`** (no external deps on T04 changes): Implement dimension-to-table map and parallel query executor with graceful per-dimension error handling. Unit tests with mock `pg.Client`.

2. **Step 2 — Extend `effective-entitlements-repository.mjs`**: Add `resolveTenantConsumption(client, tenantId)` and `resolveWorkspaceConsumption(client, tenantId, workspaceId)` exports that call into `consumption-repository.mjs`.

3. **Step 3 — New backend actions** (parallel):
   - Extend `tenant-effective-entitlements-get.mjs` with `?include=consumption` branch
   - `tenant-consumption-snapshot-get.mjs`
   - `workspace-consumption-get.mjs`
   - `tenant-workspace-allocation-summary-get.mjs`

4. **Step 4 — APISIX route additions** (parallel with Step 3): Extend `plan-management-routes.yaml` with 5 new consumption routes.

5. **Step 5 — Backend integration tests** (requires Step 3+4): `tests/integration/106-consumption-visibility-console/`.

6. **Step 6 — Console components** (parallel with Steps 3–5): `ConsumptionBar`, `QuotaConsumptionTable`, `CapabilityStatusGrid`, `OverrideIndicatorBadge`, `WorkspaceAllocationSummaryTable` with vitest unit tests.

7. **Step 7 — Extend `planManagementApi.ts`**: Add `ConsumptionSnapshot`, `WorkspaceConsumptionResponse`, `AllocationSummary` types; add `getTenantConsumption`, `getWorkspaceConsumption`, `getTenantAllocationSummary` functions.

8. **Step 8 — Console pages** (requires Step 6+7):
   - Extend `ConsoleTenantPlanOverviewPage` to pass `?include=consumption` and render `QuotaConsumptionTable` + `CapabilityStatusGrid`
   - Extend `ConsoleTenantPlanPage` to add superadmin entitlement+consumption panel with `showOverrideDetails`
   - `ConsoleWorkspaceDashboardPage` (P2)
   - `ConsoleTenantAllocationSummaryPage` (P2)

9. **Step 9 — Router wiring + nav** (requires Step 8): Add routes to `router.tsx`, add nav links in relevant sidebar/nav sections.

10. **Step 10 — E2E smoke test + AGENTS.md update**.

### Parallelizable

- Steps 3–5 (backend) and Steps 6–7 (frontend components + API client) are fully parallel after Step 2 completes.

---

## Risks, Rollback, and Observability

| Risk | Mitigation |
|------|------------|
| Consumption query timeout for large tenants | Per-dimension `Promise.allSettled` timeout (500 ms); degraded row shows `usageStatus: 'unknown'` |
| Missing dimension-to-table mapping for new catalog entries | Registry lookup returns `unknown` with `usageUnknownReason: 'NO_QUERY_MAPPING'`; additive registry update required when new dimensions are seeded |
| T03 action not deployed | T04 depends on `tenant-effective-entitlements-get` existing; CI gate checks action presence in deployment manifest |
| Stale consumption data between page loads | All consumption API calls are uncached fetch (no SWR/React Query in this codebase); FR-017 satisfied by direct fetch on mount |
| Progress bar accessibility | `ConsumptionBar` exposes `aria-label`, `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`; color is never the sole indicator |

**Rollback**: All T04 changes are additive (new routes, new actions, new UI). Rolling back means removing the new APISIX routes (which have no downstream dependents), marking new actions as disabled, and removing new page imports from the router. Existing T01–T03 data and routes are unaffected.

**No Kafka events** in T04. No audit trail entries. Pure read path.

---

## Testing Strategy

### Integration Tests (`tests/integration/106-consumption-visibility-console/`)

| Test file | Scenarios covered |
|-----------|-------------------|
| `tenant-consumption-snapshot.test.mjs` | US-1, US-2: correct counts for each dimension; `usageStatus` thresholds; no-plan tenant returns catalog defaults |
| `workspace-consumption.test.mjs` | US-4: sub-quota limit respected; shared-pool indicator when no sub-quota |
| `allocation-summary.test.mjs` | US-5: sum(sub-quotas) + unallocated = effective limit; unlimited tenant; fully-allocated indicator |
| `unlimited-dimension.test.mjs` | SC-4: `-1` never shows percentage; `currentUsage` still present |
| `over-limit.test.mjs` | SC-3: usage > limit → `over_limit` status; value shown correctly |
| `isolation.test.mjs` | Tenant A cannot read Tenant B's consumption snapshot |

### Component Unit Tests (vitest + RTL)

- `ConsumptionBar.test.tsx`: renders progress at 30%, 85%, 100%, 115%, null (unavailable), -1 (unlimited)
- `QuotaConsumptionTable.test.tsx`: renders source badges, override details toggle, unknown-data indicator
- `CapabilityStatusGrid.test.tsx`: all 7 capabilities rendered, enabled/disabled labeling
- `OverrideIndicatorBadge.test.tsx`: tooltip content with original plan value
- `WorkspaceAllocationSummaryTable.test.tsx`: arithmetic display, unlimited row rendering

### Page Tests (vitest + RTL + MSW mocks)

- `ConsoleTenantPlanOverviewPage.test.tsx` (extend): verifies consumption bar renders, no-plan-state
- `ConsoleWorkspaceDashboardPage.test.tsx`: workspace limit vs sub-quota vs shared-pool rendering
- `ConsoleTenantAllocationSummaryPage.test.tsx`: allocation totals, fully-allocated indicator

---

## Criteria of Done (Verifiable)

| # | Criterion | Evidence |
|---|-----------|----------|
| DoD-01 | `tenant-consumption-snapshot-get` action returns correct counts for all 8 initial dimensions | Integration test `tenant-consumption-snapshot.test.mjs` passes |
| DoD-02 | `tenant-effective-entitlements-get?include=consumption` returns entitlements + consumption in one response | Existing T03 contract test extended; snapshot fields present |
| DoD-03 | `workspace-consumption-get` returns workspace-level limits and consumption with correct `workspaceSource` | Integration test `workspace-consumption.test.mjs` passes |
| DoD-04 | `tenant-workspace-allocation-summary-get` arithmetic is correct: `totalAllocated + unallocated = tenantEffectiveValue` (or unlimited) | Integration test `allocation-summary.test.mjs` passes |
| DoD-05 | `ConsumptionBar` renders green/amber/red thresholds and handles null/unlimited correctly | Component tests pass; Storybook visual (if present) or snapshot comparison |
| DoD-06 | `ConsoleTenantPlanOverviewPage` shows plan identity, all quota rows with progress bars, all 7 capabilities | Page test + manual QA on dev environment |
| DoD-07 | Superadmin `ConsoleTenantPlanPage` shows override indicators and original plan values for overridden dimensions | Page test with `showOverrideDetails=true` fixture |
| DoD-08 | `ConsoleWorkspaceDashboardPage` shows workspace limits (sub-quota or shared-pool) with consumption counts | Page test + manual QA |
| DoD-09 | `ConsoleTenantAllocationSummaryPage` shows total/allocated/unallocated per dimension, including unlimited row | Page test + arithmetic assertion |
| DoD-10 | Cross-tenant isolation: tenant A's consumption is not accessible from tenant B's session | Isolation test passes; 403 response confirmed |
| DoD-11 | Consumption data unavailability (dimension query fails) shows "data unavailable" indicator, not hidden row | Unit test simulating `Promise.reject` for one dimension query |
| DoD-12 | All new routes added to `plan-management-routes.yaml`; CI smoke test returns 200 for each authenticated request | CI pipeline green |
| DoD-13 | `AGENTS.md` updated with T04 additions | PR diff includes AGENTS.md change |
