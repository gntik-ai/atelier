# Tasks: Function Versioning and Rollback

**Input**: Design documents from `/specs/001-function-versioning-rollback/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/function-versioning.openapi.md

**Tests**: Unit, adapter, and contract coverage are required for this feature because lifecycle and rollback behavior must remain verifiable through root quality gates.

**Organization**: Tasks are grouped by user story so each increment remains independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependency overlap)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)
- Include exact file paths in every task

## Phase 1: Setup (Shared Feature Scaffolding)

**Purpose**: Finalize the feature package and create the implementation anchor points.

- [ ] T001 Create the feature planning artifacts in `specs/001-function-versioning-rollback/spec.md`, `specs/001-function-versioning-rollback/plan.md`, `specs/001-function-versioning-rollback/research.md`, `specs/001-function-versioning-rollback/data-model.md`, `specs/001-function-versioning-rollback/quickstart.md`, and `specs/001-function-versioning-rollback/contracts/function-versioning.openapi.md`
- [ ] T002 Create the execution task list in `specs/001-function-versioning-rollback/tasks.md`

---

## Phase 2: Foundational (Blocking Lifecycle Contract Work)

**Purpose**: Establish the shared lifecycle contract and helper foundation required by all user stories.

**⚠️ CRITICAL**: No user story is complete until these tasks land.

- [ ] T003 Update lifecycle route and schema definitions in `apps/control-plane/openapi/families/functions.openapi.json`
- [ ] T004 [P] Extend governed function route summaries and compatibility exports in `apps/control-plane/src/functions-admin.mjs`
- [ ] T005 [P] Add lifecycle metadata builders and rollback validation primitives in `services/adapters/src/openwhisk-admin.mjs`
- [ ] T006 Regenerate or align derived contract helpers after the OpenAPI update in `services/internal-contracts/src/` and any root generation scripts that consume the `functions` family

**Checkpoint**: Shared lifecycle foundation is ready for story-specific completion and validation.

---

## Phase 3: User Story 1 - Publish safe function revisions (Priority: P1) 🎯 MVP

**Goal**: Every governed function update creates a recoverable immutable version and exposes the active version clearly.

**Independent Test**: A governed function action can expose current version summary plus version list/detail routes without losing prior revision visibility.

### Tests for User Story 1

- [ ] T007 [P] [US1] Add lifecycle route exposure assertions in `tests/unit/functions-admin.test.mjs`
- [ ] T008 [P] [US1] Add immutable version normalization coverage in `tests/adapters/openwhisk-admin.test.mjs`
- [ ] T009 [P] [US1] Add version route/schema contract assertions in `tests/contracts/functions-versioning.contract.test.mjs`

### Implementation for User Story 1

- [ ] T010 [US1] Extend `FunctionAction` lifecycle summary fields and add version list/detail schemas in `apps/control-plane/openapi/families/functions.openapi.json`
- [ ] T011 [US1] Expose version list/detail capabilities in `apps/control-plane/src/functions-admin.mjs`
- [ ] T012 [US1] Implement function version projections and lifecycle summaries in `services/adapters/src/openwhisk-admin.mjs`

**Checkpoint**: User Story 1 is complete when lifecycle version history is modeled and independently testable.

---

## Phase 4: User Story 2 - Restore a prior known-good function state (Priority: P2)

**Goal**: Authorized operators can request rollback to a previous version through the governed functions surface.

**Independent Test**: A rollback request targeting a valid prior version is accepted through the public contract and modeled by helper logic without destroying lifecycle history.

### Tests for User Story 2

- [ ] T013 [P] [US2] Add rollback route and capability assertions in `tests/unit/functions-admin.test.mjs`
- [ ] T014 [P] [US2] Add valid and invalid rollback request coverage in `tests/adapters/openwhisk-admin.test.mjs`
- [ ] T015 [P] [US2] Add rollback request/accepted-response contract assertions in `tests/contracts/functions-versioning.contract.test.mjs`

### Implementation for User Story 2

- [ ] T016 [US2] Add rollback request/accepted schemas and `POST /v1/functions/actions/{resourceId}/rollback` in `apps/control-plane/openapi/families/functions.openapi.json`
- [ ] T017 [US2] Expose rollback capability in the governed function admin surface in `apps/control-plane/src/functions-admin.mjs`
- [ ] T018 [US2] Implement rollback normalization and acceptance helpers in `services/adapters/src/openwhisk-admin.mjs`

**Checkpoint**: User Story 2 is complete when valid rollback is modeled and invalid rollback outcomes are explicitly testable.

---

## Phase 5: User Story 3 - Govern rollback visibility and safety across tenants and workspaces (Priority: P3)

**Goal**: Version history and rollback remain constrained by tenant/workspace scope and mutation permissions.

**Independent Test**: Cross-scope or unauthorized rollback/version-history requests are rejected by helper logic and the public surface continues to advertise governed isolation behavior.

### Tests for User Story 3

- [ ] T019 [P] [US3] Add isolation-focused lifecycle assertions in `tests/unit/functions-admin.test.mjs`
- [ ] T020 [P] [US3] Add cross-scope and already-active rollback rejection coverage in `tests/adapters/openwhisk-admin.test.mjs`
- [ ] T021 [P] [US3] Add governed error-path contract assertions in `tests/contracts/functions-versioning.contract.test.mjs`

### Implementation for User Story 3

- [ ] T022 [US3] Harden lifecycle and rollback error semantics in `apps/control-plane/openapi/families/functions.openapi.json`
- [ ] T023 [US3] Align lifecycle compatibility summaries with governed isolation guarantees in `apps/control-plane/src/functions-admin.mjs`
- [ ] T024 [US3] Enforce tenant/workspace rollback target validation and eligibility checks in `services/adapters/src/openwhisk-admin.mjs`

**Checkpoint**: User Story 3 is complete when lifecycle visibility and rollback safety remain governed by scope and permission rules.

---

## Phase 6: Polish & Cross-Cutting Validation

**Purpose**: Final consistency, docs alignment, and validation evidence.

- [ ] T025 [P] Update implementation notes and operator guidance in `specs/001-function-versioning-rollback/quickstart.md` and `specs/001-function-versioning-rollback/contracts/function-versioning.openapi.md` if the final contract differs from the draft
- [ ] T026 Run lifecycle validation commands from the repository root and record/fix any regressions affecting `apps/control-plane/openapi/families/functions.openapi.json`, `apps/control-plane/src/functions-admin.mjs`, `services/adapters/src/openwhisk-admin.mjs`, `tests/unit/functions-admin.test.mjs`, `tests/adapters/openwhisk-admin.test.mjs`, and `tests/contracts/functions-versioning.contract.test.mjs`
- [ ] T027 Commit the completed `US-FN-03-T01` implementation on branch `001-function-versioning-rollback`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: starts immediately
- **Phase 2 (Foundational)**: depends on Phase 1 and blocks all user stories
- **Phase 3 (US1)**: depends on foundational lifecycle contract work
- **Phase 4 (US2)**: depends on US1 lifecycle entities and contract structure
- **Phase 5 (US3)**: depends on US1 and US2 lifecycle + rollback shape
- **Phase 6 (Polish)**: depends on all desired stories being complete

### User Story Dependencies

- **US1** is the MVP and must land first.
- **US2** depends on the version entities and routes introduced by US1.
- **US3** depends on the rollback and version-history surface introduced by US1 and US2.

### Parallel Opportunities

- T004 and T005 can start once the intended route/schema names from T003 are fixed.
- Within each story, unit/adapter/contract test additions can run in parallel.
- T025 can run in parallel with the final validation pass if contract names are stable.

---

## Parallel Example: User Story 1

```bash
Task: "Add lifecycle route exposure assertions in tests/unit/functions-admin.test.mjs"
Task: "Add immutable version normalization coverage in tests/adapters/openwhisk-admin.test.mjs"
Task: "Add version route/schema contract assertions in tests/contracts/functions-versioning.contract.test.mjs"
```

---

## Implementation Strategy

### MVP First (US1)

1. Finish Setup and Foundational phases.
2. Implement User Story 1.
3. Run targeted validation for unit, adapter, and contract coverage.
4. Confirm lifecycle version history works independently.

### Incremental Delivery

1. Add version history surface (US1).
2. Add rollback mutation and helpers (US2).
3. Add isolation/error hardening (US3).
4. Run final validation and commit the full increment.

## Notes

- Keep scope strictly bounded to `US-FN-03-T01`.
- Do not introduce secret management, quota enforcement, console-backend orchestration, or import/export in this branch.
- Preserve the governed OpenWhisk abstraction and avoid exposing native namespace/subject administration.
