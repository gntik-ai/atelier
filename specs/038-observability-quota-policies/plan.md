# Implementation Plan: US-OBS-03-T02 — Quota Policies for Hard Limit, Soft Limit, and Warning Threshold

**Feature Branch**: `038-observability-quota-policies`
**Spec**: `specs/038-observability-quota-policies/spec.md`
**Task**: `US-OBS-03-T02`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

`US-OBS-03-T02` delivers the first authoritative **quota-policy evaluation baseline** on top of the
usage-consumption layer established in `US-OBS-03-T01`.

The increment must establish one shared contract and one executable helper surface that:

- define threshold policy semantics for `warning_threshold`, `soft_limit`, and `hard_limit`,
- evaluate measured usage snapshots for tenant and workspace scope against those thresholds,
- preserve the freshness and degradation semantics inherited from `US-OBS-03-T01`,
- expose a bounded read surface that downstream alerting, blocking, and console work can consume,
- and emit one audit-compatible posture summary without preempting the actual alert/blocking work.

This task does **not** emit alerts, block resource creation, or deliver the final console view. It
only publishes the trusted policy and posture layer those later tasks depend on.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in `US-OBS-03`

```text
T01 — usage-consumption baseline (already delivered)
T02 — THIS TASK: quota policy contract + posture evaluation
T03 — alert/event emission on threshold breach
T04 — hard-limit blocking/resource-creation enforcement
T05 — console usage-vs-quota and provisioning state
T06 — cross-module consumption/enforcement tests
```

`T02` must remain independently valuable. It defines the policy catalog, posture states, and query
surfaces without taking over the downstream reactions.

### 2.2 Inputs reused from existing baselines

This task reuses the contracts already published by prior observability work:

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-health-checks.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`

The full aggregated OpenAPI source must only be edited programmatically; it must not be used as LLM
read context.

### 2.3 Target architecture

```text
usage-consumption snapshots + quota threshold policy catalog
        ↓
services/internal-contracts/src/observability-quota-policies.json
        ↓ shared readers + accessors
services/internal-contracts/src/index.mjs
        ↓ validation + helper use
scripts/lib/observability-quota-policies.mjs
        ↓
apps/control-plane/src/observability-admin.mjs
        ↓
