# Implementation Plan: Realtime Subscription Authentication, Scopes & Event Filters

**Branch**: `082-realtime-auth-scope-filters` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/082-realtime-auth-scope-filters/spec.md`  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T04

---

## Summary

This plan introduces the **authorization, scope enforcement, and event-filter layer** in the realtime delivery pipeline. It sits between the Kafka-based change-event bus (T02/T03) and client subscriptions (T01) and ensures:

1. Every realtime connection is authenticated via Keycloak-issued JWTs before any event is delivered.
2. Subscription creation is gated on possession of the required IAM scopes (`realtime:read`) for the target workspace and channel type.
3. Event filters (operation type, entity name) are validated at creation time and enforced at delivery time.
4. Tenant and workspace isolation is enforced in the event delivery path — cross-tenant and cross-workspace leakage is impossible.
5. Token expiry and scope-revocation events suspend delivery within the configured window (≤30 s for token expiry, ≤60 s for scope revocation).
6. Every authorization decision is recorded as an immutable audit event on the Kafka audit backbone.

Technical approach: a `services/realtime-gateway` module (Node.js 20+ ESM) adds an **auth/scope/filter middleware layer** composed of three collaborating components: `TokenValidator`, `ScopeChecker`, and `FilterEvaluator`. An OpenWhisk action handles the subscription-creation gate. Scope revocations are consumed from a Keycloak-emitted Kafka topic. PostgreSQL persists scope-to-channel mappings and authorization audit records. Kafka audit topics capture every decision event.

---

## Technical Context

**Language/Version**: Node.js 20+ (ESM, `"type": "module"`), pnpm workspaces  
**Primary Dependencies**: `kafkajs` (Kafka consumer/producer), `pg` (PostgreSQL), `jwks-rsa` + `jose` (Keycloak JWT validation), Apache APISIX (gateway-layer JWT plugin), Apache OpenWhisk (serverless action host)  
**Storage**: PostgreSQL (scope-to-channel mappings, subscription authorization records, active session metadata); Kafka (authorization audit events, scope-revocation events)  
**Testing**: `node:test` (built-in, Node 20+) for unit/integration; contract validation via JSON Schema  
**Target Platform**: Kubernetes / OpenShift, deployed via Helm; pnpm monorepo  
**Project Type**: Backend service + serverless action layer within monorepo  
**Performance Goals**: Subscription auth validation ≤200 ms p95; filter evaluation per event ≤5 ms; token validation per new connection ≤100 ms  
**Constraints**: Tenant isolation MUST be enforced before any event enters the subscriber pipeline; filter complexity limit enforced at creation time; no plaintext secrets in repo  
**Scale/Scope**: Multi-tenant; supports N workspaces per tenant; up to `MAX_SUBSCRIPTIONS_PER_WORKSPACE` active subscriptions per developer (configurable); filter max predicates = configurable (default 10)

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I — Monorepo Separation | ✅ PASS | New code lands under `services/realtime-gateway/`; reusable auth utilities within that package only |
| II — Incremental Delivery | ✅ PASS | Middleware layer added incrementally; subscription model from T01 not modified |
| III — K8s/OpenShift Compatibility | ✅ PASS | APISIX plugin config via ConfigMap; Helm-packaged; no hardcoded ports or root assumptions |
| IV — Quality Gates at Root | ✅ PASS | Unit and integration tests runnable from `pnpm test` at root; contract schemas validated in CI |
| V — Docs as Part of Change | ✅ PASS | `docs/adr/` entry required for choice of scope-revocation polling vs. push; this plan lives in `specs/` |
| Secrets not committed | ✅ PASS | Keycloak JWKS URL and DB credentials via K8s Secrets / Helm values with no defaults committed |
| pnpm workspaces | ✅ PASS | New package added to `pnpm-workspace.yaml` |

**No violations — proceed.**

---

## Project Structure

### Documentation (this feature)

```text
specs/082-realtime-auth-scope-filters/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── openapi/
│   │   └── realtime-auth-v1.yaml
│   └── kafka/
│       ├── realtime-auth-granted.schema.json
│       ├── realtime-auth-denied.schema.json
│       ├── realtime-session-suspended.schema.json
│       └── realtime-session-resumed.schema.json
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
services/realtime-gateway/
├── package.json                    # ESM, "type": "module", node:test
├── src/
│   ├── auth/
│   │   ├── token-validator.mjs     # Keycloak JWKS JWT validation + introspection cache
│   │   ├── scope-checker.mjs       # Scope evaluation against scope-channel mapping
│   │   └── session-manager.mjs     # Active session lifecycle; token-expiry watcher
│   ├── filters/
│   │   ├── filter-parser.mjs       # Parse & validate filter expression objects
│   │   ├── filter-evaluator.mjs    # Evaluate filter against event payload at delivery
│   │   └── complexity-checker.mjs  # Enforce max predicate count per subscription
│   ├── isolation/
│   │   └── tenant-workspace-guard.mjs  # Enforce tenant+workspace isolation on events
│   ├── audit/
│   │   └── audit-publisher.mjs     # Publish auth decisions to Kafka audit topics
│   ├── repositories/
│   │   ├── scope-mapping-repository.mjs     # CRUD: realtime_scope_channel_mappings
│   │   └── auth-record-repository.mjs       # Insert: realtime_subscription_auth_records
│   ├── migrations/
│   │   ├── 001-create-realtime-scope-channel-mappings.sql
│   │   ├── 002-create-realtime-subscription-auth-records.sql
│   │   └── 003-create-realtime-sessions.sql
│   └── actions/
│       ├── validate-subscription-auth.mjs   # OpenWhisk action: subscription creation gate
│       └── handle-scope-revocation.mjs      # OpenWhisk action: consume revocation event
└── src/config/
    └── env.mjs                     # Typed env-var loader (no secrets committed)

