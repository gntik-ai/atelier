# Implementation Plan: US-OBS-01-T05 — Console Health Summaries and Internal Degradation Alerts

**Branch**: `029-observability-console-alerts` | **Date**: 2026-03-28 | **Spec**: `specs/029-observability-console-alerts/spec.md`
**Task**: US-OBS-01-T05 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017

---

## Summary

This task is the fifth observability increment for the platform.

The implementation will:

1. materialize the repo-local Spec Kit artifacts for task 029,
1. add one machine-readable internal contract that defines the canonical console health summary and
   internal degradation alert vocabulary for the observability plane,
1. keep that contract strictly consuming the T01–T04 contracts without bypassing them or
   redefining scope, naming, masking, or freshness conventions,
1. expose the new contract through shared internal readers and control-plane observability helper
   summaries,
1. add deterministic validation and human-readable architecture documentation,
1. update the task summary for `US-OBS-01`,
1. add targeted unit and contract coverage in the dedicated test stage,
1. and deliver the change through the normal branch, PR, CI, and merge flow.

This increment does **not** implement alert delivery channels, external webhook integrations,
commercial SLA calculations, console UI components, or smoke-test verification. It defines and
materializes the canonical console health summary and internal alert contract that later console,
notification, and smoke-test work must consume.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, JSON internal contracts, Markdown docs.
**Primary dependencies**: existing observability metrics-stack (T01), dashboard (T02),
health-check (T03), and business-metrics (T04) contracts; shared internal-contract readers;
Node test runner; markdownlint.
**Storage**: N/A — no database schema or persistence migration.
**Testing**: `node --test` unit and contract coverage plus dedicated repo validation scripts.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Primary artifacts in scope**:

- `specs/029-observability-console-alerts/spec.md`
- `specs/029-observability-console-alerts/plan.md`
- `specs/029-observability-console-alerts/tasks.md`
- `services/internal-contracts/src/observability-console-alerts.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `scripts/lib/observability-console-alerts.mjs`
- `scripts/validate-observability-console-alerts.mjs`
- `docs/reference/architecture/observability-console-alerts.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-01.md`
- `tests/unit/observability-console-alerts.test.mjs`
- `tests/contracts/observability-console-alerts.contract.test.mjs`
- `package.json`

**Constraints**:

- consume the T01–T04 contracts as read-only data sources; never bypass them,
- preserve the `platform` / `tenant` / `workspace` scope model from the metrics-stack and
  dashboard contracts,
- reuse the health-status vocabulary (`healthy`, `degraded`, `unavailable`, `unknown`) and the
  stale-probe semantics from the health-check contract,
- keep bounded-cardinality, masking, and multi-tenant isolation rules consistent with the
  existing observability plane,
- keep the increment additive and reusable by `US-OBS-01-T06` and future console and
  notification work,
- no public route, OpenAPI, or UI rendering change is required in this increment.

---

## Architecture / Content Strategy

### 1. Dedicated console-alerts contract as the source of truth

Add `services/internal-contracts/src/observability-console-alerts.json` as the machine-readable
source of truth for:

- the health summary model: supported scopes, status vocabulary (at least `healthy`, `degraded`,
  `unavailable`, `stale`, `unknown`), required summary fields, freshness threshold, aggregation
  rules by scope, and scope-isolation constraints,
- the internal alert contract: alert categories (component availability transition, sustained
  error rate breach, observability freshness staleness, significant business metric deviation),
  severity levels, required alert fields, audience routing rules by scope and role, lifecycle
  states (active, acknowledged, resolved, suppressed), suppression semantics, and content masking
  rules,
- cross-cutting alignment: which T01–T04 contract versions this contract builds on, and which
  downstream consumers (T06 smoke tests, future console views, notification integrations) should
  treat this contract as their canonical source,
- and audit expectations: which access and delivery events are auditable, required audit fields,
  and masking rules for sensitive content in alert payloads.

This contract does not embed specific numeric threshold values — those are operational tuning
concerns. It defines the structural vocabulary and behavioral rules.

### 2. Strict downstream-consumer posture toward T01–T04

This contract must align with and explicitly reference the four upstream contracts:

- the `platform` / `tenant` / `workspace` scope model and `metric_scope` label from
  `observability-metrics-stack.json`,
- the dashboard scope alias mapping (`global`, `tenant`, `workspace`) from
  `observability-dashboards.json`,
- the health status vocabulary (`healthy`, `degraded`, `unavailable`, `unknown`), component
  roster, aggregate rules, and stale-probe window from `observability-health-checks.json`,
- and the business domain / metric-family vocabulary and freshness expectations from
  `observability-business-metrics.json`.

`source_metrics_contract`, `source_dashboard_contract`, `source_health_contract`, and
`source_business_metrics_contract` version fields on the new contract anchor it to the exact
versions of those upstream contracts.

### 3. Summary aggregation model: deterministic rules aligned with health-check aggregate rules

The health summary aggregation model must be deterministic and must derive from the same logical
rules already in `observability-health-checks.json`.

Key aggregation decisions to encode in the contract:

- A single `unavailable` required component makes the summary `unavailable`.
- Any `degraded` required component (with no `unavailable`) makes the summary `degraded`.
- Any component in `unknown` state (with no `unavailable` or `degraded`) makes the summary
  `unknown`.
- Any component with stale data beyond the freshness threshold produces a `stale` summary status
  rather than reporting last-known state as current.
- For tenant and workspace scopes, platform-internal component topology must not appear in
  degraded-subsystem detail: degradation is attributed as `platform-condition` or
  `tenant-local` without naming internal components.

### 4. Alert lifecycle: deterministic suppression and resolution rules

The alert lifecycle must be unambiguous for downstream consumers:

- A new alert is `active` when first generated.
- It becomes `acknowledged` when an authorized actor explicitly marks it.
- It becomes `resolved` when the triggering condition clears, generating a linked resolution
  event.
- It becomes `suppressed` when a duplicate alert fires within the suppression window for the same
  scope + category + component combination; suppressed alerts remain queryable.
- Suppression windows are configurable per alert category; the contract specifies the default
  window value for each category.
- Oscillation detection: if more than a configurable number of transitions occur within a short
  window, the alert system reports the oscillation pattern as a distinct artifact rather than
  generating individual transition alerts.

### 5. Scope isolation and content masking in the contract

Tenant- and workspace-scoped summaries and alerts must follow the same isolation rules as the
broader observability plane:

- Alert content must never embed cross-tenant signals, raw user identifiers, credentials, secret
  references, or infrastructure addresses.
- The contract explicitly lists forbidden content categories mirroring the masking policy from
  the health-check and business-metrics contracts.
- The contract explicitly distinguishes platform-attributable degradation from tenant-local
  degradation in the summary and alert data model, without exposing platform internals.

### 6. Shared readers and control-plane helpers remain read-only and summary-oriented

Update `services/internal-contracts/src/index.mjs` so downstream code can read the
console-alerts contract, list alert categories, retrieve audience routing rules, inspect the
health summary model, and access suppression and lifecycle semantics.

Extend `apps/control-plane/src/observability-admin.mjs` with summary helpers that:

- build a health summary context for platform, tenant, and workspace scopes,
- build an alert context (category, scope, severity, required fields, routing audience) for
  downstream consumer use,
- expose the alert lifecycle state machine as a structured helper,
- and expose suppression window defaults and oscillation detection thresholds as inspectable
  summaries.

No public route, OpenAPI, or UI rendering change is required in this increment.

### 7. Deterministic validation prevents drift

Add `scripts/lib/observability-console-alerts.mjs` and
`scripts/validate-observability-console-alerts.mjs` so future tasks cannot silently drift from the
console health summary and alert contract.

Validation must confirm:

- all required summary scopes are present,
- the status vocabulary includes at least `healthy`, `degraded`, `unavailable`, `stale`, and
  `unknown`,
- required summary fields are enumerated,
- all required alert categories are present,
- every alert category has severity, lifecycle states, suppression window, audience routing, and
  required fields defined,
- contract version anchors align with the current T01–T04 contract versions,
- forbidden content categories are explicitly listed for alert masking,
- shared docs and task summary remain discoverable,
- and `package.json` exposes `validate:observability-console-alerts` and wires it into repo
  validation.

### 8. Human-readable architecture companion

Add `docs/reference/architecture/observability-console-alerts.md` as the operator and
implementation companion for this baseline.

The document should explain:

- why the console summary and alert layer sits above T01–T04 rather than duplicating those
  contracts,
- the health summary model: scopes, status vocabulary, aggregation rules, and freshness handling,
- the internal alert contract: categories, severity levels, lifecycle states, suppression
  semantics, and audience routing,
- scope isolation and masking expectations for tenant and workspace consumers,
- and how downstream console views, T06 smoke tests, and future notification integrations should
  consume this contract.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/029-observability-console-alerts/spec.md` (already present)
- Materialize `specs/029-observability-console-alerts/plan.md` (this document)
- Materialize `specs/029-observability-console-alerts/tasks.md`

