---
description: "Task list for 076-timeout-cancel-recovery-policies"
backlog:
  task_id: US-UIB-02-T04
  epic: EP-16
  historia: US-UIB-02
  rfs: [RF-UIB-006, RF-UIB-007, RF-UIB-008]
---

# Tasks: Políticas de Timeout, Cancelación y Recuperación para Aprovisionamientos Complejos

**Input**: Design documents from `/specs/076-timeout-cancel-recovery-policies/`  
**Prerequisites**: spec.md ✅, plan.md ✅  
**Backlog traceability**: Task US-UIB-02-T04 · Epic EP-16 · Historia US-UIB-02  
**Branch**: `076-timeout-cancel-recovery-policies`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1 = Timeout automático, US2 = Cancelación, US3 = Recuperación huérfanos, US4 = Políticas por tipo, US5 = Ciclo de vida extendido)

---

## Phase 1: Setup (Spec Artifacts & Contracts)

**Purpose**: Materialize JSON contract artifacts for new Kafka events and internal schemas before implementation.

- [ ] T001 [P] Create contract artifact `specs/076-timeout-cancel-recovery-policies/contracts/operation-cancel-event.json` — JSON Schema with required fields: eventId, eventType, operationId, tenantId, actorId, cancelledBy, previousStatus, occurredAt, correlationId
- [ ] T002 [P] Create contract artifact `specs/076-timeout-cancel-recovery-policies/contracts/operation-timeout-event.json` — JSON Schema with required fields: eventId, eventType, operationId, tenantId, previousStatus, timeoutReason, occurredAt, correlationId
- [ ] T003 [P] Create contract artifact `specs/076-timeout-cancel-recovery-policies/contracts/operation-recovery-event.json` — JSON Schema with required fields: eventId, eventType, operationId, tenantId, previousStatus, recoveryAction, recoveryReason, occurredAt, correlationId

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database migration, state machine extension, and model updates — must complete before any sweep/cancel action implementation.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Create migration `services/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql` — (a) ALTER TABLE async_operations DROP + ADD CONSTRAINT async_operations_status_check to include timed_out, cancelling, cancelled; (b) ADD COLUMNS IF NOT EXISTS cancelled_by TEXT, cancellation_reason TEXT, timeout_policy_snapshot JSONB, policy_applied_at TIMESTAMPTZ; (c) CREATE INDEX idx_async_ops_status_updated on (status, updated_at) WHERE status IN ('running','pending','cancelling'); (d) CREATE TABLE IF NOT EXISTS operation_policies (policy_id UUID PK, operation_type TEXT UNIQUE, timeout_minutes INT, orphan_threshold_minutes INT, cancelling_timeout_minutes INT DEFAULT 5, recovery_action TEXT DEFAULT 'fail', created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ); (e) INSERT default policy row for operation_type='*' with timeout_minutes=60, orphan_threshold_minutes=30, cancelling_timeout_minutes=5; include rollback DDL in comments
- [ ] T005 [P] Extend `services/provisioning-orchestrator/src/models/async-operation-states.mjs` — add timed_out, cancelling, cancelled to VALID_TRANSITIONS: running→timed_out, running→cancelling, pending→cancelled, cancelling→cancelled, cancelling→failed; add timed_out and cancelled to TERMINAL_STATES; add CANCELLABLE_STATES = ['pending','running'] constant
- [ ] T006 Extend `services/provisioning-orchestrator/src/models/async-operation.mjs` — createOperation accepts optional timeout_policy_snapshot (JSONB) and cancelled_by (null default); applyTransition records cancelled_by + cancellation_reason when new_status==='cancelling', sets cancellation_reason='timeout exceeded' when new_status==='timed_out'; export isCancellable(status) using CANCELLABLE_STATES
- [ ] T007 Extend `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` — add: findTimedOutCandidates(db, {nowIso}) joining operation_policies (fallback to '*'), findOrphanCandidates(db, {nowIso}), findStaleCancellingCandidates(db, {nowIso}), atomicTransitionSystem(db, {operation_id, tenant_id, new_status, reason, cancelled_by}) using FOR UPDATE + validateTransition to avoid races, findPolicyForType(db, {operation_type}) with fallback to '*'
- [ ] T008 Extend `services/provisioning-orchestrator/src/events/async-operation-events.mjs` — add constants ASYNC_OPERATION_CANCELLED_TOPIC, ASYNC_OPERATION_TIMED_OUT_TOPIC, ASYNC_OPERATION_RECOVERED_TOPIC; add builders buildCancelledEvent(operation, cancelledBy), buildTimedOutEvent(operation), buildRecoveredEvent(operation, recoveryReason) following existing pattern (eventId UUID, eventType, operationId, tenantId, actorId or 'system', occurredAt, correlationId)
- [ ] T009 [P] Create Kafka event schemas in `services/internal-contracts/src/` — operation-cancel-event.json, operation-timeout-event.json, operation-recovery-event.json; update `services/internal-contracts/src/index.mjs` to export all three new schemas

