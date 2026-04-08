# Tasks: Semántica de Reintento y Casos de Intervención Manual

**Feature**: 078-retry-semantics-manual-intervention  
**Branch**: `078-retry-semantics-manual-intervention`  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Task**: US-UIB-02-T06 | **Epic**: EP-16 | **Historia**: US-UIB-02

---

## Implementation Strategy

**MVP Scope**: Phase 3 (US1 — failure classification) + Phase 4 (US2 — manual intervention signaling). These two P1 stories deliver the core value: classified failures with actionable UI, blocked retries for exhausted operations, and superadmin override.

**Incremental delivery**:
1. Phase 1–2 establish the data layer (migration, models, repos, schemas, events) — no visible change until Phase 3+.
2. Phase 3 surfaces failure classification in the operation response (non-breaking extension).
3. Phase 4 adds the manual intervention flag and override capability.
4. Phases 5–6 add the retry semantics query contract and proactive notifications (P2).
5. Phase 7 completes the audit trail (P3).
6. Phase 8 closes cross-cutting concerns and documentation.

**Parallelizable work**: Phase 2 model tasks (T006–T009) and contract/schema tasks (T014–T017) can run in parallel once Phase 1 is committed. Unit tests can be written alongside implementation (TDD).

---

## Dependencies Graph

```text
Phase 1 (Setup)
  └─► Phase 2 (Foundation: migration, models, repos, events, schemas)
        ├─► Phase 3 [US1] (failure classification + action extension + tests)
        │     └─► Phase 4 [US2] (manual intervention + retry-override action + tests)
        │           └─► Phase 5 [US3] (retry semantics profile query + tests)
        │                 └─► Phase 6 [US4] (proactive notification + debounce + tests)
        │                       └─► Phase 7 [US5] (audit events + contract tests)
        └─► Phase 8 (Polish: contract-boundary, internal-contracts index, AGENTS.md)
```

**Story-level dependencies**:
- US1 depends on: Foundation (migration + failure-classification model + failure-code-mappings repo + events)
- US2 depends on: US1 (needs classified failures to decide when to set intervention flag) + manual-intervention-flag model + retry-override model + override repo
- US3 depends on: Foundation (retry-semantics-profile model + repo)
- US4 depends on: US2 (needs the manual-intervention flag to trigger notifications) + intervention-notify action
- US5 depends on: US1 + US2 (needs all 4 Kafka event builders in place)

---

## Phase 1: Setup

- [ ] T001 Verify branch `078-retry-semantics-manual-intervention` is active and that unrelated untracked files (070/072 specs) are preserved: `git status` check in `/root/projects/falcone`
- [ ] T002 Create spec contracts directory at `specs/078-retry-semantics-manual-intervention/contracts/` and verify all plan-defined contract files are scaffolded (empty JSON stubs) to unblock parallel work: `retry-semantics-profile.json`, `failure-classification.json`, `manual-intervention-flag.json`, `retry-override.json`, `failure-classified-event.json`, `manual-intervention-required-event.json`, `retry-override-event.json`, `intervention-notification-event.json`, `retry-semantics-profile-query-response.json`

---

## Phase 2: Foundation

### Migration & Schema

- [ ] T003 Create PostgreSQL migration file `services/provisioning-orchestrator/src/migrations/078-retry-semantics-intervention.sql` with: (1) `ALTER TABLE async_operations ADD COLUMN IF NOT EXISTS failure_category TEXT CHECK (...), failure_error_code TEXT, failure_description TEXT, failure_suggested_actions JSONB, manual_intervention_required BOOLEAN NOT NULL DEFAULT FALSE`; (2) `CREATE TABLE IF NOT EXISTS failure_code_mappings` with UNIQUE(error_code, operation_type), priority, CHECK on failure_category; (3) `CREATE TABLE IF NOT EXISTS retry_semantics_profiles` with UNIQUE(operation_type); (4) `CREATE TABLE IF NOT EXISTS manual_intervention_flags` with UNIQUE(operation_id), status CHECK, last_notification_at, resolution fields; (5) `CREATE TABLE IF NOT EXISTS retry_overrides` with status CHECK; (6) all required indexes; (7) seed `__default__` profile in `retry_semantics_profiles`; (8) seed base `failure_code_mappings` (HTTP 5xx→transient, 4xx client→permanent, INFRA_FAILURE→requires_intervention); (9) rollback section as comment block. All DDL must be idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING for seeds).

