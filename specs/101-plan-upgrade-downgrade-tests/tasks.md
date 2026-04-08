# Tasks: Plan Upgrade/Downgrade Verification Tests

**Feature Branch**: `101-plan-upgrade-downgrade-tests`
**Feature Dir**: `specs/101-plan-upgrade-downgrade-tests/`
**Input**: `spec.md` + `plan.md`
**Task ID**: US-PLAN-01-T05 | **Epic**: EP-19 | **Story**: US-PLAN-01
**Depends on**: T01 (`097-plan-entity-tenant-assignment`), T02 (`098-plan-base-limits`), T03 (`099-plan-management-api-console`), T04 (`100-plan-change-impact-history`) — all must be merged before implementation begins

**Tech Stack**: Node.js 20+ ESM (`"type": "module"`), `node:test`, `node:assert`, `undici` (HTTP to APISIX), `pg` (PostgreSQL fixture seeding + state assertions), `kafkajs` (audit event verification), `@in-falcone/internal-contracts`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (independent files, no dependency on an incomplete task in this list)
- **[Story]**: User story label (S1–S6)
- Exact file paths are included in every task description
- **No production code is introduced.** All artefacts are test/fixture files.

---

## File Path Map (implementation reference)

> ⚠️ **Mandatory read constraints for the implement step**:
> - Read only the specific files listed below. Do NOT read `apps/control-plane/openapi/control-plane.openapi.json` directly.
> - For OpenAPI contracts, read only relevant family files under `specs/100-plan-change-impact-history/contracts/` and `specs/099-plan-management-api-console/contracts/` (if present).
> - Do NOT do broad exploratory directory listings. Use the map below as the authoritative file index.

```text
tests/e2e/101-plan-upgrade-downgrade-tests/
├── index.test.mjs                                         ← NEW: CI entry point; registers global setup/teardown; imports all scenarios
├── fixtures/
│   ├── seed-plans.mjs                                     ← NEW: seed test-starter + test-professional fixture plans with known limits/capabilities
│   ├── seed-tenant-resources.mjs                         ← NEW: create quota-governed resources for a given tenant/plan combo
│   ├── teardown.mjs                                       ← NEW: idempotent full fixture cleanup (resources, assignments, fixture plans)
│   └── mock-usage-unavailable.mjs                         ← NEW: simulate temporarily unavailable usage dimensions (edge case S6)
├── helpers/
│   ├── plan-api-client.mjs                                ← NEW: undici-based typed wrappers for plan assignment + effective-entitlements APIs
│   ├── resource-api-client.mjs                            ← NEW: resource-count and per-resource accessibility verification helpers
│   ├── audit-query-client.mjs                             ← NEW: plan change history query helpers; time-bounded poll for audit record presence
│   ├── kafka-consumer.mjs                                 ← NEW: lightweight kafkajs consumer for audit event verification
│   └── assertion-helpers.mjs                              ← NEW: reusable assert wrappers for verification result shape and dimension status
└── scenarios/
    ├── upgrade-preserves-resources.test.mjs               ← NEW: S1 — upgrade starter→professional; resource preservation
    ├── downgrade-surfaces-overlimit.test.mjs              ← NEW: S2 — downgrade professional→starter; over-limit detection
    ├── audit-trail-verification.test.mjs                  ← NEW: S3 — audit record correctness and T04 history correlation
    ├── multitenant-isolation.test.mjs                     ← NEW: S4 — plan change does not affect other tenants
    ├── round-trip-transition.test.mjs                     ← NEW: S5 — upgrade-then-downgrade round trip
    └── edge-cases.test.mjs                                ← NEW: S6 — zero-resource tenant, at-limit, missing dimension, unavailable usage, concurrent change, overrides

specs/101-plan-upgrade-downgrade-tests/
├── spec.md      ← READ: feature requirements, acceptance criteria, edge cases
├── plan.md      ← READ: implementation design, fixture plan definitions, scenario details, env vars
└── quickstart.md ← NEW (T013): local run guide, env vars, output interpretation

Reference files (read as needed, targeted reads only):
  services/provisioning-orchestrator/src/actions/plan-assign.mjs              ← T01/T04: plan assignment action interface
  services/provisioning-orchestrator/src/actions/plan-effective-entitlements-get.mjs  ← T04: entitlements action
  services/provisioning-orchestrator/src/actions/plan-change-history-query.mjs        ← T04: history query action
  services/provisioning-orchestrator/src/models/effective-entitlement-snapshot.mjs   ← T04: status classification helpers
  services/gateway-config/routes/plan-management-routes.yaml                   ← T03/T04: APISIX route definitions
  tests/integration/100-plan-change-impact-history/fixtures/seed-plan-history.mjs     ← T04: reuse seed patterns
  tests/integration/100-plan-change-impact-history/fixtures/seed-tenant-usage.mjs     ← T04: reuse usage seed patterns
  tests/e2e/functions/functions-audit.test.mjs                                 ← existing e2e: structural reference
  specs/100-plan-change-impact-history/contracts/                               ← T04 contract schemas (read specific files only)
```

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the directory skeleton and shared package config so all phases can proceed independently.

