# Observability quota usage overview

`US-OBS-03-T05` introduces the bounded **quota usage overview** layer that sits on top of the
existing `US-OBS-03-T01` usage-consumption, `US-OBS-03-T02` quota-policy, and
`US-OBS-03-T04` hard-limit-enforcement baselines.

## Why this layer exists

Before T05, operators could fetch usage snapshots and quota posture separately, but they still had
to manually merge:

- current usage,
- warning / soft / hard thresholds,
- overage percentage,
- hard-limit context,
- and tenant provisioning readiness.

T05 publishes one normalized overview projection for tenant and workspace scope so downstream
console helpers and external operators do not need to re-encode those merge rules.

## Public API surface

T05 publishes two additive `metrics` routes:

- `GET /v1/metrics/tenants/{tenantId}/overview`
- `GET /v1/metrics/workspaces/{workspaceId}/overview`

They remain read-only and preserve the same tenant/workspace isolation model as the existing usage
and quota endpoints.

## Contract model

The machine-readable source of truth is:

- `services/internal-contracts/src/observability-quota-usage-view.json`

It defines:

- supported overview scopes,
- required fields for the per-dimension capacity view,
- posture-to-visual-state mapping,
- percentage calculation rules,
- tenant provisioning-state summary and component roster,
- overview access-audit metadata,
- and console-consumer guidance.

## Dimension projection

Every overview dimension carries:

- current usage,
- threshold values,
- computed percentage,
- normalized posture,
- normalized visual state,
- freshness,
- and blocking context.

### Percentage rules

- Prefer `hardLimit` as the denominator.
- Fall back to `softLimit` when no hard limit exists.
- Return `null` when the dimension is unbounded.
- Do not cap values above `100`; the operator must see real overage.

## Visual-state mapping

The console layer consumes one normalized visual vocabulary:

- `healthy`
- `warning`
- `elevated`
- `critical`
- `degraded`
- `unknown`

This prevents presentation code from duplicating quota posture semantics.

## Tenant provisioning-state detail

Tenant overviews include a bounded provisioning projection with:

- one overall state (`active`, `provisioning`, `degraded`, `error`),
- one visual state,
- one fixed component roster (`storage`, `databases`, `messaging`, `functions`, `realtime`),
- degraded component IDs,
- last-checked timestamp,
- and a short human-readable reason summary.

Workspace overviews do **not** widen tenant provisioning detail into cross-workspace visibility.

## Access-audit expectations

Overview reads produce one audit-compatible access record containing at least:

- `eventType`
- `queryScope`
- `tenantId`
- `workspaceId`
- `permissionId`
- `routeOperationId`
- `requestedBy`
- `generatedAt`

This keeps quota-overview access traceable without redefining the broader audit event envelope.

## Console-consumer boundary

T05 intentionally stops at deterministic helper builders under `apps/web-console/src/`.
It does **not** ship a React page, charting runtime, or trend history.

The console helper layer may:

- build tenant quota cards,
- build a provisioning banner,
- build per-dimension rows,
- and build workspace rows.

It may **not** recalculate thresholds or widen scope.

## Boundary to T06

`US-OBS-03-T05` publishes the overview contract, helpers, routes, docs, and tests.
`US-OBS-03-T06` remains responsible for the broad cross-module verification matrix that proves all
quota, blocking, alerting, and console consumers stay aligned end to end.
