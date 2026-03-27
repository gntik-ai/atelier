# Implementation Plan: US-STO-01-T06 — Multi-Provider Storage Verification Suite

**Feature Branch**: `012-storage-provider-verification`
**Spec**: `specs/012-storage-provider-verification/spec.md`
**Task**: US-STO-01-T06
**Epic**: EP-12 — Storage S3-compatible
**Status**: Ready for implementation
**Created**: 2026-03-27

---

## 1. Scope Summary

This task creates a multi-provider storage verification suite that proves provider independence for the platform's S3-compatible storage surface. It does **not** add new storage capabilities; it verifies the behaviour delivered by T01–T05 across at least two providers (primary: MinIO, alternate: Garage or Ceph RGW).

The suite produces a structured, machine-readable verification report, validates the error taxonomy, checks the capability baseline, and asserts multi-tenant isolation — all through the platform's own abstraction layer (never via direct provider access).

---

## 2. Dependency Map

| Prior task | Spec | Adapter module | What this task consumes |
|---|---|---|---|
| T01 — Provider abstraction | `007` | `storage-provider-profile.mjs` | `buildStorageProviderProfile`, `buildStorageCapabilityBaseline`, `buildStorageCapabilityDetails`, `SUPPORTED_STORAGE_PROVIDER_TYPES` |
| T02 — Tenant context | `008` | `storage-tenant-context.mjs` | `buildTenantStorageContextRecord`, `previewWorkspaceStorageBootstrap`, `rotateTenantStorageContextCredential` |
| T03 — Bucket/object ops | `009` | `storage-bucket-object-ops.mjs` | `buildStorageBucketRecord`, `buildStorageObjectRecord`, `previewStorageObjectUpload/Download/Deletion`, `buildStorageMutationEvent` |
| T04 — Logical organization | `010` | `storage-logical-organization.mjs` | `buildStorageLogicalOrganization`, `buildStorageObjectOrganization`, `isStorageReservedPrefix` |
| T05 — Error taxonomy + baseline | `011` | `storage-error-taxonomy.mjs` | `buildNormalizedStorageError`, `buildStorageErrorEnvelope`, `buildStorageErrorAuditEvent`, `STORAGE_NORMALIZED_ERROR_CODES`, `STORAGE_ERROR_RETRYABILITY` |
| Public API contract | current | `storage-provider.contract.test.mjs` | OpenAPI schema shapes for report serialization |

All five upstream adapters are already present in `services/adapters/src/`. The `provider-catalog.mjs` re-exports all public surfaces used here.

---

## 3. New Artifacts

### 3.1 Core verification module

**`services/adapters/src/storage-provider-verification.mjs`**

Pure functional module (no I/O). Exports:

```text
buildVerificationRun(input) → VerificationRunRecord
buildVerificationScenario(input) → VerificationScenarioRecord
buildVerificationResult(input) → VerificationResultRecord
buildVerificationReport(input) → VerificationReport
buildCrossProviderEquivalenceAssessment(input) → EquivalenceAssessment
buildCapabilityBaselineVerificationResult(input) → BaselineVerificationResult
buildErrorTaxonomyConsistencyResult(input) → TaxonomyConsistencyResult
buildTenantIsolationVerificationResult(input) → IsolationVerificationResult
classifyVerificationFailure(result) → 'deterministic' | 'transient'
summarizeVerificationReport(report) → VerificationReportSummary
VERIFICATION_SCENARIO_CATEGORIES  (frozen catalog)
VERIFICATION_FAILURE_TYPES        (frozen catalog)
VERIFICATION_VERDICT               (frozen catalog: 'pass' | 'fail' | 'partial')
```

Design constraints:
- All builders are pure (take inputs, return frozen objects). No side-effects.
- All inputs that could expose provider credentials must be sanitized using the same redaction logic as `storage-error-taxonomy.mjs` (`[redacted-url]`, `[redacted]`).
- `buildVerificationRun` accepts a `providerSet` array of provider config objects and produces a structured run record with `runId`, `startedAt`, `configuration`, and an initial empty `scenarios` array.
- `buildVerificationReport` aggregates scenario results into per-provider verdicts and a cross-provider equivalence assessment per operation.
- `classifyVerificationFailure` marks a result as `deterministic` if the same scenario fails consistently in the run; `transient` if it failed at least once and later passed on retry. This information is carried in `VerificationResultRecord.failureType`.
- No `VerificationReport` field exposes raw provider credentials, internal endpoints, or secret references.

