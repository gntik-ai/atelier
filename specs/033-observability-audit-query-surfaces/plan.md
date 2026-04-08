# Implementation Plan: US-OBS-02-T03 — Queryable Audit Surfaces

**Feature Branch**: `033-observability-audit-query-surfaces`
**Spec**: `specs/033-observability-audit-query-surfaces/spec.md`
**Task**: `US-OBS-02-T03`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

Deliver the bounded T03 audit-query baseline by adding:

- one machine-readable **audit query-surface contract**,
- two public API routes under the metrics family,
- shared query normalization helpers,
- console-facing explorer metadata,
- explicit tenant/workspace permission and scope bindings,
- deterministic validation,
- documentation,
- and tests.

This increment must remain below export, masking, and cross-system correlation execution.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in the audit story

- `US-OBS-02-T01` defines the audit transport and subsystem coverage.
- `US-OBS-02-T02` defines the canonical audit-event envelope.
- `US-OBS-02-T03` defines **how callers query those records safely**.
- `US-OBS-02-T04+` extend the query flow with export and masking behavior.

### 2.2 Bounded architecture slice

```text
observability-audit-pipeline (T01)
        ↓ declares emitting subsystems and event categories
observability-audit-event-schema (T02)
        ↓ declares item shape for audit records
observability-audit-query-surface (T03)
        ↓ declares routes, filters, pagination, console explorer metadata
future export/masking/correlation tasks (T04–T06)
```

### 2.3 Source contracts consumed

The T03 contract and validators should align with:

