# Tasks: Realtime E2E Test Suite — Subscription, Reconnection & Tenant/Workspace Isolation

**Branch**: `084-realtime-e2e-test-suite`  
**Date**: 2026-03-30  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T06

---

## Implementation-Ready File Path Map

All files to be created or modified in this task, grouped by concern. The implement step MUST use these paths exclusively (no full-OpenAPI reads, no directory scans).

### New Files — Test Helpers

| # | Path | Description |
|---|------|-------------|
| H1 | `tests/e2e/realtime/helpers/client.mjs` | WebSocket/SSE test client with connect/disconnect/receive/reconnect APIs |
| H2 | `tests/e2e/realtime/helpers/provisioner.mjs` | Tenant, workspace, channel provisioning via platform REST API |
| H3 | `tests/e2e/realtime/helpers/iam.mjs` | Keycloak Admin REST API: users, scopes, tokens |
| H4 | `tests/e2e/realtime/helpers/data-injector.mjs` | pg + mongodb change injection helpers |
| H5 | `tests/e2e/realtime/helpers/poller.mjs` | Bounded polling with exponential backoff |
| H6 | `tests/e2e/realtime/helpers/teardown.mjs` | Best-effort cleanup utilities |

### New Files — Unit Tests for Helpers

| # | Path | Description |
|---|------|-------------|
| U1 | `tests/unit/realtime/helpers/poller.test.mjs` | Unit tests for poller.mjs logic |
| U2 | `tests/unit/realtime/helpers/client-buffer.test.mjs` | Unit tests for client.mjs event buffer logic |

### New Files — E2E Test Suites

| # | Path | Description |
|---|------|-------------|
| E1 | `tests/e2e/realtime/subscription-lifecycle.test.mjs` | FR-001, FR-002, FR-003, FR-014 |
| E2 | `tests/e2e/realtime/reconnection.test.mjs` | FR-004, FR-005, FR-006, FR-007, FR-014 |
| E3 | `tests/e2e/realtime/tenant-isolation.test.mjs` | FR-008, FR-009, FR-018, FR-014 |
| E4 | `tests/e2e/realtime/workspace-isolation.test.mjs` | FR-010, FR-011, FR-014 |
| E5 | `tests/e2e/realtime/scope-revocation.test.mjs` | FR-012, FR-017, FR-014 |
| E6 | `tests/e2e/realtime/edge-cases.test.mjs` | Edge cases from spec |
| E7 | `tests/e2e/realtime/README.md` | Prerequisites, env vars, local run guide, CI integration |

### New Files — Documentation

| # | Path | Description |
|---|------|-------------|
| D1 | `docs/testing/realtime-e2e.md` | Full prerequisite reference, env var docs, timing params, CI guide |

### Modified Files

| # | Path | Change |
|---|------|--------|
| M1 | `package.json` | Add `test:e2e:realtime` and `test:unit:realtime` scripts |

---

## Tasks

### STEP 1 — Helpers scaffold

#### TASK-01 · Create `tests/e2e/realtime/helpers/poller.mjs`

**File**: `tests/e2e/realtime/helpers/poller.mjs`  
**FR coverage**: Underpins FR-014 (bounded assertion windows)  
**Description**: Bounded polling utility. Calls `assertFn()` repeatedly until it resolves, with exponential backoff between calls. Rejects with a timeout error if `maxWaitMs` is exceeded.

**Contract**:

```js
// poll(assertFn, opts) → Promise<void>
// opts: { maxWaitMs: number, intervalMs: number, backoffFactor: number }
// assertFn: async () => void — throws if assertion not yet satisfied
// On timeout: throws Error with message including elapsed time and last assertion error
```

**Implementation notes**:
- Pure logic, no external dependencies.
- Use `Date.now()` for elapsed tracking (not `performance.now()` for simplicity).
- Cap interval growth at `maxWaitMs / 2` to prevent a single interval exceeding the budget.
- Export as default named export: `export async function poll(assertFn, opts = {}) { … }`.

---

#### TASK-02 · Create `tests/e2e/realtime/helpers/teardown.mjs`

**File**: `tests/e2e/realtime/helpers/teardown.mjs`  
**Description**: Wraps an array of cleanup async functions; executes all sequentially; logs but does not throw on individual failures. Intended for use in `finally` blocks.

