# Implementation Plan: US-DX-02-T01 — Outbound Webhooks for Selected Events

**Feature Branch**: `085-outbound-webhooks`
**Spec**: `specs/085-outbound-webhooks/spec.md`
**Task**: US-DX-02-T01
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades
**Status**: Ready for implementation
**Created**: 2026-03-30

---

## 1. Scope Summary

This task implements the outbound webhook engine for the BaaS multi-tenant platform. It covers:

- Webhook subscription lifecycle: create, read, update, pause, resume, soft-delete.
- Signing secret generation (display-once) and rotation with configurable grace period.
- Outbound HTTP POST delivery of event payloads signed with HMAC-SHA256.
- Automatic retry with exponential back-off and jitter.
- Auto-disable after configurable consecutive failure threshold.
- Delivery history and attempt logging, queryable via paginated API.
- Per-workspace subscription quotas and delivery rate limits.
- Full tenant/workspace isolation for subscriptions and delivery history.
- Audit logging for all management operations.

Out of scope for this task: scheduling/automation triggers (T02), per-workspace documentation generation (T03), OpenAPI/SDK generation (T04), API key rotation procedures (T05), capability catalogue exposure (T06), and console UI (companion UI task).

---

## 2. Dependency Map

| Prior dependency | What this task consumes |
|---|---|
| US-GW-01 — API Gateway (APISIX) | Routes management API calls; enforces auth via Keycloak JWT validation at gateway layer |
| Kafka event bus | Sources events that trigger webhook deliveries; webhook engine subscribes to relevant topics |
| Keycloak IAM | Authenticates and authorizes management API callers; workspace/tenant claims extracted from JWT |
| PostgreSQL | Persists subscriptions, delivery records, and attempt history |
| Apache OpenWhisk | Hosts async delivery and retry OpenWhisk actions |
| Existing async operation patterns (075) | Retry/idempotency conventions reused for delivery state machine |
| Existing audit patterns (073) | Kafka-based audit event publication used for management operation audit trail |

---

