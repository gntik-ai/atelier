# Implementation Plan: Realtime E2E Test Suite — Subscription, Reconnection & Tenant/Workspace Isolation

**Branch**: `084-realtime-e2e-test-suite` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T06  
**Depends on**: T01 (079), T02 (080), T03 (081), T04 (082), T05 (083) — all merged

---

## Summary

Tasks T01–T05 have built a complete realtime pipeline: channel/subscription model (PostgreSQL), CDC bridges from PostgreSQL and MongoDB to Kafka, an authorization/scope/filter middleware layer, and SDK snippets. **This task introduces the end-to-end test suite** that exercises the full pipeline from an external consumer's perspective.

The test suite targets three orthogonal concerns:

1. **Subscription lifecycle** — create, receive, filter, delete; verify post-deletion silence.
2. **Reconnection resilience** — simulated drops, token refresh, expired/revoked token rejection, reconnection-window suspension.
3. **Tenant and workspace isolation** — zero cross-tenant and cross-workspace event leakage; adversarial subscription attempts rejected.

Tests are implemented in Node.js 20+ ESM using the built-in `node:test` runner (consistent with the rest of the project) and live under `tests/e2e/realtime/`. They interact with the platform exclusively through published HTTP/WebSocket/SSE interfaces (APISIX gateway) and Keycloak APIs — no internal service bypasses.

---

## 1. Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I — Monorepo Separation | ✅ PASS | All test code under `tests/e2e/realtime/`; helpers under `tests/e2e/realtime/helpers/`; no changes to `services/` or `apps/` |
| II — Incremental Delivery | ✅ PASS | Pure additive: new test files only; no existing test or service modified |
| III — K8s/OpenShift Compatibility | ✅ PASS | Tests run against externally reachable endpoints configured via env vars; no K8s API calls from tests |
| IV — Quality Gates at Root | ✅ PASS | Registered under `pnpm test:e2e:realtime` script; invokable from repo root; outputs TAP / JUnit XML |
| V — Docs as Part of Change | ✅ PASS | `docs/testing/realtime-e2e.md` documents prerequisites, env vars, timing parameters, and CI integration |
| Secrets not committed | ✅ PASS | All credentials consumed from environment variables; no defaults committed |
| pnpm workspaces | ✅ PASS | No new package added; test files are part of the root `tests/` tree |

**No violations — proceed.**

---

## 2. Architecture & Flow

### 2.1 Pipeline Under Test

```text
[Test Client (E2E)]
        │  HTTP (REST)          WebSocket / SSE
        ▼                              ▲
[APISIX API Gateway] ─────────────────┘
        │
        ├──► [OpenWhisk: realtime-subscription-crud]  (T01)
        │         └──► [PostgreSQL: realtime_channels, realtime_subscriptions]
        │
        ├──► [OpenWhisk: realtime-auth-gate]           (T04)
        │         └──► [Keycloak: token validation, scope check]
        │
        └──► [realtime-gateway (Node.js service)]      (T01+T04)
                  ├──► [Kafka consumer: workspace CDC topics]  (T02/T03)
                  └──► Delivers events → subscriber WS/SSE connection

[Test Data Injector]
        ├──► PostgreSQL (direct SQL INSERT/UPDATE/DELETE via pg client)
        └──► MongoDB (direct document insert/update via mongodb driver)
                  ↓
        [pg-cdc-bridge / mongo-cdc-bridge]  (T02/T03)
                  ↓
        [Kafka: {tenant}.{workspace}.pg-changes / .mongo-changes]
                  ↓
        [realtime-gateway subscription resolver]
                  ↓
        [Test Client receives event]
```

### 2.2 Test Client Architecture

