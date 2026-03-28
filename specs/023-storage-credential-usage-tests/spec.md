# Feature Specification: US-STO-03-T05 — Storage Credential Rotation/Revocation and Usage Reporting Tests

**Feature Branch**: `023-storage-credential-usage-tests`
**Task**: US-STO-03-T05
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-03 — Credenciales programáticas, uso agregado, import/export y auditoría de storage
**Requirements traceability**: RF-STO-015, RF-STO-016, RF-STO-017, RF-STO-018
**Dependencies**: US-STO-03-T01 (spec 019), US-STO-03-T02 (spec 020), US-STO-03-T03, US-STO-03-T04
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

The storage subsystem now has two critical operational surfaces:

- **Scoped programmatic credentials** (spec 019 / `storage-programmatic-credentials.mjs`) — creation, scope enforcement, rotation, revocation, and expiration of per-principal S3-compatible access key pairs.
- **Usage reporting** (spec 020 / `storage-usage-reporting.mjs`) — point-in-time usage snapshots, threshold detection, per-bucket breakdowns, Top-N ranking, and cross-tenant summaries.

Both surfaces have foundational adapter tests that exercise basic record construction and happy-path flows. What is missing is **systematic test coverage for credential lifecycle transitions (rotation and revocation) and for usage reporting correctness under diverse conditions** — the scenarios that prove these surfaces behave correctly at the boundaries where real operational failures occur.

Without this task:

- Credential rotation edge cases (successive rotations, version increment consistency, scope preservation across rotations) have no dedicated verification.
- Credential revocation edge cases (re-revocation of already-revoked credentials, rotation after revocation, issuer metadata tracking through revocation) are unverified.
- Usage reporting correctness under edge conditions (provider unavailability, over-quota states, empty scopes, null limits, threshold boundary precision) lacks automated proof.
- Cross-surface interactions (Top-N ranking with empty inputs, cross-tenant summaries with mixed statuses, audit events without payload leakage) are untested.
- Regression safety for credential and usage reporting behavioral contracts is incomplete — changes to either module may silently break guarantees documented in specs 019 and 020.

This task adds the **test coverage that proves credential rotation/revocation and usage reporting behave correctly at their boundaries**, complementing the existing adapter tests with targeted lifecycle and edge-case verification.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Developers** maintaining the credential and usage-reporting modules need confidence that lifecycle transitions are correct: a rotation always increments the version, a revocation always produces a terminal state, and usage snapshots are always additively consistent.
- **QA / CI pipelines** need an automated gate that catches behavioral regressions in credential rotation, revocation, and usage reporting before they reach production.
- **Workspace admins and tenant owners** (indirect) benefit from the confidence that the credential lifecycle and usage visibility they rely on have been proven correct under adversarial conditions.
- **Superadmins** (indirect) need assurance that cross-tenant usage summaries work correctly and that no credential survives a lifecycle event it should not.

### Value delivered

- Proves that credential rotation produces correctly versioned, distinct key pairs while preserving scope and workspace binding.
- Proves that credential revocation is terminal, immediate, and idempotent — no revoked credential can be silently reactivated.
- Proves that usage reporting maintains additive consistency, handles provider unavailability gracefully, and detects threshold breaches with correct severity classification.
- Creates a regression safety net for the two most operationally sensitive storage surfaces.
- Builds operator trust that the behavioral guarantees in specs 019 and 020 are not just documented, but enforced.

---

## 3. In-Scope Capability

This task covers **automated test coverage for credential rotation/revocation lifecycle transitions and usage reporting correctness**, targeting the exported functions of `storage-programmatic-credentials.mjs` and `storage-usage-reporting.mjs`.

### In scope

