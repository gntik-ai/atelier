# Feature Specification: US-STO-02-T06 — Storage Capability Degradation Tests

**Feature Branch**: `018-storage-capability-degradation-tests`
**Task**: US-STO-02-T06
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-02 — Multipart, presigned URLs, políticas, cuotas, eventos y capabilities de provider
**Created**: 2026-03-28
**Status**: Draft

---

## 1. Objective and Problem Statement

The storage module now publishes an explicit, declarative capability profile for every supported provider (T05). Each advanced capability — versioning, lifecycle, object lock, event notifications, bucket policies — is reported as `satisfied`, `partially_satisfied`, or `unsatisfied`, with constraints and limitations.

What is missing is **automated verification that the platform behaves correctly for every supported-capability state and degrades gracefully when a capability is unavailable or only partially supported**.

Without this task:

- There is no systematic proof that downstream code respects the declared capability state before attempting an advanced operation.
- Partial-support and unsupported states may be silently ignored, leading to runtime errors instead of explicit, predictable degradation.
- Provider diversity (MinIO vs. Ceph RGW vs. Garage) creates a combinatorial surface that must be covered to prevent regressions as new providers or capabilities are added.
- Operator trust in the capability profile is unverified — the declared states are metadata today, but consumers need confidence that the platform actually honors them.

This task adds the **test coverage and degradation-verification surface** that proves the capability profile is not just published, but respected.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Developers** building features on top of the storage module need confidence that capability-gated code paths are exercised and correct for every provider/state combination.
- **Workspace admins** expect that attempting an unsupported advanced operation results in a clear, explainable outcome — not an opaque provider error.
- **Tenant owners** need assurance that the platform does not silently fail or produce unexpected behavior when their selected provider lacks a capability.
- **Superadmins** need regression safety: adding a new provider or changing a capability state must not break existing degradation guarantees.
- **QA / CI pipelines** need an automated gate that catches capability-profile regressions before they reach production.

### Value delivered

- Proves that declared capability states are respected by all downstream consumers.
- Validates graceful degradation for every unsupported or partially supported capability across all supported providers.
- Creates a regression safety net for capability-profile changes.
- Builds operator confidence that the capability surface is trustworthy, not just informational.

---

## 3. In-Scope Capability

This task covers **automated test coverage and degradation verification** for the storage provider capability profile.

### In scope

- Test that every advanced capability ID (`object.versioning`, `bucket.lifecycle`, `object.lock`, `bucket.event_notifications`, `bucket.policy`) is always present in the provider profile for all supported providers, regardless of support state.
- Test that the boolean manifest summary fields are consistent with (derived from) the capability detail entries for each provider.
- Test that `satisfied`, `partially_satisfied`, and `unsatisfied` states are each represented across the supported provider roster.
- Test that unsupported capabilities produce explicit, predictable degradation behavior — not silent omission or unhandled errors.
- Test that partially supported capabilities expose constraints and limitations that explain the condition.
- Test that the unavailable-profile path (missing, ambiguous, or unknown provider selection) degrades all capabilities to a stable unsupported surface.
- Test cross-provider consistency: the same capability ID uses the same structural shape regardless of provider or state.
- Test that capability-gated admission decisions (e.g., multipart, event notifications, presigned URLs) respect the declared capability state.
- Cover edge cases: provider with all capabilities satisfied, provider with mixed states, provider with all advanced capabilities unsatisfied, and the unavailable-provider fallback.

### Out of scope

- Implementing or changing actual advanced storage operations (lifecycle mutations, object-lock enforcement, versioning behavior).
- Live provider API calls or integration tests against real S3-compatible backends.
- UI or console workflows for capability display.
- Changing the capability profile structure or adding new capability IDs.
- Performance or load testing of the capability introspection surface.

---

## 4. User Scenarios & Testing

### User Story 1 — Capability profile completeness is verified for every supported provider (Priority: P1)

An automated test suite validates that every supported provider publishes a complete capability profile containing all baseline and advanced capability IDs, with consistent structural shape and valid states.

**Why this priority**: Completeness is the foundation — if a capability ID is missing or structurally inconsistent, all downstream gating and degradation logic is unreliable.

**Independent Test**: For each supported provider, build the profile and assert that every capability ID from the canonical catalog appears in the detail list with a valid state, summary, and constraint array. Assert that the boolean manifest fields are derived correctly from the detail entries.

**Acceptance Scenarios**:

1. **Given** provider type `minio`, **When** the capability profile is built, **Then** all 20 capability IDs appear in the detail list, each with a valid state from `{satisfied, partially_satisfied, unsatisfied}`, and the manifest booleans match the derived expectations.
2. **Given** provider type `garage`, **When** the capability profile is built, **Then** the same 20 capability IDs appear, including advanced capabilities explicitly marked `unsatisfied` (e.g., `object.versioning`, `bucket.lifecycle`, `object.lock`, `bucket.event_notifications`).
3. **Given** provider type `ceph-rgw`, **When** the capability profile is built, **Then** advanced capabilities marked `partially_satisfied` include non-empty constraint arrays that explain the partial condition.

---