**Checkpoint**: Migration, state machine, model, repository and events ready — user story implementation can begin.

---

## Phase 3: User Story 5 — Ciclo de vida extendido (Priority: P1) 🎯 MVP

**Goal**: Los nuevos estados timed_out, cancelled, cancelling existen en el sistema con sus transiciones válidas. Prerequisito para US1, US2 y US3.

**Independent Test**: Ejecutar validateTransition con cada nueva transición válida → aceptada; intentar transiciones inválidas (timed_out→*, cancelled→*, cancelling→running) → rechazadas.

### Tests for User Story 5

- [ ] T010 [P] [US5] Unit tests `tests/unit/async-operation-states-extended.test.mjs` — validateTransition accepts: running→timed_out, running→cancelling, pending→cancelled, cancelling→cancelled, cancelling→failed; rejects: timed_out→running, timed_out→completed, cancelled→running, cancelling→running, cancelling→completed; isCancellable true for pending/running, false for completed/failed/timed_out/cancelled/cancelling
- [ ] T011 [P] [US5] Unit tests `tests/unit/async-operation-model-extended.test.mjs` — applyTransition to timed_out sets cancellation_reason='timeout exceeded'; applyTransition to cancelling sets cancelled_by and cancellation_reason from input; createOperation with timeout_policy_snapshot stores it correctly
- [ ] T012 [P] [US5] Regression tests `tests/unit/async-operation-states-regression.test.mjs` — original transitions pending→running, running→completed, running→failed still work without change; TERMINAL_STATES still includes completed and failed; existing tests not broken

**Checkpoint**: User Story 5 fully functional. Extended lifecycle verifiable independently.

---

## Phase 4: User Story 2 — Cancelación de Operaciones (Priority: P1)

**Goal**: Actor autorizado puede cancelar operaciones en estado pending (→ cancelled directamente) o running (→ cancelling transitorio). Rechaza estados terminales con 409. Aislamiento multi-tenant estricto. Superadmin puede cancelar operaciones de cualquier tenant.

**Independent Test**: Crear operación en pending → solicitar cancelación → estado cancelled con actor_id registrado en < 5 segundos. Crear en running → solicitar cancelación → estado cancelling.

### Implementation for User Story 2

- [ ] T013 [US2] Create action `services/provisioning-orchestrator/src/actions/async-operation-cancel.mjs` — extract callerContext (actor, tenantId, roles) from params; resolve tenant_id (superadmin may pass external tenant_id, others use callerContext.tenantId); load operation with findById → 404 if not found; check isCancellable(status) → 409 NOT_CANCELLABLE with descriptive message if not cancellable; verify tenant isolation (actor's tenant must match operation's tenant OR superadmin) → 403 TENANT_ISOLATION_VIOLATION; if pending: transitionOperation → cancelled directly; if running: transitionOperation → cancelling recording cancelled_by and cancellation_reason; publish Kafka event via buildCancelledEvent; return { statusCode: 200, body: { operationId, previousStatus, newStatus, updatedAt } }; map errors: NOT_FOUND→404, INVALID_TRANSITION/NOT_CANCELLABLE→409, TENANT_ISOLATION_VIOLATION→403, VALIDATION_ERROR→400

### Tests for User Story 2

- [ ] T014 [P] [US2] Unit tests `tests/unit/async-operation-cancel.test.mjs` — mocked repo and events: pending→cancelled directly; running→cancelling; completed/failed/timed_out/cancelled each returns 409; cross-tenant actor returns 403; superadmin cancels any-tenant operation; cancelled_by stored correctly in transition; Kafka buildCancelledEvent called with correct args
- [ ] T015 [P] [US2] Contract test `tests/contract/operation-cancel-event.contract.test.mjs` — buildCancelledEvent output conforms to operation-cancel-event.json schema (all required fields present and correctly typed)