- [ ] T001 Create directory skeleton `tests/e2e/101-plan-upgrade-downgrade-tests/` with subdirectories `fixtures/`, `helpers/`, `scenarios/`. Create `tests/e2e/101-plan-upgrade-downgrade-tests/package.json` as a minimal ESM descriptor: `{ "type": "module" }` (no new dependencies — all imports come from monorepo root `node_modules`).

- [ ] T002 [P] Create `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/assertion-helpers.mjs` exporting:
  - `assertDimensionStatus(actual, expectedKey, expectedStatus)` — asserts a single dimension entry in an effective-entitlements response has the correct `status` (`within_limit | at_limit | over_limit | usage_unavailable`)
  - `assertAllDimensionsAccessible(entitlementsResponse)` — asserts no dimension has `over_limit` or `usage_unavailable`
  - `assertOverLimitDimension(entitlementsResponse, dimensionKey, expectedUsage, expectedLimit)` — asserts a specific dimension is flagged `over_limit` with correct usage and effective limit values
  - `assertCapabilityState(entitlementsResponse, capabilityKey, expectedEnabled)` — asserts a boolean capability is `enabled` or `disabled` as expected
  - `assertResourceResponseUnchanged(snapshotBefore, snapshotAfter)` — deep-equality check on resource-list payloads excluding volatile fields (`updatedAt`, `requestId`)
  - `assertVerificationResultShape(result)` — validates machine-readable JSON result has required fields: `runId`, `timestamp`, `scenarios[]`, `summary.{total,passed,failed}`
  Inline self-tests (using `node:test`) for each helper to verify correct classification given crafted input payloads. Read `specs/101-plan-upgrade-downgrade-tests/plan.md` section "Verification result shape interpretation" for expected status values.

- [ ] T003 [P] Create `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/plan-api-client.mjs` exporting typed `undici`-based HTTP wrappers:
  - `assignPlan(tenantId, planSlug, token)` → `POST /v1/tenants/{tenantId}/plan` — returns `{ status, body }`
  - `getEffectiveEntitlements(tenantId, token)` → `GET /v1/tenants/{tenantId}/plan/effective-entitlements` — returns full entitlements response
  - `getPlanChangeHistory(tenantId, token, params?)` → `GET /v1/tenants/{tenantId}/plan/history-impact` — returns paginated history
  - `createPlan(payload, token)` → `POST /v1/plans` — used by `seed-plans.mjs`
  - `deletePlan(planSlug, token)` → `DELETE /v1/plans/{planSlug}` — used by teardown
  All methods accept `baseUrl` from env `TEST_API_BASE_URL`. All methods propagate HTTP errors as structured objects `{ status, code, body }` rather than throwing, so callers can assert on error codes. Read `services/gateway-config/routes/plan-management-routes.yaml` for route paths.

