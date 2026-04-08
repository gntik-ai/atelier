# Observability Health Dashboards

This document records the canonical dashboard baseline introduced by `US-OBS-01-T02`.
It defines how the platform expresses health at the `global`, `tenant`, and `workspace` dashboard
scopes while reusing the normalized metrics vocabulary established by
`services/internal-contracts/src/observability-metrics-stack.json`.

This increment does **not** implement a charting UI, public API route, health endpoint, or alerting
workflow. It defines the contract and summary semantics that future console, endpoint, alerting,
and smoke-test work must consume.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-dashboards.json` is the source of truth for the
health dashboard hierarchy, mandatory health dimensions, widget semantics, scope inheritance rules,
workspace fallback behavior, and authorization/traceability expectations.

## Canonical dashboard hierarchy

The platform uses one dashboard hierarchy only:

- `global`
- `tenant`
- `workspace`

The hierarchy is directional.

- `global -> tenant` is the platform-to-tenant drilldown path.
- `tenant -> workspace` is the tenant-to-workspace drilldown path.
- workspace views do not widen back to tenant or global scope implicitly.

The important distinction is that dashboard scope is not identical to metric scope naming:

- dashboard scope `global` consumes platform-scoped metrics (`metric_scope=platform`)
- dashboard scope `tenant` consumes tenant-scoped metrics (`metric_scope=tenant`)
- dashboard scope `workspace` consumes workspace-scoped metrics (`metric_scope=workspace`)

This lets downstream work expose operator-friendly dashboard names without rewriting the metrics
contract defined in `US-OBS-01-T01`.

## Mandatory health dimensions

Every dashboard scope must present these dimensions for each subsystem:

- availability
- errors
- latency
- throughput
- collection freshness

These dimensions apply to all seven baseline subsystems:

- APISIX
- Kafka
- PostgreSQL
- MongoDB
- OpenWhisk
- S3-compatible storage
- control plane

A consumer may summarize, aggregate, or rank these dimensions differently per scope, but it must
not omit them from the canonical dashboard definition.

## Scope behavior

### Global dashboard

The global dashboard is the authoritative platform-wide operational view.

It must:

- show all seven subsystems in one normalized summary surface,
- make degraded, healthy, stale, and unknown subsystem posture visible in one view,
- surface collection freshness as a first-class health signal,
- and support drilldown toward a tenant context when the actor has platform-wide authority.

The global dashboard does not require tenant or workspace context.

### Tenant dashboard

The tenant dashboard is the tenant-safe operational view.

It must:

- require a concrete `tenant_id`,
- show only health information attributable to that tenant,
- preserve cross-tenant isolation at the presentation layer,
- distinguish tenant-local degradation from platform-inherited degradation,
- and allow drilldown to a workspace only when that workspace belongs to the same tenant.

Platform-wide incidents may appear here only as dependency posture, not as raw comparative or
cross-tenant operational detail.

### Workspace dashboard

The workspace dashboard is the narrowest health view.

It must:

- require both `tenant_id` and `workspace_id`,
- show only workspace-safe health information,
- distinguish workspace-local degradation from tenant- or platform-inherited degradation,
- and avoid fabricating workspace precision when the underlying subsystem cannot safely support it.

When workspace-safe attribution is not available, the dashboard must mark the subsystem as one of:

- tenant inherited,
- platform dependent,
- or unavailable for workspace detail.

## Inherited degradation semantics

Narrower scopes must not imply that every visible problem originated locally.

The canonical contract therefore treats inherited degradation as a first-class dashboard outcome:

- the tenant dashboard can inherit degradation from `global`,
- the workspace dashboard can inherit degradation from both `tenant` and `global`,
- and inherited conditions must remain visibly different from confirmed local degradation.

This prevents workspace operators from misdiagnosing platform-wide or tenant-wide incidents as
workspace-local failures.

## Collection freshness semantics

Collection freshness is part of health, not a secondary footnote.

The dashboard baseline reuses the metrics-plane telemetry contract:

- `in_falcone_observability_collection_health`
- `in_falcone_observability_collection_failures_total`
- `in_falcone_observability_collection_lag_seconds`

A stale or failed collection path means the affected widget or subsystem summary must not be shown
as confirmed healthy current state.

Dashboards should evaluate freshness against the subsystem-specific `max_staleness_seconds` values
already defined in the observability metrics stack contract.

## Workspace fallback rules

Not every subsystem can always provide safe workspace-level attribution.

The canonical fallback policy is conservative:

- prefer tenant-inherited status over speculative workspace attribution,
- preserve platform dependency visibility without leaking platform internals,
- keep subsystem names visible even when workspace detail is unavailable,
- and make the limitation explicit in the summary contract.

For this baseline, the subsystem widget catalog keeps all seven subsystems visible at all dashboard
scopes, while the widget-level `workspace_fallback` behavior tells consumers whether a subsystem is
natively workspace-safe or should degrade to tenant-inherited semantics.

## Authorization and traceability

Dashboard access is security-relevant.

Consumers of the dashboard contract must preserve at least:

- `actor_id`
- `dashboard_scope`
- `tenant_id` when applicable
- `workspace_id` when applicable
- `correlation_id`

Tenant and workspace views must reject cross-tenant or mismatched workspace requests rather than
attempting to coerce them into a broader or ambiguous health view.

## Notes for downstream observability work

- `US-OBS-01-T03` should reuse these dashboard semantics when defining health, readiness, or
  liveness endpoints.
- `US-OBS-01-T04` should keep business metrics separate from this technical health baseline.
- `US-OBS-01-T05` should consume the same scope hierarchy and fallback rules when presenting health
  summaries in the console.
- `US-OBS-01-T06` should validate stale-data handling, inherited degradation visibility, and scope
  isolation against this contract rather than inventing alternate expectations.

## Residual implementation note

This baseline defines the dashboard contract, scope model, widget catalog, and validation surface.
It does not claim that a production dashboard renderer, tenant console panel, or alert routing
pipeline already exists for every subsystem.