### Domain Models

- [ ] T004 [P] Create `services/provisioning-orchestrator/src/models/failure-classification.mjs` (ESM) with: `FailureCategory` enum (`transient`, `permanent`, `requires_intervention`, `unknown`); `FailureClassification` value object with fields `category`, `errorCode`, `description`, `suggestedActions`; `classifyByErrorCode(errorCode, operationType, mappingCache)` function that (1) looks for exact match `(errorCode, operationType)`, (2) falls back to generic `(errorCode, null)`, (3) returns `unknown` if no match; `loadMappingCache(rows)` factory; input validation; named exports.
- [ ] T005 [P] Create `services/provisioning-orchestrator/src/models/retry-semantics-profile.mjs` (ESM) with: `RetrySemanticProfile` value object with fields `operationType`, `maxRetries`, `backoffStrategy` (fixed/linear/exponential), `backoffBaseSeconds`, `interventionConditions`, `failureCategories`, `isDefault`; `resolveProfile(specific, defaultProfile)` function that merges specific-over-default; `DEFAULT_OPERATION_TYPE = '__default__'` constant; validation that `backoffStrategy` is one of the three allowed values; named exports.
- [ ] T006 [P] Create `services/provisioning-orchestrator/src/models/manual-intervention-flag.mjs` (ESM) with: `ManualInterventionFlag` value object with fields `flagId`, `operationId`, `tenantId`, `actorId`, `reason`, `attemptCountAtFlag`, `lastErrorCode`, `lastErrorSummary`, `status` (pending/resolved), `lastNotificationAt`, `createdAt`, `resolvedAt`, `resolvedBy`, `resolutionMethod`; `shouldDebounceNotification(flag, debounceMinutes)` function returning boolean (true if `lastNotificationAt` is within `debounceMinutes`); `createFlag(params)` factory; named exports.
- [ ] T007 [P] Create `services/provisioning-orchestrator/src/models/retry-override.mjs` (ESM) with: `RetryOverride` value object with fields `overrideId`, `operationId`, `flagId`, `tenantId`, `superadminId`, `justification`, `attemptNumber`, `status` (pending/completed/failed), `createdAt`, `completedAt`; validation that `justification.length >= 10`; `createOverride(params)` factory; named exports.

### Repositories

- [ ] T008 Create `services/provisioning-orchestrator/src/repositories/retry-semantics-profile-repo.mjs` (ESM) with functions: `findByOperationType(client, operationType)` returning profile row or null; `findDefault(client)` returning the `__default__` profile; `upsert(client, profile)` using `INSERT ... ON CONFLICT (operation_type) DO UPDATE`; tenant isolation not required (profiles are platform-wide); named exports.
- [ ] T009 Create `services/provisioning-orchestrator/src/repositories/manual-intervention-flag-repo.mjs` (ESM) with functions: `create(client, flag)` with UNIQUE constraint handling; `findByOperationId(client, operationId)` returning active flag or null; `findPendingByTenant(client, tenantId)` returning array; `resolveFlag(client, flagId, resolvedBy, resolutionMethod)` setting `status='resolved'`, `resolved_at`, `resolved_by`, `resolution_method`; `updateLastNotificationAt(client, flagId, timestamp)`; all queries filter by `tenant_id` where applicable; named exports.
- [ ] T010 Create `services/provisioning-orchestrator/src/repositories/retry-override-repo.mjs` (ESM) with functions: `createIfNotInProgress(client, override)` using `INSERT INTO retry_overrides (...) WHERE NOT EXISTS (SELECT 1 FROM retry_overrides WHERE operation_id=$1 AND status='pending')` returning `{ created: boolean, existing?: row }`; `findByOperationId(client, operationId)` returning latest override; `completeOverride(client, overrideId, status)` (completed/failed); named exports.
- [ ] T011 Extend `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` with: `updateFailureClassification(client, operationId, { failureCategory, failureErrorCode, failureDescription, failureSuggestedActions })` using `UPDATE async_operations SET ... WHERE operation_id=$1`; `setManualInterventionRequired(client, operationId, required: boolean)` using `UPDATE async_operations SET manual_intervention_required=$2 WHERE operation_id=$1`; both must be tenant-aware (accept tenantId and add to WHERE clause); named exports appended without breaking existing exports.

### Kafka Event Schemas (internal-contracts)

