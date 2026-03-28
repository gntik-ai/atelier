# Feature Specification: US-OBS-02-T05 — Console-Initiated Audit Correlation

**Feature Branch**: `035-audit-console-correlation`
**Task**: `US-OBS-02-T05`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación
**Requirements traceability**: RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020
**Dependencies**: US-ARC-03, US-PRG-03
**Intra-story dependencies**: US-OBS-02-T01, US-OBS-02-T02, US-OBS-02-T03, US-OBS-02-T04
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-02-T01` established the common audit pipeline, `US-OBS-02-T02` fixed the canonical audit envelope, `US-OBS-02-T03` exposed bounded audit consultation, and `US-OBS-02-T04` added governed export plus masking. The platform still lacks one bounded way to answer the operational question:

**“A console user initiated an administrative action — which real downstream system changes were actually executed, in what order, and with which evidence?”**

Without a dedicated correlation capability:

- console-originated actions can be observed as isolated audit records but not as one end-to-end trace,
- SRE and security teams must manually stitch together control-plane, provider-adapter, and downstream evidence,
- tenant/workspace operators cannot quickly determine whether a console action fully completed, partially completed, or broke after acceptance,
- and later traceability verification work would have no shared correlation contract to validate against.

This task delivers the minimum functional capability for **bounded cross-system audit correlation of console-initiated administrative actions**. It defines one shared correlation surface, one trace model for tenant and workspace scopes, the permissions and scope rules needed to access it, the console-facing metadata for presenting trace states, and the bounded evidence pointers required to show real downstream execution without exposing raw secrets or widening scope.

This task does **not** add full end-to-end verification suites (`US-OBS-02-T06`), durable incident/case management workflows, replay/recovery automation, or new audit emitters. It only defines and wires the bounded correlation surface that later verification can test.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Tenant owners and tenant admins** need tenant-scoped traceability to confirm that a console-triggered administrative action propagated across the intended workspaces and subsystems.
- **Workspace owners, workspace admins, workspace operators, and workspace auditors** need workspace-scoped correlation to inspect whether one workspace action actually produced the expected downstream system changes.
- **Security and SRE operators** need one correlation timeline that links console initiation, control-plane handling, downstream execution, and audit evidence pointers.
- **Console authors** need one shared contract for correlation states, timeline phases, and empty/loading/error behavior so the admin console does not invent ad hoc traceability views.

### Indirect consumers

- **Compliance and governance reviewers** benefit because exported or consulted audit evidence can now be linked back to one explicit correlation chain rather than interpreted as disconnected records.
- **`US-OBS-02-T06`** benefits because end-to-end traceability tests can validate one published correlation model instead of reverse-engineering implicit runtime behavior.

### Value delivered

- Introduces one governed correlation surface for tenant and workspace audit traces.
- Makes console-originated administrative actions traceable through real downstream execution evidence.
- Preserves multi-tenant and workspace isolation while exposing end-to-end traceability.
- Distinguishes complete, partial, and broken traces with explicit missing-link reporting.
- Reuses the T04 masking baseline so sensitive details remain protected inside correlated evidence.

---

## 3. In-Scope Capability

### In scope

- Define a machine-readable audit-correlation contract for tenant and workspace trace retrieval.
- Define bounded correlation request semantics centered on one `correlationId` plus optional inclusion flags for projected audit records and evidence pointers.
- Expose public API routes for tenant-scoped and workspace-scoped correlation lookup.
- Define explicit permissions for reading correlation traces when the caller is entitled to inspect deeper operational traceability.
- Define one correlation response envelope containing:
  - correlation status,
  - bounded timeline entries,
  - involved subsystems,
  - linked audit records,
  - linked downstream evidence pointers,
  - and missing-link diagnostics.
- Reuse the T04 masking policy for correlated record and evidence projections.
- Expose console-facing metadata for trace states, phase labels, and route bindings.

### Out of scope

- New emitters or runtime instrumentation beyond the existing audit and downstream contract baselines.
- Full end-to-end verification suites and recovery drills (`US-OBS-02-T06`).
- Durable incident case files, manual investigation workspaces, or ticketing integration.
- Replay, rollback, or remediation automation for incomplete traces.
- Cross-tenant correlation views or unrestricted platform-wide search.

---

## 4. User Scenarios and Acceptance Scenarios

### User Story 1 — Trace one console action end to end at tenant scope (Priority: P1)

A tenant administrator needs to start from one correlation id produced by a console-originated administrative action and inspect the downstream systems and audit evidence involved in that same action across the tenant scope.

**Why this priority**: This is the minimum slice that turns isolated audit consultation into end-to-end operational traceability.

**Independent Test**: Can be fully tested by requesting one tenant-scoped correlation trace, validating the tenant binding, and confirming that the response shows the initiating console action, downstream execution evidence, and a bounded status.

**Acceptance Scenarios**:

1. **Given** a tenant-scoped actor with `tenant.audit.correlate`, **when** the actor requests a trace for a correlation id inside the actor tenant scope, **then** the system returns one bounded trace containing the initiating action, timeline entries, subsystem list, and evidence pointers for that correlation id.
2. **Given** a tenant-scoped trace where downstream execution evidence exists only for part of the chain, **when** the trace is returned, **then** the response marks the trace as partial and lists the missing links instead of silently implying success.
3. **Given** a tenant-scoped actor attempting to inspect another tenant’s correlation id, **when** the request is normalized, **then** the request is rejected as a scope violation.

---

### User Story 2 — Trace one workspace action without widening scope (Priority: P1)

A workspace operator needs to inspect one workspace correlation chain to verify whether a console action actually changed the expected workspace-bound resources and subsystems.

**Why this priority**: Workspace-safe correlation is the smallest operationally valuable slice for support, SRE, and security workflows.

**Independent Test**: Can be fully tested by requesting one workspace-scoped trace, validating immutable workspace binding, and confirming that the trace includes only workspace-safe evidence.

**Acceptance Scenarios**:

1. **Given** a workspace-scoped actor with `workspace.audit.correlate`, **when** the actor requests one workspace trace, **then** the returned trace stays bound to that workspace and lists only correlated evidence inside that scope.
2. **Given** a workspace trace request that attempts to widen into another workspace, **when** the request is normalized, **then** the request is rejected.
3. **Given** a workspace trace where the console action was accepted but no provider-side change is linked, **when** the trace is returned, **then** the response explicitly reports a broken or incomplete chain instead of returning an unqualified success view.

---

### User Story 3 — Review traceability without exposing protected details (Priority: P2)

A security reviewer needs correlated traces to remain useful for investigations without revealing protected fields or unsafe provider-native locators.

**Why this priority**: Correlation without masking would weaken the safety guarantees already established by T04.

**Independent Test**: Can be fully tested by building one correlation trace that includes protected detail fields or evidence pointers and verifying the result stays masked while still listing the affected fields/categories.

**Acceptance Scenarios**:

1. **Given** a correlated record containing protected detail fields, **when** it is projected inside the trace timeline, **then** the protected values are masked and the response still indicates which fields/categories were protected.
2. **Given** a correlated downstream evidence pointer that references a protected locator, **when** the trace is returned, **then** the pointer metadata is safe for consultation and no raw secret or forbidden locator is exposed.

---

## 5. Edge Cases

- The initiating console action exists but no downstream execution evidence is found: the trace must return a non-success terminal status with missing-link diagnostics.
- A downstream provider change exists with the same `correlationId` but no initiating console action is present in scope: the trace must surface the missing root rather than fabricating one.
- A workspace-scoped trace inherits tenant context from the workspace: tenant attribution may be shown, but the caller must not gain tenant-wide visibility.
- Multiple subsystems participate in one correlated action: the trace must preserve timeline order and subsystem attribution without requiring platform-global ordering guarantees.
- Some correlated entries are safe to show while others contain protected detail fields: masking applies selectively and must not erase the entire trace.
- The correlation id is syntactically valid but has no matching records: the response must remain bounded and clearly indicate an empty/missing trace.
- A downstream contract source is known but lacks linked audit evidence for the requested correlation id: the trace may remain partial but must call out the evidence gap.

---

## 6. Functional Requirements

- **FR-001**: The system MUST define a machine-readable audit correlation surface for tenant- and workspace-scoped trace retrieval.
- **FR-002**: The system MUST expose one tenant-scoped audit-correlation route and one workspace-scoped audit-correlation route with explicit operation ids and scope bindings.
- **FR-003**: The correlation request model MUST require one `correlationId` and MUST preserve caller scope boundaries during normalization.
- **FR-004**: The system MUST require `tenant.audit.correlate` for tenant-scoped trace retrieval and `workspace.audit.correlate` for workspace-scoped trace retrieval.
- **FR-005**: The system MUST reject correlation requests that widen beyond the caller tenant or workspace scope.
- **FR-006**: The correlation response MUST identify whether a trace is `complete`, `partial`, `broken`, or `not_found`.
- **FR-007**: The correlation response MUST expose a bounded ordered timeline that links the initiating console action with downstream execution evidence and linked audit records.
- **FR-008**: Every correlation trace MUST list the participating subsystems and any missing links required to explain incomplete traceability.
- **FR-009**: The correlation surface MUST reuse the T04 masking policy for correlated audit-record projections and safe evidence pointers.
- **FR-010**: The correlation response MUST expose only bounded, secret-free evidence metadata and MUST NOT reveal raw credentials, tokens, or forbidden provider locator fields.
- **FR-011**: The console surface MUST expose the correlation scopes, status labels, phase labels, and empty/loading/error states from the shared contract.
- **FR-012**: The validator for this capability MUST verify source-version alignment, route existence, permission existence, internal contract-source alignment, masking compatibility, and governance boundaries.
- **FR-013**: The public API contract MUST describe the additive request/response schemas for correlation lookup without breaking T03 query or T04 export contracts.
- **FR-014**: The implementation MUST remain additive relative to T01–T04 and MUST NOT absorb T06 verification work into this increment.

---

## 7. Permissions, Isolation, Security, and Traceability

### Permissions

- Tenant correlation requires `tenant.audit.correlate`.
- Workspace correlation requires `workspace.audit.correlate`.
- Existing read/export permissions alone are not sufficient if the caller is not authorized to inspect deeper end-to-end traceability.
- Viewer roles do not automatically gain correlation access in this increment.

### Multi-tenant isolation

- Tenant traces are bound to one tenant only.
- Workspace traces are bound to one workspace and inherit tenant attribution from that workspace context.
- Cross-tenant and cross-workspace widening attempts must fail during request normalization.

### Security and masking

- Correlated record projections must preserve the T04 masking behavior for protected audit fields.
- Evidence pointers must be safe to display and must not reveal raw credentials, raw endpoints, raw object keys, or other forbidden locators.
- Missing links must be explicit, but the system must not expose hidden raw payloads merely to explain the gap.

### Traceability

- The correlation model must preserve the initiating `correlationId`, involved subsystems, timeline ordering, and linked audit/evidence identifiers.
- The response must make it possible to differentiate a complete chain from a partial or broken one.
- Later T06 verification must be able to test this contract without redefining trace semantics.

---

## 8. Key Entities

- **Audit correlation scope**: A bounded trace-lookup target (`tenant` or `workspace`) with a route binding, permission requirement, and scope-binding rules.
- **Correlation trace request**: The caller-supplied lookup intent centered on one `correlationId` and bounded inclusion options.
- **Correlation trace**: The response envelope describing trace status, timeline entries, participating subsystems, linked audit records, safe evidence pointers, and missing links.
- **Correlation timeline entry**: One normalized phase in the trace, such as console initiation, control-plane execution, downstream system effect, or audit persistence.
- **Evidence pointer**: A safe metadata reference to downstream execution evidence or audit material linked to the trace without exposing forbidden raw values.
- **Missing link**: An explicit diagnostic describing which expected stage or evidence reference is absent from the requested trace.

---

## 9. Success Criteria

### Measurable outcomes

- **SC-001**: Both tenant and workspace correlation scopes are defined in one shared contract, each with an explicit route id and permission id.
- **SC-002**: Every returned trace exposes one bounded status chosen from `complete`, `partial`, `broken`, or `not_found`.
- **SC-003**: Correlation traces always identify their participating subsystems and missing links when the chain is incomplete.
- **SC-004**: Correlated record projections preserve T04 masking guarantees for protected fields.
- **SC-005**: The validator fails deterministically when a required route id, permission id, or internal correlation source contract is removed.

---

## 10. Risks, Assumptions, and Open Questions

### Assumptions

- The repository represents this increment as governed contracts, public API schemas, helper behavior, documentation, and tests rather than as a fully deployed trace store.
- Existing downstream contract baselines already carry enough correlation and audit-link metadata to support a bounded correlation surface.
- `US-OBS-02-T06` will validate end-to-end behavior against the published T05 model rather than replacing it.

### Risks

- If correlation permissions are too broad, sensitive operational traceability could leak beyond intended operational roles.
- If the correlation model omits missing-link diagnostics, operators may falsely treat partial traces as successful end-to-end execution.
- If masking is applied inconsistently between T04 export and T05 correlation, investigation tooling will diverge.

### Open questions

- None that block bounded specification or implementation for this increment.