### User Story 2 — Graceful degradation for unsupported capabilities (Priority: P1)

When a downstream consumer checks whether an advanced capability is available for the selected provider and the capability is `unsatisfied`, the system produces an explicit, predictable degradation response — not a silent omission or an unhandled error.

**Why this priority**: Degradation safety is the core user-facing guarantee of this task. Without it, the capability profile is informational metadata with no runtime teeth.

**Independent Test**: For a provider with known unsupported capabilities (e.g., Garage for `object.versioning`), attempt the capability-gated admission check and verify it returns a clear denial with the capability ID, the unsatisfied state, and a human-readable explanation.

**Acceptance Scenarios**:

1. **Given** provider `garage` with `bucket.event_notifications` unsatisfied, **When** an event-notification evaluation references this provider profile, **Then** the evaluation result clearly communicates that event notifications are not available for this provider.
2. **Given** provider `garage` with `object.lock` unsatisfied, **When** a consumer queries the manifest boolean for `objectLock`, **Then** the result is `false` and the corresponding capability detail entry has state `unsatisfied` with a summary that explains the absence.
3. **Given** provider `ceph-rgw` with `bucket.lifecycle` partially satisfied, **When** the capability detail is inspected, **Then** the entry includes constraints describing the deployment-specific dependency.

---

### User Story 3 — Unavailable-provider fallback degrades all capabilities (Priority: P1)

When no provider is selected, or provider selection is ambiguous or unknown, the capability profile falls back to a stable unavailable surface where all capabilities are structurally present but unsatisfied.

**Why this priority**: The unavailable path is a critical safety net — if it omits capabilities or produces an inconsistent shape, feature-gating code may encounter missing fields and fail unpredictably.

**Independent Test**: Build the unavailable profile (missing provider, ambiguous selection, unknown type) and verify that all capability IDs appear, all states are `unsatisfied`, all manifest booleans are `false`, and the baseline reports ineligibility.

**Acceptance Scenarios**:

1. **Given** no provider type configured, **When** the unavailable profile is built, **Then** all 20 capability IDs appear in the detail list with state `unsatisfied`, all manifest booleans are `false`, and the baseline `eligible` field is `false`.
2. **Given** ambiguous provider selection (two conflicting types), **When** the profile is resolved, **Then** the unavailable profile is returned with error code `AMBIGUOUS_PROVIDER_SELECTION` and the same stable structure as scenario 1.
3. **Given** unknown provider type `foobar`, **When** the profile is resolved, **Then** the unavailable profile is returned with error code `UNKNOWN_PROVIDER_TYPE` and all capabilities unsatisfied.

---

### User Story 4 — Cross-provider structural consistency (Priority: P2)

For every supported provider and the unavailable fallback, the capability profile uses the same structural shape — same capability IDs, same field names, same state vocabulary — so that consumers can write provider-agnostic gating logic.

**Why this priority**: Structural consistency across providers prevents subtle bugs in shared code paths.

**Independent Test**: Iterate all supported providers plus the unavailable case, collect capability detail arrays, and assert that every entry has the same set of fields (`capabilityId`, `required`, `state`, `summary`, `constraints`) and that capability IDs match the canonical catalog exactly.

**Acceptance Scenarios**:

1. **Given** provider profiles for `minio`, `ceph-rgw`, `garage`, and the unavailable fallback, **When** their capability details are compared structurally, **Then** all four profiles contain exactly the same capability IDs in the same order, and each entry uses the same field schema.

---

### User Story 5 — Capability-gated admission checks respect declared state (Priority: P2)

Existing admission-check functions (multipart capability check, event-notification evaluation) correctly respect the declared capability state from the provider profile, refusing the operation when the capability is unsatisfied.

**Why this priority**: Admission checks are the primary runtime consumers of the capability profile. If they ignore the declared state, the profile has no effect.

**Independent Test**: For each admission-check function, invoke it with a provider profile where the relevant capability is `satisfied`, then `unsatisfied`, and verify the admission result changes accordingly.

**Acceptance Scenarios**:

1. **Given** a provider profile with `object.multipart_upload` satisfied, **When** multipart capability is checked, **Then** the result reports `allowed: true`.
2. **Given** a provider profile with `object.multipart_upload` unsatisfied, **When** multipart capability is checked, **Then** the result reports `allowed: false` with the capability state.
3. **Given** a provider profile with `bucket.event_notifications` satisfied, **When** event-notification evaluation runs, **Then** matching rules produce matches.
4. **Given** a provider profile with `bucket.event_notifications` unsatisfied, **When** event-notification evaluation runs, **Then** the evaluation communicates that event notifications are unavailable.

---

### Edge Cases

- **All capabilities satisfied (MinIO)**: verify the profile is fully complete and the baseline is eligible with no missing or insufficient capabilities.
- **All advanced capabilities unsatisfied (Garage)**: verify that baseline eligibility is still true (baseline only requires core capabilities), and the advanced booleans are all `false`.
- **Mixed advanced states (Ceph RGW)**: verify that `partially_satisfied` capabilities appear in the baseline's `insufficientCapabilities` list only if they are required, and that optional partial capabilities are correctly reported in limitations.
- **Capability constraint completeness**: verify that every `partially_satisfied` entry has at least one constraint, and every `unsatisfied` entry has a summary that explains the absence.
- **Limitation cross-reference**: verify that each limitation's `affectsCapabilities` array references capability IDs that actually exist in the canonical catalog.
- **Manifest boolean derivation boundary**: verify that `partially_satisfied` does NOT produce a `true` manifest boolean — only `satisfied` maps to `true`.