- Test that credential rotation increments the secret version, produces a new distinct access key ID, preserves the credential's scope and workspace binding, and updates the `lastRotatedAt` timestamp.
- Test that successive rotations produce monotonically increasing secret versions and distinct access key IDs for each version.
- Test that rotation of a revoked credential produces the expected error or defensive behavior (rotation should not resurrect a revoked credential).
- Test that credential revocation transitions the state to `revoked`, sets the `revokedAt` timestamp, and produces a terminal state that cannot be undone.
- Test that re-revoking an already-revoked credential is idempotent — it does not produce an error.
- Test that revoking a credential does not affect other credentials in the same workspace (isolation within credential collection).
- Test that credential scope restrictions (bucket-level, action-level, object-prefix-level) survive rotation intact.
- Test that cross-workspace scope violations are rejected during both creation and rotation.
- Test that usage snapshots maintain additive consistency: the sum of per-bucket bytes equals the workspace total.
- Test that usage threshold detection correctly classifies breaches at warning and critical thresholds, including boundary values (exactly at threshold, just below, just above).
- Test that over-quota states (utilization > 100%) always produce a `critical` severity breach.
- Test that dimensions with null limits are skipped by threshold detection and report null utilization.
- Test that usage snapshots under provider unavailability include the correct `collectionStatus` and degrade gracefully.
- Test that Top-N bucket ranking handles fewer-than-N buckets, empty lists, and both sort dimensions.
- Test that cross-tenant usage summaries sort correctly by multiple dimension options and respect Top-N filtering.
- Test that usage audit events contain the correct fields without leaking payload data.

### Out of scope

- Implementing or changing production credential or usage-reporting code.
- Live provider API calls or integration tests against real S3-compatible backends.
- Console or UI tests for credential management or usage dashboards.
- Performance, load, or concurrency testing.
- Credential creation happy-path tests already covered by existing adapter tests (`tests/adapters/storage-programmatic-credentials.test.mjs`).
- Usage snapshot construction happy-path tests already covered by existing adapter tests (`tests/adapters/storage-usage-reporting.test.mjs`).

---

## 4. User Scenarios & Testing

### User Story 1 — Credential rotation lifecycle is verified end-to-end (Priority: P1)

An automated test suite validates that credential rotation produces correctly versioned, distinct key pairs while preserving the credential's identity, scope, and workspace binding across multiple successive rotations.

**Why this priority**: Rotation is the primary credential hygiene mechanism. If it produces duplicate key IDs, fails to increment versions, or silently changes scope, automated workloads using rotated credentials will break or gain unintended access.

**Independent Test**: Create a credential, rotate it twice, and assert that each rotation produces a new secret version, a new distinct access key ID, preserves all scope definitions, and updates `lastRotatedAt` without changing `createdAt`.

**Acceptance Scenarios**:

1. **Given** credential C with secret version 1 and access key ID AK1, **When** C is rotated, **Then** the result has secret version 2, a new access key ID AK2 distinct from AK1, the same credential ID, the same workspace ID, the same scopes (including bucket restrictions and object prefixes), `lastRotatedAt` updated to the rotation timestamp, and `createdAt` unchanged.
2. **Given** credential C has been rotated to version 2, **When** C is rotated again, **Then** the result has secret version 3, access key ID AK3 distinct from AK2 and AK1, and all invariants from scenario 1 still hold.
3. **Given** credential C with a TTL-derived `expiresAt`, **When** C is rotated, **Then** the rotated credential's `expiresAt` is recalculated consistently from the original TTL, maintaining coherent expiration semantics.

---

### User Story 2 — Credential revocation is terminal and immediate (Priority: P1)

An automated test suite validates that credential revocation transitions the credential to a permanent `revoked` state that cannot be reversed, and that all lifecycle metadata is correctly recorded.

**Why this priority**: Revocation is the primary security control for compromised or unnecessary credentials. If a revoked credential can be silently reactivated or its revocation timestamp is mutable, the security guarantee is broken.

**Independent Test**: Create a credential, revoke it, and assert that the state is `revoked`, `revokedAt` is set, and attempting to revoke it again does not throw an error.

**Acceptance Scenarios**:

1. **Given** active credential C, **When** C is revoked at timestamp T1, **Then** the result has `state: 'revoked'`, `revokedAt: T1`, and `updatedAt: T1`.
2. **Given** credential C already revoked at T1, **When** C is revoked again at T2, **Then** the result still has `state: 'revoked'` — the operation is idempotent and does not throw.
3. **Given** credential C with issuer metadata (actorId, actorType, originSurface, correlationId), **When** C is revoked by a different actor, **Then** the revoked credential's issuer metadata reflects the revoking actor, providing audit traceability of who performed the revocation.

