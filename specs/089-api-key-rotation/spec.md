# Feature Specification: Zero-Downtime API Key Rotation

**Feature Branch**: `089-api-key-rotation`  
**Created**: 2026-03-30  
**Status**: Draft  
**Task ID**: US-DX-02-T05  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades  
**Input**: Permitir rotación de API keys sin downtime planificado y documentar el procedimiento.

## Problem Statement

Developers and service accounts integrating with the BaaS platform rely on API keys (service account credentials) for programmatic access. Currently, rotating a credential is an atomic, immediate operation: the old key is invalidated the moment a new one is issued. This creates a hard cut-over window where any in-flight or cached requests using the previous key fail — forcing teams to coordinate deployments, drain connections, and accept brief downtime during credential rotation.

This is unacceptable for production integrations where:

- **Multiple consumers share the same service account**: A key rotation invalidates all of them simultaneously, requiring synchronised redeployment across services.
- **CI/CD pipelines and scheduled jobs** may hold the old key in environment variables or secret stores that cannot be updated atomically.
- **Compliance and security policies** require periodic key rotation (e.g., every 90 days), which should not impose planned maintenance windows.
- **Incident response** requires the ability to rotate a compromised key instantly without breaking non-compromised consumers who happen to share the same service account.

This feature introduces a **grace-period rotation model** where both the old and new credentials remain valid for a configurable overlap window, allowing consumers to transition to the new key without downtime — and provides clear, actionable documentation of the rotation procedure within the workspace developer documentation.

## User Scenarios & Testing

### User Story 1 — Rotate a Credential with Grace Period (Priority: P1)

A workspace developer or admin needs to rotate an API key for a service account. They initiate the rotation and specify a grace period during which both the old and new keys are accepted. This allows them to update all consuming applications without any failed requests during the transition.

**Why this priority**: This is the core capability that enables zero-downtime rotation. Without it, every rotation event risks breaking live integrations.

**Independent Test**: Can be verified by rotating a credential with a grace period, confirming both old and new keys authenticate successfully during the overlap, and confirming the old key stops working after the grace period expires.

**Acceptance Scenarios**:

1. **Given** a service account with an active credential in a workspace, **When** a workspace admin initiates rotation with a grace period of 60 minutes, **Then** a new credential is generated and returned, and the old credential continues to authenticate requests for 60 minutes.
2. **Given** a rotation in progress with both old and new credentials active, **When** a request arrives using the old credential within the grace period, **Then** the request is authenticated successfully and a response header indicates the credential is deprecated and will expire at a specific time.
3. **Given** a rotation in progress, **When** the grace period expires, **Then** the old credential is automatically invalidated and any subsequent request using it is rejected with an appropriate authentication error.
4. **Given** a rotation in progress, **When** the workspace admin decides to end the grace period early (force-complete), **Then** the old credential is immediately invalidated and only the new credential is accepted.
5. **Given** a workspace developer with insufficient permissions, **When** they attempt to initiate a rotation, **Then** the request is denied with a clear authorisation error.

---

### User Story 2 — Emergency Rotation without Grace Period (Priority: P1)

A workspace admin discovers that a credential may have been compromised and needs to rotate it immediately, invalidating the old key with no grace period. This is the existing atomic rotation behaviour, preserved as an explicit option.

**Why this priority**: Security incidents cannot wait for grace periods. The ability to do an immediate hard rotation is critical for incident response and must coexist with the grace-period model.

**Independent Test**: Can be verified by rotating a credential with zero grace period and confirming the old key is immediately rejected.

**Acceptance Scenarios**:

1. **Given** a service account with an active credential, **When** a workspace admin initiates rotation with zero grace period (immediate), **Then** the old credential is invalidated instantly and only the new credential is accepted.
2. **Given** a rotation initiated with zero grace period, **When** an in-flight request using the old credential arrives, **Then** the request is rejected with an authentication error.
3. **Given** an emergency rotation, **When** the action is completed, **Then** an audit event is recorded indicating the rotation was immediate (no grace period) and includes the identity of the admin who performed it.

---

### User Story 3 — View Rotation Status and History (Priority: P2)

A workspace admin wants to see which credentials are currently in a grace-period rotation, when the old key will expire, and a history of past rotations. This visibility is essential for coordinating transitions and for audit/compliance purposes.

**Why this priority**: Visibility into rotation state prevents confusion when multiple team members manage credentials and is required for compliance reporting. Depends on the rotation mechanism (US1) being in place.

**Independent Test**: Can be verified by initiating a rotation, navigating to the credential detail view, and confirming the rotation status (grace period remaining, old key expiry time, rotation history) is accurately displayed.

**Acceptance Scenarios**:

1. **Given** a credential currently in grace-period rotation, **When** a workspace admin views the credential details, **Then** they see the rotation status including: new key creation time, old key expiry time, remaining grace period, and an option to force-complete the rotation.
2. **Given** a workspace with multiple service accounts, **When** a workspace admin views the credentials list, **Then** credentials currently in rotation are visually distinguished (e.g., a status badge) from stable credentials.
3. **Given** a credential that has been rotated multiple times, **When** a workspace admin views the rotation history, **Then** they see a chronological list of past rotations including timestamps, the identity of who performed each rotation, and whether it was a grace-period or immediate rotation.