tests/
├── unit/realtime-gateway/
│   ├── token-validator.test.mjs
│   ├── scope-checker.test.mjs
│   ├── filter-parser.test.mjs
│   ├── filter-evaluator.test.mjs
│   └── tenant-workspace-guard.test.mjs
└── integration/realtime-gateway/
    ├── subscription-auth-flow.test.mjs      # Full grant/deny/revoke cycle
    └── event-filter-enforcement.test.mjs    # Filter delivery verification

charts/realtime-gateway/
├── Chart.yaml
├── values.yaml                     # No secret defaults; refs to K8s Secret names
└── templates/
    ├── configmap-apisix-plugin.yaml     # APISIX JWT plugin config
    ├── deployment.yaml
    └── secret-ref.yaml                  # SecretRef template (no plaintext)

docs/adr/
└── adr-082-scope-revocation-strategy.md  # Decision: polling vs. push revocation
```

**Structure Decision**: Single-service model under `services/realtime-gateway/`. All new logic is self-contained within this package; the existing channel/subscription model from T01 is consumed as a dependency, not modified.

---

## Phase 0: Research

### Decision 1 — Token Validation Strategy

**Decision**: Use offline JWT validation via Keycloak JWKS endpoint (`/auth/realms/{realm}/protocol/openid-connect/certs`). Cache JWKS keys with a configurable TTL (default 5 minutes). Fall back to Keycloak token introspection endpoint only when local validation fails (e.g., unknown `kid`).

**Rationale**: Offline validation is low-latency (<5 ms for cached keys) and does not add a synchronous network call on every event delivery tick. Introspection as fallback handles key rotation.

**Alternatives considered**: Full introspection on every new connection — rejected (latency + Keycloak load); no caching — rejected (SLA breach under burst connections).

**Implementation**: `jose` library for ECDSA/RSA JWT verification; `jwks-rsa` for JWKS retrieval and caching.

---

### Decision 2 — Scope Revocation Detection (Polling vs. Push)

**Decision**: Implement a **polling-based scope re-validation** loop (per active session, configurable interval, default 30 s) as the primary mechanism. The session manager re-validates the token's scopes against the current Keycloak grant via introspection at each interval. If scope narrowing is detected, the session is suspended and an audit event is published.

**Rationale**: Keycloak does not emit push-based revocation events to arbitrary consumers in the standard setup. Polling is predictable and implementable without custom Keycloak extensions. The 30-second interval satisfies SC-007 (≤60 s enforcement).

**Alternatives considered**: Keycloak event listener SPI emitting Kafka events — desirable long-term but requires a custom Keycloak extension not yet in scope; APISIX `jwt-auth` plugin revocation list — only covers full token revocation, not scope narrowing.

**ADR**: `docs/adr/adr-082-scope-revocation-strategy.md`.

---

### Decision 3 — Filter Expression Format

**Decision**: Filters are represented as a **JSON object** with optional fields: `operation` (string enum: `INSERT|UPDATE|DELETE`), `entity` (string: table/collection name), and `predicates` (array of `{field, op, value}` objects, max 10). Evaluated sequentially with AND semantics between fields; `OR` within `predicates` array items is not supported in v1.

**Rationale**: Simple JSON filters are easy to validate at API time (JSON Schema), unambiguous to evaluate per event, and extensible. Field-level predicates (`predicates`) are included per spec FR-007 but capped at 10 to satisfy FR-015. Full expression languages (JSONPath, JMESPath) are out of scope per spec OQ1 decision.

**Alternatives considered**: JSONPath filter expressions — rejected (complex sandboxing, attack surface); no field-level predicates in v1 — kept as optional extension point (predicates array may be empty).

---

### Decision 4 — Audit Event Transport

**Decision**: Publish authorization audit events directly to Kafka (using `kafkajs`) from the `audit-publisher.mjs` module, on the following topics:

| Topic | Retention |
|-------|-----------|
| `console.realtime.auth-granted` | 30 days |
| `console.realtime.auth-denied` | 30 days |
| `console.realtime.session-suspended` | 30 days |
| `console.realtime.session-resumed` | 30 days |

**Rationale**: Consistent with existing audit topology (async-operations). Kafka topics are durable, auditable, and retention-configurable per tenant policy.

**Alternatives considered**: Write directly to PostgreSQL audit table — rejected (synchronous write in hot path; Kafka decouples delivery). Write to both — overkill for v1; PostgreSQL `realtime_subscription_auth_records` table satisfies synchronous queryability.

---

## Phase 1: Design & Contracts

### Data Model

*(Full detail in `data-model.md`; summary below.)*

#### PostgreSQL: `realtime_scope_channel_mappings`

```sql
CREATE TABLE realtime_scope_channel_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  scope_name      TEXT NOT NULL,           -- e.g. 'realtime:read', 'realtime:read:postgresql-changes'
  channel_type    TEXT NOT NULL,           -- e.g. 'postgresql-changes', 'mongodb-changes', '*'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_id, scope_name, channel_type)
);
CREATE INDEX idx_rscm_tenant_workspace ON realtime_scope_channel_mappings (tenant_id, workspace_id);
```

**Default behavior**: When no row exists for a `(tenant_id, workspace_id)` pair, the system applies the platform default: `realtime:read` grants access to all channel types.

#### PostgreSQL: `realtime_subscription_auth_records`

```sql
CREATE TABLE realtime_subscription_auth_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  actor_identity    TEXT NOT NULL,         -- Keycloak subject (sub claim)
  subscription_id   TEXT,                  -- Null on denial (no subscription created)
  channel_type      TEXT NOT NULL,
  action            TEXT NOT NULL,         -- 'GRANTED' | 'DENIED' | 'SUSPENDED' | 'RESUMED'
  denial_reason     TEXT,                  -- Null unless DENIED or SUSPENDED
  scopes_evaluated  JSONB NOT NULL,
  filter_snapshot   JSONB,                 -- Filter spec at decision time
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rsar_tenant_workspace ON realtime_subscription_auth_records (tenant_id, workspace_id);
CREATE INDEX idx_rsar_actor ON realtime_subscription_auth_records (actor_identity);
CREATE INDEX idx_rsar_created_at ON realtime_subscription_auth_records (created_at DESC);
```

#### PostgreSQL: `realtime_sessions`

```sql
CREATE TABLE realtime_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  actor_identity   TEXT NOT NULL,
  token_jti        TEXT NOT NULL,          -- JWT ID for revocation correlation
  token_expires_at TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rs_token_jti ON realtime_sessions (token_jti);
