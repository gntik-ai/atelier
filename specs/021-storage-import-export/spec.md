# Feature Specification: Storage Object & Metadata Import/Export

**Feature Branch**: `021-storage-import-export`
**Task**: US-STO-03-T03
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-03 — Credenciales programáticas, uso agregado, import/export y auditoría de storage
**Requirements traceability**: RF-STO-017
**Dependencies**: US-STO-01 (full chain: specs 007–012), US-STO-03-T01 (spec 019), US-STO-03-T02 (spec 020)
**Created**: 2026-03-28
**Status**: Specified

## Repo-local dependency map

| Concern | Module / Path | Relevance |
|---|---|---|
| Bucket & object operations | `services/adapters/src/storage-bucket-object-ops.mjs` | `buildStorageBucketRecord`, `buildStorageObjectRecord`, `buildStorageObjectCollection`, `buildStorageObjectMetadata`. Import/export reads and writes objects and metadata through this surface. |
| Tenant storage context | `services/adapters/src/storage-tenant-context.mjs` | `buildTenantStorageContextRecord`. Provides tenant-level storage context (provider type, credentials, quota assignment) that anchors import/export operations. |
| Bucket policies & access evaluation | `services/adapters/src/storage-access-policy.mjs` | `evaluateStorageAccessDecision`, `STORAGE_POLICY_ACTIONS`. Import/export authorization must be evaluated through the existing policy model. |
| Scoped programmatic credentials (spec 019) | `services/adapters/src/storage-programmatic-credentials.mjs` | Import/export operations performed via programmatic credentials must be attributable to the credential holder. Credential scope must include the required actions. |
| Storage usage reporting (spec 020) | `services/adapters/src/storage-usage-reporting.mjs` | Import operations affect storage consumption. Usage snapshots reflect imported data after completion. Quota admission must be checked before import. |
| Capacity quotas | `services/adapters/src/storage-capacity-quotas.mjs` | `buildStorageQuotaProfile`, `STORAGE_QUOTA_DIMENSIONS`. Import must perform quota admission checks before writing objects to prevent exceeding configured limits. |
| Logical organization | `services/adapters/src/storage-logical-organization.mjs` | `buildStorageLogicalOrganization`, `isStorageReservedPrefix`. Import must respect reserved prefix rules and logical organization conventions. |
| Multipart & presigned URLs | `services/adapters/src/storage-multipart-presigned.mjs` | Large object import/export may leverage presigned URLs for efficient transfer. |
| Error taxonomy | `services/adapters/src/storage-error-taxonomy.mjs` | Normalized error codes for import/export errors (validation failures, quota exceeded, format errors). |
| Event notifications | `services/adapters/src/storage-event-notifications.mjs` | Import/export lifecycle events follow the same event structure conventions. |
| Provider profile | `services/adapters/src/storage-provider-profile.mjs` | Provider-level capability awareness; import/export behavior may vary by provider capabilities. |
| Storage admin control plane | `apps/control-plane/src/storage-admin.mjs` | Admin surface where import/export endpoints will be added. |
| Existing tests | `tests/unit/storage-bucket-object-ops.test.mjs`, `tests/adapters/storage-bucket-object-ops.test.mjs` | Test patterns and runner conventions (`node --test`). |

---

## 1. Objective and Problem Statement

The storage subsystem supports bucket creation, object upload/download, access policies, presigned URLs, multipart uploads, scoped credentials, and usage reporting. However, there is no structured capability for **bulk import or export of objects and their associated metadata** across buckets or workspaces within the platform's governance boundaries.

Without this task:

- **Developers** who need to migrate data between buckets within a workspace (e.g., reorganization, schema evolution of stored data) must manually copy objects one at a time through the existing single-object API, without preserving custom metadata, content types, or logical organization in a coordinated operation.
- **Workspace admins** who need to seed a new workspace or bucket with data from an existing one have no platform-supported bulk operation — they must script individual object copies outside the platform, bypassing audit and quota checks.
- **Tenant owners** who need to extract a full or filtered snapshot of a bucket's contents and metadata for backup, compliance archival, or migration to another workspace have no structured export mechanism.
- **Service accounts** running automated data pipelines that produce batches of objects have no platform-aware bulk import that respects quotas, policies, and audit in a single coordinated operation.
- Audit trail cannot distinguish between ad-hoc individual object writes and intentional bulk data operations, making compliance review harder.

