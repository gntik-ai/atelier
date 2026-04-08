# Implementation Plan: Plan Upgrade/Downgrade Verification Tests

**Branch**: `101-plan-upgrade-downgrade-tests` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-PLAN-01-T05 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment`), US-PLAN-01-T02 (`098-plan-base-limits`), US-PLAN-01-T03 (`099-plan-management-api-console`), US-PLAN-01-T04 (`100-plan-change-impact-history`)  
**Input**: Feature specification from `specs/101-plan-upgrade-downgrade-tests/spec.md`

## Summary

Deliver an **automated verification suite** that proves correctness of plan upgrade and downgrade transitions for tenants that already have live resources. The suite provisions representative tenants, creates quota-governed resources across all dimensions (workspaces, Postgres databases, MongoDB databases, Kafka topics, functions, storage objects, API keys, memberships), performs upgrade/downgrade transitions through the platform's plan assignment API, and asserts the exact post-transition state: existing resources remain accessible, effective limits are recalculated, over-limit conditions are individually flagged with accurate usage/limit values, boolean capabilities are updated, and multi-tenant isolation is preserved. Results are machine-readable and persisted as audit-correlated records. The suite is wired into CI as regression protection for all future plan transition work.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`)  
**Primary Dependencies**: `node:test`, `node:assert`, `undici` (HTTP integration calls to APISIX/plan API), `pg` (PostgreSQL fixture seeding + state assertions), `kafkajs` (audit event verification), existing `@in-falcone/internal-contracts` schemas  
**Storage read targets**: PostgreSQL (`tenant_plan_assignments`, `plans`, `quota_dimension_catalog`, `plan_audit_events`, `plan_change_history_*`), per-dimension resource counts via platform APIs  
**Testing approach**: Integration / E2E test suite using `node:test`; no new production code — this task is exclusively a verification artefact  
**Target Platform**: Kubernetes / OpenShift via Helm, Apache APISIX (API calls), Apache OpenWhisk (action-level verification), existing CI pipeline  
**Performance goals**: full suite (setup, transitions, assertions, teardown) completes in under 5 minutes for representative resource counts (SC-005); individual scenarios ≤ 60 s each  
**Constraints**: over-limit states are advisory only — no enforcement, no auto-remediation; concurrent plan changes are serialized by T01/T03; overrides are read but not modified; no production-data dependency; isolated fixture tenants created and torn down per run  
**Scale/Scope**: covers all quota dimensions registered in `quota_dimension_catalog`; covers all declared boolean capabilities; supports upgrade, downgrade, and round-trip scenarios; supports zero-resource tenant edge cases; wired to CI

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | All artefacts live under `tests/` or `specs/101-plan-upgrade-downgrade-tests/`; no production service code introduced |
| II. Incremental Delivery | ✅ PASS | Builds on top of T01–T04 without introducing billing, enforcement, or remediation |
| III. K8s / OpenShift Compatibility | ✅ PASS | Uses the same integration test runner pattern; no privileged runtimes or platform-specific APIs beyond established patterns |
| IV. Quality Gates | ✅ PASS | All scenarios are encoded as `node:test` assertions; CI failure on regression is an explicit success criterion (SC-006) |
| V. Documentation as Part of the Change | ✅ PASS | This plan, `research.md`, `quickstart.md`, and scenario documentation constitute the feature docs |

**No complexity violations.** This task is exclusively a testing artefact layered on top of the existing plan-management stack.

## Project Structure

### Documentation (this feature)

```text
specs/101-plan-upgrade-downgrade-tests/
├── plan.md                 ← This file
├── spec.md                 ← Feature specification (already present)
├── research.md             ← Phase 0 output
├── quickstart.md           ← Phase 1 output
└── tasks.md                ← Phase 2 output (/speckit.tasks; not created here)
```

### Test Artefacts (repository root)

