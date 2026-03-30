# Implementation Plan: PostgreSQL Change Data Capture → Kafka Realtime Channels

**Plan for**: US-DX-01-T02  
**Feature Branch**: `080-pg-change-to-kafka`  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Created**: 2026-03-30  
**Status**: Ready for implementation  
**Depends on**: US-DX-01-T01 (channel/subscription model — already merged), US-EVT-03 (Kafka backbone)

---

## 1. Architecture & Flow

### 1.1 Component topology

```
┌──────────────────────────────────────────────────────────────┐
│  Workspace PostgreSQL DB  (wal_level = logical)              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Logical Replication Slot (pgoutput)                 │    │
│  │  One slot per physical DB instance, shared across    │    │
│  │  workspaces that share a DB (quota-gated).           │    │
│  └──────────────────┬───────────────────────────────────┘    │
└─────────────────────│────────────────────────────────────────┘
                      │ WAL stream (pgoutput protocol)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  services/pg-cdc-bridge  (Node.js 20+ ESM, long-running)   │
│                                                             │
│  PgWalListener  ──► WalEventDecoder  ──► RouteFilter        │
│                                             │               │
│                                   ┌─────────▼────────┐      │
│                                   │ CaptureConfigCache│      │
│                                   │ (PostgreSQL-backed│      │
│                                   │  hot-reloadable)  │      │
│                                   └─────────┬────────┘      │
│                                             │               │
│                              ┌──────────────▼──────────┐    │
│                              │  KafkaChangePublisher    │    │
│                              │  (kafkajs, at-least-once)│    │
│                              └──────────────┬──────────┘    │
└─────────────────────────────────────────────│───────────────┘
                                              │
                      ┌───────────────────────▼─────────────────────────┐
                      │   Kafka  (per-workspace topics)                  │
                      │   Topic pattern: {tenant}.{workspace}.pg-changes │
                      └─────────────────────────────────────────────────┘
                                              │
                      ┌───────────────────────▼──────────────────────────┐
                      │  Downstream consumers                             │
                      │  (realtime gateway, webhooks, subscriptions)     │
                      └──────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  Management plane (OpenWhisk actions via APISIX)                      │
│  pg-capture-enable · pg-capture-disable · pg-capture-list             │
│  pg-capture-tenant-summary                                            │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| CDC mechanism | PostgreSQL logical replication, `pgoutput` plugin | Native in PG 10+; no third-party extensions. Uses `pg` npm package's streaming replication API. |
| Replication slot granularity | One slot per **physical DB instance** shared by a namespace prefix | Avoids `max_replication_slots` exhaustion; the bridge filters per workspace internally. |
| WAL consumer | `services/pg-cdc-bridge` — Node.js 20+ ESM long-running process | OpenWhisk actions are short-lived; WAL streaming needs a persistent connection. Bridge runs as a Kubernetes Deployment. |
| Kafka publication | `kafkajs` (already in stack) with `acks: -1` + idempotent producer | At-least-once guarantee aligned with existing platform standard. |
| Topic naming | `{tenantId}.{workspaceId}.pg-changes` (single topic per workspace, table as partition key) | Matches T01's `kafka_topic_pattern` stored in `realtime_channels`. Keeps topic count manageable; consumers filter by `table` field in event. |
| Capture config storage | New PostgreSQL table `pg_capture_configs` in provisioning-orchestrator DB | Consistent with existing repository pattern. |
| Quota enforcement | PostgreSQL advisory lock + count check in same transaction | Prevents race-condition over-allocation (SC-006). |
| Audit | New `pg_capture_audit_log` table + Kafka topic `console.pg-capture.lifecycle` | Mirrors `subscription_audit_log` pattern; dual-write for queryability and stream consumers. |
| Config hot-reload | Bridge polls `pg_capture_configs` every 30 s (configurable) | Avoids bridge restarts on every activation; config changes propagate within one poll cycle. |

---

## 2. Artefacts & Changes by Area

### 2.1 PostgreSQL migration

**File**: `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql`

```sql
-- up