This task introduces **storage import/export** — a governed, scope-aware capability for bulk export of objects and their metadata from a source bucket and bulk import into a target bucket, within the platform's multi-tenant isolation, quota enforcement, access policy, and audit boundaries.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Developers** need to export objects from one bucket and import them into another (same or different workspace within the same tenant) for data reorganization, environment seeding, or migration workflows. They receive a structured, auditable bulk operation that preserves object metadata.
- **Workspace admins** need to seed new buckets with initial data from existing sources, or extract filtered snapshots for operational purposes. They receive a governed operation that respects quotas and policies without requiring manual scripting.
- **Tenant owners** need full or filtered bucket exports for compliance archival, backup snapshots, or capacity redistribution across workspaces. They receive an export manifest that describes exactly what was exported and when.
- **Service accounts** running automated pipelines need bulk import with quota pre-validation and a single audit trail entry for the entire batch, simplifying compliance and debugging.
- **Superadmins** need visibility into import/export operations across tenants for abuse detection and platform governance.

### Value delivered

- Enables structured bulk data movement within the platform's governance model — quotas, policies, and audit are enforced consistently.
- Preserves object metadata (content type, custom metadata headers, storage class, logical organization tags) across import/export, eliminating data loss during migration.
- Provides a manifest-based model that gives consumers full transparency over what was exported, what was imported, and what was skipped or failed.
- Reduces the operational burden of data migration and reorganization from manual per-object scripting to a single governed operation.
- Creates clear audit attribution for bulk data operations, distinguishing intentional migrations from ad-hoc writes.

---

## 3. In-Scope Capability

This task covers the **definition, validation, execution, and audit of bulk object and metadata import/export operations** within storage, bounded by the platform's multi-tenant isolation, quota enforcement, and access control model.

### In scope

- **Export**: Building a structured export manifest from a source bucket, including object keys, sizes, content types, custom metadata, and logical organization tags. The manifest describes the export without containing the object bodies directly — object bodies are referenced for retrieval via presigned download URLs or direct object-read operations.
- **Import**: Consuming an export manifest (or a compatible structured object list) to write objects and their metadata into a target bucket, with quota pre-validation, policy checks, and per-object outcome tracking.
- **Filtered export**: Exporting a subset of objects from a bucket using prefix filtering, key pattern matching, or metadata-based criteria.
- **Manifest format**: A structured, JSON-based manifest that lists the objects included in the export with their metadata, enabling validation before import begins.
- **Quota pre-validation on import**: Before writing any objects, the import operation evaluates whether the target bucket/workspace has sufficient quota headroom for the entire batch. If the batch would exceed quota, the import is rejected before any writes occur.
- **Per-object outcome tracking**: Each object in an import or export operation is tracked individually with a status (success, skipped, failed) and, for failures, a reason code. The overall operation reports aggregate counts and per-object details.
- **Conflict handling on import**: When an object key in the import manifest already exists in the target bucket, the operation follows a caller-specified conflict policy: `skip` (preserve existing), `overwrite` (replace), or `fail` (abort the import on first conflict).
- **Metadata preservation**: Custom metadata headers, content type, content encoding, and storage class are preserved across export/import. Object body integrity is preserved (byte-exact content).
- **Cross-bucket within tenant**: Import/export is supported between any two buckets within the same tenant, including across workspaces if the acting principal has sufficient permissions in both the source and target contexts.
- **Operational limits**: Configurable maximum objects per import/export operation (platform default and tenant-level override) to prevent unbounded operations from monopolizing resources.
- **Audit events**: Import and export operations produce audit events that record the acting principal, source/target bucket, object count, operation outcome, and timestamps.

### Out of scope

