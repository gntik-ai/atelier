---
description: "Task list for 075-idempotent-retry-dedup"
backlog:
  task_id: US-UIB-02-T03
  epic: EP-16
  historia: US-UIB-02
  rfs: [RF-UIB-006, RF-UIB-007, RF-UIB-008]
---

# Tasks: Reintentos Idempotentes con Deduplicación por Idempotency Key

**Input**: Design documents from `/specs/075-idempotent-retry-dedup/`  
**Prerequisites**: spec.md ✅, plan.md ✅  
**Backlog traceability**: Task US-UIB-02-T03 · Epic EP-16 · Historia US-UIB-02  
**Branch**: `075-idempotent-retry-dedup`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1 = Deduplicación, US2 = Reintento, US3 = Expiración, US4 = Auditoría)

---

## Phase 1: Setup (Spec Artifacts & Contracts)

**Purpose**: Materialize spec contract files referenced in plan.md before implementation.

- [ ] T001 [P] Create contract artifact `specs/075-idempotent-retry-dedup/contracts/idempotency-key-record.json` with entity schema
- [ ] T002 [P] Create contract artifact `specs/075-idempotent-retry-dedup/contracts/retry-attempt.json` with entity schema
- [ ] T003 [P] Create contract artifact `specs/075-idempotent-retry-dedup/contracts/async-operation-retry-request.json` with endpoint input schema
- [ ] T004 [P] Create contract artifact `specs/075-idempotent-retry-dedup/contracts/async-operation-retry-response.json` with endpoint output schema
- [ ] T005 [P] Create contract artifact `specs/075-idempotent-retry-dedup/contracts/idempotency-dedup-event.json` with Kafka event schema
- [ ] T006 [P] Create contract artifact `specs/075-idempotent-retry-dedup/contracts/operation-retry-event.json` with Kafka event schema

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database migration and Kafka event schemas — must complete before any user story implementation.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T007 Create migration `services/provisioning-orchestrator/src/migrations/075-idempotency-retry-tables.sql` — CREATE TABLE idempotency_key_records (UNIQUE tenant_id, idempotency_key), CREATE TABLE retry_attempts (UNIQUE operation_id, attempt_number), ALTER TABLE async_operations ADD COLUMNS attempt_count/max_retries, all indexes; include rollback DDL in comments
- [ ] T008 [P] Create Kafka event schema `services/internal-contracts/src/idempotency-dedup-event.json` for topic console.async-operation.deduplicated
- [ ] T009 [P] Create Kafka event schema `services/internal-contracts/src/operation-retry-event.json` for topic console.async-operation.retry-requested

**Checkpoint**: Migration and event schemas ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Deduplicación por Idempotency Key (Priority: P1) 🎯 MVP

**Goal**: Solicitudes con idempotency key duplicada (mismo tenant, mismo tipo, ventana activa) retornan la operación existente sin crear duplicados. Incluye scoping multi-tenant, detección de discrepancia de parámetros, y resolución atómica de concurrencia.

**Independent Test**: POST dos veces con la misma Idempotency-Key → segunda respuesta tiene `idempotent: true` y mismo `operationId`; 10 requests concurrentes con misma key → exactamente 1 operación creada en BD.

### Implementation for User Story 1

- [ ] T010 [P] [US1] Create domain model `services/provisioning-orchestrator/src/models/idempotency-key-record.mjs` — factory createIdempotencyKeyRecord, validateKeyFormat (1-128 chars, [a-zA-Z0-9_\-]), isExpired, params_hash via SHA-256 of sorted params JSON
- [ ] T011 [US1] Create repository `services/provisioning-orchestrator/src/repositories/idempotency-key-repo.mjs` — findActive(tenant_id, key) with expires_at > NOW(), insertOrFind(record) using INSERT … ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING * + re-fetch on conflict; all queries must include tenant_id filter
- [ ] T012 [US1] Extend action `services/provisioning-orchestrator/src/actions/async-operation-create.mjs` — pre-persist idempotency key lookup: if found return existing op with idempotent:true + paramsMismatch flag; if key type conflict return 409 IDEMPOTENCY_KEY_CONFLICT; if absent or expired wrap INSERT async_operations + INSERT idempotency_key_records in single PostgreSQL transaction; requests without key follow original T01 path unchanged
- [ ] T013 [US1] Extend `services/provisioning-orchestrator/src/events/async-operation-events.mjs` — add buildDeduplicationEvent and publishDeduplicationEvent for topic console.async-operation.deduplicated; call from dedup path in T012

### Tests for User Story 1

