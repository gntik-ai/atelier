# Feature Specification: Storage Bucket Policies and Per-Tenant/Workspace Permissions

**Feature Branch**: `014-storage-bucket-policies-permissions`
**Created**: 2026-03-28
**Status**: Specified
**Task ID**: US-STO-02-T02
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-02 — Multipart, presigned URLs, políticas, cuotas, eventos y capabilities de provider
**Input**: Backlog prompt: "Implementar políticas de bucket y permisos por tenant/workspace."

**Compatibility note**: This is the second task in the `US-STO-02` story (`EP-12 — Storage S3-compatible`). It delivers a declarative bucket-level policy model and workspace-scoped permission rules for storage operations, enabling tenant owners and workspace admins to govern who can do what inside each bucket without relying solely on platform-wide IAM roles. It depends on the entire `US-STO-01` story chain: provider abstraction (`T01` / spec `007`), tenant storage context (`T02` / spec `008`), bucket/object operations (`T03` / spec `009`), logical organization (`T04` / spec `010`), error taxonomy (`T05` / spec `011`), multi-provider verification (`T06` / spec `012`), and on `US-STO-02-T01` (multipart/presigned URLs / spec `013`) as a sibling dependency within the same story. This spec is **additive-only**: it extends the existing storage surface without modifying or replacing any published contract from specs `007`–`013`.

This task does **not** implement storage capacity quotas or limits (`US-STO-02-T03`), Kafka/OpenWhisk event emission for storage operations (`US-STO-02-T04`), provider capability exposure for versioning/lifecycle/object-lock/events/policies (`US-STO-02-T05`), or advanced capability degradation tests (`US-STO-02-T06`).

## 1. User Scenarios & Testing

### User Story 1 — Workspace admin attaches a declarative access policy to a bucket (Priority: P1)

A workspace admin can define and attach a declarative access policy to a workspace bucket that governs which actors (by role, identity, or service account) may perform which storage operations (read, write, delete, list, generate presigned URLs) on that bucket and its objects, without requiring platform-wide superadmin intervention.

**Why this priority**: Without bucket-level policies, all authorization is binary — either a workspace member has full storage access or none. Real multi-tenant applications need fine-grained control: read-only buckets for public assets, write-restricted buckets for uploads, admin-only buckets for sensitive data. This is the foundational building block.

**Independent Test**: A workspace admin attaches a policy that grants read-only access to a specific role, and a caller with that role can download objects but cannot upload or delete them. A caller without any matching policy statement is denied access.

**Acceptance Scenarios**:

1. **Given** a workspace bucket exists and the caller is a workspace admin, **When** the admin attaches a bucket policy containing one or more permission statements, **Then** the platform persists the policy and associates it with that bucket, and subsequent storage operations on the bucket are evaluated against the policy.
2. **Given** a bucket policy grants `object.get` and `object.list` to the `viewer` role, **When** a workspace member with `viewer` role attempts to download an object, **Then** the operation succeeds.
3. **Given** the same policy from scenario 2, **When** the `viewer` attempts to upload or delete an object, **Then** the operation is denied with a clear `BUCKET_POLICY_DENIED` error identifying the missing permission.
4. **Given** a bucket has no attached policy, **When** a workspace member with standard workspace access attempts a storage operation, **Then** the platform falls back to the workspace-level default permission model (see User Story 3), not to blanket access.
5. **Given** a workspace admin attaches a policy, **When** a member from a different workspace or tenant attempts to access the bucket, **Then** the policy is never evaluated for that actor — cross-tenant/cross-workspace isolation rejects the request before policy evaluation (consistent with specs `008` and `009`).

---

### User Story 2 — Tenant owner defines default storage permissions for new workspaces (Priority: P1)

A tenant owner can define a tenant-level default storage permission template that is applied automatically to every new workspace created under the tenant, ensuring consistent baseline governance without requiring per-workspace manual configuration.

**Why this priority**: In a multi-workspace tenant, requiring manual policy setup per workspace creates governance drift and operational burden. A tenant-level default ensures that every workspace starts with a known permission posture.

**Independent Test**: A tenant owner sets a default storage permission template, a new workspace is created, and the workspace inherits the template as its initial workspace-level storage permissions without manual intervention.

**Acceptance Scenarios**:

1. **Given** a tenant owner defines a default storage permission template that grants `object.get` and `object.list` to all workspace members and restricts `object.put` and `object.delete` to workspace admins, **When** a new workspace is created under that tenant, **Then** the workspace's initial storage permission set matches the template.
2. **Given** a tenant-level default template exists, **When** a workspace admin later overrides the workspace's storage permissions, **Then** the override takes effect for that workspace without affecting other workspaces or the tenant-level template.
3. **Given** no tenant-level default template exists, **When** a new workspace is created, **Then** the workspace receives the platform's built-in default permission set (all standard workspace operations allowed for workspace members, admin operations restricted to workspace admins).

---

### User Story 3 — Workspace-level default permissions govern operations when no bucket policy exists (Priority: P1)

A workspace has a configurable default storage permission set that governs storage operations when a specific bucket does not have its own policy attached. This provides a workspace-wide permission baseline without requiring every bucket to carry an explicit policy.

**Why this priority**: Most buckets in a workspace will not need a custom policy. The workspace-level default reduces configuration overhead while still allowing per-bucket overrides for sensitive or specialized buckets.

**Independent Test**: A workspace admin configures workspace-level default storage permissions. Operations on a bucket without a specific policy are governed by the workspace defaults. Operations on a bucket with its own policy are governed by the bucket policy, not the workspace defaults.

**Acceptance Scenarios**:

1. **Given** a workspace has default storage permissions granting `object.put` to all workspace members, and a bucket in that workspace has no attached policy, **When** a workspace member uploads an object to that bucket, **Then** the operation succeeds based on the workspace default.
2. **Given** the same workspace from scenario 1, and a second bucket in the workspace has an attached policy that denies `object.put` for all non-admin roles, **When** a non-admin workspace member attempts to upload to the second bucket, **Then** the operation is denied by the bucket-specific policy, regardless of the workspace default.
3. **Given** a workspace admin updates the workspace-level default permissions, **When** subsequent operations occur on buckets without specific policies, **Then** the new defaults take effect immediately.

---

### User Story 4 — Policy evaluation produces audit-traceable access decisions (Priority: P2)

Every storage access decision influenced by a bucket policy or workspace-level permission produces an audit event that captures the policy evaluation outcome, enabling security review and compliance traceability.

**Why this priority**: Policies are only as useful as the ability to verify they work correctly. Audit-traceable access decisions enable tenant owners and platform operators to investigate access patterns, detect misconfiguration, and demonstrate compliance.

**Independent Test**: A storage operation is executed against a bucket with an attached policy. The audit trail includes the policy identifier, the matched statement, the evaluation outcome (allow or deny), and the actor's identity.

**Acceptance Scenarios**:

1. **Given** a bucket has an attached policy and a caller performs a storage operation, **When** the policy evaluation completes, **Then** an audit event is produced containing: the caller's identity, the operation type, the bucket, the policy identifier, the matched statement (or "no match — default deny"), and the outcome (allow/deny).
2. **Given** a bucket has no attached policy and the workspace default is used, **When** the evaluation completes, **Then** the audit event indicates that the workspace-level default was the governing policy source.
3. **Given** a cross-tenant request is rejected before policy evaluation, **When** the rejection occurs, **Then** the audit event indicates isolation-level denial, not policy-level denial, to avoid confusing the two enforcement layers.

---

### User Story 5 — Service accounts receive policy-governed storage access (Priority: P2)

A service account (machine identity) registered in a workspace is subject to the same bucket policy and workspace permission evaluation as human users, with the ability to assign service-account-specific permissions or restrictions.

**Why this priority**: BaaS applications rely heavily on service accounts for backend-to-storage communication. Without service-account-aware policy evaluation, machine workloads either bypass governance or are blocked entirely.

**Independent Test**: A service account is granted a specific storage permission through a bucket policy, and the service account can perform exactly the allowed operations — no more, no less.

**Acceptance Scenarios**:

1. **Given** a bucket policy includes a statement granting `object.put` and `object.get` to a specific service account identity, **When** that service account performs an upload, **Then** the operation succeeds.
2. **Given** the same policy, **When** the service account attempts `object.delete`, **Then** the operation is denied.
3. **Given** a bucket policy uses a role-based statement (e.g., `role:uploader`), and a service account is assigned that role in the workspace, **When** the service account performs operations matching the role's grants, **Then** the operations succeed.

---

### User Story 6 — Superadmin can override or inspect any tenant's bucket policies (Priority: P3)