```text
tests/
└── e2e/
    └── 101-plan-upgrade-downgrade-tests/
        ├── fixtures/
        │   ├── seed-plans.mjs                          ← NEW: seed starter/professional plan fixtures with known limits and capabilities
        │   ├── seed-tenant-resources.mjs               ← NEW: create quota-governed resources for a given tenant/plan combo
        │   ├── teardown.mjs                            ← NEW: full fixture cleanup (resources, assignments, plan fixtures)
        │   └── mock-usage-unavailable.mjs              ← NEW: fixture for temporarily unavailable usage dimensions
        ├── helpers/
        │   ├── plan-api-client.mjs                     ← NEW: typed wrappers over plan management HTTP API via undici/APISIX
        │   ├── resource-api-client.mjs                 ← NEW: typed resource-count and accessibility verification helpers
        │   ├── audit-query-client.mjs                  ← NEW: helpers for querying plan change history from T04 API
        │   ├── kafka-consumer.mjs                      ← NEW: lightweight Kafka consumer for audit event verification
        │   └── assertion-helpers.mjs                   ← NEW: reusable assert wrappers for verification result shape and per-dimension status
        ├── scenarios/
        │   ├── upgrade-preserves-resources.test.mjs    ← NEW: US1 — upgrade scenario (starter → professional)
        │   ├── downgrade-surfaces-overlimit.test.mjs   ← NEW: US2 — downgrade with over-limit resources
        │   ├── audit-trail-verification.test.mjs       ← NEW: US3 — audit record correctness and correlation
        │   ├── multitenant-isolation.test.mjs          ← NEW: US4 — plan change does not affect other tenants
        │   ├── round-trip-transition.test.mjs          ← NEW: US5 — upgrade-then-downgrade round trip
        │   └── edge-cases.test.mjs                     ← NEW: zero-resource tenant, at-limit dimension, missing dimension, unavailable usage, concurrent change, overrides
        └── index.test.mjs                              ← NEW: suite entry point (imports all scenarios; configures global setup/teardown)
```

## Phase 0: Research

### R-01 — Verify T01–T04 precondition surfaces needed by the suite

**Decision**: Before writing any test, confirm the following APIs are available and contract-stable:  
  1. `POST /v1/tenants/{tenantId}/plan` — assigns/changes a plan (T01/T03).  
  2. `GET /v1/tenants/{tenantId}/plan/effective-entitlements` — returns effective limits and capability flags (T04).  
  3. `GET /v1/tenants/{tenantId}/plan/history-impact` — returns immutable plan change history with over-limit dimensions (T04).  
  4. Resource count APIs per quota dimension (workspace list, API key list, function list, etc.) — queryable per tenant.  
  5. `quota_dimension_catalog` — queryable to enumerate all registered dimensions for exhaustive coverage.  
**Rationale**: The suite must not hard-code assumptions about which dimensions exist or what the API shapes are. It must enumerate dimensions from the catalog and verify the shapes against published contracts.

### R-02 — Fixture plan design for reliable differential testing

**Decision**: Define two well-known fixture plans — `test-starter` and `test-professional` — seeded at test setup time with deliberately contrasting limits:
- `test-starter`: small bounded limits per dimension (e.g., 3 workspaces, 2 databases, 5 API keys) and a subset of boolean capabilities disabled.
- `test-professional`: higher limits (e.g., 10 workspaces, 8 databases, 20 API keys) and additional boolean capabilities enabled.
Both plans must be distinct from any production plans and removed after the suite completes.
**Rationale**: Controlled fixture plans make assertions predictable regardless of production plan evolution. Using catalog-driven limits means the suite can verify all registered dimensions without per-dimension hard-coding.

### R-03 — Resource seeding per quota dimension