- [ ] T004 [P] Create `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/resource-api-client.mjs` exporting:
  - `listResources(dimensionKey, tenantId, token)` → dispatches to the appropriate platform API path per `dimensionKey` (workspaces, postgres-databases, mongo-databases, kafka-topics, functions, storage-objects, api-keys, members)
  - `snapshotAllResources(tenantId, token)` → calls `listResources` for every dimension key and returns `Map<dimensionKey, items[]>`
  - `assertResourcesUnchanged(snapshotBefore, snapshotAfter)` → compares snapshots item-by-item using `assertResourceResponseUnchanged` from `assertion-helpers.mjs`
  - `countPerDimension(snapshot)` → `Map<dimensionKey, number>` — for pre/post count comparison
  Read `specs/101-plan-upgrade-downgrade-tests/plan.md` (section "R-03 Resource seeding") for all dimension keys and their resource management API paths.

**Checkpoint**: Helper modules and directory scaffolding ready — all fixture and scenario tasks may start.

---

## Phase 2: Fixture Helpers

**Purpose**: Implement idempotent setup and teardown fixtures that every scenario depends on.

- [ ] T005 Create `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/seed-plans.mjs` exporting:
  - `seedFixturePlans(token)` — creates `test-starter` and `test-professional` plans via `plan-api-client.mjs` `createPlan` using the exact `quota_dimensions` and `capabilities` values defined in `specs/101-plan-upgrade-downgrade-tests/plan.md` section "Data model and fixture plans". Uses idempotent upsert: if a plan with the same slug already exists, skips creation and returns the existing plan. Aborts with a diagnostic if a slug collision is detected against a production plan (i.e., plan exists but name does not contain `"E2E fixture"`).
  - `getFixturePlanSlugs()` → `{ starter: 'test-starter', professional: 'test-professional' }`
  Read `specs/101-plan-upgrade-downgrade-tests/plan.md` section "Data model and fixture plans" for the exact JSON fixture plan definitions.

- [ ] T006 Create `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/seed-tenant-resources.mjs` exporting:
  - `seedResourcesToCount(tenantId, dimensionKey, count, token)` — creates exactly `count` resources of the given type for the tenant via platform API; skips if already at count; returns array of created resource identifiers
  - `seedResourcesForPlan(tenantId, planSlug, token)` — calls `seedResourcesToCount` for every quota dimension in the named fixture plan up to that plan's defined limit (uses limits from `seed-plans.mjs` fixture definitions, not a live API call); returns `Map<dimensionKey, resourceIds[]>`
  - `seedResourcesToFraction(tenantId, planSlug, fraction, token)` — seeds to `Math.floor(limit * fraction)` per dimension; used by S4 (isolation, seeds to 0.5 of limits)
  Uses retry with exponential backoff (max 3 attempts, base 500 ms) for transient API failures. Read `tests/integration/100-plan-change-impact-history/fixtures/seed-tenant-usage.mjs` for existing seed patterns to reuse.

- [ ] T007 [P] Create `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/teardown.mjs` exporting:
  - `teardownTenant(tenantId, token)` — deletes all resources for the tenant (calls resource-api-client for each dimension), removes plan assignment, deletes the tenant record; handles 404 (already deleted) gracefully
  - `teardownFixturePlans(token)` — deletes `test-starter` and `test-professional` plans if they exist; handles 404 gracefully
  - `teardownAll(tenantIds[], token)` — calls `teardownTenant` for each tenant in the array, then `teardownFixturePlans`; safe to call after a failed run
  All operations are idempotent and log warnings (not errors) for already-deleted resources.

- [ ] T008 [P] Create `tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/mock-usage-unavailable.mjs` exporting:
  - `buildUnavailableDimensionResponse(dimensionKey)` → crafts a response fragment where `dimensionKey` has `status: 'usage_unavailable'` for use in assertion-helpers unit tests and the S6 edge case
  - `injectUnavailableDimension(tenantId, dimensionKey, token)` — if the platform supports a test-only override mechanism for dimension availability, uses it; otherwise marks the dimension as simulated in test state; documents clearly in file header if injection is not possible at the API level (some edge cases may rely on assertion-helpers unit tests only)
  Read `specs/101-plan-upgrade-downgrade-tests/plan.md` section "R-04 Verification result shape interpretation" for `usage_unavailable` semantics.

