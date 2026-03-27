# Feature Specification: Function and Package Import/Export with Web Action Visibility Policies

**Feature Branch**: `005-function-import-export-visibility`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Implement import/export of function and package definitions plus public/private web action visibility policies. Backlog reference: US-FN-03-T05."

## 1. User Scenarios & Testing

### Primary user scenarios

1. **Workspace operators export reusable function and package definitions**
   - A tenant owner, workspace admin, or authorized developer exports a function or package definition from their own workspace.
   - The exported artifact can be moved or reviewed without exposing unrelated runtime state.

2. **Workspace operators import definitions into a governed workspace**
   - A tenant owner, workspace admin, or authorized developer imports a definition bundle into the correct tenant and workspace context.
   - The imported function or package becomes available with the expected name, metadata, and workspace scoping rules.

3. **Developers govern web action exposure as public or private**
   - A backend developer marks a web action as public or private according to product policy.
   - The visibility choice controls whether the action is externally reachable or restricted to authorized product paths.

4. **Cross-scope import/export attempts are blocked**
   - A user tries to import or export definitions outside their tenant or workspace scope.
   - The product refuses the action and does not reveal cross-scope definitions.

5. **Visibility policy remains consistent on import, export, and listing**
   - The visibility of a web action survives round-trip handling through export and import.
   - The product presents the same public/private intent in listings and operational checks.

### Testing expectations

- **Given** an authorized operator exports a function or package definition, **when** the export completes, **then** the output contains the definition data needed to recreate that resource within the same product model without exposing unrelated runtime state.
- **Given** an authorized operator imports a valid function or package definition bundle into a workspace, **when** the import succeeds, **then** the resource is created in that tenant and workspace with the expected definition attributes.
- **Given** a web action is marked public, **when** it is exported and imported, **then** the visibility remains public unless a policy restriction requires the import to be rejected.
- **Given** a web action is marked private, **when** it is exported and imported, **then** the visibility remains private and the action does not become broadly reachable by accident.
- **Given** a user without access to a tenant or workspace attempts to import or export definitions there, **when** the request is evaluated, **then** the product denies it without revealing the hidden definitions.
- **Given** a bundle contains unsupported or conflicting visibility information, **when** it is imported, **then** the product rejects the bundle clearly instead of silently changing the policy.

## 2. Edge Cases

- **A package contains multiple actions with mixed visibility rules**
  - The product must preserve each action’s declared public/private state independently.

- **An import collides with an existing function or package name in the target workspace**
  - The product must reject or require an explicit resolution path rather than overwriting silently.

- **A bundle references definitions outside the target tenant or workspace**
  - The product must reject the import and avoid leaking cross-scope resource details.

- **A web action is imported into a workspace that does not allow public exposure**
  - The product must reject or constrain the action according to policy, and it must not silently widen exposure.

- **A definition export includes metadata that is safe to share but not runtime-sensitive state**
  - The product must include only the definition-level information needed for reconstruction and governance.

- **An action is private at export time but is expected to remain private after import**
  - The product must treat private visibility as a preserved policy unless an explicit, authorized change is made later.

- **A package-level definition is imported while one contained action has unsupported web exposure settings**
  - The product must report the specific policy conflict and avoid partially applying a misleading visibility state.

## 3. Requirements

### Functional requirements

1. **Definition export support**
   - The product MUST allow authorized users to export function and package definitions from within their tenant and workspace scope.
   - The exported representation MUST contain enough definition data to recreate the resource behaviorally in another compatible workspace context.

2. **Definition import support**
   - The product MUST allow authorized users to import function and package definitions into a target tenant and workspace.
   - The product MUST validate the imported definitions before making them active in the target scope.

3. **Workspace and tenant isolation**
   - The product MUST restrict import and export operations to the caller’s authorized tenant and workspace boundaries.
   - The product MUST prevent any import or export from exposing definitions outside the caller’s scope.

4. **Web action visibility policy**
   - The product MUST support public and private visibility states for web actions.
   - The product MUST preserve the declared visibility state when a supported action definition is exported and later imported.