A platform superadmin can inspect and, when necessary, override bucket policies across any tenant for incident response, compliance investigation, or misconfiguration remediation.

**Why this priority**: Platform-level override is a safety net, not a day-to-day feature. It ensures that misconfigured policies cannot permanently lock out data access.

**Independent Test**: A superadmin inspects a tenant's bucket policies and applies an emergency override that grants temporary access, and the override is audit-logged as a superadmin action.

**Acceptance Scenarios**:

1. **Given** a superadmin requests the bucket policies for a specific tenant and workspace, **When** the request is processed, **Then** the response includes all attached policies and the workspace-level defaults.
2. **Given** a superadmin applies an emergency override to a bucket policy, **When** the override is applied, **Then** the original policy is preserved (not deleted), the override is active, and an audit event captures the superadmin identity, the override reason, and the affected bucket.
3. **Given** a superadmin override is active, **When** the superadmin removes the override, **Then** the original bucket policy resumes enforcement.

### Edge Cases

- **Empty policy document**: If a workspace admin attaches an empty policy (no statements), the bucket effectively denies all non-admin operations beyond the platform's implicit workspace admin bypass. The platform MUST accept the empty policy as valid and apply default-deny semantics.
- **Conflicting statements in the same policy**: If a policy contains both an allow and a deny for the same actor and operation, deny MUST take precedence (deny-wins model), consistent with standard policy evaluation semantics.
- **Policy attached to a non-existent bucket**: If a policy references a bucket that does not exist (e.g., the bucket was deleted after policy creation), the platform MUST treat the policy as orphaned and surface it during policy listing with a diagnostic status.
- **Policy size limits**: The platform MUST enforce a maximum policy document size per bucket and a maximum number of statements per policy to prevent abuse. Exceeding the limit MUST produce `BUCKET_POLICY_TOO_LARGE`.
- **Workspace admin self-lockout**: If a workspace admin attaches a policy that denies their own admin role all permissions, the platform MUST still allow workspace admins to manage (read/update/delete) bucket policies regardless of the policy's contents, to prevent irrecoverable lockout. Policy management is a workspace admin privilege that cannot be self-revoked through a bucket policy.
- **Policy evaluation order**: When a bucket has an attached policy, only the bucket policy is evaluated for authorization. The workspace default is NOT merged or stacked with the bucket policy. The bucket policy fully replaces the workspace default for that bucket.
- **Deletion of workspace-level defaults**: A workspace admin can remove the workspace-level default storage permissions, reverting to the platform's built-in defaults. The platform MUST always have a non-null built-in default as the last fallback.
- **Presigned URL policy interaction**: When a presigned URL is generated (spec `013`), the policy evaluation occurs at URL generation time, not at URL use time. If the policy changes after URL generation, already-generated URLs remain valid until their TTL expires. New URL generation requests are evaluated against the current policy.
- **Multipart upload policy interaction**: Each multipart upload operation (initiate, upload part, complete, abort) is individually subject to policy evaluation. A policy change mid-upload may cause subsequent parts or the completion to be denied.
- **Bootstrap default bucket policy**: The `default_storage_bucket` provisioned during workspace bootstrap (spec `008`) starts with the workspace-level default permissions. It does not receive a special immutable policy.

## 2. Requirements

### Functional Requirements

#### Bucket Policy Model

- **FR-001**: The system MUST support a declarative bucket policy model where each bucket can have at most one attached policy document containing an ordered list of permission statements.
- **FR-002**: Each permission statement MUST contain:
  - an **effect** (`allow` or `deny`),
  - one or more **principals** (identified by user identity, service account identity, or workspace role),
  - one or more **actions** from a defined set of storage operations,
  - an optional **condition** constraining the statement's applicability (e.g., object key prefix, IP range, time window).
- **FR-003**: The defined set of storage actions for policy statements MUST include at minimum:
  - `object.get` — download an object
  - `object.put` — upload or overwrite an object
  - `object.delete` — delete an object
  - `object.list` — list objects in the bucket
  - `object.head` — retrieve object metadata
  - `bucket.get_policy` — read the bucket's attached policy
  - `multipart.initiate` — initiate a multipart upload (from spec `013`)
  - `multipart.upload_part` — upload a part in a multipart session
  - `multipart.complete` — complete a multipart upload
  - `multipart.abort` — abort a multipart upload
  - `multipart.list` — list active multipart sessions
  - `presigned.generate_download` — generate a presigned download URL
  - `presigned.generate_upload` — generate a presigned upload URL
