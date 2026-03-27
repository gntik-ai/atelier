# Workspace Secrets and Secure Function Secret References

- **Feature branch:** `002-function-workspace-secrets`
- **Created:** 2026-03-27
- **Status:** Draft
- **Input:** User description: "Implement workspace-scoped secrets and secure secret references for governed OpenWhisk functions in the multi-tenant BaaS product. Backlog reference: US-FN-03-T02."

## 1. User Scenarios & Testing

### Primary user scenarios

1. **Workspace admin creates a secret for a workspace**
   - A workspace admin stores an opaque secret value under a workspace-scoped name.
   - The secret is available only inside that workspace boundary.

2. **Backend developer attaches a secret reference to a function**
   - A developer selects an existing secret from the same workspace and references it from a function.
   - The function can use the secret during execution without exposing the raw value.

3. **Function invocation uses the secret securely**
   - A function runs successfully when all referenced secrets exist and the caller has the right workspace access.
   - The secret value is never returned in API responses, function listings, or activation metadata.

4. **Unauthorized access is blocked**
   - A user from another workspace cannot list, reference, or resolve the secret.
   - A function cannot reference a secret that belongs to a different tenant or workspace.

5. **Secret changes remain traceable**
   - Creating, updating, deleting, or binding a secret to a function leaves a traceable record of who changed what and in which workspace.
   - The raw secret value is never included in trace records.

### Testing expectations

- **Given** a workspace admin creates a secret, **when** they fetch the secret list, **then** the secret is visible by name and metadata only, not by raw value.
- **Given** a developer binds a valid workspace secret reference to a function, **when** the function is invoked, **then** the function receives the secret securely and the value is not exposed to the caller.
- **Given** a function references a deleted or missing secret, **when** it is invoked, **then** the invocation fails with a clear non-sensitive error.
- **Given** a user attempts to reference a secret outside their workspace, **when** they save or invoke the function, **then** the platform rejects the action.
- **Given** a secret is updated, **when** the function is invoked again, **then** the function uses the currently authorized secret value for that workspace-bound reference.
- **Given** any secret operation is inspected in logs or admin views, **then** the raw secret material is never displayed.

## 2. Edge Cases

- **Duplicate secret names within the same workspace**
  - The platform must reject duplicate names in the same workspace.
  - The same name may exist in different workspaces without collision.

- **Missing or deleted secret references**
  - If a function still references a removed secret, the platform must fail safely and explain that the reference is unresolved.
  - The error must not reveal secret material or cross-workspace details.

- **Cross-tenant or cross-workspace leakage attempts**
  - A user must not be able to reference, inspect, or infer secrets from another workspace.
  - A function must not resolve secrets outside its assigned workspace context.

- **Secret value exposure attempts**
  - Secret values must not appear in API responses, UI summaries, function listings, activation records, or ordinary logs.
  - If an error occurs during secret resolution, the error must be non-sensitive.

- **Invalid secret names or references**
  - Empty names, malformed names, or unsupported reference formats must be rejected.
  - Validation feedback must be explicit enough for correction without revealing internal storage details.

- **Secret updates**
  - Updating a secret must not require changing the function reference if the reference is still valid in the same workspace.
  - Existing functions should continue to resolve the same named secret reference after an authorized update.

- **Concurrent workspace changes**
  - If a secret is deleted while a function is being prepared or invoked, the platform must fail deterministically and safely.
  - No partial secret value disclosure is allowed.

## 3. Requirements

### Functional requirements

1. **Workspace-scoped secret resource**
   - The product must support secrets that belong to exactly one workspace.
   - Secret visibility and usability must be limited to that workspace.

2. **Secret lifecycle management**
   - Authorized users must be able to create, update, list, and delete secrets within a workspace.
   - Secret metadata may be shown, but the raw secret value must never be retrievable after creation or update.

3. **Secure function secret references**
   - Functions must be able to reference workspace secrets by a secure reference, not by plaintext embedding.
   - A function may only reference secrets available in the same workspace.

