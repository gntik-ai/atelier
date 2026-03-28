# Implementation Plan: US-STO-02-T01 — Multipart Upload and Presigned URLs

**Feature Branch**: `013-storage-multipart-presigned-urls`
**Spec**: `specs/013-storage-multipart-presigned-urls/spec.md`
**Task**: US-STO-02-T01
**Epic**: EP-12 — Storage S3-compatible
**Status**: Ready for implementation
**Created**: 2026-03-28

---

## 1. Scope Summary

This task introduces capability-gated multipart upload orchestration and presigned URL generation to the platform's unified storage surface. It is **additive only**: it extends `services/adapters/src/` with a new pure-functional module (`storage-multipart-presigned.mjs`) and additive exports to `provider-catalog.mjs`. No existing module from specs `007`–`012` is modified.

The two capabilities are gated by the active provider's capability manifest:
- `object.multipart_upload` → controls all multipart upload flows
- `bucket.presigned_urls` → controls all presigned URL generation flows

Both capabilities are already declared and `satisfied` for MinIO, Ceph RGW, and Garage in `storage-provider-profile.mjs`.

---

## 2. Dependency Map

| Prior task | Spec | Adapter module | What this task consumes |
|---|---|---|---|
| T01 — Provider abstraction | `007` | `storage-provider-profile.mjs` | `buildStorageProviderProfile`, `buildStorageCapabilityDetails`, `STORAGE_PROVIDER_CAPABILITY_IDS` (including `bucket.presigned_urls`, `object.multipart_upload`), constraint metadata (`maxParts`) |
| T02 — Tenant context | `008` | `storage-tenant-context.mjs` | `buildTenantStorageContextRecord` — workspace/tenant binding for session scoping |
| T03 — Bucket/object ops | `009` | `storage-bucket-object-ops.mjs` | `buildStorageBucketRecord`, `buildStorageObjectRecord`, `buildStorageObjectMetadata`, `buildStorageMutationEvent` — object record shape used for multipart completion output and audit model |
| T04 — Logical organization | `010` | `storage-logical-organization.mjs` | `isStorageReservedPrefix` — blocks multipart uploads to `_platform/multipart/`, `_platform/presigned/` reserved prefixes |
| T05 — Error taxonomy + baseline | `011` | `storage-error-taxonomy.mjs` | `buildNormalizedStorageError`, `buildStorageErrorEnvelope`, `STORAGE_NORMALIZED_ERROR_CODES`, `STORAGE_ERROR_RETRYABILITY` — error envelope shape for new codes; `buildStorageErrorAuditEvent` — audit event shape |
| T06 — Verification suite | `012` | `storage-provider-verification.mjs` | Not directly consumed, but verification scenario categories inform what this task's behaviors must be verifiable against in future |

All five upstream adapter modules are already present under `services/adapters/src/`. The `provider-catalog.mjs` re-exports their surfaces and will receive additive exports from this task.

---

## 3. New Artifacts

### 3.1 Core module

**`services/adapters/src/storage-multipart-presigned.mjs`**

Pure functional module (no I/O, no side-effects). Exports:

```text

// ── Multipart upload builders ───────────────────────────────────────────────
buildMultipartUploadSession(input) → MultipartUploadSession
buildMultipartPartReceipt(input) → MultipartPartReceipt
buildMultipartCompletionPreview(input) → MultipartCompletionPreview
buildMultipartAbortPreview(input) → MultipartAbortPreview
buildMultipartUploadList(input) → MultipartUploadList
buildMultipartSessionSummary(input) → MultipartSessionSummary

// ── Presigned URL builders ──────────────────────────────────────────────────
buildPresignedUrlRecord(input) → PresignedUrlRecord
buildPresignedUrlAuditEvent(input) → PresignedUrlAuditEvent

// ── Capability-gate helpers ─────────────────────────────────────────────────
checkMultipartCapability(providerProfile) → CapabilityGateResult
checkPresignedUrlCapability(providerProfile) → CapabilityGateResult
buildCapabilityNotAvailableError(input) → StorageErrorEnvelope

// ── Lifecycle governance ────────────────────────────────────────────────────
buildMultipartLifecycleAuditEvent(input) → MultipartLifecycleAuditEvent
evaluateMultipartSessionStaleness(input) → StalenessEvaluation
buildStaleSessionCleanupRecord(input) → StaleSessionCleanupRecord

// ── Validation helpers ──────────────────────────────────────────────────────
validatePartList(input) → PartListValidationResult
validateMultipartObjectKey(input) → ObjectKeyValidationResult
validatePresignedTtl(input) → TtlValidationResult

// ── Catalog constants ───────────────────────────────────────────────────────
MULTIPART_SESSION_STATES           // frozen: active | stale | completing | completed | aborted
MULTIPART_LIFECYCLE_TRANSITIONS    // frozen: initiate | part_uploaded | complete | abort | stale_cleanup
PRESIGNED_URL_OPERATIONS           // frozen: upload | download
MULTIPART_NORMALIZED_ERROR_CODES   // frozen: all 6 new codes from spec section 8

```text

