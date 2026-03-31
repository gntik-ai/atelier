# Tasks: Plan Entity & Tenant Plan Assignment

**Feature**: EP-19 / US-PLAN-01 — Plan Entity & Tenant Plan Assignment  
**Branch**: `097-plan-entity-tenant-assignment`  
**Input**: `specs/097-plan-entity-tenant-assignment/plan.md`, `specs/097-plan-entity-tenant-assignment/spec.md`  
**Generated**: 2026-03-31

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Parallelizable (different files, no incomplete dependencies)
- **[US1–US5]**: User story label (required in story phases)
- Checkboxes track completion status

## File Path Map (implement step reads only these)

| Category | Paths |
|----------|-------|
| Spec artifacts | `specs/097-plan-entity-tenant-assignment/spec.md`, `specs/097-plan-entity-tenant-assignment/plan.md` |
| Migration | `services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql` |
| Models | `services/provisioning-orchestrator/src/models/plan.mjs`, `services/provisioning-orchestrator/src/models/plan-assignment.mjs` |
| Repositories | `services/provisioning-orchestrator/src/repositories/plan-repository.mjs`, `services/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs` |
| Events | `services/provisioning-orchestrator/src/events/plan-events.mjs` |
| Actions | `services/provisioning-orchestrator/src/actions/plan-create.mjs`, `services/provisioning-orchestrator/src/actions/plan-update.mjs`, `services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs`, `services/provisioning-orchestrator/src/actions/plan-list.mjs`, `services/provisioning-orchestrator/src/actions/plan-get.mjs`, `services/provisioning-orchestrator/src/actions/plan-assign.mjs`, `services/provisioning-orchestrator/src/actions/plan-assignment-get.mjs`, `services/provisioning-orchestrator/src/actions/plan-assignment-history.mjs` |
| Contracts | `specs/097-plan-entity-tenant-assignment/contracts/plan-create.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-update.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-lifecycle.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-list.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-get.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-assign.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-assignment-get.json`, `specs/097-plan-entity-tenant-assignment/contracts/plan-assignment-history.json` |
| Tests | `tests/integration/097-plan-entity-tenant-assignment/fixtures/create-test-tenant.mjs`, `tests/integration/097-plan-entity-tenant-assignment/fixtures/seed-plans.mjs`, `tests/integration/097-plan-entity-tenant-assignment/plan-catalog.test.mjs`, `tests/integration/097-plan-entity-tenant-assignment/plan-assignment.test.mjs`, `tests/integration/097-plan-entity-tenant-assignment/plan-lifecycle.test.mjs`, `tests/integration/097-plan-entity-tenant-assignment/plan-audit.test.mjs`, `tests/integration/097-plan-entity-tenant-assignment/plan-isolation.test.mjs` |
| Docs | `specs/097-plan-entity-tenant-assignment/data-model.md`, `specs/097-plan-entity-tenant-assignment/quickstart.md` |
| Config | `AGENTS.md` |
| Reference (OpenAPI family) | `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs` *(single family reference; read-only for pattern)* |

---

## Phase 1: Setup — Documentation Artifacts

**Purpose**: Generate the supporting design documents declared in plan.md that serve as reference during implementation.

- [ ] T001 [P] Write `specs/097-plan-entity-tenant-assignment/data-model.md` — entity tables (plans, tenant_plan_assignments, plan_audit_events), column definitions, indexes, partial UNIQUE constraint, lifecycle state machine diagram, JSONB schema conventions for capabilities and quota_dimensions
- [ ] T002 [P] Write `specs/097-plan-entity-tenant-assignment/quickstart.md` — local dev setup (PostgreSQL + Kafka), how to apply migration, how to run integration tests with `node --test`, environment variables required

---

## Phase 2: Foundational — Blocking Prerequisites

**Purpose**: Core schema, models, repositories, and event infrastructure that EVERY user story depends on. All Phase 3+ tasks are blocked until this phase is complete.

⚠️ **CRITICAL**: No user story work may begin until T003–T009 are complete.

