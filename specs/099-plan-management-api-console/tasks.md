# Tasks: Plan Management API & Console

**Feature**: `099-plan-management-api-console`  
**Task ID**: US-PLAN-01-T03  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment` ✅), US-PLAN-01-T02 (`098-plan-base-limits` ✅)  
**Generated**: 2026-03-31

---

## File Path Map

All files created or modified by this task:

```
services/gateway-config/routes/
└── plan-management-routes.yaml                              [NEW]

apps/web-console/src/services/
└── planManagementApi.ts                                     [NEW]

apps/web-console/src/components/console/
├── PlanStatusBadge.tsx                                      [NEW]
├── PlanStatusBadge.test.tsx                                 [NEW]
├── PlanCapabilityBadge.tsx                                  [NEW]
├── PlanCapabilityBadge.test.tsx                             [NEW]
├── PlanLimitsTable.tsx                                      [NEW]
├── PlanLimitsTable.test.tsx                                 [NEW]
├── PlanComparisonView.tsx                                   [NEW]
├── PlanComparisonView.test.tsx                              [NEW]
├── PlanAssignmentDialog.tsx                                 [NEW]
├── PlanAssignmentDialog.test.tsx                            [NEW]
├── PlanHistoryTable.tsx                                     [NEW]
└── PlanHistoryTable.test.tsx                                [NEW]

apps/web-console/src/pages/
├── ConsolePlanCatalogPage.tsx                               [NEW]
├── ConsolePlanCatalogPage.test.tsx                          [NEW]
├── ConsolePlanDetailPage.tsx                                [NEW]
├── ConsolePlanDetailPage.test.tsx                           [NEW]
├── ConsolePlanCreatePage.tsx                                [NEW]
├── ConsolePlanCreatePage.test.tsx                           [NEW]
├── ConsoleTenantPlanPage.tsx                                [NEW]
├── ConsoleTenantPlanPage.test.tsx                           [NEW]
├── ConsoleTenantPlanOverviewPage.tsx                        [NEW]
└── ConsoleTenantPlanOverviewPage.test.tsx                   [NEW]

apps/web-console/src/router/
└── routes.tsx                                               [MODIFY — add plan routes + route guards]

tests/integration/099-plan-management-api-console/
├── fixtures/
│   ├── seed-plans.mjs                                       [NEW]
│   ├── seed-tenants.mjs                                     [NEW]
│   └── seed-assignments.mjs                                 [NEW]
├── plan-api.test.mjs                                        [NEW]
├── plan-assignment-api.test.mjs                             [NEW]
├── plan-limits-api.test.mjs                                 [NEW]
├── plan-auth.test.mjs                                       [NEW]
└── plan-isolation.test.mjs                                  [NEW]

AGENTS.md                                                    [MODIFY — append plan-management-api section]
specs/099-plan-management-api-console/
├── research.md                                              [NEW]
├── data-model.md                                            [NEW]
├── quickstart.md                                            [NEW]
└── contracts/
    ├── plan-management-superadmin.json                      [NEW]
    ├── plan-management-tenant-owner.json                    [NEW]
    └── console-component-contracts.md                      [NEW]