**Design constraints:**
- All builders take plain object inputs and return `Object.freeze`d output. No class instances.
- No I/O, no Kafka, no S3 SDK imports. The module is a data-shape and validation layer.
- Credential redaction: any URL-like string passed through builders is redacted using the same pattern as `storage-error-taxonomy.mjs` (`https?://[^\s]+` → `[redacted-url]`, `secret://[^\s]+` → `[redacted-secret]`). Presigned URL strings are passed opaque and not logged in audit event fields beyond a stable reference identifier.
- Constraint metadata from the provider profile (`maxParts`, `minPartSizeBytes`) is read from `buildStorageCapabilityDetails` output and enforced in `validatePartList`.

### 3.2 Entity shapes

**`MultipartUploadSession`**

```text

{
  sessionId: string              // platform-managed UUID
  tenantId: string
  workspaceId: string
  bucketId: string
  objectKey: string
  initiatedAt: string            // ISO 8601
  ttlDeadline: string            // ISO 8601 = initiatedAt + platform-configured TTL
  state: MULTIPART_SESSION_STATES.ACTIVE
  partCount: number              // starts at 0
  accumulatedSizeBytes: number   // starts at 0
  correlationId?: string
}

```text

**`MultipartPartReceipt`**

```text

{
  partNumber: number             // 1-based
  integrityToken: string         // ETag or equivalent (opaque to the platform)
  receivedAt: string             // ISO 8601
  sizeBytes: number
  sessionId: string
}

```text

**`MultipartCompletionPreview`**

```text

{
  sessionId: string
  objectKey: string
  bucketId: string
  tenantId: string
  workspaceId: string
  partsCount: number
  totalSizeBytes: number
  validationOutcome: 'valid' | 'invalid'
  validationErrors: string[]     // empty when valid
  expectedObjectRecord: StorageObjectRecord  // shape from T03; present only when valid
  correlationId?: string
}

```text

**`MultipartAbortPreview`**

```text

{
  sessionId: string
  objectKey: string
  bucketId: string
  tenantId: string
  workspaceId: string
  state: 'aborted'
  abortedAt: string
  correlationId?: string
}

```text

**`PresignedUrlRecord`**

```text

{
  presignedUrlRef: string        // stable opaque reference ID (not the URL itself in audit contexts)
  operation: PRESIGNED_URL_OPERATIONS.UPLOAD | PRESIGNED_URL_OPERATIONS.DOWNLOAD
  bucketId: string
  objectKey: string
  tenantId: string
  workspaceId: string
  grantedTtlSeconds: number      // may be clamped from requested TTL
  ttlClamped: boolean            // true if requested TTL exceeded platform maximum
  expiresAt: string              // ISO 8601
  generatedAt: string            // ISO 8601
  correlationId?: string
  // The actual URL string is delivered separately; it does not appear in the audit record.
}

```text

**`PresignedUrlAuditEvent`**

```text

{
  eventType: 'storage.presigned_url.generated'
  requestingIdentity: string     // caller identity token ref
  tenantId: string
  workspaceId: string
  bucketId: string
  objectKey: string
  operation: 'upload' | 'download'
  grantedTtlSeconds: number
  ttlClamped: boolean
  expiresAt: string
  generatedAt: string
  correlationId?: string
}

```text