- **US-STO-03-T01**: Scoped programmatic credentials (specified in spec 019).
- **US-STO-03-T02**: Storage usage reporting (specified in spec 020).
- **US-STO-03-T04**: Full data-plane audit schema for storage operations.
- **US-STO-03-T05**: Credential rotation/revocation test suite.
- **US-STO-03-T06**: Documentation of limits, SLAs, and cost considerations.
- **Cross-tenant import/export**: Moving data between tenants is not supported. Tenant isolation is absolute.
- **Streaming/incremental sync**: Continuous replication or change-data-capture between buckets is a separate concern.
- **Object versioning during import**: If the target bucket has versioning enabled (future capability), import creates new versions — but versioning semantics are not part of this spec.
- **Console UI for import/export**: This spec defines the API behavior. Console components are a separate task.
- **Background/asynchronous job orchestration**: This spec defines the import/export operations as request-scoped. Background job scheduling for very large operations is a future operational enhancement.
- **Export to external destinations**: Export produces a platform-internal manifest; packaging for external archive formats (tar, zip) is out of scope.

---

## 4. User Scenarios & Testing

### User Story 1 — Developer exports objects from a bucket with a manifest (Priority: P1)

A developer exports all or a filtered subset of objects from a bucket in their workspace. The export produces a structured manifest listing every exported object with its key, size, content type, custom metadata, and a mechanism to retrieve the object body.

**Why this priority**: Export is the foundation — without a structured export, import has nothing to consume. The manifest model enables validation, selective import, and audit.

**Independent Test**: A developer exports a bucket with 5 objects using a prefix filter that matches 3 of them. The resulting manifest contains exactly 3 entries with correct metadata. Object bodies are retrievable via the references in the manifest.

**Acceptance Scenarios**:

1. **Given** bucket B1 in workspace W has 5 objects (obj-a, obj-b, data/obj-c, data/obj-d, logs/obj-e), **When** the developer requests an export of B1 with prefix filter `data/`, **Then** the export manifest includes exactly 2 entries (data/obj-c, data/obj-d), each with their key, size in bytes, content type, custom metadata map, content encoding, storage class, and last modified timestamp.
2. **Given** the same export, **When** the developer inspects the manifest, **Then** each entry includes a reference (presigned download URL or object-read instruction) that allows retrieving the object body within a configurable validity window.
3. **Given** bucket B1 has no objects matching the filter, **When** the export is requested, **Then** the manifest is returned with an empty object list, zero total bytes, and the export is considered successful (not an error).
4. **Given** the developer does not have read access to bucket B1 (per bucket policy), **When** the export is requested, **Then** the request is rejected with an authorization error.

---

### User Story 2 — Developer imports objects into a target bucket from a manifest (Priority: P1)

A developer imports objects into a target bucket using an export manifest (or a compatible structured object list). The import performs quota pre-validation, writes objects with their metadata, and reports per-object outcomes.

**Why this priority**: Import is the complementary operation to export and the primary data-movement capability. Quota pre-validation prevents partial writes that would leave the bucket in an inconsistent state.

**Independent Test**: A developer imports a manifest with 3 objects into a target bucket that has sufficient quota. All 3 objects are created with correct metadata. The import summary reports 3 successes, 0 failures.

**Acceptance Scenarios**:

1. **Given** an export manifest with 3 objects totaling 150 MB, and the target workspace has 500 MB remaining quota, **When** the developer imports the manifest into target bucket B2, **Then** all 3 objects are created in B2 with their original content type, custom metadata, and content encoding preserved. The import summary reports `imported: 3, skipped: 0, failed: 0, totalBytes: 150 MB`.
2. **Given** an export manifest with 3 objects totaling 600 MB, and the target workspace has 500 MB remaining quota, **When** the developer requests the import, **Then** the import is rejected before any writes with a `QUOTA_EXCEEDED` error indicating the shortfall (600 MB requested vs. 500 MB available).
3. **Given** the developer does not have write access to the target bucket B2 (per bucket policy), **When** the import is requested, **Then** the request is rejected with an authorization error.
4. **Given** the manifest contains an entry whose object key violates naming rules (e.g., starts with `/`), **When** the import is processed, **Then** that entry is marked as `failed` with reason `INVALID_OBJECT_KEY`, and remaining valid entries continue to be imported (the operation is not all-or-nothing for validation errors — only quota is all-or-nothing).

---