---

### User Story 3 — Rotation of a revoked credential does not resurrect it (Priority: P1)

An automated test suite validates that attempting to rotate a revoked credential does not produce a valid active credential — the revoked state is terminal and respected by the rotation function.

**Why this priority**: If rotation can bypass revocation, the entire revocation guarantee collapses. This is a critical safety invariant.

**Independent Test**: Create a credential, revoke it, then attempt to rotate it. Assert that the rotation either produces an error or preserves the revoked state — no active credential is produced from a revoked one.

**Acceptance Scenarios**:

1. **Given** credential C in state `revoked`, **When** rotation is attempted, **Then** either an error is raised indicating the credential cannot be rotated in its current state, or the result preserves the `revoked` state (defensive passthrough). The test verifies whichever behavior the module implements and documents the contract.
2. **Given** the rotation-after-revocation behavior is documented in the test, **When** a new developer reads the test, **Then** they understand whether the module throws or degrades, removing ambiguity about the expected contract.

---

### User Story 4 — Credential scope survives rotation intact (Priority: P1)

An automated test suite validates that all scope restrictions — bucket-level binding, action-level restrictions, object-prefix narrowing — survive rotation without modification.

**Why this priority**: Scope drift during rotation would silently widen or narrow a credential's access, breaking the least-privilege guarantee.

**Independent Test**: Create a credential with bucket restriction, object prefix, and a specific action subset. Rotate it. Assert that every scope field is identical before and after rotation.

**Acceptance Scenarios**:

1. **Given** credential C scoped to bucket B1, object prefix `uploads/`, actions `[object.get, object.put]`, **When** C is rotated, **Then** the rotated credential's scopes array is identical: same bucket ID, same object prefix, same allowed actions in the same order.
2. **Given** credential C with multiple scope entries (one per bucket), **When** C is rotated, **Then** all scope entries are preserved — none are dropped, duplicated, or reordered.
3. **Given** credential C with the broadest allowed scope (all permitted actions, no bucket restriction), **When** C is rotated, **Then** the broad scope is preserved — rotation does not artificially narrow scope.

---

### User Story 5 — Usage snapshot additive consistency under diverse conditions (Priority: P1)

An automated test suite validates that usage snapshots maintain additive consistency (per-bucket sums equal workspace totals) under edge conditions: empty workspaces, single-bucket workspaces, workspaces with zero-byte buckets, and large mixed workspaces.

**Why this priority**: Additive inconsistency in usage data erodes trust in capacity governance. If workspace totals don't match bucket sums, every downstream consumer (console dashboards, threshold detection, quota admission) operates on contradictory data.

**Independent Test**: Build usage snapshots for a variety of workspace configurations and assert that the additive consistency invariant holds for every case, or that the module raises a clear error when inconsistent data is supplied.

**Acceptance Scenarios**:

1. **Given** a workspace with 5 buckets of varying sizes (including one with 0 bytes / 0 objects), **When** a workspace usage entry is built with correct totals, **Then** the entry is accepted and `totalBytes == sum(bucket.totalBytes)`, `objectCount == sum(bucket.objectCount)`, `bucketCount == len(buckets)`.
2. **Given** a workspace with no buckets, **When** a workspace usage entry is built with `totalBytes: 0`, `objectCount: 0`, `bucketCount: 0`, and empty buckets array, **Then** the entry is accepted with all dimensions at zero.
3. **Given** a workspace where the declared `totalBytes` does not match the sum of per-bucket bytes, **When** the workspace usage entry is built, **Then** the module raises an `USAGE_BREAKDOWN_INCONSISTENT` error with details showing the expected and actual values.
4. **Given** a workspace with a single bucket containing 1 byte and 1 object, **When** the workspace usage entry is built, **Then** the minimal entry passes consistency validation.

---

### User Story 6 — Threshold detection boundary precision (Priority: P1)

