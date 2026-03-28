# Feature Specification: Scoped Programmatic Storage Credentials

**Feature Branch**: `019-storage-scoped-access-credentials`
**Task**: US-STO-03-T01
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-03 — Credenciales programáticas, uso agregado, import/export y auditoría de storage
**Requirements traceability**: RF-STO-015, RF-STO-016, RF-STO-017, RF-STO-018
**Dependencies**: US-STO-01 (full chain: specs 007–012), US-OBS-03
**Created**: 2026-03-28
**Status**: Specified

## Repo-local dependency map

| Concern | Module / Path | Relevance |
|---|---|---|
| Tenant storage context & platform credentials | `services/adapters/src/storage-tenant-context.mjs` | Provides `buildTenantStorageContextRecord`, `rotateTenantStorageContextCredential`, `previewWorkspaceStorageBootstrap`. Scoped credentials extend this with per-principal key pairs. |
| Bucket policies & access evaluation | `services/adapters/src/storage-access-policy.mjs` | `evaluateStorageAccessDecision`, `STORAGE_POLICY_ACTIONS`, `STORAGE_POLICY_PRINCIPAL_TYPES` (includes `SERVICE_ACCOUNT`). Credential scope validation must reference the same action vocabulary. |
| Provider abstraction & profile | `services/adapters/src/storage-provider-profile.mjs` | Provider-level admin API abstraction for creating sub-account credentials on MinIO / Ceph RGW / Garage. |
| Bucket & object operations | `services/adapters/src/storage-bucket-object-ops.mjs` | Data-plane operations that scoped credentials will authorize. |
| Storage admin control plane | `apps/control-plane/src/storage-admin.mjs` | Admin surface that already re-exports tenant context, bucket ops, policy, and provider profile. Credential management endpoints will be added here. |
| IAM & external applications | `apps/control-plane/src/external-application-iam.mjs`, `apps/control-plane/src/iam-admin.mjs` | Existing IAM patterns for service accounts and external app identity; credential issuance should follow consistent patterns. |
| Error taxonomy | `services/adapters/src/storage-error-taxonomy.mjs` | Normalized error codes and audit-event builders for storage errors; new credential-specific errors should extend this taxonomy. |
| Event notifications | `services/adapters/src/storage-event-notifications.mjs` | Credential lifecycle events should follow the same event structure conventions. |
| Capacity quotas | `services/adapters/src/storage-capacity-quotas.mjs` | Governance limits pattern (per-tenant, per-workspace) to reuse for credential count limits. |
| Existing tests | `tests/unit/storage-access-policy.test.mjs`, `tests/unit/storage-admin.test.mjs`, `tests/adapters/storage-access-policy.test.mjs` | Test patterns and runner conventions (`node --test`). |

---

## 1. Objective and Problem Statement

The storage subsystem provisions **platform-managed credentials** during tenant and workspace creation (spec `008`). These credentials are internal: used by the platform to operate on the S3-compatible provider on behalf of a tenant. There is currently no mechanism for **developers and service accounts** to obtain their own scoped, rotatable, revocable credentials for direct programmatic access to storage resources.

Without this task:

- Developers who need to interact with storage from external tooling, CI/CD pipelines, or custom services must either route everything through the platform API or share the workspace's internal credentials — both unacceptable for security and auditability.
- Service accounts registered in a workspace (spec `014`, User Story 5) have no way to obtain dedicated storage credentials whose scope can be narrower than the workspace-level permission set.
- Credential revocation is all-or-nothing at the tenant lifecycle level (suspend/delete). There is no fine-grained revocation of individual programmatic credentials without affecting the entire tenant or workspace.
- Audit trail cannot distinguish between operations performed by different developers or service accounts within the same workspace, because they share the same underlying platform credential.

