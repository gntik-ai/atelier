# Tasks: Zero-Downtime API Key Rotation

**Feature**: 089-api-key-rotation  
**Task ID**: US-DX-02-T05 | **Epic**: EP-17 | **Story**: US-DX-02  
**Input**: Design documents from `specs/089-api-key-rotation/`  
**Prerequisites**: plan.md ✅, spec.md ✅  
**Branch**: `089-api-key-rotation`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete-task dependencies)
- **[Story]**: Maps to user stories from spec.md (US1–US5)
- Exact file paths included per task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify tooling, confirm branch, and scaffold any missing directory structure.

- [ ] T001 Confirm branch `089-api-key-rotation` is checked out and working tree is clean
- [ ] T002 [P] Create `services/provisioning-orchestrator/src/migrations/` directory if not present (idempotent)
- [ ] T003 [P] Create `services/gateway-config/plugins/` directory if not present
- [ ] T004 [P] Create `services/workspace-docs-service/src/` directory if not present

**Checkpoint**: Directories exist; on correct branch. All subsequent phases can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB migration, core models/repositories, and OpenAPI contract extensions that MUST be complete before any user-story implementation starts.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [ ] T005 Create DB migration `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — `CREATE TABLE IF NOT EXISTS service_account_rotation_states` (columns: id, tenant_id, workspace_id, service_account_id, new_credential_id, old_credential_id, rotation_type CHECK IN ('grace_period','immediate'), grace_period_seconds, deprecated_expires_at, initiated_at, initiated_by, state CHECK IN ('in_progress','completed','force_completed','expired'), completed_at, completed_by, rotation_lock_version); unique partial index `uq_rotation_in_progress` on (service_account_id) WHERE state='in_progress'; index `idx_rotation_expiry` on (deprecated_expires_at) WHERE state='in_progress'
- [ ] T006 Extend migration `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — append `CREATE TABLE IF NOT EXISTS service_account_rotation_history` (columns: id, tenant_id, workspace_id, service_account_id, rotation_state_id FK, rotation_type, grace_period_seconds, old_credential_id, new_credential_id, initiated_by, initiated_at, completed_at, completed_by, completion_reason CHECK IN ('expired','force_completed','immediate')); index `idx_rotation_history_sa` on (service_account_id, initiated_at DESC)
- [ ] T007 Extend migration `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — append `CREATE TABLE IF NOT EXISTS tenant_rotation_policies` (columns: tenant_id PK, max_credential_age_days nullable, max_grace_period_seconds nullable, warn_before_expiry_days DEFAULT 14, updated_at, updated_by)
- [ ] T008 [P] Create `services/provisioning-orchestrator/src/models/credential-rotation-state.mjs` — ESM module exporting `createRotationStateRecord({ tenantId, workspaceId, serviceAccountId, newCredentialId, oldCredentialId, rotationType, gracePeriodSeconds, gracePeriodSecondsEffective, initiatedBy })` plain-object factory + `validateRotationState(record)` with inline schema assertions (no external validator dep)
- [ ] T009 [P] Create `services/provisioning-orchestrator/src/models/credential-rotation-history.mjs` — ESM module exporting `createRotationHistoryRecord({ tenantId, workspaceId, serviceAccountId, rotationStateId, rotationType, gracePeriodSeconds, oldCredentialId, newCredentialId, initiatedBy, initiatedAt, completedAt, completedBy, completionReason })` factory + `validateRotationHistoryRecord(record)`
- [ ] T010 [P] Create `services/provisioning-orchestrator/src/models/tenant-rotation-policy.mjs` — ESM module exporting `createTenantRotationPolicy({ tenantId, maxCredentialAgeDays, maxGracePeriodSeconds, warnBeforeExpiryDays, updatedBy })` factory + `validateTenantRotationPolicy(policy)` + `enforceRotationPolicy(policy, requestedGracePeriodSeconds)` that throws `POLICY_VIOLATION` when limit exceeded
- [ ] T011 Create `services/provisioning-orchestrator/src/repositories/credential-rotation-repo.mjs` — ESM module exporting: `createRotationState(client, record)`, `getInProgressRotation(client, serviceAccountId)`, `listExpiredRotations(client, batchSize)`, `completeRotation(client, { id, completedBy, completionReason })`, `listRotationHistory(client, { serviceAccountId, limit, offset })`, `countActiveCredentials(client, serviceAccountId)` — all use parameterised `pg` queries
- [ ] T012 Create `services/provisioning-orchestrator/src/repositories/tenant-rotation-policy-repo.mjs` — ESM module exporting: `getTenantRotationPolicy(client, tenantId)`, `upsertTenantRotationPolicy(client, policy)` — parameterised `pg` queries; returns `null` if no policy row exists
- [ ] T013 Extend `apps/control-plane/openapi/families/workspaces.openapi.json` — add `gracePeriodSeconds` (integer, min 0, max 86400, default 0) to `ServiceAccountCredentialRotationRequest`; add `rotating_deprecated` to `ServiceAccountCredentialStatus` enum; add schemas: `CredentialRotationStatus`, `CredentialRotationHistoryEntry`, `CredentialRotationHistoryPage`, `TenantRotationPolicy` — exact shape as defined in plan.md Phase 1 API Contracts
- [ ] T014 Extend `apps/control-plane/openapi/families/workspaces.openapi.json` — add path entries for: `GET /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-status`, `POST /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-force-complete`, `GET /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-history`, `GET /v1/tenants/{tenantId}/rotation-policy`, `PUT /v1/tenants/{tenantId}/rotation-policy` — each with `x-family: workspaces`, appropriate `x-scope`, `x-rate-limit-class`, `x-audiences`, and `$ref` response schemas added in T013

**Checkpoint**: Migration SQL is idempotent; models/repos compile clean; OpenAPI contract is valid JSON and passes existing contract-validation script.

---

## Phase 3: User Story 1 — Rotate a Credential with Grace Period (Priority: P1) 🎯 MVP

**Goal**: Enable workspace admins to initiate grace-period rotation that keeps both old and new credentials valid for a configurable overlap window, with automatic expiry of the old credential.

**Independent Test**: Rotate a credential with `gracePeriodSeconds=3600`; confirm both old and new keys authenticate successfully; confirm old key is invalidated after grace period expires; confirm `Credential-Deprecated` header is present on requests authenticated with the deprecated key.

- [ ] T015 [US1] Extend `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` — add grace-period rotation path: when `credentialAction === 'rotate'` AND `input.gracePeriodSeconds > 0`: (a) call `dependencies.getTenantRotationPolicy` and invoke `enforceRotationPolicy`; (b) call `dependencies.countActiveCredentials` — reject 422 `CREDENTIAL_LIMIT_EXCEEDED` if at limit; (c) call `dependencies.getInProgressRotation` — reject 409 `ROTATION_IN_PROGRESS` if found; (d) call `dependencies.rotateCredential` in additive mode (issue new key, preserve old); (e) call `dependencies.updateGatewayCredential` with dual-key payload; (f) call `dependencies.writeRotationState`; (g) publish `console.credential-rotation.initiated` Kafka event; (h) return 202 with `{ rotationStateId, newCredentialId, oldCredentialId, deprecatedExpiresAt }`
- [ ] T016 [US1] Extend `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` — preserve and augment existing immediate rotation path (`gracePeriodSeconds === 0` or omitted): write a `service_account_rotation_history` record with `completion_reason='immediate'` via `dependencies.writeRotationHistory`; publish `console.credential-rotation.initiated` Kafka event with `rotationType='immediate'`
- [ ] T017 [US1] Add `writeRotationState`, `writeRotationHistory`, `getInProgressRotation`, `countActiveCredentials`, `getTenantRotationPolicy` stubs to `defaultDependencies` in `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs`; wire real implementations from `credential-rotation-repo.mjs` and `tenant-rotation-policy-repo.mjs`
- [ ] T018 [US1] Create `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs` — OpenWhisk action pattern (follows `async-operation-timeout-sweep.mjs`): (a) query `listExpiredRotations(client, 100)`; (b) for each: call `dependencies.revokeCredential(oldCredentialId)`; call `dependencies.removeGatewayCredential(oldCredentialId)`; call `completeRotation(client, { id, completedBy: 'sweep', completionReason: 'expired' })`; write history record; publish `console.credential-rotation.deprecated-expired` Kafka event; (c) return `{ processed: N, errors: [] }` — errors are non-fatal, logged individually
- [ ] T019 [P] [US1] Create `services/gateway-config/plugins/credential-rotation-header.yaml` — APISIX plugin configuration enabling `key-auth` plugin `keys` array per consumer for dual-key authentication during grace periods; add response rewrite plugin rule that injects `Credential-Deprecated: true; expires=<ISO8601>` header when authenticated key's `status` is `rotating_deprecated` (reads from credential metadata store with short TTL cache)
- [ ] T020 [US1] Create unit test `tests/unit/wf-con-004-grace-period-rotation.test.mjs` (Node `node:test`) — covers: (a) grace-period initiation happy path returns 202 with expected fields; (b) immediate rotation writes history record; (c) `ROTATION_IN_PROGRESS` 409 when concurrent rotation detected; (d) `POLICY_VIOLATION` 422 when `gracePeriodSeconds > policy.maxGracePeriodSeconds`; (e) `CREDENTIAL_LIMIT_EXCEEDED` 422 when active count at max; (f) service account deletion mid-rotation (compensating revoke called)
- [ ] T021 [US1] Create unit test `tests/unit/credential-rotation-expiry-sweep.test.mjs` (Node `node:test`) — covers: happy path processes N expired rotations; partial failure (one record fails, others succeed); idempotency on re-run (already-completed records skipped)
- [ ] T022 [US1] Create integration test `tests/integration/api-key-rotation-grace-period.test.mjs` — end-to-end using real PostgreSQL test DB and stub Keycloak/APISIX adapters: rotate → both keys authenticate OK → `Credential-Deprecated` header present on deprecated key requests → expiry sweep → deprecated key rejected; plus force-complete path (added in T027); plus immediate path

**Checkpoint**: Unit tests pass; integration test green on grace-period initiation and sweep paths.

---

## Phase 4: User Story 2 — Emergency Rotation without Grace Period (Priority: P1)

**Goal**: Preserve and explicitly expose the immediate (zero grace period) rotation path with full audit trail, making it the standard method for incident response.

**Independent Test**: Rotate with `gracePeriodSeconds=0`; confirm old key is immediately rejected; confirm audit event recorded with `rotationType='immediate'` and actor identity.

- [ ] T023 [US2] Add `credentialAction === 'force-complete-rotation'` handling in `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs`: (a) validate RBAC (`workspace_admin` / `workspace_owner` / `tenant_admin`); (b) call `dependencies.getInProgressRotation` — 404 if none; (c) call `dependencies.revokeCredential(oldCredentialId)` in Keycloak; (d) call `dependencies.removeGatewayCredential(oldCredentialId)` from APISIX; (e) call `completeRotation(client, { id, completedBy, completionReason: 'force_completed' })`; (f) write history record; (g) publish `console.credential-rotation.force-completed` Kafka event
- [ ] T024 [US2] Add `POST /rotation-force-complete` route handler in the control-plane router (or OpenWhisk action dispatcher) mapping to `credentialAction='force-complete-rotation'` in `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` — ensure RBAC middleware is applied
- [ ] T025 [US2] Extend unit test `tests/unit/wf-con-004-grace-period-rotation.test.mjs` — add cases: (a) force-complete happy path returns 200, old key revoked, history written, Kafka event published; (b) force-complete when no in-progress rotation returns 404; (c) force-complete by insufficient-role caller returns 403
- [ ] T026 [US2] Extend integration test `tests/integration/api-key-rotation-grace-period.test.mjs` — add immediate rotation scenario: assert old key rejected on first request after `gracePeriodSeconds=0` rotation; assert `console.credential-rotation.initiated` event has `rotationType='immediate'`

**Checkpoint**: Emergency rotation path fully operational; 100% audit coverage for immediate rotations verified in tests.

---

## Phase 5: User Story 3 — View Rotation Status and History (Priority: P2)

**Goal**: Provide workspace admins with real-time visibility into in-progress rotations and a chronological audit history of past rotations.

**Independent Test**: Initiate a rotation; navigate to credential detail; confirm status panel shows `remainingSeconds`, old key expiry, and force-complete option; confirm rotation history reflects completed rotations.

- [ ] T027 [P] [US3] Create React component `apps/web-console/src/components/console/CredentialRotationStatusPanel.tsx` — displays: new key creation time, old key expiry (`deprecatedExpiresAt`), remaining grace period countdown (`remainingSeconds`, updates every 30 s via polling), "Force Complete" button (permission-gated to `workspace_admin`/`workspace_owner`); uses `fetchRotationStatus` and `forceCompleteRotation` from `console-service-accounts.ts`; amber `CredentialRotationStatusPanel` renders only when `state === 'in_progress'`
- [ ] T028 [P] [US3] Create React component `apps/web-console/src/components/console/CredentialRotationHistoryPanel.tsx` — paginated table with columns: timestamp (initiated_at), actor (initiatedBy), rotation type badge, grace period, completion reason; uses `fetchRotationHistory`; renders empty state when no history
- [ ] T029 [US3] Extend `apps/web-console/src/lib/console-service-accounts.ts` — add functions: `rotateWithGracePeriod(workspaceId, serviceAccountId, gracePeriodSeconds, reason)` → POST to rotation endpoint with `gracePeriodSeconds`; `forceCompleteRotation(workspaceId, serviceAccountId)` → POST to `rotation-force-complete`; `fetchRotationStatus(workspaceId, serviceAccountId)` → GET `rotation-status`; `fetchRotationHistory(workspaceId, serviceAccountId, page)` → GET `rotation-history`
- [ ] T030 [US3] Extend `apps/web-console/src/components/console/ConsoleCredentialStatusBadge.tsx` — add visual variant for `rotating_deprecated` status: amber badge with clock icon and "Deprecated – rotating" label
- [ ] T031 [US3] Extend `apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx` — (a) update `handleRotate` to include `gracePeriodSeconds` input (numeric field in rotation dialog, default 0, capped at tenant policy max); (b) render `CredentialRotationStatusPanel` below credential details when `rotationState.state === 'in_progress'`; (c) add rotation history accordion below credential details rendering `CredentialRotationHistoryPanel`
- [ ] T032 [P] [US3] Create unit test `apps/web-console/src/__tests__/CredentialRotationStatusPanel.test.tsx` (Vitest) — renders in-progress state with correct countdown; force-complete button triggers `forceCompleteRotation`; panel absent when state is not `in_progress`; polling interval fires at 30 s
- [ ] T033 [P] [US3] Create unit test `apps/web-console/src/__tests__/CredentialRotationHistoryPanel.test.tsx` (Vitest) — renders history entries with correct columns; pagination controls work; empty state renders correctly
- [ ] T034 [US3] Extend `apps/web-console/src/__tests__/ConsoleServiceAccountsPage.test.tsx` — add cases: grace period numeric input visible in rotation dialog; rotation status panel visible when account has in-progress rotation; history accordion renders history entries
- [ ] T035 [US3] Add `GET /rotation-status` and `GET /rotation-history` route handlers in the control-plane router — load rotation state/history from `credential-rotation-repo.mjs`; enforce RBAC; return `CredentialRotationStatus` / `CredentialRotationHistoryPage` schema responses matching OpenAPI contract
- [ ] T036 [US3] Extend integration test `tests/integration/api-key-rotation-grace-period.test.mjs` — add: assert `GET /rotation-status` returns accurate `remainingSeconds` during grace period; assert `GET /rotation-history` returns entries after rotation completes

**Checkpoint**: Rotation status and history visible in console; both new API endpoints return correct data; component unit tests green.

---

## Phase 6: User Story 4 — Access Rotation Procedure Documentation (Priority: P2)

**Goal**: Inject a self-service rotation procedure section (step-by-step instructions + ≥2 language code examples) into every workspace's developer documentation.

**Independent Test**: Call `buildRotationProcedureSection(workspaceContext)` with a mock workspace; confirm returned markdown contains step-by-step instructions, grace period explanation, JavaScript and Python code examples, and workspace base URL.

- [ ] T037 [P] [US4] Create `services/workspace-docs-service/src/rotation-procedure-section.mjs` — ESM module exporting `buildRotationProcedureSection(workspaceContext)` → returns structured Markdown string containing: (a) step-by-step rotation procedure for both console and API flows; (b) grace period explanation (what it is, how to choose duration); (c) JavaScript (Node.js `fetch`) code example showing: initiate rotation, retrieve new key, update client config, confirm old key deprecated; (d) Python (`requests`) code example with same flow; (e) concurrent rotation warning; (f) link to credential management console page using `workspaceContext.baseUrl`
- [ ] T038 [US4] Extend `services/workspace-docs-service/src/doc-assembler.mjs` — import `buildRotationProcedureSection` from `rotation-procedure-section.mjs`; call it when assembling the credentials section and inject the result as a `## API Key Rotation Procedure` subsection under "API Keys & Credentials"
- [ ] T039 [US4] Create unit test `tests/unit/rotation-procedure-section.test.mjs` (Node `node:test`) — covers: (a) returned markdown contains `## API Key Rotation Procedure` heading; (b) contains at least two fenced code blocks (JS and Python); (c) `workspaceContext.baseUrl` is interpolated in at least one URL reference; (d) doc-assembler integration: rotation section present in assembled docs output

