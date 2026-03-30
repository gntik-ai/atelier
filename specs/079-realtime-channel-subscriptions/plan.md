# Implementation Plan: Realtime Channel & Subscription Model per Workspace

**Feature Branch**: `079-realtime-channel-subscriptions`  
**Spec**: `specs/079-realtime-channel-subscriptions/spec.md`  
**Task**: US-DX-01-T01 — Diseñar el modelo de channels/subscriptions por workspace y tipo de evento  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Date**: 2026-03-30  
**Status**: Ready for Implementation

---

## 1. Architecture & Component Overview

### 1.1 High-Level Flow

```text
[External Developer App]
        │ HTTP/WS
        ▼
[APISIX API Gateway]  ←─ JWT validation via Keycloak plugin
        │
        ▼
[OpenWhisk Action: subscription-crud]
        │
        ├──► [PostgreSQL: realtime_channels, realtime_subscriptions, subscription_quotas]
        │
        └──► [Kafka: console.realtime.subscription-lifecycle]

[Event Ingress (T02/T03)] ──► [OpenWhisk Action: subscription-resolver]
                                    │
                                    └──► resolves matching subscriptions from PostgreSQL
                                         and publishes to delivery layer (T02+)
```

### 1.2 Component Responsibilities

| Component | Role |
|-----------|------|
| `realtime_channels` (PostgreSQL table) | Catalog of channel types available per workspace, derived from provisioned data sources |
| `realtime_subscriptions` (PostgreSQL table) | Durable subscription records with owner, channel, filter, status, quota enforcement |
| `subscription_quotas` (PostgreSQL table) | Configurable per-workspace and per-tenant subscription limits |
| `subscription_audit_log` (PostgreSQL table) | Immutable lifecycle audit trail |
| OpenWhisk action `realtime-subscription-crud` | CRUD lifecycle for subscriptions, quota validation, audit publishing |
| OpenWhisk action `realtime-channel-list` | Lists available channel types for a workspace |
| OpenWhisk action `realtime-subscription-resolver` | Resolves matching active subscriptions for an incoming event |
| Kafka topic `console.realtime.subscription-lifecycle` | Durable audit and integration stream for subscription events |
| APISIX routes | Expose subscription API under `/workspaces/{workspaceId}/realtime/` |

### 1.3 Domain Boundaries

- **Control plane** (this task): channel catalog, subscription lifecycle, quota enforcement, audit.
- **Data plane** (T02/T03): CDC connectors pushing change events to Kafka.
- **Delivery plane** (T04+): routing resolved subscriptions to WebSocket/SSE/webhook endpoints.

---

## 2. Data Model

### 2.1 `realtime_channels`

Represents the catalog of available channel types within a workspace, derived from provisioned data sources.

```sql
CREATE TABLE realtime_channels (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    workspace_id        UUID NOT NULL,
    channel_type        VARCHAR(64) NOT NULL,   -- e.g. 'postgresql-changes', 'mongodb-changes'
    data_source_kind    VARCHAR(32) NOT NULL,   -- 'postgresql' | 'mongodb'
    data_source_ref     VARCHAR(255) NOT NULL,  -- DB name / cluster identifier
    display_name        VARCHAR(128),
    description         TEXT,
    status              VARCHAR(32) NOT NULL DEFAULT 'available',  -- 'available' | 'unavailable' | 'deprovisioned'
    kafka_topic_pattern VARCHAR(255),           -- Kafka topic pattern this channel maps to (informational)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, channel_type, data_source_ref)
);

CREATE INDEX idx_realtime_channels_workspace ON realtime_channels (workspace_id, status);
CREATE INDEX idx_realtime_channels_tenant    ON realtime_channels (tenant_id, status);
```

**Notes**:
- Populated/synced by provisioning actions when a data source is added to a workspace (US-PGDATA-01, US-MGDATA-02).
- `kafka_topic_pattern` records the Kafka topic convention for T02/T03 wiring (e.g., `console.cdc.pg.{workspaceId}.{dbName}.#`).
- Row-level isolation: queries always include `tenant_id` and `workspace_id` predicates.

### 2.2 `realtime_subscriptions`

Core durable resource: one row per subscription.