**Checkpoint**: All fixture helpers ready — scenario files may be implemented.

---

## Phase 3: Core Scenarios (Priority P1 — S1, S2, S3)

**Purpose**: Implement the three highest-priority user story scenarios. S1 and S2 can run in parallel; S3 depends on S1+S2 patterns being established.

- [ ] T009 [S1] Create `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/upgrade-preserves-resources.test.mjs` implementing Scenario S1 using `node:test`:

  ```text
  Setup:
    • create fixture tenant "test-tenant-upgrade-{runSuffix}" via platform API
    • assign test-starter plan
    • call seedResourcesForPlan(tenantId, 'test-starter', token) to reach 100% of starter limits
    • snapshot all resources via snapshotAllResources()

  Action:
    • call plan-api-client assignPlan(tenantId, 'test-professional', token)
    • assert response status is 200 or 202

  Assertions:
    • getEffectiveEntitlements → assertAllDimensionsAccessible (no over_limit flags)
    • getEffectiveEntitlements → for each dimension, effective limit ≥ test-professional limit from fixture plan
    • getEffectiveEntitlements → assertCapabilityState for realtime_enabled=true, custom_domains_enabled=true, audit_log_export_enabled=true
    • snapshotAllResources() post-upgrade → assertResourcesUnchanged(snapshotBefore, snapshotAfter)
    • countPerDimension(postSnapshot) === countPerDimension(preSnapshot) for every dimension
    • no resource in any dimension-list response has a status field indicating disabled/restricted/error

  Teardown:
    • teardownTenant(tenantId, token)
  ```

  Run suffix is generated as `Date.now().toString(36) + Math.random().toString(36).slice(2,6)` to isolate parallel CI runs. Import only from `../helpers/*.mjs` and `../fixtures/*.mjs`.

- [ ] T010 [P] [S2] Create `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/downgrade-surfaces-overlimit.test.mjs` implementing Scenario S2 using `node:test`:

  ```text
  Setup:
    • create fixture tenant "test-tenant-downgrade-{runSuffix}"
    • assign test-professional plan
    • seedResourcesForPlan(tenantId, 'test-professional', token) — 100% of professional limits
    • snapshot all resources pre-downgrade

  Action:
    • assignPlan(tenantId, 'test-starter', token) — assert 200/202

  Assertions:
    • snapshotAllResources() post-downgrade → assertResourcesUnchanged(snapshotBefore, snapshotAfter)
    • countPerDimension post === countPerDimension pre for every dimension (zero deletion)
    • getEffectiveEntitlements → for every dimension where professional_limit > starter_limit:
        assertOverLimitDimension(dimensionKey, expectedUsage=professional_limit, expectedLimit=starter_limit)
    • getEffectiveEntitlements → capabilities: realtime_enabled=false, custom_domains_enabled=false, audit_log_export_enabled=false
    • assert no resource-list response changes status or count between pre- and post-downgrade snapshots

  Teardown:
    • teardownTenant(tenantId, token)
  ```

- [ ] T011 [S3] Create `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/audit-query-client.mjs` exporting:
  - `pollForHistoryEntry(tenantId, expectedSourcePlan, expectedTargetPlan, token, timeoutMs?)` — polls `GET /v1/tenants/{tenantId}/plan/history-impact` at 2-second intervals until a matching history entry is found or `timeoutMs` (default: `PLAN_CHANGE_AUDIT_POLL_TIMEOUT_MS` env var, fallback 30000) is exceeded; returns the entry or throws a timeout error with the last observed response
  - `assertHistoryEntry(entry, expectations)` — asserts entry has: `sourcePlanSlug`, `targetPlanSlug`, `changeDirection`, correct `overLimitDimensionCount`, and that each expected over-limit dimension is present in `quotaImpacts[]` with `usageStatus = 'over_limit'`, `observedUsage`, and `newEffectiveValue` matching expected values
  - `assertHistoryEntryCount(tenantId, expectedCount, token)` — asserts total number of history entries for the tenant
  Read `services/provisioning-orchestrator/src/actions/plan-change-history-query.mjs` for response shape. Read `specs/100-plan-change-impact-history/contracts/` (specific files only, not directory listing) for field names.