- [ ] T012 [P] Create `services/internal-contracts/src/failure-classified-event.json` with JSON Schema for `async_operation.failure_classified` event: required fields `eventId` (uuid), `eventType` (const), `operationId` (uuid), `tenantId` (string), `actorId` (string), `failureCategory` (enum: transient/permanent/requires_intervention/unknown), `errorCode` (string), `attemptCount` (integer), `maxRetries` (integer), `occurredAt` (date-time), `correlationId` (string). Use `$schema: "http://json-schema.org/draft-07/schema"`.
- [ ] T013 [P] Create `services/internal-contracts/src/manual-intervention-required-event.json` with JSON Schema for `async_operation.manual_intervention_required` event: required fields `eventId`, `eventType` (const), `operationId`, `flagId`, `tenantId`, `actorId`, `reason`, `attemptCountAtFlag` (integer), `lastErrorCode`, `occurredAt`, `correlationId`. Same `$schema`.
- [ ] T014 [P] Create `services/internal-contracts/src/retry-override-event.json` with JSON Schema for `async_operation.retry_override` event: required fields `eventId`, `eventType` (const), `overrideId`, `operationId`, `flagId`, `tenantId`, `superadminId`, `justification`, `attemptNumber` (integer), `newCorrelationId`, `occurredAt`. Same `$schema`.
- [ ] T015 [P] Create `services/internal-contracts/src/intervention-notification-event.json` with JSON Schema for `async_operation.intervention_notification` event: required fields `eventId`, `eventType` (const), `operationId`, `flagId`, `tenantId`, `recipientActorId`, `recipientRole` (enum: tenant_owner/superadmin), `operationType`, `failureSummary`, `suggestedActions` (array of strings), `occurredAt`, `correlationId`. Same `$schema`.

### Event Builders

- [ ] T016 Extend `services/provisioning-orchestrator/src/events/async-operation-events.mjs` with four new builder+publish functions: `buildFailureClassifiedEvent(params)`, `buildManualInterventionRequiredEvent(params)`, `buildRetryOverrideEvent(params)`, `buildInterventionNotificationEvent(params)`. Each builder: validates required fields, generates `eventId` (crypto.randomUUID), sets `eventType` constant, sets `occurredAt` to ISO8601 now. Add `publishFailureClassifiedEvent`, `publishManualInterventionRequiredEvent`, `publishRetryOverrideEvent`, `publishInterventionNotificationEvent` functions using kafkajs producer targeting the 4 new topics (`console.async-operation.failure-classified`, `console.async-operation.manual-intervention-required`, `console.async-operation.retry-override`, `console.async-operation.intervention-notification`). Append exports without breaking existing ones.

---

## Phase 3: US1 — Clasificación de Fallos y Orientación de Acción

**Story Goal**: Every failed operation exposes a `failureCategory` with appropriate suggested actions in the API response and in the console, enabling actors to distinguish retryable from permanent failures.

**Independent Test Criteria**: Trigger failures of each category (transient, permanent, requires_intervention, unknown). Confirm `failureCategory`, `failureDescription`, and `failureSuggestedActions` appear in the operation detail response within 3 seconds (SC-001). Confirm `console.async-operation.failure-classified` Kafka event emitted for each.

- [ ] T017 [US1] Extend `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs` to: (1) load `failure_code_mappings` into a module-level cache on first invocation (SELECT ordered by priority); (2) when transitioning an operation to `failed`, call `classifyByErrorCode(errorCode, operationType, cache)` to obtain classification; (3) call `updateFailureClassification(client, operationId, classification)` within the same transaction that sets `status='failed'`; (4) call `publishFailureClassifiedEvent` after commit; (5) if `failure_category = 'requires_intervention'`, trigger the manual intervention marking logic (see Phase 4 T018); (6) handle missing/null `errorCode` gracefully (classify as `unknown`). Preserve all existing transition logic unchanged.
- [ ] T018 [P] [US1] Write unit tests in `tests/unit/failure-classification.test.mjs` using `node:test` and dependency injection (no real DB): (1) exact match `(errorCode, operationType)`; (2) generic fallback `(errorCode, null)` when specific not found; (3) unknown errorCode → category `unknown`; (4) priority ordering when multiple entries share errorCode; (5) null/empty errorCode → `unknown`; (6) `loadMappingCache` from rows array.
- [ ] T019 [P] [US1] Write contract test in `tests/contract/failure-classified-event.contract.test.mjs` using `node:test`: call `buildFailureClassifiedEvent` with valid params and assert the output validates against `failure-classified-event.json` schema; test with each `failureCategory` enum value; test missing required field throws.