```

---

## Phase 1-A — APISIX Gateway Routes

### T-01 · Write `plan-management-routes.yaml`

**File**: `services/gateway-config/routes/plan-management-routes.yaml`  
**Why first**: All API contract tests depend on routes being registered. Unlocks parallel API test writing.

Define 13 routes following the existing YAML pattern in `services/gateway-config/routes/`. Each route:
- Specifies `uri`, `methods`, `upstream` (provisioning-orchestrator OpenWhisk endpoint), and `plugins`.
- Superadmin routes: `jwt-auth` + `consumer-restriction` (require `superadmin` role claim in JWT).
- Tenant-owner routes (`GET /v1/tenant/plan`, `GET /v1/tenant/plan/limits`): `jwt-auth` only; tenantId extracted from JWT in the action layer.

Routes to declare:

| Method | URI | OpenWhisk Action |
|--------|-----|-----------------|
| POST | /v1/plans | plan-create |
| GET | /v1/plans | plan-list |
| GET | /v1/plans/:planIdOrSlug | plan-get |
| PUT | /v1/plans/:planId | plan-update |
| POST | /v1/plans/:planId/lifecycle | plan-lifecycle |
| PUT | /v1/plans/:planId/limits/:dimensionKey | plan-limits-set |
| DELETE | /v1/plans/:planId/limits/:dimensionKey | plan-limits-remove |
| GET | /v1/plans/:planId/limits | plan-limits-profile-get |
| GET | /v1/quota-dimensions | quota-dimension-catalog-list |
| POST | /v1/tenants/:tenantId/plan | plan-assign |
| GET | /v1/tenants/:tenantId/plan | plan-assignment-get |
| GET | /v1/tenants/:tenantId/plan/history | plan-assignment-history |
| GET | /v1/tenant/plan | plan-assignment-get (tenant-scoped) |
| GET | /v1/tenant/plan/limits | plan-limits-tenant-get |

**Acceptance**:
- File parseable as valid YAML.
- Each route has `uri`, `methods`, `upstream`, and at minimum `jwt-auth` plugin.
- Superadmin routes have `consumer-restriction` plugin configured.
- Smoke test: unauthenticated GET `/v1/plans` returns 401.

---

## Phase 1-B — Console API Client

### T-02 · Write `planManagementApi.ts`

**File**: `apps/web-console/src/services/planManagementApi.ts`  
**Why before pages**: Every page component imports from this module. Must exist before page scaffolding.

Implement typed `fetch` wrappers for all plan management endpoints. Export:

```typescript
// Types (co-locate in same file or import from a types file in same directory)
type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived';
interface Plan { id: string; slug: string; displayName: string; description: string; status: PlanStatus; capabilities: Record<string, boolean>; quotaDimensions: Record<string, number>; assignedTenantCount: number; createdAt: string; updatedAt: string; }
interface LimitProfileRow { dimensionKey: string; label: string; unit: string; effectiveValue: number | null; isExplicit: boolean; isUnlimited: boolean; platformDefault: number | null; }
interface Assignment { id: string; tenantId: string; planId: string; planSlug: string; planDisplayName: string; effectiveFrom: string; supersededAt: string | null; actorId: string; }
interface PlanApiError extends Error { code: string; detail?: unknown; }

