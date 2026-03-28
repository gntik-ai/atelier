# Tasks: US-OBS-02-T04 — Audit Export and Sensitive-Data Masking

**Input**: `specs/034-audit-export-masking/spec.md`
**Feature Branch**: `034-audit-export-masking`
**Task**: `US-OBS-02-T04`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/034-audit-export-masking/spec.md` with the bounded audit export + masking specification for tenant/workspace evidence export.
- [x] T002 Materialize `specs/034-audit-export-masking/plan.md` with the technical artifact plan, export route shape, authorization delta, masking policy, validation strategy, and delivery sequence.
- [x] T003 Materialize `specs/034-audit-export-masking/tasks.md` and keep it aligned with the bounded T04 delta.

## Phase 2 — Contract, authorization, and validation baseline

- [x] T004 Add `services/internal-contracts/src/observability-audit-export-surface.json` with source references, export scopes, request metadata, format catalog, masking profiles, sensitive-field rules, response metadata, and explicit T05/T06 boundaries.
- [x] T005 Update `services/internal-contracts/src/index.mjs` to expose the T04 export-surface reader, version export, and accessors for scopes, formats, masking profiles, sensitive-field rules, response metadata, and console-surface data.
- [x] T006 Add `scripts/lib/observability-audit-export-surface.mjs` exporting `collectAuditExportSurfaceViolations(contract, dependencies)` with deterministic checks for route ids, format coverage, permission ids, masking-field coverage, filter reuse, and governance boundaries.
- [x] T007 Add `scripts/validate-observability-audit-export-surface.mjs` and wire `validate:observability-audit-export-surface` into `package.json` plus `validate:repo`.
- [x] T008 Update `services/internal-contracts/src/authorization-model.json` with the new `tenant.audit.export` and `workspace.audit.export` actions, bounded role grants, workspace delegable-action support, and `audit_export_context` propagation metadata.

## Phase 3 — Public API and consumer surfaces

- [x] T009 Update `services/internal-contracts/src/public-api-taxonomy.json` with `tenant_audit_export` and `workspace_audit_export` resource-taxonomy entries mapped to known authorization resources.
- [x] T010 Update `apps/control-plane/openapi/control-plane.openapi.json` with the tenant/workspace audit-export routes, request body, and response schemas.
- [x] T011 Regenerate `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/metrics.openapi.json`, and `docs/reference/architecture/public-api-surface.md` through the existing public API generation flow.
- [x] T012 Add `apps/control-plane/src/observability-audit-export.mjs` with scope validation, request normalization, masking helpers, export-manifest builders, route-discovery helpers, and console-model builders backed by the shared T04 contract.
- [x] T013 Add `apps/web-console/src/observability-audit-export.mjs` as the thin console adapter over the shared audit export helpers.

## Phase 4 — Documentation and tests

- [x] T014 Add `docs/reference/architecture/observability-audit-export-surface.md` describing the T04 export/masking baseline, route bindings, masking profile semantics, sensitive-field coverage, permissions, and explicit downstream boundaries.
- [x] T015 Update `docs/reference/architecture/README.md` and `docs/tasks/us-obs-02.md` so the T04 baseline is discoverable and clearly bounded relative to T05–T06.
- [x] T016 Add `tests/unit/observability-audit-export-surface.test.mjs` covering validator determinism and export-normalization failures (scope mismatch, invalid format, max page size, invalid time window, unknown masking profile, protected-field masking).
- [x] T017 Add `tests/contracts/observability-audit-export-surface.contract.test.mjs` covering shared readers, authorization alignment, route existence, route-catalog discoverability, T03 filter reuse, and coverage of the T01 forbidden field catalog by the T04 masking rules.
- [x] T018 Run `npm run validate:observability-audit-export-surface`, `npm run validate:authorization-model`, and `npm run validate:public-api` successfully.
- [x] T019 Run targeted tests for the new unit and contract suites.
- [x] T020 Run full `npm run lint` and full `npm test` successfully.

## Phase 5 — Delivery

- [x] T021 Inspect the final diff to confirm the increment stayed within export/masking contracts, permissions, routes, helpers, docs, and tests — and did not add correlation or restore workflows.
- [ ] T022 Commit the branch with a focused `US-OBS-02-T04` message.
- [ ] T023 Push `034-audit-export-masking` to `origin`.
- [ ] T024 Open a PR to `main`.
- [ ] T025 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T026 Merge the PR to `main` once green.
- [ ] T027 Update the orchestrator state files with the completed unit (`US-OBS-02-T04`) and the next pending backlog unit.
