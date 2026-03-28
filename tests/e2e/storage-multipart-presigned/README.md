# Storage multipart + presigned URL scenario matrix

## Section 1 — Multipart Upload Scenarios

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| AC-1.1 | Provider capability `object.multipart_upload` satisfied | Initiate multipart upload | Session id returned; state `active`/pending multipart | Session record fields, capability gate result |
| AC-1.2 | Active multipart session exists | Upload numbered part | Part receipt returned with `partNumber` + integrity token | Receipt object, assertions on frozen output |
| AC-1.3 | Ordered parts available | Complete multipart upload | Standard object record returned with final size/key | Completion preview + expected object record |
| AC-1.4 | Active multipart session exists | Abort multipart upload | Session transitions to aborted and cleanup preview emitted | Abort preview + lifecycle event |
| AC-1.5 | Provider capability unsatisfied | Initiate multipart upload | `CAPABILITY_NOT_AVAILABLE` returned | Error envelope, missing capability id |

### Evidence expectations — Section 1

- Session records include `sessionId`, `ttlDeadline`, `state`, `partCount`, `accumulatedSizeBytes`.
- Part receipts include `partNumber`, `integrityToken`, `sizeBytes`, `receivedAt`.
- Completion evidence includes `validationOutcome`, `validationErrors`, and `expectedObjectRecord` when valid.

## Section 2 — Presigned URL Scenarios

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| AC-2.1 | Provider capability `bucket.presigned_urls` satisfied | Generate download URL | Download presigned record returned with expiration | Presigned record fields |
| AC-2.2 | Provider capability satisfied and upload permission granted | Generate upload URL | Upload presigned record returned with expiration | Presigned record fields |
| AC-2.3 | Generated URL expires | Use URL after TTL | Access denied/expired at use time | TTL validation + expiration timestamp |
| AC-2.4 | Capability unsatisfied | Generate presigned URL | `CAPABILITY_NOT_AVAILABLE` returned | Error envelope |
| AC-2.5 | Tenant A object scoped | Use generated URL | Access restricted to exact bucket/object scope | Audit event metadata and scope fields |

### Evidence expectations — Section 2

- Presigned records include `presignedUrlRef`, `operation`, `grantedTtlSeconds`, `ttlClamped`, `expiresAt`.
- Audit events include identity, tenant/workspace/bucket/object scope, TTL metadata.
- Audit serialization must not include raw URL strings.

## Section 3 — Graceful Degradation Scenarios

| Scenario ID | Trigger Condition | Expected Error Code | Expected Fallback Hint | Evidence Required |
|---|---|---|---|---|
| AC-3.1 | Multipart capability unsatisfied | `CAPABILITY_NOT_AVAILABLE` | Use single-request `object.put` | Error envelope fields |
| AC-3.2 | Presigned capability unsatisfied | `CAPABILITY_NOT_AVAILABLE` | Use proxied endpoints | Error envelope fields |
| AC-3.3 | Multipart exceeds declared constraints | `MULTIPART_CONSTRAINT_EXCEEDED` | Reduce part count/size | Validation errors |
| EC-3.4 | Complete with zero parts | `MULTIPART_INVALID_PART_ORDER`/invalid completion | Submit non-empty ordered list | Validation errors |
| EC-3.5 | Gap in parts (1,2,5) | `MULTIPART_INVALID_PART_ORDER`/invalid completion | Resubmit contiguous parts | Validation errors |
| EC-3.6 | Duplicate part numbers in completion list | Invalid completion | Submit unique part numbers | Validation errors |
| EC-3.7 | Download URL for missing object | No generation error | N/A | Record still generated |
| EC-3.8 | Reserved multipart target prefix | Reserved prefix conflict | Use non-platform keyspace | Object-key validation result |
| EC-3.9 | Concurrent multipart uploads same key | No error | N/A | Distinct session ids |
| EC-3.10 | Non-final part below min size | `MULTIPART_CONSTRAINT_EXCEEDED`/invalid completion | Increase non-final part size | Validation errors |
| EC-3.11 | Provider unavailable mid-flow | `STORAGE_PROVIDER_UNAVAILABLE` (runtime-layer) | Retry when provider recovers | Documented runtime responsibility |

### Evidence expectations — Section 3

- Validation reports contain precise, machine-readable error strings.
- Capability errors include `missingCapabilityId` and `fallbackHint`.
- Reserved-prefix failures are surfaced before session creation.

## Section 4 — Lifecycle Governance Scenarios

| Scenario ID | Precondition | Governance Rule | Expected Lifecycle Transition | Audit Event Expected | Evidence Required |
|---|---|---|---|---|---|
| AC-4.1 | Active multipart sessions exist | List active uploads | Session summaries returned | Optional list event | Upload list + summaries |
| AC-4.2 | Session exceeds TTL | Mark stale | Session considered stale | Lifecycle evaluation evidence | Staleness evaluation |
| AC-4.3 | Stale session cleanup runs | Abort stale session | `stale_cleanup` and aborted cleanup record | Multipart lifecycle event | Cleanup record + event |

### Evidence expectations — Section 4

- Session summaries omit internal-only fields while preserving observable scope/size data.
- Staleness evaluation exposes `isStale`, `evaluatedAt`, `ttlDeadline`, `currentState`.
- Cleanup evidence includes `cleanupReason: ttl_exceeded`.

## Section 5 — Audit and Security Scenarios

| Scenario ID | Operation | TTL Behaviour | Identity Traceability | Audit Event Fields | Evidence Required |
|---|---|---|---|---|---|
| AC-5.1 | Generate presigned URL | Requested/granted TTL captured | Requesting identity linked | `requestingIdentity`, scope, TTL, timestamps | Presigned audit event |
| AC-5.2 | Request TTL above maximum | Clamp or reject | Request remains attributable | `ttlClamped`, effective TTL | TTL validation + record |
| AC-5.3 | Review audit trail | Trace to actor/session/context | Full traceability | correlation id + scope fields | Event serialization |

### Evidence expectations — Section 5

- Audit records are frozen immutable objects.
- Event JSON contains no `http://`, `https://`, or `secret://` substrings.
- Correlation metadata is preserved where supplied.

## Review triggers

Re-review this matrix when any of the following changes:
- a new storage provider is added,
- capability manifest semantics change,
- multipart/session TTL policy changes,
- reserved-prefix rules change,
- storage error taxonomy adds or renames multipart/presigned codes,
- runtime implementation starts persisting sessions or emitting live audit events.
