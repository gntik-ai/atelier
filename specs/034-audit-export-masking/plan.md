# Implementation Plan: US-OBS-02-T04 — Audit Export and Sensitive-Data Masking

**Feature Branch**: `034-audit-export-masking`
**Spec**: `specs/034-audit-export-masking/spec.md`
**Task**: `US-OBS-02-T04`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

Deliver the bounded T04 audit-export baseline by adding:

- one machine-readable **audit export + masking contract**,
- tenant/workspace public API export routes,
- shared export request normalization and masking helpers,
- explicit export permissions,
- deterministic validation,
- console-facing export metadata,
- documentation,
- and tests.

This increment must remain below cross-system correlation, export persistence infrastructure, and end-to-end verification.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in the audit story

- `US-OBS-02-T01` defines the common audit pipeline.
- `US-OBS-02-T02` defines the canonical audit-event envelope.
- `US-OBS-02-T03` defines safe query/filter consultation.
- `US-OBS-02-T04` defines **how bounded audit evidence is exported and masked**.
- `US-OBS-02-T05` will add correlation chains.
- `US-OBS-02-T06` will verify traceability and data protection end-to-end.

### 2.2 Bounded architecture slice

```text
observability-audit-pipeline (T01)
        ↓ source of forbidden field classes and pipeline guarantees
observability-audit-event-schema (T02)
        ↓ canonical envelope reused by exported items
observability-audit-query-surface (T03)
        ↓ source of filters, sort, and scope bindings
observability-audit-export-surface (T04)
        ↓ export request/manifest/masking policy + API routes + console metadata
future correlation / verification tasks (T05–T06)
```

### 2.3 Source contracts consumed

The T04 contract and validators should align with:

- `services/internal-contracts/src/observability-audit-pipeline.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/observability-audit-query-surface.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `services/internal-contracts/src/public-api-taxonomy.json`

### 2.4 Explicit non-goals

This task will not:

- add durable export jobs, signed-download storage, or binary file delivery,
- implement evidence restore/import or replay workflows,
- add cross-system correlation graphs,
- modify the canonical audit envelope in a breaking way,
- or add the full T06 end-to-end verification layer.

---

## 3. Target Contract and API Shape

### 3.1 New contract artifact

Add `services/internal-contracts/src/observability-audit-export-surface.json` as the machine-readable source of truth.

Recommended top-level structure:

```json
{
  "version": "2026-03-28",
  "scope": "US-OBS-02-T04",
  "system": "in-atelier-observability-plane",
  "source_audit_pipeline_contract": "2026-03-28",
  "source_audit_event_schema_contract": "2026-03-28",
  "source_audit_query_surface_contract": "2026-03-28",
  "source_authorization_contract": "2026-03-24",
  "source_public_api_contract": "2026-03-26",
  "supported_export_scopes": [...],
  "request_contract": {...},
  "supported_formats": [...],
  "masking_profiles": [...],
  "sensitive_field_rules": [...],
  "response_contract": {...},
  "console_surface": {...},
  "governance": {...}
}
```

### 3.2 Export scopes

Keep the initial scope small and symmetric with T03:

- `tenant`
  - route: `exportTenantAuditRecords`
  - required permission: `tenant.audit.export`
  - binding: tenant id required, workspace id optional as narrowing only
- `workspace`
  - route: `exportWorkspaceAuditRecords`
  - required permission: `workspace.audit.export`
  - binding: workspace id required and immutable from caller context

### 3.3 Request contract

The export request must reuse T03 semantics wherever possible.

Recommended request fields:

- `format`
- `sort`
- `pageSize`
- `maskingProfileId`
- `filters` object reusing the T03 filter ids
- optional `workspaceId` for tenant-scope narrowing

Recommended defaults and bounds:

- default format: `jsonl`
- allowed formats: `jsonl`, `csv`
- default page size / export sample size: 500
- max export size: 10_000 records
- max window days: 31

### 3.4 Masking model

Define one default profile such as `default_masked` and keep it mandatory by default.

Masking behavior should:

- derive its protected field catalog from the T01 forbidden exposed fields,
- preserve the canonical envelope,
- replace protected values with a deterministic placeholder (for example `[MASKED]`),
- add export metadata showing whether masking occurred,
- list the masked field paths or categories,
- and expose record-level sensitivity indicators for console and API consumers.

### 3.5 Response / manifest envelope

Return a bounded manifest-style response rather than full download infrastructure.

Recommended response shape:

- `exportId`
- `queryScope`
- `format`
- `maskingProfileId`
- `correlationId`
- `appliedFilters`
- `itemCount`
- `maskedItemCount`
- `items`
- `generatedAt`

Each `items[]` element should include:

- the high-level canonical audit projection,
- `maskingApplied`,
- `maskedFieldRefs`,
- `sensitivityCategories`.

### 3.6 Console metadata

The contract should declare:

- supported formats and labels,
- default masking badge text,
- default profile id,
- route bindings for tenant and workspace export actions,
- empty/loading/error states for export preview,
- and which query presets are export-safe.

---

## 4. Artifact-by-Artifact Change Plan

### 4.1 `services/internal-contracts/src/observability-audit-export-surface.json` (new)

Add the machine-readable export + masking contract with source references, export scopes, request contract, format catalog, masking profiles, sensitive-field rules, manifest metadata, console metadata, and explicit T05/T06 boundaries.

### 4.2 `services/internal-contracts/src/index.mjs`

Add:

- `OBSERVABILITY_AUDIT_EXPORT_SURFACE_URL`
- cached reader state
- `readObservabilityAuditExportSurface()`
- `OBSERVABILITY_AUDIT_EXPORT_SURFACE_VERSION`
- accessors:
  - `listAuditExportScopes()`
  - `getAuditExportScope(scopeId)`
  - `getAuditExportRequestContract()`
  - `listAuditExportFormats()`
  - `getAuditExportFormat(formatId)`
  - `listAuditExportMaskingProfiles()`
  - `getAuditExportMaskingProfile(profileId)`
  - `getAuditExportSensitiveFieldRules()`
  - `getAuditExportResponseContract()`
  - `getAuditExportConsoleSurface()`

### 4.3 `scripts/lib/observability-audit-export-surface.mjs` (new)

Add helper exports:

- `readObservabilityAuditExportSurface()`
- `readObservabilityAuditPipeline()`
- `readObservabilityAuditQuerySurface()`
- `readObservabilityAuditEventSchema()`
- `readAuthorizationModel()`
- `readPublicRouteCatalog()`
- `collectAuditExportSurfaceViolations(contract, dependencies)`

Deterministic validation should cover at minimum:

1. version/source-contract alignment
2. tenant and workspace export scopes both exist
3. expected route operation ids exist in the route catalog
4. required permission ids exist in the authorization model
5. required format ids and media types exist
6. default masking profile exists
7. sensitive field rules cover all T01 forbidden exposed fields
8. export filters remain aligned with the T03 query filter ids
9. governance preserves T05/T06 boundaries

### 4.4 `scripts/validate-observability-audit-export-surface.mjs` (new)

Add the CLI validator entry point and wire it into `package.json` and `validate:repo`.

### 4.5 `services/internal-contracts/src/authorization-model.json`

Make the minimum auth changes needed for bounded audit export:

- add `tenant.audit.export` to tenant resource actions
- add `workspace.audit.export` to workspace resource actions
- add `workspace.audit.export` to workspace delegable actions
- grant export permissions only to roles already suitable for evidence export:
  - platform admin / platform auditor
  - tenant owner / tenant admin
  - workspace owner / workspace admin / workspace auditor
- do not grant export to viewer roles in this increment
- add or extend one propagation target for `audit_export_context` with correlation, query scope, format, and masking profile metadata

### 4.6 `services/internal-contracts/src/public-api-taxonomy.json`

Add resource-taxonomy entries for:

- `tenant_audit_export` → authorization resource `tenant`
- `workspace_audit_export` → authorization resource `workspace`

Keep the feature additive within the existing metrics family and current `/v1` version line.

### 4.7 `apps/control-plane/openapi/control-plane.openapi.json`

Add two POST operations:

- `/v1/metrics/tenants/{tenantId}/audit-exports`
- `/v1/metrics/workspaces/{workspaceId}/audit-exports`

Add the necessary schemas for:

- `AuditExportRequest`
- `AuditExportFilterSet`
- `AuditExportManifest`
- `AuditExportedRecord`
- `AuditRecordMaskingSummary`

Each route should include:

- `X-API-Version`
- `X-Correlation-Id`
- `Idempotency-Key`
- tenant/workspace path parameter
- `400`, `403`, `409`, `413`, `422`, `429`, `431`, `504`
- additive `metrics` family metadata and route annotations

### 4.8 Generated public API artifacts

Run the existing public API generation flow so these artifacts refresh automatically:

- `services/internal-contracts/src/public-route-catalog.json`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `docs/reference/architecture/public-api-surface.md`

### 4.9 `apps/control-plane/src/observability-audit-export.mjs` (new)

Add shared helper functions for API/backend logic:

- `normalizeAuditExportRequest(scopeId, context, input)`
- `applyAuditExportMasking(record, profileId)`
- `buildAuditExportManifest(scopeId, context, input)`
- `exportTenantAuditRecordsPreview(context, input)`
- `exportWorkspaceAuditRecordsPreview(context, input)`
- `listAuditExportRoutes()`
- `buildAuditExportConsoleView(options)`

Validation responsibilities in this module:

- scope binding enforcement
- allowed format enforcement
- page-size / window bounds
- masking-profile existence
- deterministic masking over protected fields
- route and console metadata reuse from the shared contract

### 4.10 `apps/web-console/src/observability-audit-export.mjs` (new)

Add the thin console adapter over the shared export helpers so UI consumers reuse the same route metadata, format labels, masking badges, and preset-safe export defaults.

### 4.11 Documentation

Add/update:

- `docs/reference/architecture/observability-audit-export-surface.md` (new)
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-02.md`