- [ ] T003 Write `services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql` — DDL for `plans` (id UUID PK, slug VARCHAR(64) UNIQUE, display_name, description, status CHECK IN (draft/active/deprecated/archived), capabilities JSONB DEFAULT '{}', quota_dimensions JSONB DEFAULT '{}', created_at/updated_at TIMESTAMPTZ, created_by/updated_by); DDL for `tenant_plan_assignments` (id UUID PK, tenant_id VARCHAR(255), plan_id UUID FK→plans, effective_from TIMESTAMPTZ, superseded_at TIMESTAMPTZ nullable, assigned_by VARCHAR(255), assignment_metadata JSONB DEFAULT '{}'); UNIQUE PARTIAL INDEX ON tenant_plan_assignments(tenant_id) WHERE superseded_at IS NULL; INDEX ON (tenant_id, effective_from DESC); DDL for `plan_audit_events` (id UUID PK, action_type VARCHAR(64), actor_id, tenant_id nullable, plan_id UUID nullable FK→plans, previous_state JSONB, new_state JSONB NOT NULL, correlation_id, created_at); PostgreSQL trigger to reject backward status transitions (active→draft, deprecated→active, archived→*); updated_at trigger on plans table
- [ ] T004 Write `services/provisioning-orchestrator/src/models/plan.mjs` — ESM Plan model class: constructor normalizes slug to lowercase, validates slug regex (^[a-z0-9-]{1,64}$), validates status transitions (VALID_TRANSITIONS map), validates capability values are boolean, validates quota_dimension values are finite numbers; exports Plan.STATUSES, Plan.VALID_TRANSITIONS; no DB dependency
- [ ] T005 [P] Write `services/provisioning-orchestrator/src/models/plan-assignment.mjs` — ESM PlanAssignment model: constructor accepts tenantId, planId, assignedBy, assignmentMetadata; isCurrent() returns supersededAt === null; validates tenantId and planId are non-empty strings; exports PlanAssignment class; no DB dependency
- [ ] T006 Write `services/provisioning-orchestrator/src/repositories/plan-repository.mjs` — ESM module exporting: create(client, planData): INSERT INTO plans, reject on slug conflict with PLAN_SLUG_CONFLICT; findById(client, id): SELECT by PK; findBySlug(client, slug): SELECT by slug; update(client, id, updates): UPDATE display_name/description/capabilities/quota_dimensions, reject if status=archived; transitionStatus(client, id, targetStatus): UPDATE status validating forward-only transition, reject if target is archived and tenant assignments exist; list(client, {status, page, pageSize}): SELECT with optional WHERE status=?, LIMIT/OFFSET; all queries use parameterized $N placeholders; throws typed errors (PLAN_NOT_FOUND, PLAN_ARCHIVED, INVALID_TRANSITION, PLAN_HAS_ACTIVE_ASSIGNMENTS with blocking tenant list)
- [ ] T007 Write `services/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs` — ESM module exporting: assign(client, {tenantId, planId, assignedBy, assignmentMetadata}): BEGIN; SELECT id FROM tenant_plan_assignments WHERE tenant_id=$1 AND superseded_at IS NULL FOR UPDATE; UPDATE superseded_at=NOW() on current row if exists; INSERT new assignment; COMMIT; returns {assignmentId, previousPlanId}; throws CONCURRENT_ASSIGNMENT_CONFLICT on lock timeout (PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS env var); getCurrent(client, tenantId): SELECT assignment JOIN plan WHERE superseded_at IS NULL; getHistory(client, tenantId, {page, pageSize}): SELECT all assignments ORDER BY effective_from DESC; hasActiveAssignments(client, planId): SELECT EXISTS for archive guard (used by plan-lifecycle)
- [ ] T008 [P] Write `services/provisioning-orchestrator/src/events/plan-events.mjs` — ESM module using kafkajs; exports async emitPlanEvent(producer, eventType, payload): publishes to topic from env var map (PLAN_KAFKA_TOPIC_CREATED, PLAN_KAFKA_TOPIC_UPDATED, PLAN_KAFKA_TOPIC_LIFECYCLE, PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED, PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED); event envelope: {eventType, correlationId, actorId, tenantId, timestamp, previousState, newState}; fire-and-forget (errors logged, not thrown); topic defaults: console.plan.created / console.plan.updated / console.plan.lifecycle_transitioned / console.plan.assignment.created / console.plan.assignment.superseded
- [ ] T009 [P] Write `tests/integration/097-plan-entity-tenant-assignment/fixtures/create-test-tenant.mjs` and `tests/integration/097-plan-entity-tenant-assignment/fixtures/seed-plans.mjs` — create-test-tenant.mjs: inserts a test tenant row into the tenants table (or uses existing tenant if tenant domain is independent); seed-plans.mjs: inserts draft/active/deprecated plans with known slugs (test-starter, test-professional, test-enterprise) for fixture use; both export async setup(pgClient) and async teardown(pgClient)

