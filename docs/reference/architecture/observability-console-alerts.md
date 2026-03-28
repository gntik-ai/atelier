# Observability Console Health Summaries and Internal Alerts

This document records the canonical console-summary and internal-alert baseline introduced by
`US-OBS-01-T05`.
It consumes the unified metrics plane from `US-OBS-01-T01`, the dashboard scope hierarchy from
`US-OBS-01-T02`, the health/probe contract from `US-OBS-01-T03`, and the business-metrics
vocabulary from `US-OBS-01-T04`.

This increment does **not** implement external notification delivery, public alert APIs, or live
console UI rendering. It defines the internal contract that later consumers must reuse.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-console-alerts.json` is the source of truth for:

- console health-summary scopes and required fields,
- supported summary statuses and their aggregation priority,
- freshness semantics for summary evidence,
- alert categories, severity, lifecycle, suppression, and oscillation policy,
- audience routing by platform, tenant, and workspace scope,
- masking and audit expectations,
- and downstream consumer declarations for console summaries, operator inboxes, and smoke checks.

## Why console summaries and internal alerts belong in the same plane

The platform already knows how to describe:

- normalized metric scopes,
- dashboard scopes,
- component health and freshness,
- and business-impact domains.

What operators and tenant owners still need is a **bounded summary layer** that answers two
practical questions:

1. what is the current health posture for my scope right now?
2. what changed enough to require investigation or acknowledgement?

Keeping summaries and alerts inside the same observability contract family ensures they reuse one
vocabulary for:

- `platform`, `tenant`, and `workspace` scope,
- staleness handling,
- masking and cross-tenant isolation,
- auditable alert lifecycle changes,
- and bounded business-impact attribution.

## Summary scopes

The console-summary contract defines three summary scopes:

- `platform` → dashboard scope `global`
- `tenant` → dashboard scope `tenant`
- `workspace` → dashboard scope `workspace`

Important behavior:

- platform summaries may name required internal components from the health-check contract,
- tenant summaries must attribute broad incidents as `platform_condition` or `tenant_local`
  instead of exposing platform-internal topology,
- workspace summaries may attribute `workspace_local` issues only when workspace-safe evidence is
  available,
- and missing freshness must render the summary `stale`, not healthy.

## Status vocabulary and aggregation

The canonical status vocabulary for summaries is:

- `healthy`
- `degraded`
- `unavailable`
- `stale`
- `unknown`

Aggregation remains deterministic:

- `unavailable` outranks all other current-state summaries,
- `stale` outranks `unknown` and `healthy` because old evidence is not current evidence,
- `unknown` is used when safe evidence is incomplete,
- and `degraded` remains distinct from total unavailability.

The baseline reuses the stale-probe window from `US-OBS-01-T03` so downstream consumers do not
invent a second freshness threshold.

## Internal alert categories

The alert baseline currently defines four categories:

- `component_availability_transition`
- `sustained_error_rate_breach`
- `freshness_staleness`
- `business_metric_deviation`

Each category defines:

- supported scopes,
- default severity,
- required alert fields,
- suppression windows,
- and operator-facing purpose.

This keeps console summaries aligned with internal operator awareness without coupling the contract
to any specific delivery transport.

## Lifecycle, suppression, and oscillation rules

Alerts move through these lifecycle states:

- `active`
- `acknowledged`
- `resolved`
- `suppressed`

The baseline also defines:

- allowed lifecycle transitions,
- deduplication key fields,
- a shared suppressed/resolved vocabulary,
- and oscillation detection rules so flapping conditions are visible without flooding operators
  with noisy duplicate alerts.

## Audience routing and masking

Audience routing is scope-aware:

- platform alerts route to `platform_operator`, `platform_admin`, and audit-oriented platform roles,
- tenant alerts route to `tenant_owner`, `tenant_admin`, and summary-only tenant viewers,
- workspace alerts route to workspace owners/admins/operators with audit-aware viewer roles.

Masking rules explicitly forbid sensitive or high-risk content such as:

- passwords,
- secrets,
- tokens,
- connection strings,
- raw hostnames or endpoints,
- user identifiers,
- email addresses,
- object keys,
- and raw topic names.

Tenant and workspace alerts must stay attributable without leaking platform-internal or cross-tenant
information.

## Validation

Primary validation entry points for the console-summary and alert baseline:

```bash
npm run validate:observability-console-alerts
```

Downstream tasks should also add focused unit and contract coverage for summary helpers, audience
routing, lifecycle semantics, and scope-safe query construction.

## Residual implementation note

`US-OBS-01-T01` through `US-OBS-01-T05` now define the canonical metrics, dashboard, health,
business-metric, and summary/alert semantics for observability.
Remaining work still includes smoke verification (`US-OBS-01-T06`) and any live runtime/UI
consumers that materialize these contracts.
