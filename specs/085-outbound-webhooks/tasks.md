# Tasks: Outbound Webhooks for Selected Events (US-DX-02-T01)

**Feature Branch**: `085-outbound-webhooks`
**Spec**: `specs/085-outbound-webhooks/spec.md`
**Plan**: `specs/085-outbound-webhooks/plan.md`
**Task**: US-DX-02-T01 — Implementar webhooks salientes para eventos seleccionados con gestión de reintentos y firma si aplica
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador
**Status**: Ready for implementation

## Format: `[ID] [P?] [Story?] Description with exact file path`

- **[P]**: Parallelizable (different files, no shared state dependency)
- **[US#]**: Maps to user story in spec.md
- All paths relative to repo root

---

## File-Path Map (Implementation Reference)

| File | Purpose | Phase |
|---|---|---|
| `services/webhook-engine/package.json` | ESM package manifest for webhook-engine | 1 |
| `services/webhook-engine/src/event-catalogue.mjs` | Static event type catalogue | 2 |
| `services/webhook-engine/src/webhook-subscription.mjs` | Pure-functional subscription model & validators | 2 |
| `services/webhook-engine/src/webhook-delivery.mjs` | Delivery state machine helpers | 2 |
| `services/webhook-engine/src/webhook-signing.mjs` | HMAC-SHA256 signing + AES-256-GCM secret encryption helpers | 2 |
| `services/webhook-engine/src/webhook-retry-policy.mjs` | Exponential back-off + jitter calculator | 2 |
| `services/webhook-engine/src/webhook-quota.mjs` | Per-workspace subscription quota & rate-limit helpers | 2 |
| `services/webhook-engine/src/webhook-audit.mjs` | Audit event builders for Kafka publication | 2 |
| `services/webhook-engine/migrations/001-webhook-subscriptions.sql` | DDL for webhook_subscriptions, webhook_signing_secrets, webhook_deliveries, webhook_delivery_attempts | 2 |
| `services/webhook-engine/actions/webhook-management.mjs` | OpenWhisk action: subscription CRUD + lifecycle | 3, 6 |
| `services/webhook-engine/actions/webhook-dispatcher.mjs` | OpenWhisk action: Kafka event fan-out to subscriptions | 4 |
| `services/webhook-engine/actions/webhook-delivery-worker.mjs` | OpenWhisk action: HTTP POST delivery with signing | 4, 5 |
| `services/webhook-engine/actions/webhook-retry-scheduler.mjs` | OpenWhisk action: schedule next retry invocation | 5 |
| `tests/unit/webhook-subscription.test.mjs` | Unit tests for subscription model | 2 |
| `tests/unit/webhook-delivery.test.mjs` | Unit tests for delivery state machine | 2 |
| `tests/unit/webhook-signing.test.mjs` | Unit tests for signing & encryption helpers | 2 |
| `tests/unit/webhook-retry-policy.test.mjs` | Unit tests for retry back-off policy | 2 |
| `tests/unit/webhook-quota.test.mjs` | Unit tests for quota/rate-limit helpers | 2 |
| `tests/unit/webhook-audit.test.mjs` | Unit tests for audit event builders | 2 |
| `tests/integration/webhook-management-action.test.mjs` | Integration tests: subscription CRUD lifecycle with PG | 3, 6 |
| `tests/integration/webhook-dispatcher.test.mjs` | Integration tests: event fan-out and isolation | 4 |
| `tests/integration/webhook-delivery-worker.test.mjs` | Integration tests: HTTP delivery, retry, auto-disable | 4, 5 |
| `tests/contracts/webhook-api.contract.test.mjs` | Contract tests: request/response shapes and delivery headers | Polish |
| `tests/e2e/outbound-webhooks/README.md` | E2E scenario matrix documentation | Polish |
| `deploy/apisix/routes/webhooks.yaml` | APISIX route manifest for `/v1/webhooks/**` | Polish |
| `deploy/helm/webhook-engine-values.yaml` | Helm values: secrets, env vars, OpenWhisk action manifests | Polish |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the `webhook-engine` service skeleton and confirm ESM project tooling.

- [ ] T001 Create `services/webhook-engine/` directory structure (`src/`, `actions/`, `migrations/`) and `services/webhook-engine/package.json` with `"type": "module"`, `node:test` runner config, and declared dependencies (`pg`, `kafkajs`, `node:crypto`)
- [ ] T002 [P] Add `services/webhook-engine/` entry to pnpm workspace config in `pnpm-workspace.yaml` (or relevant workspace manifest) so the new package is recognized
- [ ] T003 [P] Create `services/webhook-engine/.eslintrc.cjs` inheriting the repo ESLint config and add a `lint` script to `package.json`

**Checkpoint**: `pnpm install` resolves without errors; `pnpm --filter webhook-engine lint` runs (no source yet — just confirming tooling).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, event catalogue, and all pure-functional modules that every action depends on. No user story work can start until this phase is complete.

**⚠️ CRITICAL**: All actions (Phases 3–7) depend on these files and the migration being applied.

- [ ] T004 Create PostgreSQL migration `services/webhook-engine/migrations/001-webhook-subscriptions.sql` with `CREATE TABLE IF NOT EXISTS` DDL for all four tables (`webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries`, `webhook_delivery_attempts`) including all indexes defined in plan.md §4.1; apply to dev/CI database
- [ ] T005 [P] Create `services/webhook-engine/src/event-catalogue.mjs` — export `EVENT_CATALOGUE` array with initial entries (`document.created`, `document.updated`, `document.deleted`, `user.signed_up`, `function.completed`, `storage.object.created`) and `isValidEventType(id)` helper
- [ ] T006 [P] Create `services/webhook-engine/src/webhook-signing.mjs` — export `generateSigningSecret()` (32-byte random hex), `encryptSecret(plaintext, masterKey)` (AES-256-GCM, returns `{cipher, iv}`), `decryptSecret(cipher, iv, masterKey)`, `computeSignature(rawBody, secret)` (HMAC-SHA256, returns `sha256=<hex>`), `verifySignature(rawBody, secret, header)` (constant-time comparison)
- [ ] T007 [P] Create `services/webhook-engine/src/webhook-subscription.mjs` — export `validateSubscriptionInput({targetUrl, eventTypes})` (HTTPS-only URL check, SSRF private-IP rejection, event type catalogue validation), `buildSubscriptionRecord(input, context)`, `canTransition(currentStatus, targetStatus)`, `applyStatusTransition(subscription, status)`, `softDelete(subscription)`
- [ ] T008 [P] Create `services/webhook-engine/src/webhook-delivery.mjs` — export `buildDeliveryRecord(subscription, event)`, `buildDeliveryAttemptRecord(deliveryId, attemptNum, outcome)`, `isTerminal(delivery)`, `shouldAutoDisable(subscription, consecutiveFailuresThreshold)`, `buildPayloadEnvelope(delivery, event)`, `enforcePayloadSizeLimit(payload, maxBytes)` (truncate + set `payload_ref`)
- [ ] T009 [P] Create `services/webhook-engine/src/webhook-retry-policy.mjs` — export `computeNextDelay(attemptNum, {baseMs, maxMs})` (exponential back-off with jitter), `hasRetriesRemaining(attemptCount, maxAttempts)`, `computeNextAttemptAt(attemptNum, config)`, `buildRetryPolicy()` reads env vars `WEBHOOK_BASE_BACKOFF_MS`, `WEBHOOK_MAX_BACKOFF_MS`, `WEBHOOK_MAX_RETRY_ATTEMPTS`
- [ ] T010 [P] Create `services/webhook-engine/src/webhook-quota.mjs` — export `checkSubscriptionQuota(workspaceId, currentCount, limit)`, `checkDeliveryRateLimit(workspaceId, windowCounterRow, limitPerMinute)`, `incrementRateCounter(pg, workspaceId)` (upsert counter with TTL), `getWorkspaceSubscriptionCount(pg, tenantId, workspaceId)`
- [ ] T011 [P] Create `services/webhook-engine/src/webhook-audit.mjs` — export builders `subscriptionCreatedEvent`, `subscriptionUpdatedEvent`, `subscriptionDeletedEvent`, `subscriptionPausedEvent`, `subscriptionResumedEvent`, `secretRotatedEvent`, `deliverySucceededEvent`, `deliveryPermanentlyFailedEvent`, `subscriptionAutoDisabledEvent` — each returns Kafka message with `{tenantId, workspaceId, actorId, action, resourceId, timestamp}` and NO signing secrets or raw payloads
- [ ] T012 [P] Write `tests/unit/webhook-signing.test.mjs` — unit tests covering: deterministic HMAC for same key+body; different body produces different signature; encrypt→decrypt round-trip; grace-period scenario (two secrets both verify); after revocation old secret fails; constant-time comparison behaviour
- [ ] T013 [P] Write `tests/unit/webhook-subscription.test.mjs` — unit tests covering: valid construction; non-HTTPS URL rejection; SSRF private-IP rejection; unknown event type rejection; quota check (at-limit, over-limit, within-limit); all valid status transitions; invalid transitions throw; soft-delete sets `deleted_at` and status `deleted`
- [ ] T014 [P] Write `tests/unit/webhook-delivery.test.mjs` — unit tests covering: payload envelope structure; attempt record construction; terminal state detection; auto-disable threshold evaluation; payload size enforcement (truncation + `payload_ref` assignment)
- [ ] T015 [P] Write `tests/unit/webhook-retry-policy.test.mjs` — unit tests covering: attempt 1–5 produce monotonically increasing delays ≤ `WEBHOOK_MAX_BACKOFF_MS`; jitter within expected range (seed-deterministic); attempts beyond `max_attempts` return `null`
- [ ] T016 [P] Write `tests/unit/webhook-quota.test.mjs` — unit tests covering: subscription count check (at-limit false, under-limit true); rate limit counter logic; env-var-driven defaults
- [ ] T017 [P] Write `tests/unit/webhook-audit.test.mjs` — unit tests covering: all audit builders return required fields (`tenantId`, `workspaceId`, `actorId`, `action`, `resourceId`, `timestamp`); no `signingSecret` or raw event data appears in any audit payload

**Checkpoint**: All unit tests pass (`pnpm --filter webhook-engine test`); ≥90% line coverage on all `src/` modules; migration applies cleanly on a fresh database.

---

## Phase 3: User Story 1 — Register a Webhook Subscription (Priority: P1) 🎯 MVP

**Goal**: A developer can create a webhook subscription, receive a signing secret once, and retrieve subscription details.

**Independent Test**: POST /v1/webhooks/subscriptions returns 201 with `signingSecret`; subsequent GET /v1/webhooks/subscriptions/:id returns the subscription without the secret.

- [ ] T018 [US1] Implement `services/webhook-engine/actions/webhook-management.mjs` — OpenWhisk action handler with routing by `method`+`path`; implement `POST /subscriptions` handler: extract `tenantId`/`workspaceId` from JWT claims, call `validateSubscriptionInput`, check subscription quota via `webhook-quota.mjs`, generate + encrypt signing secret via `webhook-signing.mjs`, insert into `webhook_subscriptions` + `webhook_signing_secrets` in a PG transaction, publish `subscriptionCreatedEvent` to Kafka via `webhook-audit.mjs`, return 201 with `signingSecret` (plaintext, once only)
- [ ] T019 [US1] Add `GET /subscriptions` handler to `services/webhook-engine/actions/webhook-management.mjs` — paginated list using cursor (subscription `id` ordering), filtered by `status` query param; response excludes `signingSecret`; enforces tenant/workspace isolation from JWT claims
- [ ] T020 [US1] Add `GET /subscriptions/:id` handler to `services/webhook-engine/actions/webhook-management.mjs` — returns subscription detail; rejects with 404 if not found or belongs to different workspace; response excludes `signingSecret`
- [ ] T021 [US1] Add `GET /event-types` handler to `services/webhook-engine/actions/webhook-management.mjs` — returns `EVENT_CATALOGUE` from `event-catalogue.mjs`
- [ ] T022 [US1] Write `tests/integration/webhook-management-action.test.mjs` — integration tests (requires PG): create subscription returns 201 + signingSecret; GET by id returns subscription without secret; GET list returns paginated results; non-HTTPS URL returns 400 INVALID_URL; unknown event type returns 400 INVALID_EVENT_TYPES; quota exceeded returns 409 QUOTA_EXCEEDED; wrong workspace returns 404; audit Kafka events emitted for create

**Checkpoint**: Integration tests for US1 pass. Developer can register a subscription and retrieve it; signing secret only visible at creation.

---

## Phase 4: User Story 2 — Receive Webhook Deliveries for Subscribed Events (Priority: P1)

**Goal**: When a subscribed event fires, the platform delivers an HMAC-signed HTTP POST to the target URL and records the attempt.

**Independent Test**: Trigger a mock Kafka event; confirm HTTP POST is sent to mock server with correct headers (`X-Platform-Webhook-Signature`, `X-Platform-Webhook-Event`, etc.) and payload; attempt logged as succeeded.

- [ ] T023 [US2] Create `services/webhook-engine/actions/webhook-dispatcher.mjs` — OpenWhisk action: receives a Kafka event envelope; queries `webhook_subscriptions` for all `active` subscriptions matching `eventType` and `workspaceId`; enforces tenant/workspace isolation (never crosses boundaries); checks delivery rate limit via `webhook-quota.mjs`; inserts `webhook_deliveries` rows using `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, event_id)` for idempotency; invokes `webhook-delivery-worker.mjs` async per delivery
- [ ] T024 [US2] Create `services/webhook-engine/actions/webhook-delivery-worker.mjs` — OpenWhisk action: receives `{deliveryId}`; fetches delivery + subscription + active signing secrets from PG; builds payload envelope via `webhook-delivery.mjs`; signs with `computeSignature` from `webhook-signing.mjs`; sends HTTP POST to `target_url` with all required headers (`X-Platform-Webhook-Id`, `X-Platform-Webhook-Timestamp`, `X-Platform-Webhook-Event`, `X-Platform-Webhook-Signature`, `X-Platform-Webhook-Attempt`, `User-Agent: PlatformWebhook/1.0`); enforces `WEBHOOK_CONNECTION_TIMEOUT_MS` + `WEBHOOK_RESPONSE_TIMEOUT_MS`; does NOT follow 3xx redirects (treats as failure); on 2xx: updates delivery `status=succeeded`, increments `attempt_count`, inserts `webhook_delivery_attempts` record, publishes `deliverySucceededEvent` to Kafka; on failure: delegates to Phase 5 retry logic (stub for now: record attempt + update delivery `status=failed`)
- [ ] T025 [US2] Write `tests/integration/webhook-dispatcher.test.mjs` — integration tests (requires PG + mock Kafka): dispatches delivery rows for all active subscriptions matching event type+workspace; skips paused/disabled/deleted subscriptions; does not cross workspace or tenant boundaries; deduplicates on re-delivery of same event_id; respects rate limit
- [ ] T026 [US2] Write initial delivery-worker happy-path tests in `tests/integration/webhook-delivery-worker.test.mjs` — mock HTTP server returning 200: delivery marked `succeeded`; `webhook_delivery_attempts` row created with `outcome=succeeded`; response headers/payload structure matches contract from plan.md §5.2; 3xx response treated as failure (no request to redirect destination)

**Checkpoint**: Integration tests for US2 pass. Event-to-delivery pipeline works end-to-end for the success case.

---

## Phase 5: User Story 3 — Automatic Retry of Failed Deliveries (Priority: P1)

**Goal**: Failed deliveries are automatically retried with exponential back-off; after exhausting retries, delivery is permanently failed and subscription is auto-disabled at threshold.

**Independent Test**: Configure mock endpoint to fail N times then succeed; confirm N+1 attempts recorded, final delivery marked `succeeded`, subscription remains active.

- [ ] T027 [US3] Create `services/webhook-engine/actions/webhook-retry-scheduler.mjs` — OpenWhisk action: receives `{deliveryId, attemptCount}`; calls `hasRetriesRemaining` + `computeNextAttemptAt` from `webhook-retry-policy.mjs`; if retries remain: updates `webhook_deliveries.next_attempt_at` + `status=pending`, schedules re-invocation of `webhook-delivery-worker` after computed delay (using OpenWhisk alarm/delay trigger or scheduled async invocation); if no retries remain: marks delivery `status=permanently_failed`, increments `webhook_subscriptions.consecutive_failures`, checks `shouldAutoDisable` threshold — if exceeded: updates subscription `status=disabled`, publishes `subscriptionAutoDisabledEvent`; always publishes `deliveryPermanentlyFailedEvent` on final failure; for deleted/paused subscriptions: cancels retry and exits
- [ ] T028 [US3] Update `services/webhook-engine/actions/webhook-delivery-worker.mjs` — replace failure stub from T024: on non-2xx/timeout/3xx: insert `webhook_delivery_attempts` record with `outcome=failed|timed_out`, invoke `webhook-retry-scheduler.mjs` with `{deliveryId, attemptCount}`; after grace period, verify old secret is no longer accepted (integrate with `webhook-signing.mjs` grace-period logic)
- [ ] T029 [US3] Extend `tests/integration/webhook-delivery-worker.test.mjs` with retry scenarios: 5xx response schedules retry and inserts failed attempt; connection timeout schedules retry with `outcome=timed_out`; after max_attempts exceeded delivery is `permanently_failed`; subscription `consecutive_failures` incremented per permanently-failed delivery; auto-disable triggered at threshold; retry for deleted subscription is cancelled; delivery that fails N times then succeeds is marked `succeeded` with all N+1 attempts preserved

**Checkpoint**: Integration tests for US3 pass. Retry pipeline with auto-disable verified end-to-end.

---

## Phase 6: User Story 4 — Manage Webhook Subscriptions (Priority: P2)

**Goal**: Developers can update, pause, resume, rotate secrets, and soft-delete subscriptions; all operations are audited.

**Independent Test**: Full CRUD lifecycle via API: create → patch → pause → resume → rotate-secret → delete; all operations reflected in DB and audit Kafka events emitted.

- [ ] T030 [US4] Add `PATCH /subscriptions/:id` handler to `services/webhook-engine/actions/webhook-management.mjs` — allows updating `targetUrl`, `eventTypes`, `description`; validates new values with `validateSubscriptionInput`; updates `updated_at`; publishes `subscriptionUpdatedEvent`; returns updated subscription without secret
- [ ] T031 [US4] Add `POST /subscriptions/:id/pause` handler to `services/webhook-engine/actions/webhook-management.mjs` — transitions `active → paused` via `canTransition`; publishes `subscriptionPausedEvent`; returns updated subscription
- [ ] T032 [US4] Add `POST /subscriptions/:id/resume` handler to `services/webhook-engine/actions/webhook-management.mjs` — transitions `paused → active` via `canTransition`; publishes `subscriptionResumedEvent`; returns updated subscription
- [ ] T033 [US4] Add `DELETE /subscriptions/:id` handler to `services/webhook-engine/actions/webhook-management.mjs` — soft-deletes via `softDelete` (sets `deleted_at`, `status=deleted`); cancels pending deliveries (`UPDATE webhook_deliveries SET status='cancelled' WHERE subscription_id=... AND status='pending'`); publishes `subscriptionDeletedEvent`; returns 204
- [ ] T034 [US4] Add `POST /subscriptions/:id/rotate-secret` handler to `services/webhook-engine/actions/webhook-management.mjs` — generates new signing secret; inserts new `webhook_signing_secrets` row with `status=active`; updates old active row to `status=grace` with `grace_expires_at = now() + gracePeriodSeconds` (from request body or `WEBHOOK_SECRET_GRACE_PERIOD_SECONDS`); publishes `secretRotatedEvent`; returns `{newSigningSecret, gracePeriodSeconds, graceExpiresAt}` (plaintext shown once only)
- [ ] T035 [US4] Extend `tests/integration/webhook-management-action.test.mjs` with full lifecycle: PATCH updates fields and emits audit event; pause transitions to paused; resume transitions to active; delete soft-deletes and cancels pending deliveries; rotate-secret creates grace period (both secrets verify); after grace period only new secret verifies; invalid status transitions return 409; all operations emit Kafka audit events with required fields

**Checkpoint**: Integration tests for US4 pass. Full subscription management lifecycle verified.

---

## Phase 7: User Story 5 — View Delivery History and Debug Failures (Priority: P2)

**Goal**: Developers can inspect paginated delivery history per subscription with attempt-level detail for debugging.

**Independent Test**: Trigger several deliveries (mix of success/failure); query `GET /subscriptions/:id/deliveries`; confirm paginated records with correct status, attempt count, HTTP status codes; `GET /deliveries/:deliveryId` returns full attempt breakdown.

- [ ] T036 [US5] Add `GET /subscriptions/:id/deliveries` handler to `services/webhook-engine/actions/webhook-management.mjs` — paginated delivery history (cursor-based, max 100 per page); filterable by `status` (`succeeded|failed|permanently_failed`), `from`, `to` ISO date params; enforces workspace isolation; response shape per plan.md §5.1
- [ ] T037 [US5] Add `GET /subscriptions/:id/deliveries/:deliveryId` handler to `services/webhook-engine/actions/webhook-management.mjs` — returns delivery detail with all `webhook_delivery_attempts` rows ordered by `attempt_num`; enforces workspace isolation; returns 404 if delivery belongs to different workspace
- [ ] T038 [US5] Extend `tests/integration/webhook-management-action.test.mjs` with delivery history tests: paginated list returns correct records; status filter works; cross-workspace request returns 404; delivery detail includes all attempt records with `httpStatus`, `responseMs`, `outcome`; permanently-failed delivery shows all retry attempts

**Checkpoint**: Integration tests for US5 pass. Delivery history queryable with attempt-level detail.

---

## Phase 8: User Story 6 — Verify Webhook Signatures (Priority: P2)

**Goal**: Platform-published signature is verifiable using documented HMAC-SHA256 algorithm; unit tests prove correctness.

**Independent Test**: Receive a delivery from the worker; independently compute `HMAC-SHA256(signingSecret, rawBody)`; result matches `X-Platform-Webhook-Signature` header value.

> **Note**: Core signing logic is already implemented in `webhook-signing.mjs` (T006/T012). This phase adds verification documentation and a consumer-facing helper.

- [ ] T039 [US6] Add `verifyIncomingWebhook(rawBody, signatureHeader, secret)` export to `services/webhook-engine/src/webhook-signing.mjs` — consumer-facing helper that computes expected signature and does constant-time comparison; suitable for use in developer integration guides
- [ ] T040 [US6] Add verification round-trip tests to `tests/unit/webhook-signing.test.mjs` — tests confirming: delivery-worker-signed payload verifies with `verifyIncomingWebhook`; tampered body fails verification; tampered signature header fails verification; grace-period scenario: old secret still validates during grace, fails after revocation

**Checkpoint**: Signature verification helper tested and confirmed correct for all delivery-worker–produced payloads.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Contract tests, E2E documentation, deployment manifests, and AGENTS.md update.

- [ ] T041 [P] Write `tests/contracts/webhook-api.contract.test.mjs` — contract assertions for: POST /subscriptions request/response shape; GET /subscriptions list pagination shape; GET /subscriptions/:id/deliveries pagination shape; delivery HTTP headers and payload envelope structure; signature header format (`sha256=<hex>`); error response envelope `{"code":"<CODE>","message":"<string>"}` for all documented error codes
- [ ] T042 [P] Create `tests/e2e/outbound-webhooks/README.md` — document the 10 E2E scenario matrix from plan.md §7.4: happy path, failed-then-recovered, all-retries-exhausted, auto-disable, paused-subscription, quota-exceeded, cross-workspace-isolation, secret-rotation-grace, redirect-not-followed, payload-size-limit — each with Setup, Steps, Expected Outcome columns
- [ ] T043 [P] Create `deploy/apisix/routes/webhooks.yaml` — APISIX route manifest for `/v1/webhooks/**` → `webhook-management` OpenWhisk action with Keycloak JWT plugin; include upstream config and route priority per existing APISIX conventions in the repo
- [ ] T044 [P] Create `deploy/helm/webhook-engine-values.yaml` — Helm values for webhook-engine deployment: all env vars from plan.md §4.4 (with placeholder secret refs for `WEBHOOK_SIGNING_KEY`), OpenWhisk action deploy manifests for all four actions, Kafka topic creation entries for all nine topics from plan.md §4.3
- [ ] T045 Append webhook engine section to `AGENTS.md` following the existing convention — include: service name, ESM tech stack, new PostgreSQL tables, new Kafka topics, new env vars, new OpenWhisk actions

**Checkpoint**: All contract tests pass; E2E README complete; deployment manifests ready for review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phase 3 (US1)**: Depends on Phase 2 completion
- **Phase 4 (US2)**: Depends on Phase 2 completion; can start concurrently with Phase 3
- **Phase 5 (US3)**: Depends on Phase 4 (delivery worker stub from T024)
- **Phase 6 (US4)**: Depends on Phase 3 (management action established)
- **Phase 7 (US5)**: Depends on Phase 4 (deliveries exist); can start concurrently with Phase 6
- **Phase 8 (US6)**: Depends on Phase 2 (signing helpers); can start concurrently with Phase 3+
- **Phase 9 (Polish)**: Depends on Phases 3–8 being complete

### User Story Independence After Phase 2

Once Phase 2 is complete, these stories can proceed in parallel with sufficient developers:
- **US1 (Phase 3)** — standalone (management create+read)
- **US2 (Phase 4)** — standalone (dispatcher + delivery happy path); does not require US1 to be complete
- **US3 (Phase 5)** — extends US2 delivery worker
- **US4 (Phase 6)** — extends US1 management action
- **US5 (Phase 7)** — depends on deliveries from US2
- **US6 (Phase 8)** — mostly foundational, adds consumer helper

### Within Each Phase

- Multiple `[P]` tasks (same phase) can be executed in parallel — they target different files with no inter-dependency
- Non-`[P]` tasks within a phase must complete in listed order

### Key Blocking Chains

```text
T001 → T002 → T003 (Setup)
T004 (migration) → T018 (management action)
T005–T011 (pure modules) → T018, T023, T024, T027 (actions)
T012–T017 (unit tests) → CI gate before action implementation
T018 (create) → T030–T034 (US4 management extensions)
T023, T024 (dispatcher + worker) → T027, T028 (retry scheduler)
T024, T027, T028 → T036, T037 (delivery history)
```

---

## Parallel Execution Examples

### Phase 2: All foundational modules in parallel

```text
Parallel group A — pure-functional modules:
  T005 event-catalogue.mjs
  T006 webhook-signing.mjs
  T007 webhook-subscription.mjs
  T008 webhook-delivery.mjs
  T009 webhook-retry-policy.mjs
  T010 webhook-quota.mjs
  T011 webhook-audit.mjs

Parallel group B — unit tests (can start as each module completes):
  T012 webhook-signing.test.mjs
  T013 webhook-subscription.test.mjs
  T014 webhook-delivery.test.mjs
  T015 webhook-retry-policy.test.mjs
  T016 webhook-quota.test.mjs
  T017 webhook-audit.test.mjs

T004 (migration) runs independently of groups A/B
```

### Phase 9: All polish tasks in parallel

```text
T041 contract tests
T042 E2E README
T043 APISIX route manifest
T044 Helm values
T045 AGENTS.md update
```

---

## Implementation Strategy

### MVP Scope (P1 Stories Only — Phases 1–5)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (**CRITICAL — blocks everything**)
3. Complete Phase 3: US1 — subscription registration ← first deployable increment
4. Complete Phase 4: US2 — event delivery ← core value proposition
5. Complete Phase 5: US3 — retry logic ← production reliability
6. **VALIDATE**: Full E2E — subscribe, trigger event, verify delivery + retry behaviour

### Incremental Delivery

1. **Phases 1–3**: Subscription CRUD API live; developers can register webhooks
2. **+ Phase 4**: Delivery pipeline live; webhooks start firing
3. **+ Phase 5**: Retry + auto-disable live; production reliability unlocked
4. **+ Phase 6**: Full subscription management (pause/resume/rotate)
5. **+ Phase 7**: Delivery history visible in developer tools
6. **+ Phase 8**: Signature verification documented and helper available
7. **+ Phase 9**: Contract tests, E2E docs, deployment manifests complete

### Parallel Team Strategy (3 developers post-Phase 2)

- **Dev A**: Phase 3 (US1 management) → Phase 6 (US4 management extensions)
- **Dev B**: Phase 4 (US2 dispatcher + delivery) → Phase 5 (US3 retry)
- **Dev C**: Phase 7 (US5 history) + Phase 8 (US6 signatures) → Phase 9 (polish)

---

## Security Invariants (Verify at Each Phase)

- `signingSecret` plaintext returned **only** in 201 response (create) and rotate-secret response — never in GET/list/detail/audit
- `tenantId` and `workspaceId` always sourced from verified JWT claims — never from request body
- Target URL validated for HTTPS + SSRF (private IP rejection) at creation and update time
- 3xx responses from target always treated as delivery failure — never followed
- AES-256-GCM encryption applied before any signing secret is persisted to PostgreSQL
- No raw event payload or signing secret appears in any Kafka audit topic payload

---

## Done Criteria Cross-Reference

| plan.md §12 criterion | Tasks |
|---|---|
| All four PostgreSQL tables exist; migration applies cleanly | T004 |
| All pure-functional modules pass unit tests ≥90% coverage | T005–T017 |
| Management action: full subscription lifecycle | T018–T022, T030–T035, T036–T038 |
| Dispatcher: correct fan-out with tenant/workspace isolation | T023, T025 |
| Delivery worker: 2xx→succeeded, 5xx/timeout→retry, max→permanently_failed, 3xx→failure | T024, T026, T028, T029 |
| Contract tests pass for all shapes and delivery headers | T041 |
| E2E scenario README documents all 10 scenarios | T042 |
| APISIX route validated or documented as ready-to-apply manifest | T043 |
| Signing secret never in list/detail/history/audit | T006, T011, T018–T021, T034–T037 (enforced throughout) |
| Zero cross-tenant/cross-workspace data in any test | T022, T025, T026, T035, T038 |
| All management operations produce Kafka audit events | T011, T018, T030–T034 |
| Branch passes CI lint and test suite | T003, all test tasks |