**`MultipartLifecycleAuditEvent`**

```text

{
  eventType: 'storage.multipart.lifecycle'
  transition: MULTIPART_LIFECYCLE_TRANSITIONS value
  sessionId: string
  tenantId: string
  workspaceId: string
  bucketId: string
  objectKey: string
  partCount: number
  accumulatedSizeBytes: number
  abortReason?: string           // present only for abort/stale_cleanup transitions
  correlationId?: string
  occurredAt: string
}

```text

**`CapabilityGateResult`**

```text

{
  allowed: boolean
  capabilityId: string           // e.g. 'object.multipart_upload'
  satisfactionState: string      // 'satisfied' | 'unsatisfied' | 'partially_satisfied'
  constraints: CapabilityConstraint[]  // from provider profile; empty when unsatisfied
  errorEnvelope?: StorageErrorEnvelope // present when allowed === false
}

```text

**`PartListValidationResult`**

```text

{
  valid: boolean
  errors: string[]               // empty when valid; describes gaps, misordering, empty list
  partCount: number
  totalSizeBytes: number
}

```text

**`TtlValidationResult`**

```text

{
  valid: boolean
  requestedTtlSeconds: number
  effectiveTtlSeconds: number    // clamped if requestedTtl > platformMaxTtl
  clamped: boolean
  platformMaxTtlSeconds: number
}

```text

**`StalenessEvaluation`**

```text

{
  sessionId: string
  isStale: boolean
  evaluatedAt: string
  ttlDeadline: string
  currentState: string
}

```text

### 3.3 New normalized error codes

The following codes are added to the platform error taxonomy (spec `011` FR-013 allows additive additions). They follow the same shape as `STORAGE_NORMALIZED_ERROR_CODES` entries.

| Constant key | Code string | HTTP status | Retryability | Fallback hint |
|---|---|---|---|---|
| `CAPABILITY_NOT_AVAILABLE` | `'CAPABILITY_NOT_AVAILABLE'` | 501 | not_retryable | Use single-request `object.put` (multipart) or proxied endpoint (presigned) |
| `MULTIPART_CONSTRAINT_EXCEEDED` | `'MULTIPART_CONSTRAINT_EXCEEDED'` | 400 | not_retryable | Check provider constraint metadata and reduce part count or part size |
| `MULTIPART_SESSION_NOT_FOUND` | `'MULTIPART_SESSION_NOT_FOUND'` | 404 | not_retryable | Initiate a new multipart session |
| `MULTIPART_SESSION_EXPIRED` | `'MULTIPART_SESSION_EXPIRED'` | 410 | not_retryable | Initiate a new multipart session |
| `MULTIPART_INVALID_PART_ORDER` | `'MULTIPART_INVALID_PART_ORDER'` | 400 | not_retryable | Resubmit the complete ordered part list without gaps |
| `PRESIGNED_TTL_EXCEEDED` | `'PRESIGNED_TTL_EXCEEDED'` | 400 | not_retryable | Reduce the requested TTL to the platform maximum |

These codes are exported as `MULTIPART_NORMALIZED_ERROR_CODES` from `storage-multipart-presigned.mjs`. They are additive and do not collide with any code in `STORAGE_NORMALIZED_ERROR_CODES` (spec `011`).

### 3.4 Provider-catalog re-exports

**`services/adapters/src/provider-catalog.mjs`** — additive exports only (no breaking changes):

