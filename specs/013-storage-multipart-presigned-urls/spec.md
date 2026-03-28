# Feature Specification: Multipart Upload and Presigned URLs

**Feature Branch**: `013-storage-multipart-presigned-urls`
**Created**: 2026-03-28
**Status**: Specified
**Task ID**: US-STO-02-T01
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-02 — Multipart, presigned URLs, políticas, cuotas, eventos y capabilities de provider
**Input**: Backlog prompt: "Implementar subida multipart y presigned URLs cuando el backend elegido lo permita."

**Compatibility note**: This is the first task in the `US-STO-02` story (`EP-12 — Storage S3-compatible`). It delivers multipart upload orchestration and presigned URL generation as **capability-gated** features that activate only when the active storage provider declares support. It depends on the entire `US-STO-01` story chain: provider abstraction (`T01` / spec `007`), tenant storage context (`T02` / spec `008`), bucket/object operations (`T03` / spec `009`), logical organization (`T04` / spec `010`), error taxonomy and minimum capability baseline (`T05` / spec `011`), and multi-provider verification (`T06` / spec `012`). This spec is **additive-only**: it extends the existing storage surface without modifying or replacing any published contract from the `US-STO-01` deliverables.

This task does **not** implement bucket policies or per-tenant permissions (`US-STO-02-T02`), capacity quotas or limits (`US-STO-02-T03`), Kafka/OpenWhisk event emission for storage operations (`US-STO-02-T04`), provider capability exposure and introspection for versioning/lifecycle/object-lock/events/policies (`US-STO-02-T05`), or advanced capability degradation tests (`US-STO-02-T06`).

## 1. User Scenarios & Testing

### User Story 1 — Capability-gated multipart upload for large objects (Priority: P1)

A developer or service account can upload large objects to an authorized workspace bucket using a managed multipart upload flow when the active storage provider supports it, without knowing the provider's native multipart API.

**Why this priority**: Large-object upload is a core developer need that the basic single-request `object.put` from T03 cannot serve reliably beyond a few hundred megabytes. Without multipart, the platform cannot compete with provider-native upload capabilities.

**Independent Test**: A caller initiates, uploads parts to, and completes a multipart upload through the unified storage API on a provider that declares `object.multipart_upload` as `satisfied`, and receives a standard object record upon completion.

**Acceptance Scenarios**:

1. **Given** the active storage provider declares `object.multipart_upload` as `satisfied` and the caller has upload permission on a workspace bucket, **When** the caller initiates a multipart upload specifying the target bucket and object key, **Then** the platform returns a multipart upload session identifier and the object enters a `pending_multipart` state.
2. **Given** an active multipart upload session exists, **When** the caller uploads a numbered part with binary content, **Then** the platform stores the part and returns a part receipt (part number and ETag or integrity token) without exposing provider-specific part identifiers beyond the receipt.
3. **Given** all parts have been uploaded, **When** the caller completes the multipart upload by submitting the ordered list of part receipts, **Then** the platform assembles the final object, the object transitions to a normal stored state, the multipart session is cleaned up, and the caller receives the standard object record (including final ETag, size, and object key).
4. **Given** a multipart upload is active, **When** the caller aborts it, **Then** all uploaded parts are cleaned up, the multipart session is removed, no partial object is visible in the bucket, and the platform confirms the abort.
5. **Given** the active storage provider declares `object.multipart_upload` as `unsatisfied`, **When** a caller attempts to initiate a multipart upload, **Then** the platform rejects the request with `CAPABILITY_NOT_AVAILABLE` identifying `object.multipart_upload` as the missing capability.

---

### User Story 2 — Capability-gated presigned URL generation for time-limited access (Priority: P1)

A developer, service account, or workspace admin can generate a time-limited presigned URL for an object in an authorized workspace bucket when the active storage provider supports it, enabling direct-to-provider upload or download without proxying through the platform API.

**Why this priority**: Presigned URLs are the standard pattern for efficient, client-side-direct file transfers in S3-compatible ecosystems. Without them, every upload/download must be proxied through the platform, adding latency, bandwidth cost, and failure surface.

**Independent Test**: A caller requests a presigned URL (upload or download) through the unified storage API on a provider that declares `bucket.presigned_urls` as `satisfied`, receives a URL with an expiration, and the URL is usable for the intended operation within the TTL window.

