# Tasks: Multipart Upload and Presigned URLs

**Input**: `specs/013-storage-multipart-presigned-urls/spec.md`, `specs/013-storage-multipart-presigned-urls/plan.md`  
**Task**: US-STO-02-T01  
**Branch**: `013-storage-multipart-presigned-urls`

## Sequential execution plan

- [x] T001 Write `specs/013-storage-multipart-presigned-urls/spec.md` with the bounded T01 feature specification.
- [x] T002 Write `specs/013-storage-multipart-presigned-urls/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/013-storage-multipart-presigned-urls/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-multipart-presigned.mjs` — **catalog constants and error codes first**:
  - `MULTIPART_SESSION_STATES` — frozen object: `{ ACTIVE: 'active', STALE: 'stale', COMPLETING: 'completing', COMPLETED: 'completed', ABORTED: 'aborted' }`.
  - `MULTIPART_LIFECYCLE_TRANSITIONS` — frozen object: `{ INITIATE: 'initiate', PART_UPLOADED: 'part_uploaded', COMPLETE: 'complete', ABORT: 'abort', STALE_CLEANUP: 'stale_cleanup' }`.
  - `PRESIGNED_URL_OPERATIONS` — frozen object: `{ UPLOAD: 'upload', DOWNLOAD: 'download' }`.
  - `MULTIPART_NORMALIZED_ERROR_CODES` — frozen object with all six codes introduced by the spec (section 8): `CAPABILITY_NOT_AVAILABLE`, `MULTIPART_CONSTRAINT_EXCEEDED`, `MULTIPART_SESSION_NOT_FOUND`, `MULTIPART_SESSION_EXPIRED`, `MULTIPART_INVALID_PART_ORDER`, `PRESIGNED_TTL_EXCEEDED`. None of these six strings may appear as a value in `STORAGE_NORMALIZED_ERROR_CODES` (additive constraint, FR-030).
  - Each code entry must carry: `code` (the string), `httpStatus` (number), `retryability` (`'not_retryable'`), `fallbackHint` (non-empty string describing the alternative approach per FR-023).
  - All constants must be passed through `Object.freeze`. Nested entries must also be frozen.

- [x] T011 Continue `services/adapters/src/storage-multipart-presigned.mjs` — **capability gate helpers**:
  - `checkMultipartCapability(providerProfile)` — reads the `object.multipart_upload` entry from `buildStorageCapabilityDetails({ providerProfile, capabilityId: 'object.multipart_upload' })`; returns a frozen `CapabilityGateResult` with `allowed: true` when state is `satisfied` or `partially_satisfied` (with constraints), and `allowed: false` with an embedded `errorEnvelope` when `unsatisfied`.
  - `checkPresignedUrlCapability(providerProfile)` — same pattern for `bucket.presigned_urls`.
  - `buildCapabilityNotAvailableError({ capabilityId, fallbackHint, correlationId })` — returns a frozen `StorageErrorEnvelope`-compatible object using `CAPABILITY_NOT_AVAILABLE` code, HTTP 501, `retryability: 'not_retryable'`; includes `missingCapabilityId` and `fallbackHint` fields; applies credential-redaction rules to all string fields (no `https?://`, no `secret://`).
  - `CapabilityGateResult` shape: `{ allowed: boolean, capabilityId: string, satisfactionState: string, constraints: CapabilityConstraint[], errorEnvelope?: object }` — frozen.