This task introduces **scoped programmatic storage credentials** — individually issued, permission-bounded, rotatable, and revocable access key pairs that grant direct S3-compatible API access within the boundaries enforced by the tenant/workspace/bucket permission model.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Developers** in a workspace need dedicated access key pairs to interact with storage from external tools (SDKs, CLI, CI/CD pipelines) without sharing or exposing the workspace's internal platform credentials. They receive traceable, individually revocable access scoped to the buckets and operations they need.
- **Service accounts** (machine identities) need dedicated credentials whose scope can be restricted to specific buckets or operations, enabling least-privilege access for automated workloads.
- **Workspace admins** need to govern who holds programmatic credentials, what scope each credential has, and the ability to revoke any credential at any time without affecting other credential holders in the workspace.
- **Tenant owners** need visibility over all programmatic credentials issued across their workspaces and the ability to enforce tenant-wide credential policies (e.g., maximum active credentials per principal, mandatory expiration).
- **Superadmins** need the ability to revoke credentials across tenants for incident response and compliance enforcement.

### Value delivered

- Enables secure, direct S3-compatible API access from external tooling without exposing platform-internal credentials.
- Provides per-principal audit traceability: every storage operation performed with a programmatic credential is attributable to the specific principal who owns it.
- Supports least-privilege through scope constraints that limit each credential to a subset of the permissions the owning principal already holds.
- Credential lifecycle (create, rotate, revoke, expire) is fully managed without impacting other credentials, workspaces, or the tenant's storage context.

---

## 3. In-Scope Capability

This task covers the **creation, scope enforcement, rotation, revocation, expiration, and audit trail** of programmatic storage credentials scoped to tenant/workspace boundaries.

### In scope

- Issuing scoped access key pairs to workspace developers and service accounts.
- Scope definition: each credential specifies the maximum set of storage permissions it grants, which must be a subset of the permissions the owning principal already holds via workspace-level defaults and bucket policies (specs `014`).
- Optional bucket restriction: a credential can be restricted to one or more specific buckets within the workspace.
- Credential rotation: issuing a new key pair for an existing credential definition without revoking the old one until the rotation is confirmed.
- Credential revocation: immediate, permanent invalidation of a specific credential.
- Credential expiration: optional time-bound validity that auto-revokes the credential after the specified duration.
- Cascading revocation: all programmatic credentials within a workspace or tenant are revoked when the workspace or tenant is suspended or deleted.
- Credential introspection: workspace admins and tenant owners can list, inspect status, and audit programmatic credentials within their scope.
- Audit events for all credential lifecycle operations (creation, rotation, revocation, expiration) and for storage operations performed using a programmatic credential.
- Tenant-level governance: configurable limits on maximum active credentials per principal and per workspace.

### Out of scope

- **US-STO-03-T02**: Usage aggregation and per-bucket consumption reporting.
- **US-STO-03-T03**: Object and metadata import/export.
- **US-STO-03-T04**: Audit of data-plane storage operations (this task covers audit of credential lifecycle and attribution of data-plane operations to credential holders, but the full data-plane audit schema is T04).
- **US-STO-03-T05**: Credential rotation/revocation test suite (dedicated testing task).
- **US-STO-03-T06**: Documentation of limits, SLAs, and cost considerations.
- Console UI for credential management (future task; this spec covers API behavior only).
- Credential federation with external identity providers (e.g., OIDC-to-S3-credential exchange).

---

## 4. User Scenarios & Testing

### User Story 1 — Developer creates a scoped programmatic credential (Priority: P1)

A developer who is a member of a workspace creates a programmatic storage credential scoped to specific storage permissions and optionally restricted to specific buckets. The credential is an access key pair that can be used for direct S3-compatible API access within the granted scope.

**Why this priority**: This is the foundational capability — without credential issuance, no other credential lifecycle operation is meaningful.

**Independent Test**: A workspace developer requests a new programmatic credential with a defined permission scope, receives an access key pair, and can use it for S3-compatible operations within that scope. Operations outside the scope are denied.

**Acceptance Scenarios**:

1. **Given** a developer is a member of workspace W in tenant T and has `object.get` and `object.list` permissions via workspace defaults, **When** the developer requests a programmatic credential scoped to `object.get` and `object.list`, **Then** the platform issues an access key pair, records the credential metadata (owner, scope, creation time, workspace, tenant), and the credential is immediately usable for S3-compatible `GetObject` and `ListObjects` operations on buckets in workspace W.
2. **Given** the same developer from scenario 1, **When** the developer attempts to create a credential scoped to `object.delete` (a permission the developer does not hold), **Then** the request is rejected with an error indicating the requested scope exceeds the principal's effective permissions.
3. **Given** a developer requests a credential restricted to bucket B1 only, **When** the credential is used against bucket B2 in the same workspace, **Then** the operation is denied with a clear error identifying the bucket restriction.
4. **Given** a developer requests a credential with an expiration of 24 hours, **When** the credential is issued, **Then** the credential metadata includes the expiration timestamp and the credential becomes non-functional after that time.

