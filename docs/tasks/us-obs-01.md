# US-OBS-01 — Unified metrics, dashboards, and health checks

## Scope delivered in `US-OBS-01-T01`

This increment establishes the **foundational observability metrics integration contract** for the
platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-metrics-stack.json` as the machine-readable source
  of truth for subsystem coverage, normalized metric families, scope labels, cardinality guardrails,
  collection topology, and collection-health semantics
- `charts/in-falcone/values.yaml` observability configuration updates that mirror the common-plane
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

- `in_falcone_observability_collection_health`
- `in_falcone_observability_collection_failures_total`
- `in_falcone_observability_collection_lag_seconds`

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

## Scope delivered in `US-OBS-01-T04`

This increment establishes the **canonical business and product metrics baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-business-metrics.json` as the machine-readable source of truth for business domains, metric families, supported scopes, bounded dimensions, forbidden labels, audit context, freshness expectations, and downstream reuse guidance
- `services/internal-contracts/src/index.mjs` shared readers for business metric domains, metric types, metric families, and business-metric control metadata
- `apps/control-plane/src/observability-admin.mjs` summary helpers for business-metrics domains/families and safe business-metric query construction
- `scripts/lib/observability-business-metrics.mjs` and `scripts/validate-observability-business-metrics.mjs` for deterministic validation of the business-metrics baseline and its alignment with the existing observability contracts
- `docs/reference/architecture/observability-business-metrics.md` as the human-readable architecture guide for the business-metrics baseline
- `docs/reference/architecture/README.md` index updates so the new guidance is discoverable

## Main decisions in `US-OBS-01-T04`

### Business metrics extend the observability plane but remain distinct from technical health

The platform now defines business/product signals for tenant lifecycle, workspace lifecycle, API usage, identity activity, function usage, data-service usage, storage usage, realtime/event activity, and quota posture.

These metrics live in the same plane as the technical observability baseline, but they remain explicitly separate from infrastructure availability, latency/error metrics, and liveness/readiness/health probe semantics.

### Scope and isolation rules stay identical to the technical baseline

Business metrics reuse the same canonical scope model:

- `platform`
- `tenant`
- `workspace`

Tenant- and workspace-attributable business metrics must preserve `tenant_id` / `workspace_id` scoping and must never widen beyond the metric family's supported scopes.

### High-cardinality and sensitive labels remain forbidden

The business-metrics contract explicitly forbids raw or sensitive labels such as `user_id`, `request_id`, `raw_path`, `object_key`, `email`, and `api_key_id`.

Identity-related metrics remain aggregated and audit-aware rather than principal-specific.

### Business metrics are reusable inputs for quota, metering, console, alerting, and smoke work

This increment defines the signal vocabulary that later work should consume rather than deriving business semantics directly from raw subsystem metrics.

## Validation for `US-OBS-01-T04`

Primary validation entry points for the business-metrics baseline:

```bash
npm run validate:observability-business-metrics
```

## Residual implementation note for `US-OBS-01-T04`

`US-OBS-01-T01` through `US-OBS-01-T04` now define the canonical metrics-plane, dashboard-plane, health-probe, and business-metrics semantics for observability. Remaining work still includes console-facing summaries, internal alerting behavior, smoke verification, and any live runtime implementation details that consume these contracts.

## Scope delivered in `US-OBS-01-T05`

