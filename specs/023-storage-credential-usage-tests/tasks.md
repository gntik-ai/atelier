# Tasks: US-STO-03-T05 — Storage Credential Rotation/Revocation and Usage Reporting Tests

**Input**: `specs/023-storage-credential-usage-tests/spec.md`
**Feature Branch**: `023-storage-credential-usage-tests`
**Task**: US-STO-03-T05

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/023-storage-credential-usage-tests/spec.md` with a focused verification-oriented specification for credential lifecycle and usage reporting tests.
- [x] T002 Materialize `specs/023-storage-credential-usage-tests/plan.md` with the implementation approach, verification strategy, and delivery flow.
- [x] T003 Materialize `specs/023-storage-credential-usage-tests/tasks.md` and keep it aligned with the actual implementation delta.

## Phase 2 — Credential lifecycle coverage

- [x] T004 Extend adapter tests in `tests/adapters/storage-programmatic-credentials.test.mjs` to verify rotation preserves identity, principal, scope, and secret safety while advancing secret material and timestamps.
- [x] T005 Extend adapter or unit coverage to verify revocation produces a deterministic non-active credential representation that remains traceable and secret-safe.
- [x] T006 Add or extend control-plane preview coverage in `tests/unit/storage-admin.test.mjs` to verify the storage admin credential routes continue to expose correct issuance, rotation, and revocation surfaces.
- [x] T007 If needed, harden `services/adapters/src/storage-programmatic-credentials.mjs` so unsafe lifecycle transitions are rejected rather than silently reactivating compromised credentials.

## Phase 3 — Usage reporting coverage

- [x] T008 Extend `tests/adapters/storage-usage-reporting.test.mjs` to cover threshold behavior and deterministic ranking in adapter-level usage helpers.
- [x] T009 Extend `tests/unit/storage-usage-reporting.test.mjs` to cover degraded collection states, cached snapshots, and cross-scope consistency.
- [x] T010 Extend `tests/unit/storage-admin.test.mjs` to verify workspace / tenant / bucket / cross-tenant usage previews remain route-correct, additive, and audit-safe.

## Phase 4 — Verification and delivery

- [x] T011 Run targeted test suites for the touched storage credential and usage modules.
- [x] T012 Run broader repo validation only if required by the delta.
- [ ] T013 Commit the task branch with a focused message for US-STO-03-T05.
- [ ] T014 Push `023-storage-credential-usage-tests` to `origin`.
- [ ] T015 Open a PR from `023-storage-credential-usage-tests` to `main`.
- [ ] T016 Monitor CI, fix any deterministic failures, and update the branch until checks are green.
- [ ] T017 Merge the PR to `main` once green.
- [ ] T018 Update orchestrator state files with the completed unit and next pending backlog item.
