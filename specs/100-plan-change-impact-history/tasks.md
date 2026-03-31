# Tasks: Plan Change History & Effective Quota Impact

**Input**: Design documents from `specs/100-plan-change-impact-history/`
**Task ID**: US-PLAN-01-T04 | **Epic**: EP-19 | **Story**: US-PLAN-01
**Branch**: `100-plan-change-impact-history`
**Depends on**: T01 (097), T02 (098), T03 (099) merged

**Prerequisites**: plan.md ✅ · spec.md ✅ · data-model.md ✅ · contracts/ ✅ · research.md ✅ · quickstart.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths are included in each task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish migration and domain helper foundation for all phases.

- [ ] T001 Create PostgreSQL migration `services/provisioning-orchestrator/src/migrations/100-plan-change-impact-history.sql` with tables `tenant_plan_change_history`, `tenant_plan_quota_impacts`, `tenant_plan_capability_impacts` and all indexes defined in data-model.md (UNIQUE on `plan_assignment_id`, composite indexes on `tenant_id/effective_at`, `dimension_key/usage_status`, `capability_key`)
- [ ] T002 [P] Create domain model `services/provisioning-orchestrator/src/models/plan-change-history-entry.mjs` exporting `PlanChangeHistoryEntry` constructor, validation, and serialization helpers
- [ ] T003 [P] Create domain model `services/provisioning-orchestrator/src/models/effective-entitlement-snapshot.mjs` exporting canonical value normalization (`bounded|unlimited|missing`), quota diff classification (`increased|decreased|unchanged|added|removed`), capability diff classification, and usage status classification (`within_limit|at_limit|over_limit|unknown`) helpers

**Checkpoint**: Migration and domain helpers ready — all phases may proceed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core repositories and event emitter that every user story implementation depends on.

- [ ] T004 Create repository `services/provisioning-orchestrator/src/repositories/plan-change-history-repository.mjs` with methods: `insertHistoryEntry(client, entry)`, `insertQuotaImpacts(client, historyEntryId, items[])`, `insertCapabilityImpacts(client, historyEntryId, items[])`, `queryHistoryByTenant(client, tenantId, filters)`, `getHistoryEntry(client, historyEntryId)` — uses pg client parameter for transaction inclusion
- [ ] T005 Create repository `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` with method `resolveEffectiveEntitlements(client, tenantId, planId)` that reads `quota_dimension_catalog` defaults + `plans.quota_dimensions` overrides + supported tenant adjustments, returns normalized `{ dimensionKey, effectiveValueKind, effectiveValue }[]` and `{ capabilityKey, enabled }[]`
- [ ] T006 Create repository `services/provisioning-orchestrator/src/repositories/tenant-usage-snapshot-repository.mjs` with method `collectObservedUsage(tenantId, dimensionKeys[])` that queries authoritative per-dimension sources, returns `{ dimensionKey, observedUsage, usageObservedAt, usageSource }[]` or `{ dimensionKey, status: 'unknown', reasonCode }[]` per dimension; bounded timeouts; never throws for individual source failures
- [ ] T007 Create Kafka event emitter `services/provisioning-orchestrator/src/events/plan-change-impact-events.mjs` exporting `emitChangeImpactRecorded(producer, entry)` using the `console.plan.change-impact-recorded` schema from `specs/100-plan-change-impact-history/contracts/plan-change-impact-event.json`; uses `historyEntryId` as partition key; omits sensitive free-text fields per contract notes
- [ ] T008 Create observability module `services/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs` exporting metric name constants (`plan_change_history_write_total`, `plan_change_history_write_duration_ms`, `plan_change_history_query_duration_ms`, `plan_change_history_over_limit_dimensions_total`, `plan_change_history_usage_unknown_total`, `plan_change_history_event_publish_total`) and structured log field helper `buildChangeImpactLogFields(entry)`

**Checkpoint**: All foundational repositories, events, and observability modules ready

---

## Phase 3: User Story 1 — Superadmin Reviews Full Plan Change Impact (Priority: P1) 🎯 MVP