- [x] T012 Continue `services/adapters/src/storage-multipart-presigned.mjs` — **multipart session builders**:
  - `buildMultipartUploadSession({ tenantId, workspaceId, bucketId, objectKey, ttlSeconds, now, correlationId })` — validates that all required fields are non-empty strings; returns a frozen `MultipartUploadSession` with: `sessionId` (timestamp-based unique string, e.g., `mp_<timestamp>_<random>`), `tenantId`, `workspaceId`, `bucketId`, `objectKey`, `initiatedAt` (ISO 8601), `ttlDeadline` (ISO 8601, = `now + ttlSeconds`), `state: MULTIPART_SESSION_STATES.ACTIVE`, `partCount: 0`, `accumulatedSizeBytes: 0`, `correlationId` (optional).
  - `buildMultipartSessionSummary(session)` — returns a frozen summary omitting `correlationId`; includes all observable fields (`sessionId`, `objectKey`, `bucketId`, `initiatedAt`, `ttlDeadline`, `state`, `partCount`, `accumulatedSizeBytes`).
  - `buildMultipartUploadList({ items, page })` — returns a frozen list record wrapping an array of `MultipartSessionSummary` objects and a pagination token; mirrors the pattern of `buildStorageBucketCollection` from `storage-bucket-object-ops.mjs`.

- [x] T013 Continue `services/adapters/src/storage-multipart-presigned.mjs` — **part receipt and validation**:
  - `buildMultipartPartReceipt({ sessionId, partNumber, integrityToken, sizeBytes, receivedAt })` — validates `partNumber` is a positive integer ≥ 1; returns a frozen `MultipartPartReceipt`.
  - `validatePartList({ parts, maxParts, minPartSizeBytes, allowEmptyList })` — returns a frozen `PartListValidationResult`:
    - Rejects an empty `parts` array with an error describing the empty list (FR-011).
    - Rejects any gap in sequential part numbering starting from 1 (e.g., [1,2,5] is invalid) with an error identifying the gap (FR-011 / spec edge case).
    - Rejects misordering (parts not sorted ascending by `partNumber`) with an ordering error.
    - Rejects duplicate `partNumber` entries — note: spec says last-writer-wins for duplicate uploads, but the completion part list must have unique numbers.
    - Rejects a list where `parts.length > maxParts` with `MULTIPART_CONSTRAINT_EXCEEDED` context.
    - Rejects any non-final part whose `sizeBytes < minPartSizeBytes` (FR-013); the final part (highest `partNumber`) is exempt.
    - `totalSizeBytes` is the sum of all `part.sizeBytes` values.
  - `validateMultipartObjectKey({ objectKey, isReservedPrefixFn })` — calls the provided `isReservedPrefixFn` (wraps `isStorageReservedPrefix` from `storage-logical-organization.mjs`); rejects keys under `_platform/multipart/`, `_platform/presigned/`, `_platform/events/` with a `RESERVED_PREFIX_CONFLICT` context error; returns a frozen `ObjectKeyValidationResult` with `valid: boolean` and `errors: string[]`.

- [x] T014 Continue `services/adapters/src/storage-multipart-presigned.mjs` — **completion and abort builders**:
  - `buildMultipartCompletionPreview({ session, parts, now })` — calls `validatePartList` internally; if valid, builds the expected `StorageObjectRecord` shape (using `buildStorageObjectRecord` from `storage-bucket-object-ops.mjs`) with `objectKey`, `bucketId`, and computed `sizeBytes`; returns a frozen `MultipartCompletionPreview` with `validationOutcome: 'valid'` or `'invalid'`, `validationErrors: string[]`, and `expectedObjectRecord` (present only when valid).
  - `buildMultipartAbortPreview({ session, now, correlationId })` — returns a frozen `MultipartAbortPreview` with `state: 'aborted'`, `abortedAt: now.toISOString()`.

- [x] T015 Continue `services/adapters/src/storage-multipart-presigned.mjs` — **lifecycle governance builders**:
  - `evaluateMultipartSessionStaleness({ session, now })` — compares `now` against `session.ttlDeadline`; returns a frozen `StalenessEvaluation` with `isStale: boolean`, `evaluatedAt`, `ttlDeadline`, `currentState`.
  - `buildStaleSessionCleanupRecord({ session, cleanedAt })` — returns a frozen `StaleSessionCleanupRecord` with `sessionId`, `objectKey`, `bucketId`, `tenantId`, `workspaceId`, `state: 'aborted'`, `cleanupReason: 'ttl_exceeded'`, `cleanedAt`.
  - `buildMultipartLifecycleAuditEvent({ transition, session, partsCount, totalSizeBytes, abortReason, correlationId, occurredAt })` — returns a frozen `MultipartLifecycleAuditEvent` with `eventType: 'storage.multipart.lifecycle'`; mirrors the shape of `buildStorageOperationEvent` from `storage-bucket-object-ops.mjs`; `abortReason` is present only for `abort` and `stale_cleanup` transitions.

