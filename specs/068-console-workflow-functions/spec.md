# Feature Specification: Console Workflow Backend Functions

**Feature Branch**: `068-console-workflow-functions`  
**Created**: 2026-03-29  
**Status**: Draft  
**Input**: User description: "Implement OpenWhisk backend functions for console workflows identified in the workflow catalog (WF-CON-001 through WF-CON-006), enabling server-side execution of user approval, tenant provisioning, workspace creation, credential generation, service account lifecycle, and multi-service orchestrations as governed, tenant-isolated, idempotent OpenWhisk actions that consume internal BaaS APIs."

**Backlog Traceability**:
- **Task**: US-UIB-01-T02
- **Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura
- **Epic**: EP-16 — Backend funcional de la consola
- **RFs covered by story**: RF-UIB-001, RF-UIB-002, RF-UIB-003, RF-UIB-004, RF-UIB-005
- **Story dependencies**: US-FN-03, US-UI-01, US-TEN-01
- **Task dependency**: US-UIB-01-T01 (067-console-workflow-catalog — provides the authoritative workflow catalog consumed by this spec)

**Compatibility note**: This feature consumes the workflow catalog produced by 067-console-workflow-catalog (US-UIB-01-T01) as its authoritative scope. It must remain compatible with the already delivered 004-console-openwhisk-backend work (US-FN-03-T04). It must not absorb sibling tasks US-UIB-01-T03 (endpoint separation), US-UIB-01-T04 (saga/compensation patterns), US-UIB-01-T05 (audit and correlation-id), or US-UIB-01-T06 (E2E tests), which are specified and delivered independently.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Console backend executes cataloged workflows as server-side functions (Priority: P1)

As a console user (tenant owner, workspace admin, or superadmin), I want the complex multi-service operations I trigger from the console — user approval, tenant provisioning, workspace creation, credential generation, service account management, and multi-service orchestrations — to execute as backend functions in OpenWhisk rather than as sequences of browser-initiated API calls, so that these operations are reliable, consistent, and do not depend on my browser session staying open.

**Why this priority**: This is the core capability of this task. Without server-side execution of the cataloged workflows, the console remains fragile for multi-service operations, exposing users to partial failures and inconsistent state.

**Independent Test**: Trigger each of the six cataloged workflow types (WF-CON-001 through WF-CON-006) from the console and verify that the operation completes through a server-side OpenWhisk function rather than through direct browser-to-service coordination.

**Acceptance Scenarios**:

1. **Given** a workspace admin triggers user approval from the console, **When** the approval workflow executes, **Then** the operation runs as a server-side OpenWhisk function that coordinates Keycloak role assignment and PostgreSQL membership state update, returning a single completion result to the console.
2. **Given** a superadmin initiates tenant provisioning from the console, **When** the provisioning workflow executes, **Then** the operation runs as a server-side OpenWhisk function that orchestrates Keycloak, PostgreSQL, Kafka, and APISIX provisioning steps, and the console receives a job reference it can use to track progress.
3. **Given** a tenant owner creates a workspace from the console, **When** the creation workflow executes, **Then** the operation runs as a server-side OpenWhisk function that provisions identity, persistence, and storage resources, completing as one governed unit.
4. **Given** a workspace admin generates, rotates, or revokes credentials from the console, **When** the credential workflow executes, **Then** the operation runs as a server-side OpenWhisk function that coordinates Keycloak, APISIX, and PostgreSQL state, and secrets are never assembled or revealed in the browser beyond the final one-time display of generated material.
5. **Given** a workspace admin manages a service account lifecycle action from the console, **When** the service account workflow executes, **Then** the operation runs as a server-side OpenWhisk function that coordinates Keycloak identity state and PostgreSQL account records.
6. **Given** a console operation matches the generic multi-service orchestration classification (WF-CON-005), **When** a future workflow is implemented under this entry, **Then** it follows the same server-side execution pattern established by the other five workflow functions.

---

### User Story 2 — Workflow functions enforce tenant isolation and authorization (Priority: P1)