**Goal**: A superadmin can see a durable, accurate, per-dimension impact snapshot for every committed tenant plan change, including before/after values, usage posture, and downgrade risk flags.

**Independent Test**: Assign tenant `acme-corp` to `professional`, then downgrade to `starter`. Query `GET /v1/tenants/acme-corp/plan/history-impact`. Verify two entries exist in chronological order, each with the full quota and capability delta, the actor, the effective timestamp, and correct `usageStatus` per dimension.

- [ ] T009 [US1] Update `services/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs` to accept an optional `historyContext` argument containing resolved previous/new effective entitlements and usage snapshot; add `insertWithHistory(client, assignmentData, historyContext)` method that within the same transaction: supersedes the current assignment, inserts the new assignment row, calls `plan-change-history-repository` insert methods, enforces the `UNIQUE(plan_assignment_id)` idempotency guard
- [ ] T010 [US1] Update `services/provisioning-orchestrator/src/actions/plan-assign.mjs` to orchestrate the snapshot flow before committing the assignment: (1) load previous effective entitlements via `effective-entitlements-repository`, (2) load target effective entitlements, (3) collect usage via `tenant-usage-snapshot-repository`, (4) compute quota/capability diffs and usage statuses using `effective-entitlement-snapshot.mjs` helpers, (5) determine `changeDirection` and `usageCollectionStatus`, (6) call `plan-assignment-repository.insertWithHistory`, (7) emit Kafka event post-commit via `plan-change-impact-events.mjs`, (8) record metrics and structured log via `plan-change-impact-metrics.mjs`
- [ ] T011 [P] [US1] Create OpenWhisk action `services/provisioning-orchestrator/src/actions/plan-change-history-query.mjs` implementing `GET /v1/tenants/{tenantId}/plan/history-impact` with actor/date/page filters per `specs/100-plan-change-impact-history/contracts/plan-change-history-query.json`; enforces superadmin/internal authorization scope; returns paginated response with `items[]` containing full `quotaImpacts` and `capabilityImpacts` arrays; uses `plan-change-history-repository.queryHistoryByTenant`
- [ ] T012 [US1] Update `services/gateway-config/routes/plan-management-routes.yaml` to add APISIX route for `GET /v1/tenants/{tenantId}/plan/history-impact` proxied to the `plan-change-history-query` action with superadmin Keycloak auth guard

**Checkpoint**: Superadmin can query full plan change history with impact snapshots via API

---

## Phase 4: User Story 2 — Tenant Owner Views Current Effective Entitlements (Priority: P1)

**Goal**: After a plan change, a tenant owner can immediately view their current effective quota posture — resolved limits, current usage, and any over-limit indicators — without reconstructing old plan definitions.

**Independent Test**: After upgrading `acme-corp` to `professional`, call `GET /v1/tenant/plan/effective-entitlements` with a tenant-owner session. Verify the response shows current effective limits, current usage status per dimension, and `latestHistoryEntryId` pointing to the upgrade event. Downgrade to `starter` with consumption above new limits and re-call; verify over-limit dimensions appear.