CREATE INDEX idx_rs_status ON realtime_sessions (status, last_validated_at);
```

---

### API Contracts

*(Full OpenAPI spec in `contracts/openapi/realtime-auth-v1.yaml`; summary below.)*

#### `POST /workspaces/{workspaceId}/realtime/subscriptions` (existing endpoint from T01, extended)

**Extension**: Request body gains an optional `filter` field:

```json
{
  "channelType": "postgresql-changes",
  "filter": {
    "operation": "INSERT",
    "entity": "orders",
    "predicates": []
  }
}
```

**Authorization**: Bearer token required. Validated by APISIX `jwt-auth` plugin. OpenWhisk action `validate-subscription-auth` is invoked synchronously as an APISIX plugin hook before the subscription is created.

**Responses**:
- `201 Created` — subscription created; response includes `subscriptionId`, `channelType`, `filterApplied`.
- `401 Unauthorized` — invalid/expired token.
- `403 Forbidden` — insufficient scopes; body includes `missingScope` and `requiredScope`.
- `400 Bad Request` — invalid/overly complex filter; body includes `validationErrors`.
- `409 Conflict` — subscription quota exceeded.

#### `DELETE /workspaces/{workspaceId}/realtime/subscriptions/{subscriptionId}`

**Authorization**: Bearer token required; actor must be subscription owner or workspace admin.

**Responses**: `204 No Content` | `403 Forbidden` | `404 Not Found`.

#### `GET /workspaces/{workspaceId}/realtime/scope-mappings` (workspace admin)

Returns active scope-to-channel mappings for the workspace.

#### `PUT /workspaces/{workspaceId}/realtime/scope-mappings` (workspace admin)

Upserts scope-to-channel mapping rows for the workspace.

---

### Kafka Event Schemas

*(Full JSON Schemas in `contracts/kafka/`.)*

**`console.realtime.auth-granted`** payload:
```json
{
  "eventType": "realtime.auth-granted",
  "tenantId": "...",
  "workspaceId": "...",
  "actorIdentity": "...",
  "subscriptionId": "...",
  "channelType": "...",
  "scopesEvaluated": ["realtime:read"],
  "filterSnapshot": { "operation": "INSERT", "entity": "orders", "predicates": [] },
  "timestamp": "2026-03-30T12:00:00Z"
}
```

**`console.realtime.auth-denied`** payload (adds `denialReason`, `missingScope`).  
**`console.realtime.session-suspended`** payload (adds `suspensionReason`: `TOKEN_EXPIRED | SCOPE_REVOKED`).  
**`console.realtime.session-resumed`** payload (adds `resumedAt`).

---

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYCLOAK_JWKS_URL` | — | Keycloak JWKS endpoint URL |
| `KEYCLOAK_INTROSPECTION_URL` | — | Keycloak token introspection endpoint |
| `KEYCLOAK_INTROSPECTION_CLIENT_ID` | — | Client ID for introspection |
| `KEYCLOAK_INTROSPECTION_CLIENT_SECRET` | — | Client secret (K8s Secret ref) |
| `JWKS_CACHE_TTL_SECONDS` | `300` | JWKS key cache TTL |
| `SCOPE_REVALIDATION_INTERVAL_SECONDS` | `30` | Polling interval for scope re-validation |
| `TOKEN_EXPIRY_GRACE_SECONDS` | `30` | Max delivery after token expiry before suspend |
| `MAX_FILTER_PREDICATES` | `10` | Max predicates per subscription filter |
| `MAX_SUBSCRIPTIONS_PER_WORKSPACE` | `50` | Quota: subscriptions per developer per workspace |
| `AUDIT_KAFKA_TOPIC_AUTH_GRANTED` | `console.realtime.auth-granted` | Kafka topic name |
| `AUDIT_KAFKA_TOPIC_AUTH_DENIED` | `console.realtime.auth-denied` | Kafka topic name |
| `AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED` | `console.realtime.session-suspended` | Kafka topic name |
| `AUDIT_KAFKA_TOPIC_SESSION_RESUMED` | `console.realtime.session-resumed` | Kafka topic name |
| `DATABASE_URL` | — | PostgreSQL connection string (K8s Secret ref) |
| `KAFKA_BROKERS` | — | Comma-separated Kafka broker addresses |