- [ ] T012 [S3] Create `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/audit-trail-verification.test.mjs` implementing Scenario S3 using `node:test`:

  ```text
  Setup:
    • create fixture tenant "test-tenant-audit-{runSuffix}"
    • assign test-starter → seed resources to 100% starter limits

  Action A — Upgrade:
    • assignPlan(tenantId, 'test-professional', token)

  Assertions A:
    • pollForHistoryEntry(tenantId, 'test-starter', 'test-professional', token) — returns within 30 s
    • assertHistoryEntry: changeDirection='upgrade', overLimitDimensionCount=0
    • history entry quotaImpacts: every dimension has usageStatus='within_limit' or 'at_limit' (none 'over_limit')
    • history entry capabilityImpacts: realtime_enabled previous=false, new=true; comparison='enabled'

  Action B — Downgrade:
    • assignPlan(tenantId, 'test-starter', token)

  Assertions B:
    • pollForHistoryEntry(tenantId, 'test-professional', 'test-starter', token)
    • assertHistoryEntry: changeDirection='downgrade', overLimitDimensionCount=<expected per dimension diff count>
    • for each over-limit dimension: observedUsage=professional_limit, newEffectiveValue=starter_limit, usageStatus='over_limit'
    • assertHistoryEntryCount(tenantId, 2) — exactly two entries, one per transition

  Isolation:
    • re-fetch history entry A after action B and verify its values are unchanged (immutability)

  Teardown:
    • teardownTenant(tenantId, token)
  ```

**Checkpoint**: S1, S2, S3 scenarios implemented and passing locally — higher-priority regression protection in place.

---

## Phase 4: Isolation and Round-Trip Scenarios (Priority P2 — S4, S5)

- [ ] T013 [P] [S4] Create `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/multitenant-isolation.test.mjs` implementing Scenario S4 using `node:test`:

  ```text
  Setup:
    • create "test-tenant-alpha-{runSuffix}" → assign test-professional → seedResourcesToFraction(tenantId, 'test-professional', 0.5, token)
    • create "test-tenant-beta-{runSuffix}" → assign test-starter → seedResourcesToFraction(tenantId, 'test-starter', 0.5, token)
    • snapshot beta: betaEntitlementsBefore = getEffectiveEntitlements(beta)
    • snapshot beta resources: betaResourcesBefore = snapshotAllResources(beta)
    • capture beta history entry count before

  Action:
    • assignPlan(alpha, 'test-starter', token)  ← downgrade alpha

  Assertions:
    • betaEntitlementsAfter = getEffectiveEntitlements(beta)
      → assertResourceResponseUnchanged(betaEntitlementsBefore, betaEntitlementsAfter) — bit-for-bit equality (ignore volatile fields)
    • betaResourcesAfter = snapshotAllResources(beta)
      → assertResourcesUnchanged(betaResourcesBefore, betaResourcesAfter)
    • assertHistoryEntryCount(beta, originalBetaCount) — no new entries for beta

  Teardown:
    • teardownTenant(alpha, token) + teardownTenant(beta, token)
  ```

