# Tasks: Realtime Channel & Subscription Model per Workspace

**Feature Branch**: `079-realtime-channel-subscriptions`  
**Spec**: `specs/079-realtime-channel-subscriptions/spec.md`  
**Plan**: `specs/079-realtime-channel-subscriptions/plan.md`  
**Backlog Unit**: US-DX-01-T01 — Diseñar el modelo de channels/subscriptions por workspace y tipo de evento  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador

**Input**: Design documents from `/specs/079-realtime-channel-subscriptions/`  
**Prerequisites**: plan.md ✅, spec.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths reflect the plan's structure under `services/provisioning-orchestrator/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure directory scaffolding and environment config are in place before any code is written.

- [ ] T001 Create directory structure: `services/provisioning-orchestrator/src/actions/realtime/`, `models/realtime/`, `repositories/realtime/`, `events/realtime/`
- [ ] T002 Create directory structure: `tests/unit/realtime/`, `tests/integration/realtime/`, `tests/contract/realtime/`
- [ ] T003 [P] Document new environment variables in `.env.example` / Helm values: `REALTIME_SUBSCRIPTION_DEFAULT_QUOTA`, `REALTIME_TENANT_DEFAULT_QUOTA`, `REALTIME_SUBSCRIPTION_KAFKA_TOPIC`, `REALTIME_SUBSCRIPTION_KAFKA_RETENTION_MS`, `REALTIME_CHANNELS_CACHE_TTL_SECONDS`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema and domain model core — MUST be complete before any user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Migrations

- [ ] T004 Author migration `services/provisioning-orchestrator/src/migrations/0020_create_realtime_channels.sql` — DDL for `realtime_channels` table + indexes + `DOWN` rollback script
- [ ] T005 Author migration `services/provisioning-orchestrator/src/migrations/0021_create_realtime_subscriptions.sql` — DDL for `realtime_subscriptions` table + partial indexes + `DOWN` rollback script
- [ ] T006 [P] Author migration `services/provisioning-orchestrator/src/migrations/0022_create_subscription_quotas.sql` — DDL for `subscription_quotas` + seed platform-default quota row per existing tenant + `DOWN` rollback script
- [ ] T007 [P] Author migration `services/provisioning-orchestrator/src/migrations/0023_create_subscription_audit_log.sql` — DDL for `subscription_audit_log` (append-only) + indexes + `DOWN` rollback script
- [ ] T008 Apply migrations 0020–0023 to local/CI test PostgreSQL instance and verify schema

### Domain Models

- [ ] T009 [P] Implement `services/provisioning-orchestrator/src/models/realtime/ChannelType.mjs` — ESM class: attributes (id, tenant_id, workspace_id, channel_type, data_source_kind, data_source_ref, status, kafka_topic_pattern), factory/validation helpers
- [ ] T010 [P] Implement `services/provisioning-orchestrator/src/models/realtime/EventFilter.mjs` — JSON Schema definition (`table_name`, `collection_name`, `operations`, `schema_name`), `validate(filter)` and `matches(filter, event)` functions with AND semantics; null filter = match-all
- [ ] T011 Implement `services/provisioning-orchestrator/src/models/realtime/Subscription.mjs` — ESM class with all attributes (FR-004), state machine (`active→suspended`, `suspended→active`, `any→deleted`), `transition(action)` method throwing on illegal transitions (depends on T010)
- [ ] T012 [P] Implement `services/provisioning-orchestrator/src/models/realtime/SubscriptionQuota.mjs` — quota evaluation logic: workspace-level → tenant-level → platform-default fallback; `checkAllowed(currentCount, quota)` helper

**Checkpoint**: Schema applied + domain models ready — user story implementation can begin in parallel.

---

## Phase 3: User Story 1 — Developer Subscribes to a Workspace Channel (Priority: P1) 🎯 MVP

**Goal**: A developer can browse available channel types for their workspace, create a subscription, and retrieve it by ID.

**Independent Test**: Create a workspace → list available channel types (GET /channels) → create a subscription for one channel type → retrieve the subscription by ID; verify persisted data matches request.

### Repositories (US1 foundation)

