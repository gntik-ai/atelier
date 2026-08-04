# Change: Make observability quota, usage, overview, and audit success bodies conform

## Why

C-01 / OBS-CONTRACT-01 is a confirmed observability contract defect. The real control-plane
handlers behind the tenant and workspace quota-posture, quota-usage overview, usage-snapshot,
audit-records, and audit-export operations return legacy/minimal shapes that do not validate against
their published `200` OpenAPI schemas. Concretely, on the confirmed audit baseline:

- `getTenantQuotaPosture` / `getWorkspaceQuotaPosture` return
  `{ evaluatedAt, dimensions, hardLimitBreaches }`, omitting the `QuotaPosture` required identifiers
  (`postureId`, `queryScope`, `tenantId`, `workspaceId`, `usageSnapshotTimestamp`,
  `observationWindow`, `overallStatus`, `degradedDimensions`, `softLimitBreaches`,
  `warningDimensions`, `evaluationAudit`) and most `QuotaDimensionPosture` fields.
- `getTenantQuotaUsageOverview` / `getWorkspaceQuotaUsageOverview` return
  `overallPosture: "healthy" | "critical"` — values outside the published posture enum — with
  posture-shaped dimensions that violate the closed `QuotaUsageDimensionView` and omit every other
  closed `TenantQuotaUsageOverview` / `WorkspaceQuotaUsageOverview` required field.
- `getTenantUsageSnapshot` / `getWorkspaceUsageSnapshot` return `{ measuredAt, dimensions }` instead
  of the `UsageSnapshot` shape keyed on `snapshotTimestamp` and per-dimension `value`.
- `listTenantAuditRecords` / `listWorkspaceAuditRecords` return `{ items, page }` with
  `page.nextCursor: null` (the schema types the cursor as a string) and omit the required
  `queryScope`, `appliedFilters`, `availableFilters`, and `consoleHints`.
- `exportTenantAuditRecords` / `exportWorkspaceAuditRecords` emit an inline fallback manifest that
  omits the required `format`, `maskingProfileId`, and `correlationId`, and mask by replacing the
  object-typed `detail` with a string.

The root cause is that the OpenAPI/full contracts, the local runtime serializers in
`apps/control-plane/metrics-handlers.mjs`, the audit row mapper in
`apps/control-plane/audit-store.mjs`, and the loose/mocked web-console types evolved in parallel with
no real-handler→schema test binding them. The single audit row projection (`auditRowToRecord`) is
the shared seam that breaks both the audit-records `AuditRecord` items and the audit-export
`AuditExportedRecord` items: it emits an actor without `actorType`, a scope without `scopeMode`, an
empty `resource`, an origin without `emittingService`, a `result.outcome` of `unknown`/`error`
outside the enum, and a `null` `correlationId`.

Platform operators (P3), workspace owners/administrators (P7), and workspace operators/application
DevOps users (P9) are the primary consumers of the Quotas and Observability pages and need truthful,
schema-valid quota, usage, and audit reads. Privileged platform/superadmin administrators (P1) and
security/compliance auditors (P4) need the same conformant reads under their existing read
authorization. Scoped viewers/auditors (P10) must stay read-only. Adjacent service workloads (P12)
gain no new grant, and an actor from another tenant (P13) remains the adversarial isolation control.

## What Changes

- Make every `200` response of the tenant and workspace quota-posture, quota-usage overview,
  usage-snapshot, audit-records, and audit-export operations validate exactly against its current
  published schema — required fields, types, enums, and `additionalProperties` — for populated,
  empty, and degraded results. The C-04 workspace metric-series operation is already corrected and is
  out of scope.
- Replace the legacy/minimal producers with backend serializers that emit only the schema's allowed
  fields (an allow-list projection). Do not loosen OpenAPI, add aliases, or admit extra properties
  where a schema is closed (`TenantQuotaUsageOverview`, `WorkspaceQuotaUsageOverview`,
  `QuotaUsageDimensionView`, and their nested closed objects).
- Bind every response to `ctx.resolvedScope` set by the existing `guarded` wrapper: `queryScope`,
  `tenantId`, and `workspaceId` come from the resolved scope, never from raw path or identity
  substitution. Tenant overviews report `queryScope: "tenant"` with a null `workspaceId`; workspace
  overviews report `queryScope: "workspace"` with the resolved workspace id.
- Degrade conservatively through contractual enums and fields. When the current runtime returns no
  limit/consumption evidence (including its existing swallowed provider-error path), report
  `evidence_unavailable` rather than fabricating `within_limit`, `healthy`, or zero consumption;
  mark each returned stale/partial dimension `degraded` without hiding a real threshold breach.
- Project audit rows into contractual `actor`, `scope`, `resource`, `result`, and `origin` objects
  with honest, non-sensitive fallbacks for legacy rows (a valid `actorType`, `scopeMode`,
  `subsystemId`/`resourceType`, `emittingService`, and an in-enum `result.outcome` that does not
  assert an unverified success), and preserve field masking. Emit empty collections as schema-valid
  bodies (`items: []`, a `page` without a `null` cursor, and contractual `appliedFilters`,
  `availableFilters`, `consoleHints`, and `queryScope`).
- Make the audit-export primary path and the inline fallback share one conformant manifest and
  record projection so both emit a valid `AuditExportManifest` (with `format`, `maskingProfileId`,
  `correlationId`) whose items are valid `AuditExportedRecord`s with an object-typed masked `detail`
  and masking metadata.