**Checkpoint**: `buildRotationProcedureSection` returns valid Markdown with ≥2 code examples; doc-assembler test confirms section appears in rendered workspace docs.

---

## Phase 7: User Story 5 — Configure Tenant-Level Rotation Policy (Priority: P3)

**Goal**: Allow tenant owners to enforce `maxCredentialAgeDays` and `maxGracePeriodSeconds` policies across all workspaces, with age-warning notifications for credentials approaching the deadline.

**Independent Test**: Set tenant policy with `maxGracePeriodSeconds=86400`; attempt rotation with `gracePeriodSeconds=90000` → 422 `POLICY_VIOLATION`; attempt with `gracePeriodSeconds=3600` → 202; set `maxCredentialAgeDays=90` and confirm age-warning Kafka event emitted for credentials older than `(90 - warnBeforeExpiryDays)` days.

- [ ] T040 [US5] Add `credentialAction === 'set-tenant-rotation-policy'` handler in `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` (or equivalent tenant-level route): (a) validate caller has `tenant_owner` or `tenant_admin` role; (b) call `validateTenantRotationPolicy`; (c) call `dependencies.upsertTenantRotationPolicy`; (d) return 200 with saved policy object
- [ ] T041 [US5] Add `GET /v1/tenants/{tenantId}/rotation-policy` and `PUT /v1/tenants/{tenantId}/rotation-policy` route handlers in control-plane router — enforce tenant-scoped RBAC; wire to `tenant-rotation-policy-repo.mjs`; validate request body against `TenantRotationPolicy` OpenAPI schema
- [ ] T042 [US5] Extend `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs` — add age-warning sweep: query credentials whose `issuedAt < NOW() - INTERVAL '(maxCredentialAgeDays - warnBeforeExpiryDays) days'` (joining with `tenant_rotation_policies`); for each: publish `console.credential-rotation.age-warning` Kafka event with `{ tenantId, workspaceId, serviceAccountId, credentialId, credentialAgeDays, policyMaxAgeDays }`; avoid duplicate warnings within the same day (deduplicate via DB flag or Kafka event idempotency key)
- [ ] T043 [US5] Create unit test `tests/unit/tenant-rotation-policy.test.mjs` (Node `node:test`) — covers: (a) `enforceRotationPolicy` rejects `gracePeriodSeconds` exceeding `maxGracePeriodSeconds` with `POLICY_VIOLATION`; (b) `enforceRotationPolicy` allows `gracePeriodSeconds` ≤ limit; (c) `enforceRotationPolicy` is no-op when no policy row exists (null policy = no restrictions); (d) age-warning sweep emits event for credentials past threshold; (e) age-warning sweep does not emit duplicate events within same run
- [ ] T044 [US5] Extend integration test `tests/integration/api-key-rotation-grace-period.test.mjs` — add: tenant policy set → rotation request exceeding `maxGracePeriodSeconds` returns 422; rotation request within limit returns 202