- [ ] T013 [US2] Create OpenWhisk action `services/provisioning-orchestrator/src/actions/plan-effective-entitlements-get.mjs` implementing `GET /v1/tenant/plan/effective-entitlements` per `specs/100-plan-change-impact-history/contracts/plan-effective-entitlements-get.json`; computes current entitlements live from `effective-entitlements-repository` and current usage from `tenant-usage-snapshot-repository`; includes `latestHistoryEntryId` + `latestPlanChangeAt` from most recent `tenant_plan_change_history` row; enforces multi-tenant isolation (tenant-owner can only access own tenant)
- [ ] T014 [US2] Update `services/gateway-config/routes/plan-management-routes.yaml` to add APISIX route for `GET /v1/tenant/plan/effective-entitlements` proxied to `plan-effective-entitlements-get` with tenant-owner Keycloak auth; also add superadmin variant `GET /v1/tenants/{tenantId}/plan/effective-entitlements`
- [ ] T015 [P] [US2] Update `apps/web-console/src/services/planManagementApi.ts` to add typed methods `getEffectiveEntitlements(tenantId?: string): Promise<CurrentEffectiveEntitlementSummary>` and `getPlanChangeHistory(tenantId, params): Promise<PlanChangeHistoryPage>` matching OpenAPI contracts
- [ ] T016 [P] [US2] Create console component `apps/web-console/src/components/console/PlanImpactSummaryCard.tsx` rendering snapshot header: actor, previous plan → new plan arrow, effective timestamp, correlation id, changeDirection badge, usageCollectionStatus indicator
- [ ] T017 [P] [US2] Create console component `apps/web-console/src/components/console/PlanQuotaImpactTable.tsx` rendering per-dimension rows with previous/new effective value (handles `bounded|unlimited|missing`), comparison classification badge (`increased|decreased|unchanged|added|removed`), observed usage, and usage status chip (`within_limit|at_limit|over_limit|unknown`)
- [ ] T018 [P] [US2] Create console component `apps/web-console/src/components/console/PlanCapabilityImpactTable.tsx` rendering per-capability rows with previous/new state and comparison badge (`enabled|disabled|unchanged`)
- [ ] T019 [US2] Update `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` to display the current effective entitlement summary section using `PlanQuotaImpactTable` and `PlanCapabilityImpactTable` components; show over-limit dimension count banner when `overLimitDimensionCount > 0`; include link to `latestHistoryEntryId` when present

**Checkpoint**: Tenant owners see live effective entitlement summary with over-limit indicators in the console

---

## Phase 5: User Story 3 — Operator Audits Plan Change History Over Time (Priority: P2)

**Goal**: An authorized internal operator can retrieve chronological, filterable, paginated plan change history for any tenant, with each entry's full impact snapshot preserved independently of later plan definition edits.

**Independent Test**: Perform three plan changes (upgrade, downgrade, lateral) for `acme-corp`. Then edit the `professional` plan's limits. Query `GET /v1/tenants/acme-corp/plan/history-impact?from=...&actorId=...`. Verify: entries are in `effectiveAt DESC` order, each snapshot still reflects values from change time (not current plan definition), filter parameters work correctly, and pagination metadata is accurate.

- [ ] T020 [P] [US3] Create console component `apps/web-console/src/components/console/PlanImpactHistoryTable.tsx` rendering a paginated timeline list; each row shows `effectiveAt`, actor, previous plan → new plan, `changeDirection` badge, `overLimitDimensionCount` indicator, and expand button; includes actor and date-range filter inputs; renders empty/loading/error states
- [ ] T021 [US3] Update `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` to add a "Plan Change History" tab rendering `PlanImpactHistoryTable`; drilldown expands to show `PlanImpactSummaryCard` + `PlanQuotaImpactTable` + `PlanCapabilityImpactTable` for the selected history entry; filters wire to `planManagementApi.getPlanChangeHistory`

**Checkpoint**: Operators can audit complete, immutable plan change history with filtering and drilldown in the admin console

---

## Phase 6: User Story 4 — Detect and Surface Downgrade Risk (Priority: P2)

**Goal**: Product and finance operators can identify tenants where a downgrade placed them above one or more new effective limits, without the system blocking the downgrade or enforcing remediation.

**Independent Test**: Downgrade a tenant that has 8 workspaces to a plan where `max_workspaces = 5`. Query the history entry and verify `overLimitDimensionCount = 1`, the `max_workspaces` quota impact row has `usageStatus = 'over_limit'`, `observedUsage = 8`, `newEffectiveValue = 5`, and `isHardDecrease = true`. Verify the downgrade completed successfully without being blocked.

