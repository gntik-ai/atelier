# Implementation Plan: US-OBS-03-T05 — Tenant Quota Usage and Provisioning-State View

**Feature Branch**: `041-tenant-quota-usage-view`
**Spec**: `specs/041-tenant-quota-usage-view/spec.md`
**Task**: `US-OBS-03-T05`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

`US-OBS-03-T05` delivers the first authoritative **tenant/workspace quota-usage overview** and the
first **tenant provisioning-state detail projection** that humans can actually consume.

The increment must add one shared contract and one deterministic helper surface that:

- project the existing T01 usage snapshots and T02 quota posture into a single per-dimension view
  with current usage, thresholds, hard-limit percentage, posture, freshness, and blocking context,
- expose a tenant-scoped provisioning-state detail model that is more actionable than the existing
  shallow dashboard status,
- publish tenant and workspace read routes under the `metrics` family so the console and external
  readers can fetch a single overview payload,
- provide a small `apps/web-console` helper layer that turns the overview payload into cards,
  rows, and a provisioning banner without requiring a full frontend buildout,
- and emit an audit-compatible access record for overview reads.

This task does **not** change quota policy evaluation (T02), threshold alert emission (T03),
creation-time blocking semantics (T04), or the cross-module enforcement verification matrix (T06).
It only makes those already-delivered capabilities visible and explorable.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in `US-OBS-03`

```text
T01 — usage-consumption baseline (already delivered)
T02 — quota policy contract + posture evaluation (already delivered)
T03 — threshold alert / event emission (already delivered)
T04 — hard-limit blocking/resource-creation enforcement (already delivered)
T05 — THIS TASK: quota usage overview + provisioning-state projection + console helpers
T06 — cross-module consumption/enforcement tests
```

### 2.2 Inputs reused from existing baselines

This task must stay additive and consume the baselines already published in the repo:

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/observability-hard-limit-enforcement.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/src/tenant-management.mjs`
- `apps/web-console/src/tenant-management.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `apps/control-plane/openapi/families/tenants.openapi.json`

The full aggregated OpenAPI document must only be patched programmatically and regenerated after the
family-file changes; it must not be used as broad LLM read context during implementation.

### 2.3 Target architecture

```text
T01 usage snapshot + T02 quota posture + T04 hard-limit evidence + tenant provisioning inputs
        ↓
services/internal-contracts/src/observability-quota-usage-view.json
        ↓ shared readers + accessors
services/internal-contracts/src/index.mjs
        ↓ validation + helper use
scripts/lib/observability-quota-usage-view.mjs
        ↓
apps/control-plane/src/observability-admin.mjs
        ↓
GET /v1/metrics/tenants/{tenantId}/overview
GET /v1/metrics/workspaces/{workspaceId}/overview
        ↓
apps/web-console/src/observability-quota-usage.mjs
```

### 2.4 Incremental implementation rule

Follow the same bounded pattern as T01–T04:

- the new overview layer consumes the existing usage/posture/enforcement outputs and does not
  recompute their core semantics,
- tenant provisioning detail is derived from explicit tenant/component inputs and remains a read
  projection, not a provisioning orchestrator,
- the web-console layer is limited to deterministic card/row/banner builders and does not attempt
  a React page implementation,
- all new route/resource/documentation changes stay additive,
- and the task keeps the downstream `T06` verification surface explicit instead of absorbing it.

### 2.5 Core design decisions

| Concern | Decision |
| --- | --- |
| Composite overview routes | Add `GET /v1/metrics/tenants/{tenantId}/overview` and `GET /v1/metrics/workspaces/{workspaceId}/overview` |
| Resource taxonomy | Add `tenant_quota_usage_view` and `workspace_quota_usage_view` |
| Authorization model | Add `tenant.overview.read` and `workspace.overview.read` for the composite overview routes |
| Per-dimension view fields | `dimensionId`, `displayName`, `currentUsage`, `warningThreshold`, `softLimit`, `hardLimit`, `usagePercentage`, `posture`, `freshnessStatus`, `lastUpdatedAt`, `blockingState`, `blockingReasonCode` |
| Provisioning detail scope | Tenant overview only; workspace overview remains quota/usage-only |
| Provisioning component roster | `storage`, `databases`, `messaging`, `functions`, `realtime` |
| Console representation | Deterministic helper builders in `apps/web-console`, not a full UI page |
| Blocking context | Reuse T04 hard-limit decision vocabulary when present; otherwise remain read-only |
| Audit for access | Provide an overview-access audit record helper with tenant/workspace scope metadata |