An automated test suite validates that usage threshold detection correctly classifies breaches at exact boundary values — exactly at 80%, at 79.99%, at 80.01%, at 95%, at 100%, and above 100% — with the correct severity for each case.

**Why this priority**: Threshold detection drives capacity alerts. Off-by-one errors at boundary values cause either missed alerts (false negatives) or alert fatigue (false positives). Both undermine trust in the alerting system.

**Independent Test**: Build usage snapshots with dimensions at exact boundary percentages and assert that each produces the correct severity (or no breach) for default thresholds of 80% warning / 95% critical.

**Acceptance Scenarios**:

1. **Given** dimension utilization at exactly 80.00% with default thresholds, **When** threshold detection runs, **Then** a `warning` severity breach is produced (≥ 80% triggers warning).
2. **Given** dimension utilization at 79.99%, **When** threshold detection runs, **Then** no breach is produced.
3. **Given** dimension utilization at exactly 95.00%, **When** threshold detection runs, **Then** a `critical` severity breach is produced (≥ 95% triggers critical, overriding warning).
4. **Given** dimension utilization at 94.99%, **When** threshold detection runs, **Then** a `warning` severity breach is produced (above 80%, below 95%).
5. **Given** dimension utilization at 100.01% (over-quota), **When** threshold detection runs, **Then** a `critical` severity breach is produced regardless of configured thresholds.
6. **Given** custom thresholds of 70% warning / 90% critical, **When** utilization is at 75%, **Then** a `warning` breach is produced (custom thresholds respected).
7. **Given** a dimension with `limit: null`, **When** threshold detection runs, **Then** no breach is produced for that dimension — it is skipped entirely.

---

### User Story 7 — Usage snapshot graceful degradation under provider unavailability (Priority: P2)

An automated test suite validates that usage snapshots built during provider unavailability include the correct `collectionStatus` and do not produce silent zeroes that mask the unavailability.

**Why this priority**: Silent zeroes during provider outages would be mistaken for genuine zero usage, potentially triggering false-positive capacity alerts or misleading dashboard displays.

**Independent Test**: Build a usage snapshot with `collectionStatus: 'provider_unavailable'` and assert that the snapshot structure is valid, the status is propagated, and breakdown is empty when no cache is available.

**Acceptance Scenarios**:

1. **Given** provider is unavailable and no cache exists, **When** a usage snapshot is built with `collectionStatus: 'provider_unavailable'` and no `cacheSnapshotAt`, **Then** the snapshot has `collectionStatus: 'provider_unavailable'`, an empty breakdown array, and dimension data as supplied (the builder does not fabricate usage).
2. **Given** provider is unavailable but cached data exists with `cacheSnapshotAt`, **When** a usage snapshot is built with `collectionStatus: 'provider_unavailable'` and the cache timestamp provided, **Then** the snapshot includes the cached breakdown and clearly indicates `cacheSnapshotAt` for freshness transparency.
3. **Given** provider returns a `partial` collection status, **When** the snapshot is built, **Then** `collectionStatus: 'partial'` is preserved and the partial breakdown is included.

---

### User Story 8 — Top-N bucket ranking handles edge cases (Priority: P2)

An automated test suite validates that Top-N bucket ranking correctly handles empty lists, fewer-than-N buckets, ties, and both supported sort dimensions.

**Why this priority**: Top-N ranking is a convenience surface for capacity hotspot identification. Edge cases in ranking can cause empty or misleading dashboard views.

**Independent Test**: Invoke the ranking function with various inputs (empty, fewer-than-N, ties, different sort dimensions) and assert correct ordering, correct rank assignment, and correct result count.

**Acceptance Scenarios**:

1. **Given** 10 buckets and `topN: 3` sorted by `total_bytes`, **When** ranking is invoked, **Then** the result contains exactly 3 entries, sorted by bytes descending, with ranks 1, 2, 3.
2. **Given** 2 buckets and `topN: 5`, **When** ranking is invoked, **Then** the result contains 2 entries (no padding), ranked 1 and 2.
3. **Given** an empty bucket list and `topN: 3`, **When** ranking is invoked, **Then** the result is an empty array.
4. **Given** buckets sorted by `object_count`, **When** ranking is invoked with `sortDimension: 'object_count'`, **Then** the result is sorted by object count descending, not by bytes.
5. **Given** two buckets with identical `totalBytes`, **When** ranking is invoked, **Then** both appear in the result with consecutive ranks (stable ordering — no crash or omission).

