# Implementation Plan: Plan Management API & Console

**Branch**: `099-plan-management-api-console` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-PLAN-01-T03 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment`), US-PLAN-01-T02 (`098-plan-base-limits`)  
**Input**: Feature specification from `specs/099-plan-management-api-console/spec.md`

## Summary

Expose the platform's plan management capabilities (entity CRUD, lifecycle transitions, tenant assignment, base limit management, and quota dimension catalog) through a **REST API surface** and an **administrative console UI**. The backend actions from T01/T02 (`plan-create`, `plan-assign`, `plan-limits-set`, etc.) are already implemented; this task wires those OpenWhisk actions to APISIX routes, enforces auth at the gateway layer, and builds the React+shadcn/ui console pages for superadmins and tenant owners. No new PostgreSQL tables are introduced; all data access flows through the existing T01/T02 action contracts.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces); React 18 + TypeScript (console)  
**Primary Dependencies**: `pg` (PostgreSQL, read-only fixtures in tests), `kafkajs` (event verification in tests), `undici` (HTTP contract tests against APISIX), React 18, Tailwind CSS, shadcn/ui (console), Apache OpenWhisk action wrappers (established pattern)  
**Storage**: PostgreSQL (existing tables: `plans`, `tenant_plan_assignments`, `plan_audit_events`, `quota_dimension_catalog` — no new tables)  
**Testing**: `node:test` (Node 20 native runner), `node:assert`, `undici` (API contract tests), React Testing Library + vitest (console component/page tests), `pg` (fixture queries)  
**Target Platform**: Kubernetes / OpenShift (Helm), Apache APISIX (gateway routing + auth), Apache OpenWhisk (serverless backend)  
**Project Type**: API surface (APISIX routes → OpenWhisk actions) + web-console pages (React SPA)  
**Performance Goals**: API responses < 2 s p95; console pages render < 3 s including data fetch (SC-005)  
**Constraints**: Multi-tenant isolation enforced at the action and gateway layer; superadmin-only mutations; tenant-owner read-only self-service; all mutations audited via Kafka  
**Scale/Scope**: Catalog supports ≥100 plans; console pages cover 6 distinct views (catalog, detail, assignment, history, tenant owner overview, quota dimension catalog)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | Console pages under `apps/web-console/src/pages/`; console components under `apps/web-console/src/components/console/`; APISIX route config under `services/gateway-config/`; no new top-level folders |
| II. Incremental Delivery | ✅ PASS | Builds on committed T01/T02 backend; delivers API surface + console only; enforcement deferred to US-PLAN-02 |
| III. K8s / OpenShift Compatibility | ✅ PASS | APISIX route additions via existing `services/gateway-config` pattern; no OpenShift-specific manifests needed |
| IV. Quality Gates | ✅ PASS | New `node:test` API integration tests + React Testing Library component tests added; root CI scripts updated |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, data-model.md, contracts/, quickstart.md, and AGENTS.md update constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new frameworks introduced.

## Project Structure

### Documentation (this feature)

```text
specs/099-plan-management-api-console/
├── plan.md              ← This file (Phase 1 planning output)
├── spec.md              ← Feature specification (already materialized)
├── research.md          ← Phase 0 output (routing patterns, auth, console patterns)
├── data-model.md        ← Phase 1 output (API surface contracts, console component map)
├── quickstart.md        ← Phase 1 output (local dev and test execution)
└── contracts/           ← Phase 1 output (OpenAPI-style request/response schemas)
    ├── plan-management-superadmin.json      ← Consolidated superadmin API contract
    ├── plan-management-tenant-owner.json    ← Tenant owner read-only API contract
    └── console-component-contracts.md      ← Console component props/state contracts
