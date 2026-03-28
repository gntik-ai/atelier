# Tasks: US-OBS-02-T06 — End-to-End Audit Traceability and Sensitive-Data Protection Verification

**Input**: `specs/036-audit-traceability-tests/spec.md`
**Feature Branch**: `036-audit-traceability-tests`
**Task**: `US-OBS-02-T06`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

### Spec artifacts

- `specs/036-audit-traceability-tests/spec.md`
- `specs/036-audit-traceability-tests/plan.md`
- `specs/036-audit-traceability-tests/tasks.md`

### Existing contract + reader references

- `services/internal-contracts/src/observability-audit-pipeline.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/observability-audit-query-surface.json`
- `services/internal-contracts/src/observability-audit-export-surface.json`
- `services/internal-contracts/src/observability-audit-correlation-surface.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/internal-service-map.json`
- `services/internal-contracts/src/index.mjs`

### Existing helper + test-pattern references

- `scripts/lib/quality-gates.mjs`
- `scripts/lib/observability-audit-correlation-surface.mjs`
- `apps/control-plane/src/observability-audit-query.mjs`
- `apps/control-plane/src/observability-audit-export.mjs`
- `apps/control-plane/src/observability-audit-correlation.mjs`
- `tests/reference/observability-smoke-matrix.yaml`
- `tests/e2e/observability/observability-smoke.test.mjs`
- `tests/unit/observability-audit-correlation-surface.test.mjs`
- `tests/contracts/observability-audit-correlation-surface.contract.test.mjs`
- `tests/reference/README.md`
- `tests/e2e/README.md`
- `docs/tasks/us-obs-02.md`
- `docs/reference/architecture/README.md`
- `package.json`

### New or updated delivery targets

- `tests/reference/audit-traceability-matrix.yaml`
- `scripts/lib/audit-traceability.mjs`
- `tests/unit/observability-audit-traceability.test.mjs`
- `tests/e2e/observability/audit-traceability.test.mjs`
- `tests/reference/README.md`
- `tests/e2e/README.md`
- `docs/tasks/us-obs-02.md`
- `docs/reference/architecture/README.md`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/036-audit-traceability-tests/spec.md` with the bounded end-to-end audit traceability and sensitive-data verification scope.
- [x] T002 Materialize `specs/036-audit-traceability-tests/plan.md` with the matrix, helper, unit/e2e, docs, and validation sequence.
- [x] T003 Materialize `specs/036-audit-traceability-tests/tasks.md` and keep it aligned with the bounded T06 verification delta.

## Phase 2 — Verification matrix and helper baseline

- [ ] T004 Add `tests/reference/audit-traceability-matrix.yaml` with all six verification categories, shared expectations, RF coverage refs, and T01–T05 contract-surface mappings.
- [ ] T005 Add `scripts/lib/audit-traceability.mjs` with matrix readers, scenario selectors, and `collectMatrixAlignmentViolations(matrix, dependencies)` for deterministic alignment checks.
- [ ] T006 Keep the matrix/helper strictly additive: no new contract JSON, no new public routes, no new masking rules, and no `validate:repo` expansion.

## Phase 3 — Executable verification suites

- [ ] T007 Add `tests/unit/observability-audit-traceability.test.mjs` covering matrix loading, alignment failures, masking consistency, scope rejection, and `not_found` trace-state derivation.
- [ ] T008 Add `tests/e2e/observability/audit-traceability.test.mjs` covering matrix self-consistency, scenario-category coverage, full-chain traceability, masking consistency, tenant/workspace isolation, permission boundaries, and trace-state diagnostics.
- [ ] T009 Keep all T06 tests contract-driven and in-memory: reuse existing T03/T04/T05 helpers and authorization readers instead of introducing live runtime dependencies.

## Phase 4 — Discoverability and task-summary updates

- [ ] T010 Update `tests/reference/README.md` with an entry for `audit-traceability-matrix.yaml`.
- [ ] T011 Update `tests/e2e/README.md` with an observability audit-traceability entry.
- [ ] T012 Update `docs/tasks/us-obs-02.md` with a `## Scope delivered in 'US-OBS-02-T06'` section summarizing the verification baseline, coverage categories, and residual boundary.
- [ ] T013 Update `docs/reference/architecture/README.md` so the audit traceability matrix location is discoverable from the observability architecture index.

## Phase 5 — Verification

- [ ] T014 Run `node --test tests/unit/observability-audit-traceability.test.mjs`.
- [ ] T015 Run `node --test tests/e2e/observability/audit-traceability.test.mjs`.
- [ ] T016 Run `npm run lint:md -- specs/036-audit-traceability-tests/spec.md specs/036-audit-traceability-tests/plan.md specs/036-audit-traceability-tests/tasks.md tests/reference/README.md tests/e2e/README.md docs/tasks/us-obs-02.md docs/reference/architecture/README.md`.
- [ ] T017 Run full `npm run lint` and full `npm test` successfully.
- [ ] T018 Inspect the final diff to confirm the increment stayed within verification matrix, helper, tests, docs, and bounded read-only use of T01–T05 contracts.

## Phase 6 — Delivery

- [ ] T019 Commit the branch with a focused message for `US-OBS-02-T06`.
- [ ] T020 Push `036-audit-traceability-tests` to `origin`.
- [ ] T021 Open a PR from `036-audit-traceability-tests` to `main`.
- [ ] T022 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T023 Merge the PR to `main` once green.
- [ ] T024 Update the orchestrator state files with the completed unit and next pending backlog item.
