# Tasks: US-OBS-03-T04 — Hard-Limit Quota Enforcement on Resource Creation

**Input**: `specs/040-quota-hard-limit-enforcement/plan.md`
**Feature Branch**: `040-quota-hard-limit-enforcement`
**Task**: `US-OBS-03-T04`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

> **Token-optimization rule**: do NOT read
> `apps/control-plane/openapi/control-plane.openapi.json` directly.
> Use only the listed family OpenAPI files as read context.

### Spec artifacts

- `specs/040-quota-hard-limit-enforcement/plan.md`
- `specs/040-quota-hard-limit-enforcement/tasks.md`

### Existing contract + reader references (read-only)

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/observability-threshold-alerts.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`

### Existing helper + adapter references (read-only)

- `apps/control-plane/src/observability-admin.mjs`
- `services/adapters/src/storage-capacity-quotas.mjs`
- `services/adapters/src/openwhisk-admin.mjs`
- `services/adapters/src/kafka-admin.mjs`
- `services/adapters/src/postgresql-admin.mjs`
- `services/adapters/src/mongodb-admin.mjs`
- `apps/control-plane/openapi/families/storage.openapi.json`
- `apps/control-plane/openapi/families/functions.openapi.json`
- `apps/control-plane/openapi/families/events.openapi.json`
- `apps/control-plane/openapi/families/postgres.openapi.json`
- `apps/control-plane/openapi/families/mongo.openapi.json`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `package.json`

### Existing test/pattern references (read-only)

- `tests/unit/observability-threshold-alerts.test.mjs`
- `tests/adapters/storage-capacity-quotas.test.mjs`
- `tests/adapters/openwhisk-admin.test.mjs`
- `tests/adapters/kafka-admin.test.mjs`
- `tests/adapters/postgresql-admin.test.mjs`
- `tests/adapters/mongodb-admin.test.mjs`

### New or updated delivery targets

- `services/internal-contracts/src/observability-hard-limit-enforcement.json`
- `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-hard-limit-enforcement.mjs`
- `scripts/validate-observability-hard-limit-enforcement.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `services/adapters/src/storage-capacity-quotas.mjs`
- `services/adapters/src/openwhisk-admin.mjs`
- `services/adapters/src/kafka-admin.mjs`
- `services/adapters/src/postgresql-admin.mjs`
- `services/adapters/src/mongodb-admin.mjs`
- `apps/control-plane/openapi/families/storage.openapi.json`
- `apps/control-plane/openapi/families/functions.openapi.json`
- `apps/control-plane/openapi/families/events.openapi.json`
- `apps/control-plane/openapi/families/postgres.openapi.json`
- `apps/control-plane/openapi/families/mongo.openapi.json`
- `docs/reference/architecture/observability-hard-limit-enforcement.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `tests/unit/observability-hard-limit-enforcement.test.mjs`
- `tests/contracts/observability-hard-limit-enforcement.contract.test.mjs`
- `tests/adapters/storage-capacity-quotas.test.mjs`
- `tests/adapters/openwhisk-admin.test.mjs`
- `tests/adapters/kafka-admin.test.mjs`
- `tests/adapters/postgresql-admin.test.mjs`
- `tests/adapters/mongodb-admin.test.mjs`
- `package.json`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/040-quota-hard-limit-enforcement/spec.md` with the bounded hard-limit enforcement scope for `US-OBS-03-T04`.
- [x] T002 Materialize `specs/040-quota-hard-limit-enforcement/plan.md` with the contract, helper, adapter, OpenAPI, docs, validation, and delivery sequence.
- [x] T003 Materialize `specs/040-quota-hard-limit-enforcement/tasks.md` and keep it aligned with the bounded T04 delta.

## Phase 2 — Internal contract and validation baseline

- [ ] T004 Add `services/internal-contracts/src/observability-hard-limit-enforcement.json` covering:
  - source-contract version pins for usage consumption, quota policies, threshold alerts, and public API,
  - the canonical structured hard-limit error contract,
  - enforceable dimensions/aliases from the backlog (`api_requests`, `serverless_functions`, `storage_buckets`, `logical_databases`, `kafka_topics`, `collections_tables`, `realtime_connections`, `error_budget`),
  - currently implemented surface mappings for storage bucket admission, function create, topic create, PostgreSQL create, and MongoDB create,
  - scope-precedence rules,
  - fail-closed behavior,
  - audit requirements for allowed and denied evaluations,
  - explicit downstream boundaries to `T05` and `T06`.
- [ ] T005 Update `services/internal-contracts/src/index.mjs` to expose:
  - `readObservabilityHardLimitEnforcement()` and `OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_VERSION`,
  - `listHardLimitDimensions()` / `getHardLimitDimension(id)`,
  - `listHardLimitSurfaceMappings()`,
  - `getHardLimitErrorContract()`,
  - `getHardLimitAuditContract()`,
  - `getHardLimitEnforcementPolicy()`.