```

### Source Code (repository root)

```text
apps/web-console/src/
├── pages/
│   ├── ConsolePlanCatalogPage.tsx           ← NEW: superadmin plan catalog list + filters
│   ├── ConsolePlanCatalogPage.test.tsx      ← NEW: unit/component tests
│   ├── ConsolePlanDetailPage.tsx            ← NEW: superadmin plan detail (tabbed: info, capabilities, limits, tenants)
│   ├── ConsolePlanDetailPage.test.tsx       ← NEW
│   ├── ConsolePlanCreatePage.tsx            ← NEW: plan creation form (superadmin)
│   ├── ConsolePlanCreatePage.test.tsx       ← NEW
│   ├── ConsoleTenantPlanPage.tsx            ← NEW: tenant plan section on tenant detail (superadmin view)
│   ├── ConsoleTenantPlanPage.test.tsx       ← NEW
│   ├── ConsoleTenantPlanOverviewPage.tsx    ← NEW: tenant owner self-service plan overview
│   └── ConsoleTenantPlanOverviewPage.test.tsx  ← NEW
├── components/console/
│   ├── PlanStatusBadge.tsx                  ← NEW: badge for plan lifecycle status
│   ├── PlanStatusBadge.test.tsx             ← NEW
│   ├── PlanCapabilityBadge.tsx              ← NEW: enabled/disabled capability badge
│   ├── PlanCapabilityBadge.test.tsx         ← NEW
│   ├── PlanLimitsTable.tsx                  ← NEW: read/edit table for quota dimensions
│   ├── PlanLimitsTable.test.tsx             ← NEW
│   ├── PlanComparisonView.tsx               ← NEW: side-by-side plan comparison (current vs. target)
│   ├── PlanComparisonView.test.tsx          ← NEW
│   ├── PlanAssignmentDialog.tsx             ← NEW: modal for assigning/changing plan on a tenant
│   ├── PlanAssignmentDialog.test.tsx        ← NEW
│   ├── PlanHistoryTable.tsx                 ← NEW: paginated plan assignment history table
│   └── PlanHistoryTable.test.tsx            ← NEW
├── services/
│   └── planManagementApi.ts                 ← NEW: typed API client for all plan management endpoints

services/gateway-config/
├── routes/
│   └── plan-management-routes.yaml          ← NEW: APISIX route definitions for plan API
└── plugins/
    └── (existing scope-enforcement.lua reused — no changes needed)

tests/
└── integration/
    └── 099-plan-management-api-console/
        ├── fixtures/
        │   ├── seed-plans.mjs               ← ensure test plans exist before API tests
        │   ├── seed-tenants.mjs             ← ensure test tenants exist
        │   └── seed-assignments.mjs         ← create baseline assignments for history tests
        ├── plan-api.test.mjs                ← API contract tests: CRUD, lifecycle, pagination
        ├── plan-assignment-api.test.mjs     ← assignment + history endpoint tests
        ├── plan-limits-api.test.mjs         ← limits profile and tenant-owner read tests
        ├── plan-auth.test.mjs               ← auth enforcement: 401/403 scenarios
        └── plan-isolation.test.mjs          ← multi-tenant isolation verification