```sql
CREATE TABLE realtime_subscriptions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    workspace_id      UUID NOT NULL,
    channel_id        UUID NOT NULL REFERENCES realtime_channels(id),
    channel_type      VARCHAR(64) NOT NULL,       -- denormalized for query efficiency
    owner_identity    VARCHAR(255) NOT NULL,       -- Keycloak subject (sub claim)
    owner_client_id   VARCHAR(255),                -- optional: service account client ID
    event_filter      JSONB,                       -- nullable; see Event Filter schema below
    status            VARCHAR(32) NOT NULL DEFAULT 'active',  -- 'active' | 'suspended' | 'deleted'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,                 -- set on soft-delete, hard purge policy separate
    metadata          JSONB                        -- extensible: description, labels, etc.
);

CREATE INDEX idx_realtime_subs_workspace_status  ON realtime_subscriptions (workspace_id, status) WHERE status != 'deleted';
CREATE INDEX idx_realtime_subs_tenant_status     ON realtime_subscriptions (tenant_id, status) WHERE status != 'deleted';
CREATE INDEX idx_realtime_subs_channel_status    ON realtime_subscriptions (channel_id, status) WHERE status = 'active';
CREATE INDEX idx_realtime_subs_owner             ON realtime_subscriptions (workspace_id, owner_identity) WHERE status != 'deleted';
CREATE INDEX idx_realtime_subs_filter            ON realtime_subscriptions USING GIN (event_filter) WHERE status = 'active';
```

**Status machine**:

```text
active ──suspend──► suspended ──reactivate──► active
  │                    │
  └──delete────────────┴──► deleted  (terminal, soft-deleted)
```

#### Event Filter JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "EventFilter",
  "type": "object",
  "properties": {
    "table_name":       { "type": "string" },
    "collection_name":  { "type": "string" },
    "operations":       {
      "type": "array",
      "items": { "enum": ["INSERT", "UPDATE", "DELETE", "REPLACE"] },
      "minItems": 1
    },
    "schema_name":      { "type": "string", "description": "PostgreSQL schema name" }
  },
  "additionalProperties": false
}
```

**Matching semantics**:
- If `event_filter` is null → match all events on the channel.
- If `table_name` / `collection_name` is set → only match events from that resource.
- If `operations` is set → only match events with listed operation types.
- Multiple filter properties are ANDed.

### 2.3 `subscription_quotas`

```sql
CREATE TABLE subscription_quotas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    workspace_id    UUID,           -- NULL = tenant-level quota; NOT NULL = workspace-level quota
    max_subscriptions INT NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workspace_id)
);

CREATE INDEX idx_sub_quotas_tenant ON subscription_quotas (tenant_id);
```

**Enforcement pattern**:

```sql
-- Atomic quota check + insert in a single transaction:
WITH current_count AS (
    SELECT COUNT(*) AS cnt FROM realtime_subscriptions
    WHERE workspace_id = $workspace_id AND status != 'deleted'
), quota AS (
    SELECT max_subscriptions FROM subscription_quotas
    WHERE tenant_id = $tenant_id AND workspace_id = $workspace_id
)
INSERT INTO realtime_subscriptions (...)
SELECT ... FROM current_count, quota
WHERE current_count.cnt < quota.max_subscriptions;
-- If 0 rows inserted → quota exceeded
```

If no workspace-level quota row exists, fall back to tenant-level quota; if none, apply platform default (configurable via env `REALTIME_SUBSCRIPTION_DEFAULT_QUOTA=100`).

### 2.4 `subscription_audit_log`

Append-only audit table (never updated/deleted):

```sql
CREATE TABLE subscription_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID,           -- may be null if creation failed
    tenant_id       UUID NOT NULL,
    workspace_id    UUID NOT NULL,
    actor_identity  VARCHAR(255) NOT NULL,
    action          VARCHAR(32) NOT NULL,   -- 'created' | 'suspended' | 'reactivated' | 'deleted' | 'updated'
    before_state    JSONB,
    after_state     JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_id      VARCHAR(128)            -- correlation / trace ID
);