---

## Phase 4: US2 — Señalización de "Requiere Intervención Manual"

**Story Goal**: Operations exhausting their retry limit (or classified as `requires_intervention`) are flagged with `manualInterventionRequired=true`. Regular actors see 422 on retry attempts. Superadmins can force an override with auditable justification.

**Independent Test Criteria**: (1) Trigger `attempt_count >= max_retries` → verify `manual_intervention_required=true` in DB and API (SC-002). (2) Regular actor POST retry → 422 MANUAL_INTERVENTION_REQUIRED (SC-003). (3) Superadmin POST retry-override → override created, flag resolved, new attempt in pending, `retry-override` Kafka event emitted (SC-005). (4) Concurrent override → 409 OVERRIDE_IN_PROGRESS.

- [ ] T020 [US2] Complete the manual intervention marking logic in `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs`: after failure classification (T017 step 5), check if `attempt_count >= max_retries` (from retry semantics profile via `findByOperationType || findDefault`) OR `failure_category = 'requires_intervention'`; if so: (a) call `setManualInterventionRequired(client, operationId, true)` within the transaction; (b) call `manual-intervention-flag-repo.create(client, flag)` — if UNIQUE conflict exists (operation already has a flag), log warning and skip without throwing; (c) after commit, call `publishManualInterventionRequiredEvent`. Ensure all steps are within the existing transaction.
- [ ] T021 [US2] Extend `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs` (T03 action) to: as the FIRST check after loading the operation, verify `manual_intervention_required` field; if `true`, return HTTP 422 with body `{ error: 'MANUAL_INTERVENTION_REQUIRED', message: '...', operationId, flagId, hint: 'Contact your administrator or request a retry override.' }`; if field is NULL (pre-migration rows), treat as FALSE and continue normal T03 flow.
- [ ] T022 [US2] Create `services/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs` (new OpenWhisk action ESM): (1) verify `superadmin` role via authorization-context (return 403 FORBIDDEN if not); (2) load operation by `operation_id` from path params; (3) verify `manual_intervention_required = TRUE` (return 404 NOT_APPLICABLE if not); (4) call `retry-override-repo.createIfNotInProgress` — return 409 OVERRIDE_IN_PROGRESS with `existingOverrideId` if already in progress; (5) BEGIN TRANSACTION: `INSERT retry_overrides (status='pending')`, `INSERT retry_attempts (new attempt)`, `UPDATE async_operations SET status='pending', attempt_count++, manual_intervention_required=FALSE`, `UPDATE manual_intervention_flags SET status='resolved', resolved_by=superadminId, resolution_method='override'`; COMMIT; (6) call `publishRetryOverrideEvent`; (7) return 200 `{ overrideId, attemptId, operationId, attemptNumber, correlationId, status: 'pending', createdAt }`. Validate `justification` present and length >= 10.
- [ ] T023 [P] [US2] Write unit tests in `tests/unit/manual-intervention-flag.test.mjs` using `node:test`: (1) `createFlag` with valid params; (2) `shouldDebounceNotification` with `lastNotificationAt` within window → true; (3) `shouldDebounceNotification` with `lastNotificationAt` outside window → false; (4) `shouldDebounceNotification` with null `lastNotificationAt` → false (first notification); (5) status transitions pending→resolved.
- [ ] T024 [P] [US2] Write unit tests in `tests/unit/retry-override.test.mjs` using `node:test`: (1) `createOverride` with valid fields; (2) validation rejects `justification.length < 10`; (3) validation rejects missing `superadminId`; (4) status transitions pending→completed and pending→failed.
- [ ] T025 [P] [US2] Write unit tests in `tests/unit/async-operation-retry-override.test.mjs` using `node:test` with mocked repos/events: (1) happy path → 200 with correct fields; (2) non-superadmin → 403; (3) operation without intervention flag → 404 NOT_APPLICABLE; (4) override already in progress → 409; (5) operation already resolved externally (flag status = resolved) → appropriate error.
- [ ] T026 [P] [US2] Write contract test in `tests/contract/manual-intervention-required-event.contract.test.mjs`: call `buildManualInterventionRequiredEvent` and validate against `manual-intervention-required-event.json` schema; test missing required field throws.
- [ ] T027 [P] [US2] Write contract test in `tests/contract/retry-override-event.contract.test.mjs`: call `buildRetryOverrideEvent` and validate against `retry-override-event.json` schema; test all required fields present.
- [ ] T028 [US2] Write integration test in `tests/integration/manual-intervention-lifecycle.test.mjs` using `node:test` with pg mock/test DB: (1) create operation with `attempt_count = max_retries`; trigger failure classification + intervention marking; assert `manual_intervention_required = TRUE` in `async_operations` and flag row in `manual_intervention_flags`; (2) simulate regular actor POST retry → assert 422 MANUAL_INTERVENTION_REQUIRED; (3) simulate superadmin POST retry-override → assert 200, flag resolved, new retry_attempts row, operation status = 'pending', `manual_intervention_required = FALSE`; (4) simulate concurrent second superadmin override on same operation → assert 409 OVERRIDE_IN_PROGRESS.