- [x] T016 Continue `services/adapters/src/storage-multipart-presigned.mjs` — **presigned URL builders**:
  - `validatePresignedTtl({ requestedTtlSeconds, platformMaxTtlSeconds })` — returns a frozen `TtlValidationResult`: if `requestedTtlSeconds <= platformMaxTtlSeconds`, returns `{ valid: true, requestedTtlSeconds, effectiveTtlSeconds: requestedTtlSeconds, clamped: false, platformMaxTtlSeconds }`; if `requestedTtlSeconds > platformMaxTtlSeconds`, returns `{ valid: true, ..., effectiveTtlSeconds: platformMaxTtlSeconds, clamped: true }` (clamping mode, FR-018). The caller may choose to reject instead of clamp — this builder always returns `valid: true` in clamping mode; rejection is a caller policy.
  - `buildPresignedUrlRecord({ operation, bucketId, objectKey, tenantId, workspaceId, grantedTtlSeconds, ttlClamped, generatedAt, correlationId })` — validates `operation` is a member of `PRESIGNED_URL_OPERATIONS`; returns a frozen `PresignedUrlRecord`; `expiresAt` = `generatedAt + grantedTtlSeconds`; generates a stable `presignedUrlRef` identifier; does NOT accept a raw URL string as an input field (the URL is returned separately by the runtime layer, not stored here).
  - `buildPresignedUrlAuditEvent({ presignedUrlRecord, requestingIdentity })` — returns a frozen `PresignedUrlAuditEvent` with `eventType: 'storage.presigned_url.generated'`; must NOT include any field containing the raw presigned URL string; `JSON.stringify` of the output must not contain `http` as a URL substring.

- [x] T017 Verify `services/adapters/src/storage-multipart-presigned.mjs` integrity before writing tests:
  - All exported names are resolvable via `import { ... } from './storage-multipart-presigned.mjs'`.
  - All returned objects are frozen (attempt to mutate after creation throws in strict mode).
  - No I/O, no HTTP, no SDK imports in the module file.
  - Credential redaction rules applied: run a quick scratch script to confirm `JSON.stringify` of any builder output does not match `https?://` or `secret://` patterns.

- [x] T018 Create `tests/unit/storage-multipart-presigned.test.mjs` — **catalog and error code tests** (Tests 1–4 of 23):
  - **Test 1** — `MULTIPART_SESSION_STATES` contains all five values (`active`, `stale`, `completing`, `completed`, `aborted`); object is frozen (mutation attempt throws); no value collides with `MULTIPART_LIFECYCLE_TRANSITIONS` values.
  - **Test 2** — `MULTIPART_NORMALIZED_ERROR_CODES` contains all six code keys; object is frozen; `Object.values(MULTIPART_NORMALIZED_ERROR_CODES)` has no intersection with `Object.values(STORAGE_NORMALIZED_ERROR_CODES)` (import `STORAGE_NORMALIZED_ERROR_CODES` from `storage-error-taxonomy.mjs`).
  - **Test 3** — `PRESIGNED_URL_OPERATIONS` contains `upload` and `download`; object is frozen.
  - **Test 4** — Each entry under `MULTIPART_NORMALIZED_ERROR_CODES` (as a catalog of error definitions) has `httpStatus` (number), `retryability: 'not_retryable'`, and a non-empty `fallbackHint` string.