As a tenant owner or security reviewer, I want every workflow function to execute within the caller's tenant boundary and validate the caller's authorization before performing any action, so that no workflow can leak data across tenants or allow unauthorized privilege escalation.

**Why this priority**: Multi-tenant isolation is a non-negotiable product constraint. A workflow function that fails to enforce isolation undermines the entire platform's security model. This has the same priority as the core execution story because it must be built into every function from the start, not bolted on later.

**Independent Test**: Attempt to invoke each workflow function with a token scoped to a different tenant than the target resource, and verify that the function rejects the request before performing any state mutation.

**Acceptance Scenarios**:

1. **Given** a workflow function receives a request with a valid token for tenant A, **When** the request targets a resource belonging to tenant B, **Then** the function rejects the request without performing any mutations, returning an authorization error.
2. **Given** a workflow function requires a specific role (e.g., `workspace_admin` for credential generation), **When** a caller with insufficient role invokes the function, **Then** the function rejects the request before performing any mutations.
3. **Given** a superadmin-scoped workflow (tenant provisioning, WF-CON-002), **When** a non-superadmin caller invokes it, **Then** the function rejects the request and does not begin provisioning any resources.

---

### User Story 3 — Workflow functions are idempotent and safe to retry (Priority: P2)

As a console backend operator or platform engineer, I want workflow functions to be idempotent so that retries caused by transient failures, network timeouts, or job resubmissions do not create duplicate resources or leave the platform in an inconsistent state.

**Why this priority**: The catalog marks idempotency as required for all six workflow entries. Without idempotency, retry logic and failure recovery become unsafe, which blocks the saga/compensation work in T04 and E2E reliability testing in T06.

**Independent Test**: Invoke each workflow function twice with the same idempotency key and input parameters, and verify that the second invocation produces the same result as the first without creating duplicate resources.

**Acceptance Scenarios**:

1. **Given** a workflow function receives a request with an idempotency key that has already been processed successfully, **When** the same request is submitted again, **Then** the function returns the result of the original execution without re-executing the workflow steps.
2. **Given** a workflow function receives a request with an idempotency key for an execution that failed partway through, **When** the same request is retried, **Then** the function resumes or re-executes from a safe point without duplicating the steps that already succeeded.
3. **Given** two concurrent requests arrive for the same workflow with the same idempotency key, **When** processed simultaneously, **Then** only one execution proceeds and the other receives the result of the first.

---

### User Story 4 — Workflow functions consume the BaaS API surface (Priority: P2)

As a platform architect, I want workflow functions to interact with platform services through the established BaaS API surface rather than bypassing it with direct database connections or internal service calls, so that the existing API contracts, validation rules, rate limits, and access controls remain in effect for backend operations.

**Why this priority**: This aligns with the architectural decision from 004-console-openwhisk-backend that console backend functions consume the public API surface. Bypassing APIs would create a shadow control plane that undermines governance.

**Independent Test**: Trace the network calls made by each workflow function during execution and verify that all service interactions go through the BaaS API endpoints rather than through direct database connections or internal-only service interfaces.

**Acceptance Scenarios**:

1. **Given** a workflow function needs to create a Keycloak realm, assign a role, or manage a client, **When** the function executes, **Then** it calls the BaaS-governed API surface for identity operations rather than directly calling Keycloak admin APIs.
2. **Given** a workflow function needs to write a PostgreSQL record, **When** the function executes, **Then** it calls the BaaS data API rather than executing raw SQL against the database.
3. **Given** a workflow function needs to create a Kafka topic or S3 bucket, **When** the function executes, **Then** it calls the BaaS-governed API for that service rather than calling the underlying infrastructure APIs directly.

---

### User Story 5 — Workflow functions report execution status for asynchronous tracking (Priority: P3)

As a console user, I want to see the status of long-running workflows (especially tenant provisioning and workspace creation) so that I know whether the operation is in progress, completed, or has failed, without having to guess or repeatedly trigger the same action.

