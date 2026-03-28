# Tasks: US-OBS-02-T01 — Common Audit Pipeline for Platform Subsystems

**Input**: `specs/031-observability-audit-pipeline/spec.md`
**Feature Branch**: `031-observability-audit-pipeline`
**Task**: `US-OBS-02-T01`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/031-observability-audit-pipeline/spec.md` with the common audit pipeline specification covering subsystem roster, topology, delivery guarantees, tenant isolation, health signals, resilience rules, and self-audit requirements.
- [x] T002 Materialize `specs/031-observability-audit-pipeline/plan.md` with the contract structure, architecture decisions, artifact mapping, verification strategy, and done criteria.
- [x] T003 Materialize `specs/031-observability-audit-pipeline/tasks.md` and keep it aligned with the bounded audit pipeline delta.

## Phase 2 — Contract and validation helper implementation

- [x] T004 Add `services/internal-contracts/src/observability-audit-pipeline.json` with `version: "2026-03-28"`, enumerating all eight required subsystems (iam, postgresql, mongodb, kafka, openwhisk, storage, quota_metering, tenant_control_plane) each with at least one `required_event_category`, plus `pipeline_topology`, `delivery_guarantees`, `tenant_isolation`, `health_signals`, `resilience_rules`, `self_audit`, and `masking_policy` sections consistent with the metrics-stack and health-checks contracts.
- [x] T005 Update `services/internal-contracts/src/index.mjs` to export `OBSERVABILITY_AUDIT_PIPELINE_URL`, `OBSERVABILITY_AUDIT_PIPELINE_VERSION`, `readObservabilityAuditPipeline()`, `listAuditPipelineSubsystems()`, `getAuditPipelineTopology()`, `getAuditPipelineHealthSignals()`, and `getAuditPipelineTenantIsolation()` following the established reader and version-export pattern.
- [x] T006 Add `scripts/lib/observability-audit-pipeline.mjs` exporting `readObservabilityAuditPipeline()` and `collectAuditPipelineViolations(contract, metricsStack, healthChecks)` which returns `[]` for a valid contract and a specific, actionable violation string for each structural failure (missing subsystem, empty event categories, wrong transport backbone, missing health signals, version mismatches).
- [x] T007 Add `scripts/validate-observability-audit-pipeline.mjs` as the CLI entry point that loads the contract and upstream contracts, runs `collectAuditPipelineViolations`, prints each violation, and exits non-zero if any are found.
- [x] T008 Update `package.json` scripts to expose `validate:observability-audit-pipeline` and wire it into the repository validation flow.

## Phase 3 — Documentation and discoverability

- [x] T009 Add `docs/reference/architecture/observability-audit-pipeline.md` narrating the pipeline topology (subsystem emitter → Kafka → durable audit store), the eight-subsystem roster with their event categories, at-least-once delivery semantics, tenant isolation model, health signal definitions, edge-case and resilience rules, the self-audit requirement, and the explicit T01 scope boundary relative to T02–T06.
- [x] T010 Update `docs/reference/architecture/README.md` with an entry for `observability-audit-pipeline.md` so the new reference doc is discoverable from the architecture index.
- [x] T011 Add or update `docs/tasks/us-obs-02.md` with a `## Scope delivered in 'US-OBS-02-T01'` section summarizing the audit pipeline contract baseline and downstream dependency note for T02–T06.

## Phase 4 — Tests and verification

- [x] T012 Add `tests/unit/observability-audit-pipeline.test.mjs` with unit assertions covering `collectAuditPipelineViolations` determinism: valid contract returns `[]`; removing a subsystem returns a violation naming it; empty `required_event_categories` returns a violation; missing `transport_backbone` returns a violation; `source_metrics_contract` version mismatch returns a violation.
- [x] T013 Add `tests/contracts/observability-audit-pipeline.contract.test.mjs` with contract-reader assertions: `readObservabilityAuditPipeline()` resolves; `OBSERVABILITY_AUDIT_PIPELINE_VERSION` equals the contract `version` field; `listAuditPipelineSubsystems()` returns exactly eight entries; `getAuditPipelineTopology()`, `getAuditPipelineHealthSignals()`, and `getAuditPipelineTenantIsolation()` return the expected objects.
- [x] T014 Run `npm run validate:observability-audit-pipeline` and confirm it exits zero.
- [x] T015 Run targeted observability unit and contract tests to confirm no regressions.
- [x] T016 Run `npm run lint:md` on the touched documentation set.

## Phase 5 — Delivery

- [x] T017 Inspect the final diff to confirm the increment stayed within the audit pipeline contract, validation helper, index wiring, documentation, and tests — and did not touch emitter code, Kafka topic provisioning, consumer code, storage adapters, query APIs, masking logic, or correlation helpers.
- [ ] T018 Commit the branch with a focused message for `US-OBS-02-T01`.
- [ ] T019 Push `031-observability-audit-pipeline` to `origin`.
- [ ] T020 Open a PR from `031-observability-audit-pipeline` to `main`.
- [ ] T021 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T022 Merge the PR to `main` once green.
- [ ] T023 Update the orchestrator state files with the completed unit (`US-OBS-02-T01`) and next pending backlog item (`US-OBS-02-T02`).