Each test scenario:
1. Provisions a **dedicated tenant + workspace** via the provisioning REST API (or a test-fixture helper).
2. Creates one or more **Keycloak test users** with configured scopes via the Keycloak Admin REST API.
3. Obtains a **JWT** for the test user via Keycloak token endpoint.
4. Opens a **WebSocket/SSE connection** to the realtime gateway endpoint through APISIX.
5. Creates a **subscription** via the REST subscription API.
6. Triggers **data changes** (INSERT/UPDATE/DELETE) directly in the workspace's PostgreSQL or MongoDB instance.
7. Asserts **event delivery** within a bounded polling window.
8. Executes **adversarial or negative steps** specific to the scenario (drop, re-auth, revoke scopes, etc.).
9. **Tears down** all provisioned resources (subscription, workspace, tenant, Keycloak users).

### 2.3 Event Assertion Strategy

All assertions use **bounded polling with exponential backoff** rather than fixed sleeps:

```text
poll(assertFn, { maxWaitMs: 10_000, intervalMs: 200, backoffFactor: 1.5 })
```

This eliminates false failures from variable CDC propagation delays while still failing deterministically within the documented window.

---

## 3. Project Structure

### 3.1 New files under `tests/e2e/realtime/`

```text
tests/e2e/realtime/
├── helpers/
│   ├── client.mjs                  # WebSocket/SSE test client with connect/disconnect/receive APIs
│   ├── provisioner.mjs             # Tenant, workspace, and channel provisioning helpers
│   ├── iam.mjs                     # Keycloak admin API: create users, assign scopes, revoke scopes, get token, refresh token
│   ├── data-injector.mjs           # pg + mongodb change injection (INSERT/UPDATE/DELETE)
│   ├── poller.mjs                  # Bounded polling utility with backoff
│   └── teardown.mjs                # Best-effort cleanup (runs in test finally blocks)
│
├── subscription-lifecycle.test.mjs
│   # FR-001, FR-002, FR-003, FR-014
│   # Scenarios: PG create→receive→delete; Mongo create→receive→delete; filter enforcement; post-delete silence
│
├── reconnection.test.mjs
│   # FR-004, FR-005, FR-006, FR-007, FR-014
│   # Scenarios: drop+reconnect within window (at-least-once); token refresh mid-session; expired/revoked token rejection; reconnection-window exceeded → suspension
│
├── tenant-isolation.test.mjs
│   # FR-008, FR-009, FR-018, FR-014
│   # Scenarios: dual-tenant event isolation; adversarial cross-tenant subscription; identical source names across tenants
│
├── workspace-isolation.test.mjs
│   # FR-010, FR-011, FR-014
│   # Scenarios: dual-workspace event isolation within tenant; adversarial cross-workspace subscription
│
├── scope-revocation.test.mjs
│   # FR-012, FR-017, FR-014
│   # Scenarios: mid-session scope revocation stops delivery ≤30s; revoked subscriber cannot create new subscription; audit event recorded
│
├── edge-cases.test.mjs
│   # Non-CDC source subscription attempt; burst-during-disconnect buffer overflow; overlapping filters; pipeline degradation; tenant deprovisioned mid-session
│
└── README.md                       # Prerequisites, env vars reference, running locally, CI integration
```

### 3.2 Documentation

```text
docs/testing/
└── realtime-e2e.md                 # Prerequisites, env var reference, timing parameters, CI integration guide
```

### 3.3 Root script (package.json addition)

```json
"test:e2e:realtime": "node --test --test-reporter=tap tests/e2e/realtime/**/*.test.mjs"
```

---

## 4. Helpers Design

### 4.1 `helpers/client.mjs`

```javascript
// WebSocket client wrapping the native 'ws' package (or SSE using 'eventsource')
// Exposes:
//   connect({ endpoint, token })  → RealtimeSession
//   session.subscribe({ workspaceId, channelId, filter }) → subscriptionId
//   session.events()              → async iterator yielding received events
//   session.disconnect()
//   session.reconnect({ token })
```

Internally maintains a received-event buffer so `poller.mjs` can drain it without tight coupling to the raw socket.