**Why this priority**: While all workflows benefit from status visibility, user-facing status tracking is most critical for the asynchronous workflows (WF-CON-002, WF-CON-003) that may take multiple seconds. Synchronous workflows can rely on request-response semantics.

**Independent Test**: Trigger a long-running workflow function and verify that the console can query the execution status at any point during or after execution.

**Acceptance Scenarios**:

1. **Given** a superadmin initiates tenant provisioning, **When** the workflow is in progress, **Then** the console can retrieve the current execution status (e.g., pending, running, succeeded, failed) using the job reference returned at invocation.
2. **Given** a workflow function completes successfully, **When** the console queries the execution status, **Then** the status reflects success along with any relevant result summary (e.g., the provisioned tenant identifier).
3. **Given** a workflow function fails after partial execution, **When** the console queries the execution status, **Then** the status reflects failure along with an indication of which step failed, sufficient for a human operator to understand the situation without exposing internal implementation details.

---

### Edge Cases

- A workflow function is invoked with a valid token that expires mid-execution; the function must either complete with the already-validated authorization context or fail cleanly without leaving partial state.
- A downstream BaaS API is temporarily unavailable during workflow execution; the function must fail in a way that allows safe retry (idempotency key preservation) without corrupting state.
- Two workflow functions for the same tenant execute concurrently and both attempt to modify the same resource (e.g., two credential rotations for the same workspace); the system must handle the contention without producing duplicate or conflicting state.
- A workflow function is invoked for a tenant that is being deprovisioned concurrently; the function must detect the invalid tenant state and reject the operation cleanly.
- WF-CON-005 (provisional generic entry) is invoked before a concrete implementation exists; the system must return a clear "not implemented" response rather than a cryptic error.
- A superadmin workflow (WF-CON-002) is invoked through a path that does not enforce superadmin authorization; the function's own authorization check must serve as the last line of defense.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a server-side OpenWhisk function for each non-provisional workflow entry in the catalog: WF-CON-001 (User Approval), WF-CON-002 (Tenant Provisioning), WF-CON-003 (Workspace Creation), WF-CON-004 (Credential Generation), and WF-CON-006 (Service Account Lifecycle).
- **FR-002**: Each workflow function MUST accept an idempotency key as part of the invocation request and MUST guarantee that duplicate invocations with the same key produce the same outcome without re-executing already-completed steps.
- **FR-003**: Each workflow function MUST validate the caller's tenant context and role authorization before performing any state-mutating operation, rejecting unauthorized requests with a clear error response.
- **FR-004**: Each workflow function MUST interact with platform services exclusively through the BaaS API surface, not through direct database connections, internal-only service endpoints, or raw infrastructure APIs.
- **FR-005**: Workflow functions that involve asynchronous or long-running processing (at minimum WF-CON-002 and WF-CON-003) MUST return a job reference at invocation and MUST support status queries that report the current execution state (pending, running, succeeded, failed).
- **FR-006**: Each workflow function MUST coordinate the specific platform services documented in its catalog entry: WF-CON-001 (Keycloak, PostgreSQL), WF-CON-002 (Keycloak, PostgreSQL, Kafka, APISIX), WF-CON-003 (Keycloak, PostgreSQL, S3), WF-CON-004 (Keycloak, APISIX, PostgreSQL), WF-CON-006 (Keycloak, PostgreSQL).
- **FR-007**: The credential generation workflow function (WF-CON-004) MUST ensure that secret material (API keys, tokens, passwords) is generated and handled server-side; the browser MUST NOT participate in secret assembly, only in one-time display of the final generated credential.
- **FR-008**: The tenant provisioning workflow function (WF-CON-002) MUST enforce superadmin-only authorization, rejecting invocations from tenant-scoped or workspace-scoped actors.
- **FR-009**: Each workflow function MUST fail cleanly when a downstream service is unavailable, preserving the idempotency key state so that the operation can be safely retried once the service recovers.
- **FR-010**: The system MUST support the provisional WF-CON-005 entry by providing a registration mechanism or extension point through which future multi-service orchestration workflows can be added without modifying the existing five workflow functions.
- **FR-011**: Workflow functions that are classified as `sensitive` in the catalog (WF-CON-001, WF-CON-002, WF-CON-004, WF-CON-006) MUST produce structured output suitable for audit consumption by the audit pipeline (the audit pipeline integration itself is scoped to T05, but the function output must be audit-ready).

