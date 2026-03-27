# Feature Specification: Storage Bucket CRUD and Object Operations

**Feature Branch**: `009-storage-bucket-object-ops`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Implement CRUD de buckets y operaciones básicas de objetos: upload, download, delete, list y metadata. Backlog reference: US-STO-01-T03."

**Compatibility note**: This is the third task in the `US-STO-01` story (`EP-12 — Storage S3-compatible`). It delivers the tenant-facing bucket and object operation surface that depends on the provider abstraction from `US-STO-01-T01` and the tenant storage context from `US-STO-01-T02`. It does **not** define the long-term logical organization by tenant/workspace/application (`T04`), cross-provider runtime error normalization (`T05`), or the multi-provider verification suite (`T06`). Presigned URLs, multipart upload orchestration, bucket lifecycle policies, and event-stream subscriptions remain outside this task unless they are required only as bounded metadata references.

## 1. User Scenarios & Testing

### User Story 1 - Workspace bucket management through the unified API (Priority: P1)

A workspace admin or developer can create, list, inspect, and delete workspace-scoped storage buckets through the BaaS storage API without dealing with a provider-native console.

**Why this priority**: Bucket CRUD is the minimum storage control surface required before any object workflow can exist.

**Independent Test**: A caller can create a bucket, list workspace buckets, fetch one bucket’s metadata, and delete an empty bucket while observing strict tenant/workspace isolation.

**Acceptance Scenarios**:

1. **Given** an active tenant with an active storage context and a workspace in that tenant, **When** an authorized caller creates a bucket with a valid name, **Then** the platform accepts the request under the unified storage family and associates the new bucket with that workspace.
2. **Given** a workspace with multiple buckets, **When** an authorized caller lists buckets, **Then** the response contains only buckets bound to that workspace and tenant.
3. **Given** a workspace bucket exists, **When** an authorized caller requests that bucket’s metadata, **Then** the response includes ownership, region/provider information, lifecycle state, and object-count / size summary.
4. **Given** a workspace bucket is empty, **When** an authorized caller deletes it, **Then** the platform accepts the delete request and the bucket no longer appears in later listings.
5. **Given** a workspace bucket still contains objects, **When** an authorized caller attempts to delete it, **Then** the platform rejects or blocks the deletion with a clear non-destructive reason.

---

### User Story 2 - Basic object upload and retrieval inside a workspace bucket (Priority: P1)

A developer or service account can upload an object into an authorized workspace bucket, later download it again, and retrieve its metadata through the same unified storage API.

**Why this priority**: The value of storage for application builders begins with the ability to put and get objects without switching to provider-native semantics.

**Independent Test**: A caller can upload an object into a workspace bucket, fetch its metadata, download the object, and confirm the object remains isolated to the correct tenant/workspace.

**Acceptance Scenarios**:

1. **Given** an active workspace bucket and an authorized caller, **When** the caller uploads an object with content type and optional metadata, **Then** the object is stored under that bucket and the platform returns a traceable accepted result.
2. **Given** an uploaded object exists, **When** an authorized caller downloads it, **Then** the returned object belongs to the requested bucket and includes enough metadata to verify identity and integrity.
3. **Given** an uploaded object exists, **When** an authorized caller requests object metadata only, **Then** the response excludes secret/provider-internal material and includes size, content type, checksum/etag if available, and last modification time.
4. **Given** two workspaces under the same tenant or two different tenants both use storage, **When** one caller requests an object outside its scope, **Then** the platform does not expose object content or metadata across boundaries.

---

### User Story 3 - Governed object inventory and deletion (Priority: P2)

A workspace admin or developer can list stored objects and delete obsolete objects without bypassing quota, audit, or scope controls.

**Why this priority**: Day-2 storage operation requires visibility and cleanup, not only creation and download.

**Independent Test**: A caller can list objects in a bucket, delete one object, and verify the bucket inventory and metadata summary update accordingly.

**Acceptance Scenarios**:

1. **Given** a bucket contains multiple objects, **When** an authorized caller lists objects, **Then** the response returns only objects from that bucket and preserves deterministic pagination metadata.
2. **Given** an object exists, **When** an authorized caller deletes it, **Then** the platform accepts the deletion and the object is absent from subsequent list and metadata reads.
3. **Given** an object does not exist or has already been removed, **When** a caller requests deletion or metadata, **Then** the platform returns a bounded not-found outcome without leaking unrelated bucket contents.

### Edge Cases

- What happens when a bucket create request uses a name that is invalid for the platform’s common S3-compatible baseline?
- What happens when a caller attempts bucket creation while the tenant storage context is not active or storage capability is unavailable for the tenant plan?
- How does the system behave when an upload would exceed the tenant’s storage byte quota or bucket-count quota?
- How does the platform handle object keys that contain nested path-like segments, URL encoding, or repeated uploads to the same key?
- How does bucket deletion behave when the bucket is the bootstrap `default_storage_bucket` and still contains managed content?
- How are list operations paginated and filtered without exposing objects from other buckets, workspaces, or tenants?
- How does the platform respond when the provider is configured but temporarily unavailable after the bucket/object contract has already been published?