- [ ] T022 [US4] Verify and harden `effective-entitlement-snapshot.mjs` `classifyUsageStatus` function: when `newEffectiveValueKind = 'bounded'` and `observedUsage > newEffectiveValue`, classify as `over_limit`; when `observedUsage === newEffectiveValue`, classify as `at_limit`; when `newEffectiveValueKind = 'unlimited'`, always `within_limit`; when `observedUsage` is null, `unknown`; set `isHardDecrease = true` when `comparison = 'decreased'` and `usageStatus = 'over_limit'`
- [ ] T023 [P] [US4] Verify `plan-change-impact-events.mjs` includes `overLimitDimensionCount` in `console.plan.change-impact-recorded` event payload when `overLimitDimensionCount > 0`; verify metric `plan_change_history_over_limit_dimensions_total` is incremented per over-limit dimension in `plan-change-impact-metrics.mjs`

**Checkpoint**: Downgrade risk is fully captured in the immutable snapshot and observable via events and metrics

---

## Phase 7: Integration & Contract Tests

**Purpose**: Automated coverage for all user stories and API contracts.

- [ ] T024 Create test fixtures `tests/integration/100-plan-change-impact-history/fixtures/seed-plan-history.mjs` with seed functions for `starter` and `professional` plan setup, fresh tenant assignment in `starter` state, and helpers for upgrade/downgrade/lateral/equivalent transitions
- [ ] T025 [P] Create test fixtures `tests/integration/100-plan-change-impact-history/fixtures/seed-tenant-usage.mjs` with helpers to insert per-dimension observed usage values into authoritative stores for integration tests
- [ ] T026 [P] Create test fixture `tests/integration/100-plan-change-impact-history/fixtures/mock-usage-unavailable.mjs` with stub/mock for `tenant-usage-snapshot-repository` that returns `unknown` for specified dimensions to simulate partial/full usage source failure
- [ ] T027 Write integration test `tests/integration/100-plan-change-impact-history/plan-change-history-write.test.mjs` covering: (1) upgrade writes exactly one history entry with all quota and capability lines, (2) downgrade with over-limit usage flags affected dimensions as `over_limit`, (3) equivalent effective entitlements still create a record with all `unchanged` deltas, (4) `UNIQUE(plan_assignment_id)` prevents duplicate history rows on retry, (5) snapshots remain unchanged after editing plan definitions
- [ ] T028 [P] Write integration test `tests/integration/100-plan-change-impact-history/plan-change-history-query.test.mjs` covering: paginated query with tenant/date/actor filters, stable `effectiveAt DESC` ordering, full quota/capability snapshot in each response item, and 500-entry pagination performance meets SC-002
- [ ] T029 [P] Write integration test `tests/integration/100-plan-change-impact-history/effective-entitlements-get.test.mjs` covering: current summary reflects latest assignment after a change, dimensions with `unlimited` and `missing` values return correct `effectiveValueKind`, `latestHistoryEntryId` is populated after a committed change
- [ ] T030 [P] Write integration test `tests/integration/100-plan-change-impact-history/downgrade-overlimit.test.mjs` covering: downgrade completes successfully even when consumption exceeds new limits, over-limit dimensions are marked with `usageStatus = 'over_limit'` and `isHardDecrease = true`, FR-016 (no enforcement) verified
- [ ] T031 [P] Write integration test `tests/integration/100-plan-change-impact-history/plan-change-history-auth.test.mjs` covering: tenant owner cannot access another tenant's history or effective entitlements (SC-006), superadmin can access any tenant, unauthenticated requests are rejected
- [ ] T032 [P] Write contract test `tests/contract/100-plan-change-impact-history/plan-change-history-query.contract.test.mjs` validating `GET /v1/tenants/{tenantId}/plan/history-impact` response shape against `specs/100-plan-change-impact-history/contracts/plan-change-history-query.json`
- [ ] T033 [P] Write contract test `tests/contract/100-plan-change-impact-history/plan-effective-entitlements-get.contract.test.mjs` validating `GET /v1/tenant/plan/effective-entitlements` response shape against `specs/100-plan-change-impact-history/contracts/plan-effective-entitlements-get.json`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, operational validation, and accessibility hardening.