## 3. Architecture and Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────┐
│  APISIX (API Gateway)                                            │
│  Route: /v1/webhooks/**  →  webhook-management OpenWhisk action  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ JWT (Keycloak) — tenant/workspace claims
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: webhook-management.mjs                        │
│  • CRUD + pause/resume/rotate on webhook_subscriptions (PG)      │
│  • Quota checks  • Audit events → Kafka                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │ writes PostgreSQL
                             ▼
              ┌──────────────────────────────┐
              │  PostgreSQL                  │
              │  webhook_subscriptions       │
              │  webhook_deliveries          │
              │  webhook_delivery_attempts   │
              │  webhook_signing_secrets     │
              └──────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Kafka (platform event bus)                                      │
│  Topics: any subscribed event type (e.g. console.document.*)     │
└────────────────────────────┬─────────────────────────────────────┘
                             │ consumed by
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: webhook-dispatcher.mjs                        │
│  • Reads active subscriptions matching event type + workspace    │
│  • Enqueues webhook_deliveries in PG (pending)                   │
│  • Triggers webhook-delivery-worker per delivery                 │
└────────────────────────────┬─────────────────────────────────────┘
                             │ invokes async
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: webhook-delivery-worker.mjs                   │
│  • HTTP POST to target URL (with timeouts, no redirect follow)   │
│  • Signs payload with HMAC-SHA256                                │
│  • Records delivery attempt in PG                                │
│  • On failure → schedules retry via webhook-retry-scheduler.mjs  │
│  • On threshold exceeded → disables subscription + audit event   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: webhook-retry-scheduler.mjs                   │
│  • Computes next retry delay (exp back-off + jitter)             │
│  • Re-invokes webhook-delivery-worker.mjs after delay            │
│  • Cancels retries for deleted/disabled subscriptions            │
└──────────────────────────────────────────────────────────────────┘
```

### Invariants

- All actions extract `tenantId` and `workspaceId` from verified JWT claims; no trust of body-supplied tenant values.
- Signing secrets are stored encrypted at rest (AES-256) in `webhook_signing_secrets`; plaintext never written to PG directly.
- The dispatcher and delivery worker never cross workspace or tenant boundaries in a single invocation.
- Delivery rate limiting enforced in the dispatcher before enqueuing (per-workspace token-bucket backed by PG counter or Redis if available).

---

## 4. Data Model

### 4.1 PostgreSQL DDL

```sql
-- Webhook subscriptions
CREATE TABLE webhook_subscriptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             TEXT NOT NULL,
    workspace_id          TEXT NOT NULL,
    target_url            TEXT NOT NULL,                   -- must be HTTPS
    event_types           TEXT[] NOT NULL,                 -- validated against catalogue
    status                TEXT NOT NULL DEFAULT 'active',  -- active | paused | disabled | deleted
    consecutive_failures  INT NOT NULL DEFAULT 0,
    max_consecutive_failures INT NOT NULL DEFAULT 5,       -- platform default, can be tenant-overridden
    created_by            TEXT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ,
    metadata              JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_ws_tenant_workspace ON webhook_subscriptions (tenant_id, workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ws_status ON webhook_subscriptions (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_ws_event_types ON webhook_subscriptions USING GIN (event_types) WHERE deleted_at IS NULL;

-- Signing secrets (one active per subscription, supports grace period with two active rows)
CREATE TABLE webhook_signing_secrets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id  UUID NOT NULL REFERENCES webhook_subscriptions(id),
    secret_cipher    BYTEA NOT NULL,              -- AES-256-GCM encrypted signing secret
    secret_iv        BYTEA NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active', -- active | grace | revoked
    grace_expires_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at       TIMESTAMPTZ
);

CREATE INDEX idx_wss_subscription ON webhook_signing_secrets (subscription_id) WHERE status IN ('active','grace');

-- Webhook deliveries (one per event x subscription match)
CREATE TABLE webhook_deliveries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id  UUID NOT NULL REFERENCES webhook_subscriptions(id),
    tenant_id        TEXT NOT NULL,
    workspace_id     TEXT NOT NULL,
    event_type       TEXT NOT NULL,
    event_id         TEXT NOT NULL,               -- source event identifier from Kafka message
    payload_ref      TEXT,                        -- S3 reference if payload exceeds size limit
    payload_size     INT,
    status           TEXT NOT NULL DEFAULT 'pending', -- pending | succeeded | failed | permanently_failed
    attempt_count    INT NOT NULL DEFAULT 0,
    max_attempts     INT NOT NULL DEFAULT 5,
    next_attempt_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wd_subscription ON webhook_deliveries (subscription_id);
CREATE INDEX idx_wd_status_next ON webhook_deliveries (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_wd_tenant_workspace ON webhook_deliveries (tenant_id, workspace_id);

-- Individual HTTP attempt records
CREATE TABLE webhook_delivery_attempts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id   UUID NOT NULL REFERENCES webhook_deliveries(id),
    attempt_num   INT NOT NULL,
    attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    http_status   INT,                    -- NULL on connection error
    response_ms   INT,
    error_detail  TEXT,
    outcome       TEXT NOT NULL           -- succeeded | failed | timed_out
);

CREATE INDEX idx_wda_delivery ON webhook_delivery_attempts (delivery_id);
```

### 4.2 Event Catalogue Reference

The platform event type catalogue is stored as a static JSON file:

**`services/webhook-engine/src/event-catalogue.mjs`**

Initial entries (example set; extended by other features):

```json
[
  { "id": "document.created",  "description": "A new document was created in the workspace." },
  { "id": "document.updated",  "description": "An existing document was updated." },
  { "id": "document.deleted",  "description": "A document was soft-deleted." },
  { "id": "user.signed_up",    "description": "A new user registered in the workspace." },
  { "id": "function.completed","description": "A serverless function invocation completed." },
  { "id": "storage.object.created", "description": "An object was uploaded to workspace storage." }
]
```

### 4.3 Kafka Topics

| Topic | Purpose | Retention |
|---|---|---|
| `console.webhook.subscription.created` | Audit — subscription created | 30d |
| `console.webhook.subscription.updated` | Audit — subscription updated | 30d |
| `console.webhook.subscription.deleted` | Audit — subscription soft-deleted | 30d |
| `console.webhook.subscription.paused` | Audit — subscription paused | 30d |
| `console.webhook.subscription.resumed` | Audit — subscription resumed | 30d |
| `console.webhook.secret.rotated` | Audit — signing secret rotated | 30d |
| `console.webhook.delivery.succeeded` | Operational metrics | 7d |
| `console.webhook.delivery.permanently_failed` | Operational alert trigger | 30d |
| `console.webhook.subscription.auto_disabled` | Operational alert trigger | 30d |

Platform events sourced from Kafka are consumed by the dispatcher from their native topics (e.g., `console.document.created`, etc.). This task does not define those source topics — it only requires they follow the standard envelope format (see §5.2).

### 4.4 Environment Variables

| Variable | Description | Default |
|---|---|---|
| `WEBHOOK_SIGNING_KEY` | Master encryption key (AES-256) for signing secret storage | — (required) |
| `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` | Subscription quota | `25` |
| `WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE` | Delivery rate cap | `100` |
| `WEBHOOK_MAX_RETRY_ATTEMPTS` | Maximum retry attempts per delivery | `5` |
| `WEBHOOK_BASE_BACKOFF_MS` | Base delay for first retry | `1000` |
| `WEBHOOK_MAX_BACKOFF_MS` | Maximum retry delay | `300000` (5 min) |
| `WEBHOOK_CONNECTION_TIMEOUT_MS` | HTTP connection timeout | `5000` |
| `WEBHOOK_RESPONSE_TIMEOUT_MS` | HTTP response timeout | `30000` |
| `WEBHOOK_MAX_PAYLOAD_BYTES` | Maximum inline payload size | `524288` (512 KB) |
| `WEBHOOK_SECRET_GRACE_PERIOD_SECONDS` | Rotation grace period | `86400` (24 h) |
| `WEBHOOK_AUTO_DISABLE_THRESHOLD` | Consecutive failures before auto-disable | `5` |
| `WEBHOOK_DELIVERY_HISTORY_MAX_DAYS` | Delivery history retention | `30` |

---

## 5. API Contracts

### 5.1 Management REST API

Base path: `/v1/webhooks` (tenant/workspace context from JWT)

#### POST /v1/webhooks/subscriptions

Create a new subscription.

**Request body**:

```json
{
  "targetUrl": "https://example.com/hooks",
  "eventTypes": ["document.created", "user.signed_up"],
  "description": "Optional human-readable label"
}
```

**Response 201**:

```json
{
  "subscriptionId": "<uuid>",
  "targetUrl": "https://example.com/hooks",
  "eventTypes": ["document.created", "user.signed_up"],
  "status": "active",
  "signingSecret": "<plaintext — shown once, never returned again>",
  "createdAt": "<ISO8601>"
}
```

**Error codes**:
- `400 INVALID_URL` — non-HTTPS or malformed URL.
- `400 INVALID_EVENT_TYPES` — unknown or disallowed event types.
- `409 QUOTA_EXCEEDED` — workspace subscription quota reached.
- `403 FORBIDDEN` — caller lacks webhook management permission.

#### GET /v1/webhooks/subscriptions

List subscriptions for workspace (paginated).

**Query params**: `status`, `cursor`, `limit` (max 100).

**Response 200**:

```json
{
  "items": [
    {
      "subscriptionId": "<uuid>",
      "targetUrl": "https://...",
      "eventTypes": ["document.created"],
      "status": "active",
      "consecutiveFailures": 0,
      "createdAt": "<ISO8601>",
      "updatedAt": "<ISO8601>"
    }
  ],
  "nextCursor": "<opaque>"
}
```

Note: `signingSecret` is **never** returned in list or detail endpoints after creation.

#### GET /v1/webhooks/subscriptions/:id

Get subscription detail. Same shape as list item.

#### PATCH /v1/webhooks/subscriptions/:id

Update `targetUrl`, `eventTypes`, or `description`. Status cannot be changed here.

#### POST /v1/webhooks/subscriptions/:id/pause

Pause an active subscription.

**Response 200**: updated subscription resource (status: `paused`).

#### POST /v1/webhooks/subscriptions/:id/resume

Resume a paused subscription.

**Response 200**: updated subscription resource (status: `active`).

#### DELETE /v1/webhooks/subscriptions/:id

Soft-delete. Sets `deleted_at`, cancels pending deliveries, emits audit event.

**Response 204**.

#### POST /v1/webhooks/subscriptions/:id/rotate-secret

Rotate the signing secret.

**Request body** (optional):

```json
{ "gracePeriodSeconds": 86400 }
```

**Response 200**:

```json
{
  "newSigningSecret": "<plaintext — shown once>",
  "gracePeriodSeconds": 86400,
  "graceExpiresAt": "<ISO8601>"
}
```

#### GET /v1/webhooks/subscriptions/:id/deliveries

Paginated delivery history.

**Query params**: `status` (`succeeded|failed|permanently_failed`), `from`, `to`, `cursor`, `limit` (max 100).

**Response 200**:

```json
{
  "items": [
    {
      "deliveryId": "<uuid>",
      "eventType": "document.created",
      "eventId": "<source event id>",
      "status": "succeeded",
      "attemptCount": 1,
      "createdAt": "<ISO8601>",
      "updatedAt": "<ISO8601>"
    }
  ],
  "nextCursor": "<opaque>"
}
```

#### GET /v1/webhooks/subscriptions/:id/deliveries/:deliveryId

Delivery detail with attempt breakdown.

**Response 200**:

```json
{
  "deliveryId": "<uuid>",
  "status": "permanently_failed",
  "attemptCount": 5,
  "attempts": [
    {
      "attemptNum": 1,
      "attemptedAt": "<ISO8601>",
      "httpStatus": 503,
      "responseMs": 1200,
      "outcome": "failed"
    }
  ]
}
```

#### GET /v1/webhooks/event-types

List available event types for subscription.

**Response 200**:

```json
{
  "eventTypes": [
    { "id": "document.created", "description": "..." }
  ]
}
```

### 5.2 Webhook Delivery HTTP Contract

**HTTP Method**: `POST`  
**Content-Type**: `application/json`

**Headers sent to target**:

| Header | Value |
|---|---|
| `X-Platform-Webhook-Id` | Delivery UUID |
| `X-Platform-Webhook-Timestamp` | Unix timestamp (seconds) — must be within ±5 min for freshness |
| `X-Platform-Webhook-Event` | Event type string (e.g. `document.created`) |
| `X-Platform-Webhook-Signature` | `sha256=<hex>` — HMAC-SHA256 over raw request body using signing secret |
| `X-Platform-Webhook-Attempt` | Attempt number (1-based) |
| `User-Agent` | `PlatformWebhook/1.0` |

**Payload envelope**:

```json
{
  "id": "<delivery-uuid>",
  "timestamp": "<ISO8601>",
  "eventType": "document.created",
  "workspaceId": "<workspace-id>",
  "data": { /* event-specific payload */ }
}
```

**Signature computation**:

```text
signature = HMAC-SHA256(key=signingSecret, message=rawRequestBody)
header = "sha256=" + hex(signature)
```

**Delivery success**: HTTP 2xx response within `WEBHOOK_RESPONSE_TIMEOUT_MS`.  
**Delivery failure**: non-2xx (including 3xx — redirects not followed), connection error, or timeout.

---

## 6. Files to Create or Modify

### New files

```text
services/webhook-engine/
  src/
    event-catalogue.mjs                    # Static event type catalogue
    webhook-subscription.mjs               # Pure-functional subscription model & validators
    webhook-delivery.mjs                   # Delivery state machine helpers
    webhook-signing.mjs                    # HMAC-SHA256 signing + secret encryption helpers
    webhook-retry-policy.mjs               # Exp back-off + jitter calculator
    webhook-quota.mjs                      # Quota/rate-limit evaluation helpers
    webhook-audit.mjs                      # Audit event builders for Kafka publication
  actions/
    webhook-management.mjs                 # OpenWhisk action: CRUD + lifecycle management
    webhook-dispatcher.mjs                 # OpenWhisk action: event fan-out to subscriptions
    webhook-delivery-worker.mjs            # OpenWhisk action: HTTP POST with retry logic
    webhook-retry-scheduler.mjs            # OpenWhisk action: schedule next retry invocation
  migrations/
    001-webhook-subscriptions.sql          # DDL for all four webhook tables (§4.1)