```js

// Multipart upload
export function buildStorageMultipartSession(input = {}) { ... }
export function buildStorageMultipartPartReceipt(input = {}) { ... }
export function buildStorageMultipartCompletionPreview(input = {}) { ... }
export function buildStorageMultipartAbortPreview(input = {}) { ... }
export function buildStorageMultipartUploadList(input = {}) { ... }
export function buildStorageMultipartSessionSummary(input = {}) { ... }
export function buildStorageMultipartLifecycleEvent(input = {}) { ... }
export function evaluateStorageMultipartStaleness(input = {}) { ... }
export function buildStorageStaleSessionCleanupRecord(input = {}) { ... }
export function validateStoragePartList(input = {}) { ... }
export function validateStorageMultipartObjectKey(input = {}) { ... }

// Presigned URLs
export function buildStoragePresignedUrlRecord(input = {}) { ... }
export function buildStoragePresignedUrlAuditEvent(input = {}) { ... }
export function validateStoragePresignedTtl(input = {}) { ... }

// Capability gates
export function checkStorageMultipartCapability(input = {}) { ... }
export function checkStoragePresignedUrlCapability(input = {}) { ... }
export function buildStorageCapabilityNotAvailableError(input = {}) { ... }

// Catalog constants
export const storageMultipartSessionStates      // re-export of MULTIPART_SESSION_STATES
export const storageMultipartLifecycleTransitions  // re-export of MULTIPART_LIFECYCLE_TRANSITIONS
export const storagePresignedUrlOperations      // re-export of PRESIGNED_URL_OPERATIONS
export const storageMultipartNormalizedErrorCodes  // re-export of MULTIPART_NORMALIZED_ERROR_CODES

```text

### 3.5 Unit tests

**`tests/unit/storage-multipart-presigned.test.mjs`**

Hermetic tests using `node:test` + `node:assert/strict`. No live I/O. Covers all builders, validators, and capability-gate helpers. See section 7 for the full test plan.

### 3.6 Adapter integration tests

**`tests/adapters/storage-multipart-presigned.test.mjs`**

Validates `provider-catalog.mjs` re-exports against MinIO and Garage fixtures. Uses static fixtures only. See section 7.

### 3.7 Contract test extension

**`tests/contracts/storage-provider.contract.test.mjs`** — additive block only:

New `test('storage multipart and presigned URL schemas are additive and structurally valid', ...)` asserting required top-level fields on `MultipartUploadSession`, `PresignedUrlRecord`, and `CapabilityGateResult` shapes; asserts that `MULTIPART_NORMALIZED_ERROR_CODES` values do not collide with `STORAGE_NORMALIZED_ERROR_CODES` values.

### 3.8 E2E scenario matrix document

**`tests/e2e/storage-multipart-presigned/README.md`**

Static markdown scenario matrix (deferred live execution). Documents the acceptance scenarios from spec section 1 mapped to operations and evidence expectations.

---

## 4. Capability-Gate Logic

The capability check for multipart upload and presigned URLs is a pure-function gate, not a runtime middleware:

```text

checkMultipartCapability(providerProfile):
  details = buildStorageCapabilityDetails({ providerProfile, capabilityId: 'object.multipart_upload' })
  if details.state === 'satisfied' or 'partially_satisfied':
    return { allowed: true, capabilityId: 'object.multipart_upload', satisfactionState: details.state, constraints: details.constraints }
  else:
    return { allowed: false, capabilityId: 'object.multipart_upload', satisfactionState: 'unsatisfied',
             errorEnvelope: buildCapabilityNotAvailableError({ capabilityId: 'object.multipart_upload', fallbackHint: 'Use single-request object.put' }) }

checkPresignedUrlCapability(providerProfile):
  details = buildStorageCapabilityDetails({ providerProfile, capabilityId: 'bucket.presigned_urls' })
  // same pattern

```text

`buildCapabilityNotAvailableError` produces a `StorageErrorEnvelope` (same shape as spec `011` `buildStorageErrorEnvelope`) using the new `CAPABILITY_NOT_AVAILABLE` code. It includes:
- `normalizedCode: 'CAPABILITY_NOT_AVAILABLE'`
- `missingCapabilityId: string`
- `fallbackHint: string`
- `httpStatus: 501`
- `retryability: 'not_retryable'`

---

## 5. Multipart Upload Flow (Pure Layer)

The module models the multipart lifecycle as immutable state transitions. No persistent storage — that is the responsibility of the runtime layer (not in scope for this task).