**Checkpoint**: Tenant policy CRUD operational; policy enforcement validated in unit and integration tests; age-warning sweep emits correct Kafka events.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Contract tests, final wiring, observability, and done-criteria verification.

- [ ] T045 [P] Create contract test `tests/contract/rotation-api-contract.test.mjs` (Node `node:test`) — validate JSON fixtures in `specs/089-api-key-rotation/contracts/` (rotation-request.schema.json, rotation-status.schema.json, rotation-history.schema.json, tenant-rotation-policy.schema.json) against the `CredentialRotationStatus`, `CredentialRotationHistoryEntry`, and `TenantRotationPolicy` schemas added in T013; assert no additional-properties violations; assert required fields present
- [ ] T046 [P] Create/update `specs/089-api-key-rotation/contracts/rotation-request.schema.json` — fixture example for `ServiceAccountCredentialRotationRequest` with `gracePeriodSeconds=3600`
- [ ] T047 [P] Create/update `specs/089-api-key-rotation/contracts/rotation-status.schema.json` — fixture example for `CredentialRotationStatus` in `in_progress` state
- [ ] T048 [P] Create/update `specs/089-api-key-rotation/contracts/rotation-history.schema.json` — fixture example for `CredentialRotationHistoryEntry` list
- [ ] T049 [P] Create/update `specs/089-api-key-rotation/contracts/tenant-rotation-policy.schema.json` — fixture example for `TenantRotationPolicy`
- [ ] T050 [P] Create/update `specs/089-api-key-rotation/contracts/rotation-events.kafka.json` — Kafka event envelope fixtures for all five new topics: `console.credential-rotation.initiated`, `console.credential-rotation.deprecated-expired`, `console.credential-rotation.force-completed`, `console.credential-rotation.policy-violation`, `console.credential-rotation.age-warning`
- [ ] T051 Verify all new test files are discoverable by the root-level test runner — check `pnpm test` configuration (package.json scripts or vitest/node:test glob patterns) and add any required path inclusions; ensure no import resolution errors
- [ ] T052 Review and update `AGENTS.md` — append 089-api-key-rotation summary to Active Technologies, Project Structure, and Recent Changes sections; add new env vars: `CREDENTIAL_MAX_ACTIVE_PER_SERVICE_ACCOUNT`, `ROTATION_SWEEP_BATCH_SIZE`, `ROTATION_SWEEP_INTERVAL_SECONDS` to documentation
- [ ] T053 Verify `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` is clean — confirm no hardcoded secrets, all constraints idempotent, correct index names; manual diff review
- [ ] T054 Smoke-test observability: confirm `service_account_rotation_states` monitoring query `SELECT COUNT(*) FROM service_account_rotation_states WHERE state = 'in_progress'` executes against test DB without error; document alert threshold recommendation in `specs/089-api-key-rotation/plan.md` Observability section