// Functions
listPlans(params?: { status?: PlanStatus; page?: number; pageSize?: number }): Promise<{ items: Plan[]; total: number; page: number; pageSize: number }>
createPlan(body: { slug: string; displayName: string; description?: string; capabilities?: Record<string, boolean>; quotaDimensions?: Record<string, number> }): Promise<Plan>
getPlan(planIdOrSlug: string): Promise<Plan>
updatePlan(planId: string, body: Partial<Pick<Plan, 'displayName' | 'description' | 'capabilities' | 'quotaDimensions'>>): Promise<Plan>
transitionPlanLifecycle(planId: string, body: { targetStatus: PlanStatus }): Promise<Plan>
getPlanLimitsProfile(planId: string): Promise<LimitProfileRow[]>
setPlanLimit(planId: string, dimensionKey: string, value: number): Promise<void>
removePlanLimit(planId: string, dimensionKey: string): Promise<void>
listQuotaDimensions(): Promise<Array<{ key: string; label: string; unit: string; platformDefault: number | null }>>
assignPlan(tenantId: string, body: { planId: string }): Promise<Assignment>
getTenantCurrentPlan(tenantId: string): Promise<Assignment | null>
getTenantPlanHistory(tenantId: string, params?: { page?: number; pageSize?: number }): Promise<{ items: Assignment[]; total: number; page: number; pageSize: number }>
getMyPlan(): Promise<Assignment | null>
getMyPlanLimits(): Promise<LimitProfileRow[]>
```

Error handling:
- All functions throw `PlanApiError` on non-2xx responses, reading the platform error envelope `{ error: { code, message, detail } }`.
- Callers check `err.code === 'CONCURRENT_ASSIGNMENT_CONFLICT'` to surface retry prompts.

**Acceptance**:
- TypeScript compiles with no errors.
- Each exported function has a JSDoc comment referencing the backing endpoint.
- `PlanApiError` is exported so callers can `instanceof`-check.

---

## Phase 1-C — Shared Console Components

### T-03 · `PlanStatusBadge`

**Files**: `apps/web-console/src/components/console/PlanStatusBadge.tsx` + `.test.tsx`

Props: `status: PlanStatus`  
Renders a `<Badge>` (shadcn/ui) with:
- `draft` → slate/secondary variant, text "Draft"
- `active` → green/success variant, text "Active"
- `deprecated` → amber/warning variant, text "Deprecated"
- `archived` → zinc/outline variant, text "Archived"

Test coverage:
- All 4 statuses render correct text and variant class.
- Component is accessible (text not solely color-dependent).

---

### T-04 · `PlanCapabilityBadge`

**Files**: `apps/web-console/src/components/console/PlanCapabilityBadge.tsx` + `.test.tsx`

Props: `enabled: boolean; label: string`  
Renders a `<Badge>` with:
- `enabled=true` → green variant, text "{label}: Enabled", `aria-label="{label} is enabled"`
- `enabled=false` → grey/secondary variant, text "{label}: Disabled", `aria-label="{label} is disabled"`

Test coverage:
- Enabled renders correct variant and aria-label.
- Disabled renders correct variant and aria-label.

---

### T-05 · `PlanLimitsTable`

**Files**: `apps/web-console/src/components/console/PlanLimitsTable.tsx` + `.test.tsx`

Props:
```typescript
interface PlanLimitsTableProps {
  rows: LimitProfileRow[];
  editable: boolean;
  onUpdate?: (dimensionKey: string, value: number | null) => void; // null = revert to default
}
```

Renders a table with columns: Label, Value (input or read-only), Unit, Source (Explicit / Platform Default / Unlimited).

Edit mode behavior:
- Number input for explicit values; validates non-negative integer only.
- "Set Unlimited" toggle: stores sentinel value `-1`; displays "Unlimited" string.
- "Use Platform Default" link: calls `onUpdate(key, null)`.
- When `editable=false`: all inputs disabled; no action links shown.

Test coverage:
- Renders all rows in read-only mode with correct labels and values.
- Edit mode: typing invalid value (negative, decimal) shows inline error and does not call `onUpdate`.
- Edit mode: toggling "Unlimited" calls `onUpdate` with `-1`.
- Edit mode: "Use Platform Default" calls `onUpdate` with `null`.
- `editable=false`: inputs are disabled.

---

### T-06 · `PlanComparisonView`

**Files**: `apps/web-console/src/components/console/PlanComparisonView.tsx` + `.test.tsx`

Props:
```typescript
interface PlanComparisonViewProps {
  currentPlan: { displayName: string; capabilities: Record<string, boolean>; limits: LimitProfileRow[] };
  targetPlan: { displayName: string; capabilities: Record<string, boolean>; limits: LimitProfileRow[] };
}
```

Renders two-column comparison table. Sections: Capabilities, Limits.

Diff logic (client-side):
- Limit increased → green cell with ↑ indicator.
- Limit decreased → amber/red cell with ↓ indicator.
- Limit unchanged → neutral cell.
- Capability changed true→false or false→true → highlighted cell.
- New dimension in target not in current → shown as new row.

Test coverage:
- Increased numeric limit renders green class.
- Decreased numeric limit renders amber/red class.
- Unchanged value renders neutral.
- Capability flip (true→false) renders highlighted.
- Empty limits arrays render without errors.

---

### T-07 · `PlanAssignmentDialog`

**Files**: `apps/web-console/src/components/console/PlanAssignmentDialog.tsx` + `.test.tsx`

Props:
```typescript
interface PlanAssignmentDialogProps {
  open: boolean;
  tenantId: string;
  currentAssignment: Assignment | null;
  activePlans: Plan[];
  onConfirm: (planId: string) => Promise<void>;
  onClose: () => void;
}
```

Multi-step dialog:
1. **Step 1 — Select Plan**: dropdown of `activePlans` only (never draft/deprecated/archived); "Next" disabled until selection.
2. **Step 2 — Compare** (only if changing an existing plan): renders `PlanComparisonView` with current vs. selected plan data; "Back" and "Confirm" buttons.
3. **Step 3 — Confirming**: loading spinner; "Confirm" button disabled.

On `onConfirm` rejection with code `CONCURRENT_ASSIGNMENT_CONFLICT`: show retry prompt ("Another admin just changed this tenant's plan. Refresh and try again.").

Test coverage:
- Dropdown only renders active plans (none with status draft/deprecated/archived).
- Without existing assignment: skips to confirmation without comparison view.
- With existing assignment: step 2 shows `PlanComparisonView`.
- `onConfirm` called with correct planId.
- `CONCURRENT_ASSIGNMENT_CONFLICT` error renders retry prompt.
- Dialog close calls `onClose`.

---

### T-08 · `PlanHistoryTable`

**Files**: `apps/web-console/src/components/console/PlanHistoryTable.tsx` + `.test.tsx`

Props:
```typescript
interface PlanHistoryTableProps {
  assignments: Assignment[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading: boolean;
}
```

Columns: Plan Name, Effective From (formatted date), Superseded At ("Current" if null), Actor.  
Renders paginator when `total > pageSize`.

Test coverage:
- `supersededAt=null` renders "Current" string.
- Paginator not rendered when `total <= pageSize`.
- Paginator rendered and `onPageChange` called on navigation when `total > pageSize`.
- Loading state renders skeleton rows.

---

## Phase 1-D — Console Pages

### T-09 · `ConsolePlanCatalogPage`

**Files**: `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx` + `.test.tsx`

Superadmin-only page at route `/admin/plans`.

State: `{ plans, total, page, pageSize, statusFilter: PlanStatus | 'all', loading, error }`

On mount: calls `listPlans({ status: statusFilter !== 'all' ? statusFilter : undefined, page, pageSize })`.

Renders:
- Page title "Plan Catalog" + "Create Plan" button (navigates to `/admin/plans/new`).
- Status filter tabs: All / Draft / Active / Deprecated / Archived.
- Paginated table: slug, display name, `PlanStatusBadge`, assigned tenant count, last modified (relative date).
- Row click navigates to `/admin/plans/:planId`.
- Empty state: "No plans found" + "Create your first plan" CTA (when catalog is empty and filter is "all").
- Loading state: skeleton table rows.
- Error state: `ConsolePageState` error with retry.

Test coverage:
- Renders loading skeleton before data.
- Renders table rows after data.
- Status filter change re-fetches with correct status param.
- Empty state renders with CTA when `total=0` and filter is `'all'`.
- Row click navigates to correct detail URL.
- "Create Plan" button navigates to `/admin/plans/new`.

---

### T-10 · `ConsolePlanDetailPage`

**Files**: `apps/web-console/src/pages/ConsolePlanDetailPage.tsx` + `.test.tsx`

Superadmin-only page at route `/admin/plans/:planId`.

State: `{ plan, limits, tenants, activeTab, loading, error, saving }`

On mount: parallel fetch of `getPlan(planId)` and `getPlanLimitsProfile(planId)`.

Tab: **Info**
- Display name (editable inline for draft/active), description (editable), slug (read-only), status badge, created/modified timestamps.
- Lifecycle action buttons conditional on current status:
  - draft → "Activate" button
  - active → "Deprecate" button
  - deprecated → "Archive" button
- Each button opens `DestructiveConfirmationDialog` explaining implications.
- Archive: if action returns `422 ARCHIVE_BLOCKED_ACTIVE_TENANTS`, show blocking tenant list in the dialog body.

Tab: **Capabilities**
- List of capability key/value pairs from `plan.capabilities`.
- Toggle switches in edit mode for draft/active plans.
- Read-only for deprecated/archived with explanatory banner.

Tab: **Limits**
- `PlanLimitsTable` with `editable={plan.status === 'draft' || plan.status === 'active'}`.
- On update: calls `setPlanLimit` or `removePlanLimit`; active plan changes show confirmation dialog first.
- Read-only banner for deprecated/archived plans.

Tab: **Assigned Tenants**
- Paginated list of tenants currently on this plan; each row links to tenant detail.

Test coverage:
- All 4 tabs render without errors.
- Lifecycle buttons conditionally visible per status.
- `DestructiveConfirmationDialog` opens on lifecycle button click.
- Limits tab: `PlanLimitsTable` receives `editable=true` for active plan and `editable=false` for deprecated plan.
- Archive blocked error renders tenant list in dialog.

---

### T-11 · `ConsolePlanCreatePage`

**Files**: `apps/web-console/src/pages/ConsolePlanCreatePage.tsx` + `.test.tsx`

Superadmin-only page at route `/admin/plans/new`.

State: `{ slug, displayName, description, capabilities, quotaDimensions, saving, fieldErrors }`

Form fields:
- **Slug**: text input; validates `/^[a-z0-9-]+$/` on change; async uniqueness check on blur (calls `getPlan(slug)`: 404 = available, 200 = conflict). Shows inline error "Slug already exists" on conflict.
- **Display Name**: required text input.
- **Description**: optional textarea.
- **Capabilities**: dynamic key/value list of boolean toggles (start empty; add row button).
- **Quota Dimensions**: dynamic key/value list of number inputs (start empty; add row button).

On submit: calls `createPlan(...)`. On success: navigates to `/admin/plans/:newPlanId`. On `409 PLAN_SLUG_CONFLICT`: sets inline slug field error without full-page error.

Test coverage:
- Slug validation rejects uppercase and special characters inline.
- Async uniqueness check: mock 200 response → shows conflict error; mock 404 → shows available.
- Empty display name → submit disabled.
- Successful submit navigates to detail page.
- `409` response sets slug field error, does not navigate.

---

### T-12 · `ConsoleTenantPlanPage`

**Files**: `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` + `.test.tsx`

Superadmin-only page/section at route `/admin/tenants/:tenantId/plan` (or embedded as a tab in existing tenant detail page — follow the existing tenant detail tab pattern).

State: `{ currentAssignment, activePlans, history, historyTotal, historyPage, loading, error, showAssignDialog }`

On mount: parallel fetch of `getTenantCurrentPlan(tenantId)` and `listPlans({ status: 'active' })` and `getTenantPlanHistory(tenantId, { page: 1, pageSize: 20 })`.

Renders:
- **Current Plan card**: plan display name + `PlanStatusBadge` + effective-from date. "No plan assigned" message if null.
- **Assign Plan / Change Plan button**: opens `PlanAssignmentDialog`.
- On confirm: calls `assignPlan(tenantId, { planId })`, refetches current assignment and history.
- **Plan History**: `PlanHistoryTable` with paginated history data.

Test coverage:
- Renders "No plan assigned" when `currentAssignment=null`.
- Renders current plan card with correct data.
- "Assign Plan" button opens dialog.
- Confirm assignment calls `assignPlan` and refetches.
- `PlanHistoryTable` receives correct props.

---

### T-13 · `ConsoleTenantPlanOverviewPage`

**Files**: `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` + `.test.tsx`

Tenant-owner page at route `/tenant/plan` (scoped to authenticated tenant's workspace).

State: `{ assignment, plan, limits, loading, error }`

On mount: parallel fetch of `getMyPlan()` and `getMyPlanLimits()`.

Renders:
- **Plan overview card**: plan display name, description, status badge.
- **Capabilities section**: list of `PlanCapabilityBadge` (green=enabled, grey=disabled) for each capability key.
- **Limits section**: read-only table with columns: Label, Value (or "Unlimited"), Unit. Values come from `getMyPlanLimits()` effective values. Unlimited sentinel `-1` renders as "Unlimited" text.
- **No plan assigned empty state**: clear "No plan assigned" message; no broken capability/limits tables (sections hidden when assignment is null).

Test coverage:
- Renders empty state when `assignment=null`.
- Renders capability badges with correct enabled/disabled state.
- Unlimited sentinel (`-1`) renders as "Unlimited" text, not "-1".
- Loading state renders before data.
- Error state renders with retry option.

---

## Phase 1-E — API Integration Tests

### T-14 · Fixtures

**Files**:
- `tests/integration/099-plan-management-api-console/fixtures/seed-plans.mjs`
- `tests/integration/099-plan-management-api-console/fixtures/seed-tenants.mjs`
- `tests/integration/099-plan-management-api-console/fixtures/seed-assignments.mjs`

Each fixture is a Node.js ESM module exporting an async `seed()` and `teardown()` function.

`seed-plans.mjs`: inserts test plans via `pg` directly into `plans` table:
- `plan-test-draft` (draft), `plan-test-active` (active), `plan-test-deprecated` (deprecated).
- Returns `{ draftPlanId, activePlanId, deprecatedPlanId }`.

`seed-tenants.mjs`: inserts two test tenants (`tenant-alpha`, `tenant-beta`) into `tenants` table.  
Returns `{ tenantAlphaId, tenantBetaId }`.

`seed-assignments.mjs`: assigns `plan-test-active` to `tenant-alpha` using the `plan-assign` action directly (not via HTTP) to establish history baseline.

---

### T-15 · `plan-api.test.mjs`

**File**: `tests/integration/099-plan-management-api-console/plan-api.test.mjs`

Uses `node:test`, `node:assert`, `undici`. Requires superadmin auth token from env `SUPERADMIN_TOKEN`.

Test cases:
1. `POST /v1/plans` with valid body → 201, response contains `id`, `slug`, `status: 'draft'`.
2. `POST /v1/plans` with duplicate slug → 409, `error.code = 'PLAN_SLUG_CONFLICT'`.
3. `GET /v1/plans` (no filter) → 200, `items` array, `total >= 1`, pagination fields present.
4. `GET /v1/plans?status=active` → 200, all items have `status: 'active'`.
5. `GET /v1/plans?status=draft&page=1&pageSize=2` → 200, `items.length <= 2`.
6. `GET /v1/plans/:planId` (by ID) → 200, correct plan returned.
7. `GET /v1/plans/:slug` (by slug) → 200, correct plan returned.
8. `GET /v1/plans/nonexistent-slug` → 404, `error.code = 'PLAN_NOT_FOUND'`.
9. `PUT /v1/plans/:planId` → 200, updated fields reflected.
10. `POST /v1/plans/:planId/lifecycle` `{ targetStatus: 'active' }` from draft → 200, `status: 'active'`.
11. `POST /v1/plans/:planId/lifecycle` invalid transition (archived → active) → 422.
12. `GET /v1/quota-dimensions` → 200, at least 8 dimensions, each has `key`, `label`, `unit`, `platformDefault`.
13. p95 latency assertion: 20 sequential `GET /v1/plans` calls all complete under 2000 ms.

---

### T-16 · `plan-assignment-api.test.mjs`

**File**: `tests/integration/099-plan-management-api-console/plan-assignment-api.test.mjs`

Test cases:
1. `POST /v1/tenants/:tenantId/plan` with active plan → 200, `planId` matches, `supersededAt=null`.
2. Second `POST /v1/tenants/:tenantId/plan` with different active plan → 200, previous assignment `supersededAt` is set, new assignment is current.
3. `POST /v1/tenants/:tenantId/plan` with deprecated plan → 422, `error.code = 'PLAN_ASSIGNMENT_INVALID_STATUS'`.
4. `POST /v1/tenants/nonexistent/plan` → 404, `error.code = 'TENANT_NOT_FOUND'`.
5. `GET /v1/tenants/:tenantId/plan` after assignment → 200, current assignment returned.
6. `GET /v1/tenants/:tenantId/plan` with no assignment → 200, `{ assignment: null }` (or 404 with code `NO_PLAN_ASSIGNED` — assert whichever the action returns).
7. `GET /v1/tenants/:tenantId/plan/history` → 200, `items` array ordered reverse-chronological, pagination metadata present.
8. `GET /v1/tenants/:tenantId/plan/history?page=1&pageSize=1` → 200, `items.length = 1`.

---

### T-17 · `plan-limits-api.test.mjs`

**File**: `tests/integration/099-plan-management-api-console/plan-limits-api.test.mjs`

Test cases:
1. `GET /v1/plans/:planId/limits` → 200, returns array of rows with `dimensionKey`, `effectiveValue`, `isExplicit`, `platformDefault`.
2. `PUT /v1/plans/:planId/limits/max_workspaces` `{ value: 10 }` → 200, subsequent GET shows `effectiveValue: 10`, `isExplicit: true`.
3. `PUT /v1/plans/:planId/limits/max_workspaces` `{ value: -1 }` (unlimited) → 200, `isUnlimited: true`.
4. `DELETE /v1/plans/:planId/limits/max_workspaces` → 200, subsequent GET shows `isExplicit: false`, `effectiveValue = platformDefault`.
5. `PUT /v1/plans/:planId/limits/nonexistent_dimension` → 422, `error.code = 'DIMENSION_NOT_FOUND'`.
6. Tenant-owner `GET /v1/tenant/plan/limits` (with `TENANT_OWNER_TOKEN` env) → 200, returns effective limits for authenticated tenant's plan.
7. Tenant-owner `GET /v1/tenant/plan/limits` for tenant with no plan → 200 with empty array or 404 with appropriate code.

---

### T-18 · `plan-auth.test.mjs`

**File**: `tests/integration/099-plan-management-api-console/plan-auth.test.mjs`

Test cases:
1. Unauthenticated `GET /v1/plans` → 401.
2. Unauthenticated `POST /v1/plans` → 401.
3. Unauthenticated `POST /v1/tenants/:tenantId/plan` → 401.
4. Tenant-owner token calling `POST /v1/plans` (superadmin-only) → 403.
5. Tenant-owner token calling `PUT /v1/plans/:planId/limits/:key` → 403.
6. Tenant-owner token calling `POST /v1/plans/:planId/lifecycle` → 403.
7. Tenant-owner token calling `GET /v1/tenant/plan` (own plan) → 200.
8. Superadmin token calling `GET /v1/tenants/:tenantId/plan` → 200.
9. Expired JWT token → 401.

---

### T-19 · `plan-isolation.test.mjs`

**File**: `tests/integration/099-plan-management-api-console/plan-isolation.test.mjs`

Uses two tenant owner tokens: `TENANT_ALPHA_TOKEN`, `TENANT_BETA_TOKEN`.

Test cases:
1. Tenant alpha owner calls `GET /v1/tenant/plan` → returns alpha's assignment (not beta's).
2. Tenant alpha owner calls `GET /v1/tenant/plan/limits` → returns alpha's plan limits (not beta's).
3. Tenant alpha owner cannot call `GET /v1/tenants/:tenantBetaId/plan` → 403.
4. Tenant alpha owner cannot call `POST /v1/tenants/:tenantBetaId/plan` → 403.
5. Two simultaneous superadmin requests to `POST /v1/tenants/:tenantId/plan` with different plans → exactly one succeeds (200), one receives 409 `CONCURRENT_ASSIGNMENT_CONFLICT`.

---

## Phase 1-F — Router Registration & Route Guards

### T-20 · Register console routes and add route guards

**File**: `apps/web-console/src/router/routes.tsx` (MODIFY)

Add to the router configuration:

Superadmin routes (guarded by `<SuperadminRouteGuard />`):
- `/admin/plans` → `ConsolePlanCatalogPage`
- `/admin/plans/new` → `ConsolePlanCreatePage`
- `/admin/plans/:planId` → `ConsolePlanDetailPage`
- `/admin/tenants/:tenantId/plan` → `ConsoleTenantPlanPage`

Tenant-owner routes (guarded by `<TenantOwnerRouteGuard />`):
- `/tenant/plan` → `ConsoleTenantPlanOverviewPage`

Route guard behavior (extend existing guard pattern):
- `SuperadminRouteGuard`: if user lacks `superadmin` role claim → redirect to `/tenant/plan`.
- `TenantOwnerRouteGuard`: if unauthenticated → redirect to login.

Also add navigation entries:
- Superadmin sidebar: "Plans" link under the platform admin section → `/admin/plans`.
- Tenant sidebar: "My Plan" link under workspace settings → `/tenant/plan`.

**Acceptance**:
- Navigating to `/admin/plans` as a tenant owner redirects to `/tenant/plan`.
- Navigating to `/tenant/plan` as unauthenticated redirects to login.
- All 5 new page routes resolve correctly for authorized users.

---

## Phase 1-G — Documentation

### T-21 · `research.md`

**File**: `specs/099-plan-management-api-console/research.md`

Document the research findings from Phase 0 decisions (R-01 through R-06):
- APISIX routing pattern reference (link to existing route YAML files used as reference).
- Pagination convention decision and rationale.
- Console API client pattern decision.
- Plan comparison client-side diff rationale.
- Route guard pattern reference.
- Component reuse decisions.

---

### T-22 · `data-model.md`

**File**: `specs/099-plan-management-api-console/data-model.md`

Document:
- The 14 API endpoints with request/response shapes (TypeScript interface notation).
- Console component hierarchy diagram (text-based: which pages contain which components).
- `planManagementApi.ts` exported function signatures.
- Error code catalog: all `PlanApiError.code` values with HTTP status and triggering condition.

---

### T-23 · `contracts/plan-management-superadmin.json`

**File**: `specs/099-plan-management-api-console/contracts/plan-management-superadmin.json`

OpenAPI 3.1 JSON document covering all 12 superadmin endpoints with:
- Request body schemas (required/optional fields, types, constraints).
- Response schemas for 200/201 success cases.
- Error response schemas for all documented error codes per endpoint.
- `securitySchemes`: `bearerAuth` (Keycloak JWT).

---

### T-24 · `contracts/plan-management-tenant-owner.json`

**File**: `specs/099-plan-management-api-console/contracts/plan-management-tenant-owner.json`

OpenAPI 3.1 JSON document covering the 2 tenant-owner endpoints:
- `GET /v1/tenant/plan`
- `GET /v1/tenant/plan/limits`

Include success and error response schemas and `securitySchemes`.

---

### T-25 · `contracts/console-component-contracts.md`

**File**: `specs/099-plan-management-api-console/contracts/console-component-contracts.md`

Markdown document listing every new component and page with:
- Full TypeScript props interface.
- Internal state shape.
- Key behavior contract (what it renders in each loading/error/data state).

---

### T-26 · `quickstart.md`

**File**: `specs/099-plan-management-api-console/quickstart.md`

Developer quickstart covering:
1. Prerequisites (T01/T02 deployed, env vars for tokens).
2. How to run API integration tests: `node --test tests/integration/099-plan-management-api-console/*.test.mjs`.
3. How to run console component tests: `pnpm --filter web-console test`.
4. Required env vars: `SUPERADMIN_TOKEN`, `TENANT_ALPHA_TOKEN`, `TENANT_BETA_TOKEN`, `TENANT_OWNER_TOKEN`, `API_BASE_URL`.
5. How to seed fixtures manually: `node tests/integration/099-plan-management-api-console/fixtures/seed-plans.mjs`.

---

### T-27 · Update `AGENTS.md`

**File**: `AGENTS.md` (MODIFY)

Append under `<!-- MANUAL ADDITIONS START -->` section:

```markdown
## Plan Management API & Console (099-plan-management-api-console)

- REST API surface (14 endpoints) wired as APISIX → OpenWhisk proxy routes; defined in `services/gateway-config/routes/plan-management-routes.yaml`.
- No new PostgreSQL tables; all data access through T01/T02 actions (`plan-create`, `plan-list`, `plan-get`, `plan-update`, `plan-lifecycle`, `plan-assign`, `plan-assignment-get`, `plan-assignment-history`, `plan-limits-set`, `plan-limits-remove`, `plan-limits-profile-get`, `plan-limits-tenant-get`, `quota-dimension-catalog-list`).
- Console typed API client: `apps/web-console/src/services/planManagementApi.ts`.
- New console pages (superadmin): `ConsolePlanCatalogPage`, `ConsolePlanDetailPage`, `ConsolePlanCreatePage`, `ConsoleTenantPlanPage`.
- New console page (tenant owner): `ConsoleTenantPlanOverviewPage`.
- New shared components: `PlanStatusBadge`, `PlanCapabilityBadge`, `PlanLimitsTable`, `PlanComparisonView`, `PlanAssignmentDialog`, `PlanHistoryTable`.
- Plan comparison is computed client-side by diffing `plan-limits-profile-get` + `plan-get` responses; no new backend endpoint.
- Superadmin routes guarded by `SuperadminRouteGuard`; tenant-owner routes by `TenantOwnerRouteGuard`.
- Integration tests: `tests/integration/099-plan-management-api-console/` (5 test files, 3 fixture modules).
- Error code `CONCURRENT_ASSIGNMENT_CONFLICT` (409): surfaced as a retry prompt in `PlanAssignmentDialog`; serialized at backend by T01's `SELECT FOR UPDATE`.
- Archive blocked: `422 ARCHIVE_BLOCKED_ACTIVE_TENANTS` parsed by console to show blocking tenant list in the confirmation dialog.
```

---

## Criteria of Done

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| DoD-01 | APISIX `plan-management-routes.yaml` present and valid YAML | `yamllint` passes; smoke `curl` returns 401 unauthenticated |
| DoD-02 | `planManagementApi.ts` compiles with no TypeScript errors | `pnpm --filter web-console tsc --noEmit` exits 0 |
| DoD-03 | All 6 shared components have passing unit tests | `pnpm --filter web-console test components/console/Plan*` exits 0 |
| DoD-04 | All 5 pages have passing component tests | `pnpm --filter web-console test pages/Console*Plan*` exits 0 |
| DoD-05 | Route guards redirect tenant owners away from superadmin plan routes | Navigation test in `ConsolePlanCatalogPage.test.tsx` asserts redirect |
| DoD-06 | API contract tests pass against live dev environment | `node --test tests/integration/099-plan-management-api-console/plan-api.test.mjs` exits 0 |
| DoD-07 | Assignment and auth tests pass | `plan-assignment-api.test.mjs`, `plan-auth.test.mjs` exit 0 |
| DoD-08 | Isolation tests pass (no cross-tenant data leakage) | `plan-isolation.test.mjs` exits 0 |
| DoD-09 | p95 latency < 2 s for plan list endpoint | Assertion in `plan-api.test.mjs` T-15 case 13 passes |
| DoD-10 | Documentation artifacts present and non-empty | `ls specs/099-plan-management-api-console/` shows all 6 expected files/dirs |
| DoD-11 | `AGENTS.md` updated | Section "Plan Management API & Console" present under manual additions |
| DoD-12 | CI passes (`pnpm run ci`) | GitHub Actions green on feature branch |
| DoD-13 | No regressions in unrelated 070/072 specs | `git status` shows 070/072 spec files unmodified |
