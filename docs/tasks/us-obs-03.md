# US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento

## Scope delivered in `US-OBS-03-T01`

This increment establishes the **usage-consumption calculation baseline** for tenant and workspace
scope.

Delivered artifacts:

- `services/internal-contracts/src/observability-usage-consumption.json` as the machine-readable
  source of truth for metered dimensions, scope rules, freshness semantics, calculation cadence,
  audit-cycle compatibility, and route / permission alignment
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the usage-consumption
  contract
- `scripts/lib/observability-usage-consumption.mjs` and
  `scripts/validate-observability-usage-consumption.mjs` for deterministic validation of the new
  baseline and its alignment with the existing observability, audit, authorization, and public API
  contracts
- `apps/control-plane/src/observability-admin.mjs` additive helper surfaces for building tenant and
  workspace usage snapshots plus audit-compatible calculation-cycle summaries
- additive metrics-family routes for tenant and workspace usage snapshots under the unified public
  API surface
- `docs/reference/architecture/observability-usage-consumption.md` as the human-readable
  architecture guide for the usage-consumption baseline
- targeted unit and contract tests for the new contract, helper surfaces, authorization alignment,
  and published routes

## Main decisions in `US-OBS-03-T01`

### Usage consumption reuses the observability plane instead of inventing a second telemetry model

The baseline now fixes one normalized catalog of quota-relevant usage dimensions for tenant and
workspace scope.

This prevents later quota and alerting work from inferring consumption independently from ad hoc
metrics or provider-specific payloads.

### Exact inventory counts remain first-class where telemetry alone is insufficient

Not every quota-relevant dimension can be trusted as a pure metric.

The baseline therefore allows a bounded split between:

- business-metric-backed consumption dimensions
- exact control-plane inventory-backed dimensions

That keeps later quota policy work accurate without fragmenting the public and internal vocabulary.

### Freshness must stay visible

Usage snapshots must never silently present stale data as current.

The baseline explicitly requires every dimension to surface one of:

- `fresh`
- `degraded`
- `unavailable`

That visibility is part of the contract and may not be omitted by later tasks.

### Audit compatibility is defined before threshold and enforcement work

Each usage calculation cycle now has one audit-compatible summary posture aligned to:

- subsystem `quota_metering`
- action category `configuration_change`
- origin surface `scheduled_operation`

That makes later threshold, alerting, and enforcement work traceable without redefining the audit
vocabulary.

## Validation for `US-OBS-03-T01`

Primary validation entry point:

```bash
npm run validate:observability-usage-consumption
```

## Downstream dependency note for `US-OBS-03-T01`

This increment defines the trusted usage baseline required before the rest of the story can extend
behavior.

Downstream work remains separate:

- `US-OBS-03-T02` — warning / hard-limit threshold policy evaluation
- `US-OBS-03-T03` — alert emission on threshold breach
- `US-OBS-03-T04` — hard-limit blocking of create / provision flows
- `US-OBS-03-T05` — console usage vs quota and provisioning state
- `US-OBS-03-T06` — end-to-end cross-module verification

## Residual implementation note for `US-OBS-03-T01`

This increment does **not** implement threshold evaluation, alert delivery, hard-limit blocking,
console rendering, or the final end-to-end quota test matrix.
It only establishes the bounded usage-consumption contract, helper surfaces, route publication,
documentation, and tests required for those later tasks.

## Scope delivered in `US-OBS-03-T02`

This increment establishes the **quota-policy and threshold-posture baseline** for tenant and
workspace scope.

Delivered artifacts:

- `services/internal-contracts/src/observability-quota-policies.json` as the machine-readable
  source of truth for quota threshold types, posture states, ordering rules, supported dimensions,
  evaluation defaults, audit compatibility, and route / permission alignment
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the quota-policy
  contract
- `scripts/lib/observability-quota-policies.mjs` and
  `scripts/validate-observability-quota-policies.mjs` for deterministic validation of the new
  baseline and its alignment with usage consumption, health, audit, authorization, and public API
  contracts