- [x] T019 Continue `tests/unit/storage-multipart-presigned.test.mjs` — **capability gate tests** (Tests 5–8 of 23):
  - **Test 5** — `checkMultipartCapability` with a MinIO-fixture provider profile (build inline using `buildStorageProviderProfile({ providerType: 'minio', ... })`): assert `allowed: true`; `capabilityId === 'object.multipart_upload'`; `satisfactionState === 'satisfied'`; `constraints` is an array.
  - **Test 6** — `checkMultipartCapability` with a synthetic fixture where `object.multipart_upload` is `unsatisfied`: assert `allowed: false`; `errorEnvelope.normalizedCode === 'CAPABILITY_NOT_AVAILABLE'`; `errorEnvelope.missingCapabilityId === 'object.multipart_upload'`; `errorEnvelope.httpStatus === 501`.
  - **Test 7** — `checkPresignedUrlCapability` with MinIO fixture: assert `allowed: true`; `capabilityId === 'bucket.presigned_urls'`.
  - **Test 8** — `checkPresignedUrlCapability` with unsatisfied fixture: assert `allowed: false`; `errorEnvelope.missingCapabilityId === 'bucket.presigned_urls'`; `errorEnvelope.fallbackHint` is a non-empty string.

- [x] T020 Continue `tests/unit/storage-multipart-presigned.test.mjs` — **multipart session and key validation tests** (Tests 9–12 of 23):
  - **Test 9** — `buildMultipartUploadSession` with all required fields: assert `sessionId` is a non-empty string starting with `mp_`; `state === 'active'`; `partCount === 0`; `accumulatedSizeBytes === 0`; `ttlDeadline > initiatedAt`; object is frozen.
  - **Test 10** — `buildMultipartUploadSession` called twice with the same clock tick (same `now` value): assert the two `sessionId` values are different (uniqueness).
  - **Test 11** — `validateMultipartObjectKey` with `objectKey: '_platform/multipart/foo'` and a real `isReservedPrefixFn` wrapping `isStorageReservedPrefix`: assert `valid: false`; `errors` array is non-empty; error message references the reserved prefix.
  - **Test 12** — `validateMultipartObjectKey` with a normal key (`'uploads/file.bin'`): assert `valid: true`; `errors` is empty.

- [x] T021 Continue `tests/unit/storage-multipart-presigned.test.mjs` — **part receipt and validatePartList tests** (Tests 13–17 of 23):
  - **Test 13** — `buildMultipartPartReceipt` with `partNumber: 1`, valid `integrityToken` and `sizeBytes`: assert all fields present; `partNumber === 1`; object is frozen.
  - **Test 14** — `validatePartList` with an empty `parts` array: assert `valid: false`; `errors` contains a message referencing empty list.
  - **Test 15** — `validatePartList` with parts [1, 2, 5] (gap): assert `valid: false`; `errors` is non-empty; error message references the missing part numbers.
  - **Test 16** — `validatePartList` with parts [1, 2, 3] (each with `sizeBytes: 5_000_000`) and `maxParts: 10000`, `minPartSizeBytes: 5_000_000`: assert `valid: true`; `partCount === 3`; `totalSizeBytes === 15_000_000`.
  - **Test 17** — `validatePartList` with `parts.length === 10001` and `maxParts: 10000`: assert `valid: false`; error message references `maxParts` constraint.

- [x] T022 Continue `tests/unit/storage-multipart-presigned.test.mjs` — **completion, abort and lifecycle audit tests** (Tests 18–20 of 23):
  - **Test 18** — `buildMultipartCompletionPreview` with a valid 3-part list: assert `validationOutcome === 'valid'`; `expectedObjectRecord.objectKey` matches the session's `objectKey`; `validationErrors` is empty.
  - **Test 19** — `buildMultipartCompletionPreview` with a gapped part list [1, 3]: assert `validationOutcome === 'invalid'`; `validationErrors` is non-empty; `expectedObjectRecord` is absent (or `undefined`).
  - **Test 20** — `buildMultipartAbortPreview` for an active session: assert `state === 'aborted'`; `abortedAt` is an ISO 8601 string. `buildMultipartLifecycleAuditEvent` for transition `'abort'`: assert `eventType === 'storage.multipart.lifecycle'`; `transition === 'abort'`; `sessionId`, `tenantId`, `workspaceId` present; object frozen.