### 3.2 Provider-catalog re-exports

**`services/adapters/src/provider-catalog.mjs`** — additive exports only (no breaking changes):

```js
export function buildStorageVerificationRun(input) { ... }
export function buildStorageVerificationReport(input) { ... }
export function buildStorageVerificationScenario(input) { ... }
export function buildCrossProviderEquivalenceAssessment(input) { ... }
export function summarizeStorageVerificationReport(input) { ... }
export const storageVerificationScenarioCategories
export const storageVerificationFailureTypes
export const storageVerificationVerdicts
```

### 3.3 Unit test

**`tests/unit/storage-verification.test.mjs`**

Covers:
1. `buildVerificationRun` — correct structure for single-provider and two-provider inputs; run IDs are unique (timestamp-based); no credential leakage.
2. `buildVerificationScenario` — all required scenario categories produce a structurally valid scenario record; scenario IDs are stable given same inputs.
3. `buildVerificationResult` — pass/fail recording for each scenario category; `failureType` is `deterministic` vs `transient` correctly classified.
4. `buildVerificationReport` — aggregates results into per-provider verdicts; `crossProviderEquivalenceAssessments` identifies divergence when providers produce different normalized error codes for the same scenario.
5. `buildCapabilityBaselineVerificationResult` — correctly reads `buildStorageCapabilityBaseline` output; marks eligible/ineligible providers.
6. `buildErrorTaxonomyConsistencyResult` — asserts that all five required error codes from FR-003 produce identical `httpStatus` and `retryability` when fed the same normalized error inputs for two providers.
7. `buildTenantIsolationVerificationResult` — cross-tenant access attempt records produce a denial result with the correct normalized error code; listing exclusion is captured.
8. `summarizeVerificationReport` — idempotent and safe to call on any partial report; credential fields do not appear in `JSON.stringify` output.
9. `VERIFICATION_SCENARIO_CATEGORIES` contains at least all FR-002 operation categories plus the three verification areas (taxonomy, baseline, isolation).
10. Boundary scenario: report with one passing and one failing provider → verdict is `partial` for the failing provider and `pass` for the passing provider.

### 3.4 Adapter integration test

**`tests/adapters/storage-provider-verification.test.mjs`**

Validates that the `provider-catalog.mjs` re-exports are consistent with the `storage-provider-verification.mjs` contracts and that both known providers (MinIO, Garage) produce structurally valid output from every builder. Uses static fixtures — no live provider connections.

Covers:
1. Both `minio` and `garage` (and `ceph-rgw`) profiles pass `buildCapabilityBaselineVerificationResult` as `eligible: true`.
2. A fabricated provider with missing required capabilities (e.g., `object.list.pagination.deterministic: false`) produces a baseline result with `eligible: false` and a non-empty `missingCapabilities` list.
3. Error taxonomy consistency check across `minio` and `garage` produces a `consistent: true` result for all five required error codes (OBJECT_NOT_FOUND, BUCKET_NOT_FOUND, BUCKET_ALREADY_EXISTS, STORAGE_ACCESS_DENIED, STORAGE_INVALID_REQUEST).
4. Cross-provider divergence scenario: inject a modified error definition where one provider returns HTTP 403 for OBJECT_NOT_FOUND instead of 404 → equivalence assessment correctly identifies this divergence.
5. `buildVerificationReport` produces a `runId`, `startedAt`, `providers`, and `verdict` top-level fields.
6. `summarizeStorageVerificationReport` does not include any field matching `secret://` patterns.

### 3.5 Verification scenario matrix document

**`tests/e2e/storage-provider-verification/README.md`**

Static markdown matrix (modelled after `tests/e2e/postgresql-tenant-isolation/README.md`) that enumerates all required verification scenarios. This serves as the canonical checklist for future live-provider test automation.

Structure:
- Section 1: Functional Equivalence Scenarios (FR-002 operations)
- Section 2: Error Taxonomy Consistency Scenarios (FR-003 error codes)
- Section 3: Capability Baseline Validation Scenarios (FR-004)
- Section 4: Multi-Tenant Isolation Scenarios (FR-005/FR-006)
- Section 5: Operational Hygiene & Boundary Scenarios (FR-010 to FR-014)
- Evidence expectations per scenario (same format as postgresql-tenant-isolation)
- Review triggers

### 3.6 Contract test extension

**`tests/contracts/storage-provider.contract.test.mjs`** — additive assertions only:

Add a new `test('storage verification report schema is additive and structurally valid', ...)` block that:
- Imports from `storage-provider-verification.mjs` to verify that `buildVerificationReport` with dummy inputs produces an object matching the expected shape (not via OpenAPI — via structural assertion).
- Asserts that `VerificationReport` always contains: `runId`, `startedAt`, `providers` (array), `scenarioResults` (array), `crossProviderEquivalenceAssessments` (array), `errorTaxonomyConsistencyResults`, `capabilityBaselineResults`, `tenantIsolationResults`, `verdicts` (map keyed by providerType), `overallVerdict`.
- Asserts that `overallVerdict` is one of `VERIFICATION_VERDICT` values.

---

## 4. Verification Report Shape

```text
VerificationReport {
  runId: string                          // uuid or timestamp-based deterministic ID
  startedAt: string                      // ISO 8601
  completedAt: string                    // ISO 8601
  configuration: {
    providers: ProviderConfig[]          // providerType only; no credentials
    scenarioCategories: string[]
    mode: 'full' | 'single-provider' | 'regression'
  }
  scenarioResults: VerificationScenarioResult[]  // per-scenario, per-provider
  crossProviderEquivalenceAssessments: EquivalenceAssessment[]
  errorTaxonomyConsistencyResults: TaxonomyConsistencyResult[]
  capabilityBaselineResults: BaselineVerificationResult[]
  tenantIsolationResults: IsolationVerificationResult[]
  verdicts: { [providerType: string]: 'pass' | 'fail' | 'partial' }
  overallVerdict: 'pass' | 'fail' | 'partial'
  divergences: DivergenceRecord[]        // only populated when providers disagree
}

VerificationScenarioResult {
  scenarioId: string
  category: string                       // one of VERIFICATION_SCENARIO_CATEGORIES
  providerType: string
  operation: string
  status: 'passed' | 'failed' | 'skipped'
  failureType?: 'deterministic' | 'transient'   // present when status='failed'
  expectedOutcome: string
  actualOutcome?: string                 // present when status='failed'
  retryCount: number
  observedAt: string
}

EquivalenceAssessment {
  operation: string
  equivalent: boolean
  providers: string[]
  divergences?: DivergenceRecord[]
}

DivergenceRecord {
  operation: string
  scenarioId: string
  expectedOutcome: string
  providerResults: { providerType: string; actualOutcome: string }[]
}

BaselineVerificationResult {
  providerType: string
  eligible: boolean
  version: string
  checkedAt: string
  satisfiedCapabilities: string[]
  missingCapabilities: string[]
  insufficientCapabilities: CapabilityGap[]
}

TaxonomyConsistencyResult {
  errorCode: string
  consistent: boolean
  providerResults: {
    providerType: string
    httpStatus: number
    retryability: string
    normalizedCode: string
  }[]
}

IsolationVerificationResult {
  providerType: string
  scenario: string                       // e.g. 'cross-tenant-bucket-access', 'listing-exclusion'
  tenantA: string                        // anonymized tenant ref only
  tenantB: string
  passed: boolean
  denialErrorCode?: string
  observedAt: string
}
```

No field in any report type may contain raw credential material, provider-internal endpoints, or `secret://` references. Validation of this is covered by unit test #8 and adapter test #6.

---

## 5. Scenario Categories (VERIFICATION_SCENARIO_CATEGORIES)

The catalog must include at minimum:

**Functional equivalence (FR-002)**
- `bucket.create`
- `bucket.delete`
- `bucket.list`
- `object.put`
- `object.get`
- `object.delete`
- `object.list`
- `object.metadata.get`
- `object.conditional.if_match`
- `object.conditional.if_none_match`
- `object.list.pagination`
- `object.content_type.preserve`
- `object.integrity.etag_or_checksum`

**Error taxonomy (FR-003)**
- `error.object_not_found`
- `error.bucket_not_found`
- `error.bucket_already_exists`
- `error.access_denied`
- `error.invalid_request`

**Capability baseline (FR-004)**
- `capability.baseline.validation`

**Multi-tenant isolation (FR-005/FR-006)**
- `isolation.cross_tenant_bucket_access`
- `isolation.listing_exclusion`

**Boundary (FR-013/FR-014)**
- `boundary.large_object_upload`
- `boundary.pagination_multi_page`

---

## 6. Provider Fixtures

Both unit and adapter integration tests use static fixtures derived from the existing `buildStorageProviderProfile` output for `minio` and `garage`. No live provider connections are needed in unit/adapter layers.