**Acceptance Scenarios**:

1. **Given** the active storage provider declares `bucket.presigned_urls` as `satisfied` and the caller has download permission on a workspace bucket, **When** the caller requests a presigned download URL for an existing object, **Then** the platform returns a URL and its expiration timestamp, and the URL can be used to download the object directly from the provider without further platform authentication within the TTL window.
2. **Given** the active storage provider declares `bucket.presigned_urls` as `satisfied` and the caller has upload permission, **When** the caller requests a presigned upload URL for a target object key, **Then** the platform returns a URL and its expiration timestamp, and the URL can be used to upload an object directly to the provider within the TTL window.
3. **Given** a presigned URL has been generated, **When** the TTL expires, **Then** the URL ceases to be usable and the provider returns an access denial or expiration error.
4. **Given** the active storage provider declares `bucket.presigned_urls` as `unsatisfied`, **When** a caller attempts to generate a presigned URL, **Then** the platform rejects the request with `CAPABILITY_NOT_AVAILABLE` identifying `bucket.presigned_urls` as the missing capability.
5. **Given** a presigned download URL is generated for an object in Tenant A's workspace, **When** the URL is used, **Then** the operation is constrained to the specific object key and bucket; the URL does not grant access to other objects, other buckets, or other tenants' storage.

---

### User Story 3 — Graceful degradation when capabilities are unavailable (Priority: P1)

A platform consumer receives clear, machine-readable feedback when it requests a multipart upload or presigned URL on a provider that does not support the capability, enabling the consumer to fall back to the standard single-request upload/download flow.

**Why this priority**: The platform must never silently fail or behave unpredictably when optional capabilities are absent. Graceful degradation is the contract that makes the declarative capability model trustworthy.

**Independent Test**: On a provider profile where `object.multipart_upload` or `bucket.presigned_urls` is `unsatisfied`, the caller receives a structured rejection that identifies exactly which capability is missing and includes enough context to guide a fallback strategy.

**Acceptance Scenarios**:

1. **Given** the provider does not support multipart upload, **When** the caller initiates a multipart upload, **Then** the response uses the normalized error code `CAPABILITY_NOT_AVAILABLE`, names `object.multipart_upload`, and includes a hint that the caller should use single-request `object.put` instead.
2. **Given** the provider does not support presigned URLs, **When** the caller requests a presigned URL, **Then** the response uses `CAPABILITY_NOT_AVAILABLE`, names `bucket.presigned_urls`, and includes a hint that the caller should use the proxied upload/download endpoints instead.
3. **Given** the provider partially supports multipart upload (e.g., with a lower `maxParts` than requested), **When** the caller exceeds the constraint, **Then** the response uses `MULTIPART_CONSTRAINT_EXCEEDED` and includes the constraint metadata (expected vs. actual limit).

---

### User Story 4 — Multipart upload lifecycle governance and observability (Priority: P2)

A tenant owner or workspace admin can observe active multipart uploads in progress and the platform enforces lifecycle governance to prevent orphaned multipart sessions from consuming quota indefinitely.

**Why this priority**: Multipart uploads that are initiated but never completed consume provider-side storage. Without lifecycle governance, abandoned uploads become an invisible quota drain and an operational hazard.

**Independent Test**: The platform tracks active multipart upload sessions per workspace, surfaces them through the storage API, and applies a configurable session TTL after which stale sessions are eligible for abort.

**Acceptance Scenarios**:

1. **Given** one or more multipart upload sessions are active in a workspace bucket, **When** an authorized caller lists active multipart uploads, **Then** the response includes the session identifier, target object key, initiation timestamp, part count, and accumulated size for each active session.
2. **Given** a multipart upload session has exceeded the platform-configured session TTL, **When** the lifecycle governance process evaluates the session, **Then** it marks the session as stale and eligible for cleanup (abort).
3. **Given** a stale multipart session exists, **When** the platform's cleanup process runs, **Then** the session is aborted, uploaded parts are removed, and an audit event records the automated abort including session identifier, reason, and tenant/workspace context.

---

### User Story 5 — Presigned URL audit trail and security controls (Priority: P2)

