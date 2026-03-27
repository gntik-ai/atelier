# Tasks: Multi-Provider Storage Verification Suite

**Input**: `specs/012-storage-provider-verification/spec.md`, `specs/012-storage-provider-verification/plan.md`  
**Task**: US-STO-01-T06  
**Branch**: `012-storage-provider-verification`

## Sequential execution plan

- [x] T001 Write `specs/012-storage-provider-verification/spec.md` with the bounded T06 feature specification.
- [x] T002 Write `specs/012-storage-provider-verification/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/012-storage-provider-verification/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-provider-verification.mjs` with all pure functional builders and frozen catalog constants:
  - `buildVerificationRun(input)` — produces a `VerificationRunRecord` with `runId`, `startedAt`, `configuration` (providerType-only, no credentials), and empty `scenarios` array; accepts optional `correlationId` and `mode` (`'full'` | `'regression'` | `'single-provider'`).
  - `buildVerificationScenario(input)` — produces a `VerificationScenarioRecord` keyed by `scenarioId`, `category` (must be a member of `VERIFICATION_SCENARIO_CATEGORIES`), `providerType`, and `operation`.
  - `buildVerificationResult(input)` — produces a `VerificationResultRecord` with `status` (`'passed'` | `'failed'` | `'skipped'`), optional `failureType` (`'deterministic'` | `'transient'`), `expectedOutcome`, optional `actualOutcome`, `retryCount`, `observedAt`, and optional `durationMs`.
  - `buildVerificationReport(input)` — aggregates `VerificationScenarioResult[]` into per-provider verdicts, `crossProviderEquivalenceAssessments`, `errorTaxonomyConsistencyResults`, `capabilityBaselineResults`, `tenantIsolationResults`, `divergences`, and `overallVerdict`; applies credential-redaction rules (replace `https?://[^\s]+` → `[redacted-url]`, `secret://[^\s]+` → `[redacted-secret]`, `accessKey=*`/`sessionKey=*`/`password=*` → `[redacted]`).
  - `buildCrossProviderEquivalenceAssessment(input)` — compares operation outcomes across providers; sets `equivalent: false` and populates `divergences` when any provider's outcome differs.
  - `buildCapabilityBaselineVerificationResult(input)` — consumes a `buildStorageCapabilityBaseline` output; produces `eligible: true/false`, `satisfiedCapabilities[]`, `missingCapabilities[]`, `insufficientCapabilities[]`.
  - `buildErrorTaxonomyConsistencyResult(input)` — compares normalized error envelopes from two or more providers for the same error code; sets `consistent: true/false`; records per-provider `httpStatus`, `retryability`, and `normalizedCode`.
  - `buildTenantIsolationVerificationResult(input)` — records cross-tenant isolation scenario outcomes (cross-tenant bucket access, listing exclusion) with anonymized tenant references and `denialErrorCode`.
  - `classifyVerificationFailure(result)` — returns `'deterministic'` if the scenario failed consistently across all retries; `'transient'` if it failed at least once but later passed.
  - `summarizeVerificationReport(report)` — returns a concise summary object (counts, overall verdict, divergence list); safe for `JSON.stringify` (no credential fields).
  - `buildStorageVerificationAuditEvent(input)` — produces an audit event with type `storage.verification.completed`, payload summary `{ overallVerdict, providersCount, scenarioCount }`, and optional `correlationId`; mirrors the shape of `buildStorageOperationEvent` from `storage-bucket-object-ops.mjs`.
  - `VERIFICATION_SCENARIO_CATEGORIES` — frozen catalog containing at minimum: `bucket.create`, `bucket.delete`, `bucket.list`, `object.put`, `object.get`, `object.delete`, `object.list`, `object.metadata.get`, `object.conditional.if_match`, `object.conditional.if_none_match`, `object.list.pagination`, `object.content_type.preserve`, `object.integrity.etag_or_checksum`, `error.object_not_found`, `error.bucket_not_found`, `error.bucket_already_exists`, `error.access_denied`, `error.invalid_request`, `capability.baseline.validation`, `isolation.cross_tenant_bucket_access`, `isolation.listing_exclusion`, `boundary.large_object_upload`, `boundary.pagination_multi_page`.
  - `VERIFICATION_FAILURE_TYPES` — frozen catalog: `{ DETERMINISTIC: 'deterministic', TRANSIENT: 'transient' }`.
  - `VERIFICATION_VERDICT` — frozen catalog: `{ PASS: 'pass', FAIL: 'fail', PARTIAL: 'partial' }`.
  - All returned objects must be passed through `Object.freeze`; no I/O, no side-effects.
  - Credential redaction must be applied to every string field before the object is frozen.