- [ ] T014 [P] [S5] Create `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/round-trip-transition.test.mjs` implementing Scenario S5 using `node:test`:

  ```text
  Setup:
    • create "test-tenant-roundtrip-{runSuffix}" → assign test-starter
    • seedResourcesForPlan(tenantId, 'test-starter', token) — starter limits (phase-1 resources)
    • snapshot phase-1 resources: phase1Snapshot

  Action A — Upgrade:
    • assignPlan(tenantId, 'test-professional', token)
    • seed additional resources to reach professional limits using seedResourcesToCount per dimension
      (target: professional_limit - starter_limit additional resources per dimension)
    • snapshot combined resources: phase2Snapshot

  Action B — Downgrade:
    • assignPlan(tenantId, 'test-starter', token)

  Assertions:
    • snapshotAllResources() post-downgrade → assertResourcesUnchanged(phase2Snapshot, phase3Snapshot) — all resources preserved
    • getEffectiveEntitlements → effective limits match test-starter limits (not professional)
    • for every dimension where phase2 count > starter_limit:
        assertOverLimitDimension(dimensionKey, usage=phase2count, effectiveLimit=starter_limit)
    • resources seeded in phase 1 (phase1Snapshot IDs) are all still present in phase3Snapshot
    • assertHistoryEntryCount(tenantId, 2) — exactly two entries
    • pollForHistoryEntry(tenantId, 'test-starter', 'test-professional', ...) and
      pollForHistoryEntry(tenantId, 'test-professional', 'test-starter', ...) both resolve
    • effective entitlements after round-trip exactly match entitlements right after first starter assignment

  Teardown:
    • teardownTenant(tenantId, token)
  ```

**Checkpoint**: All five main scenario files implemented.

---

## Phase 5: Edge Cases (S6)

- [ ] T015 [S6] Create `tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/edge-cases.test.mjs` implementing Scenario S6 as a `node:test` suite with six sub-tests:

  **EC-1 Zero-resource tenant**:

  ```text
  • create tenant, assign test-starter (no resources seeded)
  • assignPlan(tenantId, 'test-professional', token)
  • assertAllDimensionsAccessible(getEffectiveEntitlements) — zero over-limit flags
  • verify effective limits match test-professional; no errors
  • assignPlan back to test-starter; same assertions
  ```

  **EC-2 Usage exactly at target limit (at_limit)**:

  ```text
  • create tenant on test-professional
  • seedResourcesToCount(tenantId, 'max_workspaces', starter_workspace_limit, token) — exactly 3 workspaces
  • assignPlan(tenantId, 'test-starter', token)
  • assertDimensionStatus(entitlements, 'max_workspaces', 'at_limit') — must be at_limit, not over_limit
  ```

  **EC-3 Dimension present in source but not in target plan**:

  ```text
  • if quota_dimension_catalog has a dimension only in one fixture plan, verify post-change entitlements
    do not silently omit it; assert it appears with an appropriate status or effective value
  • if no such asymmetric dimension exists in the fixture plans, verify that entitlements response
    lists all dimensions from quota_dimension_catalog with non-null statuses
  ```

  **EC-4 Usage temporarily unavailable**:

  ```text
  • use assertion-helpers.mjs assertDimensionStatus with a crafted response from mock-usage-unavailable.mjs
    that includes usage_unavailable for one dimension
  • assert suite records it as a warning (not FAIL) when MAX_UNKNOWN_DIMENSIONS_ALLOWED >= 1
  • assert suite records it as FAIL when MAX_UNKNOWN_DIMENSIONS_ALLOWED = 0 (strict CI mode)
  ```

  **EC-5 Concurrent plan change serialization**:

  ```text
  • create tenant, assign test-starter
  • fire two simultaneous undici requests: assignPlan(tenantId, 'test-professional') in parallel
  • wait for both to settle
  • assert exactly one returns 200/202 and the other returns 409 (or serialization-error status per T01 contract)
  • getEffectiveEntitlements → plan slug is internally consistent (either all-starter or all-professional, not mixed)
  • assertHistoryEntryCount(tenantId, 1) — only one committed transition
  ```

  **EC-6 Override-governed dimension**:

  ```text
  • if the platform supports tenant-specific overrides above base plan limits:
    create tenant on test-starter; apply override for max_workspaces = 7 (above professional limit of 10? No — use 7 > starter 3)
    assignPlan(tenantId, 'test-professional', token)
    verify effective limit for max_workspaces reflects override (7 or the max of plan+override per T01 semantics)
  • if overrides are not yet resolvable, skip test with t.skip() and a diagnostic comment
  ```

  Read `specs/101-plan-upgrade-downgrade-tests/plan.md` section "Edge Cases" and "R-04" for expected behaviours. Read `specs/101-plan-upgrade-downgrade-tests/spec.md` "Edge Cases" section for acceptance criteria.

