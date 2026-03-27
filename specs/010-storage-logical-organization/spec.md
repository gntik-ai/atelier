# Feature Specification: Storage Logical Organization by Tenant, Workspace, and Application

**Feature Branch**: `010-storage-logical-organization`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Definir organización lógica por tenant, workspace y aplicación. Backlog reference: US-STO-01-T04."

**Compatibility note**: This is the fourth task in the `US-STO-01` story (`EP-12 — Storage S3-compatible`). It defines how the unified storage surface organizes bucket contents logically across tenant, workspace, and application boundaries after the provider abstraction (`T01`), tenant storage context (`T02`), and bucket/object operations (`T03`) already exist. It does **not** finalize cross-provider error normalization (`T05`) or the multi-provider verification suite (`T06`). It also does **not** introduce a provider-specific bucket topology that would break the provider-agnostic storage contract.

## 1. User Scenarios & Testing

### User Story 1 - Application-safe object placement inside a workspace bucket (Priority: P1)

A workspace admin, developer, or service account can place application-owned objects into the unified storage surface while the platform applies one canonical logical layout that stays isolated by tenant, workspace, and application.

**Why this priority**: Without a canonical layout, object keys, policy evaluation, quota attribution, and audit evidence drift across applications and make later storage capabilities inconsistent.

**Independent Test**: A caller uploads or previews an object for one application and receives a deterministic logical placement that stays inside the correct tenant/workspace/application boundary without exposing provider-native path rules.

**Acceptance Scenarios**:

1. **Given** an active tenant storage context, one workspace, and one active application in that workspace, **When** the caller targets storage for that application, **Then** the platform resolves one canonical logical placement under the tenant and workspace root and binds it to that application.
2. **Given** two applications in the same workspace, **When** both use storage through the unified API, **Then** their logical storage roots do not collide and each application remains attributable independently for audit and quota purposes.
3. **Given** the same application is accessed again later, **When** the platform resolves storage placement again, **Then** it returns the same canonical organization strategy and stable logical prefix for that application.

---

### User Story 2 - Shared workspace storage and reserved platform prefixes stay governed (Priority: P1)

A workspace can still use shared storage for assets that are not owned by a single application, while the platform reserves non-user prefixes for presigned URL flows, multipart upload staging, and storage-generated events.

**Why this priority**: The platform needs both shared workspace storage and system-owned paths without allowing user data to collide with managed internal flows.

**Independent Test**: A caller can resolve both a workspace-shared placement and an application-specific placement, and the resulting organization clearly separates user-controlled prefixes from reserved platform prefixes.

**Acceptance Scenarios**:

1. **Given** a workspace needs common assets not tied to one application, **When** the platform resolves shared storage placement, **Then** the result uses a workspace-shared logical root distinct from any application root.
2. **Given** the platform later issues presigned uploads, multipart staging, or storage event delivery, **When** those capabilities need internal keyspace, **Then** the organization model reserves dedicated prefixes that callers cannot claim as normal application paths.
3. **Given** a caller attempts to use a reserved system prefix as user-controlled object space, **When** the request is evaluated, **Then** the platform treats that prefix as unavailable for normal application or shared content placement.

---

### User Story 3 - Quota, audit, and policy attribution follow the logical organization (Priority: P2)

Tenant owners, workspace admins, and internal control-plane services can attribute storage usage and governance outcomes to the right tenant, workspace, and application using the same logical organization model.

**Why this priority**: Storage layout is not only about object placement; it must also support quota metering, audit evidence, event attribution, and future policy enforcement without reinterpreting provider-specific keys.

**Independent Test**: A bucket/object preview includes enough logical organization metadata to identify which tenant, workspace, and optionally which application own the data, and to distinguish user data from reserved platform-managed areas.

**Acceptance Scenarios**:

1. **Given** a stored object is associated with one application, **When** metadata is returned through the unified API, **Then** the response includes the logical organization information needed to attribute quota, audit, and events to that application.
2. **Given** a workspace-shared object is not bound to one application, **When** metadata is returned, **Then** the response identifies it as workspace-shared while preserving tenant and workspace attribution.
3. **Given** storage provider details differ between supported backends, **When** the logical organization is returned, **Then** the public contract remains provider-agnostic and does not depend on one backend’s native namespace semantics.

### Edge Cases

- What happens when an object belongs to a workspace but not to any application?
- What happens when a caller provides application context that belongs to another workspace or tenant?
- How does the platform prevent user content from colliding with reserved prefixes for presigned URLs, multipart staging, and storage event delivery?
- How does the organization remain stable if application or workspace slugs change after objects already exist?
- How does the platform attribute quota and audit context when the same bucket stores both workspace-shared and application-scoped content?
- How does the logical model remain portable when one provider maps organization to prefixes and another provider later requires a different internal representation?

