# US-OBS-01 — Unified metrics, dashboards, and health checks

## Scope delivered in `US-OBS-01-T01`

This increment establishes the **foundational observability metrics integration contract** for the
platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-metrics-stack.json` as the machine-readable source
  of truth for subsystem coverage, normalized metric families, scope labels, cardinality guardrails,
  collection topology, and collection-health semantics
- `charts/in-atelier/values.yaml` observability configuration updates that mirror the common-plane
  targets and collection-health metadata
- `apps/control-plane/src/observability-admin.mjs` summary helpers for downstream observability work
- `scripts/lib/observability-metrics-stack.mjs` and
  `scripts/validate-observability-metrics-stack.mjs` for deterministic validation of the contract
  and Helm alignment
- `docs/reference/architecture/observability-metrics-stack.md` as the human-readable conventions
  guide
- `docs/reference/architecture/README.md` index updates so the new guidance is discoverable
- unit and contract coverage for the new observability baseline

## Main decisions

### One normalized metrics plane is required before dashboards or health views

The platform now treats APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the control
plane as required inputs to a common observability plane.

This task defines the contract that downstream dashboard, health, alerting, and smoke-test work
must consume instead of inventing parallel conventions.

### Scope labels are explicit

The baseline distinguishes three scopes:

- `platform`
- `tenant`
- `workspace`

Tenant-attributable series must always carry `tenant_id`, workspace-safe series may additionally
carry `workspace_id`, and platform-global series stay outside tenant-scoped query results unless a
platform operator explicitly requests them.

### High-cardinality labels are bounded by policy

The contract explicitly forbids labels such as raw paths, request ids, raw topic names, object
keys, or user identifiers.

Subsystem-specific metrics must instead use stable route templates, logical resource identifiers,
and normalized operation labels.

### Collection failures are first-class metrics

The observability layer itself now reserves a collection-health contract so missing or stale data is
visible as telemetry:

- `in_atelier_observability_collection_health`
- `in_atelier_observability_collection_failures_total`
- `in_atelier_observability_collection_lag_seconds`

## Validation

Primary validation entry points:

```bash
npm run validate:observability-metrics-stack
node --test tests/unit/observability-metrics-stack.test.mjs
node --test tests/contracts/observability-metrics-stack.contract.test.mjs
```

## Residual implementation note

This increment defines the contract, the Helm-facing configuration shape, and the validation
surface for the unified metrics stack. It does not yet claim production dashboards, readiness or
liveness endpoints, business metrics, alert rules, or smoke tests for live scraping.

## Scope delivered in `US-OBS-01-T02`

This increment establishes the **canonical observability dashboard contract** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-dashboards.json` as the machine-readable source of truth for the `global`, `tenant`, and `workspace` dashboard scopes, drilldown hierarchy, mandatory health dimensions, inherited degradation semantics, workspace fallback rules, and traceability expectations
- `services/internal-contracts/src/index.mjs` shared readers for dashboard scopes, dimensions, and widget catalog entries
- `apps/control-plane/src/observability-admin.mjs` summary helpers for dashboard semantics, scope summaries, and safe dashboard query-context construction
- `scripts/lib/observability-dashboards.mjs` and `scripts/validate-observability-dashboards.mjs` for deterministic contract validation and metrics-stack alignment checks
- `docs/reference/architecture/observability-health-dashboards.md` as the human-readable architecture guide for dashboard scope behavior
- `docs/reference/architecture/README.md` index updates so the new dashboard guidance is discoverable

## Main decisions in `US-OBS-01-T02`

### Dashboard scope names remain operator-friendly while metric scopes remain canonical

The dashboard layer uses:

- `global`
- `tenant`
- `workspace`

The underlying metrics plane still uses:

- `platform`
- `tenant`
- `workspace`

The new contract makes that mapping explicit so downstream work can present a global dashboard without changing the metrics-stack baseline from `US-OBS-01-T01`.

### Inherited degradation is part of the contract

Tenant and workspace views must distinguish local degradation from broader upstream conditions.

The dashboard contract therefore encodes how tenant views inherit platform incidents and how workspace views inherit tenant- or platform-level degradation without leaking other-tenant detail.

### Workspace fallback is explicit rather than inferred

When a subsystem cannot safely support workspace attribution for a given summary, the workspace dashboard must degrade to explicit tenant-inherited or platform-dependent semantics instead of fabricating workspace precision.

### Collection freshness remains a mandatory health dimension

The dashboard baseline treats stale or failed telemetry as a visible health condition and reuses the normalized collection-health metrics introduced by `US-OBS-01-T01`.

## Validation for `US-OBS-01-T02`

Primary validation entry points for the dashboard baseline:

```bash
npm run validate:observability-dashboards
```

## Residual implementation note for `US-OBS-01-T02`

`US-OBS-01-T01` and `US-OBS-01-T02` now define the canonical metrics-plane and dashboard-plane semantics for observability. Remaining work still includes health/readiness/liveness endpoints, business metrics, console-facing health summaries, alerting behavior, smoke tests, and any live dashboard rendering.

## Scope delivered in `US-OBS-01-T03`

This increment establishes the **canonical component health-check baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-health-checks.json` as the machine-readable source of truth for canonical `liveness`, `readiness`, and `health` semantics, aggregate/internal exposure templates, masking rules, audit context, and component-specific dependency metadata
- additive probe metric families in `services/internal-contracts/src/observability-metrics-stack.json` so health outcomes are queryable from the common observability plane
- `services/internal-contracts/src/index.mjs` shared readers for health-check probe types, component metadata, and exposure templates
- `apps/control-plane/src/observability-admin.mjs` summary helpers for health-check semantics, platform rollups, and component probe summaries
- `scripts/lib/observability-health-checks.mjs` and `scripts/validate-observability-health-checks.mjs` for deterministic validation of the health baseline and its alignment with the existing observability contracts
- `docs/reference/architecture/observability-health-checks.md` as the human-readable architecture guide for the health-check baseline
- `docs/reference/architecture/README.md` index updates so the new guidance is discoverable

## Main decisions in `US-OBS-01-T03`

### Liveness, readiness, and health are intentionally different

The platform now treats:

- `liveness` as proof that the runtime is alive enough to avoid dead-process restart loops,
- `readiness` as proof that the component can safely serve or participate in platform traffic,
- and `health` as the broader operational posture that can express degraded-but-serving or inherited conditions.

This prevents orchestration from confusing dependency-blocked behavior with a dead runtime.

### Health exposure is internal and operational

The baseline defines aggregate and per-component internal exposure templates such as:

- `/internal/live`
- `/internal/ready`
- `/internal/health`
- `/internal/*/components/{componentId}`

These are internal operational contracts, not new public API commitments.

### Sensitive dependency detail must be normalized or masked

Health outputs can carry useful dependency posture, but they must not leak credentials, raw endpoints, hostnames, object keys, or raw topic names.

### Probe outcomes project into the common observability plane

`US-OBS-01-T03` extends the normalized metric-family baseline with probe-specific health metrics so later dashboards, alerting, and smoke tests can consume one consistent health signal model.

## Validation for `US-OBS-01-T03`

Primary validation entry points for the health baseline:

```bash
npm run validate:observability-health-checks
```

## Residual implementation note for `US-OBS-01-T03`

`US-OBS-01-T01` through `US-OBS-01-T03` now define the canonical metrics-plane, dashboard-plane, and health-probe semantics for observability. Remaining work still includes business metrics, console-facing health summaries, internal alerting behavior, smoke verification, and any live runtime implementation details that consume these contracts.