**Contract**:

```js
// teardown(fns: Array<() => Promise<void>>, logger?: Console) → Promise<void>
// Errors from individual fns are caught and logged; teardown completes all fns regardless.
```

**Implementation notes**:
- Export as default named export: `export async function teardown(fns, logger = console) { … }`.
- No external dependencies.

---

#### TASK-03 · Create `tests/e2e/realtime/helpers/client.mjs`

**File**: `tests/e2e/realtime/helpers/client.mjs`  
**Description**: WebSocket/SSE test client. Wraps the `ws` package (WebSocket). Maintains an internal received-event buffer. Provides an async iterator interface for draining events. Supports connect, disconnect, reconnect, and subscribe operations.

**Contract**:

```js
// createRealtimeClient({ endpoint, token }) → RealtimeSession
// session.subscribe({ workspaceId, channelId, filter }) → Promise<{ subscriptionId }>
// session.waitForEvent(matchFn, opts) → Promise<event>  — uses poller internally
// session.drainEvents(n, opts) → Promise<event[]>       — collects n events within opts.maxWaitMs
// session.disconnect() → void
// session.reconnect({ token }) → Promise<void>
// session.events                                         — raw buffer Array (read-only view)
```

**Internal architecture**:
- On `connect`, open a WebSocket to `${endpoint}?token=${token}`.
- All incoming messages are parsed as JSON and pushed to `this._buffer`.
- `waitForEvent(matchFn, opts)` uses `poll()` from `poller.mjs` to repeatedly check `this._buffer`.
- `subscribe()` sends a JSON subscription request message and waits for a confirmation message.
- Buffer is never cleared automatically; tests are responsible for consuming events they care about.

**Implementation notes**:
- Import `ws` with: `import { WebSocket } from 'ws';`
- Export `createRealtimeClient` as a named export.
- Reconnect must clear buffer before re-establishing connection (reconnect scenarios start fresh assertion).
- `disconnect()` must call `ws.close()` and set an internal `_disconnected` flag.

---

#### TASK-04 · Create `tests/e2e/realtime/helpers/iam.mjs`

**File**: `tests/e2e/realtime/helpers/iam.mjs`  
**Description**: Keycloak Admin REST API wrapper for test fixtures. Creates test users, assigns/revokes scopes, obtains and refreshes tokens, cleans up users.

**Contract**:

```js
// createTestUser({ tenantId, scopes: string[] }) → Promise<{ userId, username, password }>
// getToken({ username, password }) → Promise<{ accessToken, refreshToken, expiresIn }>
// refreshToken({ refreshToken }) → Promise<{ accessToken, refreshToken }>
// revokeScope({ userId, scope }) → Promise<void>
// assignScope({ userId, scope }) → Promise<void>
// deleteTestUser(userId) → Promise<void>
```

