# Tasks: US-OBS-03-T01 — Usage Consumption Calculation per Tenant and Workspace

**Input**: `specs/037-observability-usage-consumption/spec.md`
**Feature Branch**: `037-observability-usage-consumption`
**Task**: `US-OBS-03-T01`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

### Spec artifacts

- `specs/037-observability-usage-consumption/spec.md`
- `specs/037-observability-usage-consumption/plan.md`
- `specs/037-observability-usage-consumption/tasks.md`

### Existing contract + reader references

- `services/internal-contracts/src/observability-business-metrics.json`
- `services/internal-contracts/src/observability-health-checks.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`

### Existing helper + route-pattern references

- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `scripts/lib/observability-business-metrics.mjs`
- `scripts/lib/observability-audit-correlation-surface.mjs`
- `tests/unit/observability-business-metrics.test.mjs`
- `tests/contracts/observability-audit-correlation-surface.contract.test.mjs`
- `docs/reference/architecture/observability-business-metrics.md`
- `docs/reference/architecture/README.md`
- `package.json`

### New or updated delivery targets

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-usage-consumption.mjs`
- `scripts/validate-observability-usage-consumption.mjs`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/control-plane.openapi.json` (edit programmatically without using it as broad read context)
- `apps/control-plane/openapi/families/metrics.openapi.json` (generated)
- `services/internal-contracts/src/public-route-catalog.json` (generated)
- `docs/reference/architecture/public-api-surface.md` (generated)
- `docs/reference/architecture/observability-usage-consumption.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `tests/unit/observability-usage-consumption.test.mjs`
- `tests/contracts/observability-usage-consumption.contract.test.mjs`
- `package.json`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/037-observability-usage-consumption/spec.md` with the bounded usage-consumption scope for `US-OBS-03-T01`.
- [x] T002 Materialize `specs/037-observability-usage-consumption/plan.md` with the contract, helper, route, auth, docs, and validation sequence.
- [x] T003 Materialize `specs/037-observability-usage-consumption/tasks.md` and keep it aligned with the bounded T01 delta.

## Phase 2 — Internal contract and validation baseline

- [x] T004 Add `services/internal-contracts/src/observability-usage-consumption.json` covering scopes, metered dimensions, units, source modes, freshness states, refresh policy, audit-cycle compatibility, route ids, permission ids, and explicit T02–T06 boundaries.
- [x] T005 Update `services/internal-contracts/src/index.mjs` to expose the usage-consumption reader, version export, scope accessors, dimension accessors, freshness accessors, refresh-policy accessor, and calculation-audit accessor.
- [x] T006 Add `scripts/lib/observability-usage-consumption.mjs` exporting `collectObservabilityUsageConsumptionViolations(contract, dependencies)` with deterministic checks for source-version alignment, required dimensions/scopes/freshness states, known business metric family ids, known auth actions, known public resource types, and known route operation ids.
- [x] T007 Add `scripts/validate-observability-usage-consumption.mjs` and wire `validate:observability-usage-consumption` into `package.json` plus `validate:repo`.

## Phase 3 — Authorization and control-plane helper surface

- [x] T008 Update `services/internal-contracts/src/authorization-model.json` with the new `workspace.usage.read` action, workspace delegable-action support, and bounded role grants for platform / tenant / workspace readers that should consume workspace usage snapshots.
- [x] T009 Extend `apps/control-plane/src/observability-admin.mjs` with `summarizeObservabilityUsageConsumption()` and additive usage-contract exports/helpers.
- [x] T010 Add deterministic snapshot builders in `observability-admin.mjs` for `buildUsageDimensionSnapshot`, `buildTenantUsageSnapshot`, and `buildWorkspaceUsageSnapshot` using the shared contract catalog as the source of truth.
- [x] T011 Add `buildUsageCalculationCycleAuditRecord()` in `observability-admin.mjs` with audit-schema-compatible subsystem/origin/category defaults for scheduled quota-metering refreshes.
- [x] T012 Add `queryTenantUsageSnapshot(context, input)`, `queryWorkspaceUsageSnapshot(context, input)`, and `listUsageConsumptionRoutes()` in `observability-admin.mjs` with strict tenant/workspace scope binding and predictable default loader behavior.