---

### User Story 9 — Cross-tenant usage summary correctness (Priority: P2)

An automated test suite validates that cross-tenant usage summaries aggregate correctly, sort by multiple dimension options, and respect Top-N filtering.

**Why this priority**: Cross-tenant summaries are the platform's highest-level capacity view. Sorting or filtering errors here mislead capacity planning decisions.

**Independent Test**: Build tenant-level snapshots for 3 tenants, produce a cross-tenant summary, and assert correct sorting and Top-N slicing.

**Acceptance Scenarios**:

1. **Given** 3 tenant snapshots (T1: 5 GB, T2: 2 GB, T3: 800 MB), **When** a cross-tenant summary is built sorted by `total_bytes`, **Then** the tenants appear in order T1, T2, T3 with correct byte values.
2. **Given** the same 3 tenants and `topN: 2`, **When** the summary is built, **Then** only T1 and T2 appear.
3. **Given** tenants sorted by `object_count` where T3 has the most objects, **When** the summary is built with `sortDimension: 'object_count'`, **Then** T3 appears first.
4. **Given** a suspended tenant T1 with `status: 'suspended'`, **When** the summary is built, **Then** T1 appears in the summary with its status indicated.

---

### User Story 10 — Usage audit event structure is correct and does not leak payload (Priority: P2)

An automated test suite validates that usage audit events contain the correct metadata fields and do not include the full usage data payload.

**Why this priority**: Audit events that leak full usage payloads waste storage and potentially expose sensitive capacity data in audit logs. Audit events with missing metadata are useless for traceability.

**Independent Test**: Build a usage audit event and assert it contains the expected fields (actor, scope, timestamp, event type) and does not contain snapshot data (dimensions, breakdowns, threshold breaches).

**Acceptance Scenarios**:

1. **Given** a usage query by actor A for workspace W at time T, **When** the audit event is built, **Then** it contains `actorPrincipal: A`, `scopeType: 'workspace'`, `scopeId: W`, `timestamp: T`, `eventType: 'storage.usage.queried'`.
2. **Given** the audit event from scenario 1, **When** its keys are inspected, **Then** it does NOT contain `dimensions`, `breakdown`, `buckets`, `thresholdBreaches`, or `snapshot` — only query metadata.

---

### Edge Cases

- **Credential rotation from version 1 to high version numbers**: Assert that rotation from version 99 to 100 works correctly — no hardcoded version ceiling.
- **Credential with minimum TTL (60 seconds)**: Assert that creation and rotation both honor the minimum TTL without error.
- **Credential with maximum TTL boundary**: Assert that TTL at exactly the platform maximum is accepted, and TTL exceeding the maximum is clamped.
- **Usage dimension with `used: 0` and `limit: 0`**: Assert that utilization calculation handles division-by-zero gracefully (e.g., reports 0% or skips, does not throw).
- **Usage snapshot with all four dimensions at different utilization levels**: Assert that threshold detection produces the correct breach set (one breach per qualifying dimension, not one global breach).
- **Cross-tenant summary with zero tenants**: Assert that the summary is structurally valid with an empty tenants array.
- **Credential display name with whitespace and special characters**: Assert that normalization trims whitespace without corrupting the display name.
- **Usage snapshot with `collectionMethod` not matching any known method**: Assert that the module normalizes to a safe default (`platform_estimate`), not that it throws.

---

## 5. Functional Requirements

### Credential Rotation Test Coverage