- [ ] T013 [P] [US1] Implement `services/provisioning-orchestrator/src/repositories/realtime/ChannelRepository.mjs` — `findByWorkspace(tenantId, workspaceId, status?)`, `findById(tenantId, channelId)` — all queries include `tenant_id` + `workspace_id` predicates
- [ ] T014 [US1] Implement `services/provisioning-orchestrator/src/repositories/realtime/SubscriptionRepository.mjs` — `create(data)`, `findById(tenantId, workspaceId, id)`, `list(tenantId, workspaceId, filters, page, pageSize)` — all queries include isolation predicates; soft-delete aware
- [ ] T015 [P] [US1] Implement `services/provisioning-orchestrator/src/repositories/realtime/QuotaRepository.mjs` — `findQuota(tenantId, workspaceId)` (with tenant fallback), `atomicInsertWithQuotaCheck(tenantId, workspaceId, subscriptionData)` using CTE pattern from plan §2.3
- [ ] T016 [P] [US1] Implement `services/provisioning-orchestrator/src/repositories/realtime/AuditRepository.mjs` — `append(auditRow)` — INSERT only, no UPDATE/DELETE permissions assumed

### Kafka Publisher

- [ ] T017 [US1] Implement `services/provisioning-orchestrator/src/events/realtime/SubscriptionLifecyclePublisher.mjs` — publish CloudEvents envelope to `console.realtime.subscription-lifecycle`; partitioned by `workspace_id`; valid actions: `created`, `suspended`, `reactivated`, `deleted`, `updated` (depends on T014)

### OpenWhisk Actions

- [ ] T018 [US1] Implement `services/provisioning-orchestrator/src/actions/realtime/realtime-channel-list.mjs` — input: `{workspaceId, tenantId}` from JWT headers; query ChannelRepository for `status='available'`; return channel list; no writes (depends on T013)
- [ ] T019 [US1] Implement `services/provisioning-orchestrator/src/actions/realtime/realtime-subscription-crud.mjs` — CREATE flow: validate channel availability (FR-013), validate event filter schema, atomic quota check+insert, write audit log, publish Kafka `created` event; READ flow: get by ID with isolation predicates; LIST flow: paginated SELECT (FR-014) (depends on T014, T015, T016, T017)

### Unit Tests

- [ ] T020 [P] [US1] Write unit tests `tests/unit/realtime/EventFilter.test.mjs` — null filter matches all events; table_name filter; collection_name filter; operations filter; AND logic; schema validation rejects unknown fields
- [ ] T021 [P] [US1] Write unit tests `tests/unit/realtime/Subscription.test.mjs` — valid transitions (active→suspended, suspended→active, active→deleted, suspended→deleted); invalid transitions throw; `deleted` is terminal
- [ ] T022 [P] [US1] Write unit tests `tests/unit/realtime/SubscriptionQuota.test.mjs` — under-limit allows; at-limit blocks; workspace quota overrides tenant quota; tenant quota overrides platform default; platform default applied when no rows exist

### Integration Tests (US1)

- [ ] T023 [US1] Write integration tests `tests/integration/realtime/subscription-crud.test.mjs` — create subscription → list → get by ID; channel type unavailable → 400; event filter invalid → 400; response shape matches API contract (SC-001: create < 5 s)
- [ ] T024 [US1] Write integration tests `tests/integration/realtime/quota-enforcement.test.mjs` — sequential inserts up to quota → accepted; insert at quota+1 → 409 QUOTA_EXCEEDED; concurrent `Promise.all` inserts at limit → no over-allocation (SC-006)

**Checkpoint**: GET /channels and POST+GET /subscriptions fully functional and tested.

---

## Phase 4: User Story 2 — Workspace Admin Manages Subscriptions (Priority: P1)

**Goal**: Workspace admin can list all subscriptions in the workspace, suspend/reactivate/delete any subscription.

**Independent Test**: Create several subscriptions → list as admin → suspend one → verify status=suspended → reactivate → verify status=active → delete → verify 404 on subsequent GET.

### OpenWhisk Action Extensions