-- Capture configuration: which tables are actively captured per workspace
CREATE TABLE IF NOT EXISTS pg_capture_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  workspace_id      UUID NOT NULL,
  data_source_ref   VARCHAR(255) NOT NULL,  -- provisioned PG data source identifier (from US-PGDATA-01)
  schema_name       VARCHAR(128) NOT NULL DEFAULT 'public',
  table_name        VARCHAR(128) NOT NULL,
  status            VARCHAR(32)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','errored','disabled')),
  activation_ts     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deactivation_ts   TIMESTAMPTZ,
  actor_identity    VARCHAR(255) NOT NULL,
  last_error        TEXT,
  lsn_start         PG_LSN,      -- WAL position at activation (informational)
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, data_source_ref, schema_name, table_name)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_pg_capture_workspace
  ON pg_capture_configs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_capture_tenant
  ON pg_capture_configs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_capture_datasource
  ON pg_capture_configs (data_source_ref, status);

-- Per-workspace and per-tenant quota ceiling
CREATE TABLE IF NOT EXISTS pg_capture_quotas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         VARCHAR(16) NOT NULL CHECK (scope IN ('workspace','tenant')),
  scope_id      UUID NOT NULL,           -- workspace_id or tenant_id
  max_tables    INTEGER NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id)
);

-- Audit log for capture lifecycle events
CREATE TABLE IF NOT EXISTS pg_capture_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID REFERENCES pg_capture_configs(id) ON DELETE SET NULL,
  tenant_id       UUID NOT NULL,
  workspace_id    UUID NOT NULL,
  actor_identity  VARCHAR(255) NOT NULL,
  action          VARCHAR(64) NOT NULL,   -- capture-enabled | capture-disabled | capture-errored | capture-paused | capture-resumed
  before_state    JSONB,
  after_state     JSONB,
  request_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pg_capture_audit_workspace
  ON pg_capture_audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_capture_audit_tenant
  ON pg_capture_audit_log (tenant_id, created_at DESC);

-- down
DROP TABLE IF EXISTS pg_capture_audit_log;
DROP TABLE IF EXISTS pg_capture_quotas;
DROP TABLE IF EXISTS pg_capture_configs;
```

### 2.2 Domain models

**`services/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs`**

```js
export const CAPTURE_STATUSES = new Set(['active', 'paused', 'errored', 'disabled']);

export class CaptureConfig {
  constructor(attrs) {
    this.id             = attrs.id;
    this.tenant_id      = attrs.tenant_id;
    this.workspace_id   = attrs.workspace_id;
    this.data_source_ref = attrs.data_source_ref;
    this.schema_name    = attrs.schema_name ?? 'public';
    this.table_name     = attrs.table_name;
    this.status         = attrs.status ?? 'active';
    this.activation_ts  = attrs.activation_ts ?? null;
    this.deactivation_ts = attrs.deactivation_ts ?? null;
    this.actor_identity = attrs.actor_identity;
    this.last_error     = attrs.last_error ?? null;
    this.lsn_start      = attrs.lsn_start ?? null;
    this.created_at     = attrs.created_at ?? null;
    this.updated_at     = attrs.updated_at ?? null;
    CaptureConfig.validate(this);
  }

  static validate(attrs) {
    for (const k of ['tenant_id', 'workspace_id', 'data_source_ref', 'table_name', 'actor_identity']) {
      if (!attrs[k]) throw new Error(`CAPTURE_${k.toUpperCase()}_REQUIRED`);
    }
    if (!CAPTURE_STATUSES.has(attrs.status ?? 'active')) throw new Error('INVALID_CAPTURE_STATUS');
  }

  qualifiedTable() { return `${this.schema_name}.${this.table_name}`; }