- **FR-004**: Policy evaluation MUST follow a **deny-wins** model: if any statement explicitly denies an action for the actor, the action is denied regardless of any allow statements.
- **FR-005**: If no statement in the policy matches the actor and action, the default outcome MUST be **deny** (implicit deny).
- **FR-006**: The system MUST enforce a maximum policy document size (configurable at the platform level) and a maximum number of statements per policy. Requests exceeding these limits MUST be rejected with `BUCKET_POLICY_TOO_LARGE`.
- **FR-007**: Each bucket may have at most one attached policy. Attaching a new policy replaces the previous policy atomically.

#### Workspace-Level Default Permissions

- **FR-008**: The system MUST support a workspace-level default storage permission set that governs storage operations on buckets within the workspace that do not have their own attached policy.
- **FR-009**: When a bucket has an attached policy, the bucket policy is the sole authority for that bucket's access decisions. The workspace-level default is NOT merged or stacked with the bucket policy.
- **FR-010**: A workspace admin MUST be able to read, create, update, and delete the workspace-level default storage permission set.
- **FR-011**: The workspace-level default storage permission set MUST use the same statement structure as bucket policies (FR-002).
- **FR-012**: The platform MUST define a built-in default permission set that applies when neither a bucket policy nor a workspace-level default is configured. This built-in default MUST grant standard storage operations to workspace members and restrict administrative operations to workspace admins.

#### Tenant-Level Default Template

- **FR-013**: The system MUST support a tenant-level default storage permission template that is applied as the initial workspace-level default when a new workspace is created under the tenant.
- **FR-014**: A tenant owner MUST be able to read, create, update, and delete the tenant-level default storage permission template.
- **FR-015**: Changes to the tenant-level default template MUST NOT retroactively affect existing workspaces. Only new workspace creation uses the template at creation time.

#### Policy Management API

- **FR-016**: The system MUST expose a unified workspace-scoped API to attach, read, update, and detach a bucket policy. Only workspace admins (or the superadmin override) may manage bucket policies.
- **FR-017**: The system MUST expose a unified workspace-scoped API to read and update the workspace-level default storage permission set. Only workspace admins may manage workspace defaults.
- **FR-018**: The system MUST expose a tenant-scoped API to read and update the tenant-level default storage permission template. Only tenant owners may manage the tenant template.
- **FR-019**: Workspace admins MUST retain the ability to manage (read/update/detach) bucket policies regardless of the policy's contents. Bucket policy management cannot be self-revoked through a bucket policy.

#### Policy Evaluation

- **FR-020**: Every storage operation (bucket and object operations from spec `009`, multipart operations from spec `013`, presigned URL generation from spec `013`) MUST be subject to policy evaluation after tenant/workspace isolation checks pass.
- **FR-021**: The policy evaluation order MUST be:
  1. **Tenant/workspace isolation** (from specs `008`/`009`) — if the actor has no access to the workspace, reject immediately. This is not policy-governed.
  2. **Bucket policy** — if the target bucket has an attached policy, evaluate it. The result (allow or deny) is final.
  3. **Workspace default** — if no bucket policy exists, evaluate the workspace-level default storage permissions.
  4. **Built-in default** — if no workspace-level default is configured, apply the platform built-in default.
- **FR-022**: For presigned URL generation (spec `013`), policy evaluation MUST occur at generation time. The policy in effect at URL generation governs whether the URL is created. Already-generated URLs are not retroactively invalidated by policy changes.
- **FR-023**: For multipart uploads (spec `013`), each operation (initiate, upload part, complete, abort, list) MUST be individually evaluated against the current policy at the time of the operation.

#### Superadmin Override

- **FR-024**: A platform superadmin MUST be able to inspect all bucket policies and workspace defaults for any tenant.
- **FR-025**: A platform superadmin MUST be able to attach an emergency override policy to any bucket. The override takes precedence over the bucket's normal policy while active.
- **FR-026**: When a superadmin override is active, the original bucket policy MUST be preserved and restorable when the override is removed.
- **FR-027**: All superadmin policy operations (inspect, override, remove override) MUST produce audit events with the superadmin identity, affected tenant/workspace/bucket, and the reason for the action.

#### Audit and Observability