---

### User Story 4 — Access Rotation Procedure Documentation (Priority: P2)

A workspace developer wants to understand how to safely rotate API keys in their integration. The workspace's developer documentation includes a dedicated section explaining the rotation procedure, including step-by-step instructions, best practices for zero-downtime rotation, and code examples for common languages.

**Why this priority**: Documentation ensures developers can self-serve key rotation without support tickets, reducing operational overhead and improving security posture.

**Independent Test**: Can be verified by navigating to the workspace developer documentation, locating the API key rotation section, and confirming it contains step-by-step instructions, grace period explanation, and at least one code example.

**Acceptance Scenarios**:

1. **Given** a workspace developer viewing the workspace developer documentation, **When** they navigate to the credentials or security section, **Then** they find a dedicated subsection on API key rotation with step-by-step instructions.
2. **Given** the rotation documentation, **When** a developer reads it, **Then** it explains: what a grace period is, how to choose an appropriate duration, how to initiate rotation via the console and the API, how to update consuming applications, and how to verify the transition is complete.
3. **Given** the rotation documentation, **When** a developer views the code examples, **Then** at least two language examples (aligned with the SDK languages from US-DX-02-T04) demonstrate the rotation flow including: initiating rotation, retrieving the new key, updating client configuration, and confirming the old key is deprecated.
4. **Given** a workspace where the per-workspace documentation is generated (US-DX-02-T03), **When** the documentation is regenerated, **Then** the rotation procedure section is included automatically with the workspace's actual base URL and endpoint paths.

---

### User Story 5 — Configure Tenant-Level Rotation Policy (Priority: P3)

A tenant owner wants to enforce a rotation policy across all workspaces — for example, requiring that credentials be rotated at least every 90 days and setting a maximum allowed grace period. This ensures consistent security practices across the organisation.

**Why this priority**: Policy enforcement is valuable for compliance but depends on the core rotation mechanism and visibility features being in place first.

**Independent Test**: Can be verified by setting a tenant-level rotation policy, confirming that workspaces under the tenant inherit the policy, and confirming that rotation attempts violating the policy (e.g., grace period exceeding the maximum) are rejected.

**Acceptance Scenarios**:

1. **Given** a tenant owner configuring credential policies, **When** they set a maximum credential age of 90 days and a maximum grace period of 24 hours, **Then** all workspaces under the tenant inherit these limits.
2. **Given** a tenant with a maximum grace period policy of 24 hours, **When** a workspace admin attempts to rotate a credential with a 48-hour grace period, **Then** the request is rejected with a clear error explaining the tenant policy limit.
3. **Given** a tenant with a maximum credential age policy, **When** a credential approaches its maximum age, **Then** the system surfaces a warning to the credential owner and workspace admin (via console notification) indicating that rotation is required before the deadline.
4. **Given** a credential that exceeds the maximum age without being rotated, **When** the deadline passes, **Then** the system records an audit event and surfaces an urgent notification — but does NOT automatically invalidate the credential (to avoid unintended outages). Automatic invalidation is left to a future policy iteration.

---

### Edge Cases

