# Feature Specification: Console Backend Workflow Catalog

**Feature Branch**: `067-console-workflow-catalog`  
**Created**: 2026-03-29  
**Status**: Draft  
**Input**: User description: "Identify console backend workflows that must run server-side in OpenWhisk: user approval, tenant provisioning, workspace creation, credential generation, and multi-service orchestrations — producing a bounded workflow catalog with classification criteria and governance rules."

**Backlog Traceability**:
- **Task**: US-UIB-01-T01
- **Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura
- **Epic**: EP-16 — Backend funcional de la consola
- **RFs covered by story**: RF-UIB-001, RF-UIB-002, RF-UIB-003, RF-UIB-004, RF-UIB-005
- **Story dependencies**: US-FN-03, US-UI-01, US-TEN-01

**Compatibility note**: This feature must remain compatible with the already delivered 004-console-openwhisk-backend work (US-FN-03-T04). It must not absorb sibling tasks US-UIB-01-T02 through US-UIB-01-T06, which cover implementation, endpoint separation, saga/compensation, audit correlation, and E2E testing respectively.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Platform team obtains a definitive catalog of console workflows that must run server-side (Priority: P1)

As a platform engineer or architect, I need a single authoritative catalog listing every console operation that must execute as a backend workflow in OpenWhisk, so that downstream implementation tasks (T02–T06) can proceed against a stable, bounded scope without re-debating which operations belong server-side.

**Why this priority**: Without this catalog, every subsequent task in the story would need to independently decide which operations qualify as backend workflows, leading to scope creep, omissions, and inconsistent treatment across the console.

**Independent Test**: A reviewer can inspect the catalog artifact and determine, for any given console operation, whether it is classified as a backend workflow or not, and understand the reasoning behind that classification.

**Acceptance Scenarios**:

1. **Given** the BaaS console supports operations such as user approval, tenant provisioning, workspace creation, credential generation, and multi-service orchestrations, **When** a platform engineer reviews the workflow catalog, **Then** each of these operations is explicitly listed with its classification as a backend workflow, along with the criteria that justify its inclusion.
2. **Given** a console operation that is simple, single-service, and stateless (e.g., reading a user profile), **When** a contributor checks the catalog, **Then** that operation is either explicitly excluded or clearly does not meet the inclusion criteria, preventing unnecessary backend workflow proliferation.
3. **Given** the catalog exists, **When** a new console operation is proposed in the future, **Then** the classification criteria in the catalog are sufficient for a contributor to determine whether the new operation should be a backend workflow without requiring a new architectural decision.

---

### User Story 2 — Security and compliance reviewers can verify that sensitive operations are not exposed to client-side orchestration (Priority: P2)

As a security reviewer or tenant owner, I need to confirm that operations involving privilege escalation, credential generation, cross-service mutations, and tenant provisioning are classified as server-side workflows, so that the console does not orchestrate sensitive multi-step processes from the browser.

**Why this priority**: Sensitive operations orchestrated client-side expose the product to credential leakage, partial-failure inconsistency, and authorization bypass. The catalog must make the security boundary explicit.

**Independent Test**: A security reviewer can inspect the catalog and verify that every operation touching credentials, provisioning, or cross-service mutations is classified as backend-only, with the security rationale documented.

**Acceptance Scenarios**:

1. **Given** a console operation that generates, rotates, or distributes credentials (API keys, service account tokens, database passwords), **When** a security reviewer inspects the catalog, **Then** the operation is classified as a backend workflow with a documented security rationale (e.g., secret material must never transit through or be assembled in the browser).
2. **Given** a console operation that modifies resources across two or more platform services (e.g., provisioning a tenant requires Keycloak realm + PostgreSQL schema + Kafka topic), **When** a security reviewer inspects the catalog, **Then** the operation is classified as a backend workflow with the multi-service mutation explicitly noted as a classification driver.
3. **Given** a console operation that only reads data from a single service with standard user-scoped authorization, **When** a security reviewer inspects the catalog, **Then** the operation is not classified as a backend workflow unless additional criteria apply.

---

### User Story 3 — Product and operations teams understand governance rules for workflow lifecycle management (Priority: P3)

As a product manager or operations engineer, I need governance rules that define how workflows in the catalog are versioned, retired, and extended, so that the catalog remains a living artifact aligned with product evolution rather than a one-time snapshot.

**Why this priority**: A catalog without governance rules becomes stale. Governance ensures that as the product grows, new operations are evaluated against consistent criteria and existing workflows are maintained or retired explicitly.

**Independent Test**: A product manager can follow the governance rules to evaluate a hypothetical new console operation and determine its classification, required metadata, and lifecycle expectations without ambiguity.

**Acceptance Scenarios**:

1. **Given** the workflow catalog includes governance rules, **When** a product manager proposes a new console feature that touches multiple services, **Then** the governance rules provide a clear decision path (criteria checklist, required metadata, approval expectations) to classify the operation.
2. **Given** an existing workflow in the catalog becomes obsolete (e.g., a manual approval flow is replaced by an automated policy), **When** the operations team reviews the catalog, **Then** the governance rules specify how to mark the workflow as deprecated and the conditions under which it can be removed.
3. **Given** the governance rules exist, **When** a contributor adds a workflow to the catalog, **Then** the required metadata includes at minimum: workflow name, triggering actor, affected services, tenant isolation requirements, idempotency expectation, and audit classification.

---

### Edge Cases

- A console operation initially classified as client-safe later requires a second service call due to a product change; the catalog and governance rules must support reclassification.
- A workflow touches services that are not yet implemented in the BaaS (e.g., a future billing service); the catalog must accommodate provisional entries without blocking current delivery.
- Two workflows share overlapping steps (e.g., both tenant provisioning and workspace creation need Keycloak operations); the catalog must identify shared sub-workflows without mandating implementation decomposition (that belongs to T02).
- A superadmin operation bypasses normal tenant scoping; the catalog must classify such operations distinctly and flag the elevated privilege requirement.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The catalog MUST enumerate every console operation that qualifies as a backend workflow, including at minimum: user approval, tenant provisioning, workspace creation, credential generation (API keys, service tokens), and multi-service orchestrations identified in the product scope.
- **FR-002**: The catalog MUST define explicit, reusable classification criteria that determine whether a console operation must run as a backend workflow. Criteria MUST cover at least: multi-service mutation, credential/secret handling, asynchronous or long-running processing, privilege escalation, and atomicity/consistency requirements.
- **FR-003**: Each workflow entry in the catalog MUST include structured metadata: workflow name, description, triggering actors (e.g., tenant owner, workspace admin, superadmin), affected platform services, tenant isolation requirement (scoped vs. cross-tenant), idempotency expectation, and audit classification (sensitivity level).
- **FR-004**: The catalog MUST explicitly exclude console operations that do not meet the classification criteria, providing a representative exclusion list (e.g., single-service reads, user preference updates) to prevent scope ambiguity.
- **FR-005**: The catalog MUST include governance rules covering: how new workflows are proposed and classified, required metadata for new entries, deprecation and retirement process, and versioning expectations for the catalog itself.
- **FR-006**: Each workflow entry MUST document which platform services are involved (from the set: Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible storage, APISIX) so that downstream implementation tasks can plan integration scope.
- **FR-007**: The catalog MUST identify workflows that require elevated privileges (superadmin-only or cross-tenant scope) and flag them distinctly from tenant-scoped workflows.
- **FR-008**: The catalog MUST be consumable as a repository-native artifact (Markdown or structured data file) that can be referenced by sibling tasks (T02–T06) without external tooling.

### Key Entities

- **Workflow Entry**: A named console operation classified as a backend workflow, with metadata describing its actors, affected services, isolation scope, idempotency expectation, and audit classification.
- **Classification Criteria**: A reusable set of rules (multi-service mutation, credential handling, async processing, privilege escalation, consistency requirement) used to determine whether an operation qualifies as a backend workflow.
- **Governance Rule**: A lifecycle management rule covering proposal, classification, metadata requirements, deprecation, retirement, and catalog versioning.
- **Exclusion Entry**: A representative console operation explicitly excluded from the catalog, with the criteria it fails to meet, serving as a boundary marker.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The catalog contains entries for 100% of the console operations identified in the story scope (user approval, tenant provisioning, workspace creation, credential generation, multi-service orchestrations), with no known operations left unclassified.
- **SC-002**: A new contributor can classify a previously unseen console operation using only the documented criteria and governance rules, arriving at a consistent classification in under 10 minutes without requiring additional architectural consultation.
- **SC-003**: Every catalog entry includes all required metadata fields (name, description, actors, services, isolation, idempotency, audit classification) with no empty or placeholder values.
- **SC-004**: Sibling tasks (US-UIB-01-T02 through T06) can reference the catalog to determine their implementation scope without ambiguity — verified by confirming that each sibling task's scope maps to one or more catalog entries.
- **SC-005**: Security review of the catalog confirms that no operation involving credential generation, multi-service mutation, or privilege escalation is classified as client-side eligible.

## Assumptions

- The set of platform services (Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible storage, APISIX) is stable for the purpose of this catalog. If a new service is added to the BaaS, the governance rules cover how to update affected workflow entries.
- The console operations within scope are those currently identified in the product backlog under EP-16 and its related stories. Operations from future epics will be evaluated using the classification criteria but are not required in this initial catalog.
- The catalog is a design/specification artifact, not runtime code. Implementation of the actual workflows is covered by US-UIB-01-T02 and subsequent tasks.
- Multi-tenancy, audit, and security constraints referenced in the catalog align with decisions already established in earlier specs (004-console-openwhisk-backend, us-arc-01-t01).
