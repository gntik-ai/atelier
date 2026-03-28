# Feature Specification: US-OBS-02-T03 — Queryable Audit Surfaces

**Feature Branch**: `033-observability-audit-query-surfaces`
**Task**: `US-OBS-02-T03`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación
**Requirements traceability**: RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020
**Dependencies**: US-ARC-03, US-PRG-03
**Intra-story dependencies**: US-OBS-02-T01, US-OBS-02-T02
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-02-T01` defined the common audit pipeline and `US-OBS-02-T02` defined the canonical audit-event envelope, but the platform still lacks one bounded way to **query audit records safely from the public API and the administrative console**.

Without a query surface:

- tenant owners and workspace operators cannot inspect what happened without subsystem-specific tooling,
- security and SRE workflows must infer filters from raw provider logs,
- downstream export and masking work would have no stable request/response contract to extend,
- and multi-tenant scope isolation for audit reads would remain underspecified.

This task delivers the minimum functional capability for **filterable audit consultation**. It defines the query contract, the public API routes, the console-facing surface metadata, pagination and filter rules, and the scope/permission boundaries for tenant-scoped and workspace-scoped audit reads.

This task does **not** implement export bundles or download formats (`US-OBS-02-T04`), sensitive-data masking execution (`US-OBS-02-T04`), cross-system causation chains (`US-OBS-02-T05`), or end-to-end traceability verification (`US-OBS-02-T06`). It only establishes the bounded query/read surface those later tasks must build on.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Tenant owners and tenant admins** need tenant-scoped audit queries so they can review administrative actions across all workspaces belonging to one tenant.
- **Workspace owners, operators, and auditors** need workspace-scoped audit queries so they can inspect administrative activity without full tenant-wide access.
- **Security, compliance, and SRE operators** need stable filters for actor, action, outcome, subsystem, and correlation id so investigations do not depend on ad hoc provider-native log access.
- **Console authors** need one shared route and filter contract so the console can render an audit explorer without inventing its own audit vocabulary.

### Indirect consumers

- **Downstream T04/T05/T06 implementors** benefit because export, masking, and correlation can extend one established query contract instead of redefining request shapes.
- **Platform governance reviewers** benefit because audit reads become subject to explicit scope and permission rules instead of implicit backend behavior.

### Value delivered

- Introduces one stable way to consult audit records by tenant or workspace scope.
- Normalizes which filters are supported and how pagination/sorting behave.
- Makes console discoverability explicit through a shared query-surface contract.
- Preserves multi-tenant isolation and read permissions before export or masking work begins.

---

## 3. In-Scope Capability

### In scope

- Define a machine-readable audit query-surface contract for tenant and workspace audit reads.
- Define the supported filter vocabulary for:
  - time range,
  - subsystem,
  - action category,
  - action id,
  - outcome,
  - actor type,
  - actor id,
  - resource type,
  - resource id,
  - origin surface,
  - correlation id.
- Define pagination, cursor, limit, and sorting rules for audit queries.
- Expose public API routes for tenant-scoped and workspace-scoped audit record queries.
- Expose console-facing navigation, table-column, empty-state, and saved-filter metadata for the audit explorer surface.
- Define scope isolation and permission expectations for tenant and workspace audit reads.
- Add deterministic validation, shared readers/accessors, documentation, and tests for the query-surface baseline.

### Out of scope

- Export file generation, download workflows, or retention exports (`US-OBS-02-T04`).
- Sensitive-field masking decisions or masked/unmasked payload switching (`US-OBS-02-T04`).
- Cross-system causation graphs, provider-side correlation chains, or trace stitching (`US-OBS-02-T05`).
- Runtime audit ingestion/storage implementation details.
- Alerting, quota, or business-metric behavior unrelated to audit reads.
- Native provider log browsing or bypass routes outside the unified `/v1/*` API.

---

## 4. User Scenarios & Testing

### User Story 1 — Query tenant-wide audit records (Priority: P1)

As a tenant owner, I need to filter tenant audit records from the public API and console so that I can inspect administrative actions across the tenant without switching to subsystem-specific tooling.

**Why this priority**: Tenant-wide audit consultation is the smallest slice that delivers real governance value to product users.

**Independent Test**: A tester can inspect the contract and route catalog, call the tenant route shape, and verify that the supported filters, pagination, and response envelope are explicitly defined.

**Acceptance Scenarios**:

1. **Given** a tenant-scoped audit query, **when** a caller requests `/v1/metrics/tenants/{tenantId}/audit-records`, **then** the route requires the standard API version and correlation headers, supports the declared audit filters, and returns a paginated collection envelope.
2. **Given** a tenant owner filters by subsystem, outcome, and time window, **when** the request is normalized, **then** the resulting query stays bound to the provided `tenantId` and preserves the declared filter vocabulary only.
3. **Given** a caller tries to exceed the maximum page size or use an unsupported sort key, **when** the query is validated, **then** the request fails deterministically rather than silently widening the query.

---

### User Story 2 — Query workspace audit records with workspace-safe permissions (Priority: P1)

As a workspace operator or auditor, I need a workspace-scoped audit query surface so that I can inspect activity relevant to one workspace without needing tenant-wide access.

**Why this priority**: Multi-tenant platforms need a bounded audit read path for workspace-level operators.

**Independent Test**: A tester can inspect the route, contract, and authorization baseline and verify that workspace audit queries are modeled as a separate scope with explicit workspace-level permissions and route binding.

**Acceptance Scenarios**:

1. **Given** a workspace-scoped audit query, **when** a caller requests `/v1/metrics/workspaces/{workspaceId}/audit-records`, **then** the route is documented as workspace-scoped and uses a workspace-specific authorization action.
2. **Given** a query context for one workspace, **when** a caller attempts to pass another workspace id, **then** the query helper returns a coded scope-violation error.
3. **Given** a workspace auditor opens the console audit surface, **when** the console model is built, **then** the surface exposes workspace-safe defaults, filters, and empty-state messaging without implying tenant-wide visibility.

---

### User Story 3 — Use one stable filter vocabulary in API and console (Priority: P1)

As a console/backend implementor, I need the API and console to share one audit-filter vocabulary so that users see the same query semantics everywhere.

**Why this priority**: Divergent filter names between API and console would create drift before export and masking work lands.

**Independent Test**: A tester can inspect the shared contract and verify that the same filters and sort options are exposed through shared readers and the console model.

**Acceptance Scenarios**:

1. **Given** the query-surface contract exists, **when** a consumer inspects the filter definitions, **then** actor, action, resource, origin, outcome, correlation, and time-range filters are all declared in one place.
2. **Given** the console model is generated from the shared contract, **when** the audit explorer view is built, **then** the same supported filters and saved presets appear there without redefining them in console-only code.
3. **Given** later tasks add export or masking, **when** they extend the query flow, **then** they can reuse the existing request and response envelope rather than replacing it.

---

### User Story 4 — Keep audit reads inside explicit scope and permission boundaries (Priority: P2)

As a security reviewer, I need audit query permissions and scope bindings to be explicit so that audit consultation does not become a cross-tenant escape hatch.

**Why this priority**: Audit data is operationally sensitive even before masking work is added.

**Independent Test**: A reviewer can inspect the authorization model and query-surface contract and verify that tenant and workspace routes declare different read permissions and scope bindings.

**Acceptance Scenarios**:

1. **Given** the tenant route, **when** its query-surface metadata is inspected, **then** it requires `tenant.audit.read` and binds results to the requested tenant.
2. **Given** the workspace route, **when** its query-surface metadata is inspected, **then** it requires `workspace.audit.read` and binds results to the requested workspace.
3. **Given** a caller uses a valid correlation id filter, **when** the query is normalized, **then** the filter narrows results within the current authorized scope and never expands it.

---

## 5. Edge Cases

- What happens when the caller requests more than the declared maximum page size? The query must fail with a deterministic limit error.
- What happens when `filter[occurredAfter]` is later than `filter[occurredBefore]`? The query must fail with a deterministic invalid-window error.
- What happens when a caller provides a filter that is not in the declared vocabulary? The contract and normalization layer must reject it instead of silently ignoring it.
- What happens when the caller queries a tenant route but passes a workspace-only permission context? The request must not be treated as tenant-wide implicitly.
- What happens when no records match the filters? The API/console surface must preserve the query metadata and present an explicit empty state.
- What happens when a caller filters by `correlation_id` for a record family that spans multiple subsystems? The filter may narrow the result set, but it must not imply that full correlation workflows already exist.
- What happens when the query targets events with sensitive fields? This task only defines consultation metadata; masking rules remain deferred to `US-OBS-02-T04`.

---

## 6. Requirements

### Functional Requirements

- **FR-001**: The platform MUST define a machine-readable audit query-surface contract for tenant-scoped and workspace-scoped audit reads.
- **FR-002**: The contract MUST declare supported query scopes and map each scope to one public route operation id.
- **FR-003**: The public API MUST expose a tenant-scoped audit-record query route under `/v1/metrics/tenants/{tenantId}/audit-records`.
- **FR-004**: The public API MUST expose a workspace-scoped audit-record query route under `/v1/metrics/workspaces/{workspaceId}/audit-records`.
- **FR-005**: Audit queries MUST support cursor pagination, bounded page size, and an explicit sort vocabulary.
- **FR-006**: Audit queries MUST support filter dimensions for time range, subsystem, action category, action id, outcome, actor type, actor id, resource type, resource id, origin surface, and correlation id.
- **FR-007**: The tenant route MUST require a tenant-scoped audit-read permission and MUST remain bound to the requested tenant id.
- **FR-008**: The workspace route MUST require a workspace-scoped audit-read permission and MUST remain bound to the requested workspace id.
- **FR-009**: The console audit explorer surface MUST consume the same shared query-surface contract instead of redefining its own filter vocabulary.
- **FR-010**: The query response contract MUST expose a paginated collection envelope, the applied filters, and route/scope metadata needed by console consumers.
- **FR-011**: The query normalization logic MUST fail deterministically for scope violations, unsupported sorts, invalid time windows, or page-size overflows.
- **FR-012**: The query-surface validation logic MUST ensure the declared route operation ids exist in the public route catalog and remain aligned with the audit-event-schema and authorization-model baselines.
- **FR-013**: This increment MUST NOT introduce export payloads, download jobs, masking execution, or provider-side correlation chains.

### Key Entities

- **Audit Query Scope**: The bounded tenant or workspace context in which audit records may be queried.
- **Audit Query Filter**: One supported filter dimension with a stable parameter name and bounded semantics.
- **Audit Query Page**: The cursor-based response envelope for audit record collections.
- **Audit Explorer Surface**: The console-facing metadata for navigation, presets, table columns, and empty/error/loading states backed by the shared contract.

---

## 7. Isolation, Audit, and Security Constraints

- Tenant and workspace audit queries MUST stay within the caller’s authorized scope and must not infer broader visibility from filter choices.
- Workspace-scoped audit reads MUST be modeled with an explicit workspace audit-read action rather than overloading unrelated workspace read permissions.
- The query contract MUST preserve the canonical event fields from `US-OBS-02-T02` as the response-item baseline.
- Correlation id filters MAY narrow results, but this task MUST NOT claim end-to-end causal reconstruction before `US-OBS-02-T05`.
- The console surface MUST not imply export or unmasked sensitive-detail access before `US-OBS-02-T04`.
- Query metadata and empty states MUST remain safe to surface even when result sets are empty.

---

## 8. Success Criteria

### Measurable Outcomes

- **SC-001**: A reviewer can inspect one shared contract artifact and identify both supported audit query scopes, the filter vocabulary, pagination rules, and console-surface metadata.
- **SC-002**: Public API artifacts expose tenant-scoped and workspace-scoped audit-record routes and include them in the route catalog and generated family docs.
- **SC-003**: Shared readers/accessors expose the query scopes, filter definitions, pagination policy, and console metadata for downstream consumers.
- **SC-004**: Query helper tests demonstrate deterministic failures for scope mismatch, page-size overflow, invalid sort, and invalid time window conditions.
- **SC-005**: The task summary and architecture index clearly document that T03 establishes the query/filter surface only and leaves export, masking, and correlation execution to later tasks.

---

## 9. Assumptions and Dependencies

- The canonical event envelope from `US-OBS-02-T02` remains the response-item baseline for audit query results.
- The common audit pipeline from `US-OBS-02-T01` remains the source of subsystem coverage and action-category expectations.
- The existing metrics family under `/v1/metrics/*` remains the correct public API family for observability-oriented audit consultation.
- A new workspace-scoped permission may be introduced if needed to keep workspace audit reads explicit and reviewable.

---

## 10. Explicit Boundary to Later Tasks

This task intentionally stops after the bounded query/filter surface is defined and wired for API/console discoverability.

Later tasks remain responsible for:

- export bundles and download workflows (`US-OBS-02-T04`),
- masking and sensitive-event handling (`US-OBS-02-T04`),
- cross-system causation/correlation workflows (`US-OBS-02-T05`),
- and end-to-end traceability/data-protection verification (`US-OBS-02-T06`).