```text

Initiate:
  1. validateMultipartObjectKey(objectKey, providerProfile, isStorageReservedPrefix)
     → rejects keys under _platform/multipart/, _platform/presigned/, _platform/events/
  2. checkMultipartCapability(providerProfile) → gates on object.multipart_upload
  3. buildMultipartUploadSession({ tenantId, workspaceId, bucketId, objectKey, ttlSeconds, correlationId })
     → returns frozen MultipartUploadSession with state: 'active'
  4. buildMultipartLifecycleAuditEvent({ transition: 'initiate', session })

Part upload:
  1. validatePartList partial check: rejects parts below minPartSizeBytes (for non-final parts)
  2. buildMultipartPartReceipt({ sessionId, partNumber, integrityToken, sizeBytes })
     → returns frozen MultipartPartReceipt

Complete:
  1. validatePartList({ parts, maxParts, allowEmptyList: false })
     → validates no gaps, correct ordering (1-based sequential), non-empty list, receipts match session
  2. buildMultipartCompletionPreview → validation outcome + expected object record
  3. buildMultipartLifecycleAuditEvent({ transition: 'complete', session, partsCount, totalSizeBytes })

Abort:
  1. buildMultipartAbortPreview({ session, correlationId })
  2. buildMultipartLifecycleAuditEvent({ transition: 'abort', session, abortReason: 'caller_requested' })

Lifecycle governance:
  1. evaluateMultipartSessionStaleness({ session, now })
     → compares now vs session.ttlDeadline
  2. buildStaleSessionCleanupRecord({ session, cleanedAt })
  3. buildMultipartLifecycleAuditEvent({ transition: 'stale_cleanup', session, abortReason: 'ttl_exceeded' })

```text

---

## 6. Presigned URL Flow (Pure Layer)

```text

Generate presigned download URL:
  1. checkPresignedUrlCapability(providerProfile) → gates on bucket.presigned_urls
  2. validatePresignedTtl({ requestedTtlSeconds, platformMaxTtlSeconds })
     → if requestedTtl > platformMaxTtl: either clamp or record PRESIGNED_TTL_EXCEEDED
  3. buildPresignedUrlRecord({ operation: 'download', bucketId, objectKey, tenantId, workspaceId,
                               grantedTtlSeconds, generatedAt, correlationId })
  4. buildPresignedUrlAuditEvent({ presignedUrlRecord, requestingIdentity })

Generate presigned upload URL:
  Same as download, with operation: 'upload'. Note: object existence is NOT checked (FR-020).

```text

---

## 7. Verification Strategy

### Layer 1 — Unit (`tests/unit/storage-multipart-presigned.test.mjs`)

All tests are hermetic, static, no I/O. Runtime: `node --test tests/unit/storage-multipart-presigned.test.mjs`.

**Multipart session builders (8 tests)**

1. `buildMultipartUploadSession` with a valid MinIO-gated input: assert `sessionId` is present, `state === 'active'`, `ttlDeadline` is in the future relative to `initiatedAt`, `partCount === 0`, `accumulatedSizeBytes === 0`.
1. `buildMultipartUploadSession` with `object.multipart_upload` unsatisfied: `checkMultipartCapability` returns `allowed: false`; `errorEnvelope.normalizedCode === 'CAPABILITY_NOT_AVAILABLE'`; `errorEnvelope.missingCapabilityId === 'object.multipart_upload'`.
1. `validateMultipartObjectKey` with a key under `_platform/multipart/`: assert validation fails with `RESERVED_PREFIX_CONFLICT` context.
1. `buildMultipartPartReceipt` with valid inputs: assert `partNumber` and `integrityToken` are present and non-empty; assert object is frozen.
1. `validatePartList` with an empty part list: assert `valid: false`; error message references empty list.
1. `validatePartList` with a gap (parts 1, 2, 5 — missing 3 and 4): assert `valid: false`; errors array is non-empty and references the gap.
1. `validatePartList` with a valid ordered list [1, 2, 3]: assert `valid: true`; `partCount === 3`; `totalSizeBytes === sum of part sizes`.
1. `validatePartList` with a part list exceeding `maxParts: 10000`: assert `valid: false`; error references constraint.

**Multipart completion and abort (4 tests)**