**Checkpoint (Done Criteria)**:
- DC-001 ✅ Grace-period rotation returns 202; both keys auth OK in overlap window
- DC-002 ✅ Old credential invalidated within 60 s of grace period expiry (sweep test)
- DC-003 ✅ Force-complete immediately invalidates old key (unit + integration)
- DC-004 ✅ Concurrent rotation returns 409 (unit test)
- DC-005 ✅ Policy violation returns 422 (unit test)
- DC-006 ✅ `Credential-Deprecated` header present on deprecated-key requests (integration test)
- DC-007 ✅ 100% rotation actions in history table and Kafka topics (integration + event assertions)
- DC-008 ✅ `GET /rotation-status` returns accurate `remainingSeconds` (integration test)
- DC-009 ✅ `GET /rotation-history` returns chronological list (integration test)
- DC-010 ✅ Console displays `CredentialRotationStatusPanel` for in-progress rotations (component tests)
- DC-011 ✅ Workspace docs include rotation section with ≥2 language examples (doc assembler test)
- DC-012 ✅ Contract tests validate all new OpenAPI schemas against fixtures (contract test suite)
- DC-013 ✅ All new tests wired into root-level runner, `pnpm test` green
- DC-014 ✅ No secrets committed; migration file reviewed clean (T053)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — core rotation engine
- **US2 (Phase 4)**: Depends on Phase 3 (force-complete extends WF-CON-004 grace-period path)
- **US3 (Phase 5)**: Depends on Phase 2 (API contract) + Phase 3 (rotation state data) + Phase 4 (force-complete action)
- **US4 (Phase 6)**: Depends on Phase 2 only — docs section is independent of UI
- **US5 (Phase 7)**: Depends on Phase 3 (policy enforcement in rotation workflow) + Phase 2 (policy table)
- **Polish (Phase 8)**: Depends on all preceding phases complete