### 4.2 `helpers/provisioner.mjs`

```javascript
// Provisions test fixtures via platform REST APIs
// Exposes:
//   createTestTenant(label)        → { tenantId, adminToken }
//   createTestWorkspace(tenantId)  → { workspaceId }
//   registerPgDataSource(workspaceId, connStr, tables)  → { channelId }
//   registerMongoDataSource(workspaceId, connStr, collections) → { channelId }
//   deprovisionTenant(tenantId)    → void (best-effort)
//
// Uses PROVISIONING_API_BASE_URL + PROVISIONING_ADMIN_TOKEN env vars
```

### 4.3 `helpers/iam.mjs`

```javascript
// Wraps Keycloak Admin REST API
// Exposes:
//   createTestUser({ tenantId, scopes })   → { userId, username, password }
//   getToken({ username, password })       → { accessToken, refreshToken, expiresIn }
//   refreshToken({ refreshToken })         → { accessToken, refreshToken }
//   revokeScope({ userId, scope })         → void
//   deleteTestUser(userId)                 → void
//
// Uses KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_SECRET env vars
```

### 4.4 `helpers/data-injector.mjs`

```javascript
// Triggers CDC-producing data changes in workspace data sources
// Exposes (PostgreSQL):
//   pgInsert({ connStr, schema, table, row }) → { rowId }
//   pgUpdate({ connStr, schema, table, where, set }) → void
//   pgDelete({ connStr, schema, table, where }) → void
//
// Exposes (MongoDB):
//   mongoInsert({ connStr, db, collection, doc }) → { docId }
//   mongoUpdate({ connStr, db, collection, filter, update }) → void
//   mongoDelete({ connStr, db, collection, filter }) → void
//
// Uses WS_PG_CONN_STR and WS_MONGO_CONN_STR env vars (workspace-specific, test-only)
```

### 4.5 `helpers/poller.mjs`

```javascript
// Bounded polling with exponential backoff
// poll(assertFn, { maxWaitMs, intervalMs, backoffFactor }) → resolves when assertFn passes, rejects on timeout
// assertFn: async () => void — throws if assertion not yet satisfied
```

### 4.6 `helpers/teardown.mjs`

```javascript
// Best-effort cleanup utilities; errors are logged but do not fail the test runner
// teardown(fns: Array<() => Promise<void>>) → Promise<void>
```

---

## 5. Test Scenario Specifications

### 5.1 `subscription-lifecycle.test.mjs`

**Setup (per test)**: provision tenant + workspace, register data source, create Keycloak user with `realtime:read` scope, obtain token, open realtime connection.

| Test | Operation | Assertion | Timeout |
|------|-----------|-----------|---------|
| PG INSERT event delivered | INSERT row in PG table | Exactly 1 event with `op: "INSERT"`, correct table, correct payload summary | 10 s |
| Mongo INSERT event delivered | Insert doc in Mongo collection | Exactly 1 event with `op: "INSERT"`, correct collection, correct payload summary | 10 s |
| Subscription delete silences events | Delete subscription, then INSERT | Zero events received after deletion | 5 s wait |
| Filter: UPDATE-only | Set filter `{ operations: ["UPDATE"] }`, then INSERT + UPDATE | Exactly 1 event with `op: "UPDATE"`; INSERT event absent | 10 s |

**Teardown**: delete subscription (if not already), deprovision workspace + tenant, delete Keycloak user.

---

### 5.2 `reconnection.test.mjs`

**Setup (per test)**: provision tenant + workspace, register PG data source, create user with `realtime:read`, obtain token, open connection, create subscription.