### User Story 3 — Import with conflict handling (Priority: P1)

A developer imports objects into a target bucket where some object keys already exist. The import follows the caller-specified conflict policy.

**Why this priority**: Conflict handling is essential for real-world use cases where target buckets are not empty. Without it, imports are limited to empty buckets.

**Independent Test**: A developer imports a manifest with 3 objects into a bucket where 1 key already exists, using `skip` policy. The import creates 2 new objects, skips 1, and reports the outcome accurately.

**Acceptance Scenarios**:

1. **Given** target bucket B2 already has object `data/obj-c`, and the import manifest includes `data/obj-c`, `data/obj-d`, `data/obj-e`, and the conflict policy is `skip`, **When** the import runs, **Then** `data/obj-c` is skipped (existing object preserved), `data/obj-d` and `data/obj-e` are created. Summary: `imported: 2, skipped: 1, failed: 0`.
2. **Given** the same scenario with conflict policy `overwrite`, **When** the import runs, **Then** `data/obj-c` is replaced with the manifest's version (new body and metadata), `data/obj-d` and `data/obj-e` are created. Summary: `imported: 3, skipped: 0, failed: 0`.
3. **Given** the same scenario with conflict policy `fail`, **When** the import detects the conflict on `data/obj-c`, **Then** the entire import is aborted before writing any objects, and the error identifies the conflicting key.
4. **Given** conflict policy is `overwrite` and the conflicting object is in a protected/reserved prefix (per `isStorageReservedPrefix`), **When** the import processes that entry, **Then** the entry is marked `failed` with reason `OBJECT_PROTECTED` — reserved objects cannot be overwritten by import, regardless of conflict policy.

---

### User Story 4 — Cross-workspace import within the same tenant (Priority: P1)

A workspace admin or developer with permissions in two workspaces within the same tenant exports from a source bucket in workspace W1 and imports into a target bucket in workspace W2.

**Why this priority**: Cross-workspace data movement within a tenant is a core migration and environment-seeding use case.

**Independent Test**: A developer with read access on W1/B1 and write access on W2/B2 exports from B1 and imports into B2. Objects and metadata transfer correctly. Quota is checked against W2's limits.

**Acceptance Scenarios**:

1. **Given** developer D has `object.get` and `object.list` on W1/B1 and `object.put` on W2/B2, **When** D exports from W1/B1 and imports into W2/B2, **Then** the export succeeds (read from W1), the import succeeds (write to W2), quota is validated against W2's quota profile, and both operations produce audit events in their respective workspace audit trails.
2. **Given** developer D has read access on W1/B1 but no write access on W2/B2, **When** D attempts to import into W2/B2, **Then** the import is rejected with an authorization error. The export (if already completed) is unaffected.
3. **Given** developer D attempts to import from a manifest referencing a bucket in tenant T2 (a different tenant), **When** the import processes the manifest, **Then** the import is rejected — cross-tenant object references are not resolvable.

---

### User Story 5 — Workspace admin exports a full bucket snapshot for archival (Priority: P2)

A workspace admin exports every object in a bucket without filters to create a complete metadata snapshot for compliance archival or backup.

**Why this priority**: Full-bucket export is essential for compliance and backup but is less frequent than filtered export. It depends on the same machinery as filtered export.

**Independent Test**: A workspace admin exports a bucket with 50 objects (no filter). The manifest contains exactly 50 entries. Aggregate totals (byte count, object count) in the manifest header match the sum of individual entries.

**Acceptance Scenarios**:

1. **Given** bucket B1 has 50 objects totaling 2 GB, **When** the workspace admin requests a full export (no filter), **Then** the manifest includes all 50 entries, a header with `totalObjects: 50`, `totalBytes: 2 GB`, the source bucket identifier, workspace, tenant, export timestamp, and the acting principal.
2. **Given** the export manifest is produced, **When** the admin inspects the manifest, **Then** the sum of individual entry `sizeBytes` values equals the header `totalBytes`.
3. **Given** the bucket exceeds the configured maximum objects per export (e.g., limit is 1000 and the bucket has 1500 objects), **When** the export is requested without pagination, **Then** the export is rejected with an `OPERATION_LIMIT_EXCEEDED` error indicating the limit and the bucket's object count. The admin must use filtered/paginated export to work within the limit.