### Internal contracts and helper code

- Add `services/internal-contracts/src/observability-console-alerts.json`
- Update `services/internal-contracts/src/index.mjs` — add `readObservabilityConsoleAlerts()`,
  `OBSERVABILITY_CONSOLE_ALERTS_VERSION`, and list/get accessors for categories, scopes,
  severity levels, lifecycle states, suppression defaults, audience routing rules, and
  summary aggregation rules
- Extend `apps/control-plane/src/observability-admin.mjs` — add helpers:
  `buildHealthSummaryContext(scope, options)`,
  `buildAlertContext(category, scope, options)`,
  `getAlertLifecycleStateMachine()`,
  `getAlertSuppressionDefaults()`,
  `summarizeConsoleAlertsContract()`
- Add `scripts/lib/observability-console-alerts.mjs` — validation library implementing
  `collectObservabilityConsoleAlertViolations()`
- Add `scripts/validate-observability-console-alerts.mjs` — thin runner that calls the library
  and exits nonzero on violations
- Update `package.json`:
  - add `"validate:observability-console-alerts": "node ./scripts/validate-observability-console-alerts.mjs"`
  - wire it into `validate:repo` immediately after `validate:observability-business-metrics`

### Documentation

- Add `docs/reference/architecture/observability-console-alerts.md`
- Update `docs/reference/architecture/README.md` — add two entries:
  - `services/internal-contracts/src/observability-console-alerts.json` as the machine-readable
    source of truth for the console health summary and internal alert contract introduced by
    `US-OBS-01-T05`
  - `docs/reference/architecture/observability-console-alerts.md` as the human-readable
    architecture companion
- Update `docs/tasks/us-obs-01.md` — add section `## Scope delivered in 'US-OBS-01-T05'` with
  key decisions and residual scope note pointing to T06

### Tests and validation wiring (test stage — not sequenced before production artifacts)

- Add `tests/unit/observability-console-alerts.test.mjs`
- Add `tests/contracts/observability-console-alerts.contract.test.mjs`

### No-change areas

- No public OpenAPI or route-catalog changes
- No console UI implementation
- No alert delivery channel or webhook integration
- No commercial billing logic or SLA calculation
- No live alerting runtime or Alertmanager configuration
- No smoke verification or live observability checks
- No database migrations
- No Helm contract changes unless strictly required for documentation-only alignment
- No changes to T01–T04 contracts (`observability-metrics-stack.json`,
  `observability-dashboards.json`, `observability-health-checks.json`,
  `observability-business-metrics.json`)

---

## Data / Contracts / Helpers Detail

### `observability-console-alerts.json` top-level structure

```json
{
  "version": "<date>",
  "scope": "US-OBS-01-T05",
  "system": "in-falcone-observability-plane",
  "source_metrics_contract": "<T01 version>",
  "source_dashboard_contract": "<T02 version>",
  "source_health_contract": "<T03 version>",
  "source_business_metrics_contract": "<T04 version>",
  "principles": [...],
  "health_summary": {
    "supported_scopes": ["platform", "tenant", "workspace"],
    "status_vocabulary": [...],
    "required_fields": [...],
    "freshness_threshold_seconds": <number>,
    "aggregation_rules": { "platform": ..., "tenant": ..., "workspace": ... },
    "scope_isolation_rules": { "tenant": ..., "workspace": ... }
  },
  "alert_contract": {
    "categories": [...],
    "severity_levels": [...],
    "lifecycle_states": [...],
    "suppression_defaults": { ... },
    "oscillation_detection": { ... },
    "audience_routing": { "platform": [...], "tenant": [...], "workspace": [...] },
    "required_fields": [...],
    "masking_policy": { "forbidden_content_categories": [...] }
  },
  "audit_context": {
    "summary_access_event": ...,
    "alert_delivery_event": ...,
    "required_fields": [...]
  },
  "downstream_consumers": [...]
}
```

### Key entity definitions in the contract

- **`status_vocabulary`**: at minimum `healthy`, `degraded`, `unavailable`, `stale`, `unknown`,
  each with `id`, `display_name`, `operational_meaning`, and `aggregation_priority` (lower
  priority wins when combining — `unavailable` beats `degraded` beats `stale` beats `unknown`
  beats `healthy`).
- **`alert_contract.categories`**: at minimum `component_availability_transition`,
  `sustained_error_rate_breach`, `observability_freshness_staleness`,
  `business_metric_deviation`. Each category carries `id`, `description`, `default_severity`,
  `default_suppression_window_seconds`, `required_fields`, `scope_rules`, and
  `resolution_event_required`.