**Checkpoint**: Migration applied, models validated, repositories unit-tested locally, events module present → user story implementation may begin in parallel.

---

## Phase 3: User Story 1 — Superadmin Creates a Product Plan (Priority: P1) 🎯 MVP

**Goal**: A superadmin can create, update, and list plans in the catalog. Plans start in `draft` status. Slug uniqueness enforced. Capabilities and quota dimensions declared as JSONB.

**Independent Test**: Run `node --test tests/integration/097-plan-entity-tenant-assignment/plan-catalog.test.mjs` against local PG — all assertions pass without any other action deployed.

- [ ] T010 [P] [US1] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-create.json` — JSON Schema contract: input {slug (string, pattern ^[a-z0-9-]{1,64}$, required), displayName (string, required), description (string, optional), capabilities (object additionalProperties boolean, optional), quotaDimensions (object additionalProperties number, optional)}; output 201 {id (uuid), slug, displayName, description, status: "draft", capabilities, quotaDimensions, createdAt, updatedAt, createdBy}; errors: 409 PLAN_SLUG_CONFLICT, 400 INVALID_SLUG, 403 FORBIDDEN
- [ ] T011 [P] [US1] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-list.json` — JSON Schema contract: input {status (enum draft/active/deprecated/archived, optional), page (integer ≥1, default 1), pageSize (integer 1–100, default 20)}; output 200 {plans: [plan objects], total (integer), page, pageSize}; auth: superadmin JWT
- [ ] T012 [P] [US1] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-get.json` — JSON Schema contract: input {planId (uuid, mutually exclusive with slug), slug (string, mutually exclusive with planId)}; output 200 full plan object; errors: 404 PLAN_NOT_FOUND, 400 BAD_REQUEST (neither planId nor slug provided); auth: superadmin or tenant-owner JWT
- [ ] T013 [P] [US1] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-update.json` — JSON Schema contract: input {planId (uuid, required), displayName (string, optional), description (string, optional), capabilities (object, optional), quotaDimensions (object, optional)}; output 200 updated plan object; errors: 404 PLAN_NOT_FOUND, 409 PLAN_ARCHIVED (status=archived rejects all updates), 403 FORBIDDEN; auth: superadmin JWT
- [ ] T014 [US1] Write `services/provisioning-orchestrator/src/actions/plan-create.mjs` — OpenWhisk action: validate input via Plan model (slug normalization, pattern check); call planRepository.create(); insert row into plan_audit_events with action_type='plan.created', previous_state=null, new_state=plan row; call planEvents.emitPlanEvent(producer, 'plan.created', ...); return 201 response shape per plan-create.json; handle PLAN_SLUG_CONFLICT → 409, validation error → 400, auth → 403
- [ ] T015 [P] [US1] Write `services/provisioning-orchestrator/src/actions/plan-list.mjs` — OpenWhisk action: parse and validate query params (status filter, page, pageSize); call planRepository.list(); return paginated response per plan-list.json; no audit event (read-only); auth: superadmin JWT
- [ ] T016 [P] [US1] Write `services/provisioning-orchestrator/src/actions/plan-get.mjs` — OpenWhisk action: accept planId or slug (mutually exclusive validation); call planRepository.findById or findBySlug; return plan object per plan-get.json; handle 404; auth: superadmin OR tenant-owner JWT (tenant-owner path will be extended in US3)
- [ ] T017 [US1] Write `services/provisioning-orchestrator/src/actions/plan-update.mjs` — OpenWhisk action: validate input (at least one of displayName/description/capabilities/quotaDimensions); call planRepository.update() which rejects archived plans; insert plan_audit_events row with action_type='plan.updated', previous_state snapshot, new_state snapshot; emit plan.updated Kafka event; return 200 updated plan per plan-update.json
- [ ] T018 [US1] Write `tests/integration/097-plan-entity-tenant-assignment/plan-catalog.test.mjs` — node:test suite covering: create plan with all fields → 201 + correct attributes (FR-001); create plan with minimal fields (no capabilities/quotaDimensions) → 201 (edge case: empty plan valid); duplicate slug → 409 PLAN_SLUG_CONFLICT (FR-003); mixed-case slug normalized to lowercase; JSONB round-trip for capabilities and quota_dimensions (FR-013, FR-014); update plan metadata (FR-015); update archived plan → 409 PLAN_ARCHIVED; list plans with no filter (FR-017); list plans filtered by status; pagination correctness (page/pageSize); plan_audit_events row created for create and update (FR-012)