CREATE INDEX idx_sub_audit_subscription ON subscription_audit_log (subscription_id, occurred_at);
CREATE INDEX idx_sub_audit_workspace    ON subscription_audit_log (workspace_id, occurred_at);
CREATE INDEX idx_sub_audit_tenant       ON subscription_audit_log (tenant_id, occurred_at);
```

---

## 3. API Contract

Base path (exposed via APISIX): `/api/v1/workspaces/{workspaceId}/realtime`

### 3.1 Channel Types

| Method | Path | Description |
|--------|------|-------------|
| GET | `/channels` | List available channel types for the workspace |

**GET /channels response**:

```json
{
  "items": [
    {
      "id": "uuid",
      "channel_type": "postgresql-changes",
      "data_source_kind": "postgresql",
      "data_source_ref": "mydb",
      "display_name": "PostgreSQL Changes – mydb",
      "status": "available",
      "kafka_topic_pattern": "console.cdc.pg.{workspaceId}.mydb.#"
    }
  ],
  "total": 1
}
```

### 3.2 Subscriptions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/subscriptions` | Create a subscription |
| GET | `/subscriptions` | List subscriptions (paginated, workspace-scoped) |
| GET | `/subscriptions/{id}` | Get subscription by ID |
| PATCH | `/subscriptions/{id}` | Update event filter or status |
| DELETE | `/subscriptions/{id}` | Delete subscription |

**POST /subscriptions request body**:

```json
{
  "channel_type": "postgresql-changes",
  "data_source_ref": "mydb",
  "event_filter": {
    "table_name": "orders",
    "operations": ["INSERT", "UPDATE"]
  },
  "metadata": {
    "description": "Order change notifications"
  }
}
```

**POST /subscriptions response (201)**:

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "tenant_id": "uuid",
  "channel_type": "postgresql-changes",
  "channel_id": "uuid",
  "owner_identity": "sub:keycloak-user-id",
  "event_filter": { "table_name": "orders", "operations": ["INSERT", "UPDATE"] },
  "status": "active",
  "created_at": "2026-03-30T08:00:00Z",
  "updated_at": "2026-03-30T08:00:00Z"
}
```

**PATCH /subscriptions/{id} request body** (partial update):

```json
{
  "status": "suspended"
}
```

**Error responses**:
- `400 INVALID_CHANNEL_TYPE` — channel type not available in this workspace.
- `400 INVALID_EVENT_FILTER` — filter schema validation failed.
- `404 SUBSCRIPTION_NOT_FOUND`
- `409 QUOTA_EXCEEDED` — workspace or tenant subscription quota reached.
- `409 INVALID_STATUS_TRANSITION` — illegal state machine transition.

### 3.3 Tenant Summary (admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tenants/{tenantId}/realtime/subscriptions/summary` | Per-workspace subscription counts by status and channel type |

---

## 4. OpenWhisk Actions

All actions live under `services/provisioning-orchestrator/src/actions/realtime/`.

### 4.1 `realtime-channel-list.mjs`

- Input: `{ workspaceId, tenantId }` (from JWT context via APISIX).
- Query `realtime_channels WHERE workspace_id = $1 AND status = 'available'`.
- Return channel list.
- No writes, no Kafka events.

### 4.2 `realtime-subscription-crud.mjs`

- Handles CREATE, READ, LIST, PATCH, DELETE via `method` + `subscriptionId` params.
- **CREATE flow**:
  1. Validate `channel_type` exists and is `available` for workspace.
  2. Validate `event_filter` JSON schema.
  3. Atomic quota check + INSERT (see §2.3).
  4. Insert audit log row.
  5. Publish Kafka event `console.realtime.subscription-lifecycle` with action=`created`.
- **LIST flow**: paginated SELECT with `workspace_id` + `status != 'deleted'` filter.
- **PATCH flow**:
  1. Validate target subscription belongs to workspace/tenant.
  2. Validate status transition legality.
  3. UPDATE row, set `updated_at`.
  4. Insert audit log + publish Kafka.
- **DELETE flow**: Soft-delete (set `status='deleted'`, `deleted_at=now()`), audit, Kafka.
- All flows extract `tenantId`, `workspaceId`, `actorIdentity` from Keycloak JWT forwarded by APISIX.

### 4.3 `realtime-subscription-resolver.mjs`