Every presigned URL generation is audit-traceable and subject to platform-level security constraints: maximum TTL, scope restrictions, and correlation to the requesting identity.

**Why this priority**: Presigned URLs bypass the platform's per-request authentication for the duration of the TTL. Without audit and governance controls, they become an unmonitored exfiltration or ingestion vector.

**Independent Test**: A presigned URL generation request produces an audit event capturing the requesting identity, target resource, TTL, operation type, and correlation context. The platform enforces a maximum TTL ceiling regardless of what the caller requests.

**Acceptance Scenarios**:

1. **Given** a caller requests a presigned URL with a specific TTL, **When** the request is processed, **Then** the platform records an audit event containing: the requesting identity, tenant/workspace/bucket/object-key scope, operation type (upload or download), granted TTL, and correlation context.
2. **Given** a caller requests a presigned URL with a TTL exceeding the platform-configured maximum, **When** the request is processed, **Then** the platform either clamps the TTL to the maximum and indicates the clamped value, or rejects the request with a clear error identifying the maximum allowed TTL.
3. **Given** a presigned URL is generated, **When** the audit record is reviewed, **Then** it is possible to trace back to the exact actor, session, and authorization context that produced the URL.

### Edge Cases

- **Multipart upload with zero parts completed**: If a caller initiates a multipart upload and then calls complete with an empty part list, the platform MUST reject the completion as invalid.
- **Multipart part ordering gaps**: If the caller submits parts 1, 2, and 5 (skipping 3 and 4), the platform MUST reject completion with a diagnostic identifying the gap or misordering, consistent with S3 semantics.
- **Duplicate part number upload**: If the caller uploads the same part number twice, the platform MUST accept the latest upload for that part number (last-writer-wins) and use the latest part receipt at completion time.
- **Presigned URL for non-existent object (download)**: The platform MUST still generate the URL if the caller has access to the bucket, but the URL will produce a `404`/`OBJECT_NOT_FOUND` at use time. The URL generation itself does not verify object existence.
- **Presigned URL for a bucket the caller does not own**: The platform MUST deny the generation request before producing any URL. No URL is returned.
- **Concurrent multipart uploads to the same object key**: Multiple concurrent multipart uploads targeting the same object key in the same bucket are allowed (consistent with S3 semantics). Each has an independent session. Only one will produce the final object when completed; others remain independent until completed or aborted.
- **Multipart upload part size below provider minimum**: If a non-final part is smaller than the provider's minimum part size, the platform MUST reject that part upload with a constraint-related error identifying the minimum size.
- **Provider becomes unavailable mid-multipart**: If the provider becomes unreachable after a multipart upload has been initiated but before completion, the platform MUST return `STORAGE_PROVIDER_UNAVAILABLE` (from the error taxonomy) for any subsequent part upload or completion attempt. The session remains active and retryable when the provider recovers.
- **Presigned URL used after object deletion**: If the object is deleted after a presigned download URL is generated but before it is used, the URL returns a not-found response. The platform does not revoke presigned URLs retroactively.
- **Reserved platform prefix in multipart target key**: If the caller attempts a multipart upload targeting a key under `_platform/multipart/` or any other reserved prefix (from spec `010`), the platform MUST reject the request with `RESERVED_PREFIX_CONFLICT`.
- **Multipart upload session count limit per workspace**: The platform SHOULD enforce a configurable maximum number of concurrent multipart sessions per workspace to prevent session exhaustion.

## 2. Requirements

### Functional Requirements

#### Multipart Upload

