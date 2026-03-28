# Tasks: US-OBS-03-T05 — Tenant Quota Usage and Provisioning-State View

**Input**: `specs/041-tenant-quota-usage-view/plan.md`
**Feature Branch**: `041-tenant-quota-usage-view`
**Task**: `US-OBS-03-T05`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

> **Token-optimization rule**: do NOT read
> `apps/control-plane/openapi/control-plane.openapi.json` directly as context.
> Use only the listed family OpenAPI files as read context, then regenerate the aggregate public API
> after changes.

### Spec artifacts

- `specs/041-tenant-quota-usage-view/plan.md`
- `specs/041-tenant-quota-usage-view/tasks.md`

### Existing contract + reader references (read-only)

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/observability-hard-limit-enforcement.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`

### Existing helper + route-pattern references (read-only)

- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/src/tenant-management.mjs`
- `apps/web-console/src/tenant-management.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `apps/control-plane/openapi/families/tenants.openapi.json`
- `docs/reference/architecture/observability-usage-consumption.md`
- `docs/reference/architecture/observability-quota-policies.md`
- `docs/reference/architecture/observability-hard-limit-enforcement.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `apps/web-console/src/README.md`
- `package.json`

### Existing test/pattern references (read-only)

- `tests/unit/observability-usage-consumption.test.mjs`
- `tests/unit/observability-quota-policies.test.mjs`
- `tests/unit/tenant-management.test.mjs`
- `tests/contracts/observability-usage-consumption.contract.test.mjs`
- `tests/contracts/observability-quota-policies.contract.test.mjs`

### New or updated delivery targets

- `services/internal-contracts/src/observability-quota-usage-view.json`
- `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-quota-usage-view.mjs`
- `scripts/validate-observability-quota-usage-view.mjs`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/control-plane.openapi.json` (edit programmatically without using it as broad read context)
- `apps/control-plane/openapi/families/metrics.openapi.json` (generated)
- `services/internal-contracts/src/public-route-catalog.json` (generated)
- `docs/reference/architecture/public-api-surface.md` (generated)
- `apps/web-console/src/observability-quota-usage.mjs`
- `apps/web-console/src/README.md`
- `docs/reference/architecture/observability-quota-usage-view.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `tests/unit/observability-quota-usage-view.test.mjs`
- `tests/contracts/observability-quota-usage-view.contract.test.mjs`
- `tests/unit/tenant-management.test.mjs`
- `package.json`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/041-tenant-quota-usage-view/spec.md` with the bounded quota/provisioning overview scope for `US-OBS-03-T05`.
- [x] T002 Materialize `specs/041-tenant-quota-usage-view/plan.md` with the contract, helper, route, console-helper, docs, validation, and delivery sequence.
- [x] T003 Materialize `specs/041-tenant-quota-usage-view/tasks.md` and keep it aligned with the bounded T05 delta.

## Phase 2 — Internal contract and validation baseline

- [ ] T004 Add `services/internal-contracts/src/observability-quota-usage-view.json` covering:
  - source-contract version pins for usage consumption, quota policies, hard-limit enforcement, authorization, and public API,
  - overview scopes (`tenant_overview`, `workspace_overview`),
  - required per-dimension fields for current usage, thresholds, percentage, posture, visual state, freshness, and blocking context,
  - posture-to-visual-state mappings,
  - percentage calculation rules and `policiesConfigured` semantics,
  - tenant provisioning-state summary + component roster (`storage`, `databases`, `messaging`, `functions`, `realtime`),
  - overview route ids, resource types, permission ids, and access-audit metadata,
  - explicit console-consumer guidance,
  - explicit downstream boundary to `T06`.
- [ ] T005 Update `services/internal-contracts/src/index.mjs` to expose:
  - `readObservabilityQuotaUsageView()` and `OBSERVABILITY_QUOTA_USAGE_VIEW_VERSION`,
  - `listQuotaUsageViewScopes()` / `getQuotaUsageViewScope(scopeId)`,
  - `listQuotaUsageVisualStates()` / `getQuotaUsageVisualState(stateId)`,
  - `listProvisioningStateSummaries()` / `getProvisioningStateSummary(stateId)`,
  - `listProvisioningComponents()` / `getProvisioningComponent(componentId)`,
  - `getQuotaUsageViewAccessAuditContract()`,
  - `getQuotaUsageViewDefaults()`.
- [ ] T006 Add `scripts/lib/observability-quota-usage-view.mjs` exporting deterministic validation helpers for version alignment, scope/visual-state completeness, provisioning component completeness, route/resource/permission discoverability, posture-mapping coverage, and docs discoverability.
- [ ] T007 Add `scripts/validate-observability-quota-usage-view.mjs` and wire `validate:observability-quota-usage-view` into `package.json` plus include it in `validate:repo`.

## Phase 3 — Authorization, taxonomy, and control-plane helper surface

- [ ] T008 Update `services/internal-contracts/src/authorization-model.json` with the new `tenant.overview.read` and `workspace.overview.read` actions, bounded delegable-action support, and role grants for platform / tenant / workspace readers that should consume overview payloads.
- [ ] T009 Update `services/internal-contracts/src/public-api-taxonomy.json` with `tenant_quota_usage_view` and `workspace_quota_usage_view` resource-taxonomy entries mapped to `tenant` and `workspace` authorization resources.
- [ ] T010 Extend `apps/control-plane/src/observability-admin.mjs` with `summarizeObservabilityQuotaUsageView()` and additive overview-contract exports/helpers.
- [ ] T011 Add deterministic builders in `observability-admin.mjs` for:
  - `buildQuotaUsageDimensionView(input)`
  - `buildTenantProvisioningStateView(input)`
  - `buildTenantQuotaUsageOverview(input)`
  - `buildWorkspaceQuotaUsageOverview(input)`
  - `buildQuotaUsageOverviewAccessAuditRecord(input)`
- [ ] T012 Add `queryTenantQuotaUsageOverview(context, input)`, `queryWorkspaceQuotaUsageOverview(context, input)`, and `listQuotaUsageOverviewRoutes()` in `observability-admin.mjs` with strict tenant/workspace scope guards and posture-alias normalization.

## Phase 4 — Public API publication

- [ ] T013 Patch `apps/control-plane/openapi/control-plane.openapi.json` programmatically to add:
  - `GET /v1/metrics/tenants/{tenantId}/overview` → `getTenantQuotaUsageOverview`
  - `GET /v1/metrics/workspaces/{workspaceId}/overview` → `getWorkspaceQuotaUsageOverview`
  - additive schemas `QuotaUsageDimensionView`, `QuotaUsageOverviewAccessAudit`, `ProvisioningComponentState`, `TenantProvisioningStateView`, `TenantQuotaUsageOverview`, and `WorkspaceQuotaUsageOverview`.
- [ ] T014 Regenerate `apps/control-plane/openapi/families/metrics.openapi.json`, `services/internal-contracts/src/public-route-catalog.json`, and `docs/reference/architecture/public-api-surface.md` through `npm run generate:public-api`.

## Phase 5 — Console-consumer helpers and documentation

- [ ] T015 Add `apps/web-console/src/observability-quota-usage.mjs` exposing deterministic console-friendly builders:
  - `buildTenantQuotaUsageCards(overview)`
  - `buildTenantProvisioningBanner(overview)`
  - `buildQuotaUsageTableRows(overview)`
  - `buildWorkspaceQuotaUsageRows(overview)`.
- [ ] T016 Update `apps/web-console/src/README.md` so the new quota/provisioning overview helper module is discoverable.
- [ ] T017 Add `docs/reference/architecture/observability-quota-usage-view.md` documenting the composite overview model, posture-to-visual-state mapping, percentage rules, provisioning detail model, access-audit expectations, scope isolation, and residual `T06` boundary.
- [ ] T018 Update `docs/reference/architecture/README.md` so the new quota-usage-view contract/doc pair is discoverable from the observability architecture index.
- [ ] T019 Update `docs/tasks/us-obs-03.md` with a `## Scope delivered in 'US-OBS-03-T05'` section summarizing the overview routes, permission/resource-type delta, console-helper baseline, and residual boundary to `T06`.