- [x] T011 Extend `services/adapters/src/provider-catalog.mjs` with additive re-exports from `storage-provider-verification.mjs`:
  - `buildStorageVerificationRun`
  - `buildStorageVerificationReport`
  - `buildStorageVerificationScenario`
  - `buildCrossProviderEquivalenceAssessment`
  - `summarizeStorageVerificationReport`
  - `buildStorageVerificationAuditEvent`
  - `storageVerificationScenarioCategories` (re-export of `VERIFICATION_SCENARIO_CATEGORIES`)
  - `storageVerificationFailureTypes` (re-export of `VERIFICATION_FAILURE_TYPES`)
  - `storageVerificationVerdicts` (re-export of `VERIFICATION_VERDICT`)
  - Do not modify or remove any existing export.
- [x] T012 Create `tests/unit/storage-verification.test.mjs` with the following hermetic, static test cases (no live I/O; `node:test` + `node:assert/strict` only):
  - **Test 1** — `buildVerificationRun` with a single-provider input: assert `runId` is present, `startedAt` is an ISO 8601 string, `configuration.providers` contains exactly one entry with only `providerType` (no credentials), and `scenarios` is an empty array.
  - **Test 2** — `buildVerificationRun` with a two-provider input: assert `configuration.providers` has two entries; call twice with the same timestamp-equivalent input and assert `runId` values differ (timestamp-based uniqueness).
  - **Test 3** — `buildVerificationScenario` for each of the following categories: `bucket.create`, `object.put`, `error.object_not_found`, `capability.baseline.validation`, `isolation.cross_tenant_bucket_access`, `boundary.large_object_upload`; assert each produces a structurally valid record with non-empty `scenarioId`, `category`, `providerType`, `operation`.
  - **Test 4** — `buildVerificationResult` with `status: 'passed'`: assert no `failureType` or `actualOutcome` fields; assert `retryCount` is a non-negative integer.
  - **Test 5** — `buildVerificationResult` with `status: 'failed'` and retry count 0: assert `classifyVerificationFailure` returns `'deterministic'`; assert `failureType` is `'deterministic'`; assert `actualOutcome` is present.
  - **Test 6** — `buildVerificationResult` with `status: 'failed'` but `retryCount > 0` with at least one prior pass: assert `classifyVerificationFailure` returns `'transient'`.
  - **Test 7** — `buildVerificationReport` with two providers both passing all scenarios: assert `overallVerdict === 'pass'`; assert `verdicts` map has one entry per provider each set to `'pass'`; assert `divergences` is empty.
  - **Test 8** — `buildVerificationReport` with Provider A passing and Provider B failing one scenario: assert `overallVerdict === 'partial'`; assert `verdicts['providerA'] === 'pass'` and `verdicts['providerB'] === 'fail'`; assert `divergences` has exactly one entry naming the diverging operation.
  - **Test 9** — `buildCapabilityBaselineVerificationResult` with a MinIO-fixture input satisfying all required capabilities: assert `eligible: true`; assert `missingCapabilities` is empty.
  - **Test 10** — `buildCapabilityBaselineVerificationResult` with a negative fixture missing `object.list.pagination.deterministic`: assert `eligible: false`; assert `missingCapabilities` includes `'object.list.pagination.deterministic'`.
  - **Test 11** — `buildErrorTaxonomyConsistencyResult` for all five required error codes (`OBJECT_NOT_FOUND`, `BUCKET_NOT_FOUND`, `BUCKET_ALREADY_EXISTS`, `STORAGE_ACCESS_DENIED`, `STORAGE_INVALID_REQUEST`) fed identical normalized error inputs for MinIO and Garage fixtures: assert `consistent: true` for each.
  - **Test 12** — `buildErrorTaxonomyConsistencyResult` with one provider returning HTTP 403 for `OBJECT_NOT_FOUND` instead of 404: assert `consistent: false`; assert `providerResults` contains two entries with differing `httpStatus`.
  - **Test 13** — `buildTenantIsolationVerificationResult` for a cross-tenant bucket-access scenario: assert `passed: false`; assert `denialErrorCode` is `'STORAGE_ACCESS_DENIED'`; assert `tenantA` and `tenantB` are anonymized (`tctx-` prefixed, no PII).
  - **Test 14** — `summarizeVerificationReport` on a complete report: assert the output does not include any string matching `secret://`, `https?://`, `accessKey=`, `sessionKey=`, or `password=` when passed through `JSON.stringify`.
  - **Test 15** — `VERIFICATION_SCENARIO_CATEGORIES` contains all 23 required category strings; `VERIFICATION_VERDICT` contains `pass`, `fail`, and `partial`; both are frozen (attempt to mutate throws in strict mode).