**Checkpoint**: User Story 2 fully functional. Cancel action verifiable independently.

---

## Phase 5: User Story 1 — Timeout Automático (Priority: P1)

**Goal**: Proceso periódico detecta operaciones running que excedieron su timeout configurado y las transiciona a timed_out. Race condition (completado vs. timeout simultáneo) resuelto por atomicTransitionSystem: la primera transición registrada prevalece.

**Independent Test**: Crear operación running con updated_at en el pasado más allá del timeout configurado → ejecutar sweep → estado timed_out con motivo 'timeout exceeded' y evento Kafka publicado.

### Implementation for User Story 1

- [ ] T016 [US1] Create action `services/provisioning-orchestrator/src/actions/async-operation-timeout-sweep.mjs` — call findTimedOutCandidates(db, {nowIso: new Date().toISOString()}); for each candidate call atomicTransitionSystem({new_status:'timed_out', reason:'timeout exceeded'}); on INVALID_TRANSITION log conflict and continue (do not abort loop); publish buildTimedOutEvent via Kafka for each successfully transitioned operation; return { swept: N, errors: [...] } for observability

### Tests for User Story 1

- [ ] T017 [P] [US1] Unit tests `tests/unit/async-operation-timeout-sweep.test.mjs` — mocked repo: 3 candidates → swept:3; atomicTransitionSystem throws INVALID_TRANSITION for one → errors:1, swept:2, loop continues; buildTimedOutEvent called once per success; findTimedOutCandidates called with correct nowIso
- [ ] T018 [P] [US1] Contract test `tests/contract/operation-timeout-event.contract.test.mjs` — buildTimedOutEvent output conforms to operation-timeout-event.json schema (all required fields present and correctly typed)
- [ ] T019 [US1] Integration test `tests/integration/async-operation-timeout-candidates.test.mjs` — PostgreSQL: insert running operation with updated_at = NOW() - interval '120 minutes' and policy timeout_minutes=60 → findTimedOutCandidates returns it; insert running operation with updated_at = NOW() - interval '10 minutes' → NOT returned; atomicTransitionSystem concurrent race: two calls simultaneously, only one succeeds and the other receives INVALID_TRANSITION; covers SC-001

**Checkpoint**: User Story 1 fully functional. Timeout sweep verifiable independently.

---

## Phase 6: User Story 3 — Recuperación de Operaciones Huérfanas (Priority: P1)

**Goal**: Proceso periódico detecta operaciones running/pending sin progreso más allá del orphan_threshold y las transiciona a failed con motivo descriptivo. Operaciones cancelling estancadas se fuerzan a cancelled. Genera evento auditable por cada recuperación.

**Independent Test**: Crear operación running sin actualización por más del umbral → ejecutar sweep → estado failed con motivo 'orphaned — no progress detected' y evento Kafka publicado.

### Implementation for User Story 3

- [ ] T020 [US3] Create action `services/provisioning-orchestrator/src/actions/async-operation-orphan-sweep.mjs` — call findOrphanCandidates(db, {nowIso}) and findStaleCancellingCandidates(db, {nowIso}); for running orphans: atomicTransitionSystem({new_status:'failed', reason:'orphaned — no progress detected'}); for pending orphans: atomicTransitionSystem({new_status:'failed', reason:'stale — never started'}); for stale cancelling: atomicTransitionSystem({new_status:'cancelled', reason:'cancellation forced — timeout'}); on INVALID_TRANSITION log and continue; publish buildRecoveredEvent for each running/pending recovery and buildCancelledEvent for each forced cancellation; return { orphansRecovered: N, cancellingForced: M, errors: [...] }

### Tests for User Story 3

- [ ] T021 [P] [US3] Unit tests `tests/unit/async-operation-orphan-sweep.test.mjs` — mocked repo: running orphan → failed with reason 'orphaned — no progress detected'; pending orphan → failed with reason 'stale — never started'; stale cancelling → cancelled with reason 'cancellation forced — timeout'; INVALID_TRANSITION does not abort loop; correct Kafka events published per case; return counts accurate
- [ ] T022 [P] [US3] Contract test `tests/contract/operation-recovery-event.contract.test.mjs` — buildRecoveredEvent output conforms to operation-recovery-event.json schema (all required fields present and correctly typed)
- [ ] T023 [US3] Integration test `tests/integration/async-operation-orphan-candidates.test.mjs` — PostgreSQL: running operation with updated_at old enough → findOrphanCandidates returns it; recent running operation → NOT returned; pending operation stale → findOrphanCandidates returns it with stale context; cancelling operation beyond threshold → findStaleCancellingCandidates returns it; atomicTransitionSystem race: two calls on same operation, one wins; tenant deactivated scenario: operation marked failed with correct motif; covers SC-004

