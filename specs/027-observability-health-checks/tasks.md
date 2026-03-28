# Tasks: US-OBS-01-T03 — Component Health, Readiness, and Liveness Checks

**Input**: `specs/027-observability-health-checks/spec.md`
**Feature Branch**: `027-observability-health-checks`
**Task**: US-OBS-01-T03

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/027-observability-health-checks/spec.md` with the focused component health-check specification.
- [x] T002 Materialize `specs/027-observability-health-checks/plan.md` with the contract, additive metrics alignment, helper, documentation, validation, and verification strategy.
- [x] T003 Materialize `specs/027-observability-health-checks/tasks.md` and keep it aligned with the actual bounded delta.

## Phase 2 — Health contract and helper implementation

- [x] T004 Add `services/internal-contracts/src/observability-health-checks.json` covering probe semantics, component catalog, internal exposure templates, redaction, audit context, and observability projection metadata.
- [x] T005 Update `services/internal-contracts/src/observability-metrics-stack.json` additively with normalized probe metric families referenced by the health-check baseline.
- [x] T006 Update `services/internal-contracts/src/index.mjs` so the observability health-check contract is available through shared readers and helper accessors.
- [x] T007 Extend `apps/control-plane/src/observability-admin.mjs` with summary helpers for probe semantics, component health metadata, and internal exposure summaries.
- [x] T008 Add `scripts/lib/observability-health-checks.mjs` and `scripts/validate-observability-health-checks.mjs` for deterministic validation of the health baseline.
- [x] T009 Update `package.json` scripts to expose `validate:observability-health-checks` and wire it into repo validation.

## Phase 3 — Documentation and discoverability

- [x] T010 Add `docs/reference/architecture/observability-health-checks.md` documenting canonical liveness/readiness/health semantics, internal exposure rules, masking expectations, and metrics/dashboard alignment.
- [x] T011 Update `docs/reference/architecture/README.md` so the new health-check guide is discoverable from the architecture index.
- [x] T012 Update `docs/tasks/us-obs-01.md` summarizing the delivered health-check slice and residual observability scope.

## Phase 4 — Tests and verification

- [x] T013 Add `tests/unit/observability-health-checks.test.mjs` for helper and validation behavior.
- [x] T014 Add `tests/contracts/observability-health-checks.contract.test.mjs` for contract, docs-index, and shared-reader alignment.
- [x] T015 Run `npm run validate:observability-health-checks`.
- [x] T016 Run targeted observability unit and contract tests.
- [x] T017 Run markdown lint on the touched documentation set.

## Phase 5 — Delivery

- [x] T018 Inspect the final diff to confirm the increment stayed within observability health contracts, additive metrics-stack updates, helper summaries, docs, validation, and tests.
- [ ] T019 Commit the branch with a focused message for `US-OBS-01-T03`.
- [ ] T020 Push `027-observability-health-checks` to `origin`.
- [ ] T021 Open a PR from `027-observability-health-checks` to `main`.
- [ ] T022 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T023 Merge the PR to `main` once green.
- [ ] T024 Update orchestrator state files with the completed unit and next pending backlog item.
