# Observability Audit Query Surface

## Scope

`US-OBS-02-T03` establishes the bounded **query and filter surface** for transversal audit consultation.

It builds directly on:

- `US-OBS-02-T01` — common audit pipeline baseline
- `US-OBS-02-T02` — canonical audit-event envelope baseline

This increment adds the minimum contract needed for callers to consult audit records through the unified product API and the administrative console without defining export, masking, or cross-system correlation execution.

## Machine-readable source of truth

- `services/internal-contracts/src/observability-audit-query-surface.json` is the machine-readable contract for supported audit query scopes, filters, pagination, response metadata, and console explorer settings.

## Supported query scopes

The initial query surface intentionally stays narrow.

### Tenant audit explorer

- route operation id: `listTenantAuditRecords`
- path: `/v1/metrics/tenants/{tenantId}/audit-records`
- required permission: `tenant.audit.read`
- binding rule: results stay inside the requested tenant; workspace narrowing is optional but cannot widen scope

### Workspace audit explorer

- route operation id: `listWorkspaceAuditRecords`
- path: `/v1/metrics/workspaces/{workspaceId}/audit-records`
- required permission: `workspace.audit.read`
- binding rule: results stay inside the requested workspace and may not substitute another workspace id

## Supported filters

The T03 contract defines one shared filter vocabulary for API and console consumers.

- `filter[occurredAfter]`
- `filter[occurredBefore]`
- `filter[subsystem]`
- `filter[actionCategory]`
- `filter[actionId]`
- `filter[outcome]`
- `filter[actorType]`
- `filter[actorId]`
- `filter[resourceType]`
- `filter[resourceId]`
- `filter[originSurface]`
- `filter[correlationId]`

These filters narrow the current authorized scope only. They never expand it.

## Pagination and sorting

The query surface reuses the shared `/v1` pagination conventions:

- `page[size]`
- `page[after]`
- `sort`

Current constraints:

- default page size: `25`
- max page size: `200`
- supported sorts: `-eventTimestamp`, `eventTimestamp`

## Response contract

The public query routes return an `AuditRecordCollectionResponse` envelope with:

- `items`
- `page`
- `queryScope`
- `appliedFilters`
- `availableFilters`
- `consoleHints`

Each item is a public projection of the canonical T02 audit-event envelope and preserves the same core fields:

- event identity
- event timestamp
- actor
- scope
- resource
- action
- result
- correlation id
- origin

## Console explorer baseline

The console consumes the same shared contract and does not redefine the filter vocabulary independently.

The baseline explorer metadata includes:

- entry scopes: `tenant`, `workspace`
- default columns: timestamp, subsystem, action, outcome, actor, resource, origin, correlation id
- saved presets:
  - `recent_failures`
  - `access_changes`
  - `current_correlation_id`
- explicit loading, empty, and error states

## Permission and isolation rules

Audit consultation is operationally sensitive and remains bound by explicit authorization.

- Tenant queries require `tenant.audit.read`.
- Workspace queries require `workspace.audit.read`.
- Tenant queries may narrow to one workspace but may not cross tenant boundaries.
- Workspace queries may not swap the workspace id supplied by the authorized context.
- Correlation id filters narrow results only; they do not introduce T05-style causation behavior.

## Validation and discoverability

Primary validation entry point:

```bash
npm run validate:observability-audit-query-surface
```

The T03 validator checks:

- source-contract version alignment
- required tenant/workspace scopes
- route existence in the generated route catalog
- filter coverage
- pagination alignment with the public API conventions
- known authorization actions
- console metadata consistency
- preserved downstream boundaries for export, masking, and correlation

## Explicit boundary to later tasks

This increment does **not** implement:

- export bundles or download workflows (`US-OBS-02-T04`)
- masking or sensitive-event handling (`US-OBS-02-T04`)
- cross-system correlation execution (`US-OBS-02-T05`)
- end-to-end traceability verification (`US-OBS-02-T06`)

T03 only defines the safe, queryable consultation surface those later tasks will extend.