---

### User Story 2 — Service account obtains a least-privilege credential (Priority: P1)

A service account registered in a workspace (as defined in spec `014`, User Story 5) obtains a programmatic credential whose scope is restricted to the minimum operations needed for its automated workload.

**Why this priority**: Service accounts are the primary consumers of programmatic credentials for automated workloads. Least-privilege credentialing is a security fundamental.

**Independent Test**: A service account is issued a credential scoped to `object.put` on a single bucket, and can upload objects to that bucket but cannot list, get, or delete objects, nor access any other bucket.

**Acceptance Scenarios**:

1. **Given** a service account SA has workspace-level permissions for `object.put`, `object.get`, and `object.list`, **When** a workspace admin creates a programmatic credential for SA scoped to `object.put` on bucket B1 only, **Then** the credential allows `PutObject` on B1 but denies `GetObject`, `ListObjects`, and any operation on other buckets.
2. **Given** a service account has a programmatic credential, **When** the service account's workspace-level permissions are reduced (e.g., `object.put` is removed from its workspace permission set), **Then** the programmatic credential's effective permissions are also reduced — the credential cannot grant more than the principal currently holds.

---

### User Story 3 — Workspace admin revokes a specific credential (Priority: P1)

A workspace admin can immediately revoke any programmatic credential issued within their workspace, rendering it non-functional without affecting other credentials in the workspace.

**Why this priority**: Revocation is a security-critical lifecycle operation. Without it, compromised or unnecessary credentials cannot be neutralized.

**Independent Test**: A workspace admin revokes a specific credential by its identifier, and subsequent S3-compatible operations using that credential are denied, while other credentials in the same workspace remain functional.

**Acceptance Scenarios**:

1. **Given** workspace W has two active programmatic credentials C1 (held by developer D1) and C2 (held by developer D2), **When** the workspace admin revokes C1, **Then** operations using C1 are denied immediately, operations using C2 remain functional, and an audit event records the revocation with the admin's identity, the credential identifier, and a timestamp.
2. **Given** a credential has been revoked, **When** the former holder attempts to use it, **Then** the storage provider returns an authentication/authorization error and the platform records the failed attempt in the audit log.
3. **Given** a credential has been revoked, **When** the former holder requests a new credential, **Then** a new credential can be issued (revocation does not ban the principal).

---

### User Story 4 — Credential rotation without downtime (Priority: P1)

A credential holder or workspace admin can rotate a credential — issue a new access key pair for the same scope definition — with a grace period during which both the old and new key pairs are valid, preventing downtime for automated workloads.

**Why this priority**: Credential rotation is a security hygiene fundamental. Without a grace period, rotation causes unavoidable downtime for consumers that cannot atomically switch credentials.

**Independent Test**: A rotation is initiated, both old and new key pairs are functional during the grace period, and after the rotation is confirmed (or the grace period expires), only the new key pair works.

**Acceptance Scenarios**:

1. **Given** credential C1 is active, **When** the holder initiates rotation, **Then** the platform issues a new key pair C1' associated with the same credential definition and scope, and both C1 and C1' are functional.
2. **Given** rotation is in progress with C1 and C1' both active, **When** the holder confirms the rotation, **Then** C1 is permanently revoked and only C1' remains functional.
3. **Given** rotation is in progress, **When** the grace period expires without confirmation, **Then** the old key pair C1 is automatically revoked and the new key pair C1' remains functional.
4. **Given** rotation is in progress, **When** a second rotation is attempted on the same credential, **Then** the request is rejected until the current rotation is completed or the grace period expires.

---

### User Story 5 — Cascading revocation on workspace/tenant lifecycle events (Priority: P1)

When a workspace is suspended or a tenant is suspended/deleted, all programmatic credentials within that scope are automatically revoked.

**Why this priority**: Cascading revocation is a mandatory multi-tenant isolation guarantee. Without it, credentials from suspended or deleted contexts could remain active.

