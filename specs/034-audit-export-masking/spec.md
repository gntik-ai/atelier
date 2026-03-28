# Feature Specification: US-OBS-02-T04 — Audit Export and Sensitive-Data Masking

**Feature Branch**: `034-audit-export-masking`
**Task**: `US-OBS-02-T04`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación
**Requirements traceability**: RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020
**Dependencies**: US-ARC-03, US-PRG-03
**Intra-story dependencies**: US-OBS-02-T01, US-OBS-02-T02, US-OBS-02-T03
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-02-T01` established the common audit pipeline, `US-OBS-02-T02` fixed the canonical audit envelope, and `US-OBS-02-T03` exposed bounded consultation routes. The platform still lacks one governed way to **export audit evidence for investigations, compliance reviews, and operational handoffs without leaking sensitive data**.

Without a bounded export and masking layer:

- tenant owners and workspace operators can inspect audit evidence on screen but cannot package it for review or retention workflows,
- security and SRE teams must manually copy audit data from interactive views, which weakens repeatability and traceability,
- sensitive values embedded in audit details have no shared masking policy for exports,
- and later correlation work would inherit an underspecified evidence-sharing model.

This task delivers the minimum functional capability for **governed audit export plus deterministic sensitive-data masking**. It defines the export request/response surface, the export manifest shape, the masking policy applied to sensitive event details, the permissions required to export at tenant and workspace scope, and the shared metadata the console and API must use to communicate masked results.

This task does **not** implement cross-system causation chains (`US-OBS-02-T05`), evidence restoration or replay workflows, durable export storage infrastructure, or end-to-end traceability and data-protection verification (`US-OBS-02-T06`). It only defines and wires the bounded export + masking surface that later work can consume.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Tenant owners and tenant admins** need tenant-scoped audit exports so they can package administrative evidence across all workspaces within one tenant.
- **Workspace owners, operators, and auditors** need workspace-scoped exports for support, security review, and bounded evidence sharing without gaining tenant-wide visibility.
- **Security and SRE operators** need one repeatable export manifest with masking metadata so investigations can be handed off safely.
- **Console authors** need one shared export contract, format list, and masking vocabulary so the administrative console does not invent ad hoc evidence packaging behavior.

### Indirect consumers

- **Governance and compliance reviewers** benefit because every export is governed by explicit scope, permission, and masking rules.
- **Downstream T05/T06 work** benefits because cross-system correlation and verification can reuse the same export envelope, masking indicators, and route model.

### Value delivered

- Introduces one stable export surface for tenant- and workspace-scoped audit evidence.
- Makes masking deterministic and visible instead of ad hoc.
- Preserves multi-tenant isolation during audit evidence packaging.
- Ensures exported records carry explicit masking metadata so recipients can distinguish complete fields from protected ones.

---

## 3. In-Scope Capability

### In scope

- Define a machine-readable audit export + masking contract for tenant and workspace audit evidence exports.
- Define bounded export request semantics for:
  - export format,
  - scope,
  - filter reuse from `US-OBS-02-T03`,
  - export size/time-window limits,
  - masking profile selection,
  - manifest metadata,
  - and exported-record sensitivity markers.
- Expose public API routes for tenant-scoped and workspace-scoped audit export requests.
- Define explicit permissions for tenant and workspace audit export.
- Define which sensitive fields must always be masked in exported audit payloads.
- Define how masked records communicate that masking occurred.
- Expose console-facing metadata for export format options, masking badges, and route bindings.

### Out of scope

- Cross-system causal correlation graphs or upstream/downstream evidence stitching.
- Export persistence backends, object-store retention jobs, signed-download distribution, or restore/import flows.
- New audit emitters, new schema envelope fields, or runtime storage engine changes.
- End-to-end verification suites for masking and traceability.
- Any permission that reveals raw secrets, raw credentials, or unrestricted provider-native details.

---

## 4. User Scenarios and Acceptance Scenarios

### User Story 1 — Export tenant audit evidence safely (Priority: P1)

A tenant owner needs to export tenant-scoped audit evidence using the same filter model already supported by the query surface, and the resulting export must remain bounded to the tenant plus visibly masked where protected content would otherwise leak.

**Why this priority**: This is the minimum capability that turns audit consultation into portable evidence while preserving multi-tenant safety.

**Independent Test**: Can be fully tested by constructing a tenant-scoped export request, validating permission/scope bindings, and confirming the returned export manifest plus sample records show masking metadata for protected fields.

**Acceptance Scenarios**:

1. **Given** a tenant-scoped actor with `tenant.audit.export`, **when** the actor requests an export within the actor tenant scope, **then** the export route returns a bounded export manifest with the requested format, applied filters, and masking profile metadata.
2. **Given** a tenant-scoped export request that includes records with protected audit detail fields, **when** the export preview is built, **then** the exported records replace protected values with masked representations and mark which records were masked.
3. **Given** a tenant-scoped actor attempting to export another tenant's audit data, **when** the request is normalized, **then** the request is rejected as a scope violation.

---

### User Story 2 — Export workspace audit evidence without widening scope (Priority: P1)

A workspace actor needs to export workspace audit evidence for one workspace only, with the same masking policy and without inheriting tenant-wide export rights.

**Why this priority**: Workspace-safe evidence sharing is the smallest bounded export slice that preserves the workspace isolation model from the existing story.

**Independent Test**: Can be fully tested by building a workspace-scoped export request, validating that the workspace id is required and immutable from caller context, and confirming the shared masking profile is applied.

**Acceptance Scenarios**:

1. **Given** a workspace-scoped actor with `workspace.audit.export`, **when** the actor exports one workspace audit slice, **then** the export stays bound to that workspace and returns manifest metadata plus masked record projections.
2. **Given** a workspace-scoped export request that attempts to widen into another workspace, **when** the request is normalized, **then** the request is rejected.
3. **Given** a workspace export using saved query filters from the console, **when** the export is generated, **then** the same filter vocabulary from the T03 query surface is preserved in the export manifest.

---

### User Story 3 — Distinguish masked evidence from unmasked evidence (Priority: P2)

A security reviewer needs exported evidence to clearly indicate when masking was applied, why it happened, and which policy profile governed the masking decision.

**Why this priority**: Export without explicit masking metadata creates ambiguity and weakens compliance review.

**Independent Test**: Can be fully tested by projecting one audit record with protected detail fields and verifying that the result includes masking flags, masked field references, and the profile id that caused the protection.

**Acceptance Scenarios**:

1. **Given** an audit event containing protected detail fields, **when** it is projected for export, **then** the export result includes a sensitivity marker, `maskingApplied = true`, and the masked-field references.
2. **Given** an audit event that does not contain protected detail fields, **when** it is projected for export, **then** the export result remains structurally unchanged except for explicit `maskingApplied = false` metadata.

---

## 5. Edge Cases

- A tenant export narrows by workspace id: this is allowed only as a narrowing filter and must not bypass the tenant boundary.
- A workspace export request omits `workspaceId`: the request must fail because workspace exports require immutable workspace binding.
- An export request asks for more records than the bounded maximum: the request must fail deterministically instead of truncating silently.
- The requested time window exceeds the bounded export retention window: the request must fail with a clear validation error.
- An audit record contains both safe fields and protected detail fields: only protected fields are masked; the rest of the envelope stays readable.
- An export format is unknown: the request must fail before any preview/manifest is built.
- An export request carries no explicit masking profile: the default masked profile must be applied automatically.
- An export request contains no matching records: the manifest still returns successfully with zero exported items and zero masked items.

---

## 6. Functional Requirements

- **FR-001**: The system MUST define a machine-readable audit export + masking contract for tenant- and workspace-scoped audit evidence exports.
- **FR-002**: The system MUST expose one tenant-scoped audit export route and one workspace-scoped audit export route using explicit operation ids and scope bindings.
- **FR-003**: The export request model MUST reuse the bounded filter vocabulary and sort semantics introduced by `US-OBS-02-T03` instead of inventing a second filter language.
- **FR-004**: The system MUST require `tenant.audit.export` for tenant-scoped exports and `workspace.audit.export` for workspace-scoped exports.
- **FR-005**: The system MUST reject export requests that widen beyond the caller tenant or workspace scope.
- **FR-006**: The system MUST support a bounded set of export formats with explicit media types and default format selection.
- **FR-007**: The system MUST enforce deterministic export size and time-window limits.
- **FR-008**: The system MUST apply a default masking profile whenever exported audit records contain protected fields.
- **FR-009**: The masking policy MUST treat the sensitive audit field classes already forbidden by the audit-pipeline baseline as protected export content.
- **FR-010**: Exported records MUST indicate whether masking was applied and which protected fields were masked.
- **FR-011**: The console surface MUST expose the supported formats, default masking profile, masking badge semantics, and route bindings from the shared contract.
- **FR-012**: The public API contract MUST describe the export request, accepted response, and exported-record projection using additive version-compatible schemas.
- **FR-013**: The validator for this capability MUST verify source-version alignment, route existence, permission existence, masking-policy coverage, filter reuse, and governance boundaries.
- **FR-014**: The implementation MUST remain additive relative to T01–T03 and MUST NOT introduce restore/import or correlation behavior in this increment.

---

## 7. Permissions, Isolation, Security, and Traceability

### Permissions

- Tenant export requires `tenant.audit.export`.
- Workspace export requires `workspace.audit.export`.
- Existing read permissions remain necessary for consultation but are not sufficient by themselves to export evidence.
- No new permission in this increment may permit disclosure of raw credentials, tokens, authorization headers, or unrestricted provider-native locator fields.

### Multi-tenant isolation

- Tenant exports are bound to one tenant and may optionally narrow to one workspace within that tenant.
- Workspace exports are bound to one workspace and inherit the tenant binding from the workspace context.
- Cross-tenant and cross-workspace widening attempts must fail during request normalization.

### Security and masking

- The masking policy must cover at least the field classes already forbidden by the audit pipeline: password, secret, token, authorization header, connection string, raw hostname, raw endpoint, object key, and raw topic name.
- Masking must preserve the canonical audit envelope while protecting sensitive detail values.
- Exported records must communicate that masking occurred; protection must not be silent.

### Traceability

- Export manifests must retain the request correlation id, query scope, format, and applied filters.
- The contract must make it possible for later tasks to attach correlation chains without changing the export request model.

---

## 8. Key Entities

- **Audit export scope**: A bounded export target (`tenant` or `workspace`) with a route binding, permission requirement, scope-binding rules, and default format behavior.
- **Audit export request**: The caller-supplied export intent containing format, filters, sort, masking profile id, and bounded size/time-window controls.
- **Audit export manifest**: The response object describing the generated preview/export package, including scope, format, item counts, masking counts, applied filters, correlation id, and policy references.
- **Masking profile**: A declared protection policy that determines how sensitive audit fields are replaced and how masked records are annotated.
- **Sensitive field rule**: A contract rule mapping protected audit detail field classes or paths to one required masking behavior.

---

## 9. Success Criteria

### Measurable outcomes

- **SC-001**: Both tenant and workspace export scopes are defined in one shared contract, each with an explicit route id and permission id.
- **SC-002**: The export request contract reuses 100% of the T03 filter vocabulary required for bounded audit evidence selection.
- **SC-003**: Protected fields covered by the audit-pipeline forbidden field list are always masked in exported record projections.
- **SC-004**: Every exported record projection explicitly communicates whether masking was applied.
- **SC-005**: The validator fails deterministically when an export route, permission id, or required masking rule is removed.

---

## 10. Risks, Assumptions, and Open Questions

### Assumptions

- The bounded export surface in this repository is represented as governed API/contract behavior plus previewable manifest output, not a full binary download service.
- `US-OBS-02-T05` will extend correlation evidence using additive metadata rather than replacing the export request model defined here.
- `US-OBS-02-T06` will provide end-to-end verification rather than forcing runtime infrastructure into this increment.

### Risks

- If export and query filters drift, console and API behavior will diverge; this increment therefore depends on strict reuse of the T03 filter vocabulary.
- If masking metadata is implicit rather than explicit, downstream reviewers may misinterpret protected evidence as complete evidence.

### Open questions

- None that block bounded specification or implementation for this increment.