---

## Phase 5: US3 — Semántica de Reintento como Contrato Consultable

**Story Goal**: Any actor or system can query the retry semantics for a given operation type and receive failure categories, max retries, backoff strategy, and intervention conditions. Unknown types fall back to the `__default__` profile.

**Independent Test Criteria**: GET `/operations/retry-semantics?operationType=create-workspace` returns full profile. GET without `operationType` returns default. Superadmin upsert new profile → next query reflects new values (SC-006).

- [ ] T029 [US3] Create `services/provisioning-orchestrator/src/actions/async-operation-retry-semantics.mjs` (new OpenWhisk action ESM): (1) read optional `operationType` from query params; (2) call `findByOperationType(client, operationType)` — if no result or `operationType` omitted, call `findDefault(client)`; (3) apply `resolveProfile(specific, default)` to merge fields; (4) return 200 with `{ operationType, maxRetries, backoffStrategy, backoffBaseSeconds, interventionConditions, failureCategories, isDefault }`; (5) tenant isolation not required for read (platform-wide config); (6) no auth requirement beyond authenticated session.
- [ ] T030 [P] [US3] Write unit tests in `tests/unit/retry-semantics-profile.test.mjs` using `node:test`: (1) `resolveProfile` with specific profile fills all fields; (2) `resolveProfile` with null specific returns default fields; (3) `resolveProfile` merges: specific values override default values where present; (4) validation rejects unknown `backoffStrategy`; (5) `DEFAULT_OPERATION_TYPE` constant equals `'__default__'`.
- [ ] T031 [P] [US3] Write unit tests in `tests/unit/async-operation-retry-semantics.test.mjs` using `node:test` with mocked repo: (1) known `operationType` → returns specific profile; (2) unknown `operationType` → returns default profile; (3) omitted `operationType` → returns default profile; (4) missing default profile in DB → 500 with clear error.
- [ ] T032 [US3] Write integration test in `tests/integration/retry-semantics-profile-query.test.mjs` using `node:test`: (1) findByOperationType with known type (seeded in migration) returns profile; (2) findByOperationType with unknown type returns null; (3) findDefault returns `__default__` profile; (4) upsert new profile then findByOperationType returns updated values.

---

## Phase 6: US4 — Notificación Proactiva de Intervención

**Story Goal**: When an operation transitions to "requires manual intervention", a notification event is emitted to the requesting actor and to the responsible superadmin. Multiple interventions from the same actor within the debounce window are consolidated.

**Independent Test Criteria**: Trigger manual intervention → verify `console.async-operation.intervention-notification` Kafka event emitted with correct `recipientActorId` and `recipientRole`. Trigger second intervention within debounce window → no second individual event emitted (SC-004).

- [ ] T033 [US4] Create `services/provisioning-orchestrator/src/actions/async-operation-intervention-notify.mjs` (new OpenWhisk action ESM, triggered by `manual-intervention-required` Kafka event): (1) load `manual_intervention_flags` row by `flagId` from event; (2) load operation + tenant from DB; (3) call `shouldDebounceNotification(flag, INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES)` — if debounce active, increment an accumulator (log warning, no emit); (4) if outside debounce window or first notification: call `updateLastNotificationAt(client, flagId, NOW())`; emit TWO notification events — one with `recipientRole='tenant_owner'` (actorId), one with `recipientRole='superadmin'` (resolved from tenant superadmin lookup); (5) read `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES` from env (default 15). Use `publishInterventionNotificationEvent` for each recipient.
- [ ] T034 [P] [US4] Write unit tests in `tests/unit/async-operation-intervention-notify.test.mjs` using `node:test` with mocked repos/events: (1) first notification → two events emitted (actor + superadmin); (2) within debounce window → no event emitted; (3) past debounce window → events emitted again; (4) tenant actor not found → superadmin notification still emitted; (5) `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES=0` → no debounce, always emit.
- [ ] T035 [P] [US4] Write contract test in `tests/contract/intervention-notification-event.contract.test.mjs`: call `buildInterventionNotificationEvent` for each `recipientRole` value and validate against `intervention-notification-event.json` schema; assert `suggestedActions` is an array.