- [ ] T025 [US2] Extend `realtime-subscription-crud.mjs` with PATCH flow — validate target subscription belongs to workspace/tenant; validate status transition via `Subscription.transition()`; UPDATE row (`status`, `updated_at`); write audit log; publish Kafka event; return updated subscription (depends on T019)
- [ ] T026 [US2] Extend `realtime-subscription-crud.mjs` with DELETE flow — soft-delete: set `status='deleted'`, `deleted_at=now()`; write audit log; publish Kafka `deleted` event; return 204 (depends on T025)

### Integration Tests (US2)

- [ ] T027 [US2] Extend `tests/integration/realtime/subscription-crud.test.mjs` — admin list returns all workspace subscriptions with owner/channel/status (SC-002: < 3 s for 500 subs); suspend → status=suspended; reactivate → status=active; delete → 404 on re-GET; illegal transition → 409 INVALID_STATUS_TRANSITION

### Audit Verification

- [ ] T028 [US2] Add audit log assertions to `subscription-crud.test.mjs` — after each lifecycle operation (create/suspend/reactivate/delete) query `subscription_audit_log` and verify: action, actor_identity, before_state, after_state populated; occurs within 30 s (SC-005)

**Checkpoint**: Full CRUD lifecycle + admin governance operational and tested.

---

## Phase 5: User Story 4 — System Routes Events to Matching Subscriptions (Priority: P1)

**Goal**: Given an incoming event (workspaceId, channelType, dataSourceRef, operation, tableName/collectionName), resolve the correct set of active matching subscriptions.

**Independent Test**: Create subscriptions with various filters → simulate event inputs → assert exact set of matching subscription IDs returned; verify suspended subscriptions are excluded; verify cross-workspace subscriptions are excluded.

### Resolver Action

- [ ] T029 [US4] Implement `services/provisioning-orchestrator/src/actions/realtime/realtime-subscription-resolver.mjs` — input: `{workspaceId, channelType, dataSourceRef, operation, tableName?, collectionName?}`; execute resolver SQL from plan §4.3 using JSONB operators; return `[{id, owner_identity, event_filter, metadata}]`; read-only, no Kafka events (depends on T014)

### Integration Tests

- [ ] T030 [US4] Write integration tests `tests/integration/realtime/subscription-resolver.test.mjs` — null-filter matches all events on channel; table_name filter matches only correct table; operations filter matches only listed ops; AND: table+ops both must match; suspended subscription excluded (SC-003); cross-workspace subscription excluded (SC-004); cross-tenant subscription excluded (SC-004); three-subscription matrix from spec AC-1

**Checkpoint**: Subscription resolver returns 100% accurate match set — ready for T02/T03 CDC wiring.

---

## Phase 6: User Story 3 — Tenant Owner Reviews Cross-Workspace Subscription Activity (Priority: P2)

**Goal**: Tenant owner can query per-workspace subscription counts grouped by status and channel type; subscription creation beyond tenant-level quota is rejected.

**Independent Test**: Create subscriptions across multiple workspaces under one tenant → query tenant summary → verify per-workspace counts match; set tenant quota to 2 → create 2 → third creation → 409 QUOTA_EXCEEDED.

### Tenant Summary Endpoint

- [ ] T031 [US3] Add `findTenantSummary(tenantId, page, pageSize)` to `SubscriptionRepository.mjs` — aggregate `COUNT(*) GROUP BY workspace_id, status, channel_type WHERE tenant_id = $1 AND status != 'deleted'`
- [ ] T032 [US3] Implement tenant summary route handler in `realtime-subscription-crud.mjs` (or dedicated `realtime-tenant-summary.mjs`) — GET `/tenants/{tenantId}/realtime/subscriptions/summary`; paginated; requires `tenant:admin` Keycloak role; include `tenant_id` predicate; return `{items: [{workspace_id, status, channel_type, count}], total}` (depends on T031)

### Quota Tenant-Level Tests

- [ ] T033 [US3] Extend `tests/integration/realtime/quota-enforcement.test.mjs` — tenant-level quota: subscriptions across N workspaces sum toward tenant cap; cross-tenant isolation: tenant A quota does not affect tenant B

**Checkpoint**: Tenant observability and cross-workspace quota enforcement complete.

---

## Final Phase: Polish, Contracts & Cross-Cutting Concerns

**Purpose**: OpenAPI contract, APISIX routes, Kafka contract tests, observability notes, and integration consistency sweep.