- **`alert_contract.lifecycle_states`**: `active`, `acknowledged`, `resolved`, `suppressed`, each
  with `id`, `terminal` (bool), and `allowed_transitions`.
- **`audience_routing`**: maps scope to a list of authorized role IDs drawn from the
  authorization-model contract; does not hard-code actor identifiers.

### `index.mjs` additions

```js
readObservabilityConsoleAlerts()         // reads the new JSON contract
OBSERVABILITY_CONSOLE_ALERTS_VERSION    // string version constant
listHealthSummaryScopes()               // returns health_summary.supported_scopes
listAlertCategories()                   // returns alert_contract.categories
getAlertCategory(categoryId)            // single category lookup
listAlertSeverityLevels()               // returns alert_contract.severity_levels
listAlertLifecycleStates()              // returns alert_contract.lifecycle_states
getAlertAudienceRouting(scope)          // returns routing rules for a given scope
getHealthSummaryAggregationRules()      // returns aggregation_rules object
getHealthSummaryFreshnessThreshold()    // returns freshness_threshold_seconds
getAlertMaskingPolicy()                 // returns masking_policy
```

### `observability-admin.mjs` additions

- `buildHealthSummaryContext(scope, options)` — validates scope, applies aggregation rules and
  freshness threshold, applies scope-isolation rules for tenant/workspace, returns a structured
  context object suitable for downstream console rendering or T06 verification.
- `buildAlertContext(categoryId, scope, options)` — validates category and scope, applies
  audience routing, returns a structured alert context with required fields, severity, suppression
  defaults, and masking-policy references.
- `getAlertLifecycleStateMachine()` — returns lifecycle states with allowed-transition adjacency
  for validation and consumer use.
- `getAlertSuppressionDefaults()` — returns suppression window defaults per category.
- `summarizeConsoleAlertsContract()` — top-level summary suitable for the control-plane
  observability overview, aligned with the pattern of `summarizeObservabilityPlane()` and
  `summarizeObservabilityBusinessMetrics()`.

---

## Verification Strategy

1. Run `npm run validate:observability-console-alerts`.
1. Run targeted observability unit and contract suites for the new baseline.
1. Run markdown lint on the touched observability docs/spec set.
1. Inspect `git diff --stat` to confirm the increment stayed within observability
   console-alerts contracts, helper summaries, docs, validation, and tests.
1. Leave broader integration coverage to the dedicated `test` stage and `test-runner` delegation.

---

## Risks and Mitigations

- **Risk: alert categories creep into external notification or webhook territory**
  - Mitigation: keep `alert_contract.categories` strictly internal; explicitly mark the contract
    as a non-public, non-external-API artifact and validate that no delivery-channel or
    webhook field is present.
- **Risk: suppression logic silently hides sustained degradation**
  - Mitigation: encode a validation rule that `suppressed` is a non-terminal lifecycle state and
    that the summary layer independently reflects ongoing degradation regardless of alert
    suppression status.
- **Risk: tenant-summary aggregation rules reveal platform topology through degraded-subsystem
  lists**
  - Mitigation: encode explicit scope-isolation rules in `health_summary.scope_isolation_rules`
    that restrict `degraded_components` to safe attribution labels (`platform-condition` or
    `tenant-local`) for tenant and workspace scopes; validate these rules are present.
- **Risk: contract version anchors drift from actual T01–T04 contract versions**
  - Mitigation: validation script reads the actual T01–T04 JSON versions and asserts that
    `source_*_contract` fields on the new contract match them — same pattern as the existing
    health-check and business-metrics validators.
- **Risk: status vocabulary ambiguity causes downstream implementations to diverge**
  - Mitigation: every status entry in `status_vocabulary` carries an `operational_meaning` prose
    field and an `aggregation_priority` integer so aggregation behavior is deterministic and
    self-documenting.
- **Risk: audience routing references role IDs not present in the authorization model**
  - Mitigation: validation script loads `authorization-model.json` and verifies every role ID
    referenced in `audience_routing` is a valid role in that contract.

---

## Sequence

All steps are production-code steps. Tests are explicitly called out as the dedicated final stage.

### Step 1 — Spec Kit artifacts

1. Confirm `specs/029-observability-console-alerts/spec.md` is present (already done).
1. Confirm `specs/029-observability-console-alerts/plan.md` is present (this document).
1. Materialize `specs/029-observability-console-alerts/tasks.md` aligned with this plan.

### Step 2 — Internal contract