---

## Implementation Sequence

### Step 1 — Migrations & Repository Layer (no runtime deps)

1. Write and apply the three DDL migrations (`001`, `002`, `003`) under `services/realtime-gateway/src/migrations/`.
2. Implement `scope-mapping-repository.mjs` (read/upsert scope mappings with tenant+workspace scope) and `auth-record-repository.mjs` (insert-only audit records).
3. Unit tests: mock `pg` Pool; verify SQL parameterization and tenant isolation.

### Step 2 — Token Validation (`token-validator.mjs`)

1. Implement JWT validation using `jose` (`jwtVerify`) with JWKS key retrieval via `jwks-rsa`.
2. Cache JWKS keys in memory with TTL from `JWKS_CACHE_TTL_SECONDS`.
3. Expose `validateToken(bearerToken): Promise<DecodedClaims>` — throws `AuthError` with code `TOKEN_INVALID | TOKEN_EXPIRED | TOKEN_REVOKED`.
4. Unit tests: valid token → claims returned; expired token → `TOKEN_EXPIRED`; tampered token → `TOKEN_INVALID`; unknown `kid` → falls back to introspection.

### Step 3 — Scope Checker (`scope-checker.mjs`)

1. Implement `checkScopes(claims, workspaceId, channelType, db): Promise<ScopeCheckResult>`.
2. Logic: (a) extract `tenant_id` from claims; (b) load scope-channel mappings for `(tenant_id, workspace_id)` from DB (with in-process cache, TTL = `SCOPE_REVALIDATION_INTERVAL_SECONDS`); (c) if no mappings → default: `realtime:read` grants all; (d) check claims' scopes against required mapping entry.
3. Unit tests: default behavior; custom mapping allows; custom mapping denies; cross-workspace attempt denied.