---

## Phase 7: US5 — Registro Auditable del Ciclo de Vida

**Story Goal**: Every significant retry lifecycle transition — failure classified, marked for intervention, override applied, intervention resolved — emits an auditable Kafka event consumable by the audit pipeline.

**Independent Test Criteria**: Execute full cycle (failure → retries → intervention → override → completion). Query emitted Kafka events. Confirm all 4 event types present with correct fields (DoD-08 through DoD-11).

- [ ] T036 [US5] Verify and document that all 4 Kafka event topics emit events at the correct lifecycle points: (1) `failure-classified` after each `failed` transition (T017); (2) `manual-intervention-required` after each intervention marking (T020); (3) `retry-override` after each superadmin override (T022); (4) `intervention-notification` after each notification dispatch (T033). Add structured log lines (`level`, `event`, `operation_id`, `tenant_id`, `correlation_id`) in each action for observability.
- [ ] T037 [US5] Write integration test in `tests/integration/failure-classification-mapping.test.mjs` using `node:test`: (1) seed `failure_code_mappings` with test rows; (2) classifyFailure with known code (specific + generic); (3) classifyFailure with unknown code → `unknown`; (4) priority ordering respected when multiple rows match.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T038 Fill spec contract JSON stubs (created in T002) with complete JSON Schemas matching the event schemas created in T012–T015 and the API response shapes documented in plan.md Phase 1 (Contracts de API section): `retry-semantics-profile.json`, `failure-classification.json`, `manual-intervention-flag.json`, `retry-override.json`, `retry-semantics-profile-query-response.json` in `specs/078-retry-semantics-manual-intervention/contracts/`.
- [ ] T039 Extend `services/provisioning-orchestrator/src/contract-boundary.mjs` to export the 4 new internal-contracts schemas (`failureClassifiedEventSchema`, `manualInterventionRequiredEventSchema`, `retryOverrideEventSchema`, `interventionNotificationEventSchema`) without removing existing exports.
- [ ] T040 Extend `services/internal-contracts/src/index.mjs` to export the 4 new JSON schemas by name alongside existing exports.
- [ ] T041 Update `AGENTS.md` (at `/root/projects/_active/AGENTS.md`) with new patterns from this feature: (1) Failure classification pattern (classifyByErrorCode + failure_code_mappings table + in-memory cache); (2) Manual intervention flag pattern (column in async_operations + separate flags table); (3) Retry override pattern (INSERT WHERE NOT EXISTS, 409 on concurrent); (4) New env vars: `FAILURE_CLASSIFICATION_CACHE_TTL_SECONDS`, `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES`, `RETRY_OVERRIDE_REQUIRES_JUSTIFICATION`; (5) New Kafka topics (4 topics with retention). Append under `<!-- MANUAL ADDITIONS START -->` marker.

---

## Summary

| Phase | Tasks | User Story | Parallelizable |
|-------|-------|------------|----------------|
| Phase 1: Setup | T001–T002 | — | No |
| Phase 2: Foundation | T003–T016 | — | T004–T009 parallel after T003; T012–T015 parallel with T004–T007 |
| Phase 3: US1 | T017–T019 | US1 (P1) | T018, T019 parallel with T017 |
| Phase 4: US2 | T020–T028 | US2 (P1) | T023–T027 parallel with T020–T022 |
| Phase 5: US3 | T029–T032 | US3 (P2) | T030, T031 parallel with T029 |
| Phase 6: US4 | T033–T035 | US4 (P2) | T034, T035 parallel with T033 |
| Phase 7: US5 | T036–T037 | US5 (P3) | T037 parallel with T036 |
| Phase 8: Polish | T038–T041 | — | T038–T040 parallel |
| **Total** | **41 tasks** | **5 user stories** | — |

**MVP scope**: T001–T028 (Phases 1–4 covering P1 stories US1 + US2, plus full foundation).