- **FR-001**: The test suite MUST verify that `rotateStorageProgrammaticCredential` increments `secretVersion` by exactly 1 on each rotation.
- **FR-002**: The test suite MUST verify that each rotation produces a distinct `accessKeyId` that differs from all previous versions of the same credential.
- **FR-003**: The test suite MUST verify that rotation preserves the credential's `credentialId`, `workspaceId`, `tenantId`, `displayName`, `credentialType`, and complete `scopes` array (including `bucketId`, `objectPrefix`, and `allowedActions`).
- **FR-004**: The test suite MUST verify that rotation updates `lastRotatedAt` and `updatedAt` to the rotation timestamp without modifying `createdAt`.
- **FR-005**: The test suite MUST verify the behavior of rotating a credential in state `revoked` and document whether the module throws or degrades.

### Credential Revocation Test Coverage

- **FR-006**: The test suite MUST verify that `revokeStorageProgrammaticCredential` transitions the credential state to `revoked` and sets `revokedAt` to the requested timestamp.
- **FR-007**: The test suite MUST verify that re-revocation of an already-revoked credential is handled without error (idempotent terminal state).
- **FR-008**: The test suite MUST verify that revocation preserves the credential's scope and identity metadata for audit purposes.
- **FR-009**: The test suite MUST verify that revoking one credential in a collection does not affect other credentials in the same collection.

### Usage Reporting Test Coverage

- **FR-010**: The test suite MUST verify additive consistency of `buildStorageWorkspaceUsageEntry`: `totalBytes == Σ(bucket.totalBytes)`, `objectCount == Σ(bucket.objectCount)`, `bucketCount == len(buckets)`.
- **FR-011**: The test suite MUST verify that `buildStorageWorkspaceUsageEntry` raises `USAGE_BREAKDOWN_INCONSISTENT` when supplied totals do not match per-bucket sums.
- **FR-012**: The test suite MUST verify that `detectStorageUsageThresholdBreaches` correctly classifies breaches at boundary values (exactly at threshold, just below, just above) for both warning and critical severities.
- **FR-013**: The test suite MUST verify that threshold detection skips dimensions with `limit: null` and produces `critical` breaches for utilization above 100%.
- **FR-014**: The test suite MUST verify that custom thresholds override defaults when provided to `detectStorageUsageThresholdBreaches`.
- **FR-015**: The test suite MUST verify that `buildStorageUsageSnapshot` with `collectionStatus: 'provider_unavailable'` produces a valid snapshot with empty breakdown when no cache is available.
- **FR-016**: The test suite MUST verify that `rankBucketsByUsage` handles empty lists, fewer-than-N results, and both sort dimensions correctly.
- **FR-017**: The test suite MUST verify that `buildStorageCrossTenantUsageSummary` sorts by the specified dimension and respects Top-N filtering.
- **FR-018**: The test suite MUST verify that `buildStorageUsageAuditEvent` includes only query metadata (actor, scope, timestamp, event type) and does not include usage payload data.

### Regression Safety

- **FR-019**: The test suite MUST run without network access or live provider dependencies — all verification is against the declarative function layer.
- **FR-020**: All tests MUST pass in the repository's existing test runner (`node --test`).

---

## 6. Business Rules and Governance

- These tests verify behavioral contracts, not performance characteristics. They are correctness gates, not load tests.
- Test expectations must be derived from the behavioral guarantees in specs 019 and 020, not from internal implementation details. Tests should survive internal refactors that preserve the same external contracts.
- Credential tests must not depend on specific hash output values. They should assert distinctness, monotonicity, and structural invariants — not exact key strings.
- Usage reporting tests must use the same dimension vocabulary as `STORAGE_QUOTA_DIMENSIONS` to stay aligned with the quota guardrail system.
- Test output must be deterministic and reproducible. No reliance on wall-clock time, random seeds, or external state.
- The test surface must remain additive: extending credential or usage-reporting modules with new functions should extend coverage, not break existing assertions.

---

## 7. Acceptance Criteria