**Checkpoint**: US1 fully functional — superadmin can create, update, list, and get plans.

---

## Phase 4: User Story 2 — Superadmin Assigns a Plan to a Tenant (Priority: P1)

**Goal**: A superadmin atomically assigns an active plan to a tenant, superseding the previous assignment. Only active plans can be assigned. Concurrent assignment attempts for the same tenant are serialized.

**Independent Test**: Run `node --test tests/integration/097-plan-entity-tenant-assignment/plan-assignment.test.mjs` — all assignment/reassignment/concurrency assertions pass.

- [ ] T019 [P] [US2] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-assign.json` — JSON Schema contract: input {tenantId (string, required), planId (uuid, required), assignedBy (string, required), assignmentMetadata (object, optional)}; output 200 {assignmentId (uuid), tenantId, planId, effectiveFrom (ISO8601), previousPlanId (uuid or null)}; errors: 409 PLAN_NOT_ACTIVE (plan not in active status), 409 CONCURRENT_ASSIGNMENT_CONFLICT (lock timeout), 404 TENANT_NOT_FOUND, 404 PLAN_NOT_FOUND, 403 FORBIDDEN; auth: superadmin JWT
- [ ] T020 [US2] Write `services/provisioning-orchestrator/src/actions/plan-assign.mjs` — OpenWhisk action: validate tenantId and planId present; fetch plan → reject if status !== 'active' with PLAN_NOT_ACTIVE; call planAssignmentRepository.assign() within transaction (SELECT FOR UPDATE + supersede + insert); insert plan_audit_events rows: one for 'assignment.superseded' (if previous existed) and one for 'assignment.created'; emit console.plan.assignment.superseded and console.plan.assignment.created Kafka events; return 200 shape per plan-assign.json; handle CONCURRENT_ASSIGNMENT_CONFLICT → 409, PLAN_NOT_ACTIVE → 409, TENANT_NOT_FOUND → 404
- [ ] T021 [US2] Write `tests/integration/097-plan-entity-tenant-assignment/plan-assignment.test.mjs` — node:test suite covering: assign plan to tenant with no prior assignment → effectiveFrom set, tenant current plan resolves correctly (SC-002); reassign to new plan → previous assignment has superseded_at set, new assignment is current, both queryable (AC-2); assign draft plan → 409 PLAN_NOT_ACTIVE (FR-007); assign deprecated plan → 409 PLAN_NOT_ACTIVE; concurrent assignment for same tenant using Promise.all → exactly one succeeds, one returns 409 CONCURRENT_ASSIGNMENT_CONFLICT (SC-006, FR-006); assignment history returns all entries in chronological order after multiple reassignments; audit events row created for assignment and supersession (FR-012)

**Checkpoint**: US2 fully functional — superadmin can assign and reassign plans to tenants atomically.

---

## Phase 5: User Story 3 — Tenant Owner Views Assigned Plan (Priority: P2)

**Goal**: A tenant owner can query their own currently assigned plan, including capabilities and quota dimensions. Tenant isolation enforced — no cross-tenant reads.

**Independent Test**: Run `node --test tests/integration/097-plan-entity-tenant-assignment/plan-isolation.test.mjs` — all isolation assertions pass.

- [ ] T022 [P] [US3] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-assignment-get.json` — JSON Schema contract: input {tenantId (string, required)}; output 200 {assignment: {assignmentId, tenantId, planId, effectiveFrom, assignedBy, assignmentMetadata}, plan: {id, slug, displayName, description, capabilities, quotaDimensions, status}} OR {noAssignment: true} when no plan assigned; auth: superadmin (any tenantId) OR tenant-owner JWT (tenantId must match JWT claim); errors: 403 FORBIDDEN (tenant-owner querying another tenant), 404 TENANT_NOT_FOUND
- [ ] T023 [US3] Write `services/provisioning-orchestrator/src/actions/plan-assignment-get.mjs` — OpenWhisk action: extract caller identity from JWT (superadmin vs tenant-owner); if tenant-owner, enforce tenantId === JWT.tenantId claim, else 403 FORBIDDEN; call planAssignmentRepository.getCurrent(tenantId); if no current assignment return {noAssignment: true}; JOIN plan data and return full response per plan-assignment-get.json; no audit event (read-only)
- [ ] T024 [US3] Write `tests/integration/097-plan-entity-tenant-assignment/plan-isolation.test.mjs` — node:test suite covering: tenant-owner JWT querying own plan → returns plan metadata including capabilities and quota_dimensions (US3-AC1); tenant with no plan assigned → {noAssignment: true} (US3-AC2); tenant-owner JWT querying a different tenantId → 403 FORBIDDEN (FR-016, SC-005); superadmin JWT querying any tenantId → succeeds (FR-016)

