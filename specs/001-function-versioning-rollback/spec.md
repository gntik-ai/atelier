# Feature Specification: Function Versioning and Rollback

**Feature Branch**: `001-function-versioning-rollback`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Implement versioning and rollback of functions for OpenWhisk in the multi-tenant BaaS product, keeping scope incremental and focused on the functional behavior. Backlog reference: US-FN-03-T01."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish safe function revisions (Priority: P1)

As a backend developer or workspace administrator, I want every function update to create a distinct recoverable revision so that I can evolve function behavior without losing previously known-good states.

**Why this priority**: Without recoverable revisions, any change to a function is effectively destructive and makes later rollback, debugging, and controlled release impossible.

**Independent Test**: Publish a function, update it, and confirm the product exposes the current revision and the previous revision as separate recoverable records within the same tenant and workspace context.

**Acceptance Scenarios**:

1. **Given** an existing function in a workspace, **When** an authorized operator publishes an update, **Then** the product records a new version entry and keeps the prior version available in the function history.
2. **Given** a function with multiple published versions, **When** an authorized operator views that function, **Then** they can identify which version is currently active and which versions are older recoverable revisions.

---

### User Story 2 - Restore a prior known-good function state (Priority: P2)

As a workspace administrator, I want to roll back a function to a previous stable version so that I can recover quickly from regressions without rebuilding the prior behavior manually.

**Why this priority**: Version history only creates product value if operators can use it to restore service quickly when a release degrades behavior.

**Independent Test**: Start from a function with at least two published versions, trigger a rollback to an older version, and verify the selected older version becomes the active runtime state while the overall history remains intact.

**Acceptance Scenarios**:

1. **Given** a function with at least one prior version, **When** an authorized operator requests rollback to a selected earlier version, **Then** the selected version becomes the current active version for future invocations.
2. **Given** a function with historical versions, **When** rollback succeeds, **Then** the product preserves a complete version timeline instead of erasing newer historical entries.

---

### User Story 3 - Govern rollback visibility and safety across tenants and workspaces (Priority: P3)

As a tenant owner or superadmin, I want version history and rollback actions to remain scoped to the correct tenant and workspace so that one customer cannot view or alter another customer’s function lifecycle.

**Why this priority**: Function lifecycle controls affect active runtime behavior, so governance and isolation are as important as the lifecycle action itself.

**Independent Test**: Attempt to list or roll back function versions across tenant or workspace boundaries and confirm the product only exposes authorized records and actions inside the caller’s scope.

**Acceptance Scenarios**:

1. **Given** a user operating inside one tenant or workspace context, **When** they request version history for a function outside their scope, **Then** the product denies access and reveals no cross-scope revision details.
2. **Given** a user without rollback permission, **When** they attempt to restore a previous version, **Then** the product rejects the action without changing the active function version.

### Edge Cases

- A function has only one published version and therefore no valid rollback target.
- An operator attempts to roll back to a version that has been retired from the visible history or is otherwise unavailable.
- Two operators try to publish or roll back the same function near the same time.
- The currently active version is already the selected rollback target.
- A function update changes runtime configuration and the operator expects the previous configuration to be restored together with the previous code behavior.
- A caller can view function metadata but lacks permission to execute rollback.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST create a distinct function version record whenever an authorized operator publishes a change that alters the function’s deployable state.
- **FR-002**: The product MUST preserve prior function versions as recoverable history instead of replacing them destructively.
- **FR-003**: The product MUST expose, for each function, which version is currently active and which versions are historical.
- **FR-004**: The product MUST allow an authorized operator to request rollback of a function to a selected prior version within the same tenant and workspace scope.
- **FR-005**: The product MUST make the selected rollback target become the active version used for future executions after a successful rollback.
- **FR-006**: The product MUST preserve the function’s version history after rollback so operators can understand the lifecycle before and after the restore action.
- **FR-007**: The product MUST prevent rollback when no valid prior version exists.
- **FR-008**: The product MUST restrict version listing and rollback actions according to tenant, workspace, and role permissions.
- **FR-009**: The product MUST prevent any version history visibility or rollback action from crossing tenant or workspace boundaries.
- **FR-010**: The product MUST expose enough lifecycle metadata for operators to distinguish versions by creation order, status, and rollback eligibility.
- **FR-011**: The product MUST communicate rollback outcomes clearly, including when a request is rejected because the target version is invalid, unavailable, already active, or outside the caller’s permissions.
- **FR-012**: The scope of this feature MUST remain limited to function versioning and rollback behavior and MUST NOT introduce new secret-management, quota-enforcement, console-backend orchestration, import/export, or broader audit features reserved for sibling tasks under US-FN-03.

### Key Entities *(include if feature involves data)*

- **Function**: A deployable serverless unit owned by a tenant and scoped to a workspace, with one active runtime state and a governed lifecycle.
- **Function Version**: An immutable recoverable revision of a function’s deployable state, identified within the function’s lifecycle history.
- **Rollback Request**: An operator-initiated action that promotes a selected prior function version back to active use.
- **Version Timeline Entry**: The lifecycle record that allows operators to understand the order, status, and recoverability of function revisions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can view at least the current version and one prior version for any function that has been updated more than once.
- **SC-002**: An authorized rollback request can restore a selected prior version to active use in one operator flow without requiring manual recreation of the older function state.
- **SC-003**: Unauthorized users receive no successful rollback capability and no cross-tenant or cross-workspace access to function version history.
- **SC-004**: Functions with no valid rollback target are clearly reported as non-rollbackable instead of failing ambiguously.
- **SC-005**: After rollback, operators can still inspect the full version timeline needed to understand what version was active before and after the restore action.

## Assumptions

- Function publish operations already exist through the product and can be extended to produce version history for this task.
- Existing identity and authorization behavior can distinguish users who may view lifecycle history from users who may perform rollback.
- This task covers product-level lifecycle behavior for managed functions and does not require public exposure of provider-native lifecycle semantics beyond what the product chooses to surface.

## Scope Boundaries

- In scope: version creation, version history visibility, rollback eligibility, rollback execution behavior, and permission/isolation rules for those operations.
- Out of scope: secret injection, quotas, backend console workflows running in functions, import/export of definitions, public/private visibility policies for web actions, and comprehensive audit/reporting enhancements beyond the minimum behavior needed to describe rollback results.