**Independent Test**: A workspace is suspended and all its programmatic credentials become non-functional. A tenant is suspended and all credentials across all its workspaces become non-functional.

**Acceptance Scenarios**:

1. **Given** workspace W has active programmatic credentials C1, C2, and C3, **When** workspace W is suspended, **Then** all three credentials become non-functional immediately, and audit events record the cascading revocation with the triggering lifecycle event.
2. **Given** workspace W was suspended and is then reactivated, **When** the former credential holders attempt to use C1, C2, and C3, **Then** the credentials remain revoked — reactivation does not restore previously revoked credentials. New credentials must be issued.
3. **Given** tenant T has workspaces W1 and W2, each with active credentials, **When** tenant T is soft-deleted, **Then** all credentials across W1 and W2 are permanently revoked and cannot be restored.

---

### User Story 6 — Tenant owner inspects and governs credentials across workspaces (Priority: P2)

A tenant owner can list all programmatic credentials across their workspaces, inspect each credential's scope and status, and enforce tenant-level limits (maximum active credentials per principal, per workspace).

**Why this priority**: Governance visibility is essential for security posture management, but the issuance and revocation primitives (P1 stories) must exist first.

**Independent Test**: A tenant owner lists all credentials across workspaces, sees each credential's owner, scope, status, and creation date. The tenant owner sets a limit of 3 active credentials per principal, and a 4th creation attempt is rejected.

**Acceptance Scenarios**:

1. **Given** tenant T has 3 workspaces with a total of 7 active credentials, **When** the tenant owner lists credentials, **Then** the response includes all 7 credentials with their owner, workspace, scope summary, status, creation date, and expiration (if set), without exposing the secret key material.
2. **Given** a tenant-level policy limits active credentials per principal to 3, **When** developer D (who already has 3 active credentials) requests a 4th, **Then** the request is rejected with an error referencing the tenant-level limit.
3. **Given** a tenant-level policy limits active credentials per workspace to 10, **When** the 11th credential creation is attempted in workspace W, **Then** the request is rejected with an error referencing the workspace-level limit.

---

### User Story 7 — Superadmin cross-tenant credential revocation (Priority: P2)

A superadmin can list and revoke programmatic credentials across any tenant for incident response and compliance enforcement.

**Why this priority**: Cross-tenant revocation is a platform-safety capability needed for incident response. It is less frequent than tenant/workspace-level operations.

**Independent Test**: A superadmin lists credentials across tenants, revokes a specific credential in a tenant they do not own, and the revocation is effective and audited.

**Acceptance Scenarios**:

1. **Given** a superadmin identifies a compromised credential C1 in tenant T, **When** the superadmin revokes C1, **Then** C1 becomes non-functional immediately, an audit event records the cross-tenant revocation with the superadmin's identity, and the tenant owner is not required to authorize the revocation.
2. **Given** a superadmin revokes a credential, **When** the audit log is inspected, **Then** the event includes the superadmin's identity, the target credential, the target tenant and workspace, the reason (if provided), and a timestamp.

---

### Edge Cases

- **Principal removed from workspace**: When a developer or service account is removed from a workspace, all their programmatic credentials for that workspace MUST be automatically revoked.
- **Scope escalation via workspace permission change**: If a principal's workspace-level permissions increase after a credential is issued, the credential's scope does NOT automatically expand — it remains bounded to the scope defined at issuance. A new credential must be created to take advantage of expanded permissions.
- **Bucket deletion**: When a bucket is deleted, any credentials restricted to only that bucket become effectively useless (no accessible resources), but the credential itself remains in `active` state. Operations return appropriate "bucket not found" errors, not credential errors.
- **Concurrent rotation and revocation**: If a credential is revoked while a rotation is in progress, both the old and new key pairs are revoked immediately.
- **Expired credential cleanup**: Expired credentials transition to a terminal `expired` state and are no longer listed in active credential inventories, but their metadata remains available for audit queries.
- **Maximum credential limits reached during rotation**: A rotation-in-progress temporarily creates a second active key pair. This temporary state MUST NOT count against the credential limit — limits apply to credential definitions, not individual key pairs.
- **Cross-workspace credential reuse attempt**: A credential issued for workspace W1 MUST NOT be usable for operations in workspace W2, even if both workspaces belong to the same tenant and the principal is a member of both.