- [ ] T006 Add `scripts/lib/observability-hard-limit-enforcement.mjs` exporting deterministic contract validation helpers.
- [ ] T007 Add `scripts/validate-observability-hard-limit-enforcement.mjs` and wire `validate:observability-hard-limit-enforcement` into `package.json` plus include it in `validate:repo`.

## Phase 3 — Shared observability helper surface

- [ ] T008 Extend `apps/control-plane/src/observability-admin.mjs` with additive hard-limit helpers:
  - `summarizeObservabilityHardLimitEnforcement()`
  - `listEnforceableQuotaDimensions()`
  - `getHardLimitErrorResponseSchema()`
  - `buildQuotaHardLimitDecision(input)`
  - `pickStrictestHardLimitDecision(decisions)`
  - `buildQuotaHardLimitErrorResponse(decision, context)`
  - `buildQuotaHardLimitAuditEvent(decision, context)`
  - `mapAdapterQuotaDecisionToEnforcementDecision(input)`
  - `isQuotaHardLimitReached(decision)`

## Phase 4 — Adapter integrations

- [ ] T009 Update `services/adapters/src/storage-capacity-quotas.mjs` so bucket-admission previews expose / align with the shared structured hard-limit decision shape.
- [ ] T010 Update `services/adapters/src/openwhisk-admin.mjs` so create-function validation exposes additive structured `quotaDecision` metadata using the shared hard-limit decision contract.
- [ ] T011 Update `services/adapters/src/kafka-admin.mjs` so topic-create validation exposes additive structured `quotaDecision` metadata.
- [ ] T012 Update `services/adapters/src/postgresql-admin.mjs` so create validations expose additive structured `quotaDecision` metadata when limits are exhausted.
- [ ] T013 Update `services/adapters/src/mongodb-admin.mjs` so database / collection create validations expose additive structured `quotaDecision` metadata when limits are exhausted.

## Phase 5 — Public family OpenAPI docs (bounded family files only)

- [ ] T014 Update `apps/control-plane/openapi/families/storage.openapi.json` create/admission surfaces to document the structured hard-limit denial contract.
- [ ] T015 Update `apps/control-plane/openapi/families/functions.openapi.json` create surfaces to document the structured hard-limit denial contract.
- [ ] T016 Update `apps/control-plane/openapi/families/events.openapi.json` create surfaces to document the structured hard-limit denial contract.
- [ ] T017 Update `apps/control-plane/openapi/families/postgres.openapi.json` create surfaces to document the structured hard-limit denial contract.
- [ ] T018 Update `apps/control-plane/openapi/families/mongo.openapi.json` create surfaces to document the structured hard-limit denial contract.
- [ ] T019 Run `npm run generate:public-api` after family-file updates.

## Phase 6 — Documentation

- [ ] T020 Add `docs/reference/architecture/observability-hard-limit-enforcement.md` documenting the decision contract, scope precedence, fail-closed behavior, adapter mappings, and downstream boundary to `T05`/`T06`.
- [ ] T021 Update `docs/reference/architecture/README.md` to index the new hard-limit enforcement document.
- [ ] T022 Update `docs/tasks/us-obs-03.md` with a `T04` delivery summary and residual boundary to `T05`/`T06`.

## Phase 7 — Tests

- [ ] T023 Add `tests/unit/observability-hard-limit-enforcement.test.mjs` covering:
  - validator pass for the new contract,
  - summary output shape,
  - allowed decision construction,
  - denied decision construction,
  - scope-precedence resolution,
  - structured error payload shape,
  - deterministic audit event shape,
  - fail-closed decision when evidence is unavailable.
- [ ] T024 Add `tests/contracts/observability-hard-limit-enforcement.contract.test.mjs` covering:
  - shared readers/accessors exported from `index.mjs`,
  - source-contract version alignment,
  - all backlog dimensions exist and are unique,
  - currently implemented surface mappings exist,
  - error contract fields are present,
  - docs references exist.
- [ ] T025 Update targeted adapter tests to assert additive `quotaDecision` metadata for storage/functions/events/postgres/mongo without regressing existing string violations.

## Phase 8 — Verification

- [ ] T026 Run `npm run validate:observability-hard-limit-enforcement`.
- [ ] T027 Run `node --test tests/unit/observability-hard-limit-enforcement.test.mjs`.
- [ ] T028 Run `node --test tests/contracts/observability-hard-limit-enforcement.contract.test.mjs`.
- [ ] T029 Run targeted adapter tests for storage/functions/events/postgres/mongo quota decisions.
- [ ] T030 Run `npm run lint` and `npm test`.
- [ ] T031 Inspect the final diff to confirm the increment stayed within contract + helper + adapters + family OpenAPI + docs + tests, and did not absorb `T05` or `T06`.

## Phase 9 — Delivery

- [ ] T032 Commit the branch with a focused message for `US-OBS-03-T04`.
- [ ] T033 Push `040-quota-hard-limit-enforcement` to `origin`.
- [ ] T034 Open a PR from `040-quota-hard-limit-enforcement` to `main`.
- [ ] T035 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T036 Merge the PR to `main` once green.
- [ ] T037 Update the orchestrator state files with the completed unit (`US-OBS-03-T04`) and the next pending backlog unit.