- [ ] T014 [P] [US1] Unit tests `tests/unit/idempotency-key-record.test.mjs` — createIdempotencyKeyRecord fields, validateKeyFormat (valid, too long, invalid chars), isExpired, params_hash determinism with sorted keys
- [ ] T015 [P] [US1] Unit tests `tests/unit/idempotency-dedup-in-create.test.mjs` — mocked repos: key duplicada → returns existing op + idempotent:true; key nueva → creates op; key con tipo diferente → 409; key con params distintos → 200 + paramsMismatch:true; absent key → original T01 path
- [ ] T016 [P] [US1] Contract test `tests/contract/idempotency-dedup-event.contract.test.mjs` — buildDeduplicationEvent output conforms to idempotency-dedup-event.json schema (all required fields, types)
- [ ] T017 [US1] Integration test `tests/integration/idempotency-dedup.test.mjs` — PostgreSQL INSERT ON CONFLICT produces exactly one operation; concurrent requests (10 simultaneous, same key) → 1 row in idempotency_key_records; tenant isolation (same key, different tenants → independent operations); covers SC-001, SC-002

**Checkpoint**: User Story 1 fully functional. Deduplication + SC-001 + SC-002 verifiable independently.

---

## Phase 4: User Story 2 — Reintento Seguro de Operaciones Fallidas (Priority: P1)

**Goal**: Actor autorizado puede reintentar operaciones en estado `failed`. Sistema crea nuevo intento vinculado (attempt_number++, nuevo correlation_id, estado pending). Rechaza reintentos de operaciones en estados no elegibles y cuando se excede max_retries. Aislamiento multi-tenant.

**Independent Test**: Operación marcada como failed → POST /operations/{id}/retry → nuevo intento en estado pending con parámetros originales preservados en < 3 segundos.

### Implementation for User Story 2

- [ ] T018 [P] [US2] Create domain model `services/provisioning-orchestrator/src/models/retry-attempt.mjs` — factory createRetryAttempt, generate new correlation_id via crypto, validate attempt_number > 0
- [ ] T019 [US2] Create repository `services/provisioning-orchestrator/src/repositories/retry-attempt-repo.mjs` — create(attempt), findByOperationId(operation_id, tenant_id); all queries must include tenant_id filter
- [ ] T020 [US2] Extend repository `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` — add atomicResetToRetry(operation_id, tenant_id): UPDATE async_operations SET status='pending', attempt_count=attempt_count+1, updated_at=NOW() WHERE operation_id=$1 AND tenant_id=$2 AND status='failed' RETURNING *; add findByIdWithTenant for pre-check
- [ ] T021 [US2] Create action `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs` — OpenWhisk action wrapper; verify tenant ownership (403 if mismatch); load op; check status=failed (409 INVALID_OPERATION_STATE if not); check attempt_count < max_retries (422 MAX_RETRIES_EXCEEDED if exceeded); check tenant not deactivated (400); BEGIN: INSERT retry_attempts + atomicResetToRetry + INSERT async_operation_transitions; COMMIT; publish retry-requested event; return RetryResponse per contract
- [ ] T022 [US2] Extend `services/provisioning-orchestrator/src/events/async-operation-events.mjs` — add buildRetryEvent and publishRetryEvent for topic console.async-operation.retry-requested; call from T021

### Tests for User Story 2

- [ ] T023 [P] [US2] Unit tests `tests/unit/retry-attempt.test.mjs` — createRetryAttempt fields, unique correlation_id per call, attempt_number validation
- [ ] T024 [P] [US2] Unit tests `tests/unit/async-operation-retry.test.mjs` — mocked repos: estado failed → 200 + new attempt pending; estado running → 409; estado completed → 409; attempt_count >= max_retries → 422; tenant mismatch → 403; tenant desactivado → 400; superadmin can retry any tenant op
- [ ] T025 [P] [US2] Contract test `tests/contract/operation-retry-event.contract.test.mjs` — buildRetryEvent output conforms to operation-retry-event.json schema (all required fields including previousCorrelationId, newCorrelationId)
- [ ] T026 [US2] Integration test `tests/integration/retry-safe.test.mjs` — full cycle: create op → transition to failed → POST retry → verify attempt_count++ in async_operations + new row in retry_attempts with status pending; retry completed op → 409; attempt_count=max_retries → 422; tenant B cannot retry tenant A op; covers SC-003, SC-004, SC-006

**Checkpoint**: User Story 2 fully functional. Retry flow + SC-003 + SC-004 + SC-006 verifiable independently.

---

## Phase 5: User Story 3 — Expiración de Idempotency Keys (Priority: P2)

**Goal**: Keys expiradas (expires_at < NOW()) se tratan como ausentes; nueva solicitud con la misma key crea operación independiente. Permite reutilización legítima de keys tras la ventana de validez.

**Independent Test**: Crear operación con key → avanzar tiempo más allá de TTL → nueva solicitud con misma key crea operación independiente (idempotent:false, nuevo operationId).

### Implementation for User Story 3