- **Concurrent rotation attempts on the same credential**: If two admins attempt to rotate the same credential simultaneously, only one rotation succeeds; the second receives a conflict error indicating a rotation is already in progress.
- **Rotation during an active grace period**: If a credential is already in a grace-period rotation and a new rotation is initiated, the first old key is immediately invalidated (its grace period is cut short), the current active key becomes the new "old key" with a fresh grace period, and a new key is generated.
- **Grace period of zero explicitly specified**: Treated identically to an emergency/immediate rotation — the old key is invalidated instantly.
- **Service account deletion during grace period**: If a service account is deleted while one of its credentials is in grace-period rotation, all credentials (old and new) are immediately invalidated.
- **Credential used across multiple workspaces**: Credentials are scoped to a single workspace. Rotation in one workspace does not affect credentials in other workspaces, even under the same tenant.
- **Clock skew and grace period enforcement**: Grace period expiry is enforced server-side based on the platform's clock. Consumers are informed of the expiry time via response headers and the credential detail API so they can plan accordingly.
- **Maximum active credentials per service account**: The system enforces a limit on the number of simultaneously active credentials per service account. During grace-period rotation, the old and new key both count toward this limit. If the limit would be exceeded, the rotation request is rejected with a clear error.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST support credential rotation with a configurable grace period during which both the old and new credentials are valid for authentication.
- **FR-002**: The system MUST support immediate (zero grace period) credential rotation where the old credential is invalidated instantly upon new credential generation.
- **FR-003**: The system MUST automatically invalidate the old credential when the grace period expires, without requiring manual intervention.
- **FR-004**: The system MUST allow a workspace admin to force-complete an in-progress grace-period rotation, immediately invalidating the old credential.
- **FR-005**: The system MUST include a deprecation indicator (e.g., response header) when a request is authenticated with a credential that is in the deprecated phase of a grace-period rotation, including the scheduled expiry time.
- **FR-006**: The system MUST reject concurrent rotation attempts on the same credential with a conflict response indicating that a rotation is already in progress.
- **FR-007**: The system MUST record an audit event for every rotation action, including: the identity of the actor, the service account and credential affected, whether the rotation was immediate or grace-period, the grace period duration, and the timestamp.
- **FR-008**: The system MUST display the current rotation status of each credential in the console, including whether a grace-period rotation is in progress, the remaining time, and an option to force-complete.
- **FR-009**: The system MUST maintain a rotation history for each credential, accessible from the console and via the API, showing past rotations with actor identity, timestamps, and rotation type.
- **FR-010**: The system MUST include a dedicated API key rotation procedure section in the workspace's developer documentation, covering step-by-step instructions, grace period explanation, best practices, and code examples in at least two languages.
- **FR-011**: The rotation procedure documentation MUST be automatically included when workspace developer documentation is generated or regenerated (integration with US-DX-02-T03).
- **FR-012**: The system MUST enforce workspace-level RBAC on rotation actions — only principals with the appropriate credential management permission may initiate, force-complete, or view rotation details.
- **FR-013**: The system MUST enforce tenant-level rotation policies including maximum credential age and maximum allowed grace period, rejecting rotation requests that violate the policy.
- **FR-014**: The system MUST surface warnings when a credential approaches the tenant-configured maximum age, notifying the credential owner and workspace admin.
- **FR-015**: The system MUST enforce the per-service-account active credential limit during grace-period rotation, counting both old and new keys toward the limit.
- **FR-016**: The system MUST isolate credential rotation to the workspace scope — rotation of a credential in one workspace has no effect on credentials in other workspaces.
- **FR-017**: The system MUST log all credential authentication attempts (both old and new keys) during a grace-period rotation for audit traceability, distinguishing which key was used.

### Key Entities

- **ServiceAccountCredential**: An API key/secret pair associated with a service account within a workspace. Extended with rotation lifecycle attributes: rotation status (stable, rotating, deprecated), grace period expiry timestamp, predecessor credential reference, and rotation history entries.
- **RotationEvent**: An audit record capturing a single rotation action — actor identity, timestamp, rotation type (immediate or grace-period), grace period duration, and outcome.
- **TenantCredentialPolicy**: A tenant-level configuration governing credential lifecycle rules — maximum credential age, maximum grace period, and notification thresholds.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Credential rotation with a grace period can be completed with zero failed authentication requests from consumers that update their key within the overlap window.
- **SC-002**: 100% of rotation actions (initiate, force-complete, auto-expire) are captured in the workspace audit trail within 5 seconds of occurrence.
- **SC-003**: The rotation procedure documentation is discoverable within 2 clicks from the workspace developer documentation landing page.
- **SC-004**: A developer following the documented rotation procedure can complete a full key rotation (initiate, update consumer, verify) in under 10 minutes on their first attempt.
- **SC-005**: Credentials deprecated during a grace-period rotation are automatically invalidated within 60 seconds of the grace period expiry time.
- **SC-006**: Tenant-level rotation policies are enforced consistently across all workspaces under the tenant, with zero policy bypass incidents.

## Assumptions

- The existing service account and credential model (from `workspaces.openapi.json`) is the foundation for this feature. API keys are modelled as `ServiceAccountCredential` entities associated with `ServiceAccount` entities within a workspace.
- The `rotateServiceAccountCredential` operation already exists in the platform contract and currently performs atomic (immediate) rotation. This feature extends it with grace-period semantics.
- The per-workspace developer documentation system (US-DX-02-T03) provides an extensible section model where the rotation procedure documentation can be injected as a standard section.
- Storage-scoped credentials (spec 019) follow a separate credential lifecycle; this feature applies to the general-purpose workspace API keys. Alignment of rotation models across credential types is a future concern.
- Grace period enforcement relies on a server-side scheduled mechanism (e.g., background job, timer, or event-driven expiry) that is an implementation concern outside this specification's scope.

## Dependencies

- **US-DX-02-T03** (Per-workspace developer documentation): Required for the rotation procedure documentation to be included in the workspace docs.
- **US-DX-02-T04** (OpenAPI/SDK publishing): Code examples in the rotation documentation should align with the languages supported by the generated SDKs.
- **US-UI-04-T01** (Console credential management views): The rotation status display and force-complete actions integrate with the existing console credential management UI.

## Out of Scope

- Automatic credential invalidation when a tenant rotation policy deadline passes (only warnings and audit events in this iteration).
- Rotation of storage-scoped credentials (spec 019) — those follow a separate lifecycle.
- Programmatic rotation via CI/CD pipeline integrations (e.g., Vault, AWS Secrets Manager sync) — future feature.
- Bulk rotation of all credentials within a workspace or tenant in a single action.