1. Add `services/internal-contracts/src/observability-console-alerts.json` covering the full
   health summary model, alert contract, audit context, and downstream consumer declarations.

### Step 3 — Shared readers and control-plane helpers

1. Update `services/internal-contracts/src/index.mjs` to expose the new contract through
   `readObservabilityConsoleAlerts()`, the version constant, and all list/get accessors.
1. Extend `apps/control-plane/src/observability-admin.mjs` with the five new helper functions
   and the updated `summarizeObservabilityPlane()` (or a parallel
   `summarizeConsoleAlertsContract()`) that incorporates the new contract.

### Step 4 — Validation library and command

1. Add `scripts/lib/observability-console-alerts.mjs` implementing
   `collectObservabilityConsoleAlertViolations()`.
1. Add `scripts/validate-observability-console-alerts.mjs` as the thin runner.
1. Update `package.json` with the new `validate:observability-console-alerts` script and wire
   it into `validate:repo`.

### Step 5 — Documentation and discoverability

1. Add `docs/reference/architecture/observability-console-alerts.md`.
1. Update `docs/reference/architecture/README.md` with the two new entries.
1. Update `docs/tasks/us-obs-01.md` with the `US-OBS-01-T05` section.

### Step 6 — Tests (dedicated test stage)

1. Add `tests/unit/observability-console-alerts.test.mjs` covering:
    - health summary model accessors,
    - alert category list and get helpers,
    - lifecycle state machine and allowed transitions,
    - suppression window defaults per category,
    - `buildHealthSummaryContext()` output shape and scope isolation enforcement,
    - `buildAlertContext()` output shape and audience routing,
    - `summarizeConsoleAlertsContract()` output completeness.
1. Add `tests/contracts/observability-console-alerts.contract.test.mjs` covering:
    - contract version field is a non-empty string,
    - `source_*_contract` version anchors align with current T01–T04 contract versions,
    - all required summary scopes are present,
    - status vocabulary contains required states with `operational_meaning` and
      `aggregation_priority`,
    - all required alert categories are present with suppression window, severity, lifecycle
      refs, and routing,
    - forbidden content categories are listed in masking policy,
    - audience routing roles are valid against the authorization model,
    - architecture doc and README index entries are discoverable,
    - `validate:observability-console-alerts` is present in `package.json` scripts,
    - `validate:repo` includes `validate:observability-console-alerts`.
1. Run `npm run validate:observability-console-alerts`.
1. Run targeted unit and contract tests.
1. Run markdown lint on the touched documentation set.

### Step 7 — Delivery

1. Inspect `git diff --stat` to confirm the delta stays within the declared artifact set.
1. Commit and push the branch with a focused message for `US-OBS-01-T05`.
1. Open PR, watch CI, address deterministic regressions, and merge when green.

---

## Done Criteria

This unit is complete when:

- `specs/029-observability-console-alerts/spec.md`, `plan.md`, and `tasks.md` are present,
- `services/internal-contracts/src/observability-console-alerts.json` is committed and available
  through shared readers in `services/internal-contracts/src/index.mjs`,
- the JSON contract defines a health summary model with at least five status vocabulary entries,
  deterministic aggregation rules for platform/tenant/workspace scopes, and explicit scope
  isolation rules for tenant and workspace summaries,
- the JSON contract defines an alert contract with at least four categories, severity levels,
  lifecycle states with allowed-transition rules, suppression window defaults, audience routing
  aligned with the authorization model, and a masking policy with forbidden content categories,
- `source_*_contract` version anchors on the new contract align with the actual T01–T04 contract
  versions,
- `apps/control-plane/src/observability-admin.mjs` exposes `buildHealthSummaryContext()`,
  `buildAlertContext()`, `getAlertLifecycleStateMachine()`, `getAlertSuppressionDefaults()`,
  and `summarizeConsoleAlertsContract()`,
- `scripts/validate-observability-console-alerts.mjs` runs cleanly (`npm run
  validate:observability-console-alerts` exits 0),
- `validate:repo` includes `validate:observability-console-alerts`,
- `docs/reference/architecture/observability-console-alerts.md` is present and discoverable from
  `docs/reference/architecture/README.md`,
- `docs/tasks/us-obs-01.md` documents the `US-OBS-01-T05` scope and residual note pointing to
  T06,
- `tests/unit/observability-console-alerts.test.mjs` and
  `tests/contracts/observability-console-alerts.contract.test.mjs` pass,
- markdown lint passes on all touched files,
- the branch is merged to `main`,
- and orchestrator state advances to the next backlog item (`US-OBS-01-T06`).
