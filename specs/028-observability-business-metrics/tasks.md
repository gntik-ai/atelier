# Tasks: US-OBS-01-T04 — Business and Product Metrics in the Observability Plane

**Input**: `specs/028-observability-business-metrics/spec.md`
**Feature Branch**: `028-observability-business-metrics`
**Task**: US-OBS-01-T04

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/028-observability-business-metrics/spec.md` with the focused business-metrics specification.
- [x] T002 Materialize `specs/028-observability-business-metrics/plan.md` with the contract, helper, documentation, validation, and verification strategy.
- [x] T003 Materialize `specs/028-observability-business-metrics/tasks.md` and keep it aligned with the actual bounded delta.

## Phase 2 — Business metrics contract and helper implementation

- [x] T004 Add `services/internal-contracts/src/observability-business-metrics.json` covering business metric domains, families, scope rules, required labels, bounded dimensions, masking, freshness, and downstream-consumer semantics.
- [x] T005 Update `services/internal-contracts/src/index.mjs` so the observability business-metrics contract is available through shared readers and helper accessors.
- [x] T006 Extend `apps/control-plane/src/observability-admin.mjs` with summary helpers for business metric domains, families, supported scopes, and safe query-context summaries.
- [x] T007 Add `scripts/lib/observability-business-metrics.mjs` and `scripts/validate-observability-business-metrics.mjs` for deterministic validation of the business-metrics baseline.
- [x] T008 Update `package.json` scripts to expose `validate:observability-business-metrics` and wire it into repo validation.

## Phase 3 — Documentation and discoverability

- [x] T009 Add `docs/reference/architecture/observability-business-metrics.md` documenting the business metric domains, scope/isolation rules, bounded-cardinality expectations, and downstream consumers.
- [x] T010 Update `docs/reference/architecture/README.md` so the new business-metrics guide is discoverable from the architecture index.
- [x] T011 Update `docs/tasks/us-obs-01.md` summarizing the delivered business-metrics slice and residual observability scope.

## Phase 4 — Tests and verification

- [x] T012 Add `tests/unit/observability-business-metrics.test.mjs` for helper and validation behavior.
- [x] T013 Add `tests/contracts/observability-business-metrics.contract.test.mjs` for contract, docs-index, and shared-reader alignment.
- [x] T014 Run `npm run validate:observability-business-metrics`.
- [x] T015 Run targeted observability unit and contract tests.
- [x] T016 Run markdown lint on the touched documentation set.

## Phase 5 — Delivery

- [x] T017 Inspect the final diff to confirm the increment stayed within observability business-metrics contracts, helper summaries, docs, validation, and tests.
- [ ] T018 Commit the branch with a focused message for `US-OBS-01-T04`.
- [ ] T019 Push `028-observability-business-metrics` to `origin`.
- [ ] T020 Open a PR from `028-observability-business-metrics` to `main`.
- [ ] T021 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T022 Merge the PR to `main` once green.
- [ ] T023 Update orchestrator state files with the completed unit and next pending backlog item.