- [x] T013 Create `tests/adapters/storage-provider-verification.test.mjs` with the following adapter integration tests (`provider-catalog.mjs` imports only; static fixtures; no live provider connections):
  - **Test 1** — MinIO profile passes `buildCapabilityBaselineVerificationResult` with `eligible: true`; all `STORAGE_NORMALIZED_ERROR_CODES` required codes appear in `satisfiedCapabilities` or equivalent capability surface.
  - **Test 2** — Garage profile passes `buildCapabilityBaselineVerificationResult` with `eligible: true`.
  - **Test 3** — Negative fixture (synthetic provider with `object.list.pagination.deterministic: false`) produces `eligible: false` with a non-empty `missingCapabilities` list.
  - **Test 4** — `buildErrorTaxonomyConsistencyResult` for MinIO vs Garage across all five FR-003 error codes: assert `consistent: true` for each code.
  - **Test 5** — Injected divergence scenario: Garage fixture with HTTP 403 for `OBJECT_NOT_FOUND` (instead of 404) → `buildCrossProviderEquivalenceAssessment` produces `equivalent: false` and a `divergences` entry naming the operation and both providers' actual outcomes.
  - **Test 6** — `buildStorageVerificationReport` with dummy inputs for both providers produces a report containing top-level fields: `runId`, `startedAt`, `providers`, `scenarioResults`, `crossProviderEquivalenceAssessments`, `errorTaxonomyConsistencyResults`, `capabilityBaselineResults`, `tenantIsolationResults`, `verdicts`, `overallVerdict`.
  - **Test 7** — `summarizeStorageVerificationReport` output does not include any field matching `secret://` patterns when serialized.
  - **Test 8** — All nine named exports and three catalog constants from `provider-catalog.mjs` additions are importable and are not `undefined`.
- [x] T014 Extend `tests/contracts/storage-provider.contract.test.mjs` with an additive test block (do not modify existing assertions):
  - Add `test('storage verification report schema is additive and structurally valid', ...)` that:
    - Imports `buildVerificationReport`, `buildVerificationRun`, `VERIFICATION_VERDICT` from `storage-provider-verification.mjs`.
    - Calls `buildVerificationReport` with minimal dummy inputs (empty scenario arrays, two provider entries).
    - Asserts all required top-level fields are present: `runId`, `startedAt`, `completedAt`, `configuration`, `scenarioResults`, `crossProviderEquivalenceAssessments`, `errorTaxonomyConsistencyResults`, `capabilityBaselineResults`, `tenantIsolationResults`, `verdicts`, `overallVerdict`, `divergences`.
    - Asserts `overallVerdict` is one of `Object.values(VERIFICATION_VERDICT)`.
    - Asserts the report object is frozen (strict mode mutation throws).
- [x] T015 Create `tests/e2e/storage-provider-verification/README.md` with a static verification scenario matrix containing the following five sections (mirrors the style of `tests/e2e/postgresql-tenant-isolation/README.md`):
  - **Section 1 — Functional Equivalence Scenarios (FR-002)**: one row per `VERIFICATION_SCENARIO_CATEGORIES` entry in the functional group (`bucket.create` through `object.integrity.etag_or_checksum`); columns: Scenario ID, Operation, Provider, Expected Outcome, Evidence Required.
  - **Section 2 — Error Taxonomy Consistency Scenarios (FR-003)**: rows for `error.object_not_found`, `error.bucket_not_found`, `error.bucket_already_exists`, `error.access_denied`, `error.invalid_request`; columns: Error Code, Trigger Condition, Expected Normalized Code, Expected HTTP Status, Expected Retryability, Consistency Verdict.
  - **Section 3 — Capability Baseline Validation Scenarios (FR-004)**: rows for MinIO, Garage, and negative fixture; columns: Provider, Eligible, Required Capabilities Satisfied, Missing Capabilities, Evidence Required.
  - **Section 4 — Multi-Tenant Isolation Scenarios (FR-005/FR-006)**: rows for `isolation.cross_tenant_bucket_access` and `isolation.listing_exclusion` on each provider; columns: Scenario, Provider, Tenant A, Tenant B, Expected Denial Code, Listing Exclusion Verified.
  - **Section 5 — Operational Hygiene and Boundary Scenarios (FR-010 to FR-014)**: rows for idempotency/cleanup, large-object boundary (`boundary.large_object_upload`), and multi-page pagination (`boundary.pagination_multi_page`); columns: Scenario, Trigger, Expected Outcome, Cleanup Evidence.
  - Each section must include an **Evidence expectations** sub-section listing what artifacts (report fields, assertion messages, log entries) confirm the scenario passed.
  - Include a **Review triggers** section at the end: conditions under which the matrix must be re-reviewed (new provider added, FR change, error taxonomy update).

## Validation checklist

- [x] T030 Run `npm run lint:md`.
- [x] T031 Run `npm run test:unit`.
- [x] T032 Run `npm run test:adapters`.
- [x] T033 Run `npm run test:contracts`.

## Delivery checklist

- [x] T040 Review git diff for T06 scope compliance: confirm no modifications outside the five new/extended artifacts listed in the implementation checklist, and no T01–T05 logic changed.
- [ ] T041 Commit the feature branch changes for `US-STO-01-T06`.
- [ ] T042 Push `012-storage-provider-verification` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