Document the bounded export surface, masking policy, permissions, scope rules, and explicit boundaries to T05/T06.

### 4.12 Tests

Add:

- `tests/unit/observability-audit-export-surface.test.mjs`
- `tests/contracts/observability-audit-export-surface.contract.test.mjs`

Unit coverage should include:

- invalid scope widening
- invalid format
- page-size/window violations
- missing masking profile
- masking of protected fields
- unmasked handling of safe fields

Contract coverage should include:

- reader/accessor exposure from `index.mjs`
- permission existence and role-grant expectations
- route existence in the generated route catalog
- filter reuse alignment with T03
- sensitive-field coverage alignment with the T01 forbidden field catalog
- documentation discoverability

---

## 5. Data, Metadata, and Policy Decisions

### 5.1 Export identity

Treat the response as a bounded export preview/manifest, not a persisted job. Generate one deterministic `exportId` from scope + correlation + format + timestamp placeholder or provided nonce-like input.

### 5.2 Format policy

Support only:

- `jsonl` for machine-readable audit evidence
- `csv` for governance review and spreadsheet handoff

Do not add binary archive formats or bundle signing in this increment.

### 5.3 Masking policy

Map the T01 forbidden fields to T04 sensitive field rules. Recommended first-pass categories:

- `credential_material` → password, secret, token, authorization header, connection string
- `provider_locator` → raw hostname, raw endpoint, object key, raw topic name

Each category should define:

- field refs / aliases
- replacement semantics
- policy reason

### 5.4 Query reuse

Do not create a second filtering vocabulary. Reuse the T03 filter ids as the request body filter keys so export and query stay aligned.

### 5.5 Audit of the export action itself

Keep this incremental: the manifest should preserve correlation and actor metadata needed for later export-action auditing, but this task should not add a new runtime exporter or self-audit event ingestion flow beyond preview metadata.

---

## 6. Test and Validation Strategy

### 6.1 Targeted validation

Required targeted checks:

- `npm run validate:observability-audit-export-surface`
- `npm run validate:authorization-model`
- `npm run generate:public-api`
- `npm run validate:public-api`

### 6.2 Targeted tests

Required targeted suites:

- `node --test tests/unit/observability-audit-export-surface.test.mjs`
- `node --test tests/contracts/observability-audit-export-surface.contract.test.mjs`

### 6.3 Full repo gates

Before delivery:

- `npm run lint`
- `npm test`

This keeps the increment aligned with the repo’s established unattended-delivery standard.

---

## 7. Risks, Compatibility, Rollback, and Security

### 7.1 Compatibility

All changes must be additive:

- no breaking rename of the canonical audit envelope
- no breaking change to the T03 query routes
- no widening of viewer permissions
- no dependency on durable export infrastructure

### 7.2 Rollback posture

Rollback is straightforward because the increment is contract/helper/docs/test additive. Reverting the T04 files and route additions restores the previous T03-only consultation baseline.

### 7.3 Security posture

The critical security requirement is that protected fields never escape the shared masking policy. Tests and validator logic must treat missing sensitive-field coverage as a deterministic failure.

### 7.4 Operational risk

If the OpenAPI shapes and route catalog drift from the new export contract, the console and public API docs will diverge. Regenerating public API artifacts is therefore mandatory in this increment.

---

## 8. Recommended Execution Sequence

1. Materialize `spec.md`, `plan.md`, and `tasks.md` for T04.
2. Add the new export-surface contract and `index.mjs` accessors.
3. Add validator library + CLI and package wiring.
4. Update the authorization model and propagation target.
5. Add public API taxonomy + OpenAPI export routes and schemas.
6. Regenerate route catalog / metrics family / public API docs.
7. Add shared control-plane and console helpers.
8. Add architecture docs and task-summary updates.
9. Add unit + contract tests.
10. Run targeted validation, then `npm run lint`, then `npm test`.
11. Commit, push, open PR, monitor CI, fix regressions, merge, and advance backlog.

---

## 9. Definition of Done / Expected Evidence

The task is done when all of the following are true:

- `specs/034-audit-export-masking/{spec,plan,tasks}.md` are materialized.
- `services/internal-contracts/src/observability-audit-export-surface.json` exists and validates.
- `services/internal-contracts/src/index.mjs` exposes the new reader and accessors.
- `authorization-model.json` contains the new bounded export permissions and propagation target.
- `control-plane.openapi.json` exposes the tenant/workspace audit export routes and additive schemas.
- generated public API artifacts are refreshed.
- shared backend/console export helpers exist and apply deterministic masking.
- docs are updated and discoverable.
- unit and contract tests exist and pass.
- `npm run lint` and `npm test` pass.
- the branch is committed, pushed, reviewed via PR, CI is green, and the change is merged to `main`.