  static fromRow(row) { return new CaptureConfig(row); }
  toJSON() { return { ...this }; }
}
```

**`services/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs`**

Defines the CloudEvents-compatible envelope for WAL row mutations:

```js
// Fields:
// specversion, type ("console.pg-capture.change"), source, id (uuid), time,
// tenantid, workspaceid,
// data: { event_type: "insert"|"update"|"delete", schema, table,
//         lsn (string), committed_at (ISO8601), row_payload: {...},
//         capture_config_id, sequence (monotonic within session) }
```

### 2.3 Repositories

**`services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs`**

Operations:
- `create(config)` — INSERT with quota guard (advisory lock + count check in one transaction)
- `findActive(dataSourceRef)` — list all `status = 'active'` entries for a data source ref (used by bridge hot-reload)
- `findByWorkspace(tenantId, workspaceId, status?)` — workspace admin list
- `findByTenantSummary(tenantId)` — per-workspace counts for tenant owner view
- `updateStatus(id, status, { lastError, deactivationTs, actorIdentity })` — lifecycle transitions
- `disable(id, actorIdentity)` — sets `status = 'disabled'`, stamps `deactivation_ts`

**`services/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs`**

- `append(auditRow)` — mirrors existing `AuditRepository.append` signature

**`services/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs`**

- `getQuota(scope, scopeId)` — returns quota row or null (system default applied by caller)
- `countActive(scope, scopeId)` — returns current active capture count
- `upsert(scope, scopeId, maxTables)` — admin configuration

### 2.4 OpenWhisk actions (management plane)

All actions follow existing patterns: ESM `.mjs`, Keycloak JWT validation from `params.__ow_headers.authorization`, structured error responses.

| File | HTTP Method | Path (APISIX) | Purpose |
|---|---|---|---|
| `actions/realtime/pg-capture-enable.mjs` | POST | `/workspaces/:wsId/pg-captures` | Enable capture on a table |
| `actions/realtime/pg-capture-disable.mjs` | DELETE | `/workspaces/:wsId/pg-captures/:captureId` | Disable an active capture |
| `actions/realtime/pg-capture-list.mjs` | GET | `/workspaces/:wsId/pg-captures` | List captures in workspace |
| `actions/realtime/pg-capture-tenant-summary.mjs` | GET | `/tenants/:tenantId/pg-captures/summary` | Tenant-level summary |

**`pg-capture-enable.mjs` logic**:
1. Validate JWT — extract `workspace_id`, `tenant_id`, `actor_identity` from token claims.
2. Verify table exists in the workspace's provisioned PostgreSQL data source (call `US-PGDATA-01` data-source API or lookup in internal registry).
3. Check workspace + tenant quotas via `CaptureQuotaRepository`. Reject with `QUOTA_EXCEEDED` if over limit.
4. INSERT into `pg_capture_configs` (idempotent: ON CONFLICT returns existing if already active).
5. Append audit entry (PostgreSQL + Kafka `console.pg-capture.lifecycle`).
6. Return `201 Created` with capture config JSON.

**`pg-capture-disable.mjs` logic**:
1. Validate JWT + ownership.
2. Load existing config; reject if already disabled.
3. Update `status = 'disabled'`, stamp `deactivation_ts`.
4. Append audit entry.
5. Return `204 No Content`.

### 2.5 CDC Bridge service

**New service**: `services/pg-cdc-bridge/`

```
services/pg-cdc-bridge/
├── package.json            (type: "module", deps: pg, kafkajs, @openclaw/pg-helpers)
├── src/
│   ├── index.mjs           (entry point — starts WalListenerManager)
│   ├── WalListenerManager.mjs   (one listener per unique data_source_ref)
│   ├── PgWalListener.mjs        (opens replication connection, parses pgoutput)
│   ├── WalEventDecoder.mjs      (decodes pgoutput Relation/Insert/Update/Delete messages)
│   ├── RouteFilter.mjs          (matches decoded row event to active CaptureConfig)
│   ├── CaptureConfigCache.mjs   (polls pg_capture_configs, hot-reloadable every CACHE_TTL_SECONDS)
│   ├── KafkaChangePublisher.mjs (kafkajs producer, at-least-once, idempotent mode)
│   ├── HealthServer.mjs         (HTTP /health, /metrics endpoints)
│   └── MetricsCollector.mjs     (lag, published count, error count per workspace)
├── tests/
│   ├── unit/
│   │   ├── WalEventDecoder.test.mjs
│   │   ├── RouteFilter.test.mjs
│   │   └── CaptureConfigCache.test.mjs
│   └── integration/
│       └── pg-capture-to-kafka.integration.test.mjs
└── helm/
    └── pg-cdc-bridge/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
            ├── deployment.yaml
            ├── configmap.yaml
            └── service.yaml
