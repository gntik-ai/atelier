# Feature Specification: Function Deploy–Execute Privilege Separation

**Feature Branch**: `095-function-deploy-exec-separation`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Separate permissions between function deployment and function execution"  
**Traceability**: EP-18 / US-SEC-02 / US-SEC-02-T05 · RF-SEC-010, RF-SEC-011

## User Scenarios & Testing *(mandatory)*

### User Story 1 – Platform Team enforces deploy-only and execute-only roles for functions (Priority: P1)

A platform team configures the BaaS so that users who deploy serverless functions (create, update, delete, configure function packages and triggers) **cannot** invoke those functions at runtime through the same credential, and vice-versa. This separates the CI/CD pipeline identity from the application runtime identity.

**Why this priority**: Functions are the primary compute primitive in the platform. Without separating deployment from execution, a compromised deploy credential can invoke any function with arbitrary payloads, and a compromised runtime credential can replace function code. This is the foundational security guarantee of the feature.

**Independent Test**: An operator assigns the "Function Deployer" role to a CI/CD service account. That account can push new function revisions and configure triggers but receives a denial when it attempts to invoke any function. Conversely, a runtime service account with "Function Invoker" role can invoke functions but cannot deploy, update, or delete them.

**Acceptance Scenarios**:

1. **Given** a service account holds only the "Function Deployer" privilege, **When** the account attempts to invoke a function via the REST API, **Then** the request is denied with a 403 status and an audit event is recorded.
2. **Given** a service account holds only the "Function Invoker" privilege, **When** the account attempts to deploy or update a function package, **Then** the request is denied with a 403 status and an audit event is recorded.
3. **Given** a user holds both "Function Deployer" and "Function Invoker" privileges, **When** the user deploys and subsequently invokes a function, **Then** both operations succeed and each is logged under the corresponding function privilege sub-domain.

---

### User Story 2 – Tenant Owner assigns function privileges independently per workspace member (Priority: P1)

A tenant owner manages function-related privileges for workspace members through the console, granting deployment privileges and invocation privileges as separate, independent controls.

**Why this priority**: Tenant owners need granular control over who can ship code vs. who can trigger execution. Without this, least-privilege cannot be applied to the function lifecycle, and every function contributor implicitly becomes a function operator.

**Independent Test**: In the console, a tenant owner opens a workspace member's permissions panel, sees "Function Deployment" and "Function Invocation" as separate toggleable privileges, grants only invocation, and verifies the member can invoke functions but cannot deploy new versions.

**Acceptance Scenarios**:

1. **Given** a tenant owner is managing a workspace member's permissions, **When** they view the functions section, **Then** deployment and invocation privileges are displayed as separate, clearly labelled controls.
2. **Given** a tenant owner grants only "Function Invocation" to a member, **When** that member attempts to deploy a function, **Then** the action is denied and the console shows an appropriate error.
3. **Given** a tenant owner revokes "Function Deployment" from a member who previously had both privileges, **When** the member's next deploy request reaches the platform, **Then** it is denied within the privilege propagation window.

---

### User Story 3 – API keys scoped to function deployment or invocation (Priority: P2)

When creating an API key for programmatic function access, the creator can scope it to deployment operations, invocation operations, or both (within the boundaries already set by the top-level privilege domain from US-SEC-02-T04). This limits blast radius for CI/CD tokens and application runtime tokens.

**Why this priority**: API keys are the primary credential for automation pipelines and runtime integrations. Scoping each key to a specific function operation type prevents a leaked CI token from being used to invoke functions with production data, and vice-versa.

**Independent Test**: A user creates an API key selecting "Function Deployment" scope. The key can push function packages but receives 403 when invoking any function. A second key with "Function Invocation" scope behaves inversely.

**Acceptance Scenarios**:

1. **Given** an API key is created with scope "Function Deployment", **When** the key is used to invoke a function, **Then** the request returns 403 and an audit event is emitted.
2. **Given** an API key is created with scope "Function Invocation", **When** the key is used to deploy a function, **Then** the request returns 403 and an audit event is emitted.
3. **Given** a user creates an API key with both function scopes within the same top-level privilege domain, **Then** the system accepts the key and it can perform both deploy and invoke operations.