- Input: `{ workspaceId, channelType, dataSourceRef, operation, tableName?, collectionName? }`.
- Query `realtime_subscriptions` WHERE:
  - `workspace_id = $workspaceId`
  - `channel_type = $channelType`
  - `status = 'active'`
  - Filter matching (see §2.2 semantics, evaluated in SQL with JSONB operators).
- Returns list of matching subscription IDs + owner identities for delivery layer.
- Read-only; no writes, no Kafka events.

#### Resolver SQL Pattern

```sql
SELECT id, owner_identity, event_filter, metadata
FROM realtime_subscriptions
WHERE workspace_id = $1
  AND channel_type = $2
  AND status = 'active'
  AND (
      event_filter IS NULL
      OR (
          (event_filter->>'table_name' IS NULL OR event_filter->>'table_name' = $3)
          AND (event_filter->>'collection_name' IS NULL OR event_filter->>'collection_name' = $3)
          AND (event_filter->'operations' IS NULL
               OR event_filter->'operations' @> to_jsonb($4::text))
      )
  );
```

---

## 5. Kafka Event Contract

**Topic**: `console.realtime.subscription-lifecycle`  
**Retention**: 30 days  
**Partitioning**: by `workspace_id` (key)

**Message envelope**:

```json
{
  "specversion": "1.0",
  "type": "console.realtime.subscription.{action}",
  "source": "/workspaces/{workspaceId}/realtime/subscriptions",
  "id": "uuid",
  "time": "2026-03-30T08:00:00Z",
  "tenantid": "uuid",
  "workspaceid": "uuid",
  "data": {
    "subscription_id": "uuid",
    "channel_type": "postgresql-changes",
    "owner_identity": "sub:...",
    "action": "created|suspended|reactivated|deleted|updated",
    "before_state": { ... },
    "after_state": { ... },
    "actor_identity": "sub:...",
    "request_id": "trace-uuid"
  }
}
```

Valid `action` values: `created`, `suspended`, `reactivated`, `deleted`, `updated`.

---

## 6. File Structure

```text
services/provisioning-orchestrator/src/
  actions/
    realtime/
      realtime-channel-list.mjs               (new)
      realtime-subscription-crud.mjs          (new)
      realtime-subscription-resolver.mjs      (new)
  models/
    realtime/
      ChannelType.mjs                         (new - domain model)
      Subscription.mjs                        (new - domain model + state machine)
      EventFilter.mjs                         (new - filter schema + matching logic)
      SubscriptionQuota.mjs                   (new - quota enforcement)
  repositories/
    realtime/
      ChannelRepository.mjs                   (new - realtime_channels CRUD)
      SubscriptionRepository.mjs              (new - realtime_subscriptions CRUD)
      QuotaRepository.mjs                     (new - quota read + atomic enforcement)
      AuditRepository.mjs                     (new - append-only audit writes)
  events/
    realtime/
      SubscriptionLifecyclePublisher.mjs      (new - Kafka publish helper)
  migrations/
    0020_create_realtime_channels.sql         (new)
    0021_create_realtime_subscriptions.sql    (new)
    0022_create_subscription_quotas.sql       (new)
    0023_create_subscription_audit_log.sql    (new)

specs/079-realtime-channel-subscriptions/
  spec.md                                     (existing)
  plan.md                                     (this file)
  openapi/
    realtime-subscriptions-v1.yaml            (new - OpenAPI 3.1 contract)

tests/
  unit/
    realtime/
      EventFilter.test.mjs                    (new)
      Subscription.test.mjs                   (new - state machine)
      SubscriptionQuota.test.mjs              (new)
  integration/
    realtime/
      subscription-crud.test.mjs              (new)
      subscription-resolver.test.mjs          (new)
      quota-enforcement.test.mjs              (new)
  contract/
    realtime/
      subscription-lifecycle-event.test.mjs   (new - Kafka schema validation)
```

---

## 7. Migrations

### Migration 0020 — `realtime_channels`

See DDL in §2.1. Also inserts default channel-type rows for existing provisioned workspaces (idempotent, via `INSERT ... ON CONFLICT DO NOTHING`).

### Migration 0021 — `realtime_subscriptions`

See DDL in §2.2.