- [ ] T027 [US3] Verify `services/provisioning-orchestrator/src/repositories/idempotency-key-repo.mjs` findActive query correctly filters `expires_at > NOW()` (expiration already handled in T011 implementation — validate correctness and add explicit expiry tests); ensure IDEMPOTENCY_KEY_TTL_HOURS env var is read and applied when building expires_at on insert
- [ ] T028 [US3] Integration test `tests/integration/idempotency-key-expiry.test.mjs` — INSERT key record with expires_at in the past → POST same key → verify new operation created (not deduplicated); INSERT key within window → POST same key → deduplicated; covers SC-007

**Checkpoint**: User Story 3 complete — SC-007 verified.

---

## Phase 6: User Story 4 — Auditoría y Trazabilidad de Reintentos (Priority: P2)

**Goal**: Deduplicaciones y reintentos producen eventos auditables en Kafka consultables. Superadmin puede reconstruir la secuencia completa de intentos de una operación.

**Independent Test**: Secuencia solicitud original + deduplicación + reintento → exactamente 3 eventos en Kafka (state-changed, deduplicated, retry-requested) con todos los campos requeridos presentes.

### Implementation for User Story 4

- [ ] T029 [P] [US4] Export new event schemas in `services/internal-contracts/src/index.mjs` — add named exports for idempotency-dedup-event.json and operation-retry-event.json schemas
- [ ] T030 [US4] Validate observability: verify structured logs in T012 and T021 include `level`, `event`, `operation_id`, `tenant_id`, `correlation_id`, `metrics[]` per existing project log pattern; add/fix any missing fields in both actions
- [ ] T031 [US4] Integration test for audit trail in `tests/integration/idempotency-dedup.test.mjs` and `tests/integration/retry-safe.test.mjs` — add assertions that Kafka mock/spy received deduplicated event and retry-requested event with all required schema fields; covers SC-005

**Checkpoint**: User Story 4 complete — SC-005 verified, full audit trail available.

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Wire up exported contracts, update project registry.

- [ ] T032 Update `services/provisioning-orchestrator/src/contract-boundary.mjs` — add exports for idempotency-key-record schema, retry-attempt schema, and new API contracts from contracts/ directory
- [ ] T033 Update `AGENTS.md` — document new entities (idempotency_key_records, retry_attempts), new action async-operation-retry, new Kafka topics, and env vars (IDEMPOTENCY_KEY_TTL_HOURS, OPERATION_DEFAULT_MAX_RETRIES, IDEMPOTENCY_KEY_MAX_LENGTH)

---

## Dependency Graph

```
Phase 1 (T001-T006)  ──────────────────────────────────────► can start immediately (parallel)
Phase 2 (T007-T009)  ──────────────────────────────────────► can start immediately (parallel)
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
Phase 3 (US1)           Phase 4 (US2)    Phase 5 (US3)
T010 ──► T011 ──► T012   T018 ──► T019    T027 (verify T011)
             └──► T013   T020 ──► T021    T028
T014 T015 T016 T017      T022
                         T023 T024 T025 T026
            │                 │
            └────────┬─────────┘
                     ▼
            Phase 6 (US4)
            T029 T030 T031
                     │
                     ▼
            Final Phase
            T032 T033
```

**US3 can be implemented in parallel with US1** (T027 validates T011, T028 is independent integration test).  
**US4 events** (buildDeduplicationEvent, buildRetryEvent) are already implemented in Phases 3-4; US4 phase adds audit validation and contract exports only.

## Parallel Execution Examples

### Story 1 parallelization
```
Worker A: T010 (model) → T011 (repo) → T012 (create action) → T013 (events)
Worker B: T014 (unit model tests) → T015 (unit action tests) → T016 (contract test) → T017 (integration test)
```

### Story 2 parallelization
```
Worker A: T018 (model) → T019 (repo) → T020 (extend repo) → T021 (retry action) → T022 (events)
Worker B: T023 (unit model) → T024 (unit action) → T025 (contract) → T026 (integration)
```

## Implementation Strategy

**MVP Scope** (Stories 1 + 2, P1 only): Complete Phases 1-4 to deliver deduplication + safe retry with full multi-tenant isolation.  
**Full Delivery**: Add Phases 5-6 + Final for expiration and audit trail.  
**TDD approach**: Within each story, model/contract tests (T-even) can be written before implementation (T-odd) following the sequence shown above.

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 33 |
| Phase 1 (setup/contracts) | 6 |
| Phase 2 (foundational) | 3 |
| Phase 3 (US1 – Deduplicación P1) | 8 |
| Phase 4 (US2 – Reintento P1) | 9 |
| Phase 5 (US3 – Expiración P2) | 2 |
| Phase 6 (US4 – Auditoría P2) | 3 |
| Final phase (polish) | 2 |
| Parallelizable [P] tasks | 18 |
| New files | 19 |
| Extended files | 6 |

**Success Criteria Coverage**: SC-001 ✅ T017 · SC-002 ✅ T017 · SC-003 ✅ T026 · SC-004 ✅ T026 · SC-005 ✅ T031 · SC-006 ✅ T026 · SC-007 ✅ T028
