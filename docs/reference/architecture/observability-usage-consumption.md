# Observability Usage Consumption

This document records the canonical usage-consumption baseline introduced by `US-OBS-03-T01`.
It builds on the shared observability plane from `US-OBS-01`, reuses the audit vocabulary from
`US-OBS-02`, and establishes the trusted input layer for the remaining quota, alerting,
blocking, console, and verification work in `US-OBS-03`.

This increment does **not** implement threshold policy, alert emission, hard blocking, or the final
console usage-vs-quota view. It defines the authoritative contract and helper surface they depend on.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-usage-consumption.json` is the source of truth for:

- tenant and workspace usage snapshot scopes,
- the metered-dimension catalog,
- freshness and degradation semantics,
- calculation cadence expectations,
- audit-cycle compatibility,
- and the published public-route / permission mapping.

## Why usage consumption is a distinct baseline

The repository already had:

- business and product metrics in `US-OBS-01-T04`,
- health and freshness semantics in `US-OBS-01`,
- and transversal audit contracts in `US-OBS-02`.

That still left one important gap:

**Which exact usage dimensions should quota and metering decisions consume for a tenant or workspace,
and how should those dimensions behave when observability evidence is stale?**

`US-OBS-03-T01` answers that question with one bounded contract rather than letting later tasks
infer consumption independently.

## Metered dimensions in scope

The current baseline publishes these dimensions for tenant and workspace snapshots:

- `api_requests`
- `function_invocations`
- `storage_volume_bytes`
- `data_service_operations`
- `realtime_connections`
- `logical_databases`
- `topics`
- `collections_tables`
- `error_count`

These dimensions intentionally mix two safe source modes:

### Business-metric-backed dimensions

These are derived from the existing observability business-metrics baseline:

- API requests
- function invocations
- storage logical volume
- data service operations
- realtime connections
- error-count projection

They reuse the same bounded labels, scope semantics, and freshness cautions already defined for the
observability plane.

### Exact inventory-backed dimensions

Some quota-relevant dimensions must not be approximated from telemetry alone.

For that reason the baseline also permits explicit control-plane inventory inputs for:

- logical databases
- topics
- collections and tables

These inventory-backed dimensions are still published through the same usage snapshot contract so
later quota policy work can read one normalized surface.

## Scope and isolation rules

The usage snapshot surface supports only:

- `tenant`
- `workspace`

Important isolation rules:

- tenant snapshots require `tenantId` and must not widen to a workspace target,
- workspace snapshots require both `tenantId` and `workspaceId`,
- workspace responses must not leak cross-workspace or cross-tenant detail,
- and every published route must align with the authorization model's usage-read actions.

The current route surface is:

- `GET /v1/metrics/tenants/{tenantId}/usage`
- `GET /v1/metrics/workspaces/{workspaceId}/usage`

## Freshness and degradation semantics

Usage snapshots cannot silently pretend that stale evidence is current.

The baseline therefore fixes three freshness states:

- `fresh`
- `degraded`
- `unavailable`

Every dimension remains visible in the response catalog even when its evidence is degraded or
unavailable. Later tasks may change policy behavior, but they must not remove the visibility of the
state itself.

The baseline uses:

- `in_atelier_observability_collection_health`
- `in_atelier_observability_collection_lag_seconds`

as the common freshness anchors inherited from the observability plane.

## Calculation-cycle audit compatibility

Each usage snapshot calculation cycle must remain auditable.

The contract therefore aligns its calculation summary with the canonical audit-event vocabulary:

- subsystem: `quota_metering`
- action category: `configuration_change`
- origin surface: `scheduled_operation`

The audit-compatible cycle payload is intentionally bounded to cycle metadata, processed scopes,
snapshot timestamp, and degraded dimension ids. It must not embed cross-tenant detail, raw request
identifiers, or secret material.

## Relationship to the remaining `US-OBS-03` tasks

`US-OBS-03-T01` is the foundation only.

Downstream work remains separate:

- `US-OBS-03-T02` — threshold policy and warning / hard-limit evaluation
- `US-OBS-03-T03` — alert/event emission
- `US-OBS-03-T04` — hard-limit blocking of create/provision flows
- `US-OBS-03-T05` — console usage vs quota view and provisioning state
- `US-OBS-03-T06` — end-to-end cross-module tests

Keeping these boundaries explicit prevents the consumption baseline from absorbing policy and UI work
prematurely.

## Residual implementation note

This baseline publishes the machine-readable usage contract, shared helper readers, deterministic
validation, additive metrics-family routes, documentation, and tests required before quota and
metering behavior can expand safely.
