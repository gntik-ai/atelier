# Implementation Plan: US-OBS-02-T06 — End-to-End Audit Traceability and Sensitive-Data Protection Verification

**Feature Branch**: `036-audit-traceability-tests`
**Spec**: `specs/036-audit-traceability-tests/spec.md`
**Task**: `US-OBS-02-T06`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

T06 is a pure verification increment. It delivers:

- one machine-readable **audit traceability verification matrix** (YAML),
- a dedicated **e2e test suite** that validates the matrix against the already-published T01–T05 contracts,
- targeted **unit tests** for each invariant category (masking consistency, isolation, permission, trace-state diagnostics),
- documentation updates to close the US-OBS-02 task summary and make the verification baseline discoverable,
- and wiring of the new test suite into the existing `test:e2e:observability` runner.

This increment does **not** add new contracts, new API routes, new emitters, new masking rules, or new correlation surfaces. It only verifies the existing T01–T05 audit chain as a whole.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in the audit story

```text
T01 — common audit pipeline contract
T02 — canonical audit-event envelope (schema + validation)
T03 — bounded audit consultation (query/filter routes)
T04 — export + masking contract
T05 — console-initiated correlation surface
T06 — THIS TASK: end-to-end traceability verification matrix + tests
```

T06 sits above T01–T05 as a verification consumer. It reads their published contracts and schemas; it never modifies them.

### 2.2 Source contracts consumed (read-only)

All of the following already exist and are authoritative:

- `services/internal-contracts/src/observability-audit-pipeline.json` (T01)
- `services/internal-contracts/src/observability-audit-event-schema.json` (T02)
- `services/internal-contracts/src/observability-audit-query-surface.json` (T03)
- `services/internal-contracts/src/observability-audit-export-surface.json` (T04)
- `services/internal-contracts/src/observability-audit-correlation-surface.json` (T05)
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/internal-service-map.json`
- `services/internal-contracts/src/public-route-catalog.json`

The T06 verification matrix and tests read these contracts through the shared accessors already exposed by `services/internal-contracts/src/index.mjs` and the existing `scripts/lib/` helpers. No new `index.mjs` exports are required.

### 2.3 Verification architecture

```text
tests/reference/audit-traceability-matrix.yaml
        ↓ read by
tests/e2e/observability/audit-traceability.test.mjs
        ↓ imports
scripts/lib/audit-traceability.mjs (helper: matrix reader + invariant helpers)
        ↓ cross-checks against
T01–T05 contract readers already in scripts/lib/ + index.mjs accessors
```

Unit invariant tests live separately in `tests/unit/observability-audit-traceability.test.mjs` and exercise the behavioral logic in isolation (masking consistency, scope-rejection, permission combinatorics, trace-state derivation).

### 2.4 Explicit non-goals

This task will not:

- add any new machine-readable contract JSON files under `services/internal-contracts/src/`,
- add new `validate:*` scripts or CLI validators,
- change `services/internal-contracts/src/index.mjs` exports,
- modify T01–T05 contracts, schemas, permissions, masking rules, or route definitions,
- add new API routes to `control-plane.openapi.json`,
- add durable export jobs, replay automation, or case-management infrastructure,
- or add a new validate entry to `validate:repo`.

---

## 3. Verification Matrix Design

### 3.1 New artifact: `tests/reference/audit-traceability-matrix.yaml`

This YAML file is the machine-readable declaration of all T06 verification scenarios. It follows the same structural conventions as `tests/reference/observability-smoke-matrix.yaml`.

Recommended top-level structure:

```yaml
version: 2026-03-28

surface_contracts:
  pipeline: observability_audit_pipeline
  schema: observability_audit_event_schema
  consultation: observability_audit_query_surface
  export: observability_audit_export_surface
  correlation: observability_audit_correlation_surface

shared_expectations:
  required_correlation_statuses:
    - complete
    - partial
    - broken
    - not_found
  required_audit_scopes:
    - tenant
    - workspace
  required_subsystems:
    - iam
    - postgresql
    - mongodb
    - kafka
    - openwhisk
    - storage
    - tenant_control_plane
  required_masking_categories:
    - credential_material
    - provider_locator
  required_audit_permissions:
    - tenant.audit.read
    - tenant.audit.export
    - tenant.audit.correlate
    - workspace.audit.read
    - workspace.audit.export
    - workspace.audit.correlate