**Decision**: Seed each dimension's resources via the platform's existing resource management APIs (same APIs tenant users call) rather than direct DB insertion. This ensures resources are created in states the platform recognizes as valid and accessible.
Seed to the following rule per scenario:
- **Upgrade scenario**: create resources at 100% of `test-starter` limits (e.g., exactly 3 workspaces, 5 API keys) so the upgrade effect is visible.
- **Downgrade scenario**: create resources at 100% of `test-professional` limits before downgrading to `test-starter` to guarantee over-limit conditions on every dimension.
- **Round-trip scenario**: create resources on `test-starter`, upgrade, create additional resources to reach `test-professional` limits, then downgrade.
**Rationale**: Guarantees predictable pre-transition state with verifiable post-transition assertions.

### R-04 — Verification result shape interpretation

**Decision**: The suite verifies the structured machine-readable result from `plan-effective-entitlements-get` and `plan-change-history` (T04 artefacts). Each dimension must be classified as one of `within_limit`, `at_limit`, `over_limit`, or `usage_unavailable`. The suite does not call a separate "verification service" — it interprets the platform's existing post-change state.  
**Rationale**: FR-008 requires machine-readable results from the platform APIs. The suite serves as the consumer that asserts those results are correct.

### R-05 — Multi-tenant isolation test strategy

**Decision**: Provision two independent fixture tenants (`test-tenant-alpha` on `test-professional`, `test-tenant-beta` on `test-starter`). Change only `test-tenant-alpha`'s plan. Query `test-tenant-beta`'s effective entitlements, resource accessibility, and audit history before and after the change and assert bit-for-bit equality.  
**Rationale**: Isolation is a non-negotiable invariant (FR-009). The test must produce observable evidence of no cross-tenant leakage.

### R-06 — Concurrent plan change serialization assertion

**Decision**: Fire two simultaneous `POST /v1/tenants/{tenantId}/plan` requests from independent `undici` connections, targeting the same tenant and different target plans. Assert exactly one request returns `200` (or `202`) and the other returns a serialization-error response (`409` or equivalent per the T01 contract). Assert the tenant's plan matches exactly one of the two target plans after both settle.  
**Rationale**: The edge case section of the spec requires the suite to verify concurrency handling. The test does not implement serialization — it verifies the existing T01/T03 guarantee.

### R-07 — Audit correlation assertion

**Decision**: After each plan change, retrieve the plan change history entry from T04 and assert it contains the `verificationOutcome` field (or equivalent correlation signal) linking to the transition that was performed. Assert the audit record's over-limit dimension list matches the post-transition effective entitlements.  
**Rationale**: FR-013 and SC-007 require audit records to be correlated and retrievable within 30 seconds. The suite must perform a time-bounded poll and fail if the record is absent or inconsistent.

## Phase 1: Design & Contracts

### Architecture / Flow

```text
Test runner (node:test)
        │
        ├── Phase: Global setup
        │     ├── seed fixture plans (test-starter, test-professional)
        │     └── create fixture superadmin session token (Keycloak)
        │
        ├── Phase: Per-scenario setup
        │     ├── create fixture tenant(s) via platform API
        │     ├── assign initial plan
        │     └── seed resources to target counts
        │
        ├── Phase: Transition
        │     └── call POST /v1/tenants/{tenantId}/plan (APISIX → OpenWhisk plan-assign)
        │
        ├── Phase: Assertion
        │     ├── GET effective-entitlements → assert per-dimension status
        │     ├── GET each resource type → assert count and accessibility unchanged
        │     ├── GET plan change history → assert audit record present and correlated
        │     ├── Consume Kafka topic → assert audit event emitted (optional, non-blocking)
        │     └── [isolation tests] GET other tenant's resources/entitlements → assert unchanged
        │
        └── Phase: Per-scenario teardown
              ├── delete seeded resources
              ├── delete fixture tenant
              └── [global teardown] delete fixture plans
```

### Core design choices

