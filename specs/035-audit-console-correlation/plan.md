# Implementation Plan: US-OBS-02-T05 — Console-Initiated Audit Correlation

**Feature Branch**: `035-audit-console-correlation`
**Spec**: `specs/035-audit-console-correlation/spec.md`
**Task**: `US-OBS-02-T05`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

Deliver the bounded T05 audit-correlation baseline by adding:

- one machine-readable **audit correlation surface**,
- tenant/workspace public API correlation routes,
- explicit correlation permissions,
- shared correlation request normalization and trace-building helpers,
- deterministic validation against existing audit and internal-contract baselines,
- console-facing trace metadata,
- documentation,
- and tests.

This increment must remain below T06 end-to-end verification, case-management workflows, runtime replay/remediation, and new instrumentation work.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in the audit story

- `US-OBS-02-T01` defines the common audit pipeline.
- `US-OBS-02-T02` defines the canonical audit-event envelope.
- `US-OBS-02-T03` defines safe query/filter consultation.
- `US-OBS-02-T04` defines export + masking.
- `US-OBS-02-T05` defines **how console-initiated actions are correlated with real downstream system changes**.
- `US-OBS-02-T06` will validate traceability and data protection end to end.

### 2.2 Bounded architecture slice

```text
console action / control API acceptance
        ↓ correlation_id from T02 + authorization/context propagation
canonical audit records (T02/T03/T04)
        ↓ linked by correlation_id + audit_record_id
internal downstream contract results/events
        ↓ normalized into one bounded trace model
observability-audit-correlation-surface (T05)
        ↓ route bindings + console view + masking-safe projections
verification and recovery evidence (T06 and later)
```

### 2.3 Source contracts consumed

The T05 contract and validators should align with:

- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/observability-audit-query-surface.json`
- `services/internal-contracts/src/observability-audit-export-surface.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/internal-service-map.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `services/internal-contracts/src/public-api-taxonomy.json`

### 2.4 Explicit non-goals

This task will not:

- add full T06 end-to-end verification suites,
- introduce platform-wide search or cross-tenant correlation browsing,
- add replay, repair, or rollback automation,
- change the canonical audit envelope or T03/T04 route semantics in a breaking way,
- or add durable investigation/case-management infrastructure.

---

## 3. Target Contract and API Shape

### 3.1 New contract artifact

Add `services/internal-contracts/src/observability-audit-correlation-surface.json` as the machine-readable source of truth.

Recommended top-level structure:

```json
{
  "version": "2026-03-28",
  "scope": "US-OBS-02-T05",
  "system": "in-atelier-observability-plane",
  "source_audit_event_schema_contract": "2026-03-28",
  "source_audit_query_surface_contract": "2026-03-28",
  "source_audit_export_surface_contract": "2026-03-28",
  "source_authorization_contract": "2026-03-24",
  "source_internal_service_map_contract": "2026-03-25",
  "source_public_api_contract": "2026-03-26",
  "supported_trace_scopes": [...],
  "request_contract": {...},
  "trace_statuses": [...],
  "timeline_phases": [...],
  "downstream_trace_sources": [...],
  "response_contract": {...},
  "console_surface": {...},
  "governance": {...}
}
```

### 3.2 Correlation scopes

Keep the initial scope small and symmetric with T03/T04:

- `tenant`
  - route: `getTenantAuditCorrelation`
  - required permission: `tenant.audit.correlate`
  - binding: tenant id required; correlation id required
- `workspace`
  - route: `getWorkspaceAuditCorrelation`
  - required permission: `workspace.audit.correlate`
  - binding: workspace id required; correlation id required; tenant attribution inherited from workspace context

### 3.3 Request contract

Use one simple bounded lookup model:

- required path `correlationId`
- optional `includeRecords` flag
- optional `includeEvidence` flag
- optional bounded `maxItems` for timeline projections
- default include behavior enabled so the first trace is useful without extra toggles

### 3.4 Trace states and phases

Define stable status vocabulary:

- `complete`
- `partial`
- `broken`
- `not_found`

Define a bounded phase vocabulary such as:

- `console_initiation`
- `control_plane_execution`
- `downstream_system_effect`
- `audit_persistence`

These phases must remain descriptive enough for API/console consumers but small enough to stay stable.

### 3.5 Downstream source catalog

Declare the minimum internal contract sources the trace model can reference, for example:

- `iam_admin_result`
- `mongo_admin_result`
- `kafka_admin_result`
- `postgres_data_change_event`
- `storage_object_event`
- `openwhisk_activation_event`

The validator should confirm these internal contracts still exist and still carry the required correlation/audit-link metadata.

### 3.6 Response envelope

Return one bounded trace response instead of a search/list surface.

Recommended response shape:

- `correlationId`
- `queryScope`
- `traceStatus`
- `startedAt`
- `completedAt`
- `subsystems`
- `timeline`
- `auditRecords`
- `evidencePointers`
- `missingLinks`
- `consoleSummary`

Each timeline item should expose:

- `nodeId`
- `phase`
- `eventTimestamp`
- `originSurface`
- `subsystemId`
- `resourceType`
- `actionId`
- `outcome`
- `auditRecordId`
- masking metadata if a projected record is included

### 3.7 Console metadata

The contract should declare:

- correlation scopes and route bindings,
- status labels,
- phase labels,
- default timeline grouping,
- empty/loading/error state ids,
- and whether evidence pointers are shown by default.

---

## 4. Artifact-by-Artifact Change Plan

### 4.1 `services/internal-contracts/src/observability-audit-correlation-surface.json` (new)

Add the machine-readable correlation contract with source references, trace scopes, request metadata, status vocabulary, phase vocabulary, downstream contract-source catalog, response metadata, console metadata, and explicit T06 boundary notes.

### 4.2 `services/internal-contracts/src/index.mjs`

Add:

- `OBSERVABILITY_AUDIT_CORRELATION_SURFACE_URL`
- cached reader state
- `readObservabilityAuditCorrelationSurface()`
- `OBSERVABILITY_AUDIT_CORRELATION_SURFACE_VERSION`
- accessors:
  - `listAuditCorrelationScopes()`
  - `getAuditCorrelationScope(scopeId)`
  - `getAuditCorrelationRequestContract()`
  - `listAuditCorrelationStatuses()`
  - `getAuditCorrelationStatus(statusId)`
  - `listAuditCorrelationTimelinePhases()`
  - `getAuditCorrelationTimelinePhase(phaseId)`
  - `listAuditCorrelationSourceContracts()`
  - `getAuditCorrelationResponseContract()`
  - `getAuditCorrelationConsoleSurface()`

### 4.3 `scripts/lib/observability-audit-correlation-surface.mjs` (new)

Add helper exports:

- `readObservabilityAuditCorrelationSurface()`
- `readObservabilityAuditEventSchema()`
- `readObservabilityAuditQuerySurface()`
- `readObservabilityAuditExportSurface()`
- `readAuthorizationModel()`
- `readInternalServiceMap()`
- `readPublicRouteCatalog()`
- `readPublicApiTaxonomy()`
- `collectAuditCorrelationSurfaceViolations(contract, dependencies)`

Deterministic validation should cover at minimum:

1. version/source-contract alignment
2. tenant and workspace trace scopes both exist
3. expected route operation ids exist in the route catalog
4. required permission ids exist in the authorization model
5. status vocabulary and phase vocabulary coverage
6. required downstream contract-source ids exist in the internal service map
7. required downstream contract-source fields preserve correlation and audit linkage
8. T04 masking compatibility for projected records/evidence
9. governance preserves the T06 verification boundary

### 4.4 `scripts/validate-observability-audit-correlation-surface.mjs` (new)

Add the CLI validator entry point and wire it into `package.json` and `validate:repo`.

### 4.5 `services/internal-contracts/src/authorization-model.json`

Make the minimum auth changes needed for bounded audit correlation:

- add `tenant.audit.correlate` to tenant resource actions
- add `workspace.audit.correlate` to workspace resource actions
- add `workspace.audit.correlate` to workspace delegable actions
- grant correlation permissions only to roles suitable for end-to-end operational traceability:
  - platform admin / platform auditor
  - tenant owner / tenant admin
  - workspace owner / workspace admin / workspace operator / workspace auditor
- do not grant correlation to viewer roles in this increment
- add or extend one propagation target for `audit_correlation_context` with correlation id, query scope, inclusion flags, and caller scope metadata

### 4.6 `services/internal-contracts/src/public-api-taxonomy.json`

Add resource-taxonomy entries for:

- `tenant_audit_correlation` → authorization resource `tenant`
- `workspace_audit_correlation` → authorization resource `workspace`

Keep the feature additive within the existing metrics family and current `/v1` version line.

### 4.7 `apps/control-plane/openapi/control-plane.openapi.json`

Add two GET operations:

- `/v1/metrics/tenants/{tenantId}/audit-correlations/{correlationId}`
- `/v1/metrics/workspaces/{workspaceId}/audit-correlations/{correlationId}`

Add the necessary schemas for:

- `AuditCorrelationTrace`
- `AuditCorrelationTimelineEntry`
- `AuditCorrelationEvidencePointer`
- `AuditCorrelationConsoleSummary`

Each route should include:

- `X-API-Version`
- `X-Correlation-Id`
- tenant/workspace path parameter
- correlation-id path parameter
- bounded inclusion query parameters
- additive `metrics` family metadata and route annotations
- response codes `200`, `400`, `403`, `404`, `429`, `431`, `504`

### 4.8 Generated public API artifacts

Run the existing public API generation flow so these artifacts refresh automatically:

- `services/internal-contracts/src/public-route-catalog.json`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `docs/reference/architecture/public-api-surface.md`

### 4.9 `apps/control-plane/src/observability-audit-correlation.mjs` (new)

Add shared helper functions for API/backend logic:

- `normalizeAuditCorrelationRequest(scopeId, context, input)`
- `buildAuditCorrelationTrace(scopeId, context, input)`
- `traceTenantAuditCorrelation(context, input)`
- `traceWorkspaceAuditCorrelation(context, input)`
- `listAuditCorrelationRoutes()`
- `buildAuditCorrelationConsoleView(options)`

Validation responsibilities in this module:

- scope binding enforcement
- correlation-id presence and inclusion-option normalization
- bounded timeline-size behavior
- trace-status derivation (`complete` / `partial` / `broken` / `not_found`)
- masking reuse from T04 for correlated record projections
- safe evidence-pointer summarization
- route and console metadata reuse from the shared contract

### 4.10 `apps/web-console/src/observability-audit-correlation.mjs` (new)

Add the thin console adapter over the shared correlation helpers so UI consumers reuse the same route metadata, status labels, phase labels, and trace projection behavior.

### 4.11 Documentation

Add/update:

- `docs/reference/architecture/observability-audit-correlation-surface.md` (new)
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-02.md`

Document the bounded correlation surface, status model, permission boundaries, downstream source contracts, masking posture, and explicit boundary to T06.

### 4.12 Tests

Add:

- `tests/unit/observability-audit-correlation-surface.test.mjs`
- `tests/contracts/observability-audit-correlation-surface.contract.test.mjs`

Unit coverage should include:

- invalid scope widening
- missing correlation id
- invalid max-items bound
- trace-status derivation for complete/partial/broken/not_found
- masking of protected detail fields inside correlated record projections
- console-view metadata exposure

Contract coverage should include:

- reader/accessor exposure from `index.mjs`
- permission existence and role-grant expectations
- route existence in the generated route catalog
- internal-service-map source alignment
- masking compatibility with T04
- documentation discoverability

---

## 5. Data, Metadata, and Policy Decisions

### 5.1 Correlation identity

Treat the response as a bounded lookup for one published `correlationId`, not as a search or case-management object. One response should describe one logical administrative chain.

### 5.2 Status policy

Use explicit trace statuses:

- `complete` when initiation, downstream effect, and audit linkage are all present
- `partial` when the trace exists but one or more expected links are missing
- `broken` when the chain clearly failed to connect initiation to downstream effect
- `not_found` when no scoped evidence exists for the requested correlation id

### 5.3 Timeline policy

Preserve order by event timestamp for the returned bounded trace. Do not promise cross-tenant or global ordering beyond one correlation chain.

### 5.4 Downstream-source policy

The downstream-source catalog should rely on already-published internal contract ids. This keeps the T05 model grounded in existing system contracts instead of inventing ad hoc trace source names.

### 5.5 Masking policy reuse

Do not create a second masking vocabulary. Reuse the T04 protected-field rules and record indicators so correlation and export surfaces stay aligned.

### 5.6 Audit of the correlation lookup itself

Keep this incremental: preserve request correlation and scope metadata through the propagation model, but do not add new runtime self-audit flows solely for correlation lookup in this increment.

---

## 6. Test and Validation Strategy

### 6.1 Targeted validation

Required targeted checks:

- `npm run validate:observability-audit-correlation-surface`
- `npm run validate:authorization-model`
- `npm run generate:public-api`
- `npm run validate:public-api`

### 6.2 Targeted tests

Required targeted suites:

- `node --test tests/unit/observability-audit-correlation-surface.test.mjs`
- `node --test tests/contracts/observability-audit-correlation-surface.contract.test.mjs`

### 6.3 Full repo gates

Before delivery:

- `npm run lint`
- `npm test`

---

## 7. Risks, Compatibility, Rollback, and Security

### 7.1 Compatibility

All changes must be additive:

- no breaking rename of the canonical audit envelope
- no breaking change to the T03 query routes or T04 export routes
- no widening of viewer permissions
- no dependency on full T06 verification infrastructure

### 7.2 Rollback posture

Rollback is straightforward because the increment is contract/helper/docs/test additive. Reverting the T05 files and route additions restores the previous T04 audit consultation/export baseline.

### 7.3 Security posture

The critical security requirement is that deeper traceability does not reveal secrets or raw provider-native locators. Missing masking compatibility or overly broad permissions must be treated as deterministic failures.

### 7.4 Operational risk

If the T05 route catalog, authorization model, and internal-service-map references drift from the published correlation contract, API, console, and validation behavior will diverge. Public API regeneration and strict validator coverage are therefore mandatory.

---

## 8. Recommended Execution Sequence

1. Materialize `spec.md`, `plan.md`, and `tasks.md` for T05.
2. Add the new correlation-surface contract and `index.mjs` accessors.
3. Add validator library + CLI and package wiring.
4. Update the authorization model and propagation target.
5. Add public API taxonomy + OpenAPI correlation routes and schemas.
6. Regenerate route catalog / metrics family / public API docs.
7. Add shared control-plane and console helpers.
8. Add architecture docs and task-summary updates.
9. Add unit + contract tests.
10. Run targeted validation, then `npm run lint`, then `npm test`.
11. Commit, push, open PR, monitor CI, fix regressions, merge, and advance the backlog.

---

## 9. Definition of Done / Expected Evidence

The task is done when all of the following are true:

- `specs/035-audit-console-correlation/{spec,plan,tasks}.md` are materialized.
- `services/internal-contracts/src/observability-audit-correlation-surface.json` exists and validates.
- `services/internal-contracts/src/index.mjs` exposes the new reader and accessors.
- `authorization-model.json` contains the new bounded correlation permissions and propagation target.
- `control-plane.openapi.json` exposes the tenant/workspace audit-correlation routes and additive schemas.
- generated public API artifacts are refreshed.
- shared backend/console correlation helpers exist and derive bounded trace status and safe evidence pointers.
- docs are updated and discoverable.
- unit and contract tests exist and pass.
- `npm run lint` and `npm test` pass.
- the branch is committed, pushed, reviewed via PR, CI is green, and the change is merged to `main`.
