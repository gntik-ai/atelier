# Tasks: US-OBS-02-T05 — Console-Initiated Audit Correlation

**Input**: `specs/035-audit-console-correlation/spec.md`
**Feature Branch**: `035-audit-console-correlation`
**Task**: `US-OBS-02-T05`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/035-audit-console-correlation/spec.md` with the bounded console-initiated audit-correlation specification for tenant/workspace trace retrieval.
- [x] T002 Materialize `specs/035-audit-console-correlation/plan.md` with the technical artifact plan, route shape, authorization delta, correlation-state model, validation strategy, and delivery sequence.
- [x] T003 Materialize `specs/035-audit-console-correlation/tasks.md` and keep it aligned with the bounded T05 delta.

## Phase 2 — Contract, authorization, and validation baseline

- [x] T004 Add `services/internal-contracts/src/observability-audit-correlation-surface.json` with source references, trace scopes, request metadata, trace statuses, timeline phases, downstream source contracts, response metadata, and explicit T06 boundaries.
- [x] T005 Update `services/internal-contracts/src/index.mjs` to expose the T05 correlation-surface reader, version export, and accessors for scopes, request metadata, statuses, phases, source contracts, response metadata, and console-surface data.
- [x] T006 Add `scripts/lib/observability-audit-correlation-surface.mjs` exporting `collectAuditCorrelationSurfaceViolations(contract, dependencies)` with deterministic checks for route ids, permission ids, status/phase coverage, internal contract alignment, masking compatibility, and governance boundaries.
- [x] T007 Add `scripts/validate-observability-audit-correlation-surface.mjs` and wire `validate:observability-audit-correlation-surface` into `package.json` plus `validate:repo`.
- [x] T008 Update `services/internal-contracts/src/authorization-model.json` with the new `tenant.audit.correlate` and `workspace.audit.correlate` actions, bounded role grants, workspace delegable-action support, and `audit_correlation_context` propagation metadata.

## Phase 3 — Public API and consumer surfaces

- [x] T009 Update `services/internal-contracts/src/public-api-taxonomy.json` with `tenant_audit_correlation` and `workspace_audit_correlation` resource-taxonomy entries mapped to known authorization resources.
- [x] T010 Update `apps/control-plane/openapi/control-plane.openapi.json` with the tenant/workspace audit-correlation routes, bounded inclusion query parameters, and response schemas.
- [x] T011 Regenerate `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/metrics.openapi.json`, and `docs/reference/architecture/public-api-surface.md` through the existing public API generation flow.
- [x] T012 Add `apps/control-plane/src/observability-audit-correlation.mjs` with scope validation, request normalization, bounded trace builders, masking-compatible record projection, evidence summarization, route-discovery helpers, and console-model builders backed by the shared T05 contract.
- [x] T013 Add `apps/web-console/src/observability-audit-correlation.mjs` as the thin console adapter over the shared audit-correlation helpers.

## Phase 4 — Documentation and tests

- [x] T014 Add `docs/reference/architecture/observability-audit-correlation-surface.md` describing the T05 correlation baseline, route bindings, phase/state semantics, downstream source catalog, masking posture, permissions, and explicit downstream boundary to T06.
- [x] T015 Update `docs/reference/architecture/README.md` and `docs/tasks/us-obs-02.md` so the T05 baseline is discoverable and clearly bounded relative to T06.
- [x] T016 Add `tests/unit/observability-audit-correlation-surface.test.mjs` covering validator determinism and correlation-normalization failures (scope mismatch, missing correlation id, invalid max items, trace-status derivation, protected-field masking, console metadata).
- [x] T017 Add `tests/contracts/observability-audit-correlation-surface.contract.test.mjs` covering shared readers, authorization alignment, route existence, route-catalog discoverability, internal-service-map source coverage, and masking compatibility with T04.
- [x] T018 Run `npm run validate:observability-audit-correlation-surface`, `npm run validate:authorization-model`, and `npm run validate:public-api` successfully.
- [x] T019 Run targeted tests for the new unit and contract suites.
- [x] T020 Run full `npm run lint` and full `npm test` successfully.

## Phase 5 — Delivery

- [x] T021 Inspect the final diff to confirm the increment stayed within correlation contracts, permissions, routes, helpers, docs, and tests — and did not absorb T06 verification work.
- [ ] T022 Commit the branch with a focused `US-OBS-02-T05` message.
- [ ] T023 Push `035-audit-console-correlation` to `origin`.
- [ ] T024 Open a PR to `main`.
- [ ] T025 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T026 Merge the PR to `main` once green.
- [ ] T027 Update the orchestrator state files with the completed unit (`US-OBS-02-T05`) and the next pending backlog unit.