## 2. Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define one canonical provider-agnostic logical storage organization model that composes tenant scope, workspace scope, and optional application scope.
- **FR-002**: The system MUST provide a deterministic workspace root for each workspace inside the active tenant storage context.
- **FR-003**: The system MUST provide a deterministic application root for each application inside its parent workspace storage boundary.
- **FR-004**: The system MUST support workspace-shared storage placement for objects that are intentionally not owned by a single application.
- **FR-005**: The system MUST reserve dedicated non-user prefixes for platform-managed presigned URL flows, multipart upload staging, and storage event-related keyspace or evidence paths when those capabilities are enabled later.
- **FR-006**: The system MUST prevent normal application or workspace content from being organized under reserved platform prefixes.
- **FR-007**: The system MUST use stable ownership identifiers for canonical organization so that display-name or slug changes do not require remapping existing logical ownership.
- **FR-008**: Bucket and object contracts exposed through the unified API MUST include logical organization metadata sufficient to identify tenant, workspace, and optional application ownership.
- **FR-009**: Object operations MUST be attributable for quota, audit, and event context at least to tenant and workspace, and to the application when an application binding exists.
- **FR-010**: The public storage contract MUST remain provider-agnostic even if different providers implement the logical organization with different native mechanisms underneath.
- **FR-011**: The logical organization MUST remain compatible with existing bucket/object CRUD behavior from `US-STO-01-T03` without requiring a separate storage API family.
- **FR-012**: The logical organization MUST be explicit enough that future presigned URL, multipart upload, policy, and event features can reuse the same hierarchy without breaking already published bucket/object contracts.

### Key Entities *(include if feature involves data)*

- **Storage Logical Organization**: Canonical model that defines the tenant root, workspace root, optional application root, reserved platform prefixes, and attribution rules for objects stored through the unified storage API.
- **Workspace Shared Storage Root**: Logical object area used for workspace-owned content that is not bound to one application.
- **Application Storage Root**: Logical object area bound to one application within one workspace and one tenant, used for application-attributed storage activity.
- **Reserved Storage Prefix**: Platform-managed logical prefix unavailable for user-controlled application or shared content because it is reserved for presigned flows, multipart staging, events, or future governed internal use.

## 3. Security, Governance, Isolation, and Traceability

- The logical organization is nested: tenant → workspace → application, with workspace-shared content allowed only inside the workspace root.
- Application ownership is optional but, when present, must remain bound to one workspace and one tenant.
- Reserved platform prefixes are never treated as user-owned application or workspace content.
- Public contracts remain secret-safe and provider-agnostic: they describe logical ownership and prefixes, not provider credentials or backend-specific namespace internals.
- Audit, quota, and future event envelopes must be able to reuse the same tenant/workspace/application attribution from the logical organization model.
- The organization model must remain additive and not invalidate objects already created through earlier bucket/object CRUD behavior.

## 4. Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workspace-shared storage preview and an application-scoped storage preview for the same workspace resolve to different non-colliding logical roots under one canonical strategy.
- **SC-002**: The logical organization returned for the same tenant/workspace/application combination is deterministic across repeated requests.
- **SC-003**: Bucket and object contracts surface enough logical organization metadata to attribute ownership to tenant and workspace, and to application when present, without exposing provider-native secrets or internals.
- **SC-004**: Reserved prefixes for presigned, multipart, and event-related platform-managed storage are distinguishable from user-controlled application and workspace content.
- **SC-005**: The resulting public contract remains additive to `US-STO-01-T03` and ready for later sibling tasks that add normalized provider errors and multi-provider verification.

## 5. Assumptions and Dependencies

- `US-STO-01-T01` supplies the provider abstraction and capability manifest.
- `US-STO-01-T02` supplies the tenant storage context, namespace baseline, and quota assignment context.
- `US-STO-01-T03` supplies bucket/object CRUD behavior and the existing storage family contract that this task enriches.
- `US-TEN-01` remains the source of tenant/workspace ownership and authorization boundaries.
- Workspace applications are represented by the existing workspace-scoped `external_application` domain model and use stable `applicationId` identity independent of display or slug changes.

## 6. Explicit Out of Scope

- Final normalization of provider-native errors across all supported storage backends (`US-STO-01-T05`).
- Executing the same storage behavior suite against multiple concrete providers (`US-STO-01-T06`).
- Delivering presigned URLs, multipart upload orchestration, object lifecycle/versioning controls, or storage event subscriptions as full end-user features in this task.
- Replacing the current bucket/object routes with a new storage API surface.