## Phase 6 — Tests

- [ ] T020 Add `tests/unit/observability-quota-usage-view.test.mjs` covering:
  - validator pass for the new contract,
  - summary output shape,
  - percentage calculation against hard-limit / soft-limit / no-limit cases,
  - posture-to-visual-state mapping,
  - over-limit percentages above 100,
  - `policiesConfigured=false` behavior,
  - tenant provisioning-state aggregation,
  - tenant/workspace scope guards,
  - overview-access audit-record generation,
  - console-helper row/card/banner outputs.
- [ ] T021 Add `tests/contracts/observability-quota-usage-view.contract.test.mjs` covering:
  - shared readers/accessors exported from `index.mjs`,
  - source-contract version alignment,
  - overview route existence in the metrics family,
  - public-route-catalog discoverability,
  - authorization alignment for `tenant.overview.read` / `workspace.overview.read`,
  - public-api-taxonomy entries,
  - docs references exist.
- [ ] T022 Update `tests/unit/tenant-management.test.mjs` only if needed to assert the existing tenant-management helpers remain compatible and non-regressed after the new overview helper module lands.

## Phase 7 — Verification

- [ ] T023 Run `npm run validate:observability-quota-usage-view`.
- [ ] T024 Run `node --test tests/unit/observability-quota-usage-view.test.mjs`.
- [ ] T025 Run `node --test tests/contracts/observability-quota-usage-view.contract.test.mjs`.
- [ ] T026 Run `node --test tests/unit/tenant-management.test.mjs`.
- [ ] T027 Run `npm run validate:public-api` after regenerating the family artifacts.
- [ ] T028 Run `npm run lint` and `npm test` successfully.
- [ ] T029 Inspect the final diff to confirm the increment stayed within contract + helper + metrics route + console helper + docs + tests, and did not absorb `T06`.

## Phase 8 — Delivery

- [ ] T030 Commit the branch with a focused message for `US-OBS-03-T05`.
- [ ] T031 Push `041-tenant-quota-usage-view` to `origin`.
- [ ] T032 Open a PR from `041-tenant-quota-usage-view` to `main`.
- [ ] T033 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T034 Merge the PR to `main` once green.
- [ ] T035 Update the orchestrator state files with the completed unit (`US-OBS-03-T05`) and the next pending backlog unit.