- `apps/control-plane/src/observability-admin.mjs` additive helper surfaces for building tenant and
  workspace quota posture snapshots plus audit-compatible evaluation summaries
- additive metrics-family routes for tenant and workspace quota posture under the unified public API
  surface
- `docs/reference/architecture/observability-quota-policies.md` as the human-readable architecture
  guide for the quota-policy baseline
- targeted unit and contract tests for the new contract, helper surfaces, authorization alignment,
  and published routes

## Main decisions in `US-OBS-03-T02`

### Threshold semantics are centralized instead of duplicated downstream

The baseline now fixes one normalized interpretation for:

- `warning_threshold`
- `soft_limit`
- `hard_limit`

This prevents later alerting, blocking, and console work from drifting in how quota posture is
calculated.

### Quota posture stays separate from runtime reactions

The baseline publishes the posture state that later tasks can consume, but it does not itself emit
alerts or block resource creation.

That keeps the policy layer independently testable and bounded.

### Freshness from usage remains visible in quota posture

Quota posture cannot be more trustworthy than the usage evidence beneath it.

The baseline therefore preserves degraded and unavailable evidence semantics instead of flattening
all states into a single healthy/breached outcome.

### Unbounded dimensions remain visible

A dimension without enforced thresholds does not disappear from the contract.

It is surfaced explicitly as `unbounded`, which preserves catalog consistency across all consumers.

## Validation for `US-OBS-03-T02`

Primary validation entry point:

```bash
npm run validate:observability-quota-policies
```

## Downstream dependency note for `US-OBS-03-T02`

This increment defines the trusted quota posture baseline required before the rest of the story can
extend behavior.

Downstream work remains separate:

- `US-OBS-03-T03` — alert emission on threshold breach
- `US-OBS-03-T04` — hard-limit blocking of create / provision flows
- `US-OBS-03-T05` — console usage vs quota and provisioning state
- `US-OBS-03-T06` — end-to-end cross-module verification

## Residual implementation note for `US-OBS-03-T02`

This increment does **not** emit quota alerts, execute hard-limit blocking, render the final console
experience, or deliver the broad cross-module enforcement matrix.
It only establishes the bounded quota-policy contract, helper surfaces, route publication,
documentation, and tests required for those later tasks.

## Scope delivered in `US-OBS-03-T05`

This increment establishes the **quota-usage overview** for tenant/workspace scope and the first
bounded **tenant provisioning-state detail projection** used by console consumers.

Delivered artifacts:

- `services/internal-contracts/src/observability-quota-usage-view.json` as the machine-readable
  source of truth for overview scopes, required dimension fields, visual-state mapping,
  provisioning-state detail, route / permission / resource-type alignment, and overview access-audit
  metadata
- additive shared readers/accessors in `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-quota-usage-view.mjs` and
  `scripts/validate-observability-quota-usage-view.mjs` for deterministic contract validation and
  dependency alignment checks
- additive `metrics` overview routes for tenant and workspace scope under the unified public API
  surface
- additive helper surfaces in `apps/control-plane/src/observability-admin.mjs` for building
  overview projections, provisioning-state detail, and access-audit records
- `apps/web-console/src/observability-quota-usage.mjs` as the bounded console-consumer helper
  layer for cards, provisioning banners, and capacity rows
- `docs/reference/architecture/observability-quota-usage-view.md` as the human-readable
  architecture guide for this overview baseline
- targeted unit and contract tests for the new contract, helper surfaces, route publication, and
  console-helper outputs

## Main decisions in `US-OBS-03-T05`

### Overview responses consume T01, T02, and T04 instead of recalculating them

T05 merges existing usage, quota posture, and hard-limit context into one operator-facing
projection.
It does not create a second quota engine.

### Visual-state mapping is normalized once for console consumers

The overview contract fixes one visual vocabulary (`healthy`, `warning`, `elevated`, `critical`,
`degraded`, `unknown`) so presentation code does not need to infer severity from raw quota posture
states.

### Tenant provisioning detail remains bounded and read-only

Tenant overviews now carry a provisioning summary with a fixed component roster and explicit
operator-facing states.
That detail is read-only and does not mutate provisioning workflows.