1. **No production code introduced.** This task adds only test artefacts and fixture helpers.
2. **Exhaustive dimension coverage.** The suite queries `quota_dimension_catalog` once at startup and generates assertions for every registered dimension — no hard-coded dimension lists.
3. **Graceful handling of `usage_unavailable`.** If a dimension returns `usage_unavailable`, the test records it as a warning rather than a failure unless the count of unavailable dimensions exceeds a configurable threshold (`MAX_UNKNOWN_DIMENSIONS_ALLOWED`, default 0 in strict mode).
4. **Idempotent setup/teardown.** All fixture helpers use `IF NOT EXISTS` semantics and cleanup guards so interrupted runs do not leave orphaned data.
5. **Non-destructive assertions.** No test modifies resources during the assertion phase — only reads.
6. **CI-first.** Suite entry point (`index.test.mjs`) produces TAP-compatible output. Any failing assertion emits a structured diagnostic report.

### Scenario details

#### Scenario S1 — Upgrade preserves existing resources and unlocks higher limits

```text
Setup:  tenant "test-tenant-upgrade" on test-starter, resources at 100% starter limits
Action: assign test-professional to test-tenant-upgrade
Assert:
  • every previously created resource still accessible (HTTP 200, same payload shape)
  • effective storage/workspace/API-key/database limits ≥ test-professional limits
  • all test-professional capabilities reflected in effective entitlements
  • no resource has status != accessible in the platform's resource-list responses
  • test-starter limits are no longer reported as the effective limits
Teardown: delete resources, delete tenant
```

#### Scenario S2 — Downgrade surfaces over-limit conditions without data loss

```text
Setup:  tenant "test-tenant-downgrade" on test-professional, resources at 100% professional limits
Action: assign test-starter to test-tenant-downgrade
Assert:
  • every resource remains accessible (HTTP 200)
  • effective-entitlements response flags every dimension whose usage > test-starter limit as over_limit
  • reported usage matches seeded count per dimension
  • reported effective limit matches test-starter limit per dimension
  • capabilities removed by the downgrade are reflected in entitlements but dependent resources are not deleted
  • no resource count changes between pre- and post-downgrade resource-list calls
Teardown: delete resources, delete tenant
```

#### Scenario S3 — Audit trail captures full transition context

```text
Setup:  reuse tenant from S1 or S2 (or create dedicated), perform an upgrade + a downgrade
Assert:
  • plan change history entry exists within 30 s for each transition
  • audit entry for upgrade: no over-limit dimensions reported
  • audit entry for downgrade: over-limit dimensions match S2 expectations
  • each history entry independently records the verification state for its transition
  • history entries are immutable after a further plan edit (re-query after dummy metadata update)
Teardown: delete resources, delete tenant
```

#### Scenario S4 — Multi-tenant isolation

```text
Setup:  test-tenant-alpha (test-professional, resources at 50% of limits)
        test-tenant-beta (test-starter, resources at 50% of limits)
Snapshot tenant-beta effective entitlements before change
Action: upgrade test-tenant-alpha to test-professional (no-op) then downgrade to test-starter
Assert:
  • tenant-beta effective entitlements unchanged (bit-for-bit equality with pre-change snapshot)
  • tenant-beta resource counts unchanged
  • tenant-beta plan change history has no new entries
Teardown: delete resources and both tenants
```

#### Scenario S5 — Round-trip transition (upgrade → downgrade)

```text
Setup:  test-tenant-roundtrip on test-starter, resources at 100% starter limits
Action A: assign test-professional to test-tenant-roundtrip
          → create additional resources to reach professional limits (3 extra workspaces, etc.)
Action B: assign test-starter to test-tenant-roundtrip
Assert:
  • all resources created in both phases remain accessible
  • over-limit dimensions correspond to resources created during the professional phase
  • effective limits match test-starter
  • plan change history contains exactly 2 entries (upgrade + downgrade) with correct per-transition snapshots
  • round-trip produces no net change to resources not created during the professional phase
Teardown: delete resources, delete tenant
```