**MinIO fixture** (`minio`):
- `providerType: 'minio'`
- All required baseline capabilities: `satisfied`
- Optional capabilities: `presignedUrls: satisfied`, `multipartUpload: satisfied`, `objectVersioning: partially_satisfied`

**Garage fixture** (`garage`):
- `providerType: 'garage'`
- All required baseline capabilities: `satisfied`
- Optional capabilities may differ from MinIO (informational divergence — not a failure)

**Negative fixture** (synthetic, no providerType in the supported catalog):
- Missing `object.list.pagination.deterministic` → produces `eligible: false` in baseline result
- Used only for negative-path tests

Fixtures are declared inline in each test file (not in a separate shared file) to keep test context self-contained and avoid cross-test coupling. Pattern mirrors `tests/adapters/provider-catalog.test.mjs`.

---

## 7. Verification Strategy

### Layer 1 — Unit (`tests/unit/storage-verification.test.mjs`)

- Pure builders, verdict logic, equivalence assessment, divergence recording
- All scenarios static, hermetic, no imports beyond the module under test and `node:assert`
- Runtime: `node --test tests/unit/storage-verification.test.mjs`

### Layer 2 — Adapter integration (`tests/adapters/storage-provider-verification.test.mjs`)

- Validates `provider-catalog.mjs` re-exports against both known provider profiles
- Imports from `provider-catalog.mjs` only (as all other adapter tests do)
- Runtime: `node --test tests/adapters/storage-provider-verification.test.mjs`

### Layer 3 — Contract (`tests/contracts/storage-provider.contract.test.mjs`)

- Additive block asserting verification report structural shape (no live deps)
- Runtime: existing contract test suite

### Layer 4 — E2E scenario matrix (`tests/e2e/storage-provider-verification/README.md`)

- Static document only for this task
- Live execution deferred to a future task that wires live provider adapters (Docker/Kubernetes)
- The README defines the exact scenario IDs, expected outcomes, and evidence expectations that must be automated when live providers are available

### Not in scope for this task

- Browser (Playwright) flows
- Kafka event assertions
- Helm chart changes
- Live HTTP calls to any provider

---

## 8. CI / Runtime Constraints

- All new tests in `tests/unit/` and `tests/adapters/` must pass with `node --test` (Node.js built-in test runner, already used by the project).
- No new test dependencies. No `vitest`, `jest`, or `mocha` — the project uses `node:test` + `node:assert/strict` exclusively.
- No network calls in unit or adapter tests. Fixtures are pure in-memory objects.
- The contract test block must not require a running server (existing pattern: static fixture + structural assertion only).
- All new test files must follow the existing ESM-first pattern (`.mjs` extension, `import` not `require`, no top-level `require()`).
- New source file (`storage-provider-verification.mjs`) must be placed under `services/adapters/src/` and follow the existing frozen-export pattern (all returned objects passed through `Object.freeze` or equivalent).

---

## 9. Rollback / Idempotency

This task is additive only:
- New source module: `services/adapters/src/storage-provider-verification.mjs`
- Additive exports to `services/adapters/src/provider-catalog.mjs`
- New test files (no modification to existing tests other than the additive contract test block)
- New static document

**Rollback**: Remove new files and revert the additive exports from `provider-catalog.mjs`. No schema migrations, no Helm changes, no persistent state changes.

**Idempotency**: The verification module's builders are pure functions. Running them multiple times with the same input produces the same output. The e2e matrix README documents the cleanup requirement (FR-010) that future live implementations must satisfy.

---

## 10. Security and Credential Safety

- `buildVerificationReport` and all nested result builders must apply the same redaction rules as `buildStorageInternalErrorRecord` in `storage-error-taxonomy.mjs`:
  - Replace any string matching `https?://[^\s]+` with `[redacted-url]`
  - Replace any string matching `secret://[^\s]+` with `[redacted-secret]`
  - Replace credential key patterns (`accessKey=*`, `sessionKey=*`, `password=*`) with `[redacted]`
- Provider identity in the report uses `providerType` only (e.g., `'minio'`, `'garage'`) — never raw endpoint URLs.
- Verification tenant contexts in tests use the `tctx-` namespace prefix convention and non-production tenant IDs (`ten_01verify*`).
- No test or builder should accept raw credential objects in its public interface. Provider inputs pass only `{ providerType: string }` or a structured `ProviderConfig` that omits secrets.

---