## 2. Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a unified workspace-scoped API to create storage buckets without requiring provider-native bucket administration.
- **FR-002**: The system MUST expose a unified workspace-scoped API to list buckets visible to the active workspace, including the bootstrap default bucket when it exists.
- **FR-003**: The system MUST expose a unified workspace-scoped API to fetch metadata for one bucket, including tenant/workspace binding, provider/region summary, lifecycle state, and bounded object statistics.
- **FR-004**: The system MUST allow deletion of a bucket only when the bucket is eligible for removal under platform policy; non-empty or protected buckets MUST not be destructively removed.
- **FR-005**: Bucket CRUD MUST operate only when the tenant’s storage context is active and storage capability is available for the tenant.
- **FR-006**: The system MUST expose a unified workspace-scoped API to upload an object into an authorized bucket.
- **FR-007**: The system MUST expose a unified workspace-scoped API to download an object from an authorized bucket.
- **FR-008**: The system MUST expose a unified workspace-scoped API to fetch object metadata independently from object download.
- **FR-009**: The system MUST expose a unified workspace-scoped API to list objects contained in one authorized bucket with deterministic pagination metadata.
- **FR-010**: The system MUST expose a unified workspace-scoped API to delete an object from an authorized bucket.
- **FR-011**: Object operations MUST enforce tenant and workspace isolation so that callers cannot access buckets or objects outside their authorized scope.
- **FR-012**: Bucket and object operations MUST remain semantically provider-agnostic at the public API surface, even when the active backend is a concrete S3-compatible provider.
- **FR-013**: Upload and delete operations MUST preserve idempotent request handling semantics compatible with the platform-wide `Idempotency-Key` policy.
- **FR-014**: The system MUST capture audit-traceable context for bucket creation/deletion and object upload/download/delete operations.
- **FR-015**: The system MUST surface bounded quota-aware outcomes when a tenant or workspace attempts to exceed bucket-count or storage-capacity limits.
- **FR-016**: Public metadata responses MUST avoid leaking raw provider credentials, secret references, or provider-private topology details.
- **FR-017**: The system MUST represent bucket and object contracts in a way that later sibling tasks can add normalized provider errors and multi-provider verification without breaking the public shape introduced here.

### Key Entities *(include if feature involves data)*

- **Storage Bucket**: Workspace-scoped storage resource bound to one tenant storage context, with lifecycle state, provider/region summary, quota-relevant statistics, and managed ownership metadata.
- **Storage Object**: Addressable object stored inside one bucket, with object key, size, content type, checksum/etag metadata, timestamps, and workspace/tenant binding.
- **Bucket/Object Operation Audit Event**: Traceable record describing who initiated a bucket or object operation, the affected tenant/workspace/bucket/object, correlation context, and outcome.
- **Bucket/Object Inventory Collection**: Paginated list contract for buckets or objects that keeps inventory bounded and scope-safe.

## 3. Security, Governance, Isolation, and Traceability

- Bucket and object operations are **workspace-scoped** but remain nested inside the active tenant’s storage context.
- Only authorized actors for the target workspace may create/delete buckets or upload/delete objects; read-only actors may receive list/detail/download access only where policy allows.
- All public responses must remain secret-safe: no raw provider credentials, secret references, or provider-specific internal endpoint material.
- Bucket/object lifecycle mutations must participate in the platform’s audit/correlation model.
- Quota evaluation must be part of the observable behavior of this task: a caller receives a bounded quota-aware outcome rather than an unexplained provider failure.
- The public API surface must remain provider-agnostic even if the adapter layer uses S3-compatible semantics underneath.

## 4. Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workspace-scoped caller can complete create → list → get → delete for an empty bucket through the unified API without requiring provider-native identifiers beyond the bucket contract returned by the platform.
- **SC-002**: A workspace-scoped caller can complete upload → metadata → download → delete for an object through the unified API while remaining inside the same tenant/workspace scope.
- **SC-003**: Cross-workspace and cross-tenant requests to list, read, download, or delete buckets/objects outside scope are denied or hidden consistently, with no data leakage.
- **SC-004**: Public bucket/object contracts and route catalog entries remain additive, provider-agnostic, and ready for later sibling tasks that add error normalization and multi-provider verification.
- **SC-005**: Bucket/object mutation flows preserve correlation and idempotency metadata sufficient for audit and retry-safe orchestration.

## 5. Assumptions and Dependencies

- `US-STO-01-T01` supplies the provider abstraction/profile and common capability manifest.
- `US-STO-01-T02` supplies an active tenant storage context, including namespace/quota baseline and bootstrap dependency behavior.
- `US-PRG-02` remains the source of plugin/provider registration semantics.
- `US-TEN-01` remains the source of tenant/workspace identity and authorization boundaries.
- The existing storage family (`/v1/storage/...`) is the correct public family for this task; this task extends it instead of creating a parallel family.

## 6. Explicit Out of Scope

- Defining the long-term logical layout strategy for tenant/workspace/application prefixes or overlays (`US-STO-01-T04`).
- Normalizing every provider-native error into a final common taxonomy (`US-STO-01-T05`).
- Running the same behavior suite against multiple supported providers (`US-STO-01-T06`).
- Introducing presigned URL flows, multipart orchestration, lifecycle-retention policies, versioning controls, or event-delivery subscriptions as first-class deliverables in this task.