- **FR-028**: Every policy-influenced access decision MUST produce an audit event containing:
  - the caller's identity (user, service account, or superadmin),
  - the operation type,
  - the target bucket (and object key, if applicable),
  - the policy source used for the decision (bucket policy, workspace default, built-in default, or superadmin override),
  - the policy identifier (if a named policy was used),
  - the matched statement (or "no match — implicit deny"),
  - the decision outcome (allow or deny),
  - tenant/workspace context and correlation metadata.
- **FR-029**: Audit events for policy decisions MUST follow the same audit/correlation model established by spec `009` and extended by spec `013`.
- **FR-030**: Policy management operations (attach, update, detach, override) MUST produce audit events with the acting identity, the previous and new policy states, and tenant/workspace/bucket context.

#### Multi-tenancy and Isolation

- **FR-031**: Bucket policies are strictly scoped to one tenant and one workspace. A policy attached to a bucket in Workspace A MUST NOT influence access decisions for any other workspace or tenant.
- **FR-032**: Tenant-level default templates are strictly scoped to one tenant. A tenant's template MUST NOT be visible to or influence other tenants.
- **FR-033**: Policy evaluation MUST never weaken tenant/workspace isolation. Isolation checks (from specs `008`/`009`) MUST execute before any policy evaluation.

#### Service Account Support

- **FR-034**: Policy statements MUST support service account identities as principals, using the same identity model used for service accounts in the workspace.
- **FR-035**: Service accounts MUST be subject to the same policy evaluation flow as human users. No implicit bypass exists for service accounts.

#### Additive Compatibility

- **FR-036**: All new API endpoints, contracts, entities, and error codes introduced by this spec MUST be additive to the existing storage API surface from specs `007`–`013`. No published contract from those specs may be modified or removed.
- **FR-037**: The bucket entity (from spec `009`) MUST be extensible to carry a policy attachment reference without changing its existing published shape. The policy attachment is an optional field.
- **FR-038**: New normalized error codes introduced by this spec MUST follow the error taxonomy structure from spec `011` and MUST NOT collide with existing error codes from specs `011` or `013`.

### Key Entities

- **Bucket Policy**: A declarative document containing an ordered list of permission statements, attached to exactly one bucket. Governs access decisions for storage operations on that bucket and its objects. Contains: policy identifier, bucket reference, version, statement list, creation timestamp, last-modified timestamp, and lifecycle state.
- **Permission Statement**: An individual access rule within a bucket policy or workspace default. Contains: effect (`allow` or `deny`), principal list (user identities, service account identities, or workspace roles), action list (from the defined storage action set), and optional conditions.
- **Workspace Default Storage Permissions**: A permission configuration using the same statement structure as bucket policies, applied at the workspace level to govern buckets that do not have their own attached policy. Bound to one workspace.
- **Tenant Default Storage Permission Template**: A permission template owned by the tenant, applied as the initial workspace-level default when a new workspace is created. Bound to one tenant.
- **Superadmin Override Policy**: A temporary policy attached to a bucket by a superadmin that takes precedence over the normal bucket policy while active. Contains: override policy document, original policy reference, superadmin identity, reason, activation timestamp.
- **Policy Evaluation Audit Event**: An audit record capturing the full context of a policy-influenced access decision: caller identity, operation, target resource, policy source, matched statement, outcome, and correlation metadata.

## 3. Security, Governance, Isolation, and Traceability

### Isolation Boundaries

- Bucket policies operate strictly within the tenant/workspace boundary established by specs `008` and `009`. Policy evaluation is never reached for cross-tenant or cross-workspace requests — those are rejected at the isolation layer.
- Tenant-level default templates are invisible across tenants. A tenant owner can only manage their own tenant's template.
- The policy model adds a fine-grained authorization layer within the workspace, not a replacement for the platform's IAM (Keycloak) or tenant isolation model.

### Security

- The deny-wins model (FR-004) ensures that explicit denials cannot be overridden by allow statements, preventing privilege escalation through policy composition.
- Workspace admin lockout protection (FR-019) ensures that a misconfigured policy cannot permanently prevent policy management. This is a deliberate trade-off: policy management is a workspace admin privilege that exists above the policy layer.
- Superadmin override capability (FR-025) is the last-resort mechanism for incident response. It is audit-logged and preserves the original policy.
- Presigned URL policy interaction is evaluated at generation time (FR-022), meaning a presigned URL represents the access decision at the moment it was created. This is consistent with the S3 presigned URL security model where the URL carries the signer's permissions at signing time.
- Service accounts are not exempt from policy evaluation (FR-035). Machine identities are first-class principals in the policy model.