5. **Policy enforcement on exposure**
   - The product MUST treat public web actions as intentionally exposed through the product’s supported web-action surface.
   - The product MUST treat private web actions as restricted and MUST not expose them as public merely because they were exported or imported.

6. **Conflict handling**
   - The product MUST detect collisions, unsupported definitions, and visibility-policy conflicts during import.
   - The product MUST reject invalid imports with a clear non-sensitive explanation rather than silently mutating the definitions.

7. **Round-trip consistency**
   - The product MUST preserve function and package naming, hierarchy, and visibility intent across export and import when the target scope permits it.
   - The product MUST avoid introducing extra lifecycle meaning such as versioning or rollback semantics in the import/export flow.

8. **Scope-safe metadata**
   - The product MUST avoid including secrets, execution activations, quota state, audit expansions, or other unrelated operational data in the definition export.
   - The product MUST avoid leaking cross-tenant identifiers or hidden resource references beyond what is required for governed import/export behavior.

9. **Authorization clarity**
   - The product MUST require authorization appropriate to the caller’s role for import and export actions.
   - The product MUST deny unauthorized attempts without exposing whether hidden resources exist in other scopes.

10. **Feature boundary**
    - The scope of this feature MUST remain limited to import/export of function and package definitions plus public/private web action visibility policies and MUST NOT introduce versioning, rollback, secret management, quota enforcement, console-backend execution, or expanded audit workflows reserved for sibling tasks.

### Key Entities

- **Function Definition**: The user-facing definition of a serverless function, including its name, scope, and exposure policy where applicable.
- **Package Definition**: A grouped definition that organizes functions and related metadata within a workspace.
- **Import Bundle**: The structured payload used to recreate function or package definitions in a target scope.
- **Export Bundle**: The structured payload produced from an existing function or package definition for movement or backup.
- **Web Action Visibility Policy**: The rule that determines whether a web action is public or private.
- **Definition Collision**: A conflict that occurs when an imported definition would duplicate or clash with an existing scoped resource.

## 4. Success Criteria

### Measurable Outcomes

- **SC-001**: An authorized user can export a function or package definition from their own workspace and import it into a permitted target workspace using the product’s definition contract.
- **SC-002**: A public web action remains public and a private web action remains private after a supported export/import round trip.
- **SC-003**: Import attempts that cross tenant or workspace boundaries are rejected without exposing hidden definitions.
- **SC-004**: Invalid imports with name collisions or unsupported visibility combinations are rejected clearly rather than applied partially or silently altered.
- **SC-005**: Definition exports do not include unrelated runtime-sensitive data such as secrets, activations, quota state, or lifecycle features outside this task’s scope.
- **SC-006**: The product can distinguish exportable/importable definition data from other OpenWhisk lifecycle concerns, keeping this feature independently testable and independently releasable.

## 5. Assumptions

- Tenant and workspace boundaries already exist and are enforced by the product.
- Function and package resources already have a stable definition model that can be exported and imported without redefining the underlying runtime platform.
- Web actions already have a product-level notion of public versus private exposure or can represent it within the definition model used by this feature.
- This feature does not need to introduce new storage formats, code generation rules, or runtime packaging choices beyond what is necessary to express the product behavior.

## 6. Scope Boundaries

### In scope

- Export of function definitions.
- Export of package definitions.
- Import of function definitions.
- Import of package definitions.
- Public/private visibility policies for web actions.
- Validation and enforcement of import/export behavior within tenant and workspace scope.

### Out of scope

- `US-FN-03-T01`: Function versioning and rollback.
- `US-FN-03-T02`: Workspace secrets and secure secret references.
- `US-FN-03-T03`: Function and usage quotas.
- `US-FN-03-T04`: Console backend execution in OpenWhisk consuming the same public APIs.
- `US-FN-03-T06`: Expanded audit coverage for deployment, administration, rollback, and quota enforcement evidence.
- Runtime execution semantics, activation history, observability tuning, rollback behavior, secret material handling, quota enforcement, or console-backend orchestration.