### Step 4 — Filter Parser & Evaluator (`filter-parser.mjs`, `filter-evaluator.mjs`, `complexity-checker.mjs`)

1. `filter-parser.mjs`: accepts raw filter JSON, validates against JSON Schema (operation enum, entity string, predicates array). Returns normalized `FilterSpec` or throws `FilterValidationError` with `validationErrors` array.
2. `complexity-checker.mjs`: counts predicates; throws if > `MAX_FILTER_PREDICATES`.
3. `filter-evaluator.mjs`: accepts `FilterSpec` + event payload; returns `boolean`. Evaluation: operation match (if specified) AND entity match (if specified) AND all predicates match (AND semantics).
4. Unit tests: full coverage of filter parsing edge cases (missing fields, invalid enum values, max predicates exceeded, empty filter → pass-all).

### Step 5 — Tenant/Workspace Guard (`tenant-workspace-guard.mjs`)

1. Implement `guardEvent(event, sessionContext): boolean` — returns `true` only if `event.tenantId === session.tenantId && event.workspaceId === session.workspaceId`.
2. Called for every event before delivery, at earliest stage of the delivery pipeline.
3. Unit tests: matching tenant+workspace → pass; mismatched tenant → reject; mismatched workspace → reject.

### Step 6 — Audit Publisher (`audit-publisher.mjs`)

1. Implement `publishAuthDecision(decision: AuthDecision): Promise<void>` using `kafkajs` producer.
2. `AuthDecision` maps to one of the four Kafka topics based on `decision.action`.
3. Write also to `realtime_subscription_auth_records` via `auth-record-repository.mjs` (dual-write: Kafka for streaming audit consumers, PostgreSQL for synchronous queryability).
4. Unit tests: verify correct topic routing; verify message schema; verify PostgreSQL write called.

### Step 7 — Session Manager (`session-manager.mjs`)

