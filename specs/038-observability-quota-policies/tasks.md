# Tasks: US-OBS-03-T02 — Quota Policies for Hard Limit, Soft Limit, and Warning Threshold

**Input**: `specs/038-observability-quota-policies/plan.md`
**Feature Branch**: `038-observability-quota-policies`
**Task**: `US-OBS-03-T02`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

### Spec artifacts

- `specs/038-observability-quota-policies/plan.md`
- `specs/038-observability-quota-policies/tasks.md`

### Existing contract + reader references

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-health-checks.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`

### Existing helper + route-pattern references

- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `scripts/lib/observability-usage-consumption.mjs`
- `tests/unit/observability-usage-consumption.test.mjs`
- `tests/contracts/observability-usage-consumption.contract.test.mjs`
- `docs/reference/architecture/observability-usage-consumption.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `package.json`

### New or updated delivery targets

- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-quota-policies.mjs`
- `scripts/validate-observability-quota-policies.mjs`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/control-plane.openapi.json` (edit programmatically without using it as broad read context)
- `apps/control-plane/openapi/families/metrics.openapi.json` (generated)
- `services/internal-contracts/src/public-route-catalog.json` (generated)
- `docs/reference/architecture/public-api-surface.md` (generated)
- `docs/reference/architecture/observability-quota-policies.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `tests/unit/observability-quota-policies.test.mjs`
- `tests/contracts/observability-quota-policies.contract.test.mjs`
- `package.json`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/038-observability-quota-policies/spec.md` with the bounded quota-policy scope for `US-OBS-03-T02`.
- [x] T002 Materialize `specs/038-observability-quota-policies/plan.md` with the contract, helper, route, auth, docs, and validation sequence.
- [x] T003 Materialize `specs/038-observability-quota-policies/tasks.md` and keep it aligned with the bounded T02 delta.

## Phase 2 — Internal contract and validation baseline

- [ ] T004 Add `services/internal-contracts/src/observability-quota-policies.json` covering posture scopes, threshold types, posture states, ordering rules, supported metered dimensions, audit compatibility, route ids, permission ids, and explicit T03–T06 boundaries.
- [ ] T005 Update `services/internal-contracts/src/index.mjs` to expose the quota-policy reader, version export, scope accessors, threshold-type accessors, posture-state accessors, evaluation-default accessors, and evaluation-audit accessor.
- [ ] T006 Add `scripts/lib/observability-quota-policies.mjs` exporting `collectObservabilityQuotaPolicyViolations(contract, dependencies)` with deterministic checks for source-version alignment, required scopes/threshold types/posture states, known usage dimensions, known auth actions, known public resource types, known route operation ids, and explicit downstream boundaries.
- [ ] T007 Add `scripts/validate-observability-quota-policies.mjs` and wire `validate:observability-quota-policies` into `package.json` plus `validate:repo`.

## Phase 3 — Authorization and control-plane helper surface

- [ ] T008 Update `services/internal-contracts/src/authorization-model.json` with the new `tenant.quota.read` and `workspace.quota.read` actions, bounded delegable-action support, and role grants for platform / tenant / workspace readers that should consume quota posture snapshots.
- [ ] T009 Extend `apps/control-plane/src/observability-admin.mjs` with `summarizeObservabilityQuotaPolicies()` and additive quota-contract exports/helpers.
- [ ] T010 Add deterministic policy builders and evaluators in `observability-admin.mjs` for `buildQuotaDimensionPolicy()` and `evaluateQuotaDimensionPosture()` with inclusive threshold semantics and explicit absent-soft-limit handling.
- [ ] T011 Add `buildTenantQuotaPosture()`, `buildWorkspaceQuotaPosture()`, and `buildQuotaEvaluationAuditRecord()` in `observability-admin.mjs`, preserving usage freshness and strict tenant/workspace scope binding.
- [ ] T012 Add `queryTenantQuotaPosture(context, input)`, `queryWorkspaceQuotaPosture(context, input)`, and `listQuotaPolicyRoutes()` in `observability-admin.mjs` with predictable default loader behavior and no alert/block side effects.

## Phase 4 — Public API publication

- [ ] T013 Update `services/internal-contracts/src/public-api-taxonomy.json` with `tenant_quota_posture` and `workspace_quota_posture` resource-taxonomy entries mapped to `tenant` and `workspace` authorization resources.
- [ ] T014 Patch `apps/control-plane/openapi/control-plane.openapi.json` programmatically to add `GET /v1/metrics/tenants/{tenantId}/quotas` and `GET /v1/metrics/workspaces/{workspaceId}/quotas`, plus additive `QuotaThresholdPolicy`, `QuotaDimensionPosture`, `QuotaEvaluationAudit`, and `QuotaPosture` schemas.
- [ ] T015 Regenerate `apps/control-plane/openapi/families/metrics.openapi.json`, `services/internal-contracts/src/public-route-catalog.json`, and `docs/reference/architecture/public-api-surface.md` through `npm run generate:public-api`.

## Phase 5 — Documentation and story traceability

- [ ] T016 Add `docs/reference/architecture/observability-quota-policies.md` documenting threshold ordering, posture states, scope isolation, freshness propagation from usage, and audit compatibility.
- [ ] T017 Update `docs/reference/architecture/README.md` so the new quota-policy contract/doc pair is discoverable from the observability architecture index.
- [ ] T018 Update `docs/tasks/us-obs-03.md` with a `## Scope delivered in 'US-OBS-03-T02'` section summarizing the quota-policy baseline, published routes, permission delta, and residual boundary to T03–T06.

## Phase 6 — Tests

- [ ] T019 Add `tests/unit/observability-quota-policies.test.mjs` covering validator pass, summary output, threshold ordering, inclusive equality semantics, absent-soft-limit handling, unbounded dimensions, freshness propagation, overall-status precedence, and scope guards.
- [ ] T020 Add `tests/contracts/observability-quota-policies.contract.test.mjs` covering shared readers/accessors, authorization alignment, metrics-family OpenAPI route existence, public-route-catalog discoverability, public-api-taxonomy entries, and docs/task-summary discoverability.

## Phase 7 — Verification

- [ ] T021 Run `npm run validate:observability-quota-policies`.
- [ ] T022 Run `node --test tests/unit/observability-quota-policies.test.mjs`.
- [ ] T023 Run `node --test tests/contracts/observability-quota-policies.contract.test.mjs`.
- [ ] T024 Run `npm run validate:public-api` after regenerating the family artifacts.
- [ ] T025 Run `npm run lint:md -- specs/038-observability-quota-policies/spec.md specs/038-observability-quota-policies/plan.md specs/038-observability-quota-policies/tasks.md docs/reference/architecture/observability-quota-policies.md docs/reference/architecture/README.md docs/tasks/us-obs-03.md`.
- [ ] T026 Run full `npm run lint` and full `npm test` successfully.
- [ ] T027 Inspect the final diff to confirm the increment stayed within the quota-policy contract, auth delta, control-plane helpers, metrics-family routes, docs, and tests — and did not absorb T03–T06 work.

## Phase 8 — Delivery

- [ ] T028 Commit the branch with a focused message for `US-OBS-03-T02`.
- [ ] T029 Push `038-observability-quota-policies` to `origin`.
- [ ] T030 Open a PR from `038-observability-quota-policies` to `main`.
- [ ] T031 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T032 Merge the PR to `main` once green.
- [ ] T033 Update the orchestrator state files with the completed unit (`US-OBS-03-T02`) and the next pending backlog unit.