```

#### PgWalListener — key implementation notes

Uses `pg`'s `Client` in replication mode:
```js
const client = new Client({ connectionString, replication: 'database' });
await client.connect();
await client.query(`CREATE_REPLICATION_SLOT ${slotName} LOGICAL pgoutput`);
await client.query(`START_REPLICATION SLOT ${slotName} LOGICAL 0/0 (proto_version '1', publication_names '${pubName}')`);
```

- **Publication**: One `CREATE PUBLICATION` per data source instance, initially covering all tables (`FOR ALL TABLES`). Tables not in active `pg_capture_configs` are filtered by `RouteFilter` before publishing to Kafka — avoids publication DDL churn on every enable/disable.
- **LSN acknowledgement**: Sent to PostgreSQL only after Kafka `producer.send()` resolves. This ensures at-least-once: if the bridge crashes post-WAL-receive but pre-Kafka-ack, on restart it will re-read from the last confirmed LSN.
- **Slot naming convention**: `cdc_{dataSourceRefHash8}` (max 64 chars PostgreSQL limit). The hash is deterministic from `data_source_ref`.

#### KafkaChangePublisher — topic and message format

Topic: value of `realtime_channels.kafka_topic_pattern` for the workspace's `postgresql-changes` channel (resolved via T01's channel model). Fallback pattern: `{tenantId}.{workspaceId}.pg-changes`.

Partition key: `{workspaceId}:{schemaName}.{tableName}` — ensures per-table ordering within a workspace (SC-002).

Message value: CloudEvents JSON envelope (CaptureChangeEvent schema above).

Message headers:
```
ce-type:        console.pg-capture.change
ce-source:      /data-sources/{dataSourceRef}/tables/{schema}.{table}
ce-tenantid:    {tenantId}
ce-workspaceid: {workspaceId}
```

### 2.6 Lifecycle audit events to Kafka

**`services/provisioning-orchestrator/src/events/realtime/PgCaptureLifecyclePublisher.mjs`**

Topic: `console.pg-capture.lifecycle` (retention: 30 days)  
Event types: `console.pg-capture.capture-enabled`, `console.pg-capture.capture-disabled`, `console.pg-capture.capture-errored`, `console.pg-capture.capture-paused`, `console.pg-capture.quota-exceeded`

Structure mirrors `SubscriptionLifecyclePublisher` (CloudEvents 1.0 envelope).

### 2.7 Environment variables

| Variable | Default | Used by | Description |
|---|---|---|---|
| `PG_CDC_CACHE_TTL_SECONDS` | `30` | pg-cdc-bridge | How often to reload active capture configs |
| `PG_CDC_WAL_KEEP_THRESHOLD_MB` | `512` | pg-cdc-bridge | Pause capture if estimated WAL retention exceeds this |
| `PG_CDC_MAX_EVENTS_PER_SECOND` | `1000` | pg-cdc-bridge | Per-workspace Kafka publish rate limit |
| `PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA` | `10` | provisioning-orchestrator | Default max captured tables per workspace |
| `PG_CAPTURE_DEFAULT_TENANT_QUOTA` | `50` | provisioning-orchestrator | Default max captured tables per tenant |
| `PG_CAPTURE_KAFKA_TOPIC_LIFECYCLE` | `console.pg-capture.lifecycle` | provisioning-orchestrator | Lifecycle audit topic |
| `PG_CDC_KAFKA_BROKERS` | (from platform) | pg-cdc-bridge | Comma-separated Kafka broker list |
| `PG_CDC_KAFKA_CLIENT_ID` | `pg-cdc-bridge` | pg-cdc-bridge | Kafka client identifier |

### 2.8 Kafka topic provisioning

New topics to create via platform topic management (US-EVT-03 conventions):

| Topic | Partitions | Retention | Purpose |
|---|---|---|---|
| `console.pg-capture.lifecycle` | 6 | 30 days | Capture enable/disable/error audit events |
| `{tenantId}.{workspaceId}.pg-changes` | 12 | 7 days (configurable per workspace) | Per-workspace change events |

The per-workspace `pg-changes` topic is created at workspace provisioning time (or lazily on first enable, via `KafkaTopicProvisioner` called from `pg-capture-enable` action).

### 2.9 API contracts (OpenAPI fragments)

**POST `/workspaces/{workspaceId}/pg-captures`**

Request body:
```json
{
  "data_source_ref": "string",
  "schema_name": "public",
  "table_name": "orders"
}
```

Response `201`:
```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "tenant_id": "uuid",
  "data_source_ref": "string",
  "schema_name": "public",
  "table_name": "orders",
  "status": "active",
  "activation_ts": "ISO8601",
  "actor_identity": "string"
}
```

Error codes: `QUOTA_EXCEEDED` (429), `TABLE_NOT_FOUND` (404), `DATA_SOURCE_NOT_ACCESSIBLE` (400), `REPLICATION_SLOT_LIMIT` (503), `CAPTURE_ALREADY_ACTIVE` (409).

**DELETE `/workspaces/{workspaceId}/pg-captures/{captureId}`**

Response `204`.  
Error codes: `CAPTURE_NOT_FOUND` (404), `CAPTURE_ALREADY_DISABLED` (409).

**GET `/workspaces/{workspaceId}/pg-captures`**

Query params: `status` (filter), `page`, `limit`.  
Response `200`: `{ items: [...], total: N }`.

**GET `/tenants/{tenantId}/pg-captures/summary`**

Response `200`: `{ workspaces: [{ workspace_id, active_count, quota_max, tables: [...] }] }`.

---

## 3. Data Model Summary

```
pg_capture_configs
  id, tenant_id, workspace_id, data_source_ref,
  schema_name, table_name, status,
  activation_ts, deactivation_ts,
  actor_identity, last_error, lsn_start,
  created_at, updated_at