| Test | Steps | Assertion | Timeout |
|------|-------|-----------|---------|
| Drop + reconnect (within window) | Emit event A, disconnect, emit event B, reconnect (fresh token), poll | Events A and B both delivered (at-least-once) OR event B delivered with last-offset resume | 15 s total |
| Token refresh mid-session | Emit events, refresh token on active connection, emit more events | Continuous delivery; no gap | 10 s |
| Reconnect with expired token | Expire token (short-lived token, wait for expiry), attempt reconnect | Connection rejected with auth error (401/4001 WS close code) | 5 s |
| Reconnect with revoked token | Revoke token via Keycloak, attempt reconnect | Connection rejected with auth error | 5 s |
| Reconnection-window exceeded | Disconnect, wait `> RECONNECTION_WINDOW_SECONDS`, reconnect | Subscription status = `suspended`; no events buffered indefinitely (platform returns explicit status) | RECONNECTION_WINDOW_SECONDS + 5 s |

**Env vars used**: `RECONNECTION_WINDOW_SECONDS` (default 60, matches platform config); `TOKEN_SHORT_TTL_SECONDS` (test-only short-lived token config).

---

### 5.3 `tenant-isolation.test.mjs`

**Setup**: provision two independent tenants (A, B), each with a workspace + PG data source registered with identical table names, each with a subscriber.

| Test | Steps | Assertion | Timeout |
|------|-------|-----------|---------|
| Cross-tenant event isolation | Emit 100 INSERT events in tenant A's table | Tenant B subscriber receives zero events from tenant A | 20 s |
| Adversarial cross-tenant subscription | Tenant B subscriber attempts to subscribe to tenant A's channelId | API returns 403 (or 404); no subscription created in tenant A | 5 s |
| Identical source names, both tenants active | Emit simultaneous events in A and B (same table name) | Each subscriber receives only their own events; event metadata contains correct `tenantId` and `workspaceId` | 15 s |

**SC-004 coverage**: 100+ events per tenant in isolation run.

---

### 5.4 `workspace-isolation.test.mjs`

**Setup**: provision one tenant with two workspaces (W1, W2), each with a PG data source, each subscriber authenticated under the same tenant but different workspace scopes.

| Test | Steps | Assertion | Timeout |
|------|-------|-----------|---------|
| Cross-workspace event isolation | Emit 50 INSERT events in W1's table | W2 subscriber receives zero events from W1 | 15 s |
| Adversarial cross-workspace subscription | W1-scoped subscriber attempts to subscribe to W2 channelId | API returns 403; no subscription created | 5 s |

**SC-005 coverage**: 50+ events per workspace in isolation run.

---

### 5.5 `scope-revocation.test.mjs`

**Setup**: provision tenant + workspace + PG source, create subscriber with `realtime:read` scope, open connection, create subscription, verify events flowing.

| Test | Steps | Assertion | Timeout |
|------|-------|-----------|---------|
| Scope revocation stops delivery | Revoke `realtime:read` scope via Keycloak Admin API | Event delivery stops within 30 s of revocation | 35 s |
| Revoked subscriber cannot create subscription | Revoke scope, attempt new subscription creation | API returns 403; no subscription created | 5 s |
| Audit event recorded on revocation | Revoke scope | Kafka audit topic `console.realtime.auth-decisions` contains `SUBSCRIPTION_SUSPENDED` event with correct `tenantId`, `subscriptionId`, `reason: scope_revoked` | 35 s |

---

### 5.6 `edge-cases.test.mjs`

| Test | Steps | Expected Behavior |
|------|-------|-------------------|
| Non-CDC source subscription | Subscribe to a channel for a PG table not in the captured set | API returns 400 or explicit `status: no_cdc_coverage` |
| Burst during disconnect (buffer overflow) | Disconnect, emit N events > replay buffer limit, reconnect | Platform delivers replay buffer events and signals overflow (specific error or `truncated: true` flag) |
| Overlapping filters, two subscribers | Same channel, subscriber 1 filter `INSERT`, subscriber 2 filter `UPDATE+INSERT` | Each subscriber receives only events matching their own filter; no cross-contamination |
| Pipeline degradation (Kafka unavailable) | Simulate Kafka unavailability (or use mock env) | Subscriber receives structured error or connection degradation status; connection remains open if possible |
| Tenant deprovisioned mid-session | Deprovision tenant while subscriber has active connection | Connection closed gracefully with structured error; no further events |