- [ ] T034 [P] Author OpenAPI 3.1 contract `specs/079-realtime-channel-subscriptions/openapi/realtime-subscriptions-v1.yaml` — paths: GET /channels, POST /subscriptions, GET /subscriptions, GET /subscriptions/{id}, PATCH /subscriptions/{id}, DELETE /subscriptions/{id}, GET /tenants/{tenantId}/realtime/subscriptions/summary; include error schemas (INVALID_CHANNEL_TYPE, QUOTA_EXCEEDED, INVALID_STATUS_TRANSITION, SUBSCRIPTION_NOT_FOUND)
- [ ] T035 [P] Write contract tests `tests/contract/realtime/subscription-lifecycle-event.test.mjs` — validate CloudEvents envelope: `specversion`, `type`, `source`, `id`, `time`, `tenantid`, `workspaceid`, `data`; `action` enum values; `before_state` null on `created`, present on `suspended`/`reactivated`/`deleted`; `after_state` null on `deleted`
- [ ] T036 [P] Author APISIX route configuration — subscription CRUD route (`/api/v1/workspaces/*/realtime/subscriptions*`) with `openid-connect` + `proxy-rewrite` plugins; channel list route (`/api/v1/workspaces/*/realtime/channels`); JWT claims forwarded as `X-Identity-Subject`, `X-Tenant-ID`, `X-Workspace-ID`
- [ ] T037 Add metrics instrumentation comments/stubs in actions: `realtime_subscriptions_created_total`, `realtime_subscriptions_active_gauge`, `realtime_subscription_resolver_matches_total`, `realtime_quota_rejections_total` — document expected labels in `services/provisioning-orchestrator/src/actions/realtime/METRICS.md`
- [ ] T038 Verify no existing test suite regressions: run full test suite for `services/provisioning-orchestrator` and confirm 0 new failures

---

## Dependency Graph

```text
T001–T003 (Setup)
    │
    ▼
T004–T008 (Migrations) ──┐
                          │
T009–T012 (Domain Models)─┤
                          │
                          ▼
           T013–T017 (Repositories + Kafka Publisher)
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
     T018–T024        T029–T030    T031–T033
       (US1)             (US4)       (US3)
             │
             ▼
         T025–T028
           (US2)
             │
             ▼
         T034–T038
          (Polish)
```

## Parallel Execution Opportunities

| Parallel Group | Tasks |
|----------------|-------|
| Migrations (after T001) | T004, T005, T006, T007 in parallel |
| Domain models (after T008) | T009, T010, T012 in parallel; T011 after T010 |
| Repositories (after T012) | T013, T015, T016 in parallel; T014 sequential; T017 after T014 |
| Unit tests | T020, T021, T022 fully parallel |
| US1 actions (after T017) | T018 and T019 sequential on T013–T017 |
| Final phase | T034, T035, T036, T037 in parallel |

## Implementation Strategy

**MVP** (deliver value fastest): Complete Phases 1–3 (T001–T024) → US1 fully functional.  
**Sprint 1**: Phases 1–4 (US1 + US2) → full subscription lifecycle for developers and admins.  
**Sprint 2**: Phases 5–6 + Final (US4 + US3 + polish) → resolver, tenant observability, contracts.

---

## Done Criteria (US-DX-01-T01)

- [ ] All four migrations (0020–0023) authored and applied successfully to a clean PostgreSQL instance
- [ ] Domain models (ChannelType, Subscription, EventFilter, SubscriptionQuota) fully implemented with ESM exports
- [ ] Unit tests pass: 100% branch coverage on state machine (Subscription) and filter matching (EventFilter)
- [ ] Repositories implement tenant+workspace isolation predicates on every query
- [ ] Integration tests pass: full CRUD lifecycle, cross-workspace isolation, quota enforcement (no race conditions)
- [ ] `realtime-subscription-resolver` returns correct match set across all filter combinations (SC-003)
- [ ] Kafka contract tests validate CloudEvents envelope for all lifecycle event types
- [ ] OpenAPI 3.1 contract covers all endpoints (channels list, subscription CRUD, tenant summary)
- [ ] Environment variables documented in `.env.example` and Helm values
- [ ] APISIX route configuration authored
- [ ] No regressions in existing `provisioning-orchestrator` test suite