#### Scenario S6 — Edge cases

| Edge Case | Test approach |
|-----------|---------------|
| Zero-resource tenant upgrade/downgrade | create tenant, assign plan, change plan, assert no over-limit flags, effective limits match target plan |
| Usage exactly at target limit | seed resources to exactly the target plan's limit on one dimension; after downgrade assert `at_limit` (not `over_limit`) for that dimension |
| Dimension added in target plan not present in source | verify that new dimension appears in post-upgrade effective entitlements with correct limit |
| Dimension removed in target plan present in source | verify that removed dimension reports its status appropriately (no silent omission) |
| Usage temporarily unavailable | use `mock-usage-unavailable.mjs` to simulate unavailable dimension; assert response classifies it as `usage_unavailable`, not a failure |
| Concurrent plan change | fire two simultaneous requests; assert exactly one succeeds and one returns serialization error; verify final plan assignment is internally consistent |
| Override-governed dimension | if overrides are supported, create tenant with override raising a dimension above the base plan limit; assert verification uses override-inclusive effective limit |

## Projected artifacts by area

### Test suite files

| Artefact | Type | Purpose |
|----------|------|---------|
| `tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs` | New | CI entry point; registers global setup/teardown; imports all scenario files |
| `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/upgrade-preserves-resources.test.mjs` | New | S1 — upgrade correctness |
| `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/downgrade-surfaces-overlimit.test.mjs` | New | S2 — downgrade over-limit detection |
| `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/audit-trail-verification.test.mjs` | New | S3 — audit record correlation |
| `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/multitenant-isolation.test.mjs` | New | S4 — isolation guarantees |
| `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/round-trip-transition.test.mjs` | New | S5 — upgrade + downgrade round-trip |
| `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/edge-cases.test.mjs` | New | S6 — edge cases |

### Fixture and helper files

| Artefact | Type | Purpose |
|----------|------|---------|
| `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/seed-plans.mjs` | New | Create/verify test-starter and test-professional fixture plans |
| `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/seed-tenant-resources.mjs` | New | Create quota-governed resources up to specified counts per dimension |
| `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/teardown.mjs` | New | Idempotent full cleanup of tenants, resources, and plan fixtures |
| `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/mock-usage-unavailable.mjs` | New | Simulate unavailable usage dimension for edge case testing |
| `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/plan-api-client.mjs` | New | `undici`-based HTTP wrappers for plan assignment and effective-entitlements APIs |
| `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/resource-api-client.mjs` | New | Resource-count and accessibility verification helpers per quota dimension |
| `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/audit-query-client.mjs` | New | Plan change history query helpers; time-bounded polling for audit record presence |
| `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/kafka-consumer.mjs` | New | Lightweight `kafkajs` consumer for audit event verification |
| `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/assertion-helpers.mjs` | New | Reusable assertion wrappers for verification result shape and dimension status |

### CI and configuration

| Artefact | Type | Purpose |
|----------|------|---------|
| CI pipeline step (e.g., `.github/workflows/*.yml` or equivalent) | Update | Register `node --test tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs` as a CI job triggered on plan-related merges |
| Environment variable documentation in `specs/101-plan-upgrade-downgrade-tests/quickstart.md` | New | Describes how to run the suite locally with required env vars |

### No production code changes

This task introduces **zero** changes to:
- `services/provisioning-orchestrator/src/`
- `services/gateway-config/`
- `apps/web-console/`
- Any existing migration files

If a gap in existing APIs or contracts is discovered during implementation, it must be surfaced as a blocker linked to the relevant upstream task (T01–T04) rather than patched here.

## Data model and fixture plans

### Fixture plan definitions (seeded at test time, not persisted to production)