verification_scenarios:
  # category: full_chain_traceability
  # category: masking_consistency
  # category: tenant_isolation
  # category: workspace_isolation
  # category: permission_boundary
  # category: trace_state_diagnostics
```

Each scenario declares:

- `id` (format: `TRACE-<CAT>-<NNN>`, e.g. `TRACE-CHAIN-001`)
- `category` (one of the six categories above)
- `priority` (`P1` or `P2`)
- `description`
- `preconditions` (list)
- `actions` (list)
- `expected_outcomes` (list)
- `requirement_refs` (list of RF-OBS-* ids from the spec)
- `contract_surfaces` (list of T01–T05 contract ids exercised)

### 3.2 Scenario coverage per category

#### Full-chain traceability (TRACE-CHAIN-*)

- `TRACE-CHAIN-001`: One multi-subsystem administrative action produces a `complete` correlation trace visible across T03 consultation, T04 export, and T05 correlation — all linked by the same `correlationId`. Requirements: RF-OBS-004, RF-OBS-005, RF-OBS-008.
- `TRACE-CHAIN-002`: An action accepted at the control plane but rejected by a downstream provider produces audit records that reflect the rejection outcome and a `partial` or `broken` correlation trace. Requirements: RF-OBS-004, RF-OBS-008.
- `TRACE-CHAIN-003`: Timeline entries are ordered by `eventTimestamp` and subsystem-attributed consistently across the T05 correlation response. Requirements: RF-OBS-005.

#### Masking consistency (TRACE-MASK-*)

- `TRACE-MASK-001`: A record containing `credential_material` fields is masked identically in T03 consultation, T04 export, and T05 correlation projections. Requirements: RF-OBS-006, RF-OBS-007, RF-OBS-020.
- `TRACE-MASK-002`: A record containing `provider_locator` fields is masked in all three projections without erasing safe, unprotected fields. Requirements: RF-OBS-006, RF-OBS-007.
- `TRACE-MASK-003`: A T05 evidence pointer that references a downstream locator does not expose raw endpoints, object keys, or credentials in any projection. Requirements: RF-OBS-007, RF-OBS-020.
- `TRACE-MASK-004`: A mixed record (some protected, some safe fields) applies selective masking without blanking the full detail block. Requirements: RF-OBS-006.

#### Tenant isolation (TRACE-TENANT-*)

- `TRACE-TENANT-001`: Audit records for tenant A are invisible to tenant B across T03, T04, and T05 surfaces. Requirements: RF-OBS-018.
- `TRACE-TENANT-002`: A tenant-scoped actor for tenant A that requests a `correlationId` belonging to tenant B receives a scope-rejection response and no tenant B data is disclosed. Requirements: RF-OBS-018.

#### Workspace isolation (TRACE-WS-*)

- `TRACE-WS-001`: Workspace-scoped audit operations for workspace W1 return only W1 records and traces; W2 data within the same tenant is invisible. Requirements: RF-OBS-018.
- `TRACE-WS-002`: A workspace-scoped actor for W1 attempting to retrieve a T05 trace for a `correlationId` belonging to W2 receives a `SCOPE_VIOLATION` error. Requirements: RF-OBS-018.

#### Permission boundary (TRACE-PERM-*)

- `TRACE-PERM-001`: An actor with `tenant.audit.read` but without `tenant.audit.correlate` is denied the T05 correlation route while T03 consultation succeeds. Requirements: RF-OBS-004, RF-OBS-005.
- `TRACE-PERM-002`: An actor with `workspace.audit.export` but without `workspace.audit.correlate` is denied T05 correlation while T04 export succeeds. Requirements: RF-OBS-005.
- `TRACE-PERM-003`: An actor with `tenant.audit.correlate` but without `tenant.audit.export` is denied T04 export while T05 correlation succeeds. Requirements: RF-OBS-004, RF-OBS-005.
- `TRACE-PERM-004`: A viewer role with no explicit audit permissions is denied all audit operations (T03, T04, T05). Requirements: RF-OBS-004, RF-OBS-005.

#### Trace-state diagnostics (TRACE-STATE-*)

- `TRACE-STATE-001`: A chain where the initiating console action exists but no downstream evidence is linked produces status `broken` with missing-link diagnostics naming the absent subsystems. Requirements: RF-OBS-008.
- `TRACE-STATE-002`: A chain where downstream evidence exists but the initiating action is not found in scope produces a diagnostic describing the missing root. Requirements: RF-OBS-008.
- `TRACE-STATE-003`: A syntactically valid `correlationId` with no matching records in any subsystem produces status `not_found` with a bounded response. Requirements: RF-OBS-008.
- `TRACE-STATE-004`: A chain where some subsystems have evidence and others do not produces status `partial`, lists participating subsystems, and individually identifies missing links. Requirements: RF-OBS-008.

---

## 4. Artifact-by-Artifact Change Plan

### 4.1 `tests/reference/audit-traceability-matrix.yaml` (new)

Add the machine-readable verification matrix with the structure described in §3. This file drives the T06 e2e test and doubles as traceability documentation.

### 4.2 `scripts/lib/audit-traceability.mjs` (new)

Thin helper library for T06, containing only what is needed to read and validate the matrix. No new contract validation logic — only matrix-reading and cross-reference helpers.

Exports:

- `readAuditTraceabilityMatrix()` — reads `tests/reference/audit-traceability-matrix.yaml` using the shared YAML reader (already available as `readYaml` from `scripts/lib/quality-gates.mjs`)
- `listTraceabilityScenarios(matrix)` — returns all scenario entries
- `listScenariosByCategory(matrix, categoryId)` — returns scenarios filtered by category
- `collectMatrixAlignmentViolations(matrix, contracts)` — deterministic check: all `contract_surfaces` referenced in scenarios exist in the provided contract dependency map; all `requirement_refs` belong to the declared RF-OBS-* set; all `required_correlation_statuses` match T05's published status vocabulary; all `required_audit_permissions` exist in the authorization model

### 4.3 `tests/e2e/observability/audit-traceability.test.mjs` (new)

The main T06 test suite. Pattern follows `tests/e2e/observability/observability-smoke.test.mjs`.

Test groups:

1. **Matrix self-consistency** — reads the matrix via `readAuditTraceabilityMatrix()` and calls `collectMatrixAlignmentViolations()` against the live contract accessors; expects zero violations.
2. **Contract surface coverage** — confirms that each of the six verification categories has at least one scenario; confirms that all RF-OBS-* requirement refs in the spec's FR-011 set are referenced by at least one scenario.
3. **Full-chain traceability** — for each TRACE-CHAIN-* scenario, constructs a minimal fixture using the T05 `traceWorkspaceAuditCorrelation` helper and the T03/T04 shared helpers, then asserts the expected outcomes declared in the matrix:
   - `complete` status when all subsystem links are present
   - `partial` / `broken` status when a link is missing
   - consistent `correlationId` linkage across T03/T04/T05 projections
4. **Masking consistency** — for each TRACE-MASK-* scenario, constructs a minimal record with known protected and safe fields, runs it through T03/T04/T05 projection helpers, and asserts that the same fields are masked in every projection and unprotected fields are preserved.
5. **Tenant isolation** — for each TRACE-TENANT-* scenario, asserts that cross-tenant access attempts produce `SCOPE_VIOLATION` coded errors using T05 helpers; confirms T04 export rejects cross-tenant requests.
6. **Workspace isolation** — mirrors tenant isolation tests with T05 `traceWorkspaceAuditCorrelation` scope-mismatch fixtures.
7. **Permission boundary** — for each TRACE-PERM-* scenario, asserts coded errors when actors lack required permissions. Permission logic is verified by consulting the authorization model directly (checking role → permission membership) rather than instantiating a runtime auth stack.
8. **Trace-state diagnostics** — for each TRACE-STATE-* scenario, constructs a chain with the described gap and asserts status, participating subsystems, and missing-link diagnostics using T05 helpers.

All tests in this file must be runnable with `node --test` without a live runtime environment. Fixtures are constructed in-memory from the published contract schemas and the existing T05 helper behaviors.

### 4.4 `tests/unit/observability-audit-traceability.test.mjs` (new)

Isolated unit coverage for the helper module and key invariants that do not require matrix data:

- `readAuditTraceabilityMatrix` returns a non-null object with a `version` and `verification_scenarios` array.
- `collectMatrixAlignmentViolations` reports a violation when a scenario references a `contract_surface` not in the provided contract map.
- `collectMatrixAlignmentViolations` reports a violation when a `requirement_ref` is outside the permitted RF-OBS-* range.
- Masking consistency helper confirms that T04 `applyAuditExportMasking` and T05 correlation masking both produce `[MASKED]` for `credential_material` categories on the same input record.
- Cross-projection masking: the same protected field masked in T03 consultation projection is also masked in T04 and T05 projections.
- Scope-violation helper correctly identifies tenant/workspace mismatch before any record access.
- Trace-state `not_found` is produced when both `auditRecords` and `downstreamEvents` are empty arrays.

### 4.5 Documentation

Add/update:

- `docs/tasks/us-obs-02.md` — append a T06 section summarizing the delivered verification matrix, scenario categories, coverage evidence, and boundary to future work.
- `docs/reference/architecture/README.md` — no new architecture doc is needed (T06 verifies rather than defines), but the README should reference the traceability matrix location.

### 4.6 `package.json` (no `validate:repo` change required)

The T06 tests are exercised through the existing `test:e2e:observability` and `test:unit` runners, both of which are already wired into `npm test`. No new `validate:*` script is needed because T06 adds no new contract artifact to validate.

---

## 5. Data, Metadata, and Policy Decisions

### 5.1 No new masking rules

The masking categories (`credential_material`, `provider_locator`) and the protected field list come from T01 and T04. T06 tests them but does not add or change any protected-field declaration. If a scenario uncovers a gap in T04/T05 masking, that must be filed as an upstream correction — T06 will remain a failing test until the upstream fix lands.

### 5.2 No new permission declarations

All six audit permissions (`tenant.audit.read`, `tenant.audit.export`, `tenant.audit.correlate`, `workspace.audit.read`, `workspace.audit.export`, `workspace.audit.correlate`) are already declared in the authorization model by T03–T05. T06 verifies them additively but never widens or narrows them.

### 5.3 Fixture construction strategy

T06 tests use in-memory fixture construction (object literals) driven by the T05 correlation helper API (`traceWorkspaceAuditCorrelation`, `traceTenantAuditCorrelation`, `normalizeAuditCorrelationRequest`, `applyAuditExportMasking`) and the T03 query helper. No live database, no live Kafka, no live Keycloak. This keeps the suite consistently runnable in CI without infrastructure dependencies.

### 5.4 Eventual-consistency tolerance

The T06 trace-state test for `partial` status uses fixtures with known present/absent downstream events. It does not depend on timing or ordering behavior. Eventual-consistency latency is outside the scope of this verification increment (as explicitly noted in the spec's open questions).

### 5.5 Traceability matrix as living documentation

The YAML matrix file is the authoritative link between the acceptance scenarios in `spec.md` and the executable tests. Each scenario entry carries `requirement_refs` that map back to RF-OBS-004 through RF-OBS-020. This means the traceability matrix itself is regression-testable: `collectMatrixAlignmentViolations` will fail if a scenario references a requirement outside the declared set.

---

## 6. Test and Validation Strategy

### 6.1 Targeted runners

```bash
# Unit helper + invariant tests
node --test tests/unit/observability-audit-traceability.test.mjs