**Env vars consumed** (all required, no defaults):
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_ADMIN_CLIENT_ID`
- `KEYCLOAK_ADMIN_SECRET`

**Implementation notes**:
- Obtain admin access token lazily (cache with TTL of `expiresIn - 10s`).
- Token endpoint: `POST ${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`
- User creation endpoint: `POST ${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users`
- Scope assignment: use Keycloak client-level role mapper or `clientScopeMappings` endpoint as appropriate.
- Use `fetch` (Node 20+ built-in); no `axios` or `node-fetch`.
- Export all functions as named exports.

---

#### TASK-05 · Create `tests/e2e/realtime/helpers/provisioner.mjs`

**File**: `tests/e2e/realtime/helpers/provisioner.mjs`  
**Description**: Provisions test tenants, workspaces, and data source channels via the platform provisioning REST API. Also handles deprovisioning.

**Contract**:

```js
// createTestTenant(label) → Promise<{ tenantId, adminToken }>
// createTestWorkspace(tenantId) → Promise<{ workspaceId }>
// registerPgDataSource({ workspaceId, tables: string[] }) → Promise<{ channelId }>
// registerMongoDataSource({ workspaceId, collections: string[] }) → Promise<{ channelId }>
// deprovisionTenant(tenantId) → Promise<void>  — best-effort, logs on error
// deprovisionWorkspace(workspaceId) → Promise<void>
```

**Env vars consumed**:
- `PROVISIONING_API_BASE_URL`
- `PROVISIONING_ADMIN_TOKEN`

**Implementation notes**:
- Use `fetch` (Node 20+ built-in).
- Each provisioned resource is registered in an internal log for teardown tracking.
- Export `createProvisioner()` factory (returns object with all methods) to allow independent instances per test.
- `deprovisionTenant` must emit a console.warn on failure but must NOT throw (teardown safety).

---

#### TASK-06 · Create `tests/e2e/realtime/helpers/data-injector.mjs`

**File**: `tests/e2e/realtime/helpers/data-injector.mjs`  
**Description**: Triggers CDC-producing data changes directly in PostgreSQL and MongoDB test data sources.

**Contract**:

```js
// pgInsert({ schema, table, row }) → Promise<{ rowId }>
// pgUpdate({ schema, table, where, set }) → Promise<void>
// pgDelete({ schema, table, where }) → Promise<void>
// mongoInsert({ db, collection, doc }) → Promise<{ docId }>
// mongoUpdate({ db, collection, filter, update }) → Promise<void>
// mongoDelete({ db, collection, filter }) → Promise<void>
// close() → Promise<void>  — closes pg pool and mongo client
```

**Env vars consumed**:
- `WS_PG_CONN_STR` — PostgreSQL DSN for test workspace
- `WS_MONGO_CONN_STR` — MongoDB URI for test workspace

**Implementation notes**:
- Import `pg` and `mongodb` packages.
- Use a single shared `Pool` (pg) and `MongoClient` (mongodb) per injector instance, initialized lazily.
- Export `createDataInjector()` factory for per-test instances.
- `close()` must drain pg pool and close mongo client; errors are swallowed (teardown safety).

---

### STEP 2 — Unit Tests for Helpers

#### TASK-07 · Create `tests/unit/realtime/helpers/poller.test.mjs`

**File**: `tests/unit/realtime/helpers/poller.test.mjs`  
**Description**: Unit tests for `poller.mjs`. No external dependencies required.

**Test cases**:
1. `poll` resolves immediately when `assertFn` succeeds on first call.
2. `poll` retries and resolves after `assertFn` fails N times then succeeds.
3. `poll` rejects with timeout error when `assertFn` never succeeds within `maxWaitMs`.
4. Interval is capped at `maxWaitMs / 2` (prevents single oversized sleep).
5. Elapsed time reported in timeout error message.

---

#### TASK-08 · Create `tests/unit/realtime/helpers/client-buffer.test.mjs`

**File**: `tests/unit/realtime/helpers/client-buffer.test.mjs`  
**Description**: Unit tests for the event buffer and `waitForEvent` logic of `client.mjs`. Uses a mocked WebSocket to avoid needing a live server.

**Test cases**:
1. Buffer accumulates messages in order.
2. `waitForEvent(matchFn)` resolves when a matching event is pushed to buffer.
3. `waitForEvent(matchFn)` rejects on timeout if no matching event arrives.
4. `drainEvents(n)` collects exactly `n` events within the timeout window.
5. Reconnect clears the buffer.

---

### STEP 3 — Subscription Lifecycle Tests

#### TASK-09 · Create `tests/e2e/realtime/subscription-lifecycle.test.mjs`

**File**: `tests/e2e/realtime/subscription-lifecycle.test.mjs`  
**FR coverage**: FR-001, FR-002, FR-003, FR-014

**Setup pattern** (shared across all tests in this file):

```js
// 1. createProvisioner() → provision tenant → provision workspace
// 2. registerPgDataSource(workspaceId, ['e2e_events'])
// 3. createTestUser({ tenantId, scopes: ['realtime:read'] }) → { username, password }
// 4. getToken({ username, password }) → { accessToken }
// 5. createRealtimeClient({ endpoint: REALTIME_ENDPOINT, token: accessToken })
// 6. [finally] teardown([closeSession, deprovisionWorkspace, deprovisionTenant, deleteTestUser])
```

**Test cases**:

**TC-SL-01** `PG INSERT event delivered` (FR-001, FR-002, FR-014)
- Subscribe to channel for table `e2e_events`, filter `{ operations: ['INSERT'] }`
- `pgInsert({ table: 'e2e_events', row: { id: uuid(), label: 'tc-sl-01' } })`
- `poll()` asserts: `session.events` contains exactly 1 event with `op === 'INSERT'`, `table === 'e2e_events'`, `tenantId` matches, `workspaceId` matches
- Timeout: `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS` (default 10 000 ms)

**TC-SL-02** `MongoDB INSERT event delivered` (FR-001, FR-002, FR-014)
- Register MongoDB data source for collection `e2e_docs`
- Subscribe; insert document; assert event with `op === 'INSERT'`, `collection === 'e2e_docs'`
- Timeout: 10 000 ms

**TC-SL-03** `Subscription delete silences events` (FR-002, FR-014)
- Subscribe; insert row; assert event received (confirms active)
- Delete subscription via REST API (`DELETE /subscriptions/{subscriptionId}`)
- Insert another row
- `poll()` asserts: no new events arrive after deletion within 5 000 ms
- Implementation: check `session.events.length` stays constant after deletion marker

**TC-SL-04** `Filter UPDATE-only: no INSERT delivered, UPDATE delivered` (FR-003, FR-014)
- Subscribe with filter `{ operations: ['UPDATE'] }`
- `pgInsert()` a row (should not deliver event)
- `pgUpdate()` the inserted row
- `poll()` asserts: exactly 1 event with `op === 'UPDATE'`; no event with `op === 'INSERT'` in buffer
- Timeout: 10 000 ms

---

### STEP 4 — Isolation Tests

#### TASK-10 · Create `tests/e2e/realtime/tenant-isolation.test.mjs`

**File**: `tests/e2e/realtime/tenant-isolation.test.mjs`  
**FR coverage**: FR-008, FR-009, FR-018, FR-014  
**SC coverage**: SC-004

**Setup pattern**:

```js
// Provision tenantA + workspaceA + pgSourceA + userA + sessionA
// Provision tenantB + workspaceB + pgSourceB + userB + sessionB
// Both use table name 'e2e_iso' (identical names, per FR-018)
```

**Test cases**:

**TC-TI-01** `Cross-tenant event isolation: 100 events in tenant A, zero reach tenant B` (FR-008, SC-004)
- Subscribe both sessionA and sessionB
- Emit 100 `pgInsert()` events in tenantA's `e2e_iso` table
- `poll()` asserts: `sessionA.events.length >= 100` within 20 000 ms
- Assert: `sessionB.events.length === 0`

**TC-TI-02** `Adversarial cross-tenant subscription attempt rejected` (FR-009)
- Obtain `channelId` belonging to tenantA's workspace
- Using sessionB's token, attempt `POST /subscriptions` with tenantA's channelId
- Assert HTTP response status is `403` or `404`; no subscription entry created in tenantA

**TC-TI-03** `Identical source names: each tenant receives only their own events` (FR-018)
- Both sources use table name `e2e_iso`
- Emit 20 events in tenantA and 20 events in tenantB simultaneously
- After delivery window (15 000 ms): assert each session has ~20 events; assert all events in sessionA have `tenantId === tenantA.tenantId`; assert all events in sessionB have `tenantId === tenantB.tenantId`

---

#### TASK-11 · Create `tests/e2e/realtime/workspace-isolation.test.mjs`

**File**: `tests/e2e/realtime/workspace-isolation.test.mjs`  
**FR coverage**: FR-010, FR-011, FR-014  
**SC coverage**: SC-005

**Setup pattern**:

```js
// Provision one tenant with two workspaces (W1, W2)
// Register pg data source in each workspace (same table name: 'e2e_ws_iso')
// Create user W1 with workspace-scoped token for W1; create user W2 with workspace-scoped token for W2
// Open sessionW1 and sessionW2
```

**Test cases**:

**TC-WI-01** `Cross-workspace event isolation: 50 events in W1, zero reach W2` (FR-010, SC-005)
- Emit 50 `pgInsert()` events in W1's `e2e_ws_iso` table
- `poll()` asserts: `sessionW1.events.length >= 50` within 15 000 ms
- Assert: `sessionW2.events.length === 0`

**TC-WI-02** `Adversarial cross-workspace subscription attempt rejected` (FR-011)
- Using W1-scoped token, attempt to subscribe to W2's channelId
- Assert HTTP response status is `403`; no subscription created in W2

---

### STEP 5 — Reconnection Tests

#### TASK-12 · Create `tests/e2e/realtime/reconnection.test.mjs`

**File**: `tests/e2e/realtime/reconnection.test.mjs`  
**FR coverage**: FR-004, FR-005, FR-006, FR-007, FR-014  
**SC coverage**: SC-006

**Setup pattern** (per test): provision tenant + workspace + PG source + user; obtain token; open session; create subscription.

**Test cases**:

**TC-RC-01** `Drop + reconnect within window: at-least-once delivery` (FR-004, SC-006)
- Emit event A; assert received
- `session.disconnect()` (simulate drop)
- Emit event B (during disconnection)
- Wait 500 ms
- `session.reconnect({ token: freshToken })` — must complete within 5 000 ms (`reconnectStartMs` recorded)
- `poll()` asserts: event B is present in buffer after reconnect, within 5 000 ms of reconnection
- Assert: `Date.now() - reconnectStartMs < 5000`

**TC-RC-02** `Token refresh mid-session: no delivery gap` (FR-005)
- Emit 5 events; assert all received
- `iam.refreshToken({ refreshToken })` → obtain new `accessToken`
- Call session token-refresh API (per T04 protocol: send refresh message on existing connection)
- Emit 5 more events
- Assert: all 10 events eventually in buffer; no gap > 500 ms between events (checked via event timestamps)

**TC-RC-03** `Reconnect with expired token: rejected` (FR-006)
- Obtain short-lived token (`TOKEN_SHORT_TTL_SECONDS` env var, default 5)
- Wait for token expiry: `await sleep(TOKEN_SHORT_TTL_SECONDS * 1000 + 500)`
- Attempt `session.reconnect({ token: expiredToken })`
- Assert: reconnect rejects or WebSocket closes with code `4001` (auth error) or HTTP 401

**TC-RC-04** `Reconnect with revoked token: rejected` (FR-006)
- Revoke token via Keycloak session invalidation
- Attempt `session.reconnect({ token: revokedToken })`
- Assert: reconnect rejected with auth error code

**TC-RC-05** `Reconnection-window exceeded: subscription suspended` (FR-007)
- `session.disconnect()`
- Wait `(RECONNECTION_WINDOW_SECONDS + 5) * 1000` ms
- Attempt reconnect with valid token
- Query subscription status via REST: `GET /subscriptions/{subscriptionId}`
- Assert: `status === 'suspended'` or reconnect yields explicit `SUBSCRIPTION_SUSPENDED` error

**Env vars**: `RECONNECTION_WINDOW_SECONDS` (default 60), `TOKEN_SHORT_TTL_SECONDS` (default 5).

---

### STEP 6 — Scope Revocation Tests

#### TASK-13 · Create `tests/e2e/realtime/scope-revocation.test.mjs`

**File**: `tests/e2e/realtime/scope-revocation.test.mjs`  
**FR coverage**: FR-012, FR-017, FR-014  
**SC coverage**: SC-007

**Setup pattern**: provision tenant + workspace + PG source + user with `realtime:read`; open session; create subscription; confirm events flowing (emit 1 event, assert received).

**Test cases**:

**TC-SR-01** `Scope revocation stops delivery within 30 seconds` (FR-012, SC-007)
- Record `revokeTimestamp = Date.now()`
- `iam.revokeScope({ userId, scope: 'realtime:read' })`
- Emit PG INSERT events every 2 seconds for 35 seconds
- `poll({ maxWaitMs: 35_000, intervalMs: 1000 })` asserts: no events received with `receivedAt > revokeTimestamp + 30_000`
- Assert: last event `receivedAt` is within 30 000 ms of `revokeTimestamp`

**TC-SR-02** `Revoked subscriber cannot create new subscription` (FR-012)
- Revoke `realtime:read` scope
- Wait 2 000 ms (propagation)
- Attempt `POST /subscriptions` with same token
- Assert: HTTP response status is `403`

**TC-SR-03** `Audit event recorded for scope-revoked suspension` (FR-017)
- Revoke `realtime:read` scope
- `poll({ maxWaitMs: 35_000, intervalMs: 2000 })` asserts Kafka topic `console.realtime.auth-decisions` contains a message with:
  - `event_type === 'SUBSCRIPTION_SUSPENDED'`
  - `reason === 'scope_revoked'`
  - `tenantId === testTenant.tenantId`
  - `subscriptionId === testSubscription.subscriptionId`
- Note: Kafka consumer in test is read-only; import a minimal `KafkaConsumer` helper from `tests/e2e/realtime/helpers/kafka-consumer.mjs` (see TASK-14)

---

#### TASK-14 · Create `tests/e2e/realtime/helpers/kafka-consumer.mjs`

**File**: `tests/e2e/realtime/helpers/kafka-consumer.mjs`  
**Description**: Minimal read-only Kafka consumer helper for audit assertion in scope-revocation tests.

**Contract**:

```js
// createKafkaConsumer({ topic, fromBeginning?: boolean }) → KafkaConsumerHandle
// handle.waitForMessage(matchFn, opts) → Promise<message>  — uses poller internally
// handle.close() → Promise<void>
```

**Env vars consumed**:
- `KAFKA_BROKERS` (comma-separated list)
- `KAFKA_CLIENT_ID` (default: `realtime-e2e-test`)

**Implementation notes**:
- Use `kafkajs` package.
- Consumer group ID: `realtime-e2e-${Date.now()}` (unique per test run, no committed offsets)
- `fromBeginning: false` by default (only new messages during test)
- Export `createKafkaConsumer` as named export.

---

### STEP 7 — Edge Cases Tests

#### TASK-15 · Create `tests/e2e/realtime/edge-cases.test.mjs`

**File**: `tests/e2e/realtime/edge-cases.test.mjs`  
**Description**: Covers the edge cases enumerated in the spec.

**Test cases**:

**TC-EC-01** `Subscription on non-CDC-covered source is rejected`
- Register a PG data source but mark table as outside CDC coverage (use a table name not in the capture set)
- Attempt to create subscription
- Assert: API returns `400` or subscription status is `no_cdc_coverage`

**TC-EC-02** `Burst during disconnect signals buffer overflow`
- Disconnect session; emit `N > REPLAY_BUFFER_LIMIT` events (env var `REPLAY_BUFFER_LIMIT`, default 500)
- Reconnect with valid token
- Assert: either `truncated: true` in received events or a `BUFFER_OVERFLOW` control message is received
- Assert: session does not buffer unboundedly (total received events ≤ `REPLAY_BUFFER_LIMIT + 10`)

**TC-EC-03** `Overlapping filters, two subscribers: no cross-contamination`
- Two subscribers on same channel: sub1 filter `{ operations: ['INSERT'] }`, sub2 filter `{ operations: ['INSERT', 'UPDATE'] }`
- Emit 10 INSERTs and 10 UPDATEs
- Assert sub1: events with `op === 'UPDATE'` absent
- Assert sub2: both INSERT and UPDATE events present (20 total)

**TC-EC-04** `Pipeline degradation (Kafka mock unavailable) — conditional`
- Only runs if `SIMULATE_KAFKA_UNAVAILABLE=true` env var is set
- Otherwise: `test.skip('set SIMULATE_KAFKA_UNAVAILABLE=true to run pipeline-degradation test')`
- When enabled: simulate unavailability per environment-specific mechanism
- Assert: subscriber's connection remains open; subscriber receives structured error or degradation status within 10 000 ms

**TC-EC-05** `Tenant deprovisioned mid-session`
- Open active subscription receiving events
- Call `provisioner.deprovisionTenant(tenantId)` while session is active
- Assert: WebSocket connection closes with structured error code or `session.events` contains a `TENANT_DEPROVISIONED` control message within 15 000 ms

---

### STEP 8 — Documentation

#### TASK-16 · Create `tests/e2e/realtime/README.md`

**File**: `tests/e2e/realtime/README.md`  
**Content outline**:
- Overview and traceability (EP-17 / US-DX-01 / US-DX-01-T06)
- Prerequisites (running platform, Keycloak realm, CDC bridges active)
- All environment variables with descriptions and examples (mirror table from plan §6.1 plus `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `REPLAY_BUFFER_LIMIT`, `SIMULATE_KAFKA_UNAVAILABLE`)
- How to run locally: `pnpm test:e2e:realtime`
- How to run unit tests for helpers: `pnpm test:unit:realtime`
- How to generate JUnit XML for CI: `node --test --test-reporter=junit --test-reporter-destination=realtime-e2e-results.xml tests/e2e/realtime/**/*.test.mjs`
- Expected total runtime (≤ 10 min, SC-002)
- Timing parameters and how to tune them
- Teardown guarantees and what to check if resources are leaked

---

#### TASK-17 · Create `docs/testing/realtime-e2e.md`

**File**: `docs/testing/realtime-e2e.md`  
**Content outline**:
- Title, date, traceability
- Pipeline under test (from plan §2.1 — reference only, do not embed diagram)
- Prerequisites for running in CI/CD (network access, service accounts, Keycloak admin API)
- Full environment variable reference table
- Timing parameters reference: `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS`, `SCOPE_REVOCATION_TIMEOUT_MS`, `RECONNECTION_WINDOW_SECONDS`, `TOKEN_SHORT_TTL_SECONDS`, `REPLAY_BUFFER_LIMIT`
- CI/CD integration guide: GitHub Actions example, GitLab CI example
- Success criteria mapping (SC-001 through SC-008)
- Known limitations (CDC propagation delay, `SIMULATE_KAFKA_UNAVAILABLE` gate)

---

#### TASK-18 · Modify `package.json` — add test scripts

**File**: `package.json`  
**Change**: Add the following entries to the `"scripts"` object:

```json
"test:e2e:realtime": "node --test --test-reporter=tap tests/e2e/realtime/**/*.test.mjs",
"test:unit:realtime": "node --test tests/unit/realtime/**/*.test.mjs"
```

**Note**: Do NOT remove or modify any existing scripts. Add only these two new entries.

---

## Dependency Order

```text
TASK-01 (poller)
TASK-02 (teardown)
   ↓
TASK-03 (client)         depends on TASK-01 (uses poll)
TASK-04 (iam)
TASK-05 (provisioner)    depends on TASK-02 (uses teardown)
TASK-06 (data-injector)
TASK-14 (kafka-consumer) depends on TASK-01 (uses poll)
   ↓
TASK-07 (poller unit tests)     depends on TASK-01
TASK-08 (client unit tests)     depends on TASK-03
   ↓
TASK-09 (subscription-lifecycle) depends on H1..H6
TASK-10 (tenant-isolation)       depends on H1..H6
TASK-11 (workspace-isolation)    depends on H1..H6
TASK-12 (reconnection)           depends on H1..H6
TASK-13 (scope-revocation)       depends on H1..H6, TASK-14
TASK-15 (edge-cases)             depends on H1..H6
   ↓
TASK-16 (README.md)
TASK-17 (docs/testing/realtime-e2e.md)
TASK-18 (package.json scripts)
```

Steps 1 (Tasks 01–06 + 14) must complete before Steps 2–6.  
Steps 2–6 (Tasks 07–15) can proceed concurrently once helpers are written.  
Steps 7–8 (Tasks 16–18) can proceed in parallel with Steps 2–6.

---

## Constraints for Implement Step

- **No full OpenAPI reads**: reference specific field names from plan.md §4 (helper contracts) and spec.md §Requirements only. Do not open `openapi/` directory files.
- **No full directory scans**: use only the file paths listed in the File Path Map above.
- **Targeted reads only**: if implementation needs to verify an existing pattern, read the specific referenced file from `tests/e2e/workflows/helpers/` (e.g., `tests/e2e/workflows/helpers/workflow-runner.mjs`) to understand project conventions, then close.
- **Do not modify services/**: all new files are under `tests/` and `docs/`.
- **Preserve unrelated untracked artifacts**: `specs/070-saga-compensation-workflows/plan.md`, `specs/070-saga-compensation-workflows/tasks.md`, `specs/072-workflow-e2e-compensation/tasks.md` — do not read, modify, or stage these files.
- **Node 20+ ESM**: all `.mjs` files, `import`/`export` syntax, no CommonJS.
- **No hardcoded credentials or defaults for secrets**: env vars for all credentials, explicitly fail if not set.
- **`fetch` for HTTP**: built-in Node 20 `fetch`; no `axios` or `node-fetch`.
- **`ws` for WebSocket**: `ws` npm package (already in project).
- **`kafkajs` for Kafka**: existing package in project.
- **`pg` and `mongodb` for data injection**: existing packages in project.
