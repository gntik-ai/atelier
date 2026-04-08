# Tasks: US-OBS-01-T01 — Unified Observability Metrics Stack Integration

**Input**: `specs/025-observability-metrics-stack/spec.md`
**Feature Branch**: `025-observability-metrics-stack`
**Task**: US-OBS-01-T01

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/025-observability-metrics-stack/spec.md` with the focused observability foundation specification.
- [x] T002 Materialize `specs/025-observability-metrics-stack/plan.md` with the contract, configuration, documentation, and verification strategy.
- [x] T003 Materialize `specs/025-observability-metrics-stack/tasks.md` and keep it aligned with the actual bounded delta.

## Phase 2 — Foundation implementation

- [x] T004 Add `services/internal-contracts/src/observability-metrics-stack.json` covering subsystem scope, normalized metric families, labels, cardinality rules, collection topology, and collection-health semantics.
- [x] T005 Update `services/internal-contracts/src/index.mjs` so the observability metrics-stack contract is available through shared readers and helpers.
- [x] T006 Add `apps/control-plane/src/observability-admin.mjs` with summary helpers and safe scope-selector construction for downstream observability work.
- [x] T007 Update `charts/in-falcone/values.yaml` with `observability.config.inline.metricsStack` so Helm-facing configuration mirrors the same contract version, labels, and component targets.
- [x] T008 Add `scripts/lib/observability-metrics-stack.mjs` and `scripts/validate-observability-metrics-stack.mjs` for deterministic validation.

## Phase 3 — Documentation and discoverability

- [x] T009 Add `docs/reference/architecture/observability-metrics-stack.md` documenting naming, labels, scope rules, collection health, retention, resolution, and per-subsystem topology.
- [x] T010 Update `docs/reference/architecture/README.md` so the new guide is discoverable from the architecture index.
- [x] T011 Add `docs/tasks/us-obs-01.md` summarizing the delivered foundation slice and residual scope.

## Phase 4 — Tests and verification

- [x] T012 Add `tests/unit/observability-metrics-stack.test.mjs` for helper and validation behavior.
- [x] T013 Add `tests/contracts/observability-metrics-stack.contract.test.mjs` for contract, Helm, and docs-index alignment.
- [x] T014 Update `package.json` scripts to expose `validate:observability-metrics-stack` and wire it into repo validation.
- [x] T015 Run `npm run validate:observability-metrics-stack`.
- [x] T016 Run targeted observability unit and contract tests.
- [x] T017 Run markdown lint on the touched documentation set.

## Phase 5 — Delivery

- [x] T018 Inspect the final diff to confirm the increment stayed within foundational observability contracts, config, docs, and tests.
- [ ] T019 Commit the branch with a focused message for `US-OBS-01-T01`.
- [ ] T020 Push `025-observability-metrics-stack` to `origin`.
- [ ] T021 Open a PR from `025-observability-metrics-stack` to `main`.
- [ ] T022 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T023 Merge the PR to `main` once green.
- [ ] T024 Update orchestrator state files with the completed unit and next pending backlog item.
