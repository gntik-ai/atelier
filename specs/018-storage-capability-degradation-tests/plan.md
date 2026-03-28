# Implementation Plan: US-STO-02-T06 — Storage Capability Degradation Tests

**Feature Branch**: `018-storage-capability-degradation-tests`
**Spec**: `specs/018-storage-capability-degradation-tests/spec.md`
**Task**: US-STO-02-T06
**Epic**: EP-12 — Storage S3-compatible
**Status**: Planned
**Created**: 2026-03-28

---

## 1. Scope Summary

This task adds deterministic, repo-local verification for the storage provider capability surface introduced by prior storage increments, especially T05. The work is intentionally test-heavy: it proves that published provider capabilities are complete, structurally stable, and respected by downstream gating helpers without introducing live S3 calls or changing runtime behavior unless a test exposes a small correctness gap.

The implementation remains bounded to the existing storage abstraction and control-plane summary surfaces. Success is measured by additive automated coverage for:

- capability catalog completeness for every provider and the unavailable fallback,
- manifest-to-detail derivation consistency,
- graceful degradation for unsupported and partially supported advanced capabilities,
- capability-gated admission checks for multipart and event notifications,
- limitation integrity and cross-provider structural consistency.

---

## 2. Dependency Map

| Prior task | Spec | Module(s) consumed | Usage in this task |
|---|---|---|---|
| T01 — Multipart + presigned URLs | `013-storage-multipart-presigned` | `storage-multipart-presigned.mjs`, existing multipart tests | Reuse the existing capability-gate surface for `object.multipart_upload` |
| T02 — Bucket policies | `014-storage-bucket-policies` | `storage-access-policy.mjs`, provider catalog exports | Confirm advanced capability publication remains structurally additive |
| T03 — Capacity quotas | `015-storage-capacity-quotas` | control-plane/storage catalog summaries | Preserve additive storage summary behavior |
| T04 — Event notifications | `016-storage-event-notifications` | `storage-event-notifications.mjs`, existing event tests | Verify unsupported capability degradation for `bucket.event_notifications` |
| T05 — Provider capability exposure | `017-storage-provider-capabilities` | `storage-provider-profile.mjs`, `provider-catalog.mjs`, `storage-admin.mjs` | Treat provider definitions as the source of truth for all expected capability states |

---

## 3. Artifact Changes

### 3.1 Adapter/provider verification

**`tests/adapters/provider-catalog.test.mjs`**

Planned additions:

- verify every supported provider publishes the full canonical capability catalog,
- derive expected manifest booleans from capability details and assert equality,
- assert all three advanced states (`satisfied`, `partially_satisfied`, `unsatisfied`) are represented across the roster,
- verify unavailable-profile variants (missing, ambiguous, unknown) expose a stable all-unsatisfied surface,
- verify limitation references only point at valid canonical capability IDs.

### 3.2 Capability-gated degradation tests

**`tests/adapters/storage-event-notifications.test.mjs`**

Planned additions:

- assert Garage/event-notification evaluation degrades predictably with `allowed: false`, no matches, and a capability-not-available explanation,
- preserve the existing satisfied-path behavior for MinIO-backed notification evaluation.

**`tests/adapters/storage-multipart-presigned.test.mjs`**

Planned additions only if required by gaps discovered during verification:

- tighten multipart capability assertions around unsatisfied-state reporting and error-envelope stability.

### 3.3 Control-plane summary verification

**`tests/unit/storage-admin.test.mjs`**

Planned additions:

- verify control-plane summary/introspection surfaces keep the same canonical capability IDs and state vocabulary across MinIO, Ceph RGW, Garage, and unavailable fallback,
- verify unavailable summaries stay secret-safe and keep all manifest booleans false.

### 3.4 Contract-level regression protection

**`tests/contracts/storage-provider.contract.test.mjs`**

Planned additions:

- add additive contract assertions that the public/provider-facing helpers keep the capability detail shape stable and complete,
- verify unavailable fallback still exposes a complete capability array and stable manifest booleans through contract-adjacent summaries.