### Migration 0022 — `subscription_quotas`

See DDL in §2.3. Seeds a platform-level default quota row for every existing tenant (from `tenants` table).

### Migration 0023 — `subscription_audit_log`

See DDL in §2.4.

**Rollback strategy**: Each migration has a paired `DOWN` script that drops the new tables in reverse order (0023 → 0020). Because these are new tables with no foreign keys into existing tables (channels/subscriptions are self-contained), rollback is safe at any point before T02/T03 wire-up.

---

## 8. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REALTIME_SUBSCRIPTION_DEFAULT_QUOTA` | `100` | Platform-level default max subscriptions per workspace |
| `REALTIME_TENANT_DEFAULT_QUOTA` | `500` | Platform-level default max subscriptions per tenant |
| `REALTIME_SUBSCRIPTION_KAFKA_TOPIC` | `console.realtime.subscription-lifecycle` | Lifecycle event topic |
| `REALTIME_SUBSCRIPTION_KAFKA_RETENTION_MS` | `2592000000` | 30 days |
| `REALTIME_CHANNELS_CACHE_TTL_SECONDS` | `60` | In-action cache TTL for channel catalog reads |

---

## 9. APISIX Route Configuration

```yaml
# Route: Subscription CRUD
- uri: /api/v1/workspaces/*/realtime/subscriptions*
  methods: [GET, POST, PATCH, DELETE]
  plugins:
    openid-connect:
      introspection_endpoint: ${KEYCLOAK_INTROSPECTION_URL}
      bearer_only: true
    proxy-rewrite:
      uri: /api/v1/actions/realtime-subscription-crud
  upstream: openwhisk-invoker

# Route: Channel list
- uri: /api/v1/workspaces/*/realtime/channels
  methods: [GET]
  plugins:
    openid-connect:
      bearer_only: true
  upstream: openwhisk-invoker
```

JWT claims `sub`, `tenant_id`, `workspace_id` forwarded as HTTP headers `X-Identity-Subject`, `X-Tenant-ID`, `X-Workspace-ID` to the action.

---

## 10. Testing Strategy

### 10.1 Unit Tests (no I/O)

| Test | Scope |
|------|-------|
| `EventFilter.test.mjs` | Filter schema validation, matching semantics (null=match-all, table filter, ops filter, AND logic) |
| `Subscription.test.mjs` | State machine: valid transitions, terminal `deleted`, invalid transitions return errors |
| `SubscriptionQuota.test.mjs` | Quota math: under-limit allows, at-limit blocks, tenant fallback, platform default fallback |

### 10.2 Integration Tests (PostgreSQL, no Kafka)

| Test | Scope |
|------|-------|
| `subscription-crud.test.mjs` | CRUD lifecycle against test DB: create, list (pagination), get, suspend, reactivate, delete; tenant isolation (cross-workspace leak check) |
| `subscription-resolver.test.mjs` | Resolver accuracy: null filter matches all, table filter matches only correct table, ops filter, suspended excluded, cross-workspace excluded |
| `quota-enforcement.test.mjs` | Concurrent inserts under limit, atomic rejection at quota, tenant-level fallback |

### 10.3 Contract Tests (Kafka schema)

| Test | Scope |
|------|-------|
| `subscription-lifecycle-event.test.mjs` | Validate CloudEvents envelope structure, required fields, action enum values, `before_state`/`after_state` presence per action |

### 10.4 Acceptance Criteria Mapping

| AC | Test coverage |
|----|---------------|
| SC-001 (create < 5s) | Integration test with timing assertion |
| SC-002 (list < 3s, 500 subs) | Integration test seeding 500 rows, assert query time |
| SC-003 (resolver 100% accuracy) | `subscription-resolver.test.mjs` exhaustive matrix |
| SC-004 (isolation) | Cross-workspace and cross-tenant queries return empty |
| SC-005 (audit within 30s) | Integration test: create subscription, query audit log immediately |
| SC-006 (quota no races) | `quota-enforcement.test.mjs` concurrent Promise.all inserts |

---

## 11. Observability