1. Maintains an in-memory map of active sessions keyed by `sessionId`.
2. On session creation: validates token (Step 2), creates `realtime_sessions` DB row, starts polling timer.
3. Polling timer (every `SCOPE_REVALIDATION_INTERVAL_SECONDS`): calls Keycloak introspection; if token inactive or scopes narrowed → update session status to `SUSPENDED`, publish `session-suspended` audit event, signal delivery layer to pause.
4. On token refresh: validates new token, updates `realtime_sessions` row, resets timer, publishes `session-resumed` if previously suspended.
5. On token expiry (detected via `token_expires_at` in session row or introspection): suspend within `TOKEN_EXPIRY_GRACE_SECONDS`.
6. Integration tests: full lifecycle (create → deliver → expire → suspend → refresh → resume).

### Step 8 — OpenWhisk Action: `validate-subscription-auth.mjs`

1. Input: `{ token, workspaceId, channelType, filter }`.
2. Steps: (a) `validateToken`; (b) extract tenant from claims; (c) `checkScopes`; (d) `parseFilter` + `checkComplexity`; (e) check scope does not reference entities outside permitted scope; (f) check quota (`MAX_SUBSCRIPTIONS_PER_WORKSPACE`); (g) `publishAuthDecision(GRANTED | DENIED)`.
3. Returns: `{ allowed: boolean, subscriptionContext: {...} | null, error: {...} | null }`.
4. APISIX calls this action synchronously as a request hook on `POST /workspaces/:wid/realtime/subscriptions`.

### Step 9 — OpenWhisk Action: `handle-scope-revocation.mjs`

1. Consumes Keycloak scope-revocation events from Kafka (or triggered by session manager polling).
2. Identifies affected active sessions by `actor_identity`.
3. Marks sessions `SUSPENDED` in DB; publishes `session-suspended` audit events.
4. Integration test: verify sessions suspended within 60 seconds of scope revocation.

### Step 10 — APISIX Plugin Configuration (Helm)

1. Add `jwt-auth` plugin config to APISIX route for realtime subscription endpoints.
2. JWKS endpoint configured via `configmap-apisix-plugin.yaml`.
3. Helm values: `apisix.jwtAuth.jwksUrl`, `apisix.jwtAuth.realm`.

### Step 11 — Helm Chart (`charts/realtime-gateway/`)

1. `values.yaml` with all configurable env vars (no secret values committed; SecretRef pattern).
2. `deployment.yaml` for the service; `configmap-apisix-plugin.yaml` for APISIX config.
3. `secret-ref.yaml` template for `DATABASE_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`, `KAFKA_BROKERS`.

---

## Testing Strategy

### Unit Tests (`tests/unit/realtime-gateway/`)

| Test File | Coverage |
|-----------|---------|
| `token-validator.test.mjs` | Valid/invalid/expired/tampered JWT; JWKS cache hit/miss; introspection fallback |
| `scope-checker.test.mjs` | Default behavior; custom mappings; cross-workspace; cross-tenant |
| `filter-parser.test.mjs` | Valid filter; invalid operation enum; missing entity; max predicates exceeded; empty filter |
| `filter-evaluator.test.mjs` | All combinations of operation/entity/predicate matches and mismatches |
| `tenant-workspace-guard.test.mjs` | Matching, mismatched tenant, mismatched workspace |
| `audit-publisher.test.mjs` | Correct topic routing; message schema; DB write invocation |

### Integration Tests (`tests/integration/realtime-gateway/`)

| Test File | Coverage |
|-----------|---------|
| `subscription-auth-flow.test.mjs` | Full grant cycle; full denial cycle; scope-revocation suspension; token refresh resumption |
| `event-filter-enforcement.test.mjs` | Filtered subscription receives only matching events; unfiltered receives all permitted events |

### Contract Tests

- OpenAPI spec in `contracts/openapi/realtime-auth-v1.yaml` validated against actual HTTP responses using `@apidevtools/swagger-parser` or equivalent.
- Kafka event schemas in `contracts/kafka/*.schema.json` validated against published messages using `ajv`.

### Security Validations

- Inject an event with mismatched `tenantId` into a live subscription pipeline and assert it is never delivered (SC-003).
- Inject an event with mismatched `workspaceId` under the same tenant and assert it is never delivered (SC-004).
- Open a connection with an expired token and assert connection is rejected (SC-001).
- Let a token expire mid-session; assert delivery stops within `TOKEN_EXPIRY_GRACE_SECONDS + 5` seconds (SC-006).
- Revoke a scope; assert affected subscription is suspended within 60 seconds (SC-007).