---

## 5. Functional Requirements

### Credential Lifecycle

- **FR-001**: The system MUST allow workspace members (developers and service accounts) to create programmatic storage credentials scoped to a subset of their effective storage permissions within a workspace.
- **FR-002**: Each programmatic credential MUST consist of an access key identifier and a secret access key, compatible with S3 Signature V4 authentication.
- **FR-003**: The secret access key MUST be returned exactly once — at creation time. It MUST NOT be retrievable, logged, or stored in reversible form after initial issuance.
- **FR-004**: Each credential MUST record: owning principal (developer or service account), owning workspace, owning tenant, permission scope, optional bucket restriction list, creation timestamp, optional expiration timestamp, and lifecycle state.
- **FR-005**: The system MUST support credential rotation: issuing a new key pair for an existing credential definition with a configurable grace period (platform default and optional override by the requester, subject to a platform-defined maximum).
- **FR-006**: The system MUST support immediate revocation of any specific credential by a workspace admin, tenant owner, superadmin, or the credential's owner.
- **FR-007**: The system MUST automatically revoke all programmatic credentials belonging to a principal when that principal is removed from the workspace.
- **FR-008**: The system MUST automatically revoke all programmatic credentials within a workspace when the workspace is suspended or deleted, and within a tenant when the tenant is suspended or soft-deleted.
- **FR-009**: Reactivation of a suspended workspace or tenant MUST NOT restore previously revoked credentials. New credentials must be explicitly created.

### Scope Enforcement

- **FR-010**: A credential's permission scope MUST be validated at issuance to be a subset of the owning principal's effective permissions (derived from workspace defaults and bucket policies per specs `014`).
- **FR-011**: If the owning principal's effective permissions are reduced after credential issuance, the credential's runtime effective scope MUST be the intersection of its defined scope and the principal's current effective permissions.
- **FR-012**: A credential optionally restricted to specific buckets MUST reject operations targeting any bucket not in the restriction list.
- **FR-013**: A credential issued for one workspace MUST NOT be usable for operations in any other workspace, even within the same tenant.

### Governance

- **FR-014**: Tenant owners MUST be able to configure a maximum number of active credential definitions per principal and per workspace. The platform MUST enforce a system-wide default if no tenant-level configuration exists.
- **FR-015**: Workspace admins MUST be able to list all active and recently revoked/expired credentials within their workspace, with metadata but without secret key material.
- **FR-016**: Tenant owners MUST be able to list all credentials across their workspaces with the same visibility as workspace admins.
- **FR-017**: Superadmins MUST be able to list and revoke credentials across any tenant.

### Audit

- **FR-018**: Every credential lifecycle event (creation, rotation initiation, rotation confirmation, rotation grace-period expiry, explicit revocation, automatic revocation via lifecycle cascade, expiration) MUST produce an audit event including the acting principal, target credential identifier, target workspace, target tenant, and a timestamp.
- **FR-019**: Every storage data-plane operation performed using a programmatic credential MUST be attributable to the specific credential (and therefore to its owning principal) in the audit trail.
- **FR-020**: Audit events MUST NOT contain secret key material.

### Multi-Tenant Isolation

- **FR-021**: Programmatic credentials MUST be fully isolated by tenant. No credential, credential metadata, or credential-related audit event from one tenant is visible or accessible to another tenant.
- **FR-022**: Within a tenant, credential visibility follows the workspace boundary: workspace admins see only their workspace's credentials unless they also hold tenant-owner or superadmin roles.

### Key Entities

- **Programmatic Storage Credential**: A managed access key pair that grants scoped S3-compatible API access. Key attributes: unique credential identifier, access key ID, permission scope, optional bucket restrictions, owning principal reference, owning workspace, owning tenant, lifecycle state (`active`, `rotating`, `revoked`, `expired`), creation timestamp, optional expiration, rotation grace-period metadata.
- **Credential Scope**: The declared set of storage permissions and optional bucket restrictions that bound what a credential can do. Always a subset of the owning principal's effective permissions at issuance time.
- **Credential Lifecycle Event**: An immutable audit record of a credential state transition, attributable to a specific actor.

---

## 6. Business Rules and Governance