- **Metrics** (via existing platform metrics pattern):
  - `realtime_subscriptions_created_total{workspace_id, tenant_id, channel_type}`
  - `realtime_subscriptions_active_gauge{workspace_id}`
  - `realtime_subscription_resolver_matches_total{workspace_id, channel_type}`
  - `realtime_quota_rejections_total{tenant_id, workspace_id}`
- **Logs**: Structured JSON logs on all action entry/exit with `subscription_id`, `tenant_id`, `workspace_id`, `actor_identity`, `request_id`.
- **Kafka audit**: `console.realtime.subscription-lifecycle` provides event replay and downstream monitoring.

---

## 12. Security Considerations

- All DB queries MUST include `tenant_id` + `workspace_id` predicates — never rely solely on `subscription_id`.
- `owner_identity` is extracted from verified JWT `sub` claim; never trusted from request body.
- Admin operations (list all workspace subs, suspend arbitrary subscription) require `workspace:admin` or `tenant:admin` Keycloak role claim.
- `subscription_audit_log` is append-only; no UPDATE or DELETE permissions granted to application role.
- Quota enforcement uses a single transaction with row-count CTE to prevent TOCTOU race conditions.

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| JSONB filter queries slow at scale | Medium | Medium | GIN index on `event_filter`; keep initial filter model simple; resolver only touches `active` rows |
| Quota race condition | Low | High | Atomic CTE pattern in single PG transaction; no application-level counter |
| `realtime_channels` out of sync with provisioned sources | Medium | Medium | Channel sync triggered by provisioning actions (US-PGDATA-01, US-MGDATA-02); add periodic reconciliation job in T02 |
| Orphaned subscriptions on workspace deprovision | Low | Medium | Add `ON DELETE CASCADE` FK from `workspace_id` in future or batch cleanup job; document in operational runbook |
| Filter schema evolution breaking existing subscriptions | Low | High | `additionalProperties: false` in schema; version field in filter JSON for future extension without breakage |

---

## 14. Dependencies & Sequencing

### Prerequisite (must be done before this task is usable end-to-end)

- US-EVT-03: Kafka topic conventions finalized (channel `kafka_topic_pattern` field depends on this).
- US-GW-04: APISIX routing in place for the realtime API surface.
- US-PGDATA-01 / US-MGDATA-02: Provisioned data source catalog available for channel seeding.

### This task unblocks

- US-DX-01-T02: PostgreSQL CDC → Kafka wiring (needs channel model to know target topics).
- US-DX-01-T03: MongoDB change streams (same).
- US-DX-01-T04: Auth scopes and filtering (extends subscription model).

### Parallelization within this task

- Migrations (0020–0023) can be authored in parallel with OpenAPI contract.
- Unit tests can be written against domain models independently of DB migrations.
- OpenWhisk actions depend on repositories, which depend on migrations being applied to test DB.

### Recommended implementation sequence

1. Migrations (0020 → 0023) + test DB apply.
2. Domain models (`ChannelType`, `Subscription`, `EventFilter`, `SubscriptionQuota`) + unit tests.
3. Repositories + quota enforcement + integration tests.
4. Kafka publisher helper.
5. OpenWhisk actions (channel-list, subscription-crud, subscription-resolver).
6. OpenAPI contract YAML.
7. APISIX route config.
8. Contract tests.

---

## 15. Done Criteria (US-DX-01-T01)

- [ ] All four migrations authored and tested against a clean PostgreSQL instance.
- [ ] Domain models cover all entities: Channel, Subscription (with state machine), EventFilter (with matching logic), SubscriptionQuota.
- [ ] Unit tests pass for domain model logic (100% branch coverage on state machine and filter matching).
- [ ] Repositories implemented with tenant+workspace isolation predicates on every query.
- [ ] Integration tests pass: full CRUD lifecycle, cross-workspace isolation verified, quota enforcement verified.
- [ ] `realtime-subscription-resolver` returns correct match set across all filter combinations (test matrix).
- [ ] Kafka contract tests validate CloudEvents envelope for all lifecycle event types.
- [ ] OpenAPI 3.1 contract covers all endpoints (channels list, subscription CRUD, tenant summary).
- [ ] Environment variables documented; Helm values updated with new env var keys.
- [ ] No existing test suite regressions.
- [ ] Plan and spec committed on `079-realtime-channel-subscriptions` branch.