### Auditing

- Every policy-influenced access decision is audit-traceable (FR-028), including which policy source was used and which statement matched.
- Policy management operations (attach, update, detach, override) are audit-traceable (FR-030), including before/after state.
- Audit events follow the same correlation model from spec `009`, extended by spec `013`.
- Audit events distinguish between isolation-level denials and policy-level denials, preventing confusion during security investigations.

### Governance

- The three-tier permission model (bucket policy → workspace default → built-in default) provides layered governance without requiring every bucket to carry an explicit policy.
- Tenant-level templates ensure consistent baseline governance across workspaces without manual repetition.
- The built-in default ensures that the platform always has a non-null fallback, preventing undefined authorization states.

## 4. Success Criteria

### Measurable Outcomes

- **SC-001**: A workspace admin can attach a bucket policy, and subsequent storage operations on that bucket are governed by the policy: allowed operations succeed, denied operations fail with `BUCKET_POLICY_DENIED`.
- **SC-002**: A bucket without an attached policy falls back to the workspace-level default storage permissions, and operations are governed by those defaults.
- **SC-003**: A tenant owner sets a default storage permission template, creates a new workspace, and the workspace inherits the template as its initial workspace-level default without manual configuration.
- **SC-004**: Deny-wins semantics are enforced: when a policy contains both allow and deny for the same actor/action, the deny prevails.
- **SC-005**: Policy evaluation never weakens tenant/workspace isolation: cross-tenant and cross-workspace requests are rejected before policy evaluation begins.
- **SC-006**: Service accounts are subject to the same policy evaluation as human users: a service account granted `object.get` can download but cannot upload if `object.put` is not granted.
- **SC-007**: Every policy-influenced access decision produces an audit event traceable through the platform's audit/correlation pipeline, including the policy source, matched statement, and outcome.
- **SC-008**: A superadmin can inspect and override any bucket policy, and the override is audit-logged with the superadmin's identity and reason.
- **SC-009**: Workspace admins can always manage bucket policies regardless of the policy's contents (lockout protection).
- **SC-010**: All new contracts, endpoints, and error codes are additive to the existing storage API surface. No published contracts from specs `007`–`013` are broken.

## 5. Assumptions and Dependencies

- `US-STO-01-T01` (spec `007`) supplies the provider abstraction layer and capability manifest.
- `US-STO-01-T02` (spec `008`) supplies tenant storage contexts with namespace isolation, lifecycle cascade, and the workspace bootstrap flow that provisions the `default_storage_bucket`.
- `US-STO-01-T03` (spec `009`) supplies bucket/object CRUD contracts, the standard object record shape, and the audit/correlation model for storage operations.
- `US-STO-01-T04` (spec `010`) supplies the logical organization model, reserved platform prefix definitions, and the workspace/application attribution model.
- `US-STO-01-T05` (spec `011`) supplies the normalized error taxonomy, error envelope structure, and the extensibility contract for adding new error codes.
- `US-STO-01-T06` (spec `012`) supplies the multi-provider verification framework.
- `US-STO-02-T01` (spec `013`) supplies multipart upload and presigned URL contracts that this spec's policy actions reference (`multipart.*`, `presigned.*`).
- The platform's IAM layer (Keycloak) provides identity context (user, service account, roles) that policy evaluation consumes. This spec does not replace Keycloak; it adds a storage-specific fine-grained authorization layer that operates within the workspace, downstream of IAM authentication.
- The workspace role model already supports at least `admin`, `member`, and `viewer` roles (or equivalent), which bucket policies can reference as principals.
- The platform's event backbone (Kafka) is available for publishing policy-related audit events.
- Bucket policies in this spec are **platform-level constructs**, not S3-native bucket policies. The platform evaluates these policies in its own authorization layer before any operation reaches the storage provider. This design avoids coupling to provider-specific policy engines and ensures uniform behavior across all supported S3-compatible backends.

## 6. Explicit Out of Scope