### 2.6 Explicit non-goals

This task will **not**:

- change the T01 usage dimension catalog,
- introduce new threshold semantics or new posture states beyond T02,
- emit threshold notifications or acknowledgements (T03),
- change creation-time denial behavior or provider adapter enforcement (T04),
- implement historical trend charts or billing/cost displays,
- create live React pages, routing, or Tailwind components,
- or implement the broad incremental-consumption / enforcement matrix reserved for `T06`.

---

## 3. Artifact-by-Artifact Change Plan

### 3.1 `services/internal-contracts/src/observability-quota-usage-view.json` (new)

Add one machine-readable contract that defines:

- source-contract versions for usage consumption, quota policies, hard-limit enforcement,
  authorization, and public API taxonomy,
- supported overview scopes:
  - `tenant_overview`
  - `workspace_overview`
- the composite per-dimension view model, including required fields and percentage rules,
- posture-to-visual-state mapping for console consumers:
  - `within_limits` → `healthy`
  - `warning_threshold_reached` / `warning_reached` → `warning`
  - `soft_limit_exceeded` → `elevated`
  - `hard_limit_reached` → `critical`
  - degraded/unavailable evidence → `degraded`
- `policiesConfigured` behavior for tenants/workspaces with no active quota policies,
- percentage rules:
  - calculate against `hardLimit` when present,
  - else against `softLimit` when present,
  - else `null`,
  - never cap over-limit percentages at `100`,
- tenant provisioning-state detail contract:
  - overall states `active`, `provisioning`, `degraded`, `error`,
  - component states `ready`, `in_progress`, `degraded`, `error`,
  - component fields `componentName`, `status`, `reason`, `lastCheckedAt`,
- route ids, resource types, permission ids, and overview-access audit metadata,
- explicit console-consumer guidance for card/banner/table builders,
- and explicit downstream boundaries to `T06`.

### 3.2 `services/internal-contracts/src/index.mjs` (update)

Expose the new contract through the shared reader pattern:

- `readObservabilityQuotaUsageView()`
- `OBSERVABILITY_QUOTA_USAGE_VIEW_VERSION`
- `listQuotaUsageViewScopes()` / `getQuotaUsageViewScope(scopeId)`
- `listQuotaUsageVisualStates()` / `getQuotaUsageVisualState(stateId)`
- `listProvisioningStateSummaries()` / `getProvisioningStateSummary(stateId)`
- `listProvisioningComponents()` / `getProvisioningComponent(componentId)`
- `getQuotaUsageViewAccessAuditContract()`
- `getQuotaUsageViewDefaults()`

### 3.3 `scripts/lib/observability-quota-usage-view.mjs` (new)

Add deterministic validation helpers that:

- assert source-version alignment with the T01/T02/T04/auth/public-api contracts,
- assert overview scopes, visual states, provisioning states, and component roster are complete,
- assert supported dimension ids all exist in the usage and quota contracts,
- assert posture-to-visual-state mappings cover all published posture states,
- assert the overview route ids exist in the public route catalog,
- assert the overview resource types exist in public API taxonomy,
- assert the overview permission ids exist in the authorization model,
- assert the access-audit contract enumerates required fields,
- and assert docs/task-summary discoverability remains intact.

### 3.4 `scripts/validate-observability-quota-usage-view.mjs` + `package.json` (new/update)

Add a dedicated validator entry point and wire:

- `validate:observability-quota-usage-view`
- inclusion into `validate:repo`

### 3.5 `services/internal-contracts/src/authorization-model.json` (update)

Add the read actions required by the new overview routes:

- `tenant.overview.read`
- `workspace.overview.read`

Then align:

- `resource_actions.tenant`
- `resource_actions.workspace`
- tenant/workspace delegable-action lists where appropriate
- relevant role grants in `permission_matrix`

The grants should remain parallel to the existing usage/quota read roles and must not introduce any
mutation capability.

### 3.6 `services/internal-contracts/src/public-api-taxonomy.json` (update)

Add resource taxonomy entries:

- `tenant_quota_usage_view`
- `workspace_quota_usage_view`

Both belong to the `metrics` family and map to the correct authorization resource (`tenant` /
`workspace`).