- `services/internal-contracts/src/observability-audit-pipeline.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `services/internal-contracts/src/public-api-taxonomy.json`

### 2.4 Explicit non-goals

This task will not:

- add export/download routes,
- classify or mask sensitive payload fields,
- stitch correlation graphs,
- introduce audit-storage persistence or ETL changes,
- or create provider-native bypass surfaces.

---

## 3. Target Contract and API Shape

### 3.1 New contract artifact

Add `services/internal-contracts/src/observability-audit-query-surface.json` as the machine-readable source of truth.

Recommended top-level structure:

```json
{
  "version": "2026-03-28",
  "scope": "US-OBS-02-T03",
  "system": "in-falcone-observability-plane",
  "source_audit_pipeline_contract": "2026-03-28",
  "source_audit_event_schema_contract": "2026-03-28",
  "source_authorization_contract": "2026-03-24",
  "source_public_api_contract": "2026-03-26",
  "supported_query_scopes": [...],
  "pagination": {...},
  "filter_dimensions": [...],
  "response_contract": {...},
  "console_surface": {...},
  "governance": {...}
}
```

### 3.2 Query scopes

Keep the initial scope small:

- `tenant`
  - route: `listTenantAuditRecords`
  - required permission: `tenant.audit.read`
  - binding: tenant id required, workspace id optional as a narrowing filter only
- `workspace`
  - route: `listWorkspaceAuditRecords`
  - required permission: `workspace.audit.read`
  - binding: workspace id required and immutable from caller context

Do **not** add a platform-wide cross-tenant audit query route in this increment; that would widen the governance surface unnecessarily.

### 3.3 Filter vocabulary

Define stable parameter names based on the existing public API conventions:

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

### 3.4 Pagination and sorting

Adopt the shared public API pagination conventions:

- `page[size]`
- `page[after]`
- `sort`

Support only a narrow initial sort vocabulary:

- `-eventTimestamp`
- `eventTimestamp`

Enforce max page size 200 and default 25.

### 3.5 Response envelope

Add one generic collection schema for audit record queries with:

- `items`
- `page`
- `queryScope`
- `appliedFilters`
- `availableFilters`
- `consoleHints`

Each `items[]` element should reuse the canonical audit-event shape from T02 at a high level, but the T03 response schema can remain a public-API projection rather than a raw internal contract dump.

### 3.6 Console explorer metadata

The query-surface contract should define:

- visible scopes (`tenant`, `workspace`),
- default columns,
- saved presets (`recent_failures`, `access_changes`, `current_correlation_id`),
- empty-state titles/messages,
- loading/error state ids,
- and route bindings for tenant/workspace explorer entry points.

---

## 4. Artifact-by-Artifact Change Plan

### 4.1 `services/internal-contracts/src/observability-audit-query-surface.json` (new)

Add the machine-readable query-surface contract with source references, scope definitions, filter metadata, pagination policy, response metadata, console explorer metadata, and governance boundaries.

### 4.2 `services/internal-contracts/src/index.mjs`

Add:

- `OBSERVABILITY_AUDIT_QUERY_SURFACE_URL`
- cached reader state
- `readObservabilityAuditQuerySurface()`
- `OBSERVABILITY_AUDIT_QUERY_SURFACE_VERSION`
- accessors:
  - `listAuditQueryScopes()`
  - `getAuditQueryScope(scopeId)`
  - `listAuditQueryFilters()`
  - `getAuditQueryFilter(filterId)`
  - `getAuditQueryPaginationPolicy()`
  - `getAuditQueryResponseContract()`
  - `getAuditConsoleSurface()`

### 4.3 `scripts/lib/observability-audit-query-surface.mjs` (new)

Add helper exports:

- `readObservabilityAuditQuerySurface()`
- `readObservabilityAuditPipeline()`
- `readObservabilityAuditEventSchema()`
- `readAuthorizationModel()`
- `readPublicRouteCatalog()`
- `collectAuditQuerySurfaceViolations(contract, dependencies)`

Deterministic validation should cover at minimum:

1. version/source-contract alignment
2. tenant and workspace scopes both exist
3. expected route operation ids exist in the route catalog
4. required filter ids/params exist
5. pagination defaults stay inside shared public API limits
6. declared permissions exist in the authorization model
7. console surface references only declared scopes and filter ids
8. governance preserves the T04/T05 boundaries

### 4.4 `scripts/validate-observability-audit-query-surface.mjs` (new)

Add the CLI validator entry point and wire it into `package.json` and `validate:repo`.

### 4.5 `services/internal-contracts/src/authorization-model.json`

Make the minimum auth changes needed for workspace-safe audit reads:

- add `workspace.audit.read` to `resource_actions.workspace`
- add `workspace.audit.read` to `resource_semantics.workspace.delegable_actions`
- grant `workspace.audit.read` to platform admin/operator/auditor and workspace owner/admin/operator/auditor/viewer as appropriate for read-only audit access
- relax `audit_query_context` so `tenant_id` and `workspace_id` are scope-dependent rather than universally required

### 4.6 `services/internal-contracts/src/public-api-taxonomy.json`

Add resource-taxonomy entries for:

- `tenant_audit_record` → authorization resource `tenant`
- `workspace_audit_record` → authorization resource `workspace`

Keep the feature additive within the existing metrics family and current `/v1` version line.

### 4.7 `apps/control-plane/openapi/control-plane.openapi.json`

Add two GET operations:

- `/v1/metrics/tenants/{tenantId}/audit-records`
- `/v1/metrics/workspaces/{workspaceId}/audit-records`

Add the necessary schemas for the collection envelope and item projection.

Each route should include:

- `X-API-Version`
- `X-Correlation-Id`
- tenant/workspace path parameter
- declared audit filter query params
- `429`, `431`, `504`
- `400` and `403`

### 4.8 Generated public API artifacts

Run the existing public API generation/validation flow so these artifacts refresh automatically:

- `services/internal-contracts/src/public-route-catalog.json`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `docs/reference/architecture/public-api-surface.md`

### 4.9 Control-plane and console modules

Add `apps/control-plane/src/observability-audit-query.mjs` with:

- route discovery helpers
- query normalization helpers
- deterministic scope validation
- console explorer view-model builders

Add `apps/web-console/src/observability-audit.mjs` as the thin console-facing adapter over the control-plane/shared contract helpers.

### 4.10 Documentation

Add/update:

- `docs/reference/architecture/observability-audit-query-surface.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-02.md`

Document the T03 surface clearly and restate that export/masking/correlation are deferred.

---

## 5. Data, Metadata, and Infrastructure Considerations

- No new runtime storage schema is introduced in this increment.
- The public response items are projections of the canonical audit event envelope already defined in T02.
- The only auth/data-model change is the new workspace-scoped audit read action and the scope-aware query propagation target.
- No Helm/OpenShift deployment changes are required because this is a contract/documentation/helper baseline.

---

## 6. Test Strategy

### 6.1 Unit tests

Add unit tests for the query-surface validator and query normalization helpers:

- valid contract returns `[]`
- missing route id violation
- missing filter violation
- pagination overflow violation
- unsupported sort error
- invalid time window error
- workspace scope mismatch error

### 6.2 Contract tests

Add contract tests that verify:

- the shared readers expose the T03 contract and its sections
- the new metrics routes exist in the OpenAPI document
- the route catalog includes both operations
- the authorization model exposes `workspace.audit.read`
- the console helper surfaces reuse the shared filter vocabulary

### 6.3 Validation commands

Run at minimum:

- `npm run validate:observability-audit-query-surface`
- `npm run validate:public-api`
- `npm run validate:authorization-model`
- targeted tests for the new unit/contract suites
- `npm run lint`
- `npm test`

---

## 7. Risks, Compatibility, and Rollback

### Risks

- Introducing a workspace audit-read permission could drift from existing workspace-role expectations if not documented clearly.
- Public API route additions could fail validation if the route catalog, family docs, and taxonomy are not regenerated together.
- Scope handling could accidentally widen tenant/workspace boundaries if normalization is too permissive.

### Compatibility

- The increment is additive to `/v1` and does not remove or change existing routes.
- Existing audit-schema and audit-pipeline contracts remain untouched semantically.

### Rollback

- If necessary, revert the branch to remove the new route definitions, contract artifact, and auth additions together.
- Because there is no data migration, rollback is file-level and low risk.

---

## 8. Recommended Implementation Sequence

1. Materialize `spec.md`, `plan.md`, and `tasks.md`.
2. Add the new T03 query-surface JSON contract.
3. Wire shared readers/accessors into `services/internal-contracts/src/index.mjs`.
4. Add the query-surface validator and CLI entry point.
5. Apply the minimum authorization-model change for `workspace.audit.read` and scope-aware audit query propagation.
6. Add the public API taxonomy resource entries and OpenAPI routes/schemas.
7. Regenerate route-catalog/family/doc artifacts with the existing generator.
8. Add the control-plane and console helpers.
9. Add docs and task-summary updates.
10. Run targeted validation/tests, then full lint/test.
11. Commit, push, open PR, monitor CI, fix if needed, and merge.

---

## 9. Done Criteria and Expected Evidence

The task is done when:

- the T03 spec/plan/tasks artifacts exist and stay bounded,
- the query-surface contract, shared readers, and validator exist,
- tenant/workspace audit query routes are present in the metrics family and route catalog,
- the authorization model exposes `workspace.audit.read`,
- console helpers consume the shared query contract,
- docs/task-summary are updated,
- all targeted validations pass,
- full `npm run lint` and `npm test` pass,
- and the branch is committed, pushed, reviewed through PR, and merged to `main`.
