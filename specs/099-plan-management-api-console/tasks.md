# Tasks: Plan Management API & Console

**Branch**: `099-plan-management-api-console` | **Generated**: 2026-03-31  
**Task ID**: US-PLAN-01-T03 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment`), US-PLAN-01-T02 (`098-plan-base-limits`)

---

## File Path Map

> All paths are relative to `/root/projects/falcone`.
> During `speckit.implement`, read only the paths listed here plus `plan.md` and `tasks.md`.
> **Do not read** `apps/control-plane/openapi/control-plane.openapi.json` directly. Use only `apps/control-plane/openapi/families/platform.openapi.json`, then regenerate the full public API artifacts with `npm run generate:public-api`.

### Spec / docs artifacts

| Alias | Path | Action |
|------|------|--------|
| `TASKS` | `specs/099-plan-management-api-console/tasks.md` | MODIFY (checkbox progress only) |
| `PLAN` | `specs/099-plan-management-api-console/plan.md` | READ |
| `DATA_MODEL` | `specs/099-plan-management-api-console/data-model.md` | CREATE |
| `QUICKSTART` | `specs/099-plan-management-api-console/quickstart.md` | CREATE |
| `CONTRACT_SUPERADMIN` | `specs/099-plan-management-api-console/contracts/plan-management-superadmin.json` | CREATE |
| `CONTRACT_TENANT_OWNER` | `specs/099-plan-management-api-console/contracts/plan-management-tenant-owner.json` | CREATE |
| `CONTRACT_COMPONENTS` | `specs/099-plan-management-api-console/contracts/console-component-contracts.md` | CREATE |

### Existing backend action files (modify only if route / payload alignment requires it)

| Alias | Path | Action |
|------|------|--------|
| `ACTION_PLAN_CREATE` | `services/provisioning-orchestrator/src/actions/plan-create.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_LIST` | `services/provisioning-orchestrator/src/actions/plan-list.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_GET` | `services/provisioning-orchestrator/src/actions/plan-get.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_UPDATE` | `services/provisioning-orchestrator/src/actions/plan-update.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_LIFECYCLE` | `services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_ASSIGN` | `services/provisioning-orchestrator/src/actions/plan-assign.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_ASSIGNMENT_GET` | `services/provisioning-orchestrator/src/actions/plan-assignment-get.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_ASSIGNMENT_HISTORY` | `services/provisioning-orchestrator/src/actions/plan-assignment-history.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_LIMITS_PROFILE_GET` | `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_LIMITS_SET` | `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_LIMITS_REMOVE` | `services/provisioning-orchestrator/src/actions/plan-limits-remove.mjs` | MODIFY/REFERENCE |
| `ACTION_PLAN_LIMITS_TENANT_GET` | `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs` | MODIFY/REFERENCE |
| `ACTION_QUOTA_DIMENSION_CATALOG_LIST` | `services/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs` | MODIFY/REFERENCE |

### Gateway / public API surface

| Alias | Path | Action |
|------|------|--------|
| `GATEWAY_ROUTE` | `services/gateway-config/routes/plan-management-routes.yaml` | CREATE |
| `OPENAPI_FAMILY_PLATFORM` | `apps/control-plane/openapi/families/platform.openapi.json` | MODIFY |
| `PUBLIC_ROUTE_CATALOG_GATEWAY` | `services/gateway-config/public-route-catalog.json` | GENERATED |
| `PUBLIC_ROUTE_CATALOG_INTERNAL` | `services/internal-contracts/src/public-route-catalog.json` | GENERATED |

### Web console implementation

| Alias | Path | Action |
|------|------|--------|
| `API_CLIENT` | `apps/web-console/src/services/planManagementApi.ts` | CREATE |
| `PAGE_CATALOG` | `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx` | CREATE |
| `PAGE_CATALOG_TEST` | `apps/web-console/src/pages/ConsolePlanCatalogPage.test.tsx` | CREATE |
| `PAGE_DETAIL` | `apps/web-console/src/pages/ConsolePlanDetailPage.tsx` | CREATE |
| `PAGE_DETAIL_TEST` | `apps/web-console/src/pages/ConsolePlanDetailPage.test.tsx` | CREATE |
| `PAGE_CREATE` | `apps/web-console/src/pages/ConsolePlanCreatePage.tsx` | CREATE |
| `PAGE_CREATE_TEST` | `apps/web-console/src/pages/ConsolePlanCreatePage.test.tsx` | CREATE |
| `PAGE_TENANT_ADMIN` | `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` | CREATE |
| `PAGE_TENANT_ADMIN_TEST` | `apps/web-console/src/pages/ConsoleTenantPlanPage.test.tsx` | CREATE |
| `PAGE_TENANT_OWNER` | `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` | CREATE |
| `PAGE_TENANT_OWNER_TEST` | `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.test.tsx` | CREATE |
| `COMP_STATUS_BADGE` | `apps/web-console/src/components/console/PlanStatusBadge.tsx` | CREATE |
| `COMP_STATUS_BADGE_TEST` | `apps/web-console/src/components/console/PlanStatusBadge.test.tsx` | CREATE |
| `COMP_CAPABILITY_BADGE` | `apps/web-console/src/components/console/PlanCapabilityBadge.tsx` | CREATE |
| `COMP_CAPABILITY_BADGE_TEST` | `apps/web-console/src/components/console/PlanCapabilityBadge.test.tsx` | CREATE |
| `COMP_LIMITS_TABLE` | `apps/web-console/src/components/console/PlanLimitsTable.tsx` | CREATE |
| `COMP_LIMITS_TABLE_TEST` | `apps/web-console/src/components/console/PlanLimitsTable.test.tsx` | CREATE |
| `COMP_COMPARISON` | `apps/web-console/src/components/console/PlanComparisonView.tsx` | CREATE |
| `COMP_COMPARISON_TEST` | `apps/web-console/src/components/console/PlanComparisonView.test.tsx` | CREATE |
| `COMP_ASSIGNMENT_DIALOG` | `apps/web-console/src/components/console/PlanAssignmentDialog.tsx` | CREATE |
| `COMP_ASSIGNMENT_DIALOG_TEST` | `apps/web-console/src/components/console/PlanAssignmentDialog.test.tsx` | CREATE |
| `COMP_HISTORY_TABLE` | `apps/web-console/src/components/console/PlanHistoryTable.tsx` | CREATE |
| `COMP_HISTORY_TABLE_TEST` | `apps/web-console/src/components/console/PlanHistoryTable.test.tsx` | CREATE |
| `ROUTER` | `apps/web-console/src/router.tsx` | MODIFY |
| `ROUTER_TEST` | `apps/web-console/src/router.test.tsx` | MODIFY |
| `CONSOLE_SHELL_LAYOUT` | `apps/web-console/src/layouts/ConsoleShellLayout.tsx` | MODIFY |
| `CONSOLE_SHELL_LAYOUT_TEST` | `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx` | MODIFY |

### Integration / repository docs

| Alias | Path | Action |
|------|------|--------|
| `TEST_FIXTURE_PLANS` | `tests/integration/099-plan-management-api-console/fixtures/seed-plans.mjs` | CREATE |
| `TEST_FIXTURE_TENANTS` | `tests/integration/099-plan-management-api-console/fixtures/seed-tenants.mjs` | CREATE |
| `TEST_FIXTURE_ASSIGNMENTS` | `tests/integration/099-plan-management-api-console/fixtures/seed-assignments.mjs` | CREATE |
| `TEST_API` | `tests/integration/099-plan-management-api-console/plan-api.test.mjs` | CREATE |
| `TEST_ASSIGNMENT_API` | `tests/integration/099-plan-management-api-console/plan-assignment-api.test.mjs` | CREATE |
| `TEST_LIMITS_API` | `tests/integration/099-plan-management-api-console/plan-limits-api.test.mjs` | CREATE |
| `TEST_AUTH` | `tests/integration/099-plan-management-api-console/plan-auth.test.mjs` | CREATE |
| `TEST_ISOLATION` | `tests/integration/099-plan-management-api-console/plan-isolation.test.mjs` | CREATE |
| `AGENTS_DOC` | `AGENTS.md` | MODIFY |

### Read-only reference files allowed during implementation

| Alias | Path | Purpose |
|------|------|---------|
| `REF_CONSOLE_PAGE_STATE` | `apps/web-console/src/components/console/ConsolePageState.tsx` | loading/error/empty pattern |
| `REF_DESTRUCTIVE_DIALOG` | `apps/web-console/src/components/console/DestructiveConfirmationDialog.tsx` | confirmation flows |
| `REF_CAPABILITY_CATALOG_PAGE` | `apps/web-console/src/pages/ConsoleCapabilityCatalogPage.tsx` | page composition baseline |
| `REF_TENANTS_PAGE` | `apps/web-console/src/pages/ConsoleTenantsPage.tsx` | current console shell styling |
| `REF_PRIVILEGE_API_SERVICE` | `apps/web-console/src/services/privilege-domain-api.ts` | typed fetch wrapper pattern |
| `REF_GATEWAY_ROUTE_PATTERN` | `services/gateway-config/routes/workspace-capability-catalog.yaml` | APISIX route shape |
| `REF_PERMISSIONS_FIXTURES` | `apps/web-console/src/test/fixtures/permissions.ts` | role fixtures for tests |

---

## Execution Order

Follow this order. Do not skip ahead.

### Phase 1 — Documentation + contract completion

- [x] T001 Write `DATA_MODEL`, `QUICKSTART`, `CONTRACT_SUPERADMIN`, `CONTRACT_TENANT_OWNER`, and `CONTRACT_COMPONENTS` so the implemented API and UI surfaces have stable, reviewable contracts.
  - `plan-management-superadmin.json` must cover: `POST /v1/plans`, `GET /v1/plans`, `GET /v1/plans/{planIdOrSlug}`, `PUT /v1/plans/{planId}`, `POST /v1/plans/{planId}/lifecycle`, `GET /v1/plans/{planId}/limits`, `PUT /v1/plans/{planId}/limits/{dimensionKey}`, `DELETE /v1/plans/{planId}/limits/{dimensionKey}`, `GET /v1/quota-dimensions`, `POST /v1/tenants/{tenantId}/plan`, `GET /v1/tenants/{tenantId}/plan`, `GET /v1/tenants/{tenantId}/plan/history`.
  - `plan-management-tenant-owner.json` must cover: `GET /v1/tenant/plan`, `GET /v1/tenant/plan/limits`.
  - `console-component-contracts.md` must define prop/state expectations for `PlanStatusBadge`, `PlanCapabilityBadge`, `PlanLimitsTable`, `PlanComparisonView`, `PlanAssignmentDialog`, and `PlanHistoryTable`.

### Phase 2 — Gateway and public API surface

- [x] T002 Create `GATEWAY_ROUTE` to expose the existing plan actions through APISIX.
  - Superadmin routes must require admin auth and map one-to-one to the existing OpenWhisk actions.
  - Tenant-owner routes must be read-only and scoped to the authenticated tenant.
  - Include correlation-id and prometheus plugins consistent with `REF_GATEWAY_ROUTE_PATTERN`.
- [x] T003 Update `OPENAPI_FAMILY_PLATFORM` with the plan management paths and schemas.
  - Add the full route surface documented in T001.
  - Preserve the existing `2026-03-26` API version header conventions.
  - **Do not read** the aggregated `apps/control-plane/openapi/control-plane.openapi.json`; instead run `npm run generate:public-api` after the family update so generated artifacts refresh.
- [x] T004 Adjust the existing plan-related OpenWhisk action files only where the gateway/REST surface requires alignment.
  - Keep business logic in the existing T01/T02 actions.
  - Limit changes to request parsing, status code normalization, response envelope consistency, correlation/header plumbing, and tenant-owner scoping fixes required by the new gateway routes.

### Phase 3 — Shared web-console client and building blocks

- [x] T005 Create `API_CLIENT` with typed wrappers for every plan management endpoint.
  - Reuse the error-handling shape from `REF_PRIVILEGE_API_SERVICE`.
  - Export a typed `PlanApiError` and helpers for pagination and conflict handling.
- [x] T006 Create `COMP_STATUS_BADGE`, `COMP_CAPABILITY_BADGE`, `COMP_STATUS_BADGE_TEST`, and `COMP_CAPABILITY_BADGE_TEST`.
  - Status badge colors: draft=slate, active=green, deprecated=amber, archived=zinc.
  - Capability badge must render accessible enabled/disabled text states.
- [x] T007 Create `COMP_LIMITS_TABLE`, `COMP_LIMITS_TABLE_TEST`, `COMP_COMPARISON`, and `COMP_COMPARISON_TEST`.
  - `PlanLimitsTable` must support explicit value, inherited default, and unlimited (`-1`) states.
  - `PlanComparisonView` must render side-by-side differences and visually distinguish increased, decreased, and unchanged values.
- [x] T008 Create `COMP_ASSIGNMENT_DIALOG`, `COMP_ASSIGNMENT_DIALOG_TEST`, `COMP_HISTORY_TABLE`, and `COMP_HISTORY_TABLE_TEST`.
  - Only active plans may appear in assignment choices.
  - History table must support pagination and display `Current` when `supersededAt` is null.

### Phase 4 — Superadmin console pages

- [x] T009 Create `PAGE_CATALOG` and `PAGE_CATALOG_TEST`.
  - Display slug, display name, status, assigned tenant count, and last modified.
  - Support status filtering and pagination.
  - Provide a clear empty state and CTA to create the first plan.
- [x] T010 Create `PAGE_CREATE` and `PAGE_CREATE_TEST`.
  - Form fields: slug, display name, description, initial capabilities, initial quota dimensions.
  - Validate slug format and surface duplicate slug conflicts inline.
- [x] T011 Create `PAGE_DETAIL` and `PAGE_DETAIL_TEST`.
  - Tabs: info, capabilities, limits, tenants.
  - Reuse `REF_DESTRUCTIVE_DIALOG` for lifecycle transitions and active-plan limit change confirmations.
  - Deprecated/archived plans must render the limits UI as read-only.
- [x] T012 Create `PAGE_TENANT_ADMIN` and `PAGE_TENANT_ADMIN_TEST`.
  - Show current plan assignment, assign/change action, comparison flow, and assignment history.

### Phase 5 — Tenant-owner console page + navigation wiring

- [x] T013 Create `PAGE_TENANT_OWNER` and `PAGE_TENANT_OWNER_TEST`.
  - Render current plan name, description, capability badges, and complete limits profile.
  - Render a stable "No plan assigned" empty state when appropriate.
- [x] T014 Update `ROUTER`, `ROUTER_TEST`, `CONSOLE_SHELL_LAYOUT`, and `CONSOLE_SHELL_LAYOUT_TEST`.
  - Register the new plan-management routes.
  - Add console navigation for superadmin plan pages.
  - Add route guard behavior so tenant-owner sessions are redirected away from superadmin-only routes and toward the tenant-owner plan overview.
  - Use `REF_PERMISSIONS_FIXTURES` for router/layout test coverage.

### Phase 6 — Validation, integration tests, and repository docs

- [x] T015 Create `TEST_FIXTURE_PLANS`, `TEST_FIXTURE_TENANTS`, `TEST_FIXTURE_ASSIGNMENTS`, `TEST_API`, `TEST_ASSIGNMENT_API`, `TEST_LIMITS_API`, `TEST_AUTH`, and `TEST_ISOLATION`.
  - Cover CRUD/lifecycle/pagination, assignment + reassignment history, limits set/remove/profile, auth `401/403`, and tenant isolation.
  - Use `undici` + `node:test` patterns consistent with the existing integration suites from `097` and `098`.
- [x] T016 Update `AGENTS_DOC` with a new section for `099-plan-management-api-console`.
  - Document new gateway routes, plan management console pages, tenant-owner plan overview, and any new env/config assumptions.
- [x] T017 Run the required generation/validation/test commands and resolve failures before commit:
  - `npm run generate:public-api`
  - `npm run validate:public-api`
  - `npm run validate:openapi`
  - `pnpm --filter @in-falcone/web-console test`
  - `node --test tests/integration/099-plan-management-api-console/*.test.mjs`
  - any repo-level lint/typecheck commands needed by touched packages
- [ ] T018 Commit the completed implementation for `US-PLAN-01-T03`, push the branch, open/update the PR, monitor CI to green, fix failures, and merge when policy allows.

---

## Implementation Constraints for `speckit.implement`

1. Read **only** `plan.md`, `tasks.md`, and the file paths from the map above.
2. Read **only** `apps/control-plane/openapi/families/platform.openapi.json` for OpenAPI source context.
3. Do **not** read `apps/control-plane/openapi/control-plane.openapi.json`.
4. For existing helper/reference files, read only the minimum needed sections.
5. For existing test files, read only imports + the first representative test case before adapting patterns.
6. No broad repo exploration (`find`, broad `ls`, or whole-repo scans`) inside the implement step.
7. Preserve unrelated pre-existing untracked artifacts:
   - `specs/070-saga-compensation-workflows/plan.md`
   - `specs/070-saga-compensation-workflows/tasks.md`
   - `specs/072-workflow-e2e-compensation/tasks.md`

---

## Acceptance Checklist

- [ ] All 13 planned API endpoints are reachable through APISIX routing and described in the platform OpenAPI family.
- [ ] Superadmin console supports plan catalog, create, detail/lifecycle, limits management, tenant assignment/change, and assignment history.
- [ ] Tenant-owner console supports self-service plan overview and limits visibility.
- [ ] Role guards prevent tenant owners from using superadmin plan routes.
- [ ] Public API artifacts regenerate cleanly after the family update.
- [ ] Web-console tests pass for all new plan pages/components.
- [ ] Integration tests pass for CRUD, lifecycle, assignment, limits, auth, and isolation.
- [ ] AGENTS.md documents the new slice.
- [ ] Branch is pushed, PR is green, and merge is completed by the implement step.

---

## Suggested Commit Sequence During Implement

1. `feat(plan-api): expose plan management routes and public API contract`
2. `feat(plan-console): add plan management pages and shared components`
3. `test(plan-console): add plan api and console coverage`
4. `docs(plan): document plan management api and console surface`

The implement step may squash or use a smaller commit count if that is operationally simpler, but the final history must be coherent and reviewable.
