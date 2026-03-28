# Implementation Plan: US-OBS-03-T01 — Usage Consumption Calculation per Tenant and Workspace

**Feature Branch**: `037-observability-usage-consumption`
**Spec**: `specs/037-observability-usage-consumption/spec.md`
**Task**: `US-OBS-03-T01`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

`US-OBS-03-T01` delivers the first authoritative **usage-consumption baseline** for the observability and quota story.

The increment must establish one shared contract and one executable helper surface that:

- normalize the metered-dimension catalog for tenant and workspace scope,
- calculate bounded usage snapshots from business-metric inputs plus exact inventory counts,
- surface freshness/degradation state when observability evidence is stale,
- expose tenant/workspace read routes in the `metrics` API family,
- and emit an audit-compatible calculation-cycle summary that downstream quota, alerting, blocking, and console work can reuse.

This task does **not** implement quota thresholds, alert emission, hard blocking, or the final console usage-vs-quota experience. It only delivers the trusted usage input layer they depend on.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in `US-OBS-03`

```text
T01 — THIS TASK: usage-consumption baseline and query surface
T02 — quota policy evaluation and warning/hard-limit semantics
T03 — alert/event emission on threshold breach
T04 — blocking/resource-creation enforcement on hard breach
T05 — console usage-vs-quota view and provisioning state
T06 — cross-module consumption/enforcement tests
```

`T01` must stay usable on its own. It publishes the usage snapshot contract and query/build helpers without pulling in threshold evaluation or enforcement state transitions.

### 2.2 Inputs reused from existing baselines

This task consumes existing repository baselines instead of inventing new telemetry vocabulary:

- `services/internal-contracts/src/observability-business-metrics.json`
- `services/internal-contracts/src/observability-health-checks.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/control-plane.openapi.json` (updated programmatically; do not use it as broad read context)
- `apps/control-plane/openapi/families/metrics.openapi.json` (read-only route/schema map)

### 2.3 Target architecture

```text
observability-business-metrics + health freshness + inventory counts
        ↓
services/internal-contracts/src/observability-usage-consumption.json
        ↓ shared readers + accessors
services/internal-contracts/src/index.mjs
        ↓ validation + helper use
scripts/lib/observability-usage-consumption.mjs
        ↓
apps/control-plane/src/observability-admin.mjs
        ↓
GET /v1/metrics/tenants/{tenantId}/usage
GET /v1/metrics/workspaces/{workspaceId}/usage
```

### 2.4 Incremental implementation rule

The repository already uses deterministic helper surfaces instead of live provider coupling inside these increments. `T01` follows the same rule:

- usage calculation helpers operate on explicit input payloads / loader callbacks,
- inventory-backed dimensions use exact counts supplied by the caller/loader,
- freshness is derived from declared collection-health inputs,
- and route contracts publish the final response shape now so later tasks can consume them safely.

### 2.5 Explicit non-goals

This task will **not**:

- define warning / soft / hard threshold policy logic,
- emit alerts or events for breaches,
- block resource creation,
- add console UI components,
- add billing or cost attribution,
- or add end-to-end quota-enforcement test suites.

---

## 3. Artifact-by-Artifact Change Plan

### 3.1 `services/internal-contracts/src/observability-usage-consumption.json` (new)

Add one machine-readable contract that defines:

- source-contract versions (`observability-business-metrics`, `observability-health-checks`, `observability-audit-event-schema`, `authorization-model`, `public-api-taxonomy`),
- supported snapshot scopes: `tenant`, `workspace`,
- refresh policy with default cadence `300` seconds,
- the metered-dimension catalog for:
  - `api_requests`
  - `function_invocations`
  - `storage_volume_bytes`
  - `data_service_operations`
  - `realtime_connections`
  - `logical_databases`
  - `topics`
  - `collections_tables`
  - `error_count`
- per-dimension metadata:
  - `unit`
  - `aggregation_kind`
  - `supported_scopes`
  - `source_mode` (`business_metric_family` or `control_plane_inventory`)
  - source family / inventory capability reference,
- freshness vocabulary (`fresh`, `degraded`, `unavailable`),
- required snapshot fields and observation-window semantics,
- calculation-cycle audit summary expectations compatible with the audit event schema,
- supported public route operation ids and required permissions,
- and explicit boundaries to `T02`–`T06`.

### 3.2 `services/internal-contracts/src/index.mjs` (update)