---

### User Story 4 – Superadmin audits function privilege boundary violations (Priority: P2)

A superadmin can query the audit log filtering specifically for function-privilege boundary denials — distinguishing deploy-denied-to-invoker events from invoke-denied-to-deployer events — to detect misconfigurations and potential security incidents.

**Why this priority**: Once enforcement is active (Stories 1–3), the platform team needs visibility into violations to tune roles, detect compromised credentials, and demonstrate compliance.

**Independent Test**: A superadmin queries the audit log filtering by "function deployment denied" and sees only events where invocation-only credentials attempted deployments. Switching the filter to "function invocation denied" shows only events where deploy-only credentials attempted invocations.

**Acceptance Scenarios**:

1. **Given** a superadmin opens the audit query page, **When** they filter by function privilege sub-domain = "deployment", **Then** only function-deployment-related denial events are listed with actor, resource, action, timestamp, and outcome.
2. **Given** multiple function privilege boundary violations occurred, **When** the superadmin exports the denial report, **Then** each entry clearly shows whether the denied operation was deployment or invocation, and which privilege the actor actually held.

---

### User Story 5 – Existing function permissions are migrated to the new model (Priority: P3)

When this feature is activated, users and API keys with pre-existing function access are migrated to hold both deployment and invocation privileges by default, preserving backward compatibility. Workspace owners are notified to review and tighten assignments.

**Why this priority**: Migration is essential for production safety but is a one-time operational concern. The enforcement model (Stories 1–3) and audit (Story 4) deliver the ongoing value.

**Independent Test**: After activation, a user who previously could deploy and invoke functions can still do both. The workspace owner sees a notification in the console indicating that function privileges should be reviewed. After the owner explicitly restricts the user to deploy-only, invocation requests from that user are denied.

**Acceptance Scenarios**:

1. **Given** a workspace has users with pre-existing function access, **When** the feature is activated, **Then** those users automatically receive both "Function Deployer" and "Function Invoker" privileges, and all existing operations continue to work.
2. **Given** the feature has been activated, **When** a workspace owner views the members page, **Then** they see a notification that function privileges should be reviewed and tightened.
3. **Given** a configurable review period has elapsed, **When** unrestricted function privileges remain, **Then** the system generates an informational audit event but does not forcibly restrict access.

---

### Edge Cases

- **What happens when a function trigger fires but the trigger's associated service account only has deploy privileges?** The invocation is denied. Trigger configuration must be validated to ensure the trigger's runtime identity holds invocation privileges; a warning is surfaced at trigger-creation time if the identity lacks them.
- **What happens when a function is deployed with an embedded invocation test (smoke test)?** The deployer credential must also hold invocation privileges for the smoke-test call to succeed, or the smoke test must be executed under a separate invocation-scoped credential. The system does not implicitly grant invocation during deployment.
- **What happens when the same user needs to deploy and invoke in a development/staging workspace?** The user can hold both privileges simultaneously. The separation controls who *can* do each, not that one person cannot do both. The value is that production workspaces can enforce strict separation.
- **What happens when a function-scoped API key's top-level privilege domain (from T04) does not include the structural_admin domain, but the key has "Function Deployment" scope?** Function deployment is classified under the structural_admin domain. If the key's top-level domain is data_access only, the key cannot deploy functions regardless of its function-level scope. The top-level domain from T04 is the outer boundary.
- **How does function privilege separation interact with workspace-level privilege domains (T04)?** Function deployment falls under the "structural_admin" domain and function invocation falls under the "data_access" domain. The function-level privileges in this feature are a refinement within those top-level domains, not a replacement.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define two function-specific privilege sub-domains: **Function Deployment** (create, update, delete, configure function packages, versions, and triggers) and **Function Invocation** (invoke/execute functions, view invocation results).
- **FR-002**: Function Deployment privileges MUST be classified under the "structural_admin" top-level privilege domain. Function Invocation privileges MUST be classified under the "data_access" top-level privilege domain.
- **FR-003**: The system MUST enforce function privilege sub-domain boundaries at request time: a credential lacking the required function privilege MUST receive a 403 response, even if it holds the correct top-level privilege domain.
- **FR-004**: The console MUST present function deployment and function invocation as separate, independently assignable privilege controls within the workspace member permissions panel.
- **FR-005**: A tenant owner MUST be able to grant or revoke function deployment and function invocation privileges independently for any workspace member or service account.
- **FR-006**: API key creation MUST allow the creator to select one or both function privilege sub-domains, constrained by the key's top-level privilege domain.
- **FR-007**: Every denied function privilege boundary violation MUST generate an audit event containing: actor identity, attempted operation (deploy or invoke), target function identifier, function privilege required, function privilege held, timestamp, and denial reason.
- **FR-008**: The audit log MUST support filtering by function privilege sub-domain to enable function-specific compliance queries.
- **FR-009**: When a user's function privilege assignment changes, enforcement MUST reflect the change within 60 seconds for all active sessions and tokens.
- **FR-010**: Existing users and API keys with function access MUST be migrated to hold both function privileges by default when the feature is activated.
- **FR-011**: Workspace owners MUST receive a notification prompting review of function privilege assignments after activation.
- **FR-012**: When configuring a function trigger, the system MUST validate that the trigger's runtime identity holds Function Invocation privileges and MUST surface a warning if it does not.
- **FR-013**: The system MUST respect multi-tenant isolation: function privilege assignments in one tenant MUST NOT affect another tenant.
- **FR-014**: Function privilege separation MUST be enforceable per workspace, allowing development workspaces to operate with relaxed controls while production workspaces enforce strict separation.