---

### User Story 6 — Tenant owner inspects import/export activity (Priority: P2)

A tenant owner reviews audit events for import/export operations across their workspaces to ensure data movement complies with governance policies.

**Why this priority**: Governance visibility over bulk data movement is a security and compliance requirement, but depends on the P1 operations existing first.

**Independent Test**: After an import and an export operation, the tenant owner queries audit events and finds entries for both operations with correct metadata (principal, source/target, object count, outcome).

**Acceptance Scenarios**:

1. **Given** developer D exported 10 objects from W1/B1 and imported 8 of them into W2/B2 (2 skipped due to conflict policy `skip`), **When** the tenant owner queries storage audit events, **Then** there are two events: one export event (source: W1/B1, objectCount: 10, outcome: success) and one import event (target: W2/B2, imported: 8, skipped: 2, failed: 0, outcome: success), both attributed to developer D.
2. **Given** an import was rejected due to quota exceeded, **When** the tenant owner queries audit events, **Then** the import event records the rejection with outcome `quota_exceeded`, the requested byte total, and the available quota.

---

### User Story 7 — Operational limits prevent resource monopolization (Priority: P2)

Configurable limits on maximum objects per import/export operation prevent a single operation from monopolizing storage provider resources or creating excessively long-running requests.

**Why this priority**: Operational safety limits are important for platform stability but are secondary to the core import/export functionality.

**Independent Test**: An import with 5001 objects is rejected when the platform limit is 5000. A tenant with a custom limit of 10000 can process 8000 objects.

**Acceptance Scenarios**:

1. **Given** the platform default limit is 5000 objects per operation and no tenant override exists, **When** a developer requests an export with 5001 matching objects, **Then** the export is rejected with `OPERATION_LIMIT_EXCEEDED`.
2. **Given** tenant T has a configured limit of 10000 objects per operation, **When** a developer in T requests an import with 8000 objects, **Then** the import proceeds normally (tenant limit overrides platform default).
3. **Given** the limit applies, **When** a developer requests an export with prefix filter that matches exactly the limit (e.g., 5000 objects), **Then** the export succeeds — the limit is inclusive.

---

### Edge Cases

- **Empty manifest import**: An import with an empty object list succeeds immediately with summary `imported: 0, skipped: 0, failed: 0`. No quota is consumed. An audit event is still produced.
- **Object key with special characters**: Object keys containing URL-unsafe characters, Unicode, or whitespace are preserved exactly in the manifest and during import. No key normalization or sanitization is applied beyond the existing `assertObjectKey` validation.
- **Manifest referencing deleted objects**: If a presigned URL in the manifest has expired or the source object has been deleted between export and import, the individual entry is marked `failed` with reason `OBJECT_NOT_FOUND`. Other entries continue processing.
- **Duplicate keys in manifest**: If the manifest contains two entries with the same object key, the import rejects the manifest with `MANIFEST_VALIDATION_ERROR` — duplicate keys are not permitted.
- **Reserved prefix in import**: Objects whose keys fall under a reserved prefix (per `isStorageReservedPrefix`) are rejected per-entry with reason `OBJECT_PROTECTED`. The rest of the import continues.
- **Zero-byte objects**: Zero-byte objects are valid and included in export manifests with `sizeBytes: 0`. They are imported normally and count toward the object count quota dimension but not the byte quota dimension.
- **Large object in manifest**: Objects exceeding the provider's single-upload size limit are noted in the manifest. During import, the platform uses multipart upload if the object exceeds the provider's single-put threshold — this is transparent to the caller.
- **Manifest from incompatible version**: The manifest includes a format version. If the importer encounters a manifest with an unsupported version, it rejects the import with `MANIFEST_VERSION_UNSUPPORTED`.
- **Concurrent modification during export**: Export produces a point-in-time snapshot. If objects are modified or deleted during export enumeration, the manifest reflects the state at the time each object was read. No transactional consistency is guaranteed across the full enumeration.
- **Import into same bucket as source**: Self-import (same bucket as source and target) is permitted only with conflict policy `skip` — all entries would be conflicts and all would be skipped. With `overwrite`, the operation is permitted but the objects are effectively re-written with the same content (idempotent). With `fail`, the operation aborts on the first existing key.
- **Quota check with skipped objects**: Quota pre-validation accounts for the worst case (all objects imported). If the conflict policy is `skip` and some objects already exist, the actual consumption may be less than pre-validated. The platform does not attempt to optimize the quota check by predicting skips — it validates against the full manifest size.