```

**Structure Decision**: Console pages use the established `apps/web-console/src/pages/Console*.tsx` naming convention. New shared components follow the existing `apps/web-console/src/components/console/` pattern. No new top-level folders. APISIX route configuration follows the existing `services/gateway-config/routes/` YAML pattern.

## Phase 0: Research

### Research Questions Resolved

**R-01: APISIX Route Pattern for OpenWhisk Actions**  
- Decision: APISIX routes use `proxy-rewrite` + `openwhisk` consumer pattern established in `services/gateway-config`; plan routes follow the same `x-api-key` + Keycloak JWT validation chain already used by `privilege-domain-*` and `scope-enforcement-*` routes.
- Rationale: Consistent with all existing provisioning-orchestrator action routes; no new auth primitives needed.

**R-02: Pagination Convention**  
- Decision: Offset-based pagination with `page` (1-indexed) and `pageSize` (default 20, max 100) query parameters; response envelope includes `total`, `page`, `pageSize`, `items`. Mirrors the `plan-list` contract from T01.
- Rationale: T01 already defines this shape; consistency prevents breaking consumers.

**R-03: Console API Client Pattern**  
- Decision: Single `planManagementApi.ts` service module using `fetch` with typed response interfaces; mirrors existing page-scoped fetchers like `ConsoleCapabilityCatalogPage`'s `defaultFetcher` but extracted as a shared service for reuse across the 5+ new pages.
- Rationale: Avoids duplicating fetch logic across multiple pages; enables mocking in tests.

**R-04: Plan Comparison View**  
- Decision: Client-side comparison by fetching both plan limit profiles and capabilities in parallel, then computing diff in-browser. No new backend endpoint needed.
- Rationale: The `plan-limits-profile-get` and `plan-get` actions from T01/T02 provide all required data; server-side diffing would be premature optimization.

**R-05: Route Guards for Tenant Owner vs. Superadmin**  
- Decision: Extend existing React Router route guard pattern (used by `ConsolePrivilegeDomainPage`) to protect superadmin-only plan routes; tenant-owner routes use existing workspace-scoped auth context.
- Rationale: No new auth primitives; leverages established patterns.

**R-06: Console Component Reuse**  
- Decision: `DestructiveConfirmationDialog.tsx` (existing) reused for Activate/Deprecate/Archive lifecycle actions and plan change confirmation. `ConsolePageState.tsx` (existing) handles loading/error/empty states.
- Rationale: Consistency with existing console UX; avoids new dialog implementations.

## Phase 1: Design & Contracts

### API Surface Design

All plan management API endpoints are thin APISIX → OpenWhisk proxy routes. The APISIX layer enforces authentication (Keycloak JWT or service API key) and authorization (superadmin role claim). The OpenWhisk actions (from T01/T02) contain all business logic and data access.

#### Superadmin Endpoints

| Method | Path | Action | Description |
|--------|------|--------|-------------|
| `POST` | `/v1/plans` | `plan-create` | Create a new plan (draft) |
| `GET` | `/v1/plans` | `plan-list` | List plans (filter: status, page, pageSize) |
| `GET` | `/v1/plans/:planIdOrSlug` | `plan-get` | Get plan by ID or slug |
| `PUT` | `/v1/plans/:planId` | `plan-update` | Update plan metadata, capabilities, quota_dimensions |
| `POST` | `/v1/plans/:planId/lifecycle` | `plan-lifecycle` | Transition plan lifecycle status |
| `PUT` | `/v1/plans/:planId/limits/:dimensionKey` | `plan-limits-set` | Set/update a base limit on a plan |
| `DELETE` | `/v1/plans/:planId/limits/:dimensionKey` | `plan-limits-remove` | Remove explicit limit (revert to default) |
| `GET` | `/v1/plans/:planId/limits` | `plan-limits-profile-get` | Get full limits profile for a plan |
| `GET` | `/v1/quota-dimensions` | `quota-dimension-catalog-list` | List all quota dimension catalog entries |
| `POST` | `/v1/tenants/:tenantId/plan` | `plan-assign` | Assign or change plan for a tenant |
| `GET` | `/v1/tenants/:tenantId/plan` | `plan-assignment-get` | Get current plan assignment for a tenant |
| `GET` | `/v1/tenants/:tenantId/plan/history` | `plan-assignment-history` | Paginated plan assignment history for a tenant |

#### Tenant Owner Endpoints (scoped to authenticated tenant)

| Method | Path | Action | Description |
|--------|------|--------|-------------|
| `GET` | `/v1/tenant/plan` | `plan-assignment-get` | Get own current plan assignment |
| `GET` | `/v1/tenant/plan/limits` | `plan-limits-tenant-get` | Get own plan's complete limits profile |

#### Error Envelope

All error responses follow the platform standard:

```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "No plan found with id '3fa85f64-...' or slug 'enterprise'.",
    "detail": {}
  }
}
```

Standard HTTP status codes: `400` (bad request), `401` (unauthenticated), `403` (forbidden), `404` (not found), `409` (conflict — e.g., duplicate slug, concurrent assignment), `422` (unprocessable — e.g., assigning deprecated plan), `429` (rate limited).

### Console Component Design

#### Pages

**ConsolePlanCatalogPage** (superadmin)
- State: `{ plans: Plan[], total: number, page: number, pageSize: number, statusFilter: PlanStatus | 'all', loading, error }`
- Renders: filterable/paginated table with columns: slug, display name, status (`PlanStatusBadge`), assigned tenant count, last-modified; "Create Plan" button navigates to `ConsolePlanCreatePage`; row click navigates to `ConsolePlanDetailPage`
- Empty state: "No plans found" with "Create your first plan" CTA when catalog is empty

**ConsolePlanDetailPage** (superadmin)
- State: `{ plan: Plan, limits: LimitProfile[], tenants: TenantSummary[], activeTab: 'info' | 'capabilities' | 'limits' | 'tenants', loading, error, saving }`
- Tab: **Info** — display name, description, slug, status, created/modified metadata; lifecycle action buttons (Activate, Deprecate, Archive) each invoking `DestructiveConfirmationDialog` before committing
- Tab: **Capabilities** — list of capability keys with toggle (`PlanCapabilityBadge`); inline edit for draft/active plans; read-only for deprecated/archived
- Tab: **Limits** — `PlanLimitsTable` in edit mode for draft/active; read-only banner for deprecated/archived; explicit/default/unlimited indicators
- Tab: **Assigned Tenants** — paginated list of tenants currently on this plan

**ConsolePlanCreatePage** (superadmin)
- State: `{ slug, displayName, description, capabilities: Record<string, boolean>, saving, errors }`
- Slug field: lowercase-alphanumeric-hyphen validation + async uniqueness check on blur; error message if conflict
- On submit: calls `POST /v1/plans`, then navigates to new plan's detail page

**ConsoleTenantPlanPage** (superadmin, embedded in tenant detail or standalone)
- State: `{ currentAssignment: Assignment | null, history: Assignment[], loading, error, showAssignDialog, showHistoryTab }`
- Sections: current plan card (plan name, status badge, effective-from date), "Assign Plan" / "Change Plan" button opening `PlanAssignmentDialog`, plan history (`PlanHistoryTable`)

**ConsoleTenantPlanOverviewPage** (tenant owner)
- State: `{ assignment: Assignment | null, plan: Plan | null, limits: TenantLimitProfile[], loading, error }`
- Renders: plan name + description; capabilities list with `PlanCapabilityBadge` (enabled=green, disabled=grey); limits table with human-readable labels, values, units; "No plan assigned" empty state with clear message and no broken tables

#### Shared Components

**PlanStatusBadge**: renders lifecycle status as a colored badge (draft=slate, active=green, deprecated=amber, archived=zinc).

**PlanCapabilityBadge**: `enabled` prop → green "Enabled" badge; `false` → grey "Disabled" badge. Accessible: uses `aria-label`.

**PlanLimitsTable**: Props: `dimensions: LimitProfileRow[]`, `editable: boolean`, `onUpdate: (key, value) => void`. Each row: label, value input (number or "Unlimited" toggle or "Platform Default" indicator), unit badge. Validates: non-negative integers only; `-1` sentinel stored when "Unlimited" toggled.

**PlanComparisonView**: Props: `currentPlan: LimitProfile`, `targetPlan: LimitProfile`. Renders two-column table; diff computed client-side; increased values shown in green, decreased in amber/red, unchanged in neutral.

**PlanAssignmentDialog**: Props: `tenantId: string`, `currentPlanId: string | null`, `activePlans: Plan[]`, `onConfirm: (planId) => void`. Step 1: dropdown of active plans only. Step 2 (if changing): `PlanComparisonView`. Step 3: confirm button with loading state.

**PlanHistoryTable**: Props: `tenantId: string`, `fetcher`. Paginated table: plan name, effective-from, superseded-at ("Current" if null), actor. Row click → detail view with plan snapshot.

### Console API Client (`planManagementApi.ts`)

Typed functions wrapping `fetch`:

```typescript
// Plan catalog
listPlans(params: { status?: PlanStatus; page?: number; pageSize?: number }): Promise<PlanListResponse>
createPlan(body: CreatePlanRequest): Promise<Plan>
getPlan(planIdOrSlug: string): Promise<Plan>
updatePlan(planId: string, body: UpdatePlanRequest): Promise<Plan>
transitionPlanLifecycle(planId: string, body: LifecycleRequest): Promise<Plan>