- `US-STO-02-T03`: Storage capacity quotas, bucket-count limits, object-size limits, and enforcement mechanisms. Policies govern access permissions, not capacity limits.
- `US-STO-02-T04`: Kafka/OpenWhisk event emission for storage operations. Policy audit events are published to Kafka, but the general-purpose storage event system is a separate task.
- `US-STO-02-T05`: Exposing provider capabilities for versioning, lifecycle, object lock, event notifications, and bucket policies as tenant-visible features. This spec defines platform-level policies, not S3-native policy pass-through.
- `US-STO-02-T06`: Advanced tests for policy enforcement across providers.
- **S3-native bucket policy pass-through**: This spec does NOT forward policies to the underlying S3-compatible provider's native bucket policy engine. Policies are evaluated at the platform layer.
- **Cross-workspace policy sharing**: Policies cannot be shared across workspaces. Each workspace and bucket manages its own policies independently.
- **Policy versioning or rollback**: While the policy entity carries a version field, this spec does not define a version history or rollback mechanism. Only the current policy is active.
- **Object-level ACLs**: This spec governs access at the bucket level with optional object-key-prefix conditions. Per-object ACLs (individual access control lists on specific objects) are not included.
- **IP-based or time-based conditions**: While FR-002 allows optional conditions, the minimum viable condition set for this task is **object key prefix** only. IP range and time window conditions are recognized as future extensions but not required for initial delivery.
- **Policy inheritance across nested or linked workspaces**: The model is flat — each workspace is independent. No parent-child policy inheritance exists.

## 7. Risks and Open Questions

### Risks

- **Risk**: Policy evaluation on every storage operation adds latency to the hot path. **Mitigation**: The policy model is deliberately simple (one policy per bucket, deny-wins, no complex condition evaluation). Platform implementations can cache the active policy per bucket with invalidation on policy change. This is an implementation concern but the spec intentionally avoids complex evaluation semantics that would make caching impractical.
- **Risk**: Presigned URL policy interaction (evaluation at generation time) means that a policy change does not retroactively invalidate existing URLs. A tenant owner may expect instant revocation. **Mitigation**: This is consistent with S3 presigned URL semantics and is documented in edge cases. TTL capping (from spec `013` FR-018) limits the exposure window. Full revocation requires credential rotation, which is outside this spec's scope.
- **Risk**: The deny-wins model means that a single overly broad deny statement can lock out all non-admin users from a bucket. **Mitigation**: FR-019 ensures workspace admins can always manage policies, and the superadmin override (FR-025) provides a last-resort escape.
- **Risk**: The `BUCKET_POLICY_DENIED` error code is new and does not exist in the current error taxonomy (spec `011`). **Mitigation**: FR-038 requires the new code to follow the taxonomy structure and FR-036 requires additive-only changes. The existing taxonomy (spec `011` FR-013) explicitly allows new codes to be added without invalidating existing ones.

### Open Questions

- **OQ-001**: Should the platform support wildcard principals in policy statements (e.g., `*` to mean "any authenticated workspace member")? **Impact**: Wildcard principals simplify common policies (e.g., "all members can read") but risk overly permissive configurations. Can be deferred to implementation; the spec's statement structure (FR-002) supports role-based principals which serve the same purpose more safely.
- **OQ-002**: Should tenant-level default templates support a "locked" mode where workspace admins cannot override them? **Impact**: A locked mode provides stronger tenant governance but reduces workspace autonomy. This is a governance policy decision that can be added as an optional flag without changing the core model. Not required for initial delivery.
- **OQ-003**: Should policy evaluation results be cached per-session or per-request? **Impact**: Per-session caching reduces evaluation cost but delays policy change propagation. Per-request evaluation is simpler and more consistent but has higher overhead. This is an implementation decision; the spec requires that the current policy be the authority (FR-009, FR-023).

## 8. New Error Codes Introduced

The following normalized error codes are introduced by this spec, following the taxonomy structure from spec `011`:

| Code | Meaning | HTTP Status | Retryability |
|---|---|---|---|
| `BUCKET_POLICY_DENIED` | The bucket policy or workspace default explicitly denied the requested operation for the caller | 403 Forbidden | Not retryable |
| `BUCKET_POLICY_TOO_LARGE` | The submitted policy document exceeds the platform-configured maximum size or statement count | 400 Bad Request | Not retryable |
| `BUCKET_POLICY_INVALID` | The submitted policy document is malformed or contains invalid principals, actions, or conditions | 400 Bad Request | Not retryable |
| `BUCKET_POLICY_NOT_FOUND` | The referenced bucket does not have an attached policy | 404 Not Found | Not retryable |