```json
// test-starter
{
  "slug": "test-starter",
  "name": "Test Starter (E2E fixture — do not use in production)",
  "lifecycle_state": "active",
  "quota_dimensions": {
    "max_workspaces": 3,
    "max_postgres_databases": 2,
    "max_mongo_databases": 2,
    "max_kafka_topics": 5,
    "max_functions": 10,
    "max_storage_bytes": 104857600,
    "max_api_keys": 5,
    "max_members": 5
  },
  "capabilities": {
    "realtime_enabled": false,
    "custom_domains_enabled": false,
    "audit_log_export_enabled": false
  }
}

// test-professional
{
  "slug": "test-professional",
  "name": "Test Professional (E2E fixture — do not use in production)",
  "lifecycle_state": "active",
  "quota_dimensions": {
    "max_workspaces": 10,
    "max_postgres_databases": 8,
    "max_mongo_databases": 8,
    "max_kafka_topics": 20,
    "max_functions": 50,
    "max_storage_bytes": 1073741824,
    "max_api_keys": 20,
    "max_members": 20
  },
  "capabilities": {
    "realtime_enabled": true,
    "custom_domains_enabled": true,
    "audit_log_export_enabled": true
  }
}
```

Actual dimension keys are resolved from `quota_dimension_catalog` at runtime; the above values are the intended seed defaults. If the catalog contains additional dimensions, the suite generates assertions for them using each plan's declared value or the catalog default.

### No new schema migrations

The suite reads from existing tables (`plans`, `tenant_plan_assignments`, `quota_dimension_catalog`, `plan_audit_events`, `plan_change_history_*`) and platform APIs. No DDL changes are introduced.

## Kafka events to verify

| Topic | When verified | Purpose |
|-------|---------------|---------|
| `console.plan.assignment.created` | After each plan transition | Confirms assignment was committed |
| `console.plan.assignment.superseded` | After each plan change beyond the first | Confirms previous assignment was superseded |
| `console.plan.change-impact-recorded` | After each transition (T04 topic) | Confirms impact snapshot was emitted |

Kafka assertions are implemented as best-effort with a bounded timeout (default 15 s). A Kafka consumer failure in CI does not block the suite but emits a warning diagnostic. This avoids flakiness from broker latency while still providing observable audit coverage.

## Test strategy

### Suite structure

The suite is composed of `node:test`-based integration/E2E tests organized by scenario. Each scenario file is self-contained: it performs its own resource seeding and teardown, and imports only from `helpers/` and `fixtures/`. The `index.test.mjs` entry point registers a global setup (`before`) for shared fixture plans and a global teardown (`after`) for cleanup.

### Unit (within this task)

No domain logic is introduced in T05. Assertion helpers in `assertion-helpers.mjs` are tested with simple inline assertions to verify they classify dimension statuses correctly given crafted API response payloads. These unit checks execute as part of the same `node:test` run.

### Integration (primary)

Each scenario in `scenarios/` is an integration test that:
1. Calls the live platform APIs (via APISIX) using `plan-api-client.mjs`.
2. Queries resource accessibility using `resource-api-client.mjs`.
3. Queries audit records using `audit-query-client.mjs` with a time-bounded poll loop.
4. Asserts response shapes against `assertion-helpers.mjs`.

### Contract

The suite validates response shapes against the published OpenAPI contract definitions from T03/T04. Any shape mismatch between expected and actual API responses fails with a structured contract-violation diagnostic that names the mismatched field and location.

### E2E / Operational smoke

The Kafka consumer in `kafka-consumer.mjs` provides optional real-time event assertions to verify the full platform pipeline. This is classified as operational smoke and is gated by `KAFKA_ENABLED=true` in the test environment. In CI, it is enabled to validate the event pipeline.

### CI integration

```bash
# Pseudo-CI step
node --test \
  --test-reporter=tap \
  tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs
```

