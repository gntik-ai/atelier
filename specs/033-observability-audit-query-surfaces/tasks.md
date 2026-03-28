# Tasks: US-OBS-02-T03 — Queryable Audit Surfaces

**Input**: `specs/033-observability-audit-query-surfaces/spec.md`
**Feature Branch**: `033-observability-audit-query-surfaces`
**Task**: `US-OBS-02-T03`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/033-observability-audit-query-surfaces/spec.md` with the bounded query/filter surface specification for tenant and workspace audit reads.
- [x] T002 Materialize `specs/033-observability-audit-query-surfaces/plan.md` with the technical artifact plan, public API shape, authorization delta, validation strategy, and delivery sequence.
- [x] T003 Materialize `specs/033-observability-audit-query-surfaces/tasks.md` and keep it aligned with the bounded T03 delta.

## Phase 2 — Contract, authorization, and validation baseline

- [x] T004 Add `services/internal-contracts/src/observability-audit-query-surface.json` with source references, supported query scopes, filter metadata, pagination policy, response metadata, console explorer metadata, and explicit T04/T05 boundaries.
- [x] T005 Update `services/internal-contracts/src/index.mjs` to expose the T03 query-surface reader, version export, and accessors for scopes, filters, pagination, response metadata, and console surface data.
- [x] T006 Add `scripts/lib/observability-audit-query-surface.mjs` exporting `collectAuditQuerySurfaceViolations(contract, dependencies)` with deterministic checks for route ids, filter coverage, pagination bounds, permission ids, and governance boundaries.
- [x] T007 Add `scripts/validate-observability-audit-query-surface.mjs` and wire `validate:observability-audit-query-surface` into `package.json` plus `validate:repo`.
- [x] T008 Update `services/internal-contracts/src/authorization-model.json` with the new `workspace.audit.read` action, workspace delegable-action support, matching permission grants, and scope-aware `audit_query_context` propagation fields.

## Phase 3 — Public API and consumer surfaces

- [x] T009 Update `services/internal-contracts/src/public-api-taxonomy.json` with `tenant_audit_record` and `workspace_audit_record` resource-taxonomy entries mapped to known authorization resources.
- [x] T010 Update `apps/control-plane/openapi/control-plane.openapi.json` with the tenant/workspace audit-record query routes, request filters, and response schemas.
- [x] T011 Regenerate `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/metrics.openapi.json`, and `docs/reference/architecture/public-api-surface.md` through the existing public API generation flow.
- [x] T012 Add `apps/control-plane/src/observability-audit-query.mjs` with scope validation, query normalization, route-discovery helpers, and console-model builders backed by the shared T03 contract.
- [x] T013 Add `apps/web-console/src/observability-audit.mjs` as the thin console adapter over the shared audit query helpers.

## Phase 4 — Documentation and tests

- [x] T014 Add `docs/reference/architecture/observability-audit-query-surface.md` describing the T03 query/filter baseline, route bindings, filter vocabulary, pagination, permissions, and explicit downstream boundaries.
- [x] T015 Update `docs/reference/architecture/README.md` and `docs/tasks/us-obs-02.md` so the T03 baseline is discoverable and clearly bounded relative to T04–T06.
- [x] T016 Add `tests/unit/observability-audit-query-surface.test.mjs` covering validator determinism and query-normalization failures (scope mismatch, max page size, invalid sort, invalid time window).
- [x] T017 Add `tests/contracts/observability-audit-query-surface.contract.test.mjs` covering shared readers, authorization alignment, route existence, route-catalog discoverability, and console-surface reuse of shared filters.
- [x] T018 Run `npm run validate:observability-audit-query-surface`, `npm run validate:authorization-model`, and `npm run validate:public-api` successfully.
- [x] T019 Run targeted tests for the new unit and contract suites.
- [x] T020 Run full `npm run lint` and full `npm test` successfully.

## Phase 5 — Delivery

- [x] T021 Inspect the final diff to confirm the increment stayed within query/filter surfaces, shared contracts, docs, helpers, and tests — and did not add export, masking, or correlation execution behavior.
- [x] T022 Commit the branch with a focused `US-OBS-02-T03` message.
- [x] T023 Push `033-observability-audit-query-surfaces` to `origin`.
- [x] T024 Open a PR to `main`.
- [x] T025 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [x] T026 Merge the PR to `main` once green.
- [ ] T027 Update the orchestrator state files with the completed unit (`US-OBS-02-T03`) and the next pending backlog unit.