### 3.7 `apps/control-plane/src/observability-admin.mjs` (update)

Extend the existing observability helper surface with additive overview helpers:

- `summarizeObservabilityQuotaUsageView()`
- `buildQuotaUsageDimensionView(input)`
- `buildTenantProvisioningStateView(input)`
- `buildTenantQuotaUsageOverview(input)`
- `buildWorkspaceQuotaUsageOverview(input)`
- `buildQuotaUsageOverviewAccessAuditRecord(input)`
- `queryTenantQuotaUsageOverview(context, input)`
- `queryWorkspaceQuotaUsageOverview(context, input)`
- `listQuotaUsageOverviewRoutes()`

Implementation constraints:

- reuse the T01 usage snapshot and T02 quota posture helpers rather than bypassing them,
- preserve strict tenant/workspace scope guards consistent with the existing metrics routes,
- normalize the posture naming difference (`within_limit` vs `within_limits`,
  `warning_threshold_reached` vs `warning_reached`) inside one deterministic mapping layer,
- carry forward freshness and `lastUpdatedAt` data from the usage baseline,
- attach T04 hard-limit blocking context only additively when evidence is provided,
- and keep tenant provisioning detail strictly tenant-scoped.

### 3.8 `apps/control-plane/openapi/control-plane.openapi.json` + generated public artifacts

Patch the unified OpenAPI source programmatically to add:

- `GET /v1/metrics/tenants/{tenantId}/overview` → `getTenantQuotaUsageOverview`
- `GET /v1/metrics/workspaces/{workspaceId}/overview` → `getWorkspaceQuotaUsageOverview`
- additive component schemas:
  - `QuotaUsageDimensionView`
  - `QuotaUsageOverviewAccessAudit`
  - `ProvisioningComponentState`
  - `TenantProvisioningStateView`
  - `TenantQuotaUsageOverview`
  - `WorkspaceQuotaUsageOverview`

Then regenerate:

- `apps/control-plane/openapi/families/metrics.openapi.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `docs/reference/architecture/public-api-surface.md`

No direct edit to the aggregated document should be used as LLM read context during implementation.

### 3.9 `apps/web-console/src/observability-quota-usage.mjs` + `apps/web-console/src/README.md` (new/update)

Add one bounded console-consumer module that converts overview payloads into deterministic,
frontend-friendly structures:

- `buildTenantQuotaUsageCards(overview)`
- `buildTenantProvisioningBanner(overview)`
- `buildQuotaUsageTableRows(overview)`
- `buildWorkspaceQuotaUsageRows(overview)`

This layer should remain presentation-oriented and dependency-free. Update the web-console README so
quota/provisioning overview helpers are discoverable.

### 3.10 Documentation

Add/update:

- `docs/reference/architecture/observability-quota-usage-view.md` (new)
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`

The architecture note should explain:

- why T05 consumes T01/T02/T04 rather than redefining them,
- the per-dimension view model and percentage rules,
- posture-to-visual-state mapping for console consumers,
- tenant provisioning-state detail model and component roster,
- access-audit expectations,
- scope isolation and console-consumer boundaries,
- and the residual boundary to `T06`.

### 3.11 Tests

Add/update bounded tests for:

- contract/reader validity,
- overview builder determinism,
- scope-guard behavior,
- posture-to-visual-state mapping,
- provisioning-state aggregation and banner behavior,
- OpenAPI route/resource discoverability,
- and web-console row/card/banner helper outputs.

---

## 4. Data / Contract Model

### 4.1 Per-dimension overview shape

Each dimension entry should publish at least:

- `dimensionId`
- `displayName`
- `scope`
- `currentUsage`
- `unit`
- `warningThreshold`
- `softLimit`
- `hardLimit`
- `usagePercentage`
- `posture`
- `visualState`
- `freshnessStatus`
- `lastUpdatedAt`
- `blockingState`
- `blockingReasonCode`

### 4.2 Tenant overview shape

Each tenant overview should publish at least:

- `overviewId`
- `tenantId`
- `queryScope`
- `generatedAt`
- `policiesConfigured`
- `dimensions`
- `overallPosture`
- `warningDimensions`
- `softLimitDimensions`
- `hardLimitDimensions`
- `provisioningState`
- `accessAudit`

### 4.3 Workspace overview shape

Each workspace overview should publish at least:

- `overviewId`
- `tenantId`
- `workspaceId`
- `queryScope`
- `generatedAt`
- `policiesConfigured`
- `dimensions`
- `overallPosture`
- `warningDimensions`
- `softLimitDimensions`
- `hardLimitDimensions`
- `accessAudit`

No tenant-level provisioning breakdown should be widened into a workspace response beyond safe
summary fields if included at all.

### 4.4 Provisioning-state detail shape

The tenant provisioning detail should publish at least:

- `state`
- `visualState`
- `components`
- `degradedComponents`
- `lastCheckedAt`
- `reasonSummary`

Each component should publish:

- `componentName`
- `status`
- `reason`
- `lastCheckedAt`

### 4.5 Visual-state mapping rules

Use one deterministic visual-state vocabulary for console helpers:

- `healthy`
- `warning`
- `elevated`
- `critical`
- `degraded`
- `unknown`

Quota posture and provisioning state must map into this vocabulary without requiring UI consumers
to re-encode status rules.

---

## 5. Risks, Compatibility, and Rollback

### 5.1 Risks

- **Posture vocabulary drift**: T02 currently uses posture ids that differ slightly from the T05
  spec language. Mitigation: centralize alias normalization in the overview helper/contract.
- **Provisioning-source ambiguity**: the existing tenant dashboard exposes only a shallow
  `provisioningStatus`. Mitigation: define a minimal but explicit component roster in the T05
  contract and require explicit component inputs in the helper surface.
- **Overview route overreach**: a composite route could accidentally widen access. Mitigation: add
  dedicated overview permissions and keep tenant/workspace scope guards equivalent to T01/T02.
- **Console creep into React implementation**: the task could expand into full frontend work.
  Mitigation: keep the console layer limited to deterministic helper builders under
  `apps/web-console/src/`.

### 5.2 Compatibility

All changes are additive:

- new internal contract,
- additive shared readers,
- additive overview permissions,
- additive resource taxonomy,
- additive metrics-family routes/schemas,
- additive console helper module,
- additive docs/tests.

No database migration or runtime state migration is required.

### 5.3 Rollback

Rollback is straightforward because the increment is isolated to contract/helper/route publication,
console helper projections, docs, and tests. Reverting the branch removes the overview routes and
projection layers without altering existing T01–T04 behavior.

---

## 6. Verification Strategy

Minimum green set for this increment:

- `npm run validate:observability-quota-usage-view`
- `node --test tests/unit/observability-quota-usage-view.test.mjs`
- `node --test tests/contracts/observability-quota-usage-view.contract.test.mjs`
- `node --test tests/unit/tenant-management.test.mjs`
- `npm run generate:public-api`
- `npm run validate:public-api`
- `npm run lint`
- `npm test`

---

## 7. Recommended Execution Sequence

1. Materialize `plan.md` and `tasks.md` for `US-OBS-03-T05`.
2. Add the new quota-usage-view internal contract.
3. Expose shared readers/accessors in `index.mjs`.
4. Add validator library and dedicated validate script plus package wiring.
5. Add auth/public-api taxonomy deltas.
6. Extend `observability-admin.mjs` with overview/provisioning/audit helpers.
7. Patch the OpenAPI source programmatically and regenerate public API artifacts.
8. Add the bounded `apps/web-console` helper module and README note.
9. Add architecture/task docs.
10. Add unit and contract tests, including the console helper coverage.
11. Run targeted validation, then full lint/test.
12. Commit, push, open PR, watch CI, fix deterministic regressions, merge, and update orchestrator state.

---

## 8. Definition of Done

`US-OBS-03-T05` is done when:

- `services/internal-contracts/src/observability-quota-usage-view.json` exists and validates,
- shared readers/accessors are available through `services/internal-contracts/src/index.mjs`,
- `tenant.overview.read` / `workspace.overview.read` and overview resource taxonomy are published,
- `observability-admin.mjs` exposes deterministic tenant/workspace overview builders plus a tenant
  provisioning-state builder and access-audit helper,
- metrics-family overview routes and schemas exist in the generated public API artifacts,
- `apps/web-console/src/observability-quota-usage.mjs` exposes deterministic cards/rows/banner
  builders for tenant/workspace overview payloads,
- architecture docs and task summary are updated and discoverable,
- targeted validator/unit/contract runs are green,
- full `npm run lint` and `npm test` are green,
- and the branch is delivered through commit → push → PR → CI green → merge without absorbing
  `T06`.