Expose the new contract through the shared reader pattern:

- `readObservabilityUsageConsumption()`
- `OBSERVABILITY_USAGE_CONSUMPTION_VERSION`
- `listUsageConsumptionScopes()` / `getUsageConsumptionScope(scopeId)`
- `listUsageMeteredDimensions()` / `getUsageMeteredDimension(dimensionId)`
- `listUsageFreshnessStates()` / `getUsageFreshnessState(stateId)`
- `getUsageRefreshPolicy()`
- `getUsageCalculationAuditContract()`

### 3.3 `scripts/lib/observability-usage-consumption.mjs` (new)

Add deterministic validation helpers following the existing observability contract pattern.

Responsibilities:

- read the new contract and its dependencies,
- assert source-version alignment,
- assert all required dimensions/scopes/freshness states exist,
- assert route ids exist in the public route catalog,
- assert resource types exist in public API taxonomy,
- assert required permissions exist in the authorization model,
- assert business-metric-backed dimensions map only to known metric families,
- assert inventory-backed dimensions stay workspace/tenant-safe and explicitly non-approximate,
- assert the calculation audit contract remains aligned with the audit-event schema vocabulary.

### 3.4 `scripts/validate-observability-usage-consumption.mjs` + `package.json` (new/update)

Add a dedicated validator entry point and wire it into `validate:repo`.

### 3.5 `services/internal-contracts/src/authorization-model.json` (update)

Add the missing workspace-scoped permission needed by the new route surface:

- `workspace.usage.read`

Then align:

- `resource_actions.workspace`
- `resource_governance[*].delegable_actions` for `workspace`
- relevant `permission_matrix` role grants so tenant/platform roles that already read usage or workspace observability can read workspace usage snapshots without widening scope unexpectedly.

### 3.6 `services/internal-contracts/src/public-api-taxonomy.json` (update)

Add public taxonomy entries:

- `tenant_usage_snapshot`
- `workspace_usage_snapshot`

Both belong to the `metrics` family and map to the correct authorization resource (`tenant` / `workspace`).

### 3.7 `apps/control-plane/src/observability-admin.mjs` (update)

Extend the existing observability helper surface with additive usage-consumption helpers:

- `summarizeObservabilityUsageConsumption()`
- `buildUsageDimensionSnapshot(...)`
- `buildTenantUsageSnapshot(...)`
- `buildWorkspaceUsageSnapshot(...)`
- `buildUsageCalculationCycleAuditRecord(...)`
- `queryTenantUsageSnapshot(context, input)`
- `queryWorkspaceUsageSnapshot(context, input)`
- `listUsageConsumptionRoutes()`

Implementation constraints:

- use the contract catalog as the source of truth for dimensions, scopes, units, and freshness states,
- zero-fill or null-fill dimensions consistently when inputs are omitted,
- reject scope widening (`tenant` route cannot accept a workspace target; workspace route cannot escape caller workspace scope),
- require observation window metadata and snapshot timestamp,
- and keep calculation/audit payloads additive and bounded.

### 3.8 Public API source + generated artifacts

Update the unified OpenAPI source programmatically to add:

- `GET /v1/metrics/tenants/{tenantId}/usage` → `getTenantUsageSnapshot`
- `GET /v1/metrics/workspaces/{workspaceId}/usage` → `getWorkspaceUsageSnapshot`
- additive component schemas:
  - `UsageDimensionSnapshot`
  - `UsageObservationWindow`
  - `UsageCalculationCycleAudit`
  - `UsageSnapshot`

Then regenerate:

- `apps/control-plane/openapi/families/metrics.openapi.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `docs/reference/architecture/public-api-surface.md`

### 3.9 Documentation

Add/update:

- `docs/reference/architecture/observability-usage-consumption.md` (new)
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md` (new task summary for story `US-OBS-03`)

The architecture doc should explain scope semantics, dimension sources, freshness handling, inventory-derived exact counts, audit-cycle compatibility, and the explicit downstream boundary to `T02`–`T06`.

### 3.10 Tests

Add:

- `tests/unit/observability-usage-consumption.test.mjs`
- `tests/contracts/observability-usage-consumption.contract.test.mjs`

Unit coverage should focus on helper determinism, zero/default behavior, freshness propagation, scope-isolation guards, and audit-cycle summary generation.

Contract coverage should focus on shared readers, authorization/public-api alignment, OpenAPI route existence, generated route catalog presence, and documentation discoverability.

