# Implementation Plan: US-STO-03-T05 — Storage Credential Rotation/Revocation and Usage Reporting Tests

**Branch**: `023-storage-credential-usage-tests` | **Date**: 2026-03-28 | **Spec**: `specs/023-storage-credential-usage-tests/spec.md`
**Task**: US-STO-03-T05 | **Epic**: EP-12 — Storage S3-compatible
**Requirements traceability**: RF-STO-015, RF-STO-016, RF-STO-017, RF-STO-018

---

## Summary

This task is a verification-focused slice that strengthens the operational safety net around two already-delivered capabilities:

1. **Scoped programmatic storage credentials** from `specs/019-storage-scoped-access-credentials/`
2. **Storage usage reporting** from `specs/020-storage-usage-reporting/`

The implementation will stay deliberately small:

- materialize the repo-local Spec Kit artifacts for task 023,
- add targeted adapter/unit/control-plane tests for credential rotation and revocation,
- add targeted usage-reporting tests covering additive consistency, thresholds, degraded collection, and ranking,
- introduce only the minimal production hardening needed to satisfy the new tests.

---

## Technical Context

**Language / Runtime**: Node.js ESM (`.mjs`) with `node --test` and `node:assert/strict`.
**Primary modules in scope**:
- `services/adapters/src/storage-programmatic-credentials.mjs`
- `services/adapters/src/storage-usage-reporting.mjs`
- `apps/control-plane/src/storage-admin.mjs`

**Primary test files in scope**:
- `tests/adapters/storage-programmatic-credentials.test.mjs`
- `tests/adapters/storage-usage-reporting.test.mjs`
- `tests/unit/storage-usage-reporting.test.mjs`
- `tests/unit/storage-admin.test.mjs`

**Constraints**:
- No new dependencies.
- Preserve deterministic fixtures and timestamps.
- Keep production-code changes localized and small.
- Respect multi-tenant isolation and secret-safe outputs.

---

## Planned Changes

### 1. Spec artifacts

Materialize the current scaffolded repo-local Spec Kit files:
- `specs/023-storage-credential-usage-tests/spec.md`
- `specs/023-storage-credential-usage-tests/plan.md`
- `specs/023-storage-credential-usage-tests/tasks.md`

### 2. Credential lifecycle hardening and tests

Focus on behavior that matters operationally:
- rotation preserves credential identity, workspace scope, principal, and allowed actions,
- rotation issues fresh secret material and advances rotation metadata,
- revocation produces a non-active representation with deterministic timestamps,
- unsafe lifecycle transitions are not silently accepted if they would undermine the security model.

Likely touchpoints:
- adapter tests for pure lifecycle helpers,
- control-plane preview tests for route wiring and secret-safe envelopes,
- minimal source hardening if tests expose an unsafe transition.

### 3. Usage reporting tests

Add or extend tests for:
- additive consistency across bucket/workspace/tenant composition,
- warning / critical / over-quota threshold behavior,
- degraded collection states (`provider_unavailable`, cached snapshot, partial),
- deterministic ranking for bucket and cross-tenant views,
- audit-event safety for usage preview helpers.

### 4. Verification and delivery

Run targeted tests first, then broader repo validation as needed. After green validation:
- commit on `023-storage-credential-usage-tests`,
- push branch,
- open PR to `main`,
- monitor CI and fix any failing checks,
- merge once green and update orchestrator state.

---

## Implementation Notes

### Credential lifecycle decisions

The tests should encode the safest behavior compatible with the current story intent. If the current implementation allows a revoked or expired credential to be rotated back into an active state implicitly, the plan prefers closing that loophole unless a sibling spec explicitly requires it.

### Usage-reporting decisions

The tests should validate behavior, not incidental object layout. Assertions should focus on:
- scope,
- totals,
- thresholds,
- degradation semantics,
- ranking order,
- audit-safe payloads.

---

## Verification Strategy

1. Run the directly affected test files with `node --test`.
2. Run `npm test` only if targeted suites pass and the delta touches shared behavior.
3. Use GitHub PR checks as the final gate before merge.

---

## Risks

- Over-constraining current implementation details could create brittle tests.
- A lifecycle hardening change may surface latent assumptions in existing tests.
- CI could expose unrelated pre-existing flakiness; if so, fix only what blocks this branch or document a real external blocker.

---

## Exit Condition

This unit is complete when the branch contains materialized spec artifacts, the new tests are merged into `main`, CI is green, and the orchestrator state advances to the next backlog item.
