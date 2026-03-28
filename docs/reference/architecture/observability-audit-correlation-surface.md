# Observability audit correlation surface

## Purpose

`US-OBS-02-T05` establishes the governed correlation baseline that links **console-initiated administrative actions** with the **real downstream changes** executed by underlying systems.

This document is the human-readable companion to:

- `services/internal-contracts/src/observability-audit-correlation-surface.json`
- `scripts/lib/observability-audit-correlation-surface.mjs`
- `scripts/validate-observability-audit-correlation-surface.mjs`

It defines the bounded correlation request model, trace-status vocabulary, timeline phases, downstream source-contract catalog, safe evidence-pointer posture, route bindings, and console trace metadata that extend the existing audit query/export surfaces.

## Scope boundary

This increment defines the **correlation + traceability contract only**.

Included in `US-OBS-02-T05`:

- tenant- and workspace-scoped audit correlation lookup surfaces
- bounded lookup by one `correlationId`
- explicit trace statuses (`complete`, `partial`, `broken`, `not_found`)
- bounded timeline phases for console initiation, control-plane execution, downstream effect, and audit persistence
- linked audit-record projections that reuse T04 masking semantics
- safe evidence-pointer projections for downstream execution artifacts
- explicit audit-correlation permissions
- console trace metadata for status badges and empty/loading/error states

Explicitly deferred to later tasks:

- end-to-end verification suites and data-protection proof (`US-OBS-02-T06`)
- durable incident/case management or investigation workspaces
- replay, repair, or remediation automation
- global/cross-tenant correlation search surfaces

## Source contracts reused

This baseline depends on and must stay aligned with:

- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/observability-audit-query-surface.json`
- `services/internal-contracts/src/observability-audit-export-surface.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/internal-service-map.json`

### Why T04 masking reuse matters

T05 does not introduce a second masking policy. Correlated audit-record projections reuse the T04 masking semantics so protected fields remain protected in both export and traceability views.

## Correlation scopes

The initial correlation scopes are intentionally symmetric with the T03/T04 audit surfaces.

### Tenant correlation

- route operation id: `getTenantAuditCorrelation`
- permission: `tenant.audit.correlate`
- tenant binding: required
- workspace widening: not allowed in this increment

### Workspace correlation

- route operation id: `getWorkspaceAuditCorrelation`
- permission: `workspace.audit.correlate`
- workspace binding: required and immutable from caller context
- tenant binding: inherited from workspace context

## Trace status model

The first bounded trace-status catalog is:

- `complete` — initiation, downstream effect, and linked audit evidence are all present
- `partial` — some trace evidence exists, but one or more expected links are missing
- `broken` — the available evidence is insufficient to attribute the chain end to end
- `not_found` — no scoped evidence exists for the requested correlation id

## Timeline phases

The bounded phase catalog is:

- `console_initiation`
- `control_plane_execution`
- `downstream_system_effect`
- `audit_persistence`

The response remains intentionally small: it is a traceability surface, not a case-management workflow.

## Downstream source contracts

The initial downstream source catalog reuses already published internal contracts that carry correlation and audit-link metadata:

- `iam_admin_result`
- `mongo_admin_result`
- `kafka_admin_result`
- `postgres_data_change_event`
- `storage_object_event`
- `openwhisk_activation_event`

These sources let the correlation surface link console actions to real provider-side or subsystem-side effects without inventing new implicit contract names.

## Safe evidence pointers

Correlation responses may expose evidence pointers, but only in **safe** form.

Required behavior:

- evidence pointers expose stable safe refs only
- protected locator fields remain masked or omitted
- raw credentials, tokens, connection strings, object keys, and raw provider endpoints never appear in the correlation response
- missing links are surfaced explicitly instead of leaking hidden payloads as a debugging shortcut

## Console surface

The console correlation surface is shared and contract-backed.

It provides:

- entry scopes (`tenant`, `workspace`)
- status badges and labels
- phase labels
- default timeline grouping
- evidence-pointer display default
- empty/loading/error state ids

## Permissions and isolation

This increment introduces explicit correlation permissions:

- `tenant.audit.correlate`
- `workspace.audit.correlate`

Correlation is intentionally narrower than plain audit read visibility:

- viewer roles do not gain correlation access automatically
- workspace traces stay within one workspace
- tenant traces stay within one tenant
- no cross-tenant or global correlation search is added in this increment

## Validation and discoverability

Primary validation entry point:

```bash
npm run validate:observability-audit-correlation-surface
```

The T05 validator checks:

- source-contract version alignment
- required correlation scopes
- route existence in the generated route catalog
- known authorization actions
- status and phase vocabulary coverage
- internal-service-map source-contract alignment
- masking compatibility with the T04 export surface
- preserved downstream boundary for T06

## Explicit boundary to later tasks

This increment does **not** implement:

- end-to-end traceability and data-protection verification (`US-OBS-02-T06`)
- incident case files or operator investigation workspaces
- replay or remediation behavior

T05 only defines the bounded correlation surface that T06 will validate.