pg_capture_quotas
  id, scope (workspace|tenant), scope_id,
  max_tables, created_at, updated_at

pg_capture_audit_log
  id, capture_id→, tenant_id, workspace_id,
  actor_identity, action, before_state (jsonb),
  after_state (jsonb), request_id, created_at
```

**Multi-tenancy isolation**:
- All queries include `tenant_id` and `workspace_id` in WHERE clauses.
- Row-level security (RLS) policies on `pg_capture_configs` and `pg_capture_audit_log` restrict access to matching `tenant_id` (same pattern as other provisioning tables).
- Kafka topic names embed `{tenantId}.{workspaceId}` — cross-workspace routing is structurally impossible.

---

## 4. Test Strategy

### 4.1 Unit tests (`services/pg-cdc-bridge/tests/unit/`)

| Test file | What it covers |
|---|---|
| `WalEventDecoder.test.mjs` | Correct decoding of pgoutput binary for INSERT, UPDATE, DELETE; handles TRUNCATE as no-op; handles missing Relation message gracefully |
| `RouteFilter.test.mjs` | Routes only events for tables with `status = 'active'` configs; workspace isolation (events for workspace A never match workspace B filter); returns null for unconfigured tables |
| `CaptureConfigCache.test.mjs` | Hot-reload on TTL expiry; cache hit avoids DB round-trip; handles DB error gracefully (returns stale cache, logs error) |

### 4.2 Unit tests (`services/provisioning-orchestrator/tests/unit/realtime/`)

| Test file | What it covers |
|---|---|
| `CaptureConfig.test.mjs` | Validation: required fields, invalid status, qualified table name |
| `CaptureConfigRepository.test.mjs` | Quota guard: rejects over-limit, race condition test with concurrent inserts, idempotent create |
| `pg-capture-enable.test.mjs` | Validates JWT, quota check, audit publish, returns correct 201/409/429 |
| `pg-capture-disable.test.mjs` | Status transition, audit publish, 204/404/409 |

### 4.3 Integration tests

**`services/pg-cdc-bridge/tests/integration/pg-capture-to-kafka.integration.test.mjs`**

Requires: local PostgreSQL (logical replication enabled), local Kafka (via Docker Compose or testcontainers).

Scenarios:
1. Enable capture on table `orders` → INSERT row → consume from Kafka topic → assert event structure matches CaptureChangeEvent schema.
2. UPDATE row → assert `event_type = 'update'`, `row_payload` contains new values.
3. DELETE row → assert `event_type = 'delete'`, `row_payload` contains primary key.
4. Disable capture → INSERT row → assert no new event on topic (within 5 s timeout).
5. Bridge restart mid-transaction → assert no event loss (at-least-once; duplicates acceptable).
6. Two workspaces sharing one physical DB → assert events from workspace A never appear on workspace B topic.
7. Concurrent high-volume INSERT (1000 rows) → assert all events published, events for same table arrive in commit order.

### 4.4 Contract tests

- Kafka message schema validated against JSON Schema for `CaptureChangeEvent` (stored as `services/internal-contracts/pg-capture-change-event.schema.json`).
- Lifecycle event schema validated similarly (`pg-capture-lifecycle-event.schema.json`).

### 4.5 Operational validations

- `GET /health` on bridge returns `200` when replication slot is connected and Kafka producer is ready; `503` otherwise.
- `GET /metrics` exposes: `pg_cdc_events_published_total{workspace_id}`, `pg_cdc_publish_lag_seconds{workspace_id}`, `pg_cdc_replication_lag_bytes{data_source_ref}`.

---

## 5. Risks, Mitigations & Edge Cases

| Risk | Impact | Mitigation |
|---|---|---|
| `max_replication_slots` exhaustion | New activations blocked | One slot per physical DB instance (shared across workspaces). Quota limits cap how many workspaces can have active capture. Bridge monitors slot count; rejects `pg-capture-enable` with `REPLICATION_SLOT_LIMIT` (503) when within 2 of limit. |
| WAL retention growth during Kafka outage | Disk exhaustion on PG host | `PG_CDC_WAL_KEEP_THRESHOLD_MB` threshold: bridge pauses capture (status → `paused`) and emits `capture-paused` audit event. Capture resumes automatically when Kafka recovers. |
| DDL change (DROP TABLE / ALTER TABLE) on captured table | Schema mismatch or replication error | `PgWalListener` catches `RELATION_NOT_FOUND` / replication errors per table. Sets `status = 'errored'` in `pg_capture_configs`, emits `capture-errored` audit event, continues processing other tables. Does not crash the bridge (SC-007). |
| High-throughput table flooding Kafka | Consumer lag, topic saturation | `PG_CDC_MAX_EVENTS_PER_SECOND` per-workspace rate limiter in `KafkaChangePublisher`. Excess triggers `quota-exceeded` audit event; optionally pauses capture. |
| Quota race condition: two concurrent enable requests | Over-allocation | `CaptureConfigRepository.create` uses PostgreSQL advisory lock on `(workspace_id, 'pg_capture_quota')` + count-check + INSERT in one transaction. |
| Duplicate events to Kafka during bridge restart | Consumer idempotency burden | Acceptable under at-least-once guarantee. Consumers must handle duplicates (idempotent processing by event `id` UUID or LSN). Document this in consumer guide. |
| Publication creation requires superuser or replication privilege | Bridge cannot self-create publication | Handled at provisioning time (US-PGDATA-01 ensures the platform's replication user has `REPLICATION` privilege). Bridge assumes publication exists; fails with clear `PUBLICATION_NOT_FOUND` error if missing. |

### Rollback strategy

- DDL migration is additive (new tables only) — can be rolled back by dropping the three new tables (no data dependency from existing tables).
- `pg-cdc-bridge` Deployment can be scaled to 0 replicas to disable CDC without affecting other services.
- Capture configs persist in `pg_capture_configs` with `status = 'disabled'` — no data loss on rollback.

---

## 6. Dependencies & Sequencing

### 6.1 Prerequisites before starting implementation

- [ ] Confirm US-DX-01-T01 (channel model) is merged — provides `realtime_channels.kafka_topic_pattern` used for topic resolution.
- [ ] Confirm `wal_level = logical` is set on workspace PostgreSQL instances (US-PGDATA-01 provisioning step).
- [ ] Confirm Kafka topic lifecycle management (US-EVT-03) can create topics on demand or at bootstrap.

### 6.2 Implementation sequence

```
Step 1 — Migration & models (no external deps)
  080-pg-capture-config.sql
  CaptureConfig.mjs, CaptureChangeEvent.mjs