---

## Risks, Observability & Rollback

### Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Scope revocation propagation > 60 s if Keycloak introspection is slow | Configure polling interval aggressively (≤30 s); add alerting on introspection latency; audit all events during window |
| R2 | Filter evaluation latency spike under high event volume | Enforce `MAX_FILTER_PREDICATES`; pre-compile filter specs at subscription creation; benchmark with `node:bench` |
| R3 | JWKS cache serving stale keys after rotation | Set `JWKS_CACHE_TTL_SECONDS` ≤ Keycloak key rotation interval; introspection fallback handles unknown `kid` |
| R4 | PostgreSQL connection exhaustion under high subscription concurrency | Use `pg` connection pooling (max 20 per instance); monitor pool saturation |

### Observability

- Log every auth decision at `INFO` level with `tenantId`, `workspaceId`, `actorIdentity`, `channelType`, `action`, `durationMs`.
- Log every filter evaluation failure at `DEBUG` level.
- Emit Prometheus counter `realtime_auth_decisions_total{action,channel_type}`.
- Emit Prometheus histogram `realtime_token_validation_duration_seconds`.
- Emit Prometheus gauge `realtime_active_sessions_total{tenant_id}`.
- Kafka consumer lag on `console.realtime.*` topics monitored via existing platform tooling.

### Rollback

- Migrations are additive (new tables only); rollback: drop the three new tables (no existing table modified).
- APISIX plugin config is Helm-managed; rollback: `helm rollback` removes the configmap and plugin activation.
- OpenWhisk actions are versioned; rollback: re-activate previous action version.
- Feature flag `REALTIME_AUTH_ENABLED` (env var): if `false`, the APISIX hook is bypassed and the validate action returns `allowed: true` unconditionally (break-glass for incident recovery only; audited).

---

## Parallelization

| Parallel Track A | Parallel Track B |
|-----------------|-----------------|
| Steps 1–4: Migrations + repositories + token validator + scope checker + filter layer (pure logic, no runtime deps) | Steps 10–11: APISIX plugin config + Helm chart (infra-only, no business logic) |
| Step 5: Tenant/workspace guard | Step 6: Audit publisher (depends only on Kafka + PG, not on auth logic) |
| Steps 7–9 (Session manager + actions) require tracks A + B complete | — |

---

## Criteria of Done

| # | Criterion | Evidence |
|---|-----------|---------|
| CD-01 | `validateToken` rejects invalid/expired tokens | Unit tests passing; test output shows `TOKEN_INVALID` / `TOKEN_EXPIRED` |
| CD-02 | Subscription creation denied for missing scope | Integration test + audit record in PostgreSQL with `action='DENIED'` and `missingScope` field |
| CD-03 | Zero cross-tenant event delivery in test scenario | Security validation test passes; guard logs show rejection |
| CD-04 | Zero cross-workspace event delivery in test scenario | Security validation test passes |
| CD-05 | Filtered subscription receives only matching events | Integration test: `>= 50%` reduction in delivered events vs. unfiltered baseline |
| CD-06 | Token expiry suspends delivery within 30 s | Integration test with controlled token TTL; session marked SUSPENDED within window |
| CD-07 | Scope revocation suspends affected sessions within 60 s | Integration test with introspection mock returning narrowed scopes |
| CD-08 | Every auth decision queryable in audit log within 5 s | Kafka consumer + PostgreSQL query in integration test |
| CD-09 | All unit + integration tests pass at root | `pnpm test` exits 0 |
| CD-10 | OpenAPI spec validates against implementation | Contract test in CI pipeline exits 0 |
| CD-11 | Kafka audit event schemas valid | JSON Schema contract test exits 0 |
| CD-12 | Helm chart renders without error on K8s dry-run | `helm template | kubectl apply --dry-run=client` exits 0 |
| CD-13 | `docs/adr/adr-082-scope-revocation-strategy.md` committed | File present in branch |
| CD-14 | No plaintext secrets in repo | `git grep -r 'client_secret\|DATABASE_URL' -- '*.yaml' '*.json'` returns only template placeholders |