## Phase 4 — Public API publication

- [x] T013 Update `services/internal-contracts/src/public-api-taxonomy.json` with `tenant_usage_snapshot` and `workspace_usage_snapshot` resource-taxonomy entries mapped to `tenant` and `workspace` authorization resources.
- [x] T014 Patch `apps/control-plane/openapi/control-plane.openapi.json` programmatically to add `GET /v1/metrics/tenants/{tenantId}/usage` and `GET /v1/metrics/workspaces/{workspaceId}/usage`, plus additive `UsageDimensionSnapshot`, `UsageObservationWindow`, `UsageCalculationCycleAudit`, and `UsageSnapshot` schemas.
- [x] T015 Regenerate `apps/control-plane/openapi/families/metrics.openapi.json`, `services/internal-contracts/src/public-route-catalog.json`, and `docs/reference/architecture/public-api-surface.md` through `npm run generate:public-api`.

## Phase 5 — Documentation and story traceability

- [x] T016 Add `docs/reference/architecture/observability-usage-consumption.md` documenting the metered dimensions, source-mode split (business metric vs exact inventory), freshness semantics, scope isolation, and calculation-cycle audit compatibility.
- [x] T017 Update `docs/reference/architecture/README.md` so the new usage-consumption contract/doc pair is discoverable from the observability architecture index.
- [x] T018 Add `docs/tasks/us-obs-03.md` with a `## Scope delivered in 'US-OBS-03-T01'` section summarizing the usage-consumption baseline, published routes, permission delta, and residual boundary to T02–T06.

## Phase 6 — Tests

- [x] T019 Add `tests/unit/observability-usage-consumption.test.mjs` covering validator pass, usage summary output, deterministic dimension snapshots, tenant/workspace scope guards, zero/default filling, degraded freshness propagation, and calculation-cycle audit-record generation.
- [x] T020 Add `tests/contracts/observability-usage-consumption.contract.test.mjs` covering shared readers/accessors, authorization alignment, metrics-family OpenAPI route existence, public-route-catalog discoverability, public-api-taxonomy entries, and docs/task-summary discoverability.

## Phase 7 — Verification

- [x] T021 Run `npm run validate:observability-usage-consumption`.
- [x] T022 Run `node --test tests/unit/observability-usage-consumption.test.mjs`.
- [x] T023 Run `node --test tests/contracts/observability-usage-consumption.contract.test.mjs`.
- [x] T024 Run `npm run validate:public-api` after regenerating the family artifacts.
- [x] T025 Run `npm run lint:md -- specs/037-observability-usage-consumption/spec.md specs/037-observability-usage-consumption/plan.md specs/037-observability-usage-consumption/tasks.md docs/reference/architecture/observability-usage-consumption.md docs/reference/architecture/README.md docs/tasks/us-obs-03.md`.
- [x] T026 Run full `npm run lint` and full `npm test` successfully.
- [x] T027 Inspect the final diff to confirm the increment stayed within the usage-consumption contract, auth delta, control-plane helpers, metrics-family routes, docs, and tests — and did not absorb T02–T06 work.

## Phase 8 — Delivery

- [ ] T028 Commit the branch with a focused message for `US-OBS-03-T01`.
- [ ] T029 Push `037-observability-usage-consumption` to `origin`.
- [ ] T030 Open a PR from `037-observability-usage-consumption` to `main`.
- [ ] T031 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T032 Merge the PR to `main` once green.
- [ ] T033 Update the orchestrator state files with the completed unit (`US-OBS-03-T01`) and the next pending backlog unit.