**Checkpoint**: User Story 3 fully functional. Orphan sweep verifiable independently.

---

## Phase 7: User Story 4 — Configuración de Políticas por Tipo de Operación (Priority: P2)

**Goal**: operation_policies con fallback global '*' permite umbrales distintos por tipo de operación. Los sweeps usan la política vigente al momento de la evaluación; operaciones en curso mantienen el snapshot de política tomado al crearlas.

**Independent Test**: Insertar políticas con timeout_minutes=10 para 'create-workspace' y timeout_minutes=5 para 'enable-service'; crear una operación de cada tipo con updated_at justo en el límite → solo la operación 'enable-service' aparece como candidata al timeout sweep.

### Tests for User Story 4

- [ ] T024 [P] [US4] Unit tests `tests/unit/async-operation-policy.test.mjs` — findPolicyForType returns specific policy when operation_type matches; returns '*' fallback when no specific policy; createOperation stores timeout_policy_snapshot as JSONB; policy changes don't affect operations already created (snapshot isolation)
- [ ] T025 [US4] Integration test `tests/integration/async-operation-policy-per-type.test.mjs` — PostgreSQL: insert operation_policies for 'create-workspace' (timeout_minutes=10) and 'enable-service' (timeout_minutes=5); create running operations of each type with updated_at at different offsets; sweep only picks up the one that exceeded its specific policy threshold; default '*' policy applied when operation_type not in operation_policies; covers SC-001 differential behavior

**Checkpoint**: User Story 4 fully functional. Per-type policy differentiation verifiable independently.

---

## Phase 8: Helm & Observability

**Purpose**: Alarm triggers, environment variables, and metric annotations for production readiness.

- [ ] T026 [P] Update `helm/provisioning-orchestrator/values.yaml` — add timeoutSweep.enabled=true, timeoutSweep.schedule=`*/5 * * * *`, orphanSweep.enabled=true, orphanSweep.schedule=`*/10 * * * *`, env.OPERATION_DEFAULT_TIMEOUT_MINUTES="60", env.OPERATION_DEFAULT_ORPHAN_THRESHOLD_MINUTES="30", env.OPERATION_DEFAULT_CANCELLING_TIMEOUT_MINUTES="5"
- [ ] T027 [P] Add metric annotations to async-operation-timeout-sweep.mjs and async-operation-orphan-sweep.mjs — async_operation_timeout_sweep_total (labels: swept, errors), async_operation_orphan_sweep_total (labels: recovered, forced_cancelled, errors), async_operation_cancellation_total (labels: from_status, tenant); follow existing metricAnnotation pattern from async-operation-transition.mjs

---

## Dependency Graph

```text
T001-T003 (contracts) ──► T009 (internal-contracts index)
T004 (migration) ──────────────────────────────────────────────► T007 (repo), T008 (events)
T005 (states) ──► T006 (model) ──► T007 (repo)                  │
                                    │                             │
                                    ▼                             ▼
                              T013 (cancel action) ◄── T005+T006+T007+T008
                              T016 (timeout sweep) ◄── T005+T006+T007+T008
                              T020 (orphan sweep)  ◄── T005+T006+T007+T008
                              
Tests (T010-T012, T014-T015, T017-T018, T021-T022, T024) run in parallel once foundational ready
Integration tests (T019, T023, T025) require migration (T004)
T026-T027 are independent of implementation phases
```

## Success Criteria Checklist

- [ ] SC-001: 100% of timed-out operations detected and transitioned within 2 sweep cycles
- [ ] SC-002: Cancel requests confirmed < 5 seconds from request
- [ ] SC-003: 100% of terminal-state cancel requests rejected with descriptive error
- [ ] SC-004: Orphaned operations recovered within 2 detection cycles
- [ ] SC-005: 100% of new state transitions (timed_out, cancelling, cancelled) generate auditable Kafka events
- [ ] SC-006: 100% of multi-tenant isolation enforced (cancel cross-tenant rejected)
- [ ] SC-007: Pre-076 operations continue functioning (regression tests green)