4. **Authorization rules**
   - Workspace admins and other explicitly authorized workspace roles must be able to manage secrets.
   - Unauthorized users must be denied access to secret administration and secret resolution.
   - Tenant boundaries must always take precedence over workspace access.

5. **Safe runtime resolution**
   - When a function uses a secret reference, the platform must resolve it securely for execution.
   - The secret value must not be exposed to callers, function listings, or human-readable metadata.

6. **Non-disclosure guarantees**
   - Secret values must never be returned in plain form through product APIs, administrative views, logs, or activation details.
   - Error messages must remain safe for operators and users.

7. **Traceability**
   - Secret creation, update, deletion, and function binding changes must be attributable to an actor, workspace, and timestamp.
   - Traceability must not weaken secrecy by recording raw values.

8. **Consistency with existing function lifecycle**
   - This capability must fit the already delivered function lifecycle behavior from `US-FN-03-T01`.
   - Secret references must remain compatible with function deployment, listing, and invocation flows already present.

### Explicit out-of-scope requirements for this story

- Quotas, limits, and usage enforcement are not included.
- Console-backend execution in OpenWhisk is not included.
- Import/export of functions or packages is not included.
- Broader audit reporting or audit-package expansion is not included.
- Versioning and rollback behavior is not defined here beyond consuming the existing function lifecycle.

## 4. Key Entities

1. **Workspace Secret**
   - An opaque secret resource owned by exactly one workspace.
   - Identified by a workspace-scoped name and metadata.
   - Contains secret material that is never readable after storage.

2. **Secret Reference**
   - A secure pointer from a function to a workspace secret.
   - Represents intent to use a secret without embedding its value.

3. **Function Secret Binding**
   - The association between a function and one or more workspace secrets.
   - Must preserve workspace isolation and authorization rules.

4. **Secret Lifecycle Record**
   - A traceable record of secret administration actions.
   - Must capture actor, workspace, action, and time without exposing the secret value.

## 5. Success Criteria

- A workspace admin can create a secret for a workspace and later see it listed only within that workspace.
- A developer can bind a function to an existing secret reference from the same workspace.
- A function can use the referenced secret during execution without exposing the secret value to callers or in ordinary logs.
- Attempts to reference a secret from another workspace or tenant are rejected.
- If a secret is missing, deleted, or otherwise unresolved, function invocation fails safely with a clear non-sensitive error.
- Secret values are never retrievable in plaintext after creation or update.
- Secret administration actions are traceable by actor and workspace without leaking secret material.
- The story can be accepted without requiring quotas, import/export, console-backend execution, or broader audit features.

## 6. Assumptions

- The tenant/workspace model already exists and is enforced across the product.
- Function lifecycle management from `US-FN-03-T01` is already available.
- OpenWhisk is the function runtime for governed serverless execution in this product.
- Workspace roles and authorization checks already exist or are available to this feature through the product’s governance model.
- Secret values are treated as opaque sensitive data and are not intended to be displayed back to users.
- Secret versioning, rotation workflows, and advanced secret policies are not required for this story unless already present in the platform’s baseline capabilities.

## 7. Scope Boundaries

### In scope

- Workspace-scoped secret creation, update, listing, and deletion.
- Secure secret references from functions to workspace secrets.
- Workspace and tenant isolation for secret access.
- Non-disclosure of raw secret values.
- Traceable secret lifecycle actions.

### Out of scope

- `US-FN-03-T01`: Function versioning and rollback.
- `US-FN-03-T03`: Function and usage quotas.
- `US-FN-03-T04`: Console backend execution in OpenWhisk.
- `US-FN-03-T05`: Import/export of functions and packages, plus public/private web action visibility policies.
- `US-FN-03-T06`: Expanded audit package for function deployment/admin actions and rollback/quota enforcement tests.
- Broader secret-manager redesign, external vault product selection, or infrastructure provisioning details.
- Console UX implementation details beyond the behavior required to manage and use secrets safely.
