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

## Residual implementation note

This increment does **not** implement threshold evaluation, alert delivery, hard-limit blocking,
console rendering, or the final end-to-end quota test matrix.
It only establishes the bounded usage-consumption contract, helper surfaces, route publication,
validation, documentation, and tests required for those later tasks.