- **FR-001**: The system MUST expose a unified workspace-scoped API to initiate a multipart upload for a target bucket and object key, returning a platform-managed multipart session identifier.
- **FR-002**: The system MUST expose a unified workspace-scoped API to upload an individual part to an active multipart session, identified by session identifier and part number, returning a part receipt (part number + integrity token).
- **FR-003**: The system MUST expose a unified workspace-scoped API to complete a multipart upload by submitting the ordered list of part receipts, assembling the final object, and returning the standard object record.
- **FR-004**: The system MUST expose a unified workspace-scoped API to abort an active multipart upload, cleaning up all uploaded parts and removing the session.
- **FR-005**: The system MUST expose a unified workspace-scoped API to list active multipart upload sessions in a bucket, including session identifier, target object key, initiation timestamp, part count, and accumulated size.
- **FR-006**: The multipart upload flow MUST be gated by the `object.multipart_upload` capability entry in the active provider's capability manifest. If the capability is `unsatisfied`, all multipart operations MUST be rejected with `CAPABILITY_NOT_AVAILABLE`.
- **FR-007**: The multipart upload flow MUST respect the provider's declared constraints (e.g., `maxParts`, minimum part size) and reject operations that violate them with constraint-specific errors.
- **FR-008**: The multipart upload flow MUST enforce tenant and workspace isolation: a session initiated in one workspace's bucket MUST NOT be accessible from another workspace or tenant.
- **FR-009**: The system MUST enforce a platform-configurable multipart session TTL. Sessions exceeding the TTL are marked stale and eligible for automated cleanup (abort).
- **FR-010**: Automated cleanup of stale multipart sessions MUST produce an audit event containing: session identifier, target bucket and object key, tenant/workspace context, abort reason (TTL exceeded), and timestamp.
- **FR-011**: The multipart upload completion MUST reject an empty part list, a part list with gaps or misordering, and parts whose receipts do not match the session.
- **FR-012**: The system MUST support concurrent multipart uploads to the same object key within the same bucket, each with an independent session, consistent with S3 multipart semantics.
- **FR-013**: Non-final parts below the provider's minimum part size MUST be rejected with a constraint-aware error identifying the minimum size.
- **FR-014**: The system SHOULD enforce a configurable maximum number of concurrent active multipart sessions per workspace.

#### Presigned URLs

- **FR-015**: The system MUST expose a unified workspace-scoped API to generate a presigned download URL for an object in an authorized bucket, returning the URL and its expiration timestamp.
- **FR-016**: The system MUST expose a unified workspace-scoped API to generate a presigned upload URL for a target object key in an authorized bucket, returning the URL and its expiration timestamp.
- **FR-017**: Presigned URL generation MUST be gated by the `bucket.presigned_urls` capability entry in the active provider's capability manifest. If the capability is `unsatisfied`, all presigned URL operations MUST be rejected with `CAPABILITY_NOT_AVAILABLE`.
- **FR-018**: The system MUST enforce a platform-configurable maximum presigned URL TTL. If the caller requests a TTL exceeding the maximum, the platform MUST either clamp to the maximum (indicating the clamped value) or reject the request.
- **FR-019**: Presigned URL generation MUST enforce tenant and workspace isolation: a caller MUST NOT be able to generate a presigned URL for a bucket or object outside their authorized scope.
- **FR-020**: Presigned download URL generation MUST NOT verify object existence at generation time. The URL may return a not-found error at use time if the object does not exist.
- **FR-021**: Presigned upload URLs MUST scope the upload to the specific target object key and bucket. The URL MUST NOT grant write access beyond the specified key.
- **FR-022**: The platform MUST NOT expose raw provider credentials, secret keys, or internal endpoint topology in presigned URL responses or in the URLs themselves beyond what is inherent to the S3 presigned URL protocol.

#### Capability Gating and Degradation

- **FR-023**: When a capability-gated operation is rejected due to an unsatisfied capability, the error response MUST include:
  - the normalized error code `CAPABILITY_NOT_AVAILABLE`,
  - the specific capability identifier that is missing (e.g., `object.multipart_upload`, `bucket.presigned_urls`),
  - a fallback hint describing the alternative approach (e.g., single-request upload, proxied download).
- **FR-024**: When a capability is `partially_satisfied`, the system MUST apply the declared constraints and reject operations that exceed them with `MULTIPART_CONSTRAINT_EXCEEDED` or an equivalent constraint-specific error including expected vs. actual values.

#### Audit and Observability

- **FR-025**: Every presigned URL generation MUST produce an audit event containing: requesting identity, tenant/workspace/bucket/object-key scope, operation type (upload or download), granted TTL, and correlation context.
- **FR-026**: Multipart upload lifecycle transitions (initiate, complete, abort, automated stale cleanup) MUST produce audit events with tenant/workspace/bucket/object-key context and correlation metadata.
- **FR-027**: Audit events for multipart and presigned operations MUST follow the same audit/correlation model established by spec `009` (bucket/object operations).

#### Additive Scope and Compatibility