### 3.5 Production code

Planned policy:

- do **not** change production behavior unless a newly-added deterministic test reveals a real correctness gap.
- if a small correction is required, keep it narrowly scoped to the storage capability-profile or gate helper implementation and avoid any live-provider logic.

---

## 4. Technical Design

### 4.1 Source of truth

`services/adapters/src/storage-provider-profile.mjs` is the canonical source for:

- supported provider roster,
- canonical capability IDs,
- manifest booleans,
- capability entry states,
- limitations,
- unavailable-profile fallback behavior.

The new tests should derive expectations from this surface rather than duplicating provider-state maps in parallel fixtures.

### 4.2 Verification model

The test strategy is layered:

1. **Adapter tests** verify canonical provider/profile behavior directly.
2. **Gate-specific adapter tests** verify runtime consumers (`checkStorageMultipartCapability`, `checkStorageEventNotificationCapability`, `evaluateStorageEventNotifications`) respect declared states.
3. **Unit/control-plane tests** verify summarized public-facing helper output remains structurally stable.
4. **Contract tests** verify additive API/schema-facing expectations remain preserved.

### 4.3 Structural invariants to assert

For every supported provider and unavailable fallback:

- `capabilityDetails.length === STORAGE_PROVIDER_CAPABILITY_IDS.length`
- capability IDs match the canonical catalog exactly and in stable order
- every entry exposes `capabilityId`, `required`, `state`, `summary`, `constraints`
- every state is one of `satisfied`, `partially_satisfied`, `unsatisfied`
- manifest booleans are derived from detail entries using `satisfied => true`, everything else => false
- limitations only reference valid capability IDs

### 4.4 Degradation behavior to assert

- unsupported event notifications return a stable not-available envelope and do not silently match rules,
- unsatisfied multipart capability returns `allowed: false` with the expected capability ID/state,
- unavailable-provider profiles keep all advanced capability entries present while reporting all manifest booleans false and baseline ineligible.

---

## 5. Test Strategy

### Unit / adapter tests

- extend `tests/adapters/provider-catalog.test.mjs`
- extend `tests/adapters/storage-event-notifications.test.mjs`
- extend `tests/adapters/storage-multipart-presigned.test.mjs` only if stricter coverage is needed

### Control-plane tests

- extend `tests/unit/storage-admin.test.mjs`

### Contract tests

- extend `tests/contracts/storage-provider.contract.test.mjs`

### Verification commands

Run targeted storage suites first, then the repo’s broader test command:

```bash
node --test tests/adapters/provider-catalog.test.mjs \
  tests/adapters/storage-event-notifications.test.mjs \
  tests/adapters/storage-multipart-presigned.test.mjs \
  tests/unit/storage-admin.test.mjs \
  tests/contracts/storage-provider.contract.test.mjs
npm test
```

---

## 6. Risks and Controls

| Risk | Impact | Mitigation |
|---|---|---|
| Over-coupling to exact summary text | brittle tests | assert structural invariants and explanatory presence, not full prose equality |
| Duplicate expectation maps drift from provider definitions | false negatives / maintenance overhead | derive expectations from canonical capability catalogs and provider-profile output |
| Contract tests become too implementation-specific | fragile public-surface tests | verify additive shape/stability, not private helper internals |
| Small correctness gap appears in gating helpers | implementation spillover | allow only narrow production fixes proven by deterministic failing tests |

---

## 7. Rollback / Compatibility

- All changes are additive and test-focused.
- If a production fix becomes necessary, keep it localized and reversible.
- No migrations, config changes, external resources, or secret changes are expected.

---

## 8. Definition of Done

This task is complete when:

1. the new spec-aligned tests are added,
2. unsupported and unavailable degradation paths are explicitly covered,
3. cross-provider structural invariants are enforced,
4. all targeted tests pass,
5. `npm test` passes without network access or live provider dependencies.