---

## 5. Functional Requirements

### Export

- **FR-001**: The system MUST allow authorized principals to export a structured manifest of objects from a source bucket within their authorized scope.
- **FR-002**: The export manifest MUST include a header with: source bucket identifier, source workspace, source tenant, acting principal, export timestamp (ISO-8601), total object count, total byte size, manifest format version, and filter criteria applied (if any).
- **FR-003**: Each entry in the export manifest MUST include: object key, size in bytes, content type, content encoding, storage class, custom metadata map (key-value pairs), last modified timestamp, and an object body reference (presigned download URL with configurable validity or a platform object-read reference).
- **FR-004**: The export MUST support prefix filtering: only objects whose keys start with a specified prefix are included.
- **FR-005**: The export MUST support metadata filtering: only objects matching a specified custom metadata key-value criterion are included.
- **FR-006**: The export MUST respect access policy evaluation: the acting principal must have `object.get` and `object.list` permissions on the source bucket (evaluated via `evaluateStorageAccessDecision`).
- **FR-007**: The export MUST enforce the configured maximum objects per operation limit. If the number of matching objects exceeds the limit, the export MUST be rejected with `OPERATION_LIMIT_EXCEEDED`.

### Import

- **FR-008**: The system MUST allow authorized principals to import objects into a target bucket from a structured manifest within their authorized scope.
- **FR-009**: The import MUST perform quota pre-validation against the target workspace's quota profile (using the quota admission model from `storage-capacity-quotas`) before writing any objects. If the total manifest byte size would exceed remaining quota, the import MUST be rejected with `QUOTA_EXCEEDED` before any writes.
- **FR-010**: The import MUST validate each object key against the existing object-key rules (`assertObjectKey`). Invalid keys are marked as `failed` per-entry; valid entries continue processing.
- **FR-011**: The import MUST reject entries whose object keys fall under reserved prefixes (per `isStorageReservedPrefix`) with per-entry reason `OBJECT_PROTECTED`.
- **FR-012**: The import MUST respect access policy evaluation: the acting principal must have `object.put` permission on the target bucket.
- **FR-013**: The import MUST support a caller-specified conflict policy for existing keys: `skip` (preserve existing, mark entry as skipped), `overwrite` (replace existing object and metadata), or `fail` (abort entire import on first conflict).
- **FR-014**: The import MUST preserve object metadata from the manifest: content type, content encoding, storage class, and custom metadata key-value pairs.
- **FR-015**: The import MUST produce a structured result summary including: total entries processed, imported count, skipped count, failed count, total bytes imported, per-entry outcome list (key, status, reason for non-success), and import timestamp.
- **FR-016**: The import MUST reject manifests containing duplicate object keys with `MANIFEST_VALIDATION_ERROR`.
- **FR-017**: The import MUST reject manifests with an unsupported format version with `MANIFEST_VERSION_UNSUPPORTED`.
- **FR-018**: The import MUST enforce the configured maximum objects per operation limit, rejecting manifests that exceed it with `OPERATION_LIMIT_EXCEEDED`.

### Manifest Format

- **FR-019**: The manifest MUST be a structured JSON document with a versioned schema. The initial version is `1`.
- **FR-020**: The manifest MUST be self-describing: it contains all metadata needed for validation and import without requiring access to the source bucket (except for object body retrieval).
- **FR-021**: The manifest MUST NOT contain object body content inline. Object bodies are referenced, not embedded.

### Cross-Bucket and Cross-Workspace

- **FR-022**: Import/export MUST be supported between any two buckets within the same tenant, including across different workspaces, provided the acting principal has the required permissions in both contexts.
- **FR-023**: Cross-tenant import/export MUST be rejected. Manifest entries referencing objects in a different tenant MUST be rejected with `CROSS_TENANT_VIOLATION`.