1. `buildMultipartCompletionPreview` with a valid part list: assert `validationOutcome === 'valid'`; `expectedObjectRecord` is present with correct `objectKey`, `bucketId`.
1. `buildMultipartCompletionPreview` with a gap in part list: assert `validationOutcome === 'invalid'`; `validationErrors` is non-empty; `expectedObjectRecord` is absent.
1. `buildMultipartAbortPreview`: assert `state === 'aborted'`; `abortedAt` is an ISO 8601 string.
1. `buildMultipartLifecycleAuditEvent` for each of the five transitions (initiate, part_uploaded, complete, abort, stale_cleanup): assert `eventType === 'storage.multipart.lifecycle'`; `transition` matches input; `sessionId`, `tenantId`, `workspaceId` are present.

**Lifecycle governance (3 tests)**

1. `evaluateMultipartSessionStaleness` with `now > ttlDeadline`: assert `isStale: true`.
1. `evaluateMultipartSessionStaleness` with `now < ttlDeadline`: assert `isStale: false`.
1. `buildStaleSessionCleanupRecord`: assert `state === 'aborted'`; `cleanupReason === 'ttl_exceeded'`; `cleanedAt` is present.

**Presigned URL builders (6 tests)**

1. `checkPresignedUrlCapability` with `bucket.presigned_urls` satisfied: assert `allowed: true`; `constraints` is an array (may be empty).
1. `checkPresignedUrlCapability` with `bucket.presigned_urls` unsatisfied: assert `allowed: false`; `errorEnvelope.normalizedCode === 'CAPABILITY_NOT_AVAILABLE'`; `errorEnvelope.missingCapabilityId === 'bucket.presigned_urls'`.
1. `validatePresignedTtl` with `requestedTtlSeconds <= platformMaxTtlSeconds`: assert `valid: true`; `clamped: false`; `effectiveTtlSeconds === requestedTtlSeconds`.
1. `validatePresignedTtl` with `requestedTtlSeconds > platformMaxTtlSeconds`: assert `valid: true` (clamping mode); `clamped: true`; `effectiveTtlSeconds === platformMaxTtlSeconds`.
1. `buildPresignedUrlRecord` for download operation: assert `operation === 'download'`; `expiresAt` is in the future; `ttlClamped` matches validation result; object is frozen.
1. `buildPresignedUrlAuditEvent`: assert `eventType === 'storage.presigned_url.generated'`; `requestingIdentity` is present; no raw URL string in the audit record (assert `JSON.stringify` of the event does not contain `http`).

**Error code catalog (2 tests)**

1. `MULTIPART_NORMALIZED_ERROR_CODES` contains all six codes from spec section 8; object is frozen; none of the six code strings appear in `STORAGE_NORMALIZED_ERROR_CODES` values (no collision).
1. `buildCapabilityNotAvailableError` for `object.multipart_upload`: assert result has `normalizedCode: 'CAPABILITY_NOT_AVAILABLE'`, `httpStatus: 501`, `retryability: 'not_retryable'`, `fallbackHint` is a non-empty string, `missingCapabilityId: 'object.multipart_upload'`; object is frozen.

### Layer 2 — Adapter integration (`tests/adapters/storage-multipart-presigned.test.mjs`)

Imports from `provider-catalog.mjs` only. Static fixtures for MinIO and Garage provider profiles.

1. MinIO fixture: `checkStorageMultipartCapability` → `allowed: true`; `constraints` contains `maxParts: 10000`.
1. Garage fixture: `checkStorageMultipartCapability` → `allowed: true`.
1. MinIO fixture: `checkStoragePresignedUrlCapability` → `allowed: true`.
1. Garage fixture: `checkStoragePresignedUrlCapability` → `allowed: true`.
1. Synthetic fixture with `object.multipart_upload: unsatisfied`: `checkStorageMultipartCapability` → `allowed: false`; `buildStorageCapabilityNotAvailableError` returns envelope with code `CAPABILITY_NOT_AVAILABLE` and HTTP 501.
1. `buildStorageMultipartSession` with valid MinIO-fixture inputs: assert all top-level fields present; object is frozen.
1. `buildStoragePresignedUrlRecord` for upload on MinIO: assert `operation === 'upload'`; `grantedTtlSeconds ≤ platformMaxTtlSeconds`.
1. `validateStoragePartList` with Garage `maxParts` constraint: a list of 10 000 parts → `valid: true`; a list of 10 001 parts → `valid: false`.
1. All 20 named exports from `provider-catalog.mjs` additions are importable and not `undefined`.
1. `JSON.stringify` of `buildStoragePresignedUrlAuditEvent` output does not contain `https?://` or `secret://` patterns.