---

## 5. Functional Requirements

### FR-001 — Profile completeness test coverage

The test suite MUST verify that every supported provider's capability profile contains all capability IDs from the canonical catalog (`STORAGE_PROVIDER_CAPABILITY_IDS`), with valid states and consistent structure.

### FR-002 — Manifest-to-detail consistency test coverage

The test suite MUST verify that boolean manifest fields are correctly derived from capability detail entry states for every provider, and that only `satisfied` maps to a `true` boolean.

### FR-003 — Degradation test for unsupported capabilities

The test suite MUST verify that each advanced capability ID that is `unsatisfied` for at least one provider produces explicit degradation behavior — not silent omission — when consumed by downstream admission or evaluation functions.

### FR-004 — Degradation test for partially supported capabilities

The test suite MUST verify that each advanced capability ID that is `partially_satisfied` for at least one provider includes at least one constraint and that consumers can inspect the partial condition programmatically.

### FR-005 — Unavailable-profile degradation test

The test suite MUST verify that the unavailable-profile path (missing, ambiguous, unknown provider) produces a complete capability surface with all IDs present, all states `unsatisfied`, all booleans `false`, and baseline ineligible.

### FR-006 — Cross-provider structural consistency test

The test suite MUST verify that all supported providers and the unavailable fallback produce capability detail arrays with identical capability IDs, identical field schemas, and states from the canonical triad.

### FR-007 — Admission-gate respect test

The test suite MUST verify that capability-gated admission checks (multipart, event notifications) correctly refuse operations when the relevant capability is `unsatisfied` in the provided profile.

### FR-008 — Limitation integrity test

The test suite MUST verify that every limitation's `affectsCapabilities` entries reference valid capability IDs from the canonical catalog, and that providers with partial/unsupported capabilities have corresponding limitations.

### FR-009 — Regression safety

The test suite MUST fail if a new capability ID is added to the canonical catalog without corresponding entries in all provider profiles and the unavailable fallback.

---

## 6. Business Rules and Governance

- Degradation tests are correctness gates, not performance tests. They verify behavioral contracts, not latency or throughput.
- Capability profile tests must be provider-agnostic in structure: the same assertions apply to any provider, parameterized by the expected states from the provider definition.
- Partial support is a first-class state that must be tested with the same rigor as full support and absence.
- The test surface must remain additive: adding a new provider must extend coverage, not break existing assertions.
- Test output must be deterministic and reproducible without network access or live provider dependencies.

---

## 7. Acceptance Criteria

1. Every supported provider has automated test coverage verifying that all canonical capability IDs are present in the profile with valid states.
2. Boolean manifest fields are tested for correct derivation from capability detail entries across all providers.
3. At least one test exercises the degradation path for each unsupported advanced capability (using a provider where that capability is `unsatisfied`).
4. At least one test exercises the partial-support path for each partially supported capability (using a provider where that capability is `partially_satisfied`).
5. The unavailable-profile fallback is tested for missing, ambiguous, and unknown provider selection, verifying stable structural output.
6. Cross-provider structural consistency is asserted: same capability IDs, same fields, same state vocabulary.
7. Capability-gated admission checks are tested with both satisfied and unsatisfied profiles to confirm they respect the declared state.
8. Limitation integrity is verified: all `affectsCapabilities` references are valid.
9. The full test suite runs without network access or live provider dependencies.
10. All tests pass in the repository's existing test runner (`node --test`).

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The existing provider profile module (`storage-provider-profile.mjs`) and admission-check functions are the primary surfaces under test. No new production code is required — only test code.
- Provider definitions are the source of truth for expected capability states. Tests will derive expectations from the canonical provider definitions rather than hard-coding duplicate state maps.
- The test surface does not require mocking live S3-compatible APIs. All verification is against the declarative profile layer.

### Risks

- **Overtesting internal structure**: Tests that couple too tightly to the internal shape of provider definitions (field order, exact summary text) may become brittle. Mitigation: test structural invariants and state correctness, not cosmetic details.
- **Coverage gaps for future capabilities**: If a new capability ID is added but degradation tests are not updated, the gap may not be caught. Mitigation: FR-009 requires tests to fail when the catalog grows without matching provider entries.

### Blocking questions

None identified. The provider profile surface and admission-check functions are already implemented and exported. Test coverage can proceed.

---

## 9. Success Metrics

- All advanced capability states (`satisfied`, `partially_satisfied`, `unsatisfied`) are exercised across the provider roster.
- The unavailable-provider fallback is tested for all three error scenarios.
- Capability-gated admission functions are proven to respect the declared state.
- The degradation test suite is fully automated, deterministic, and runs as part of `npm test`.