- Update the web-console client, types, and tests to consume the canonical fields
  (`snapshotTimestamp`, `currentUsage`, `value`, `posture`) while remaining visually and functionally
  compatible with the existing Quotas and Observability pages.
- Verify that the control-plane image still packages the shared executor and internal-contracts
  projections so the primary conformant path is reachable, and that the inline fallback is also
  conformant. No cluster deployment is performed by this change.
- Add an exact Ajv real-handler→schema contract test plus focused backend and console tests, and a
  focused observability reference update.

## Personas and Observable Outcomes

- P3, P7, and P9 receive schema-valid quota posture, usage, overview, and audit reads for the
  resolved scope, with real values where they exist and honest degradation otherwise.
- P1 and P4 receive the same conformant reads under their existing read authorization; this change
  grants neither any new operation.
- P10 remains read-only: it receives the corrected bodies only where already authorized and gains no
  mutation, export side effect, or cross-scope capability.
- P12 gains no new grant or credential path; existing denials remain unchanged.
- P13 cannot use a foreign tenant or workspace identifier to read another scope; the existing
  foreign-workspace `403` and unknown-workspace `404` outcomes are preserved and expose no scope
  data.
- When evidence is unavailable, every authorized caller receives an honestly degraded, still
  schema-valid body rather than a fabricated healthy posture or a schema-invalid success body.

## Non-Goals

- No C-02 global `ErrorResponse` repair, no C-09 filter/cursor/sort semantics, no C-10 audit-export
  request-format or page-size semantics, no C-16 tenant-existence behavior, and no C-04 workspace
  metric-series change.
- No OpenAPI loosening, alias, or schema relaxation, and no new or changed route, method, operation
  id, status code, or rate-limit class.
- No new data persistence and no new quota, audit, or metering side effect. The response
  `evaluationAudit`, `accessAudit`, and `calculationCycle` blocks are response projections, not
  persisted events.
- No authentication, role, permission, membership, superadmin, or gateway-policy change; existing
  authorization and tenant/workspace isolation are preserved unchanged.
- No console page, navigation, interaction, or visual redesign beyond consuming the canonical fields;
  the loose audit reader keeps rendering while showing contractual values.
- No shared, staging, or production deployment and no Helm/chart product change. A later-authorized
  disposable kind run is validation-only and changes no deployment source of truth.
- No remediation of any audit finding other than C-01.

## Exit Criteria

- Every `200` body of the ten in-scope operations validates against its published schema
  (`QuotaPosture`, `TenantQuotaUsageOverview`, `WorkspaceQuotaUsageOverview`, `UsageSnapshot`,
  `AuditRecordCollectionResponse`, `AuditExportManifest`) for populated, empty, and degraded results,
  including closed-object `additionalProperties` checks.
- `queryScope`, `tenantId`, and `workspaceId` always reflect `ctx.resolvedScope`; tenant overviews
  carry a null `workspaceId` and workspace overviews carry the resolved workspace id.
- Unresolved evidence degrades to `evidence_unavailable`/`evidence_degraded` posture and
  `unavailable`/`degraded` freshness with no fabricated `within_limit`, `healthy`, or zero-usage
  values; an empty adapter result reports `policiesConfigured: false` conservatively because the
  current adapter does not distinguish unconfigured from unavailable.
- Audit records and export items carry contractual `actor`, `scope`, `resource`, `result`, and
  `origin`, with honest non-sensitive fallbacks for legacy rows, masking preserved, and an in-enum
  `result.outcome`.
- The audit-export primary and inline-fallback paths emit the same conformant manifest and record
  projection; the fallback never exposes more than the profile-masked path.
- Empty collections return schema-valid bodies with no `null` page cursor and contractual
  `appliedFilters`, `availableFilters`, and `consoleHints`.
- The web console reads `snapshotTimestamp`, `currentUsage`, `value`, and `posture` and renders the
  Quotas and Observability pages with unchanged behavior.
- Existing authentication, authorization, foreign-workspace `403`, unknown-workspace `404`, GET/read
  semantics, and the absence of a domain audit event or quota mutation are preserved.
- The control-plane image is confirmed to package the shared executor/internal-contracts
  projections; the inline fallback is confirmed conformant.
- `npm run validate:openapi`, `npm run validate:public-api`, the exact Ajv real-handler contract
  test, focused backend/console tests, existing auth/black-box regressions, markdownlint, and
  `git diff --check` pass, and `openspec validate fix-c01-observability-success-schemas --strict`
  passes.

## Risks and Rollback

The main isolation risk is deriving a scope identifier from an untrusted path or identity value
instead of `ctx.resolvedScope`; reusing the existing `guarded` resolution/authorization boundary and
cross-tenant tests bounds it. The main honesty risk is masking a real evidence gap as a healthy
posture; the degradation requirements and dedicated empty/degraded tests bound it. The main masking
risk is the audit-export fallback leaking sensitive detail; sharing one conformant, conservatively
masking projection with the primary path bounds it.

Rollback is a revert of the serializers, the audit row projection, the console client/types/tests,
the contract/focused tests, and this OpenSpec change. It requires no data or datastore migration and
introduces no persisted state. Rollback reintroduces the C-01 non-conforming bodies.