### Operational Limits

- **FR-024**: The platform MUST enforce a configurable maximum number of objects per import/export operation. The limit applies at the platform level with optional tenant-level overrides.
- **FR-025**: The platform default limit MUST be defined as a system configuration value. Tenant-level overrides, when present, take precedence.

### Audit

- **FR-026**: Every export operation MUST produce an audit event including: acting principal, source bucket, source workspace, source tenant, object count, total bytes, filter criteria, outcome (success/failure), and timestamp.
- **FR-027**: Every import operation MUST produce an audit event including: acting principal, target bucket, target workspace, target tenant, source manifest reference, entries processed, imported count, skipped count, failed count, total bytes imported, conflict policy, outcome, and timestamp.
- **FR-028**: Audit events for import/export MUST NOT include object body content or presigned URLs — only structural metadata.
- **FR-029**: When a programmatic credential (spec 019) is used for import/export, the audit event MUST attribute the operation to both the credential identifier and the owning principal.

### Multi-Tenant Isolation

- **FR-030**: Import/export operations and their audit events MUST be fully isolated by tenant boundary. No import/export data, manifest, or audit event from one tenant is visible to another tenant.
- **FR-031**: Within a tenant, import/export operations are authorized per workspace: a principal must hold the required permissions in each workspace involved in the operation.

### Error Handling

- **FR-032**: Import/export errors MUST follow the `storage-error-taxonomy` conventions with normalized error codes.
- **FR-033**: The following error codes are introduced for import/export: `MANIFEST_VALIDATION_ERROR`, `MANIFEST_VERSION_UNSUPPORTED`, `OPERATION_LIMIT_EXCEEDED`, `CROSS_TENANT_VIOLATION`, `IMPORT_PARTIAL_FAILURE` (when some entries fail but others succeed), `EXPORT_EMPTY_RESULT` (informational, not an error — included in response metadata when no objects match the filter).

### Key Entities

- **Export Manifest**: A versioned JSON document describing a set of objects exported from a source bucket. Key attributes: format version, source bucket/workspace/tenant, acting principal, export timestamp, filter criteria, total object count, total bytes, and an ordered list of object entries (each with key, size, content type, custom metadata, body reference).
- **Import Result Summary**: A structured outcome report for an import operation. Key attributes: target bucket/workspace/tenant, acting principal, import timestamp, conflict policy, total entries, imported count, skipped count, failed count, total bytes imported, and per-entry outcome list.
- **Object Entry**: A single object's representation within a manifest. Key attributes: object key, size in bytes, content type, content encoding, storage class, custom metadata map, last modified timestamp, body reference, and (during import) outcome status and reason.

---

## 6. Business Rules and Governance

- Import/export operates within the same governance model as individual object operations — access policies, quotas, reserved-prefix rules, and audit apply identically. Bulk does not mean ungoverned.
- Quota pre-validation on import uses worst-case accounting (full manifest size) regardless of conflict policy. This is conservative by design — it prevents partial writes from exceeding quota in edge cases where conflict detection cannot be pre-computed cheaply.
- The manifest is an intermediate artifact, not a persistent platform resource. The platform produces it on export and consumes it on import. Storage and lifecycle of manifests between these operations is the caller's responsibility.
- Conflict policy is caller-specified per import operation. There is no default — the caller must declare intent explicitly. This prevents accidental overwrites.
- Cross-workspace import within a tenant requires independent authorization checks in both the source workspace (for export/read) and the target workspace (for import/write). Holding admin in one workspace does not grant import/export rights in another.
- Object body integrity is byte-exact. The platform does not transform, transcode, or re-encode object content during import/export. Content arrives at the target exactly as it was at the source.
- Operational limits are safety mechanisms, not hard security boundaries. They exist to prevent resource monopolization and excessively long-running operations, not to enforce business rules about data volume.
- Expired presigned URLs in a manifest result in per-entry failures, not whole-import rejection. The caller can re-export to obtain fresh references and retry.

---

## 7. Acceptance Criteria