Required environment variables for CI:
- `TEST_API_BASE_URL` — APISIX ingress base URL
- `TEST_SUPERADMIN_TOKEN` — superadmin Keycloak token or OIDC client credentials
- `TEST_PG_DSN` — PostgreSQL DSN for fixture seeding and state assertions
- `KAFKA_BROKERS` — Kafka broker list (if `KAFKA_ENABLED=true`)
- `KAFKA_ENABLED` — `true|false`; if false, Kafka assertions are skipped but logged
- `MAX_UNKNOWN_DIMENSIONS_ALLOWED` — integer (default `0` in strict CI mode)
- `PLAN_CHANGE_AUDIT_POLL_TIMEOUT_MS` — timeout for audit record poll (default `30000`)

## Risks, compatibility, rollback, and safety

### Main risks

1. **T01–T04 preconditions not fully stable** when T05 implementation begins.
   - Mitigation: T05 is explicitly dependent on T01–T04 being merged. The suite should be implemented only after those tasks are complete. If a gap is found, it is tracked as a T01–T04 defect, not patched in T05.
2. **Flaky tests due to async Kafka consumption or eventual-consistency in effective-entitlements reads**.
   - Mitigation: Time-bounded poll loops with explicit timeout parameters; clear diagnostic output distinguishing availability timeouts from incorrect values.
3. **Resource seeding failures due to rate limits or API timeouts in CI**.
   - Mitigation: Idempotent seeding helpers; retry logic with backoff in `seed-tenant-resources.mjs`; configurable resource counts so CI can use smaller counts than a full local run.
4. **Fixture plan slugs colliding with production plan slugs**.
   - Mitigation: Fixture slugs are prefixed `test-` and the teardown hook always deletes them. If a slug collision occurs at seed time, the fixture helpers detect and abort with a diagnostic.
5. **Concurrent access to shared fixture plans if multiple CI jobs run in parallel**.
   - Mitigation: Fixture tenant names are generated with a run-unique suffix (e.g., timestamp + random hex) to isolate parallel runs. Fixture plans are created once per run and shared within the run.

### Compatibility

- The suite introduces no breaking changes to any production API, schema, or contract.
- Adding the CI step is additive; it does not alter any existing CI job.
- All fixture data is isolated under tenant-scoped namespaces and cleaned up post-run.

### Rollback

- If the suite is broken by a regression upstream, CI fails and the diagnostic report names the affected scenario.
- Removing the suite requires only removing the CI step and deleting the `tests/e2e/101-plan-upgrade-downgrade-tests/` directory. No schema rollback is needed.

### Idempotency

- All `seed-*` helpers use idempotent upsert semantics where supported by the API (e.g., create-if-not-exists).
- Teardown is safe to run multiple times and handles already-deleted resources gracefully.

### Security

- Fixture tenants are created with minimal permissions and are fully isolated from production tenants.
- Superadmin tokens used in the suite are short-lived and scoped to the test environment only.
- No sensitive data beyond test fixtures is created, stored, or logged.
- Multi-tenant isolation tests produce evidence that the test infrastructure itself does not leak across tenants.

## Observability plan

The suite produces the following structured output per run:

### Test run report (stdout / TAP)

Each scenario emits a pass/fail line with:
- Scenario identifier and description
- Per-dimension status: `accessible | over_limit | at_limit | usage_unavailable`
- Overall outcome: `PASS | FAIL`
- On failure: expected vs. actual values, API response excerpts, and audit correlation id if available

### Machine-readable result artefact

After the full suite completes, `index.test.mjs` emits a JSON summary to stdout or a configurable file path:

```json
{
  "runId": "<uuid>",
  "timestamp": "<ISO-8601>",
  "scenarios": [
    {
      "id": "S1-upgrade-preserves-resources",
      "tenantId": "...",
      "sourcePlan": "test-starter",
      "targetPlan": "test-professional",
      "result": "PASS",
      "dimensions": [
        { "key": "max_workspaces", "status": "within_limit", "usage": 3, "effectiveLimit": 10 }
      ],
      "capabilities": [
        { "key": "realtime_enabled", "before": false, "after": true }
      ],
      "auditCorrelationId": "...",
      "durationMs": 4200
    }
  ],
  "summary": { "total": 6, "passed": 6, "failed": 0 }
}
```