### Key Entities

- **Function Privilege Sub-Domain**: An enumerated classification ("function_deployment" | "function_invocation") attached to every function-related permission, role, and API key scope. Subordinate to the top-level privilege domains from US-SEC-02-T04.
- **Workspace Member Function Privilege Assignment**: The association between a workspace member (or service account) and the function-specific privileges granted. Scoped per workspace, per tenant.
- **API Key Function Scope**: An attribute of each API key indicating which function privilege sub-domains the key authorises, constrained by the key's top-level privilege domain.
- **Function Privilege Denial Event**: An audit record generated whenever a request is blocked because the actor's credential does not carry the required function privilege sub-domain.
- **Function Trigger Runtime Identity**: The service account or credential associated with a function trigger, validated at trigger-creation time for invocation privileges.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % of function-related operations are classified as either deployment or invocation before the feature is considered complete.
- **SC-002**: A credential limited to Function Deployment cannot invoke any function, and a credential limited to Function Invocation cannot deploy any function — verified by automated acceptance tests covering all function API endpoints.
- **SC-003**: Tenant owners can assign or revoke function-specific privileges for a workspace member in under 30 seconds through the console.
- **SC-004**: Function privilege denial events are queryable by superadmins within 5 seconds of occurrence.
- **SC-005**: Privilege changes propagate to active sessions within 60 seconds.
- **SC-006**: After activation, 100 % of existing function-capable users and API keys are automatically migrated to the dual-privilege default with zero service disruption.
- **SC-007**: Workspace owners receive review notifications within 24 hours of feature activation.

## Assumptions

- The top-level privilege domain model from US-SEC-02-T04 (structural_admin / data_access) is implemented and enforced before this feature is activated.
- The existing scope-enforcement APISIX plugin (093-scope-enforcement-blocking) and its extension for privilege domains (094-admin-data-privilege-separation) can be further refined to evaluate function-level privilege sub-domains without a separate plugin.
- The existing API key infrastructure (089-api-key-rotation) supports adding function-scope attributes alongside the top-level privilege domain scope.
- The audit backbone (Kafka + PostgreSQL) established in prior features is available for function privilege denial events.
- Apache OpenWhisk action metadata supports attaching privilege requirements that the gateway can evaluate at request time.

## Out of Scope

- Per-function granular permissions (e.g., "can deploy function X but not function Y") — this feature operates at the function-operation-type level across all functions in a workspace.
- Function code-signing or integrity verification — a separate concern from privilege separation.
- Rate limiting or quota enforcement on function invocations — covered by other features.
- Hardening and penetration tests for function privileges — covered by US-SEC-02-T06.
- Cross-workspace function invocation policies — a future extension.