---

## 6. Data Model & Infrastructure

### 6.1 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `REALTIME_ENDPOINT` | WebSocket/SSE endpoint through APISIX | `wss://api.atelier.local/realtime` |
| `API_BASE_URL` | REST API base URL through APISIX | `https://api.atelier.local` |
| `PROVISIONING_API_BASE_URL` | Provisioning orchestrator base URL | `https://api.atelier.local/provisioning` |
| `PROVISIONING_ADMIN_TOKEN` | Admin token for test provisioning | — |
| `KEYCLOAK_BASE_URL` | Keycloak base URL | `https://iam.atelier.local` |
| `KEYCLOAK_REALM` | Realm for test tenants | `atelier` |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Admin client ID | `admin-cli` |
| `KEYCLOAK_ADMIN_SECRET` | Admin client secret | — |
| `WS_PG_CONN_STR` | PostgreSQL connection string for test data injection | `postgresql://...` |
| `WS_MONGO_CONN_STR` | MongoDB connection string for test data injection | `mongodb://...` |
| `RECONNECTION_WINDOW_SECONDS` | Platform reconnection window (must match deployment config) | `60` |
| `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS` | Assertion window for event delivery (default 10000) | `10000` |
| `SCOPE_REVOCATION_TIMEOUT_MS` | Assertion window for scope revocation (default 30000) | `30000` |
| `TEST_CONCURRENCY` | Number of parallel test files (default 1 for determinism) | `1` |

All variables are consumed by helper modules via `process.env`; no defaults are hardcoded.

### 6.2 No Migrations / Schema Changes

This task introduces **zero changes to PostgreSQL or MongoDB schemas**. The test suite consumes existing realtime_channels and realtime_subscriptions tables (created by T01) through the published REST API only.

### 6.3 Kafka Topics Observed

The test suite reads from (assertion only, no production):

| Topic | Used in |
|-------|---------|
| `console.realtime.auth-decisions` | `scope-revocation.test.mjs` (verify audit event) |

The test suite does **not** produce to Kafka directly; it relies on CDC bridges (T02/T03) to propagate data changes.

---

## 7. Test Report Format

The suite runs under `node --test --test-reporter=tap` by default, producing TAP output parseable by standard CI/CD tooling. For JUnit XML output (GitHub Actions, GitLab CI):

```bash
node --test --test-reporter=junit --test-reporter-destination=realtime-e2e-results.xml tests/e2e/realtime/**/*.test.mjs
```

**SC-008 compliance**: TAP and JUnit XML are supported natively by `node:test` ≥ 20.12.

Each test case reports:
- Test name (scenario identifier from spec)
- Pass / Fail
- Wall-clock duration
- On failure: assertion message, received vs. expected event payloads, timeout context

---

## 8. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Flaky tests from CDC propagation delay | High | Bounded polling with exponential backoff; generous but explicit timeouts; no fixed `sleep()` calls |
| Test environment resource cost | Medium | Each test provisions and tears down in the same `test()` block; cleanup runs in `finally`; separate quota for test tenant pool |
| Token expiry timing in reconnection tests | Medium | Use short-lived tokens via Keycloak realm-level token TTL override for test clients only; controlled by `TOKEN_SHORT_TTL_SECONDS` env var |
| WebSocket protocol version mismatches | Low | `helpers/client.mjs` targets the documented protocol from T04 contracts; tests fail early on handshake errors with clear diagnostic |
| Kafka Admin API unavailability (edge-case test) | Low | Edge-case pipeline-degradation test uses configurable mock mode (`SIMULATE_KAFKA_UNAVAILABLE=true`) rather than actual broker disruption |
| Cross-test pollution from shared data sources | Medium | Every test uses a **dedicated provisioned workspace**; `teardown.mjs` deletes all subscriptions and data sources before tenant deprovision |