This artefact can be uploaded as a CI artefact and correlated with the plan change audit history from T04.

### Kafka

The suite's Kafka consumer logs received events to a structured diagnostic file (`kafka-events-observed.json`) for manual inspection if needed.

## Dependencies, sequencing, and parallelization

### Preconditions (all must be merged before T05 implementation begins)

- T01 (`097`): plan entity + assignment API — required for plan assignment calls.
- T02 (`098`): quota dimension catalog + base limits — required for fixture plan dimension values.
- T03 (`099`): plan management API/console — required for API route and auth layer.
- T04 (`100`): plan change history + effective entitlements — required for audit correlation and effective-entitlements read model.
- Platform resource management APIs per dimension (workspace, API key, function, etc.) — must be operational and accessible via APISIX.

### Recommended implementation sequence

1. Read and stabilize T01–T04 API contracts; identify any gaps.
2. Implement `helpers/plan-api-client.mjs` and `helpers/resource-api-client.mjs`.
3. Implement `fixtures/seed-plans.mjs` and `fixtures/seed-tenant-resources.mjs`.
4. Implement `helpers/assertion-helpers.mjs` with unit-level self-tests.
5. Implement S1 (upgrade) scenario end-to-end and validate locally.
6. Implement S2 (downgrade) scenario.
7. Implement S3 (audit trail) scenario and `helpers/audit-query-client.mjs`.
8. Implement S4 (isolation) and S5 (round-trip) scenarios.
9. Implement S6 (edge cases).
10. Implement `helpers/kafka-consumer.mjs` and wire Kafka assertions.
11. Implement global `fixtures/teardown.mjs` and `index.test.mjs` entry point.
12. Wire CI step and validate the suite runs in under 5 minutes.
13. Write `quickstart.md`.

### Parallelizable work

- S1 and S2 can be implemented in parallel once fixtures and `plan-api-client.mjs` are ready.
- S4 (isolation) can be developed in parallel with S3 (audit trail) once `assertion-helpers.mjs` is stable.
- Kafka consumer implementation can proceed in parallel with any scenario implementation.
- `quickstart.md` authoring can proceed in parallel with final CI wiring.

## Definition of Done

A task implementation is done when all of the following are true:

1. All six scenario files (`S1`–`S6`) pass locally and in CI with exit code 0.
2. The machine-readable JSON result artefact is emitted per run with `summary.failed === 0`.
3. Every quota dimension registered in `quota_dimension_catalog` is covered by at least one upgrade and one downgrade assertion.
4. Audit correlation assertions confirm T04 history records are present within 30 s for every transition performed by the suite.
5. Multi-tenant isolation scenario (`S4`) produces observable evidence (pre/post snapshots compared) of zero cross-tenant leakage.
6. Round-trip scenario (`S5`) validates two independent history entries and the correct final state.
7. All edge cases in `S6` pass, including the concurrent plan change serialization test.
8. CI pipeline step is registered and causes a pipeline failure on any assertion regression.
9. `quickstart.md` describes how to run the suite locally, configure env vars, and interpret output.
10. All fixture data is cleaned up after a successful or failed run (confirmed by post-run absence of fixture tenant records in the database).
11. Suite execution time is under 5 minutes for the default resource counts in CI mode.

## Expected implementation evidence

- `node:test` TAP output and JSON summary artefact from a successful CI run.
- Sample machine-readable result JSON showing all six scenarios as `PASS` with per-dimension status entries.
- Kafka event log (`kafka-events-observed.json`) showing `console.plan.change-impact-recorded` events correlated to each transition.
- CI pipeline step log confirming sub-5-minute execution.
- Post-run database query confirming no orphaned fixture tenants or plans remain.