### Key Entities

- **Workflow Function**: A server-side OpenWhisk action that implements one cataloged workflow entry (WF-CON-001 through WF-CON-006), accepting a structured invocation request and producing a structured result.
- **Idempotency Key**: A caller-provided unique identifier for a workflow invocation, used to guarantee that retried or duplicate requests do not produce duplicate side effects.
- **Job Reference**: An identifier returned by asynchronous workflow functions at invocation time, used to query execution status until the workflow completes or fails.
- **Execution Status**: A structured record of a workflow invocation's current state (pending, running, succeeded, failed), associated with a job reference and carrying result or error summary information.
- **Workflow Catalog Entry**: A reference to the authoritative classification in 067-console-workflow-catalog/catalog.md that defines the scope, actors, services, isolation, and audit classification for each workflow this feature implements.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All five non-provisional cataloged workflows (WF-CON-001 through WF-CON-004, WF-CON-006) have corresponding server-side functions that can be invoked and that complete their documented multi-service coordination successfully.
- **SC-002**: Each workflow function rejects unauthorized invocations (wrong tenant, insufficient role) with zero state mutations — verified by attempting cross-tenant and under-privileged invocations for every function.
- **SC-003**: Each workflow function handles duplicate invocations with the same idempotency key by returning the original result without creating duplicate resources — verified by invoking each function twice with identical keys and confirming no resource duplication.
- **SC-004**: Asynchronous workflow functions (at minimum WF-CON-002, WF-CON-003) return a job reference within 2 seconds of invocation, and the execution status is queryable within 1 second of a status request at any point during or after execution.
- **SC-005**: No workflow function bypasses the BaaS API surface — verified by tracing all outbound calls during execution and confirming they target BaaS API endpoints exclusively.
- **SC-006**: The credential generation function (WF-CON-004) generates secret material entirely server-side — verified by confirming that no intermediate credential fragments transit to the browser during the generation process.
- **SC-007**: Each workflow function produces audit-ready structured output that includes at minimum: workflow identifier, actor identity, tenant context, timestamp, affected resources, and outcome — verified by inspecting function output for all required fields.
- **SC-008**: Each workflow function can be safely retried after a downstream service failure without leaving partial state — verified by simulating a downstream service timeout mid-execution, retrying, and confirming consistent final state.

## Assumptions

- The workflow catalog (067-console-workflow-catalog/catalog.md) is finalized and its workflow entries (WF-CON-001 through WF-CON-006) are stable. Changes to the catalog that affect this spec will be handled through the catalog's governance process.
- The BaaS API surface for the services referenced by each workflow (Keycloak, PostgreSQL, Kafka, APISIX, S3) is available and supports the operations required by the workflow functions. If an API endpoint is missing, that is a blocker for the corresponding workflow function.
- The 004-console-openwhisk-backend infrastructure (US-FN-03-T04) is in place and provides the OpenWhisk execution environment, deployment mechanism, and API gateway integration that this spec's workflow functions will use.
- Saga/compensation patterns for handling multi-service rollback are scoped to US-UIB-01-T04 and are not required in this spec. This spec's functions must fail cleanly and support retry, but formal compensation logic is added by T04.
- Audit pipeline integration (correlation-id propagation, audit event emission) is scoped to US-UIB-01-T05. This spec requires functions to produce audit-ready output, but the pipeline wiring is T05's responsibility.
- E2E testing of workflow functions including failure scenarios is scoped to US-UIB-01-T06. This spec defines the functions; T06 validates them end to end.
- WF-CON-005 (provisional generic entry) does not require a concrete function implementation in this spec. It requires only that the system's design accommodates adding future workflow functions without modifying the existing ones.
