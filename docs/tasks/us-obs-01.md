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
