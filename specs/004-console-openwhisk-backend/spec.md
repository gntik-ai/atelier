# Feature Specification: Console Backend on OpenWhisk

**Feature Branch**: `004-console-openwhisk-backend`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Scope only US-FN-03-T04: console backend logic runs in OpenWhisk while consuming the same public BaaS APIs."

**Compatibility note**: This feature must remain compatible with the already delivered US-FN-03-T01, US-FN-03-T02, and US-FN-03-T03 work, and it must not absorb the sibling US-FN-03-T05 or US-FN-03-T06 tasks.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Console backend workflows run in OpenWhisk through the public BaaS surface (Priority: P1)

As a console operator, product owner, or backend consumer of the console, I want console backend workflows to run in OpenWhisk while calling the same public BaaS APIs, so that the console can operate as a serverless backend without creating a separate privileged product surface.

**Why this priority**: This is the core behavior of the feature. Without it, the console backend cannot move to OpenWhisk in a product-compliant way.

**Independent Test**: Execute a representative console backend workflow end-to-end and verify that it completes through OpenWhisk while interacting only with the public BaaS APIs.

**Acceptance Scenarios**:

1. **Given** a console backend workflow is available and the required public BaaS APIs are reachable, **When** the workflow runs in OpenWhisk, **Then** it can complete its product action using only the public API surface.
2. **Given** a console backend workflow needs a product capability that is already exposed publicly, **When** the workflow is executed, **Then** it does not require a separate private API or alternate privileged backend path.
3. **Given** a console backend workflow is not available in OpenWhisk, **When** the feature is evaluated, **Then** the product still treats the public BaaS APIs as the canonical contract for the underlying capability.

---

### User Story 2 - Console backend actions remain tenant-aware and traceable (Priority: P2)

As a tenant owner, workspace admin, or security reviewer, I want console backend actions to preserve tenant, workspace, and actor context, so that the product remains isolated, auditable, and attributable even when the backend runs in OpenWhisk.

**Why this priority**: Running backend logic serverlessly must not weaken multi-tenant isolation, security, or traceability.

**Independent Test**: Trigger a console backend action for one tenant/workspace and verify that the resulting product behavior, access checks, and trace information remain confined to that same scope.

**Acceptance Scenarios**:

1. **Given** a console backend action is initiated for a specific tenant and workspace, **When** the action completes, **Then** the resulting product operation is attributed to that same tenant and workspace.
2. **Given** a console backend action is attempted outside the caller’s authorized scope, **When** the request reaches the product surface, **Then** it is rejected and no cross-tenant data is revealed.
3. **Given** a console backend action is processed, **When** observability or audit consumers inspect the event trail, **Then** they can distinguish the console backend as the initiating product path without losing the original actor and scope context.

---

### User Story 3 - Console backend behavior matches public API rules and denials (Priority: P3)

As a backend developer or support operator, I want console backend behavior to follow the same business rules, validations, and denials as direct public API calls, so that the console does not become a loophole around product policy.

**Why this priority**: The backend path must remain consistent with the rest of the product to avoid policy drift, security bypasses, and confusing user outcomes.

**Independent Test**: Compare a direct public API request and the equivalent console backend request for the same input and verify that allowed and denied outcomes are consistent.

**Acceptance Scenarios**:

1. **Given** a public API request would be rejected for authorization, tenancy, validation, or quota reasons, **When** the equivalent console backend request is made, **Then** it is rejected for the same product reason.
2. **Given** a public API request is allowed for a tenant and workspace, **When** the equivalent console backend request is made, **Then** it is allowed under the same product rules.
3. **Given** a console backend request would require broader privileges than the caller possesses, **When** it is evaluated, **Then** the request is denied rather than escalating privileges through the backend runtime.

### Edge Cases