**Checkpoint**: US3 fully functional — tenant owners can self-serve their plan info; cross-tenant isolation enforced.

---

## Phase 6: User Story 4 — Superadmin Queries Plan History for a Tenant (Priority: P2)

**Goal**: A superadmin retrieves the full chronological history of plan assignments for any tenant, including effective dates, superseded timestamps, and actor info.

**Independent Test**: Extend `plan-assignment.test.mjs` with history assertions (T027 appends tests to the existing suite file).

- [ ] T025 [P] [US4] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-assignment-history.json` — JSON Schema contract: input {tenantId (string, required), page (integer ≥1, default 1), pageSize (integer 1–100, default 20)}; output 200 {assignments: [{assignmentId, tenantId, planId, planSlug, planDisplayName, effectiveFrom, supersededAt (ISO8601 or null), assignedBy, assignmentMetadata}], total, page, pageSize} in chronological order (effectiveFrom DESC); auth: superadmin JWT; errors: 403 FORBIDDEN (non-superadmin), 404 TENANT_NOT_FOUND
- [ ] T026 [US4] Write `services/provisioning-orchestrator/src/actions/plan-assignment-history.mjs` — OpenWhisk action: enforce superadmin auth; call planAssignmentRepository.getHistory(tenantId, {page, pageSize}); JOIN plan slug and display_name for each assignment row; return paginated list per plan-assignment-history.json; no audit event (read-only)
- [ ] T027 [US4] Extend `tests/integration/097-plan-entity-tenant-assignment/plan-assignment.test.mjs` with history query section — node:test assertions: three sequential plan changes on one tenant → history returns 3 entries with correct effectiveFrom/supersededAt/assignedBy ordering (US4-AC1, SC-003); pagination of history works correctly; tenant-owner calling history endpoint → 403 FORBIDDEN

**Checkpoint**: US4 fully functional — superadmin can audit full plan assignment history for any tenant.

---

## Phase 7: User Story 5 — Superadmin Manages Plan Lifecycle (Priority: P3)

**Goal**: A superadmin transitions plans through the state machine (draft → active → deprecated → archived). Archive is blocked when tenants are assigned. Deprecated plans reject new assignments but existing assignments are unaffected.

**Independent Test**: Run `node --test tests/integration/097-plan-entity-tenant-assignment/plan-lifecycle.test.mjs` — all lifecycle and guard assertions pass.

- [ ] T028 [P] [US5] Write `specs/097-plan-entity-tenant-assignment/contracts/plan-lifecycle.json` — JSON Schema contract: input {planId (uuid, required), targetStatus (enum active/deprecated/archived, required)}; output 200 {planId, previousStatus, newStatus, transitionedAt (ISO8601)}; errors: 409 INVALID_TRANSITION (backward or skip transition attempted), 409 PLAN_HAS_ACTIVE_ASSIGNMENTS {blockingTenants: [tenantId, ...]} (archive blocked by active assignments per FR-008), 404 PLAN_NOT_FOUND, 403 FORBIDDEN; auth: superadmin JWT; note: draft is not a valid targetStatus (plans are created in draft; no backward transition to draft)
- [ ] T029 [US5] Write `services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs` — OpenWhisk action: validate targetStatus is a valid forward transition from current status using Plan.VALID_TRANSITIONS; if targetStatus='archived', call planAssignmentRepository.hasActiveAssignments(planId), if true reject with PLAN_HAS_ACTIVE_ASSIGNMENTS and list of blocking tenants (FR-008); call planRepository.transitionStatus(planId, targetStatus); insert plan_audit_events row with action_type='plan.lifecycle_transitioned', previous_state={status: oldStatus}, new_state={status: newStatus}; emit console.plan.lifecycle_transitioned Kafka event; return 200 per plan-lifecycle.json
- [ ] T030 [US5] Write `tests/integration/097-plan-entity-tenant-assignment/plan-lifecycle.test.mjs` — node:test suite covering: full forward traversal draft→active→deprecated→archived (no tenants assigned) succeeds at each step (US5-AC1, US5-AC2, FR-002); backward transition rejected at application layer with INVALID_TRANSITION (FR-002); archive blocked when one tenant still assigned; response includes blockingTenants array (FR-008, US5-AC3); deprecated plan rejects new assignment with PLAN_NOT_ACTIVE (FR-009, US5-AC1); deprecated plan's existing tenant assignment unaffected (FR-009); lifecycle audit events recorded for each transition (FR-012); plan_audit_events row exists with correct previousStatus and newStatus

**Checkpoint**: US5 fully functional — full plan lifecycle management operational including archival guard.

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Audit completeness validation, observability, and codebase documentation update.

- [ ] T031 Write `tests/integration/097-plan-entity-tenant-assignment/plan-audit.test.mjs` — node:test suite for cross-cutting audit correctness (FR-012, SC-004): for each of the 8 action types verify that a plan_audit_events row is inserted with correct action_type, actor_id, tenant_id (when applicable), non-null new_state, and correlation_id; separately verify Kafka events emitted on each topic (console.plan.created, console.plan.updated, console.plan.lifecycle_transitioned, console.plan.assignment.created, console.plan.assignment.superseded) using kafkajs consumer with 5-second timeout; use pg direct queries to assert row existence after each action
- [ ] T032 Update `AGENTS.md` — append new section `## Plan Entity & Tenant Plan Assignment (097-plan-entity-tenant-assignment)` documenting: new PostgreSQL tables (plans, tenant_plan_assignments, plan_audit_events) and key constraints (partial UNIQUE index, forward-only lifecycle trigger); new Kafka topics (console.plan.created/updated/lifecycle_transitioned/assignment.created/assignment.superseded, 30d retention); new env vars (PLAN_KAFKA_TOPIC_CREATED, PLAN_KAFKA_TOPIC_UPDATED, PLAN_KAFKA_TOPIC_LIFECYCLE, PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED, PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED, PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS); new OpenWhisk actions (plan-create, plan-update, plan-lifecycle, plan-list, plan-get, plan-assign, plan-assignment-get, plan-assignment-history); enforcement out of scope (deferred to US-PLAN-01-T02+)