// Plan limits
getPlanLimitsProfile(planId: string): Promise<LimitProfileResponse>
setPlanLimit(planId: string, dimensionKey: string, value: number): Promise<void>
removePlanLimit(planId: string, dimensionKey: string): Promise<void>
listQuotaDimensions(): Promise<QuotaDimensionCatalogResponse>

// Tenant plan assignment
assignPlan(tenantId: string, body: AssignPlanRequest): Promise<Assignment>
getTenantCurrentPlan(tenantId: string): Promise<Assignment>
getTenantPlanHistory(tenantId: string, params: PaginationParams): Promise<AssignmentHistoryResponse>

// Tenant owner self-service
getMyPlan(): Promise<Assignment>
getMyPlanLimits(): Promise<TenantLimitProfileResponse>
```

Error handling: throws typed `PlanApiError` with `code`, `message`, and optional `detail`. All callers check for `409 CONCURRENT_ASSIGNMENT_CONFLICT` and surface a retry prompt.

### APISIX Route Configuration

File: `services/gateway-config/routes/plan-management-routes.yaml`

Follows existing route YAML pattern:
- `uri` patterns for each endpoint above
- `upstream`: `provisioning-orchestrator` OpenWhisk endpoint
- `plugins`: `openwhisk` (action name), `jwt-auth` (Keycloak), `consumer-restriction` (superadmin role claim for admin routes; tenant-scope check for tenant-owner routes)
- `methods`: restricted per endpoint (GET, POST, PUT, DELETE as appropriate)

No new Lua plugins required; `scope-enforcement.lua` from 093 already validates plan-access scope claims if `SCOPE_ENFORCEMENT_ENABLED=true`.

## Complexity Tracking

No constitution violations. No complexity exceptions required.

## Testing Strategy

### Unit / Component Tests (React Testing Library + vitest)

- Each new page component: renders loading state, renders error state, renders data, empty state.
- `PlanStatusBadge`: all 4 statuses render correct color classes.
- `PlanCapabilityBadge`: enabled/disabled renders correct labels and aria-labels.
- `PlanLimitsTable`: edit mode vs. read-only; unlimited toggle; validation rejection of negative values.
- `PlanComparisonView`: increased limits shown in green, decreased in amber, unchanged in neutral; empty catalog state.
- `PlanAssignmentDialog`: dropdown only shows active plans; step progression; confirm invokes callback with correct plan ID.
- `PlanHistoryTable`: paginator navigates correctly; "Current" shown for null superseded_at.

### API Contract Tests (node:test + undici)

File: `tests/integration/099-plan-management-api-console/`

- `plan-api.test.mjs`: create plan (201), list with status filter, get by ID, get by slug, update metadata, lifecycle transitions (valid and invalid), pagination boundaries.
- `plan-assignment-api.test.mjs`: assign plan to tenant (200), change plan (200 + superseded previous), get current assignment, get history (paginated).
- `plan-limits-api.test.mjs`: set limit (200), remove limit (200), get full profile (contains effective values), tenant-owner limits endpoint (scoped).
- `plan-auth.test.mjs`: unauthenticated → 401; tenant owner calling superadmin endpoints → 403; tenant owner calling own endpoints → 200; tenant owner calling other tenant endpoints → 403.
- `plan-isolation.test.mjs`: tenant A cannot read tenant B's assignment; tenant A cannot assign plan on behalf of tenant B.

### Integration / Smoke Tests

- Full superadmin flow: create plan → set limits → activate → assign to tenant → view in console catalog → change plan → view history.
- Tenant owner flow: login → navigate to plan overview → verify capabilities and limits displayed without server errors.

### Accessibility

- All new console pages: run `axe-core` checks; all interactive elements have accessible labels; color is not the sole differentiator (status badges include text).

## Risks, Migrations & Rollback

| Risk | Mitigation |
|------|-----------|
| APISIX route YAML merge conflict with sibling features | Routes scoped to `/v1/plans` and `/v1/tenant/plan` — no overlap with existing routes |
| Concurrent plan assignment in UI (two admins) | 409 `CONCURRENT_ASSIGNMENT_CONFLICT` surfaced as a retry prompt in `PlanAssignmentDialog`; no data corruption (T01's `SELECT FOR UPDATE` serializes backend) |
| Tenant owner sees another tenant's data | `plan-limits-tenant-get` and `plan-assignment-get` actions enforce tenant scoping at the action layer; API contract tests in `plan-isolation.test.mjs` verify |
| Active plan limit change without warning | `PlanLimitsTable` on active plans shows confirmation dialog before saving; audit event emitted by T02's `plan-limits-set` action |
| Archive rejected (tenants still assigned) | `plan-lifecycle` action returns `422 ARCHIVE_BLOCKED_ACTIVE_TENANTS`; console Archive action parses this error and shows a blocking-tenants list in the dialog |

**Rollback**: All changes are additive (new routes, new pages, new components). Rolling back means removing the APISIX route YAML additions and deleting the new page/component files. No database schema changes, no data migrations, no destructive changes.

**Idempotency**: Plan create uses slug uniqueness (409 on duplicate). Plan assignment uses T01's atomic swap (idempotent on same plan reassignment — supersedes self and creates new record; consumers should check `previousPlanId` to detect no-ops). Limit set/remove are idempotent by T02's semantics.

**Observability**: All mutations produce Kafka audit events (from T01/T02 actions). APISIX emits access logs per route. Console errors logged to browser console and surfaced in UI via `ConsolePageState` error boundary.

**Security**: Superadmin endpoints reject non-superadmin JWTs at the APISIX layer (`consumer-restriction` plugin). Tenant owner endpoints extract `tenantId` from JWT claims, never from a user-supplied body parameter. No secrets stored in console; API calls use existing session token.

## Dependencies, Parallelization & Sequencing

### Prerequisites (must be complete)

- T01 (`097-plan-entity-tenant-assignment`): OpenWhisk actions `plan-create`, `plan-list`, `plan-get`, `plan-update`, `plan-lifecycle`, `plan-assign`, `plan-assignment-get`, `plan-assignment-history` deployed and tested. ✅ Merged at `6818368`.
- T02 (`098-plan-base-limits`): OpenWhisk actions `quota-dimension-catalog-list`, `plan-limits-set`, `plan-limits-remove`, `plan-limits-profile-get`, `plan-limits-tenant-get` deployed and tested. ✅ Merged at `6818368`.

### Recommended Sequencing

1. **Phase 1-A** (no external dependencies): Write `services/gateway-config/routes/plan-management-routes.yaml` and deploy to dev environment. Run smoke test with `curl`.
2. **Phase 1-B** (parallel with 1-A): Create `planManagementApi.ts` service module with all typed wrappers and error handling.
3. **Phase 1-C** (requires 1-B): Build shared components (`PlanStatusBadge`, `PlanCapabilityBadge`, `PlanLimitsTable`, `PlanComparisonView`, `PlanAssignmentDialog`, `PlanHistoryTable`) with unit tests.
4. **Phase 1-D** (requires 1-A + 1-C): Build console pages in dependency order: `ConsolePlanCatalogPage` → `ConsolePlanDetailPage` → `ConsolePlanCreatePage` → `ConsoleTenantPlanPage` → `ConsoleTenantPlanOverviewPage`.
5. **Phase 1-E** (requires 1-A): Write API integration tests (`tests/integration/099-plan-management-api-console/`).
6. **Phase 1-F** (requires 1-D): Register new routes in the console's React Router config and sidebar navigation; add route guards.
7. **Phase 1-G** (requires all): Update `docs/adr/` with a brief ADR for the plan management API surface conventions; update `AGENTS.md`.

### Parallelizable

- 1-A (gateway routes) and 1-B+1-C (console API client + components) can proceed in parallel as they have no dependency on each other.

## Criteria of Done

| ID | Criterion | Verification |
|----|-----------|-------------|
| DoD-01 | APISIX routes for all 13 plan endpoints deployed to dev | `curl` smoke test returns 401 for unauthenticated request to each route |
| DoD-02 | Superadmin can create a plan, set limits, activate, and assign to a tenant via console in < 3 min | Manual walkthrough by reviewer (SC-001) |
| DoD-03 | Tenant owner can view their own plan, capabilities, and limits via console | Manual walkthrough logged in as tenant owner (SC-002) |
| DoD-04 | Every mutation produces a queryable audit event | Integration test in `plan-api.test.mjs` + `plan-assignment-api.test.mjs` asserts Kafka event emitted |
| DoD-05 | Plan comparison view shows all capability and limit differences | Component test `PlanComparisonView.test.tsx` covers increase, decrease, unchanged scenarios (SC-004) |
| DoD-06 | API responses < 2 s p95 under normal load | Load test using `undici` batch in `plan-api.test.mjs`; p95 asserted in test |
| DoD-07 | No cross-tenant data leakage | `plan-isolation.test.mjs` all assertions pass (SC-006) |
| DoD-08 | All error scenarios produce actionable feedback | `plan-auth.test.mjs` covers 401/403/404/409/422; console tests verify error notification renders |
| DoD-09 | Route guards prevent tenant owners from accessing superadmin pages | Navigation test: tenant-owner session redirected away from `/plans` admin route |
| DoD-10 | CI passes at root (lint, type-check, unit tests, integration tests) | `pnpm run ci` exits 0 in GitHub Actions |
| DoD-11 | `AGENTS.md` updated with plan management API surface conventions | Reviewer verifies section added under `<!-- MANUAL ADDITIONS -->` |
| DoD-12 | `specs/099-plan-management-api-console/` contains plan.md, research.md, data-model.md, quickstart.md, contracts/ | All files present and non-empty at PR merge |

## Expected Artifacts at Completion

```text
specs/099-plan-management-api-console/
├── plan.md              ← This file ✅
├── spec.md              ← Already materialized ✅
├── research.md          ← To be generated
├── data-model.md        ← To be generated
├── quickstart.md        ← To be generated
└── contracts/
    ├── plan-management-superadmin.json
    ├── plan-management-tenant-owner.json
    └── console-component-contracts.md

apps/web-console/src/pages/
├── ConsolePlanCatalogPage.tsx + .test.tsx
├── ConsolePlanDetailPage.tsx + .test.tsx
├── ConsolePlanCreatePage.tsx + .test.tsx
├── ConsoleTenantPlanPage.tsx + .test.tsx
└── ConsoleTenantPlanOverviewPage.tsx + .test.tsx

apps/web-console/src/components/console/
├── PlanStatusBadge.tsx + .test.tsx
├── PlanCapabilityBadge.tsx + .test.tsx
├── PlanLimitsTable.tsx + .test.tsx
├── PlanComparisonView.tsx + .test.tsx
├── PlanAssignmentDialog.tsx + .test.tsx
└── PlanHistoryTable.tsx + .test.tsx

apps/web-console/src/services/
└── planManagementApi.ts

services/gateway-config/routes/
└── plan-management-routes.yaml

tests/integration/099-plan-management-api-console/
├── fixtures/seed-plans.mjs
├── fixtures/seed-tenants.mjs
├── fixtures/seed-assignments.mjs
├── plan-api.test.mjs
├── plan-assignment-api.test.mjs
├── plan-limits-api.test.mjs
├── plan-auth.test.mjs
└── plan-isolation.test.mjs
```
