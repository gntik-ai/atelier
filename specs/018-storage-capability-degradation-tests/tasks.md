# Tasks: US-STO-02-T06 — Storage Capability Degradation Tests

**Input**: `specs/018-storage-capability-degradation-tests/spec.md`, `specs/018-storage-capability-degradation-tests/plan.md`  
**Feature Branch**: `018-storage-capability-degradation-tests`

## Phase 1 — Canonical capability verification

- [x] T001 Extend `tests/adapters/provider-catalog.test.mjs` to verify every supported provider publishes the full canonical capability catalog with valid state vocabulary and stable entry shape.
- [x] T002 Extend `tests/adapters/provider-catalog.test.mjs` to derive expected manifest booleans from capability details and assert exact manifest/detail consistency for each provider.
- [x] T003 Extend `tests/adapters/provider-catalog.test.mjs` to verify advanced state coverage across the provider roster (`satisfied`, `partially_satisfied`, `unsatisfied`) and validate limitation references against `storageProviderCapabilityIds`.

## Phase 2 — Degradation and fallback behavior

- [x] T004 Extend `tests/adapters/provider-catalog.test.mjs` to verify missing, ambiguous, and unknown provider selection each return a stable unavailable profile with all capabilities present, all states `unsatisfied`, all booleans `false`, and baseline ineligible.
- [x] T005 Extend `tests/adapters/storage-event-notifications.test.mjs` to verify Garage/event-notification evaluation degrades predictably with `allowed: false`, zero matches, and a capability-not-available explanation.
- [x] T006 Tighten `tests/adapters/storage-multipart-presigned.test.mjs` only if needed so unsatisfied multipart capability checks assert stable denial semantics and capability-state reporting.

## Phase 3 — Summary and contract regression coverage

- [x] T007 Extend `tests/unit/storage-admin.test.mjs` to verify cross-provider structural consistency and unavailable-fallback stability through storage-admin summary/introspection helpers.
- [x] T008 Extend `tests/contracts/storage-provider.contract.test.mjs` to assert additive contract-level stability for capability detail completeness, manifest boolean fallback behavior, and canonical entry fields.

## Phase 4 — Verification

- [x] T009 Run targeted storage capability test suites for adapters, unit summaries, and contracts; fix any deterministic regressions.
- [x] T010 Run `npm test`; fix any follow-on regressions before preparing the branch for push/PR/CI.