Step 2 — Repositories & quota logic (depends on Step 1)
  CaptureConfigRepository.mjs
  CaptureAuditRepository.mjs
  CaptureQuotaRepository.mjs

Step 3 — OpenWhisk actions (depends on Step 2)
  pg-capture-enable.mjs
  pg-capture-disable.mjs
  pg-capture-list.mjs
  pg-capture-tenant-summary.mjs

Step 4 — Lifecycle publisher (depends on Step 2)
  PgCaptureLifecyclePublisher.mjs

Step 5 — pg-cdc-bridge service (depends on Step 1; parallelizable with Steps 2-4)
  CaptureConfigCache.mjs
  WalEventDecoder.mjs
  RouteFilter.mjs
  PgWalListener.mjs
  KafkaChangePublisher.mjs
  WalListenerManager.mjs
  index.mjs
  HealthServer.mjs + MetricsCollector.mjs

Step 6 — Helm chart for pg-cdc-bridge (depends on Step 5)

Step 7 — Unit & integration tests (parallel with Steps 2-6)

Step 8 — Internal contract schemas (depends on Step 5 interface stabilization)
  internal-contracts/pg-capture-change-event.schema.json
  internal-contracts/pg-capture-lifecycle-event.schema.json

Step 9 — OpenAPI contract update in gateway-config (depends on Step 3)
```

Steps 2–4 and Step 5 can be developed in parallel by separate developers.

---

## 7. Criteria of Done & Expected Evidence

| Criterion | Verification |
|---|---|
| Migration runs cleanly forward and backward | `npm run migrate:up` and `npm run migrate:down` in provisioning-orchestrator succeed without errors |
| `pg-capture-enable` accepts a valid request and returns 201 | Unit test + manual smoke test via `curl` through APISIX |
| INSERT on captured table produces a Kafka event within 30 s | Integration test SC-001 passes |
| Events for same table arrive in commit order | Integration test SC-002: 1000 sequential INSERTs, consumer validates LSN monotonicity |
| No cross-workspace leakage under concurrent load | Integration test SC-003: two workspaces, concurrent mutations, assert topic isolation |
| At-least-once delivery across bridge restart | Integration test SC-004: kill bridge mid-stream, restart, verify no gap in LSN sequence on consumer side |
| Audit record queryable within 30 s of lifecycle operation | Integration test SC-005: enable capture, query `pg_capture_audit_log`, assert row present |
| Quota enforcement — no race-condition over-allocation | Integration test SC-006: 10 concurrent enable requests against quota=5, assert exactly 5 succeed |
| DDL change (table drop) does not cascade to other captures | Integration test SC-007: 2 active captures, DROP TABLE on one, assert other continues normally |
| Bridge `/health` reflects replication slot state | Manual test: stop PG → health returns 503; reconnect → returns 200 |
| All unit tests pass with no skips | `pnpm test` in both `provisioning-orchestrator` and `pg-cdc-bridge` exits 0 |
| OpenAPI spec updated | `gateway-config/openapi.json` includes new paths; CI contract validation passes |
| Kafka schema contract tests pass | `internal-contracts` test suite validates event envelopes against JSON Schema |
| Helm chart deploys to a test namespace | `helm install pg-cdc-bridge ./services/pg-cdc-bridge/helm/pg-cdc-bridge` succeeds without errors |