### Parallel Opportunities Within Phases

- **Phase 2**: T008, T009, T010 (model files) can run in parallel; T011, T012 (repos) can run in parallel after models; T013 + T014 (OpenAPI) can run in parallel with models/repos
- **Phase 3**: T019 (APISIX plugin config) can run in parallel with T015–T017 (WF extension); T020, T021 (unit tests) can run in parallel once T015–T018 complete
- **Phase 5**: T027, T028, T032, T033 (new console components + their tests) can run in parallel; T035 (API route handlers) can run in parallel with console work
- **Phase 6**: Fully parallelisable with Phase 5 (different files, different service)
- **Phase 8**: T045–T050 (fixture files + contract test) all parallelisable

### Critical Path

```text
T001–T004 (Setup)
  → T005–T007 (Migration)
    → T008–T012 (Models + Repos)      ← parallel group
    → T013–T014 (OpenAPI contract)    ← parallel group
      → T015–T019 (WF-CON-004 + APISIX) ← US1 core
        → T020–T022 (US1 tests)
          → T023–T026 (US2: force-complete + tests)
            → T027–T036 (US3: console UI + API handlers)
            → T037–T039 (US4: docs section) ← parallel with US3
            → T040–T044 (US5: tenant policy) ← parallel with US3/US4
              → T045–T054 (Polish + done criteria)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (DB migration, models, repos, contract)
3. Complete Phase 3: US1 (grace-period rotation + sweep + APISIX plugin)
4. **STOP and VALIDATE**: Both keys auth; old key expires; unit + integration tests green
5. Deploy/demo grace-period rotation capability

### Incremental Delivery

1. Setup + Foundational → Core data layer + contract ready
2. US1 → Grace-period rotation live (MVP)
3. US2 → Emergency rotation with audit trail (security incident path)
4. US3 → Status/history visibility in console
5. US4 → Self-service rotation docs in workspace developer portal
6. US5 → Tenant-level policy enforcement (compliance)

### Parallel Team Strategy

With ≥2 developers (after Phase 2 complete):

- **Dev A**: Phase 3 (WF-CON-004 + sweep) → Phase 4 (force-complete) → Phase 7 (tenant policy)
- **Dev B**: Phase 5 (console UI + API handlers) — independent of Dev A after contract is locked
- **Dev C**: Phase 6 (docs section) → Phase 8 polish — fully independent

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies
- Grace period of exactly `0` is treated identically to immediate rotation (spec edge case)
- The unique partial index `uq_rotation_in_progress` provides DB-level conflict guarantee (R-003)
- APISIX `key-auth` plugin `keys` array support must be verified against deployed APISIX version before T019 merges (risk R-001 in plan.md)
- All Keycloak credential operations must be wrapped in try/catch with compensating revoke (risk R-002)
- Sweep is belt-and-suspenders; APISIX plugin also enforces `deprecated_expires_at` on the hot path
- `rotation_lock_version` column is reserved for future optimistic-lock upgrades; initial implementation relies on the partial unique index
- History records older than 180 days are candidates for archival (future sweep extension — out of scope for this task set)