1. A developer can export objects from a bucket and receive a structured manifest containing per-object metadata and body references, filtered by prefix or metadata criteria.
2. A developer can import objects from a manifest into a target bucket, with all metadata (content type, custom metadata, content encoding, storage class) preserved exactly.
3. Import performs quota pre-validation against the target workspace's quota profile and rejects the entire import if the manifest would exceed remaining capacity.
4. Import supports `skip`, `overwrite`, and `fail` conflict policies, and each policy behaves as specified when object keys already exist in the target bucket.
5. Reserved-prefix objects are rejected per-entry during import without aborting the rest of the operation.
6. Invalid object keys in a manifest are rejected per-entry during import without aborting valid entries.
7. Cross-workspace import within the same tenant succeeds when the principal has read permissions on the source and write permissions on the target.
8. Cross-tenant import/export is rejected unconditionally.
9. The import result summary accurately reports imported, skipped, and failed counts with per-entry detail.
10. Export and import operations produce audit events with complete structural metadata (principal, bucket, workspace, counts, outcome) and no object body content or presigned URLs.
11. Operations performed via programmatic credentials are attributed to both the credential and its owning principal in audit events.
12. Operational limits (maximum objects per operation) are enforced, with tenant-level overrides taking precedence over platform defaults.
13. Manifests with duplicate keys or unsupported versions are rejected before processing begins.
14. Export of an empty result (no matching objects) succeeds with an empty manifest — it is not an error.
15. Object body integrity is byte-exact: content imported matches content exported without transformation.
16. Import/export data and audit events are fully tenant-isolated.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The S3-compatible storage provider supports the admin or data-plane API operations needed to list objects with metadata, read object bodies, and write objects with custom metadata. MinIO, Ceph RGW, and Garage all support these operations.
- Presigned URLs (spec `013`) are available for generating download references for exported objects, with configurable validity windows.
- The bucket policy evaluation model (spec `014`) can authorize the `object.get`, `object.list`, and `object.put` actions needed for export and import respectively.
- The quota admission model (spec `015`) can evaluate a proposed import batch (total bytes, object count increment) against the target workspace's quota profile.
- The error taxonomy (spec `011`) can be extended with the new error codes introduced by this spec without breaking existing consumers.

### Risks

- **Large manifests and memory pressure**: A manifest for a bucket with thousands of objects could be large. Mitigation: the operational limit caps the maximum objects per operation; the manifest is a JSON document, not an in-memory array of object bodies; and object bodies are referenced, not embedded.
- **Presigned URL expiration between export and import**: If significant time passes between export and import, presigned download URLs in the manifest may expire. Mitigation: manifest entries with expired references are marked as per-entry failures; the caller can re-export to refresh. The validity window is configurable.
- **Provider API rate limits during bulk operations**: A large import may generate many PUT requests to the storage provider in quick succession. Mitigation: this is an implementation concern (batching, backpressure) to be addressed during planning — the spec defines the functional behavior, not the execution strategy.
- **Quota pre-validation race condition**: Between quota pre-validation and the actual writes, other operations could consume the remaining quota. Mitigation: the quota system's admission check at write time serves as the ultimate guardrail. Pre-validation is a best-effort early rejection, not a reservation.

### Blocking questions

None identified. The prerequisite surfaces (bucket/object operations, presigned URLs, access policies, quota admission, error taxonomy) are specified or implemented.

---

## 9. Success Criteria

- **SC-001**: A developer can export and re-import 100 objects with metadata in under 60 seconds end-to-end (excluding network transfer time for object bodies).
- **SC-002**: Quota pre-validation on import rejects over-quota batches within 2 seconds, before any object writes occur.
- **SC-003**: 100% of import/export operations produce correct audit events with full structural metadata.
- **SC-004**: Object metadata round-trip fidelity: content type, custom metadata, content encoding, and storage class are identical after export + import (verifiable by automated comparison).
- **SC-005**: No cross-tenant data leakage: import/export operations and audit events from one tenant are inaccessible to any other tenant (verifiable by automated authorization test).
- **SC-006**: Conflict policy behavior is deterministic: the same manifest imported with the same conflict policy into the same target state produces the same outcome every time.