- [ ] T034 Add `plan_audit_events` rows for `action_type = 'plan.change_impact_recorded'` in the `plan-assign.mjs` flow referencing `historyEntryId` and `correlationId` for unified audit query compatibility with existing plan audit log readers
- [ ] T035 [P] Update `apps/control-plane/openapi/` (or equivalent public OpenAPI artifact directory) with new path entries for `GET /v1/tenants/{tenantId}/plan/history-impact` and `GET /v1/tenant/plan/effective-entitlements` matching the contract schemas
- [ ] T036 [P] Verify all console components (`PlanImpactHistoryTable`, `PlanImpactSummaryCard`, `PlanQuotaImpactTable`, `PlanCapabilityImpactTable`) pass accessibility checks: status badges have `aria-label`, tables have `<caption>` or `aria-labelledby`, long snapshot lists are virtualized or paginated to avoid DOM bloat
- [ ] T037 Validate observability: after a test plan change, confirm Kafka event `console.plan.change-impact-recorded` is emitted with correct `historyEntryId` key, structured log fields include `correlationId/tenantId/actorId/historyEntryId/changeDirection/overLimitDimensionCount`, and metrics `plan_change_history_write_total{result=success}` and `plan_change_history_event_publish_total{result=success}` are incremented
- [ ] T038 [P] Update `specs/100-plan-change-impact-history/quickstart.md` with local validation steps for: running the migration, triggering an upgrade and downgrade via the plan-assign action, querying the history and effective entitlements endpoints, and observing the Kafka event

---

## Dependency Graph

```text
T001 (migration)
T002 (model: history-entry)        ┐
T003 (model: entitlement-snapshot) ┤→ T004, T005, T006, T007, T008
                                   │
T004 (repo: history)               ┐
T005 (repo: effective-entitlements)┤→ T009 → T010 → T027
T006 (repo: usage-snapshot)        ┘
T007 (events)   ──────────────────→ T010
T008 (metrics)  ──────────────────→ T010

T010 (plan-assign updated) ─────→ T027, T028 (integration tests)
T011 (plan-change-history-query) ─→ T012 (gateway route)
T013 (effective-entitlements-get) → T014 (gateway route)

T015, T016, T017, T018 can run in parallel after T010 action interface is stable
T019 depends on T015, T016, T017
T020 depends on T016, T017, T018
T021 depends on T020

T022 (usage status hardening) ──→ T027, T030
T024, T025, T026 (fixtures) ────→ T027, T028, T029, T030, T031
T032, T033 (contract tests) depend on T011, T013 being implemented
```

## Parallel Execution Opportunities

**Can start immediately after T001–T003**:
- T004, T005, T006, T007, T008 (all independent repositories/emitters)

**Can start after T010 action interface is stable**:
- T011 (history-query action), T013 (effective-entitlements action), T015 (API client), T016, T017, T018 (UI components), T022 (usage status hardening), T024, T025, T026 (fixtures)

**Can start after T011 and T013 are merged**:
- T012, T014 (gateway routes), T032, T033 (contract tests)

**Can start after T016/T017/T018**:
- T019, T020

## Implementation Strategy

**MVP scope (User Story 1 + 2)**:
Complete T001–T019 in the order above. This delivers a fully working history persistence, internal superadmin query, and tenant-owner entitlement summary with console visibility. All P1 success criteria (SC-001 through SC-006) are met.

**Increment 2 (User Story 3)**:
Add T020–T021 for operator audit timeline and drilldown. Requires UI components from MVP already in place.

**Increment 3 (User Story 4)**:
T022–T023 harden the downgrade risk surface. Much of the logic is already present from MVP; this increment is primarily verification and metrics completeness.

**Test & polish**:
T024–T038 complete all automated coverage, operational validation, accessibility, and documentation.

---

**Total tasks**: 38
**Tasks per user story**: US1=4 · US2=7 · US3=2 · US4=2 · Foundational=7 · Setup=3 · Tests=10 · Polish=5 (some tests cover multiple stories)
**Parallel opportunities**: 20+ tasks can execute in parallel once foundational phase is complete
**Independent test criteria**: defined per phase (see each checkpoint)
**Suggested MVP**: Phase 1 + Phase 2 + Phase 3 + Phase 4 (T001–T019)