### Workspace overviews stay scope-safe

Workspace consumers receive quota/usage context for their own scope without inheriting the full
cross-tenant provisioning detail from the tenant overview.

## Validation for `US-OBS-03-T05`

Primary validation entry point:

```bash
npm run validate:observability-quota-usage-view
```

## Downstream dependency note for `US-OBS-03-T05`

This increment defines the visibility layer required before the final verification work can prove
cross-module consistency.

Downstream work remains separate:

- `US-OBS-03-T06` — end-to-end cross-module verification

## Residual implementation note for `US-OBS-03-T05`

This increment does **not** implement the full end-to-end verification matrix or a live React
console page.
It only delivers the bounded overview contract, helper surfaces, public route publication,
console-helper projections, documentation, and tests required before `T06`.

## Scope delivered in `US-OBS-03-T03`

This increment establishes the **threshold-alert baseline** for tenant and workspace quota posture.

Delivered artifacts:

- `services/internal-contracts/src/observability-threshold-alerts.json` as the machine-readable
  source of truth for threshold alert event types, suppression causes, event-envelope requirements,
  Kafka topic posture, deterministic correlation rules, and last-known posture store semantics
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the threshold-alert
  contract
- `scripts/lib/observability-threshold-alerts.mjs` and
  `scripts/validate-observability-threshold-alerts.mjs` for deterministic contract validation and
  dependency alignment checks
- additive helper surfaces in `apps/control-plane/src/observability-admin.mjs` for transition
  detection, event construction, evaluation-cycle orchestration, posture-store reads/writes, and
  alert metrics
- `charts/in-falcone/bootstrap/migrations/20260328-002-quota-threshold-alert-posture-store.sql`
  for the PostgreSQL last-known posture store used for deduplication and restart safety
- `docs/reference/architecture/observability-threshold-alerts.md` as the human-readable
  architecture guide for the threshold-alert baseline
- targeted unit and contract tests for the new contract, helper surfaces, docs linkage, and task
  summary coverage

## Main decisions in `US-OBS-03-T03`

### Threshold-alert ordering is deterministic

Escalations emit all intermediate crossings in ascending severity during one cycle.
Recoveries emit in descending severity.
This keeps downstream consumers from inferring missing intermediate postures.

### Freshness suppresses alerts instead of pretending confidence

When evidence is `degraded` or `unavailable`, transition alerts are suppressed and the evaluator
emits only the bounded suppression posture for that cycle.
The last-known posture is not advanced from degraded evidence.

### Kafka topic posture is fixed before notification-channel work

The baseline locks the topic name `quota.threshold.alerts`, partition key `tenantId`, and backward
compatible schema subject prefix so future consumers do not re-litigate transport details.

### Restart safety comes from the last-known posture store

A dedicated PostgreSQL store preserves the last trustworthy posture seen per
`tenant/workspace/dimension` tuple so the evaluator can avoid duplicate transition alerts after
restarts.

## Validation for `US-OBS-03-T03`

Primary validation entry point:

```bash
npm run validate:observability-threshold-alerts
```

## Downstream dependency note for `US-OBS-03-T03`

This increment defines the threshold-alert baseline required before the rest of the story can extend
behavior.

Residual downstream work remains separate:

- `US-OBS-03-T04` — hard-limit blocking of create / provision flows
- `US-OBS-03-T05` — console usage vs quota and provisioning state
- `US-OBS-03-T06` — end-to-end cross-module verification

## Residual implementation note for `US-OBS-03-T03`

This increment does **not** implement blocking semantics, notification delivery channels, console
visualization, or the final cross-module enforcement matrix.
It establishes the threshold-alert contract, Kafka topic posture, posture-store migration,
helper/evaluation surface, documentation, and tests required before those later tasks expand the
feature.

## Scope delivered in `US-OBS-03-T04`

This increment establishes the **hard-limit enforcement baseline** for quota-driven create/admission
flows.

Delivered artifacts:

- `services/internal-contracts/src/observability-hard-limit-enforcement.json` as the machine-readable
  source of truth for the canonical hard-limit denial contract, enforceable dimension aliases,
  create-surface mappings, scope precedence, and fail-closed posture
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the hard-limit
  enforcement contract
- `scripts/lib/observability-hard-limit-enforcement.mjs` and
  `scripts/validate-observability-hard-limit-enforcement.mjs` for deterministic contract validation
  and dependency-alignment checks
- additive helper surfaces in `apps/control-plane/src/observability-admin.mjs` for canonical
  hard-limit decisions, error payloads, audit events, and strictest-scope resolution
- additive `quotaDecision` metadata across the bounded storage/functions/events/postgres/mongo
  create/admission validations
- bounded family OpenAPI denial docs for storage, functions, events, postgres, and mongo, followed
  by `npm run generate:public-api`
- `docs/reference/architecture/observability-hard-limit-enforcement.md` as the human-readable
  architecture guide for the hard-limit enforcement baseline
- targeted unit, contract, and adapter tests covering the shared contract and additive structured
  quota denials

## Main decisions in `US-OBS-03-T04`

### Hard-limit denials use one canonical response shape

Adapters may keep native validation strings for compatibility, but the structured admission denial
shape is centralized and always uses `QUOTA_HARD_LIMIT_REACHED`.

### Scope precedence is deterministic

When more than one scope is exhausted, the bounded helper picks the strictest breached scope rather
than leaving the effective denial ambiguous.

### Missing evidence fails closed

This baseline treats missing quota evidence as unsafe for create/admission flows. The contract
therefore denies when hard-limit evidence is unavailable instead of silently allowing the request.

## Validation for `US-OBS-03-T04`

Primary validation entry point:

```bash
npm run validate:observability-hard-limit-enforcement
```

## Downstream dependency note for `US-OBS-03-T04`

This increment defines the trusted hard-limit blocking baseline required before the remaining story
work can extend the user-facing experience.

Downstream work remains separate:

- `US-OBS-03-T05` — console usage vs quota and provisioning state
- `US-OBS-03-T06` — end-to-end cross-module verification

## Residual implementation note for `US-OBS-03-T04`

This increment does **not** implement the final console rendering from `T05` or the broad
cross-module end-to-end matrix from `T06`.
It only establishes the bounded hard-limit contract, helper surfaces, adapter metadata, public API
notes, documentation, and tests required for those later tasks.

## Scope delivered in `US-OBS-03-T06`

This increment establishes the **final cross-module verification matrix** for the story and proves
that the previously delivered usage, quota, enforcement, and overview baselines remain aligned.

Delivered artifacts:

- `tests/unit/observability-quota-enforcement-verification.test.mjs` as the bounded verification
  suite proving one below-limit allowed state, one hard-limit denied state, and one overview
  explainability projection for each covered module family
- additive story-summary coverage here in `docs/tasks/us-obs-03.md`
- additive Spec Kit artifacts under `specs/042-quota-enforcement-verification/`

Covered module families:

- OpenWhisk functions
- Kafka topics / events
- storage bucket admission
- PostgreSQL schema creation
- MongoDB database creation

## Main decisions in `US-OBS-03-T06`

### The final increment validates the existing baselines instead of inventing a new runtime layer

`T06` is intentionally verification-oriented.
It does not add a second quota engine, new routes, or new provider integrations.

### Explainable blocking stays attached to the overview vocabulary

Every covered hard-limit denial is projected through the bounded workspace quota overview using the
existing `sourceDimensionIds` linkage.
That keeps blocked actions explainable through the same operator vocabulary established in `T05`.

### Cross-module confidence is delivered through one compact matrix

Rather than scattering final story confidence across several unrelated module tests, `T06` provides
one explicit matrix covering the critical module families that consume the story baselines.

## Validation for `US-OBS-03-T06`

Primary validation entry points:

```bash
node --test tests/unit/observability-quota-enforcement-verification.test.mjs
npm test
```

## Story completion note for `US-OBS-03`

`US-OBS-03-T06` is the terminal objective for this story.
After this increment, `US-OBS-03` no longer has residual in-story work pending.