1. Credential rotation is tested for version increment correctness across at least 3 successive rotations, with distinct access key IDs verified for each version.
2. Credential rotation is tested for scope preservation: bucket restrictions, object prefixes, and allowed actions survive rotation unchanged.
3. Credential rotation is tested for timestamp correctness: `lastRotatedAt` and `updatedAt` are updated; `createdAt` is not.
4. Credential revocation is tested for terminal state: `state: 'revoked'`, `revokedAt` set, and re-revocation handled without error.
5. Rotation of a revoked credential is tested and the module's behavior (throw or degrade) is documented in the test.
6. Revocation of one credential does not affect others in the same workspace (isolation verified).
7. Usage workspace entry additive consistency is tested for at least 4 configurations: empty workspace, single bucket, multiple mixed-size buckets, and an intentionally inconsistent input that triggers the validation error.
8. Threshold detection is tested at exact boundary values (80%, 95%, >100%) with correct severity classification for each case.
9. Threshold detection correctly skips null-limit dimensions and respects custom threshold overrides.
10. Provider-unavailable usage snapshots produce the correct `collectionStatus` and degrade without silent zeroes.
11. Top-N bucket ranking is tested for empty lists, fewer-than-N, and both sort dimensions.
12. Cross-tenant usage summary is tested for multi-dimension sorting and Top-N filtering.
13. Usage audit events contain only query metadata — no usage payload data.
14. The full test suite runs with `node --test` without network access.
15. All tests pass in CI without requiring live S3-compatible provider connections.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The exported functions of `storage-programmatic-credentials.mjs` (`buildStorageProgrammaticCredentialRecord`, `buildStorageProgrammaticCredentialSecretEnvelope`, `rotateStorageProgrammaticCredential`, `revokeStorageProgrammaticCredential`, `buildStorageProgrammaticCredentialCollection`) and `storage-usage-reporting.mjs` (`buildStorageUsageSnapshot`, `buildStorageUsageDimensionStatus`, `buildStorageBucketUsageEntry`, `buildStorageWorkspaceUsageEntry`, `detectStorageUsageThresholdBreaches`, `rankBucketsByUsage`, `buildStorageUsageAuditEvent`, `buildStorageCrossTenantUsageSummary`) are the primary surfaces under test. No new production code is required — only test code.
- The existing adapter tests in `tests/adapters/storage-programmatic-credentials.test.mjs` and `tests/adapters/storage-usage-reporting.test.mjs` cover happy-path construction. This task extends coverage to lifecycle transitions, boundary values, and edge cases — it does not duplicate existing coverage.
- The test infrastructure uses `node:test` and `node:assert/strict`, consistent with the rest of the repository's test conventions.

### Risks

- **Rotation-after-revocation contract ambiguity**: The current `rotateStorageProgrammaticCredential` function does not explicitly guard against rotating a revoked credential. The test suite must discover and document the actual behavior rather than assuming a specific outcome. Mitigation: write the test to detect the actual behavior (throw vs. passthrough) and assert whichever contract the module implements, adding a clear code comment explaining the discovered contract.
- **Threshold boundary precision**: JavaScript floating-point arithmetic may cause utilization percentages like 79.995% to round to 80.00% or 79.99%, affecting boundary classification. Mitigation: use integer-friendly test values where `used / limit` produces exact decimal representations, and document any precision assumptions.
- **Coupling to hash-derived identifiers**: Credential identity derivation uses SHA-256 hashing of seed strings. Tests that assert exact key values would break if the hash seed format changes. Mitigation: assert distinctness and structural properties (length, prefix format), not exact hash outputs.

### Open Questions

- **Q1**: Should the rotation-after-revocation test assert a throw or assert a degraded (still-revoked) result? This is a design question for the credential module owner. The test will discover and document whichever behavior exists today, flagging it for explicit decision if the behavior is ambiguous.

---

## 9. Success Criteria

- **SC-001**: All credential rotation invariants (version increment, key distinctness, scope preservation, timestamp correctness) are verified across at least 3 successive rotations.
- **SC-002**: All credential revocation invariants (terminal state, timestamp setting, idempotency) are verified including the revoked-then-rotated edge case.
- **SC-003**: Usage snapshot additive consistency is verified for at least 4 workspace configurations.
- **SC-004**: Threshold detection boundary precision is verified at all documented boundary values with zero false positives and zero false negatives.
- **SC-005**: The full test suite is automated, deterministic, and runs as part of `npm test` / `node --test` without network access.