- **FR-028**: All new API endpoints, contracts, and error codes introduced by this spec MUST be additive to the existing storage API surface from specs `007`–`012`. No published contract from those specs may be modified or removed.
- **FR-029**: Multipart upload operations MUST respect the logical organization model from spec `010`, including reserved platform prefix enforcement (`_platform/multipart/`, `_platform/presigned/`).
- **FR-030**: New normalized error codes introduced by this spec (`CAPABILITY_NOT_AVAILABLE`, `MULTIPART_CONSTRAINT_EXCEEDED`, `MULTIPART_SESSION_NOT_FOUND`, `MULTIPART_SESSION_EXPIRED`, `MULTIPART_INVALID_PART_ORDER`, `PRESIGNED_TTL_EXCEEDED`) MUST follow the error taxonomy structure from spec `011` and MUST NOT collide with existing error codes.

### Key Entities

- **Multipart Upload Session**: A platform-managed record tracking an in-progress multipart upload. Bound to one tenant, one workspace, one bucket, and one target object key. Contains: session identifier, initiation timestamp, session TTL deadline, part count, accumulated size, and lifecycle state (`active`, `stale`, `completing`, `completed`, `aborted`).
- **Multipart Part Receipt**: A record returned after a successful part upload. Contains: part number and integrity token (ETag or equivalent). Used to assemble the part list for completion.
- **Presigned URL Record**: A record returned after presigned URL generation. Contains: the presigned URL string, expiration timestamp, operation type (`upload` or `download`), target bucket, target object key, and the granted TTL.
- **Presigned URL Audit Event**: An audit record capturing: the requesting identity, presigned URL operation type, target scope (tenant/workspace/bucket/object-key), granted TTL, expiration timestamp, correlation context, and timestamp.
- **Multipart Lifecycle Audit Event**: An audit record capturing: multipart session identifier, lifecycle transition (initiate/complete/abort/stale-cleanup), target scope (tenant/workspace/bucket/object-key), part count and size at transition time, correlation context, and timestamp.

## 3. Security, Governance, Isolation, and Traceability

### Multi-tenancy and Isolation

- Multipart upload sessions are strictly scoped to one tenant and one workspace. A session initiated in Workspace A's bucket is invisible and inaccessible from Workspace B or from any other tenant.
- Presigned URL generation is authorized at the workspace level using the same permission model as bucket/object operations from spec `009`. The URL itself carries time-limited, scope-limited access — it does not bypass tenant isolation.
- Presigned URLs inherit the bucket's tenant binding: a URL generated for Tenant A's bucket cannot be used to access Tenant B's resources.

### Security

- Presigned URLs are the only mechanism in this spec that grants access outside the platform's per-request authentication boundary. Their security relies on:
  - **TTL enforcement**: a platform-configurable maximum TTL ceiling prevents unbounded access windows.
  - **Scope restriction**: each URL is bound to exactly one object key in one bucket. It does not grant broader access.
  - **Audit trail**: every generation is logged with full identity and correlation context.
  - **No credential exposure**: raw provider credentials or secret keys are not returned to the caller. The presigned URL's embedded signature is the standard S3 presigned mechanism.
- Multipart upload sessions do not bypass authentication. Each part upload, completion, and abort request is authenticated through the platform's standard authorization flow.
- Object keys targeting reserved platform prefixes (`_platform/multipart/`, `_platform/presigned/`, `_platform/events/`) are rejected for multipart upload initiation, consistent with spec `010` FR-005 and FR-006.

### Auditing

- Presigned URL audit events and multipart lifecycle audit events follow the same structure and correlation model as bucket/object audit events from spec `009` FR-014.
- Automated stale-session cleanup is audit-traceable: the platform records which sessions were aborted, when, and why.
- Audit events for these operations are published to the platform's event backbone (Kafka) for consumption by the audit subsystem.

### Quotas

- Multipart uploads in progress contribute to the tenant's storage usage tracking. Parts uploaded but not yet assembled count toward the tenant's storage footprint for quota evaluation purposes.
- The platform SHOULD enforce a configurable maximum concurrent multipart session count per workspace (FR-014) to prevent resource exhaustion.
- Quota enforcement for the final assembled object follows the same rules as single-request uploads from spec `009`. If the final object would exceed the tenant's storage quota, the completion step MUST fail with `STORAGE_QUOTA_EXCEEDED`.