GET /v1/metrics/tenants/{tenantId}/quotas
GET /v1/metrics/workspaces/{workspaceId}/quotas
```

### 2.4 Incremental implementation rule

Follow the same bounded pattern used by earlier observability increments:

- policy evaluation helpers operate on explicit usage snapshots and explicit policy inputs or loader
  callbacks,
- threshold semantics are deterministic and centralized in shared helper functions,
- every published route returns the same posture model as the helper surface,
- and all downstream effects remain separate from this increment.

### 2.5 Explicit non-goals

This task will **not**:

- define alert routing, suppression, or emission,
- execute hard-limit resource blocking,
- add console UI components or tenant-facing visualization flows,
- mutate tenant/workspace plans or provisioning state,
- or add the broad end-to-end enforcement test matrix.

---

## 3. Artifact-by-Artifact Change Plan

### 3.1 `services/internal-contracts/src/observability-quota-policies.json` (new)

Add one machine-readable contract that defines:

- source-contract versions (`observability-usage-consumption`, `observability-health-checks`,
  `observability-audit-event-schema`, `authorization-model`, `public-api-taxonomy`),
- supported posture scopes: `tenant`, `workspace`,
- threshold types: `warning_threshold`, `soft_limit`, `hard_limit`,
- posture states such as:
  - `within_limit`
  - `warning_threshold_reached`
  - `soft_limit_exceeded`
  - `hard_limit_reached`
  - `evidence_degraded`
  - `evidence_unavailable`
  - `unbounded`
- ordering and validation rules for threshold definitions,
- supported metered dimensions, reusing the T01 dimension catalog,
- scope-specific route ids, permissions, and resource types,
- posture summary fields and audit-compatible evaluation metadata,
- and explicit boundaries to `T03`–`T06`.

### 3.2 `services/internal-contracts/src/index.mjs` (update)

Expose the new contract through the shared reader pattern:

- `readObservabilityQuotaPolicies()`
- `OBSERVABILITY_QUOTA_POLICIES_VERSION`
- `listQuotaPolicyScopes()` / `getQuotaPolicyScope(scopeId)`
- `listQuotaThresholdTypes()` / `getQuotaThresholdType(typeId)`
- `listQuotaPostureStates()` / `getQuotaPostureState(stateId)`
- `getQuotaEvaluationDefaults()`
- `getQuotaEvaluationAuditContract()`

### 3.3 `scripts/lib/observability-quota-policies.mjs` (new)

Add deterministic validation helpers following the existing observability pattern.

Responsibilities:

- read the new contract and its dependencies,
- assert source-version alignment,
- assert all required scopes, threshold types, posture states, and dimensions exist,
- assert threshold-ordering rules are documented,
- assert route ids exist in the public route catalog,
- assert posture resource types exist in the public API taxonomy,
- assert required permissions exist in the authorization model,
- assert every supported dimension also exists in the usage-consumption contract,
- assert audit compatibility stays aligned with the audit-event schema vocabulary,
- and assert explicit downstream boundaries remain present.

### 3.4 `scripts/validate-observability-quota-policies.mjs` + `package.json` (new/update)

Add a dedicated validator entry point and wire:

- `validate:observability-quota-policies`
- inclusion into `validate:repo`

### 3.5 `services/internal-contracts/src/authorization-model.json` (update)

Add the read actions required by the new posture routes:

- `tenant.quota.read`
- `workspace.quota.read`

Then align:

- `resource_actions.tenant`
- `resource_actions.workspace`
- `resource_semantics[*].delegable_actions`
- relevant role grants in `permission_matrix`

The grants should stay parallel to the existing usage/audit reader roles and must not introduce quota
policy write semantics.

### 3.6 `services/internal-contracts/src/public-api-taxonomy.json` (update)

Add resource taxonomy entries:

- `tenant_quota_posture`
- `workspace_quota_posture`

Both belong to the `metrics` family and map to `tenant` / `workspace` authorization resources.

### 3.7 `apps/control-plane/src/observability-admin.mjs` (update)

Extend the existing observability helper surface with additive quota-policy helpers:

- `summarizeObservabilityQuotaPolicies()`
- `buildQuotaDimensionPolicy(input)`
- `evaluateQuotaDimensionPosture(input)`
- `buildTenantQuotaPosture(input)`
- `buildWorkspaceQuotaPosture(input)`
- `buildQuotaEvaluationAuditRecord(input)`
- `queryTenantQuotaPosture(context, input)`
- `queryWorkspaceQuotaPosture(context, input)`
- `listQuotaPolicyRoutes()`

Implementation constraints:

- reuse the usage-consumption catalog as the source of truth for supported dimensions and freshness
  semantics,
- centralize threshold comparison in one deterministic evaluator,
- preserve tenant/workspace scope guards equivalent to the T01 usage routes,
- carry forward usage freshness and observation-window metadata,
- report remaining headroom to warning, soft, and hard thresholds where applicable,
- and never emit alerts or execute blocking in this task.

### 3.8 Public API source + generated artifacts

Update the unified OpenAPI source programmatically to add:

- `GET /v1/metrics/tenants/{tenantId}/quotas` → `getTenantQuotaPosture`
- `GET /v1/metrics/workspaces/{workspaceId}/quotas` → `getWorkspaceQuotaPosture`
- additive component schemas:
  - `QuotaThresholdPolicy`
  - `QuotaDimensionPosture`
  - `QuotaEvaluationAudit`
  - `QuotaPosture`

Then regenerate:

- `apps/control-plane/openapi/families/metrics.openapi.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `docs/reference/architecture/public-api-surface.md`

### 3.9 Documentation

Add/update:

- `docs/reference/architecture/observability-quota-policies.md` (new)
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`

The architecture doc should explain threshold ordering, posture-state semantics, scope isolation,
freshness propagation from usage, audit compatibility, and the explicit downstream boundary to
`T03`–`T06`.

### 3.10 Tests

Add:

- `tests/unit/observability-quota-policies.test.mjs`
- `tests/contracts/observability-quota-policies.contract.test.mjs`

Unit coverage should focus on policy validation, posture classification, inclusive equality
semantics, absent-soft-limit behavior, unbounded dimensions, freshness propagation, and strict
scope-guard behavior.

Contract coverage should focus on shared readers, authorization/public-api alignment, metrics-family
OpenAPI route existence, generated route catalog presence, and documentation discoverability.

---

## 4. Data / Contract Model

### 4.1 Quota threshold policy shape

Each dimension policy should publish at least:

- `dimensionId`
- `displayName`
- `scope`
- `unit`
- `warningThreshold`
- `softLimit`
- `hardLimit`
- `policyMode` (`enforced` or `unbounded`)
- `comparisonRule` (inclusive-at-threshold)

### 4.2 Dimension posture shape

Each evaluated dimension should publish at least:

- `dimensionId`
- `displayName`
- `scope`
- `measuredValue`
- `unit`
- `freshnessStatus`
- `policyMode`
- `status`
- `warningThreshold`
- `softLimit`
- `hardLimit`
- `remainingToWarning`
- `remainingToSoftLimit`
- `remainingToHardLimit`
- `usageSnapshotTimestamp`

### 4.3 Quota posture snapshot shape

Each posture result should publish at least:

- `postureId`
- `queryScope`
- `tenantId`
- `workspaceId`
- `evaluatedAt`
- `usageSnapshotTimestamp`
- `observationWindow`
- `dimensions`
- `overallStatus`
- `degradedDimensions`
- `hardLimitBreaches`
- `softLimitBreaches`
- `warningDimensions`
- `evaluationAudit`

### 4.4 Threshold semantics

Use these comparison rules consistently:

- `measuredValue >= hardLimit` → `hard_limit_reached`
- else if `measuredValue >= softLimit` → `soft_limit_exceeded`
- else if `measuredValue >= warningThreshold` → `warning_threshold_reached`
- else if evidence is unavailable → `evidence_unavailable`
- else if policy mode is unbounded → `unbounded`
- else → `within_limit`

If `softLimit` is absent, evaluation skips directly from warning to hard.

### 4.5 Overall posture summary

The overall summary should resolve deterministically from the dimension results with the following
precedence:

`hard_limit_reached` > `soft_limit_exceeded` > `warning_threshold_reached` > `evidence_unavailable`
> `evidence_degraded` > `within_limit` / `unbounded`

---

## 5. Risk, Compatibility, and Rollback

### 5.1 Key risks

- **Threshold drift**: Different modules might still attempt to re-encode threshold logic.
  Mitigation: publish one helper and one route surface and test their equivalence.
- **Contradictory policy ordering**: Invalid warning/soft/hard ordering could silently misclassify a
  posture. Mitigation: validator-enforced ordering checks.
- **Freshness confusion**: Consumers may mistake degraded evidence for healthy posture. Mitigation:
  preserve freshness status in every evaluated dimension and overall summary.
- **Scope widening**: Tenant/workspace route inputs could leak posture beyond allowed scope.
  Mitigation: reuse strict scope-binding guards patterned after T01.

### 5.2 Compatibility posture

This increment is additive:

- new contract file,
- additive readers and helper exports,
- additive read permissions,
- additive route surface,
- additive docs and tests.

No destructive migration is expected.

### 5.3 Rollback posture

If the increment must be rolled back, removing the additive contract/routes/helpers restores the
prior state where usage exists but quota posture does not. No existing behavior should become
incompatible because downstream tasks have not yet relied on the new posture surface at merge time.

---

## 6. Verification Strategy

### 6.1 Targeted validation

- `npm run validate:observability-quota-policies`
- `node --test tests/unit/observability-quota-policies.test.mjs`
- `node --test tests/contracts/observability-quota-policies.contract.test.mjs`
- `npm run generate:public-api`
- `npm run validate:public-api`

### 6.2 Full regression

- `npm run lint`
- `npm test`

### 6.3 Expected evidence

- contract validator passes with zero violations,
- unit tests prove threshold ordering and posture classification,
- contract tests prove readers/routes/auth/docs alignment,
- metrics-family OpenAPI includes the new quota posture routes and schemas,
- and the task summary/doc index reflect the new baseline and residual downstream boundary.

---

## 7. Recommended Execution Sequence

1. Add the new quota-policy contract.
2. Expose the shared readers in `index.mjs`.
3. Add the validator library and dedicated script plus package wiring.
4. Add auth and public-api taxonomy deltas.
5. Extend `observability-admin.mjs` with posture evaluators and route helpers.
6. Patch the OpenAPI source programmatically and regenerate public API artifacts.
7. Add docs and task-summary updates.
8. Add unit and contract tests.
9. Run targeted validation, then full lint/test.
10. Commit, push, open PR, watch CI, fix regressions, and merge.

---

## 8. Definition of Done

`US-OBS-03-T02` is done when:

- `services/internal-contracts/src/observability-quota-policies.json` exists and validates,
- shared readers/accessors are available through `services/internal-contracts/src/index.mjs`,
- auth and taxonomy deltas are published,
- `observability-admin.mjs` exposes deterministic quota posture builders and query helpers,
- quota posture routes and schemas exist in the generated public API artifacts,
- architecture/task docs are updated,
- targeted validator/unit/contract runs are green,
- full `npm run lint` and `npm test` are green,
- and the branch is committed, pushed, PR'd, checked green, and merged without absorbing T03–T06 work.