- [x] T023 Continue `tests/unit/storage-multipart-presigned.test.mjs` — **staleness, presigned URL, and security tests** (Tests 21–23 of 23):
  - **Test 21** — `evaluateMultipartSessionStaleness` with `now > ttlDeadline`: assert `isStale: true`. `evaluateMultipartSessionStaleness` with `now < ttlDeadline`: assert `isStale: false`.
  - **Test 22** — `validatePresignedTtl` with `requestedTtlSeconds: 3600`, `platformMaxTtlSeconds: 7200`: assert `clamped: false`; `effectiveTtlSeconds === 3600`. `validatePresignedTtl` with `requestedTtlSeconds: 10000`, `platformMaxTtlSeconds: 7200`: assert `clamped: true`; `effectiveTtlSeconds === 7200`. `buildPresignedUrlRecord` for download: assert `operation === 'download'`; `expiresAt > generatedAt`; `ttlClamped` matches `clamped` flag; object frozen.
  - **Test 23** — `buildPresignedUrlAuditEvent` for a generated download URL: assert `eventType === 'storage.presigned_url.generated'`; `requestingIdentity` is present; `JSON.stringify` of the event does NOT contain `http` as a URL substring (no raw URL in audit record). `buildStaleSessionCleanupRecord`: assert `cleanupReason === 'ttl_exceeded'`; `state === 'aborted'`; object frozen.
  - Run all 23 tests: `node --test tests/unit/storage-multipart-presigned.test.mjs` must exit 0.

- [x] T024 Extend `services/adapters/src/provider-catalog.mjs` with additive re-exports from `storage-multipart-presigned.mjs` (do not modify or remove any existing export):

  ```js
  // Multipart upload
  export function buildStorageMultipartSession(input = {}) { return buildMultipartUploadSession(input); }
  export function buildStorageMultipartPartReceipt(input = {}) { return buildMultipartPartReceipt(input); }
  export function buildStorageMultipartCompletionPreview(input = {}) { return buildMultipartCompletionPreview(input); }
  export function buildStorageMultipartAbortPreview(input = {}) { return buildMultipartAbortPreview(input); }
  export function buildStorageMultipartUploadList(input = {}) { return buildMultipartUploadList(input); }
  export function buildStorageMultipartSessionSummary(input = {}) { return buildMultipartSessionSummary(input); }
  export function buildStorageMultipartLifecycleEvent(input = {}) { return buildMultipartLifecycleAuditEvent(input); }
  export function evaluateStorageMultipartStaleness(input = {}) { return evaluateMultipartSessionStaleness(input); }
  export function buildStorageStaleSessionCleanupRecord(input = {}) { return buildStaleSessionCleanupRecord(input); }
  export function validateStoragePartList(input = {}) { return validatePartList(input); }
  export function validateStorageMultipartObjectKey(input = {}) { return validateMultipartObjectKey(input); }

  // Presigned URLs
  export function buildStoragePresignedUrlRecord(input = {}) { return buildPresignedUrlRecord(input); }
  export function buildStoragePresignedUrlAuditEvent(input = {}) { return buildPresignedUrlAuditEvent(input); }
  export function validateStoragePresignedTtl(input = {}) { return validatePresignedTtl(input); }

  // Capability gates
  export function checkStorageMultipartCapability(input = {}) { return checkMultipartCapability(input); }
  export function checkStoragePresignedUrlCapability(input = {}) { return checkPresignedUrlCapability(input); }
  export function buildStorageCapabilityNotAvailableError(input = {}) { return buildCapabilityNotAvailableError(input); }

  // Catalog constants
  export const storageMultipartSessionStates = MULTIPART_SESSION_STATES;
  export const storageMultipartLifecycleTransitions = MULTIPART_LIFECYCLE_TRANSITIONS;
  export const storagePresignedUrlOperations = PRESIGNED_URL_OPERATIONS;
  export const storageMultipartNormalizedErrorCodes = MULTIPART_NORMALIZED_ERROR_CODES;
  ```

  - Verify: run `node --test tests/adapters/provider-catalog.test.mjs` — must still pass without modification.