## 4. Success Criteria

### Measurable Outcomes

- **SC-001**: On a provider where `object.multipart_upload` is `satisfied`, a caller can initiate → upload parts → complete a multipart upload and retrieve the resulting object through the standard `object.get` API, receiving the correct assembled content.
- **SC-002**: On a provider where `bucket.presigned_urls` is `satisfied`, a caller can generate a presigned download URL and successfully download an object using only that URL within the TTL window.
- **SC-003**: On a provider where `bucket.presigned_urls` is `satisfied`, a caller can generate a presigned upload URL and successfully upload an object using only that URL within the TTL window, and the object is subsequently retrievable through the standard `object.get` API.
- **SC-004**: On a provider where `object.multipart_upload` or `bucket.presigned_urls` is `unsatisfied`, the caller receives `CAPABILITY_NOT_AVAILABLE` with the specific missing capability named, and no partial or undefined behavior occurs.
- **SC-005**: Multipart upload sessions respect tenant/workspace isolation: sessions are invisible and inaccessible across workspace and tenant boundaries.
- **SC-006**: Presigned URL generation respects tenant/workspace authorization: a caller cannot generate URLs for buckets or objects outside their authorized scope.
- **SC-007**: Presigned URL TTL is capped by the platform-configured maximum. URLs expire and become unusable after their TTL.
- **SC-008**: Stale multipart sessions (exceeding the platform-configured TTL) are detected and eligible for automated cleanup.
- **SC-009**: Every presigned URL generation and multipart lifecycle transition (initiate, complete, abort, stale cleanup) produces an audit event traceable through the platform's audit/correlation pipeline.
- **SC-010**: All new contracts, endpoints, and error codes are additive to the existing storage API surface. No published contracts from specs `007`–`012` are broken.

## 5. Assumptions and Dependencies

- `US-STO-01-T01` (spec `007`) supplies the provider abstraction layer, capability manifest with `bucket.presigned_urls` and `object.multipart_upload` as optional extended capabilities, and provider profile structure.
- `US-STO-01-T02` (spec `008`) supplies active tenant storage contexts with namespace isolation and quota baselines.
- `US-STO-01-T03` (spec `009`) supplies the bucket/object CRUD contracts, the standard object record shape, and the audit/correlation model for storage operations.
- `US-STO-01-T04` (spec `010`) supplies the logical organization model and reserved platform prefix definitions (`_platform/multipart/`, `_platform/presigned/`).
- `US-STO-01-T05` (spec `011`) supplies the normalized error taxonomy, error envelope structure, and capability baseline validation model.
- `US-STO-01-T06` (spec `012`) supplies the multi-provider verification framework that this task's behaviors should eventually be verifiable against.
- The provider capability manifest already declares `bucket.presigned_urls` and `object.multipart_upload` with satisfaction state and constraint metadata per provider (MinIO: both satisfied; Ceph RGW: both satisfied; Garage: both satisfied — as per current `storage-provider-profile.mjs`).
- The S3-compatible providers targeted by the platform support the standard S3 multipart upload API (`CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListMultipartUploads`) and presigned URL generation via the standard S3 signing mechanism.
- The platform's IAM layer (Keycloak) provides sufficient identity and authorization context to gate presigned URL generation and multipart upload initiation at the workspace permission level.
- The event backbone (Kafka) is available for publishing audit events for presigned URL and multipart lifecycle operations.

## 6. Explicit Out of Scope

- `US-STO-02-T02`: Bucket policies and per-tenant/workspace permission rules for storage.
- `US-STO-02-T03`: Storage capacity quotas, bucket-count limits, object-size limits, and enforcement mechanisms.
- `US-STO-02-T04`: Kafka/OpenWhisk event emission and consumption for object storage events (e.g., object-created, object-deleted notifications).
- `US-STO-02-T05`: Exposing provider capabilities for versioning, lifecycle, object lock, event notifications, and bucket policies as tenant-visible features.
- `US-STO-02-T06`: Advanced tests for capability-supported vs. degraded behavior across providers.
- Presigned URL revocation: S3 presigned URLs cannot be individually revoked after generation. The platform relies on TTL expiration and credential rotation for access control.
- Multipart upload resume after platform restart: the spec requires session tracking but does not mandate that in-progress sessions survive a full platform restart. Session durability is an implementation decision.
- Server-side encryption configuration for multipart uploads: encryption at rest is a provider-level concern and is not specified by this task.
- Content-disposition or content-encoding negotiation for presigned URLs: the initial scope uses default provider behavior for these headers.
- Presigned URL generation for multipart upload parts: this spec covers presigned URLs for single-object upload and download only. Presigned multipart part uploads (where each part upload URL is individually presigned) are a potential future extension but are not included here.