- The permission model for bucket policies and workspace-level defaults (spec `014`) is the authoritative source for what a principal can do. Programmatic credentials can only narrow that authority, never widen it.
- Secret key material follows a write-once-read-once model: displayed at creation, never again. If lost, the credential must be rotated or revoked and re-created.
- Credential limits are governance tools, not security mechanisms. They prevent sprawl, not abuse — abuse is addressed through revocation and audit.
- Cascading revocation is immediate and irreversible. There is no "undo" for lifecycle-driven revocation.
- The grace period during rotation is a convenience for zero-downtime migration. It is time-bounded and auto-resolves — the platform will not maintain dual active key pairs indefinitely.
- Credential metadata (excluding secret key material) must be retained for audit purposes even after revocation or expiration, subject to the platform's data-retention policy.

---

## 7. Acceptance Criteria

1. A workspace developer can create a programmatic credential scoped to a subset of their effective storage permissions and use the resulting access key pair for S3-compatible API access within that scope.
2. A service account can be issued a credential restricted to specific buckets and operations, enforcing least-privilege access.
3. A credential whose scope exceeds the principal's effective permissions is rejected at issuance.
4. A credential's runtime effective scope is the intersection of its defined scope and the principal's current effective permissions — permission reduction is reflected immediately.
5. A workspace admin can revoke any credential in their workspace immediately, rendering it non-functional without affecting other credentials.
6. Credential rotation issues a new key pair with a grace period; both key pairs work during the grace period; the old key pair is revoked when the rotation is confirmed or the grace period expires.
7. When a workspace is suspended or deleted, all its programmatic credentials are automatically revoked.
8. When a tenant is suspended or soft-deleted, all programmatic credentials across all its workspaces are automatically revoked.
9. Reactivation of a suspended workspace or tenant does not restore revoked credentials.
10. Removal of a principal from a workspace automatically revokes all their credentials for that workspace.
11. Tenant owners can list credentials across workspaces and enforce per-principal and per-workspace credential limits.
12. Superadmins can list and revoke credentials across any tenant.
13. Every credential lifecycle event produces an audit event with actor, credential, workspace, tenant, and timestamp.
14. Storage operations performed with a programmatic credential are attributable to the specific credential and its owning principal in the audit trail.
15. No secret key material appears in audit events, logs, or API responses after initial issuance.
16. Credentials are fully isolated by tenant boundary — no cross-tenant visibility or access.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The S3-compatible storage provider supports the creation and management of access key pairs (or an equivalent credential mechanism) via its admin API. MinIO, Ceph RGW, and Garage all support this.
- The workspace and bucket permission model (spec `014`) is implemented and provides an API to evaluate a principal's effective permissions.
- The tenant storage context (spec `008`) already manages the provider-level admin credentials needed to create per-principal access keys on the underlying storage provider.
- The platform's secret management mechanism can handle the transient storage of secret keys during the creation response.

### Risks

- **Provider credential model mismatch**: Different S3-compatible providers may have different models for sub-account credential management (MinIO service accounts vs. Ceph RGW user keys vs. Garage API keys). The platform must abstract these differences. Mitigation: this is a known concern from the provider abstraction layer (spec `007`) and should be addressed during planning/implementation.
- **Grace-period abuse during rotation**: If the grace period is too long, it effectively doubles the active credential surface. Mitigation: enforce a platform-defined maximum grace period.
- **Scope drift if permission model changes**: If specs `014` permission structures evolve, the credential scope validation logic must be updated in lockstep. Mitigation: credential scope references the same permission vocabulary as bucket policies — no separate permission catalog.

### Blocking questions

None identified. The prerequisite surfaces (provider abstraction, tenant storage context, workspace permissions, bucket policies) are specified or implemented.

---

## 9. Success Criteria

- **SC-001**: A developer or service account can create a scoped credential and perform S3-compatible operations within scope in under 30 seconds end-to-end.
- **SC-002**: Credential revocation takes effect within 5 seconds — no operation using a revoked credential succeeds after this window.
- **SC-003**: 100% of credential lifecycle events are captured in the audit trail with correct attribution.
- **SC-004**: Cascading revocation completes for all credentials in a workspace within 30 seconds of the lifecycle trigger.
- **SC-005**: No secret key material is present in any audit event, log entry, or API response after initial issuance (verifiable by automated scan).