### Layer 3 — Contract test (additive block in `tests/contracts/storage-provider.contract.test.mjs`)

Add `test('storage multipart and presigned URL schemas are additive and structurally valid', ...)`:
- Asserts `buildStorageMultipartSession` output contains: `sessionId`, `tenantId`, `workspaceId`, `bucketId`, `objectKey`, `initiatedAt`, `ttlDeadline`, `state`, `partCount`, `accumulatedSizeBytes`.
- Asserts `buildStoragePresignedUrlRecord` output contains: `operation`, `bucketId`, `objectKey`, `tenantId`, `workspaceId`, `grantedTtlSeconds`, `ttlClamped`, `expiresAt`, `generatedAt`.
- Asserts that the six values of `storageMultipartNormalizedErrorCodes` do not intersect with `storageNormalizedErrorCodes` values (additive constraint, FR-030).
- Asserts `CapabilityGateResult` from `checkStorageMultipartCapability` contains: `allowed`, `capabilityId`, `satisfactionState`, `constraints`.

### Layer 4 — E2E scenario matrix (`tests/e2e/storage-multipart-presigned/README.md`)

Static document. Live execution deferred. Maps all five spec user stories to scenario entries with evidence expectations. See section 3.8.

### Not in scope for this task

- Live S3 SDK calls (no `@aws-sdk/client-s3` or `minio` imports)
- Kafka event emission
- Helm chart changes
- OpenWhisk function deployment
- Any browser (Playwright) flows
- Database migration (multipart session persistence is a runtime concern, not an adapter-layer concern)

---

## 8. CI / Runtime Constraints

- All new tests use `node --test` with `node:test` + `node:assert/strict`. No vitest, jest, or mocha.
- No network calls in unit or adapter tests. All inputs are static in-memory fixtures.
- New source files use `.mjs` extension and ESM (`import`/`export`). No `require()`.
- All returned objects are passed through `Object.freeze`. No mutations after construction.
- The contract test block is additive: no existing assertion in `storage-provider.contract.test.mjs` is modified.
- Test runtime: `node --test tests/unit/storage-multipart-presigned.test.mjs` and `node --test tests/adapters/storage-multipart-presigned.test.mjs`.

---

## 9. Security Constraints

- Presigned URL strings are never stored in audit event fields. `buildPresignedUrlAuditEvent` carries a `presignedUrlRef` (a stable reference ID) and metadata, not the URL itself.
- `buildPresignedUrlRecord` carries the URL opaquely as `presignedUrl` (available to the caller) but this field must not appear in any audit event or log struct produced by the builders.
- Credential redaction rules from `storage-error-taxonomy.mjs` apply to all string fields passing through builders: `https?://` → `[redacted-url]`, `secret://` → `[redacted-secret]`.
- `buildCapabilityNotAvailableError` must not include raw provider endpoint details.
- Object keys targeting `_platform/multipart/`, `_platform/presigned/`, or `_platform/events/` are rejected by `validateMultipartObjectKey` before any session is created.

---

## 10. Rollback and Idempotency

**Rollback**: Remove the two new files (`storage-multipart-presigned.mjs`, `tests/unit/storage-multipart-presigned.test.mjs`, `tests/adapters/storage-multipart-presigned.test.mjs`, `tests/e2e/storage-multipart-presigned/README.md`) and revert the additive exports in `provider-catalog.mjs` and `tests/contracts/storage-provider.contract.test.mjs`. No schema migrations, no Helm changes, no persistent state changes in this task.

**Idempotency**: All builders are pure functions. Calling them multiple times with the same input produces structurally identical frozen output. `buildMultipartUploadSession` generates a `sessionId` from a deterministic combination of inputs plus a timestamp component — for idempotency testing purposes, the caller is responsible for deduplication at the runtime layer.

---

## 11. Open Questions — Disposition