## 7. Risks and Open Questions

### Risks

- **Risk**: Some S3-compatible providers may impose different minimum part sizes (e.g., 5 MB for AWS S3 / MinIO vs. different thresholds for Garage or Ceph RGW). **Mitigation**: The capability manifest already supports constraint metadata (`maxParts`, and the same mechanism can carry `minPartSizeBytes`). FR-007 and FR-013 require the platform to enforce provider-declared constraints and surface them in error responses.
- **Risk**: Presigned URLs expose the provider's endpoint URL to the client, which may leak infrastructure topology. **Mitigation**: FR-022 prohibits exposing raw credentials or secret keys. The provider endpoint in the presigned URL is inherent to the S3 presigned protocol and cannot be avoided. Operators who need to obscure the endpoint should use a reverse proxy or CDN in front of the provider — this is an infrastructure concern outside the spec's scope.
- **Risk**: Multipart sessions that are neither completed nor aborted consume provider storage indefinitely. **Mitigation**: FR-009 and FR-010 mandate platform-configurable session TTL with automated cleanup and audit trail.
- **Risk**: The `CAPABILITY_NOT_AVAILABLE` error code is new and does not exist in the current error taxonomy (spec `011`). **Mitigation**: FR-030 requires the new code to follow the taxonomy structure and FR-028 requires additive-only changes. The existing taxonomy (spec `011` FR-013) explicitly allows new codes to be added without invalidating existing ones.

### Open Questions

- **OQ-001**: Should the platform enforce a maximum total upload size (sum of all parts) for multipart uploads independently of the tenant's storage quota, or is quota enforcement at completion sufficient? **Impact**: Enforcing per-session size limits adds complexity but prevents a single upload from consuming the entire quota before other operations can react. Can be deferred to implementation or addressed by `US-STO-02-T03` (quotas).
- **OQ-002**: Should the presigned URL TTL maximum be a global platform setting, a per-tenant configurable setting, or both? **Impact**: Per-tenant configuration adds flexibility but increases governance complexity. The spec requires a platform-level maximum (FR-018) and leaves per-tenant override as a potential enhancement.
- **OQ-003**: Should multipart upload session metadata (initiation time, part count, accumulated size) be stored in the platform's database or derived from the provider's `ListMultipartUploads` response? **Impact**: Platform-side tracking enables richer lifecycle governance and quota accounting but adds state management complexity. Provider-side tracking is simpler but may not support all governance requirements. Can be decided during planning.

## 8. New Error Codes Introduced

The following normalized error codes are introduced by this spec, following the taxonomy structure from spec `011`:

| Code | Meaning | HTTP Status | Retryability |
|---|---|---|---|
| `CAPABILITY_NOT_AVAILABLE` | Requested operation requires a provider capability that is not satisfied by the active provider | 501 Not Implemented | Not retryable |
| `MULTIPART_CONSTRAINT_EXCEEDED` | A multipart operation violates a provider-declared constraint (e.g., maxParts, minPartSize) | 400 Bad Request | Not retryable |
| `MULTIPART_SESSION_NOT_FOUND` | The referenced multipart upload session does not exist or is not accessible in the caller's scope | 404 Not Found | Not retryable |
| `MULTIPART_SESSION_EXPIRED` | The multipart upload session has exceeded its TTL and is no longer active | 410 Gone | Not retryable |
| `MULTIPART_INVALID_PART_ORDER` | The part list submitted for completion has gaps, misordering, or invalid part receipts | 400 Bad Request | Not retryable |
| `PRESIGNED_TTL_EXCEEDED` | The requested presigned URL TTL exceeds the platform-configured maximum | 400 Bad Request | Not retryable |