This increment establishes the **canonical console health-summary and internal alert baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-console-alerts.json` as the machine-readable source of truth for platform/tenant/workspace console summaries, alert categories, severity, lifecycle, suppression defaults, masking rules, audience routing, and audit expectations
- `services/internal-contracts/src/index.mjs` shared readers and accessors for summary scopes, status vocabulary, aggregation rules, alert categories, lifecycle states, routing, suppression defaults, and masking policy
- `apps/control-plane/src/observability-admin.mjs` summary helpers for health-summary context, alert context, lifecycle-state inspection, suppression defaults, and top-level contract summarization
- `scripts/lib/observability-console-alerts.mjs` and `scripts/validate-observability-console-alerts.mjs` for deterministic validation of the console-summary and alert baseline
- `docs/reference/architecture/observability-console-alerts.md` as the human-readable architecture guide for console summaries and internal alerts
- `docs/reference/architecture/README.md` index updates so the new baseline is discoverable

## Main decisions in `US-OBS-01-T05`

### Console summaries reuse observability contracts instead of inventing new health semantics

The console summary layer now derives its vocabulary from `US-OBS-01-T01` through `US-OBS-01-T04`.

That means platform, tenant, and workspace summaries reuse the existing scope model, health states, freshness caution, and business-metric inputs rather than defining a separate status model.

### Aggregation precedence is explicit and scope-safe

The summary precedence is:

- `unavailable`
- `degraded`
- `stale`
- `unknown`
- `healthy`

Tenant and workspace summaries can still surface degradation, but they must attribute it as tenant-local, tenant-inherited, or platform-condition without exposing platform topology or cross-tenant detail.

### Alerting is internal, role-routed, and lifecycle-aware

The new alert baseline defines four categories: component availability transitions, sustained error-rate breaches, freshness staleness, and business-metric deviation.

Alerts now have canonical severity, lifecycle states (`active`, `acknowledged`, `resolved`, `suppressed`), suppression defaults, and role-based audience routing aligned with the authorization model.

### Suppression reduces noise without hiding sustained degradation

Duplicate alerts inside the suppression window are marked as suppressed and remain queryable.
Oscillation is modeled explicitly rather than handled as a stream of independent transitions.

## Validation for `US-OBS-01-T05`

Primary validation entry point for the console-summary and internal-alert baseline:

```bash
npm run validate:observability-console-alerts
```

## Residual implementation note for `US-OBS-01-T05`

`US-OBS-01-T01` through `US-OBS-01-T05` now define the canonical metrics-plane, dashboard-plane, health-probe, business-metrics, console-summary, and internal-alert semantics for observability. Remaining work still includes `US-OBS-01-T06`, which should smoke-test and verify runtime behavior against these contracts rather than introducing alternate summary or alert semantics.

## Scope delivered in `US-OBS-01-T06`

This increment establishes the **canonical observability smoke-verification baseline** for the platform.

Delivered artifacts:

- `tests/reference/observability-smoke-matrix.yaml` as the smoke matrix for scraping, dashboard, and health-state coverage
- `tests/e2e/observability/observability-smoke.test.mjs` as the executable smoke suite
- `tests/reference/README.md` and `tests/e2e/README.md` updates so the smoke baseline is discoverable
- `package.json` test wiring so `npm test` includes the observability smoke suite

## Main decisions in `US-OBS-01-T06`

### Smoke verification is derivative, not a new observability contract

The smoke layer does not invent new observability semantics. It consumes the T01–T05 contracts and verifies that their runtime-facing surfaces are still intact.

### Coverage is explicitly scoped to scraping, dashboards, and health states

The smoke matrix names one scraping scenario, three dashboard scope scenarios, and three health scenarios so the suite can catch drift in any of the three observable surfaces without broadening the task into browser automation or live operator workflows.

### Freshness and masking stay aligned with the upstream contracts

The smoke suite reuses the existing freshness threshold and masking policy rather than introducing new thresholds or exposing sensitive fields.

## Validation for `US-OBS-01-T06`

Primary validation entry points for the smoke baseline:

```bash
node --test tests/e2e/observability/observability-smoke.test.mjs
npm test
```

## Residual implementation note for `US-OBS-01-T06`

`US-OBS-01-T01` through `US-OBS-01-T06` now define the canonical observability metrics, dashboards, health checks, business metrics, console summaries, internal alerts, and smoke verification semantics for the platform. Remaining work still includes any live runtime consumers that execute the smoke matrix against deployed environments instead of the checked-in contract baseline.