## 11. Observability and Audit Integration

- `buildVerificationReport` must include a `correlationId` field (optional input, auto-generated if not provided) that allows CI pipeline runs to be traced in the platform's audit pipeline.
- The `runId` field serves as the idempotency key for report archiving.
- A `buildStorageVerificationAuditEvent` helper should be exported from `storage-provider-verification.mjs` and used in `provider-catalog.mjs` to allow the verification run's start and completion to emit audit-compatible events (same shape as `buildStorageOperationEvent` from T03).
- The audit event type is `storage.verification.completed` with `overallVerdict`, `providersCount`, and `scenarioCount` as the payload summary.

---

## 12. Divergence Between OQ-001 and OQ-002

Both open questions from the spec should be resolved at implementation time:

**OQ-001 (qualification mode vs regression mode)**:
Resolve with a `mode` field in `buildVerificationRun` input. Accept `'full'` (all scenarios), `'regression'` (baseline scenarios only: bucket CRUD, object CRUD, error taxonomy). Default is `'full'`. This is a pure config field — no branching logic required in the report builders.

**OQ-002 (timing data)**:
Include an optional `durationMs` field in `VerificationScenarioResult`. Present only when the scenario was actually executed (not in static fixture tests). This adds zero complexity to pure builders (they accept it as an optional input) and gives operators useful baseline data.

---

## 13. Done Criteria

All of the following must be true before this task is considered complete:

| # | Criterion | Evidence |
|---|---|---|
| DC-01 | `services/adapters/src/storage-provider-verification.mjs` exists and exports all required builders and catalogs | File present, all named exports resolvable |
| DC-02 | `services/adapters/src/provider-catalog.mjs` exposes `buildStorageVerificationRun`, `buildStorageVerificationReport`, `buildStorageVerificationScenario`, `buildCrossProviderEquivalenceAssessment`, `summarizeStorageVerificationReport`, and the three catalog constants | `provider-catalog.test.mjs` and `storage-provider-verification.test.mjs` import and assert them |
| DC-03 | `tests/unit/storage-verification.test.mjs` passes with `node --test` covering all 10 unit test scenarios | `node --test tests/unit/storage-verification.test.mjs` exits 0 |
| DC-04 | `tests/adapters/storage-provider-verification.test.mjs` passes with `node --test` covering both known providers and the negative baseline fixture | `node --test tests/adapters/storage-provider-verification.test.mjs` exits 0 |
| DC-05 | Additive block in `tests/contracts/storage-provider.contract.test.mjs` passes without modifying any existing assertion | Full contract suite exits 0 |
| DC-06 | `tests/e2e/storage-provider-verification/README.md` exists with all five scenario sections and evidence expectations | File present and complete |
| DC-07 | No credential material, endpoint URLs, or `secret://` references appear in `JSON.stringify` of any report produced by the builders | Asserted in unit test #8 and adapter test #6 |
| DC-08 | Both MinIO and Garage profiles pass `buildCapabilityBaselineVerificationResult` with `eligible: true` | Asserted in adapter test #1 |
| DC-09 | Error taxonomy consistency check for all five FR-003 error codes returns `consistent: true` for MinIO vs Garage | Asserted in adapter test #3 |
| DC-10 | No existing tests are broken (no modifications to existing passing assertions) | Full test suite passes |

---

## 14. Recommended Implementation Sequence

1. **`storage-provider-verification.mjs`** — write all pure builders and catalogs; test inline with a scratch harness.
2. **`tests/unit/storage-verification.test.mjs`** — write all 10 unit tests against the new module; confirm all pass.
3. **`provider-catalog.mjs` additive exports** — wire re-exports; confirm existing `provider-catalog.test.mjs` still passes.
4. **`tests/adapters/storage-provider-verification.test.mjs`** — write adapter integration tests; confirm pass.
5. **Contract test block** — add additive assertion block to `storage-provider.contract.test.mjs`; confirm full contract suite passes.
6. **`tests/e2e/storage-provider-verification/README.md`** — write the scenario matrix document.
7. Final: run full test suite from repo root to confirm no regressions.

No step requires a live provider, Docker, or Kubernetes. All steps can run in a standard Node.js 22 environment (matching existing `node --test` runner usage in the project).

---

## 15. Parallelization Notes

Steps 1–2 are serial (2 depends on 1). Steps 3–5 can be developed in parallel once step 1 is stable. Step 6 is independent and can be written at any point. Step 7 is the final gate.