| OQ | Question | Resolution for this task |
|---|---|---|
| OQ-001 | Max total upload size per session vs quota at completion | Deferred to `US-STO-02-T03`. This task enforces `maxParts` constraint only. |
| OQ-002 | Global vs per-tenant presigned URL TTL maximum | `validatePresignedTtl` accepts `platformMaxTtlSeconds` as an explicit input parameter. Per-tenant override is a caller responsibility. The builder does not hard-code the maximum. |
| OQ-003 | Session metadata: platform DB vs provider `ListMultipartUploads` | This task models the session record shape (suitable for platform DB storage) without mandating the persistence strategy. The runtime layer chooses. `buildMultipartUploadList` models the list response shape regardless of source. |

---

## 12. Done Criteria

All of the following must be true before this task is considered complete:

| # | Criterion | Evidence |
|---|---|---|
| DC-01 | `services/adapters/src/storage-multipart-presigned.mjs` exists and exports all builders, validators, and catalog constants listed in section 3.1 | File present; all named exports resolvable via `import` |
| DC-02 | `services/adapters/src/provider-catalog.mjs` exposes all 20+ additive re-exports from section 3.4 | Asserted by adapter test #9 |
| DC-03 | `tests/unit/storage-multipart-presigned.test.mjs` passes covering all 23 unit tests | `node --test tests/unit/storage-multipart-presigned.test.mjs` exits 0 |
| DC-04 | `tests/adapters/storage-multipart-presigned.test.mjs` passes covering all 10 adapter tests | `node --test tests/adapters/storage-multipart-presigned.test.mjs` exits 0 |
| DC-05 | Additive block in `tests/contracts/storage-provider.contract.test.mjs` passes without modifying any existing assertion | Full contract suite exits 0 |
| DC-06 | `tests/e2e/storage-multipart-presigned/README.md` exists with all five sections and evidence expectations | File present and complete |
| DC-07 | `MULTIPART_NORMALIZED_ERROR_CODES` values do not collide with `STORAGE_NORMALIZED_ERROR_CODES` values | Asserted by contract test |
| DC-08 | No audit event or frozen report object produced by the builders contains a raw presigned URL string or `secret://` pattern | Asserted by unit test #21 and adapter test #10 |
| DC-09 | `checkMultipartCapability` and `checkPresignedUrlCapability` return `allowed: false` with `CAPABILITY_NOT_AVAILABLE` envelope for unsatisfied providers | Asserted by unit tests #2, #17 and adapter test #5 |
| DC-10 | `validatePartList` correctly rejects empty lists, gap lists, and lists exceeding `maxParts` | Asserted by unit tests #5, #6, #8 |
| DC-11 | No existing tests are broken (no modifications to existing passing assertions) | Full test suite passes |
| DC-12 | No file outside `services/adapters/src/` (source), `tests/unit/`, `tests/adapters/`, `tests/contracts/`, `tests/e2e/`, and `specs/013-storage-multipart-presigned-urls/` is modified | Git diff scope check |

---

## 13. Recommended Implementation Sequence

1. **`storage-multipart-presigned.mjs`** — write all catalog constants and error code catalog first, then pure builders and validators. Test locally with scratch assertions.
1. **`tests/unit/storage-multipart-presigned.test.mjs`** — write all 23 unit tests against the new module; confirm all pass.
1. **`provider-catalog.mjs` additive exports** — wire re-exports; confirm existing `provider-catalog.test.mjs` still passes without modification.
1. **`tests/adapters/storage-multipart-presigned.test.mjs`** — write all 10 adapter integration tests; confirm pass.
1. **Contract test block** — add additive assertion block to `storage-provider.contract.test.mjs`; confirm full contract suite passes.
1. **`tests/e2e/storage-multipart-presigned/README.md`** — write the scenario matrix document.
1. **Final**: run full test suite from repo root to confirm no regressions.

Steps 1–2 are serial. Steps 3–5 can be developed in parallel once step 1 is stable. Step 6 is independent of all others.

---

## 14. Parallelization Notes

No step requires a live provider, Docker, or Kubernetes. All steps run in a standard Node.js 22 environment (matching existing `node --test` usage in the project). The entire implementation is hermetic.

Once the core module (step 1) is stable, a second developer can work on the scenario matrix (step 6) in parallel with the test layers (steps 2–5).