- [x] T025 Create `tests/adapters/storage-multipart-presigned.test.mjs` — all 10 adapter integration tests (`provider-catalog.mjs` imports only; static fixtures; no live provider connections):
  - **Test 1** — MinIO fixture: `checkStorageMultipartCapability({ providerProfile: minioProfile })` → `allowed: true`; `constraints` array contains an entry with `key: 'maxParts'` and `value: 10000` (from `storage-provider-profile.mjs` MinIO definition).
  - **Test 2** — Garage fixture: `checkStorageMultipartCapability` → `allowed: true`.
  - **Test 3** — MinIO fixture: `checkStoragePresignedUrlCapability` → `allowed: true`.
  - **Test 4** — Garage fixture: `checkStoragePresignedUrlCapability` → `allowed: true`.
  - **Test 5** — Synthetic fixture with `object.multipart_upload` unsatisfied: `checkStorageMultipartCapability` → `allowed: false`; `buildStorageCapabilityNotAvailableError({ capabilityId: 'object.multipart_upload', ... })` → `normalizedCode: 'CAPABILITY_NOT_AVAILABLE'`; `httpStatus: 501`.
  - **Test 6** — `buildStorageMultipartSession` with valid MinIO-fixture inputs: assert `sessionId` starts with `mp_`; `state: 'active'`; `partCount: 0`; object frozen.
  - **Test 7** — `buildStoragePresignedUrlRecord` for upload operation with `grantedTtlSeconds: 3600`: assert `operation: 'upload'`; `expiresAt` is in the future; `ttlClamped: false`; object frozen.
  - **Test 8** — `validateStoragePartList` with 10 000 parts (all `sizeBytes: 5_242_880`) and `maxParts: 10000`: assert `valid: true`. Same with 10 001 parts: assert `valid: false`.
  - **Test 9** — All 20 named re-exports from the additive block in `provider-catalog.mjs` are importable and not `undefined` (enumerate all 20 names).
  - **Test 10** — `buildStoragePresignedUrlAuditEvent` output: `JSON.stringify` does not contain any string matching `/https?:\/\//` or `/secret:\/\//`; object is frozen.
  - Run: `node --test tests/adapters/storage-multipart-presigned.test.mjs` must exit 0.

- [x] T026 Extend `tests/contracts/storage-provider.contract.test.mjs` with an additive test block (do not modify any existing assertion):
  - Add `test('storage multipart and presigned URL schemas are additive and structurally valid', async (t) => { ... })` containing:
    - Import `buildStorageMultipartSession`, `buildStoragePresignedUrlRecord`, `checkStorageMultipartCapability`, `storageMultipartNormalizedErrorCodes`, `storageNormalizedErrorCodes` from `provider-catalog.mjs` (or from the source modules directly).
    - Assert `buildStorageMultipartSession` output contains: `sessionId`, `tenantId`, `workspaceId`, `bucketId`, `objectKey`, `initiatedAt`, `ttlDeadline`, `state`, `partCount`, `accumulatedSizeBytes`.
    - Assert `buildStoragePresignedUrlRecord` output contains: `operation`, `bucketId`, `objectKey`, `tenantId`, `workspaceId`, `grantedTtlSeconds`, `ttlClamped`, `expiresAt`, `generatedAt`.
    - Assert `checkStorageMultipartCapability` output contains: `allowed`, `capabilityId`, `satisfactionState`, `constraints`.
    - Assert `new Set(Object.values(storageMultipartNormalizedErrorCodes)).size === 6` (six distinct codes).
    - Assert no value in `Object.values(storageMultipartNormalizedErrorCodes)` appears in `Object.values(storageNormalizedErrorCodes)` (additive, no collision, FR-030).
    - Assert the `storageMultipartNormalizedErrorCodes` object is frozen.
  - Run full contract suite: `node --test tests/contracts/` must exit 0 with no existing assertions changed.