- A console backend request is missing tenant or workspace context; the product must reject it rather than infer a broader scope.
- A console backend action is retried by the runtime or caller; the product must preserve the same authorization and scope checks on each attempt.
- A public API returns a product-level denial such as authorization failure, tenancy violation, quota block, or validation error; the console backend must surface the same business outcome without exposing additional internal details.
- A console backend workflow attempts to reach a resource outside the caller’s tenant or workspace; the request must remain blocked and non-observable across tenant boundaries.
- The OpenWhisk runtime is available but the public API dependency is not; the console backend action must fail cleanly rather than bypassing the public API contract.
- Audit or trace consumers inspect a console backend event; the product must identify the backend path while still preserving the original tenant, workspace, and actor attribution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST allow console backend workflows to run in OpenWhisk while consuming the same public BaaS APIs exposed to other product consumers.
- **FR-002**: The product MUST treat the public BaaS API surface as the canonical contract for console backend behavior, without introducing a separate privileged API path for the same business actions.
- **FR-003**: The product MUST preserve tenant, workspace, and actor context for every console backend request so that each action is evaluated within the correct scope.
- **FR-004**: The product MUST enforce the same authorization, tenancy, validation, quota, and policy rules for console backend requests as it does for equivalent direct public API requests.
- **FR-005**: The product MUST prevent console backend workflows from accessing or affecting data, resources, or operations outside the caller’s authorized tenant and workspace scope.
- **FR-006**: The product MUST make console backend-originated actions traceable in audit and observability outputs while retaining the original tenant, workspace, and actor attribution.
- **FR-007**: The product MUST return business-level outcomes for console backend requests that are consistent with the equivalent public API outcomes, including the same denials for unauthorized or out-of-scope actions.
- **FR-008**: The product MUST ensure that the console backend service identity is constrained to approved scopes and does not gain universal access to tenant data or privileged product operations.
- **FR-009**: The scope of this feature MUST remain limited to enabling console backend execution in OpenWhisk against the public BaaS API surface and MUST NOT define versioning, rollback, secret management, import/export, or expanded audit workflows reserved for sibling tasks.

### Key Entities *(include if feature involves data)*

- **Console Backend Workflow**: A console-owned product workflow that executes in OpenWhisk and performs user-facing or administrative backend actions.
- **Public BaaS API**: The externally available product contract used by console backend workflows and other consumers for business operations.
- **Service Identity**: The authenticated identity used by the console backend path, constrained to approved scopes and accountable in audit trails.
- **Tenant Context**: The tenant boundary associated with a request, used to isolate data, permissions, and outcomes.
- **Workspace Context**: The workspace boundary within a tenant, used to scope console backend operations and related governance.
- **Trace Record**: The observable evidence that a console backend request occurred, including the initiating path and the preserved scope attribution.

## Scope Boundaries

### In scope

- Console backend logic running in OpenWhisk.
- Console backend consumption of the same public BaaS APIs used elsewhere in the product.
- Preservation of tenant, workspace, actor, trace, and security context across the console backend path.
- Rejection of cross-tenant, out-of-scope, or privilege-escalating console backend behavior.

### Out of scope

- Function versioning and rollback behavior.
- Secret management and secure secret references.
- Function quota guardrails and quota enforcement details.
- Import/export of function and package definitions.
- Expanded deployment and administration audit workflows beyond traceability needed for this backend path.
- Implementation details for OpenWhisk packaging, runtime configuration, code structure, or deployment mechanics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least one representative console backend workflow can complete end-to-end in OpenWhisk using only the public BaaS API surface.
- **SC-002**: A console backend request cannot succeed outside the caller’s authorized tenant or workspace scope.
- **SC-003**: Equivalent allowed and denied requests produce the same business-level outcome whether they are initiated directly through the public API or through the console backend path.
- **SC-004**: Audit or observability consumers can identify console backend-originated actions and their tenant/workspace attribution without exposing unrelated tenant data.
- **SC-005**: Console backend behavior does not require a separate privileged product surface to deliver the same user-visible capability through OpenWhisk.