---

## Phase 6: Kafka Consumer and Audit Event Verification

- [ ] T016 [P] Create `tests/e2e/101-plan-upgrade-downgrade-tests/helpers/kafka-consumer.mjs` exporting:
  - `createConsumer(groupId?)` — initialises a `kafkajs` consumer using `KAFKA_BROKERS` env var; `groupId` defaults to `test-101-${Date.now()}`
  - `consumeUntilEvent(consumer, topic, matchFn, timeoutMs?)` — polls topic until `matchFn(event)` returns true or timeout (default 15000 ms); returns matched event or `null` on timeout (does NOT throw — Kafka failures are warnings, not test failures)
  - `assertPlanAssignmentEvent(consumer, tenantId, targetPlanSlug)` — calls `consumeUntilEvent` on `console.plan.assignment.created` or `console.plan.assignment.superseded` and asserts `tenantId` and `planSlug` match
  - `assertChangeImpactEvent(consumer, tenantId)` — calls `consumeUntilEvent` on `console.plan.change-impact-recorded` and asserts `tenantId` matches
  - `disconnectConsumer(consumer)` — graceful shutdown
  Kafka assertions are gated by `process.env.KAFKA_ENABLED === 'true'`. If disabled, functions log a diagnostic and return `null` without failing. Read `specs/101-plan-upgrade-downgrade-tests/plan.md` section "Kafka events to verify" for topic names.

---

## Phase 7: Suite Entry Point, CI Wiring, and Documentation

- [ ] T017 Create `tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs` as the suite entry point:
  - `before()` hook: calls `seedFixturePlans(superadminToken)`, validates fixture plans exist, initialises optional Kafka consumer
  - `after()` hook: calls `teardownAll([], superadminToken)` (only fixture plans, not tenants — each scenario tears down its own tenant); calls `disconnectConsumer` if consumer was initialised
  - `import` (does NOT `require`) each scenario file so `node:test` discovers their tests: `upgrade-preserves-resources`, `downgrade-surfaces-overlimit`, `audit-trail-verification`, `multitenant-isolation`, `round-trip-transition`, `edge-cases`
  - After test run completes, emits a machine-readable JSON summary to `process.stdout` (or `TEST_RESULT_OUTPUT_PATH` if set) matching the schema in `specs/101-plan-upgrade-downgrade-tests/plan.md` section "Machine-readable result artefact": `{ runId, timestamp, scenarios[], summary: { total, passed, failed } }`
  - Reads required env vars on startup and throws a clear diagnostic if any are missing: `TEST_API_BASE_URL`, `TEST_SUPERADMIN_TOKEN`, `TEST_PG_DSN`
  - Reads optional env vars with documented defaults: `KAFKA_ENABLED=false`, `KAFKA_BROKERS`, `MAX_UNKNOWN_DIMENSIONS_ALLOWED=0`, `PLAN_CHANGE_AUDIT_POLL_TIMEOUT_MS=30000`, `TEST_RESULT_OUTPUT_PATH`