---

## Dependencies

```text
T001, T002 (docs) → no blocking deps, run immediately in parallel

T003 (migration) → T006, T007 (repositories need schema)
T004 (plan model) → T006 (repository uses model)
T005 (assignment model) → T007 (repository uses model)
T008 (events) → T014, T017, T020, T029 (actions use events)
T009 (fixtures) → T018, T021, T024, T027, T030, T031 (tests use fixtures)
T006 (plan-repo) → T014, T015, T016, T017, T020, T021, T026, T029
T007 (assignment-repo) → T020, T021, T023, T024, T026, T027, T029, T030

T010–T013 (US1 contracts) → T014–T017 (actions implement contracts)
T014–T017 (US1 actions) → T018 (US1 tests)

T019 (US2 contract) → T020 (US2 action)
T020 (US2 action) → T021 (US2 tests)

T022 (US3 contract) → T023 (US3 action)
T023 (US3 action) → T024 (US3 tests)

T025 (US4 contract) → T026 (US4 action)
T026 (US4 action) → T027 (US4 tests extension)

T028 (US5 contract) → T029 (US5 action)
T029 (US5 action) → T030 (US5 tests)

T014–T030 (all actions + tests) → T031 (audit cross-cut test)
T031 → T032 (AGENTS.md final)
```