---

## 4. Data / Contract Model

### 4.1 Metered dimension shape

Each dimension entry should publish at least:

- `dimensionId`
- `displayName`
- `value`
- `unit`
- `scope`
- `freshnessStatus`
- `sourceMode`
- `sourceRef`
- `observedAt`

### 4.2 Snapshot shape

Each snapshot should publish at least:

- `snapshotId`
- `queryScope`
- `tenantId`
- `workspaceId` (`null` for tenant scope)
- `snapshotTimestamp`
- `observationWindow`
- `dimensions`
- `degradedDimensions`
- `calculationCycle`

### 4.3 Calculation-cycle audit shape

The audit-compatible calculation record should stay bounded and compatible with the existing audit-event vocabulary:

- subsystem: `quota_metering`
- action category: `configuration_change`
- origin surface: `scheduled_operation`
- detail fields limited to cycle metadata, processed scopes, and degraded dimension ids

No raw tenant-comparative payload or cross-tenant widening data should leak into a workspace response.

---

## 5. Test and Verification Strategy

### 5.1 Targeted tests

- validator passes with zero violations,
- tenant snapshot builder emits all catalog dimensions,
- workspace snapshot builder enforces workspace binding and still carries tenant context,
- omitted values default predictably without removing catalog entries,
- stale/unavailable collection health marks the right dimensions degraded/unavailable,
- calculation-cycle audit records stay aligned with audit schema vocabulary,
- route list exposes both public operation ids.

### 5.2 Contract verification

- shared readers expose the new contract/version/accessors,
- OpenAPI contains the new routes and schemas,
- public route catalog contains both operation ids,
- public API taxonomy contains both resource types,
- authorization model contains `tenant.usage.read` and `workspace.usage.read`,
- docs index and task summary reference the new baseline.

### 5.3 Final verification

Run at minimum:

```bash
npm run validate:observability-usage-consumption
node --test tests/unit/observability-usage-consumption.test.mjs
node --test tests/contracts/observability-usage-consumption.contract.test.mjs
npm run validate:public-api
npm run lint
npm test
```

---

## 6. Risks, Compatibility, and Rollback

### 6.1 Risks

- **Permission drift**: workspace usage routes need a new action; forgetting role alignment would leave the route published but not reachable.
- **Metric-family drift**: the usage contract must reference only known business metric families from `US-OBS-01-T04`.
- **Scope leakage**: tenant/workspace query helpers must reject widening early.
- **Future-policy coupling**: if `T01` embeds quota threshold logic now, it would make `T02` non-incremental.

### 6.2 Compatibility

All changes are additive:

- new internal contract,
- new readers/accessors,
- additive auth action,
- additive public route/resource types,
- additive helper exports,
- additive docs/tests.

### 6.3 Rollback

Rollback is straightforward because the increment is isolated to contract/helper/route publication and docs/tests. Reverting the branch removes the new contract, helpers, permissions, routes, and generated artifacts without migrating persisted data.

---

## 7. Recommended Execution Sequence

1. Finalize `spec.md` metadata alignment.
2. Add the new usage-consumption internal contract.
3. Expose shared readers/accessors in `index.mjs`.
4. Add validator library + validate script + package wiring.
5. Extend authorization model with `workspace.usage.read` and role grants.
6. Extend `observability-admin.mjs` with snapshot/cycle/query helpers.
7. Update public API taxonomy.
8. Patch unified OpenAPI source programmatically and regenerate public API artifacts.
9. Add docs and task summary.
10. Add unit + contract tests.
11. Run targeted validation, then full lint/test.
12. Commit, push, PR, monitor CI, merge, and update orchestrator state.

---

## 8. Definition of Done

`US-OBS-03-T01` is done when:

- `observability-usage-consumption.json` exists and validates,
- tenant/workspace usage snapshot readers/helpers are shared through `index.mjs` and `observability-admin.mjs`,
- `workspace.usage.read` is fully wired in the authorization model,
- tenant/workspace usage routes exist in the `metrics` family and generated route catalog,
- public API taxonomy advertises both usage snapshot resource types,
- docs for architecture + task summary are discoverable,
- targeted tests pass,
- full `npm run lint` and `npm test` pass,
- and the branch is committed, pushed, reviewed via PR, green in CI, merged to `main`, with orchestrator state updated to the next backlog unit.