- [ ] T018 [P] Add CI pipeline step to the appropriate workflow file (read existing workflow files in `.github/workflows/` or `ci/` to identify the correct file — do NOT create a new workflow file unless none exists):
  - Step name: `Plan Upgrade/Downgrade E2E Tests`
  - Command: `node --test --test-reporter=tap tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs`
  - Triggered on: merges or pull requests touching `tests/e2e/101-plan-upgrade-downgrade-tests/**`, `specs/101-plan-upgrade-downgrade-tests/**`, or `services/provisioning-orchestrator/src/actions/plan-*.mjs`
  - Required env vars injected from CI secrets: `TEST_API_BASE_URL`, `TEST_SUPERADMIN_TOKEN`, `TEST_PG_DSN`
  - Optional: `KAFKA_ENABLED=true`, `KAFKA_BROKERS` if Kafka integration environment is available in CI
  - Upload `test-results/101-plan-upgrade-downgrade-tests-result.json` as a CI artefact if `TEST_RESULT_OUTPUT_PATH` is set

- [ ] T019 [P] Create `specs/101-plan-upgrade-downgrade-tests/quickstart.md` describing:
  - Prerequisites: T01–T04 merged, platform APIs accessible, env vars listed
  - How to run the full suite locally: `node --test tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs`
  - How to run a single scenario: `node --test tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/upgrade-preserves-resources.test.mjs`
  - Required and optional environment variables with descriptions and defaults
  - How to interpret TAP output and the JSON summary artefact
  - How to run in strict mode (MAX_UNKNOWN_DIMENSIONS_ALLOWED=0) vs lenient mode
  - Teardown: if a run is interrupted, run `node tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/teardown.mjs` as a standalone script with required env vars
  - Linking to `plan.md` for full scenario descriptions and `spec.md` for acceptance criteria

---

## Dependency Graph

```text
T001 (scaffold)
  └─→ T002 (assertion-helpers)    ─────────┐
  └─→ T003 (plan-api-client)      ─────────┤
  └─→ T004 (resource-api-client)  ─────────┤
                                            ↓
T005 (seed-plans)    ←── T003              T009 (S1)  ─────────────────────┐
T006 (seed-tenant-resources) ←── T004      T010 (S2)  ─────────────────────┤
T007 (teardown)                            T011 (audit-query-client)        ↓
T008 (mock-usage-unavailable) ←── T002     T012 (S3) ←── T011              T017 (index.test.mjs)
                                            T013 (S4)  ─────────────────────┤
T002,T003,T004,T005,T006,T007              T014 (S5)  ─────────────────────┤
  └─→ T009, T010, T013, T014, T015         T015 (S6) ←── T008              ┤
                                            T016 (kafka-consumer) ──────────┤
                                            T018 (CI wiring) ───────────────┤
                                            T019 (quickstart.md) ───────────┘
```

**Phases 1 and 2 must complete before scenario implementations begin (T009–T016).**  
**T017 must be the last task before CI wiring (T018).**  
S1 and S2 (T009, T010) can be implemented in parallel once helpers and fixtures are ready.  
S4 and S5 (T013, T014) can be implemented in parallel with S3 (T011, T012).  
T016 (Kafka consumer) can be implemented in parallel with any scenario.  

---

## Definition of Done

A task implementation is done when all of the following are true:

1. All six scenario files (S1–S6) pass locally and in CI with exit code 0.
2. The machine-readable JSON summary is emitted per run with `summary.failed === 0`.
3. Every quota dimension in `quota_dimension_catalog` is covered by at least one upgrade and one downgrade assertion.
4. Audit correlation assertions confirm T04 history records are present within 30 s (per `PLAN_CHANGE_AUDIT_POLL_TIMEOUT_MS`) for every transition performed.
5. S4 (multi-tenant isolation) produces pre/post snapshots confirming zero cross-tenant leakage.
6. S5 (round-trip) validates exactly two independent history entries and the correct final state.
7. All six edge cases in S6 pass, including the concurrent serialization test (EC-5).
8. CI pipeline step is registered and causes pipeline failure on any assertion regression.
9. `quickstart.md` (T019) describes local run, env vars, and output interpretation.
10. All fixture data is cleaned up after a successful or failed run; post-run teardown confirms no orphaned fixture tenants or plans remain in the database.
11. Suite execution time is under 5 minutes for default resource counts in CI mode (SC-005).