- [x] T027 Create `tests/e2e/storage-multipart-presigned/README.md` — static verification scenario matrix with five sections:
  - **Section 1 — Multipart Upload Scenarios (US Story 1 acceptance criteria)**: one row per acceptance criterion (AC-1.1 through AC-1.5 from spec user story 1); columns: Scenario ID, Precondition, Action, Expected Outcome, Evidence Required (report fields or assertion messages).
  - **Section 2 — Presigned URL Scenarios (US Story 2 acceptance criteria)**: rows for AC-2.1 through AC-2.5; same columns as section 1.
  - **Section 3 — Graceful Degradation Scenarios (US Story 3)**: rows for AC-3.1 through AC-3.3 plus the edge cases from spec section 1 (zero-part completion, part ordering gaps, duplicate part number, presigned URL for non-existent object, reserved prefix conflict, concurrent multipart uploads to same key, part size below provider minimum, provider unavailable mid-multipart); columns: Scenario ID, Trigger Condition, Expected Error Code, Expected Fallback Hint, Evidence Required.
  - **Section 4 — Lifecycle Governance Scenarios (US Story 4)**: rows for AC-4.1 through AC-4.3; columns: Scenario ID, Precondition, Governance Rule, Expected Lifecycle Transition, Audit Event Expected, Evidence Required.
  - **Section 5 — Audit and Security Scenarios (US Story 5)**: rows for AC-5.1 through AC-5.3; columns: Scenario ID, Operation, TTL Behaviour, Identity Traceability, Audit Event Fields, Evidence Required.
  - Each section must include an **Evidence expectations** subsection listing what artifacts (audit event fields, frozen object fields, assertion log entries) confirm the scenario passed.
  - Include a **Review triggers** section at the end: conditions requiring matrix re-review (new provider added, spec FR change, error taxonomy update, multipart TTL policy change).

## Validation checklist

- [x] T030 Run `npm run lint:md` (or equivalent markdown linter).
- [x] T031 Run `node --test tests/unit/storage-multipart-presigned.test.mjs` — exit 0 required.
- [x] T032 Run `node --test tests/adapters/storage-multipart-presigned.test.mjs` — exit 0 required.
- [x] T033 Run `node --test tests/adapters/provider-catalog.test.mjs` — exit 0 required (no regressions).
- [x] T034 Run `node --test tests/contracts/storage-provider.contract.test.mjs` — exit 0 required (no existing assertions broken).
- [x] T035 Run full test suite from repo root (`npm test` or `node --test tests/unit/ tests/adapters/ tests/contracts/`) — exit 0 required.

## Delivery checklist

- [x] T040 Review git diff for T01 scope compliance: confirm no modifications outside the listed artifacts — `services/adapters/src/storage-multipart-presigned.mjs` (new), `services/adapters/src/provider-catalog.mjs` (additive exports only), `tests/unit/storage-multipart-presigned.test.mjs` (new), `tests/adapters/storage-multipart-presigned.test.mjs` (new), `tests/contracts/storage-provider.contract.test.mjs` (additive block only), `tests/e2e/storage-multipart-presigned/README.md` (new), `specs/013-storage-multipart-presigned-urls/` (spec artefacts only). No T01–T06 logic changed.
- [ ] T041 Commit the feature branch changes for `US-STO-02-T01`.
- [ ] T042 Push `013-storage-multipart-presigned-urls` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