## Parallel Execution Examples

**After T003–T009 complete (foundation ready)**:

```text
Group A (US1):   T010, T011, T012, T013 in parallel → then T014 → T015, T016, T017 in parallel → T018
Group B (US2):   T019 → T020 → T021
Group C (US3):   T022 → T023 → T024
Group D (US4):   T025 → T026 → T027
Group E (US5):   T028 → T029 → T030
```

Groups B–E can start once T003–T009 are done regardless of Group A status.

**Immediately parallelizable (no deps)**:
- T001, T002, T005, T008, T009 can all start in parallel with T003 and T004.

## Implementation Strategy

**MVP** (minimum valuable increment): Complete Phase 2 + Phase 3 (T001–T018) → delivers full plan catalog: create, update, list, get plans with audit events.

**Increment 2**: Phase 4 (T019–T021) → adds plan assignment to tenants.

**Increment 3**: Phase 5 + 6 (T022–T027) → adds tenant self-serve plan view and assignment history.

**Increment 4**: Phase 7 (T028–T030) → adds lifecycle management and archival guards.

**Completion**: Final Phase (T031–T032) → audit coverage validation and AGENTS.md docs.

## Summary

| Phase | Tasks | User Story | Priority |
|-------|-------|-----------|---------|
| Phase 1: Setup | T001–T002 | — | Immediate |
| Phase 2: Foundational | T003–T009 | — | Blocking |
| Phase 3 | T010–T018 | US1: Create Plan | P1 🎯 MVP |
| Phase 4 | T019–T021 | US2: Assign Plan | P1 |
| Phase 5 | T022–T024 | US3: Tenant View | P2 |
| Phase 6 | T025–T027 | US4: Plan History | P2 |
| Phase 7 | T028–T030 | US5: Lifecycle Mgmt | P3 |
| Final | T031–T032 | Cross-cutting audit + docs | — |

**Total tasks**: 32  
**Parallelizable tasks** ([P] label): T001, T002, T005, T008, T009, T010, T011, T012, T013, T015, T016, T019, T022, T025, T028 (15 tasks)  
**Parallel opportunities**: 4 user story phases can execute concurrently after Phase 2 completes  
**Independent test criteria**: Each story phase has a standalone `node --test` command per its checkpoint  
**Suggested MVP scope**: Phase 1 + Phase 2 + Phase 3 (T001–T018) — delivers working plan catalog with full audit trail