---

## 9. Testing Strategy

| Layer | Scope | Tools |
|-------|-------|-------|
| **Unit** | `helpers/poller.mjs`, `helpers/client.mjs` event buffer logic | `node:test` |
| **E2E — happy path** | Subscription lifecycle, PG + Mongo event delivery, filters | `node:test` + live platform |
| **E2E — negative/adversarial** | Cross-tenant/workspace rejections, auth errors, scope revocation | `node:test` + live platform + Keycloak Admin API |
| **E2E — resilience** | Drop+reconnect, token refresh, reconnection-window suspension | `node:test` + live platform + controlled disconnection |
| **Observability validation** | Audit events on Kafka for scope revocation | `node:test` + Kafka consumer in test helper |

Unit tests for helpers run in isolation (no external services required) and are included in `pnpm test` at root.

E2E tests require a running platform environment and are gated behind `pnpm test:e2e:realtime`.

---

## 10. Sequence & Implementation Order

```text
Step 1 — Helpers scaffold
  Write all files under tests/e2e/realtime/helpers/
  Write unit tests for poller.mjs and client.mjs buffer logic
  Verify helpers build cleanly under node:test

Step 2 — Subscription lifecycle tests (subscription-lifecycle.test.mjs)
  PG INSERT test first (simplest, validates full pipeline wiring)
  Mongo INSERT test second
  Filter enforcement test
  Post-delete silence test

Step 3 — Isolation tests (tenant-isolation, workspace-isolation)
  Dual-tenant isolation (highest risk, run early)
  Adversarial cross-tenant rejection
  Identical source names
  Workspace isolation (depends on same provisioner as tenant tests)

Step 4 — Reconnection tests (reconnection.test.mjs)
  Happy-path drop+reconnect
  Token refresh mid-session
  Expired/revoked token rejection
  Reconnection-window suspension

Step 5 — Scope revocation tests (scope-revocation.test.mjs)
  Delivery stops within 30 s
  Audit event on Kafka

Step 6 — Edge cases (edge-cases.test.mjs)
  Non-CDC source, burst overflow, overlapping filters, pipeline degradation, tenant deprovision

Step 7 — Documentation
  tests/e2e/realtime/README.md
  docs/testing/realtime-e2e.md
```

Parallelization: Steps 2–6 can be authored concurrently if multiple engineers are available; each file is self-contained. Step 1 must complete first (helpers are shared).

---

## 11. Criteria of Done

| Criterion | Verification Evidence |
|-----------|-----------------------|
| All FR-001 through FR-018 covered by at least one passing test | Test report shows named scenario IDs mapped to each FR |
| Zero cross-tenant events across 100+ changes per tenant (SC-004) | `tenant-isolation.test.mjs` passes with `events leaked: 0` |
| Zero cross-workspace events across 50+ changes per workspace (SC-005) | `workspace-isolation.test.mjs` passes with `events leaked: 0` |
| Reconnection within 5 s of drop (SC-006) | `reconnection.test.mjs` timing assertions pass |
| Scope revocation stops delivery ≤ 30 s (SC-007) | `scope-revocation.test.mjs` timing assertions pass |
| Full suite completes in ≤ 10 min in CI (SC-002) | CI pipeline timing log |
| Zero false positives in 10 consecutive stable-env runs (SC-003) | CI run history |
| TAP / JUnit XML output parseable without custom post-processing (SC-008) | CI artifact parsing verified |
| All provisioned test resources cleaned up after each run | Kubernetes namespace / DB row count check post-run |
| `docs/testing/realtime-e2e.md` committed and linked from root README | Doc present in repo, README updated |