tests/
  unit/
    webhook-subscription.test.mjs
    webhook-delivery.test.mjs
    webhook-signing.test.mjs
    webhook-retry-policy.test.mjs
    webhook-quota.test.mjs
    webhook-audit.test.mjs
  integration/
    webhook-management-action.test.mjs     # Action tests with PG test container
    webhook-dispatcher.test.mjs
    webhook-delivery-worker.test.mjs
  contracts/
    webhook-api.contract.test.mjs          # Request/response shape assertions
  e2e/
    outbound-webhooks/
      README.md                            # Scenario matrix (see §7.4)

specs/085-outbound-webhooks/
  plan.md                                  # This file
```

### Additive modifications

- `services/provisioning-orchestrator/src/` — no changes needed; webhook engine is an independent service.
- `AGENTS.md` — append webhook engine technology summary after task completes (auto-update convention).

---

## 7. Test Strategy

### 7.1 Unit Tests

All pure-functional modules tested in isolation (no I/O).

**`webhook-subscription.mjs`**:
- Valid subscription construction with all fields.
- Rejection of non-HTTPS target URL.
- Rejection of empty or unknown event types.
- Quota check: at-limit, over-limit, within-limit.
- Status transitions: active → paused, paused → active, active → disabled.
- Soft-delete sets `deleted_at` and status `deleted`.

**`webhook-signing.mjs`**:
- HMAC-SHA256 signature computation is deterministic for same key + body.
- Different body or key produces different signature.
- Secret encryption round-trip (encrypt → decrypt returns original).
- Grace period: two active secrets during rotation, both validate correctly.
- After grace expiry: old secret fails, new secret succeeds.

**`webhook-retry-policy.mjs`**:
- Attempt 1–5 produce monotonically increasing delays within `WEBHOOK_MAX_BACKOFF_MS`.
- Jitter produces values within expected range (deterministic seed for tests).
- Attempts beyond `max_attempts` return `null` (no more retries).

**`webhook-quota.mjs`**:
- Rate limit counter increment and check.
- Subscription count check: at-limit returns false, under-limit returns true.

**`webhook-audit.mjs`**:
- All audit event builders return required fields: `tenantId`, `workspaceId`, `actorId`, `action`, `resourceId`, `timestamp`.
- No secrets or plaintext signing secrets in audit payloads.

### 7.2 Integration Tests

Require PostgreSQL (test container or CI-provisioned):

**`webhook-management-action.test.mjs`**:
- Full create → read → update → pause → resume → rotate-secret → delete cycle.
- Quota enforcement with populated subscription count.
- Concurrent create requests respect quota without double-insert.
- Delete cancels pending delivery rows.

**`webhook-dispatcher.test.mjs`**:
- Inserts delivery rows for all active subscriptions matching event type and workspace.
- Does not insert for paused, disabled, or deleted subscriptions.
- Does not cross workspace or tenant boundaries.
- Respects delivery rate limit (mock token bucket).

**`webhook-delivery-worker.test.mjs`**:
- Successful delivery (mock HTTP server returning 200) marks delivery succeeded.
- 5xx response schedules retry via retry scheduler.
- Connection timeout schedules retry.
- 3xx response treated as failure (no redirect follow).
- Final retry failure marks permanently_failed, disables subscription if threshold met.
- Delivery attempt row created for each invocation.
- Payload size enforcement: oversized payload → `payload_ref` populated, body truncated.

### 7.3 Contract Tests

**`webhook-api.contract.test.mjs`**:
- POST /subscriptions request/response shape.
- GET /subscriptions list pagination shape.
- GET /subscriptions/:id/deliveries pagination shape.
- Delivery HTTP headers and payload envelope structure.
- Signature header format (`sha256=<hex>`).
- Error response envelope: `{ "code": "<CODE>", "message": "<string>" }`.

### 7.4 E2E Scenario Matrix (static, documented in README.md)

| Scenario | Setup | Expected outcome |
|---|---|---|
| Happy path — single delivery | Active subscription, event fires | HTTP POST received by mock server within 10s; attempt logged as succeeded |
| Failed then recovered | Endpoint fails twice then returns 200 | Two failed attempts, third attempt marked succeeded; subscription remains active |
| All retries exhausted | Endpoint always returns 503 | max_attempts attempts logged; delivery permanently_failed; subscription consecutive_failures incremented |
| Auto-disable | Enough consecutive permanently-failed deliveries | Subscription status → disabled; audit event emitted |
| Paused subscription | Subscription paused before event fires | No delivery row created for matching event |
| Quota exceeded | Workspace at subscription limit | 409 QUOTA_EXCEEDED returned |
| Cross-workspace isolation | Two workspaces, overlapping event type | Each workspace receives only its own deliveries |
| Secret rotation grace | Secret rotated; old secret still in grace | Both old and new secrets verify delivery signature correctly |
| Redirect not followed | Target URL returns 302 | Delivery marked failed; no request to redirect destination |
| Payload size limit | Event produces payload > max size | Delivery body truncated; payload_ref populated with S3 reference |

---

## 8. Security Considerations

- **Secret storage**: Signing secrets encrypted with AES-256-GCM using `WEBHOOK_SIGNING_KEY`; IV stored alongside ciphertext in `webhook_signing_secrets`.
- **Secret display**: Plaintext signing secret returned **only once** at creation or rotation. All subsequent reads return null for the secret field.
- **URL validation**: Reject any non-HTTPS URL at creation time; validate URL parsability. SSRF mitigation: reject private IP ranges and loopback addresses in target URL.
- **No redirect follow**: Prevents open-redirect-based SSRF; 3xx responses treated as delivery failures.
- **Timeouts**: Both connection and response timeouts enforced per attempt to prevent resource exhaustion.
- **Tenant isolation**: `tenantId` and `workspaceId` always sourced from JWT claims, never from request body.
- **Audit trail**: All management operations emit Kafka audit events with actor, action, resource, timestamp.
- **Payload redaction**: Audit event builders must not include raw event payloads or signing secrets.

---

## 9. Observability

- **Kafka audit topics** (see §4.3) cover full management lifecycle and delivery outcomes.
- **Delivery attempt records** in PostgreSQL provide subscription-scoped history queryable by workspace developers.
- **Metrics to expose** (via action response metadata or future metrics pipeline):
  - `webhook_delivery_success_total` (labels: tenant, workspace)
  - `webhook_delivery_failure_total` (labels: tenant, workspace, outcome)
  - `webhook_delivery_latency_ms` (histogram)
  - `webhook_retry_attempt_total` (labels: attempt_num)
  - `webhook_subscription_auto_disabled_total`

---

## 10. Rollback and Migration Safety

- **Additive DDL**: All four webhook tables are new; no existing tables modified.
- **Migration file**: `001-webhook-subscriptions.sql` applies with `IF NOT EXISTS` guards on all `CREATE INDEX` statements.
- **Rollback**: Drop the four tables and revert OpenWhisk action deployments. No destructive change to existing schemas.
- **Feature flag**: Dispatcher action can be gated by `WEBHOOK_ENGINE_ENABLED=true` env var; if false, dispatcher exits immediately without enqueuing deliveries.
- **Idempotency**: Dispatcher uses `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, event_id)` to prevent duplicate delivery rows if Kafka delivers the same event twice.

---

## 11. Implementation Sequence

1. **Migrations** — Create `001-webhook-subscriptions.sql`; apply to dev/CI environment.
2. **Pure-functional modules** — Implement and unit-test `webhook-subscription.mjs`, `webhook-signing.mjs`, `webhook-retry-policy.mjs`, `webhook-quota.mjs`, `webhook-audit.mjs`, `webhook-delivery.mjs`, `event-catalogue.mjs`.
3. **Management action** — Implement and integration-test `webhook-management.mjs` (CRUD + lifecycle).
4. **Dispatcher action** — Implement and integration-test `webhook-dispatcher.mjs`.
5. **Delivery worker + retry scheduler** — Implement and integration-test `webhook-delivery-worker.mjs` and `webhook-retry-scheduler.mjs`.
6. **Contract tests** — Write and pass `webhook-api.contract.test.mjs`.
7. **E2E README** — Document scenario matrix in `tests/e2e/outbound-webhooks/README.md`.
8. **APISIX route configuration** — Add route for `/v1/webhooks/**` pointing to `webhook-management` action with Keycloak JWT plugin.
9. **Helm chart updates** — Add webhook-engine secrets, env vars, and OpenWhisk action deploy manifests.

Steps 2–5 can be parallelised across developers once migrations are applied. Steps 6–9 depend on steps 2–5.

---

## 12. Done Criteria

Done means all of the following are true:

- [ ] All four PostgreSQL tables exist and migration applies cleanly to a fresh database.
- [ ] All pure-functional modules pass unit tests with ≥90% line coverage.
- [ ] Management action integration tests pass the full subscription lifecycle (create, read, update, pause, resume, rotate-secret, delete).
- [ ] Dispatcher integration tests confirm correct fan-out with tenant/workspace isolation and no delivery row for paused/deleted subscriptions.
- [ ] Delivery worker tests confirm: 2xx → succeeded, 5xx/timeout → retry scheduled, max retries → permanently_failed, 3xx → failure (no redirect).
- [ ] Contract tests pass for all documented request/response shapes and delivery HTTP headers.
- [ ] E2E scenario README documents all 10 scenarios with setup, steps, and expected outcomes.
- [ ] APISIX route for `/v1/webhooks/**` validated in integration environment (or documented in Helm values as a ready-to-apply route manifest).
- [ ] Signing secret never appears in list/detail API responses, delivery history, or Kafka audit events.
- [ ] Zero cross-tenant or cross-workspace data returned in any test scenario.
- [ ] All management operations produce Kafka audit events with actor, action, resourceId, tenantId, workspaceId, timestamp.
- [ ] Branch `085-outbound-webhooks` passes CI lint and test suite.