# Full e2e traceability matrix
node --test tests/e2e/observability/audit-traceability.test.mjs
```

### 6.2 Full suite gates (no changes to validate:repo)

```bash
npm run lint        # already includes validate:repo — no new validator added
npm test            # includes test:unit + test:e2e:observability
```

### 6.3 Test coverage targets

| Category                   | Minimum scenarios | Test file                                       |
|----------------------------|-------------------|-------------------------------------------------|
| Full-chain traceability     | 3 (TRACE-CHAIN)   | `audit-traceability.test.mjs`                   |
| Masking consistency         | 4 (TRACE-MASK)    | `audit-traceability.test.mjs`                   |
| Tenant isolation            | 2 (TRACE-TENANT)  | `audit-traceability.test.mjs`                   |
| Workspace isolation         | 2 (TRACE-WS)      | `audit-traceability.test.mjs`                   |
| Permission boundary         | 4 (TRACE-PERM)    | `audit-traceability.test.mjs`                   |
| Trace-state diagnostics     | 4 (TRACE-STATE)   | `audit-traceability.test.mjs`                   |
| Helper unit tests           | 8+                | `observability-audit-traceability.test.mjs`     |

All RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, and RF-OBS-020 must be referenced by at least one scenario in the matrix (enforced by `collectMatrixAlignmentViolations`).

---

## 7. Risks, Compatibility, Rollback, and Security

### 7.1 Compatibility

All T06 changes are strictly additive:

- no modifications to existing test files, contract files, or helper modules,
- no new `validate:repo` entries,
- no changes to `index.mjs`.

### 7.2 Upstream contract gaps (primary risk)

If any of the T01–T05 contracts contain specification-level inconsistencies not caught by their per-task validators (e.g., masking policy not fully applied to a specific evidence-pointer field type in T05), the T06 test will fail and surface the issue. This is the intended behavior — but it means T06 may require upstream T04/T05 corrections to achieve green CI.

**Mitigation**: Run T06 tests early in the implementation sequence (before writing documentation) so any upstream gaps are surfaced while the branch is still in active development.

### 7.3 Fixture fidelity

Because T06 tests use in-memory fixtures rather than live integration data, there is a risk that a fixture omits a field that the T05 helper now requires. This will be caught immediately when running the test suite but could require minor fixture adjustments as T05 helpers evolve.

**Mitigation**: Read the T05 `traceWorkspaceAuditCorrelation` helper source before writing fixtures to understand its current required input shape.

### 7.4 Rollback posture

Rollback is trivial: T06 adds only new files (`tests/reference/audit-traceability-matrix.yaml`, `scripts/lib/audit-traceability.mjs`, two test files, and doc updates). Reverting these files leaves the T01–T05 baseline intact and restores the previous test suite state.

### 7.5 Security posture

T06 does not introduce any new trust boundaries or permission grants. The masking and isolation invariants it enforces are security-positive. If a T06 test discovers that a protected field leaks through an audit surface, the finding must be treated as a blocking upstream defect — not as a T06 test relaxation.

---

## 8. Recommended Execution Sequence

1. Read T05 helper source (`apps/control-plane/src/observability-audit-correlation.mjs`) and T04 masking helper (`apps/control-plane/src/observability-audit-export.mjs`) to understand current fixture API.
2. Add `tests/reference/audit-traceability-matrix.yaml` with all scenarios and requirement refs.
3. Add `scripts/lib/audit-traceability.mjs` with matrix reader and `collectMatrixAlignmentViolations`.
4. Add `tests/unit/observability-audit-traceability.test.mjs` and run targeted unit tests.
5. Add `tests/e2e/observability/audit-traceability.test.mjs` starting with matrix self-consistency and contract surface coverage groups.
6. Add remaining e2e test groups (full-chain, masking, isolation, permission, trace-state) incrementally, running `node --test` after each group.
7. If any group exposes an upstream T04/T05 contract gap, open a corrective change on the relevant prior task's file before continuing.
8. Update `docs/tasks/us-obs-02.md` and `docs/reference/architecture/README.md`.
9. Run `npm run lint` and `npm test` to confirm the full pipeline is green.
10. Commit, push, open PR on `036-audit-traceability-tests`, monitor CI, address review comments, merge to `main`.

---

## 9. Definition of Done / Expected Evidence

The task is done when all of the following are true:

- `specs/036-audit-traceability-tests/{spec,plan,tasks}.md` are materialized.
- `tests/reference/audit-traceability-matrix.yaml` exists and contains all six scenario categories with RF-OBS-* requirement refs.
- `scripts/lib/audit-traceability.mjs` exists with `readAuditTraceabilityMatrix` and `collectMatrixAlignmentViolations`.
- `tests/unit/observability-audit-traceability.test.mjs` exists and all tests pass.
- `tests/e2e/observability/audit-traceability.test.mjs` exists and all scenario groups pass.
- `collectMatrixAlignmentViolations` returns zero violations against live contract state.
- All RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, and RF-OBS-020 are covered by at least one matrix scenario.
- `docs/tasks/us-obs-02.md` documents T06 outcomes.
- `npm run lint` passes.
- `npm test` passes with all T06 tests green.
- the branch is committed, pushed, reviewed via PR, CI is green, and the change is merged to `main`.
