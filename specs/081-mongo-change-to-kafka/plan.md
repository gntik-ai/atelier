# Implementation Plan: MongoDB Change Stream Capture → Kafka Realtime Channels

**Plan for**: US-DX-01-T03  
**Feature Branch**: `081-mongo-change-to-kafka`  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Created**: 2026-03-30  
**Status**: Ready for implementation  
**Depends on**: US-DX-01-T01 (channel/subscription model), US-DX-01-T02 (PG CDC patterns), US-MGDATA-02 (MongoDB data source provisioning)

---

## 1. Architecture & Flow

### 1.1 Component topology

```
┌──────────────────────────────────────────────────────────────────┐
│  Workspace MongoDB Replica Set (or Sharded Cluster)              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Change Stream (resumable cursor per active collection)    │  │
│  │  Opened with fullDocument: 'updateLookup' (configurable)   │  │
│  └────────────────────────┬───────────────────────────────────┘  │
└───────────────────────────│──────────────────────────────────────┘
                            │ Change stream events (MongoDB driver)
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  services/mongo-cdc-bridge  (Node.js 20+ ESM, long-running)       │
│                                                                   │
│  ChangeStreamManager ──► ChangeStreamWatcher                      │
│      │                       │                                    │
│      │              ┌────────▼──────────────┐                     │
│      │              │ MongoCaptureConfigCache│                     │
│      │              │ (PostgreSQL-backed,    │                     │
│      │              │  hot-reloadable)       │                     │
│      │              └────────┬──────────────┘                     │
│      │                       │                                    │
│      │              ┌────────▼──────────────┐                     │
│      │              │ MongoChangeEventMapper │                     │
│      │              │ (maps raw change doc   │                     │
│      │              │  to CloudEvents schema)│                     │
│      │              └────────┬──────────────┘                     │
│      │                       │                                    │
│      │              ┌────────▼──────────────────┐                 │
│      │              │ KafkaChangePublisher       │                 │
│      │              │ (kafkajs, at-least-once,   │                 │
│      │              │  idempotent producer)      │                 │
│      │              └────────┬──────────────────┘                 │
│      │                       │                                    │
│   ResumeTokenStore ◄─────────┘  (persists resume tokens to PG)   │
│                                                                   │
│   HealthServer + MetricsCollector (/health, /metrics)             │
└───────────────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────▼──────────────────────────────────────┐
          │  Kafka (per-workspace topics)                          │
          │  Topic: {tenantId}.{workspaceId}.mongo-changes         │
          └─────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────▼──────────────────────────────────────┐
          │  Downstream consumers                                  │
          │  (realtime gateway, webhooks, subscription resolver)   │
          └────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  Management plane (OpenWhisk actions via APISIX)                      │
│  mongo-capture-enable · mongo-capture-disable                         │
│  mongo-capture-list · mongo-capture-tenant-summary                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| CDC mechanism | MongoDB native Change Streams (requires replica set or sharded cluster) | Official API; no oplog tailing; supports resume tokens for reliable resumption; available in MongoDB 3.6+. |
| Stream granularity | One change stream per **active captured collection** within a workspace data source | Fine-grained isolation. Each stream has its own resume token. Streams for the same physical database share one MongoDB driver connection pool. |
| CDC bridge | `services/mongo-cdc-bridge` — Node.js 20+ ESM long-running Kubernetes Deployment | Change streams require persistent cursor connections; incompatible with OpenWhisk short-lived action lifecycle. |
| MongoDB driver | `mongodb` npm package (official driver) | Native change stream + resume token support. |
| Resume token persistence | Stored in `mongo_capture_resume_tokens` PostgreSQL table; updated after each confirmed Kafka publish | Survives bridge restarts. Guarantees at-least-once resumption from last known position. |
| Kafka publication | `kafkajs` (already in stack) with `acks: -1` + idempotent producer | At-least-once, consistent with T02 (pg-cdc-bridge) and platform standard. |
| Topic naming | `{tenantId}.{workspaceId}.mongo-changes` (single topic per workspace, collection as partition key) | Mirrors T02 pattern for consistency; consumers filter by `collection` field in event. |
| Capture config storage | New tables `mongo_capture_configs` and `mongo_capture_quotas` in provisioning-orchestrator PostgreSQL DB | Consistent with T02 repository pattern and existing service boundaries. |
| Capture mode | Configurable per capture: `delta` (default, changed fields only for updates) vs `full-document` (full post-image) | `delta` conserves bandwidth; `full-document` simplifies consumers. Stored in `capture_mode` column. |
| Topology adaptation | Bridge monitors `ChangeStreamInvalidate` events (caused by collection drop, database drop, or shard topology changes); marks capture `errored`; does not crash other streams | Isolation between captures; no cascade failure. |
| Config hot-reload | Bridge polls `mongo_capture_configs` every `MONGO_CDC_CACHE_TTL_SECONDS` (default 30 s) | New activations propagate without bridge restart. |

---

## 2. Artefacts & Changes by Area

### 2.1 PostgreSQL migration

**File**: `services/provisioning-orchestrator/src/migrations/081-mongo-capture-config.sql`

```sql
-- up

-- Capture configuration: which MongoDB collections are captured per workspace
CREATE TABLE IF NOT EXISTS mongo_capture_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  workspace_id      UUID NOT NULL,
  data_source_ref   VARCHAR(255) NOT NULL,   -- provisioned MongoDB data source identifier (from US-MGDATA-02)
  database_name     VARCHAR(128) NOT NULL,
  collection_name   VARCHAR(128) NOT NULL,
  capture_mode      VARCHAR(32)  NOT NULL DEFAULT 'delta'
                      CHECK (capture_mode IN ('delta', 'full-document')),
  status            VARCHAR(32)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','errored','disabled')),
  activation_ts     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deactivation_ts   TIMESTAMPTZ,
  actor_identity    VARCHAR(255) NOT NULL,
  last_error        TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, data_source_ref, database_name, collection_name)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_mongo_capture_workspace
  ON mongo_capture_configs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_mongo_capture_tenant
  ON mongo_capture_configs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_mongo_capture_datasource
  ON mongo_capture_configs (data_source_ref, status);

-- Per-workspace and per-tenant quota ceilings
CREATE TABLE IF NOT EXISTS mongo_capture_quotas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         VARCHAR(16) NOT NULL CHECK (scope IN ('workspace','tenant')),
  scope_id      UUID NOT NULL,           -- workspace_id or tenant_id
  max_collections  INTEGER NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id)
);

-- Resume tokens: persisted after each confirmed Kafka publish
CREATE TABLE IF NOT EXISTS mongo_capture_resume_tokens (
  capture_id    UUID PRIMARY KEY REFERENCES mongo_capture_configs(id) ON DELETE CASCADE,
  resume_token  JSONB NOT NULL,           -- MongoDB resume token object (raw)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log for capture lifecycle events
CREATE TABLE IF NOT EXISTS mongo_capture_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID REFERENCES mongo_capture_configs(id) ON DELETE SET NULL,
  tenant_id       UUID NOT NULL,
  workspace_id    UUID NOT NULL,
  actor_identity  VARCHAR(255) NOT NULL,
  action          VARCHAR(64) NOT NULL,
    -- capture-enabled | capture-disabled | capture-errored
    -- capture-paused | capture-resumed | capture-quota-exceeded
    -- capture-oversized-event | capture-stream-invalidated
  before_state    JSONB,
  after_state     JSONB,
  request_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mongo_capture_audit_workspace
  ON mongo_capture_audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mongo_capture_audit_tenant
  ON mongo_capture_audit_log (tenant_id, created_at DESC);

-- down
DROP TABLE IF EXISTS mongo_capture_audit_log;
DROP TABLE IF EXISTS mongo_capture_resume_tokens;
DROP TABLE IF EXISTS mongo_capture_quotas;
DROP TABLE IF EXISTS mongo_capture_configs;
```

### 2.2 Domain models

**`services/provisioning-orchestrator/src/models/realtime/MongoCaptureConfig.mjs`**

```js
export const CAPTURE_STATUSES = new Set(['active', 'paused', 'errored', 'disabled']);
export const CAPTURE_MODES    = new Set(['delta', 'full-document']);

export class MongoCaptureConfig {
  constructor(attrs) {
    this.id               = attrs.id;
    this.tenant_id        = attrs.tenant_id;
    this.workspace_id     = attrs.workspace_id;
    this.data_source_ref  = attrs.data_source_ref;
    this.database_name    = attrs.database_name;
    this.collection_name  = attrs.collection_name;
    this.capture_mode     = attrs.capture_mode ?? 'delta';
    this.status           = attrs.status ?? 'active';
    this.activation_ts    = attrs.activation_ts ?? null;
    this.deactivation_ts  = attrs.deactivation_ts ?? null;
    this.actor_identity   = attrs.actor_identity;
    this.last_error       = attrs.last_error ?? null;
    this.created_at       = attrs.created_at ?? null;
    this.updated_at       = attrs.updated_at ?? null;
    MongoCaptureConfig.validate(this);
  }

  static validate(attrs) {
    for (const k of ['tenant_id', 'workspace_id', 'data_source_ref', 'database_name', 'collection_name', 'actor_identity']) {
      if (!attrs[k]) throw new Error(`MONGO_CAPTURE_${k.toUpperCase()}_REQUIRED`);
    }
    if (!CAPTURE_STATUSES.has(attrs.status ?? 'active')) throw new Error('INVALID_MONGO_CAPTURE_STATUS');
    if (!CAPTURE_MODES.has(attrs.capture_mode ?? 'delta')) throw new Error('INVALID_MONGO_CAPTURE_MODE');
  }

  qualifiedNs() { return `${this.database_name}.${this.collection_name}`; }

  static fromRow(row) { return new MongoCaptureConfig(row); }
  toJSON() { return { ...this }; }
}
```

**`services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs`**

CloudEvents-compatible change event envelope for MongoDB document mutations:

```js
// Fields:
// specversion ("1.0"), type ("console.mongo-capture.change"), source, id (uuid), time,
// tenantid, workspaceid,
// data: {
//   event_type: "insert" | "update" | "replace" | "delete",
//   database_name, collection_name,
//   document_key: { _id: ... },          // always present
//   capture_mode,                        // "delta" | "full-document"
//   full_document: { ... } | null,       // present for insert, replace, full-document update
//   update_description: { updatedFields, removedFields } | null,  // present for delta update
//   cluster_time: ISO8601,               // MongoDB clusterTime of the operation
//   capture_config_id,
//   wall_time: ISO8601                   // wallTime from change stream event (MongoDB 6+)
// }
```

### 2.3 Repositories

**`services/provisioning-orchestrator/src/repositories/realtime/MongoCaptureConfigRepository.mjs`**

Operations:
- `create(config)` — INSERT with quota guard (PostgreSQL advisory lock on `(workspace_id, 'mongo_capture_quota')` + count check in one transaction). Returns existing row on `ON CONFLICT` if already active (`CAPTURE_ALREADY_ACTIVE`).
- `findActive(dataSourceRef)` — list all `status = 'active'` entries for a data source ref (used by bridge hot-reload).
- `findByWorkspace(tenantId, workspaceId, status?)` — workspace admin list.
- `findByTenantSummary(tenantId)` — per-workspace counts for tenant owner view.
- `updateStatus(id, status, { lastError, deactivationTs, actorIdentity })` — lifecycle transitions.
- `disable(id, actorIdentity)` — sets `status = 'disabled'`, stamps `deactivation_ts`.

**`services/provisioning-orchestrator/src/repositories/realtime/MongoCaptureAuditRepository.mjs`**

- `append(auditRow)` — mirrors existing `AuditRepository.append` signature; writes to `mongo_capture_audit_log`.

**`services/provisioning-orchestrator/src/repositories/realtime/MongoCaptureQuotaRepository.mjs`**

- `getQuota(scope, scopeId)` — returns quota row or null (system default applied by caller).
- `countActive(scope, scopeId)` — returns current active capture count.
- `upsert(scope, scopeId, maxCollections)` — admin configuration.

**`services/provisioning-orchestrator/src/repositories/realtime/MongoResumeTokenRepository.mjs`**

- `upsert(captureId, resumeToken)` — persists latest resume token after confirmed Kafka publish.
- `get(captureId)` — returns stored resume token for bridge startup.
- `delete(captureId)` — called when a capture is permanently disabled.

### 2.4 OpenWhisk actions (management plane)

All actions follow existing patterns: ESM `.mjs`, Keycloak JWT validation from `params.__ow_headers.authorization`, structured error responses, mirroring T02 action conventions.

| File | HTTP Method | Path (APISIX) | Purpose |
|---|---|---|---|
| `actions/realtime/mongo-capture-enable.mjs` | POST | `/workspaces/:wsId/mongo-captures` | Enable capture on a collection |
| `actions/realtime/mongo-capture-disable.mjs` | DELETE | `/workspaces/:wsId/mongo-captures/:captureId` | Disable an active capture |
| `actions/realtime/mongo-capture-list.mjs` | GET | `/workspaces/:wsId/mongo-captures` | List captures in workspace |
| `actions/realtime/mongo-capture-tenant-summary.mjs` | GET | `/tenants/:tenantId/mongo-captures/summary` | Tenant-level summary |

**`mongo-capture-enable.mjs` logic**:
1. Validate JWT — extract `workspace_id`, `tenant_id`, `actor_identity` from token claims.
2. Verify collection exists in the workspace's provisioned MongoDB data source (lookup against US-MGDATA-02 data source registry or attempt a MongoDB `listCollections` probe).
3. Check workspace + tenant quotas via `MongoCaptureQuotaRepository`. Reject with `QUOTA_EXCEEDED` (429) if over limit.
4. INSERT into `mongo_capture_configs` (idempotent: ON CONFLICT returns existing if already active with `409 CAPTURE_ALREADY_ACTIVE`).
5. Append audit entry (PostgreSQL + Kafka `console.mongo-capture.lifecycle`).
6. Return `201 Created` with capture config JSON.

**`mongo-capture-disable.mjs` logic**:
1. Validate JWT + ownership (workspace/tenant scope).
2. Load existing config; reject if already disabled (`409 CAPTURE_ALREADY_DISABLED`).
3. Update `status = 'disabled'`, stamp `deactivation_ts`.
4. Delete resume token from `mongo_capture_resume_tokens`.
5. Append audit entry.
6. Return `204 No Content`.

### 2.5 CDC Bridge service

**New service**: `services/mongo-cdc-bridge/`

```
services/mongo-cdc-bridge/
├── package.json              (type: "module", deps: mongodb, kafkajs, pg)
├── src/
│   ├── index.mjs             (entry point — starts ChangeStreamManager)
│   ├── ChangeStreamManager.mjs    (orchestrates all active streams; hot-reloads config)
│   ├── ChangeStreamWatcher.mjs    (one instance per active mongo_capture_configs row;
│   │                               opens MongoDB change stream, handles invalidation)
│   ├── MongoChangeEventMapper.mjs (maps raw MongoDB change stream doc to MongoChangeEvent
│   │                               CloudEvents schema; handles delta vs full-document mode)
│   ├── MongoCaptureConfigCache.mjs (polls mongo_capture_configs every CACHE_TTL_SECONDS;
│   │                                hot-reloadable; starts/stops ChangeStreamWatchers)
│   ├── ResumeTokenStore.mjs   (reads/writes mongo_capture_resume_tokens via pg)
│   ├── KafkaChangePublisher.mjs (kafkajs producer, at-least-once, idempotent mode)
│   ├── HealthServer.mjs       (HTTP /health, /metrics endpoints)
│   └── MetricsCollector.mjs   (events published, lag, error counts per workspace)
├── tests/
│   ├── unit/
│   │   ├── MongoChangeEventMapper.test.mjs
│   │   ├── MongoCaptureConfigCache.test.mjs
│   │   └── ResumeTokenStore.test.mjs
│   └── integration/
│       └── mongo-capture-to-kafka.integration.test.mjs
└── helm/
    └── mongo-cdc-bridge/
        ├── Chart.yaml
        └── templates/
            ├── deployment.yaml
            ├── configmap.yaml
            └── service.yaml
```

#### ChangeStreamManager — orchestration logic

Startup sequence:
1. Load `MongoCaptureConfigCache` (initial DB load).
2. For each `status = 'active'` capture config, look up resume token from `ResumeTokenStore`, then start a `ChangeStreamWatcher`.
3. Schedule hot-reload timer (every `MONGO_CDC_CACHE_TTL_SECONDS`): diff new config against running watchers; start new ones, stop removed ones.

#### ChangeStreamWatcher — key implementation notes

```js
// Opens a MongoDB change stream for a single (database, collection) pair:
const collection = mongoClient.db(database_name).collection(collection_name);
const pipeline = [{ $match: { 'operationType': { $in: ['insert','update','replace','delete'] } } }];
const options = {
  fullDocument: capture_mode === 'full-document' ? 'updateLookup' : 'whenAvailable',
  resumeAfter: storedResumeToken ?? undefined,
  startAtOperationTime: storedResumeToken ? undefined : startOperationTime
};
const stream = collection.watch(pipeline, options);
```

- **Event processing loop**: for each change event:
  1. Map to `MongoChangeEvent` via `MongoChangeEventMapper`.
  2. Check Kafka message size. If > `MONGO_CDC_MAX_MESSAGE_BYTES`, emit `capture-oversized-event` audit entry and publish reference event instead.
  3. Publish to Kafka via `KafkaChangePublisher` (`await producer.send(...)`).
  4. After confirmed Kafka ack, persist resume token via `ResumeTokenStore.upsert`.
- **`ChangeStreamInvalidate` handling**: catches `ChangeStreamInvalidateError`; calls `MongoCaptureConfigRepository.updateStatus(id, 'errored', { lastError })` and emits `capture-stream-invalidated` audit entry; stops this watcher without affecting others.
- **Reconnection on transient failure**: exponential backoff (1 s → 2 s → 4 s ... max 60 s); retries up to `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` (default 10) before marking capture as `errored`.
- **Topology changes (sharded cluster)**: MongoDB driver handles transparent cursor migration across shard topology changes. Bridge detects `ChangeStreamInvalidate` if a shard becomes permanently unavailable; marks capture `errored` and audits.

#### KafkaChangePublisher — topic and message format

Topic: resolved from `realtime_channels.kafka_topic_pattern` for the workspace's `mongodb-changes` channel (T01 channel model). Fallback pattern: `{tenantId}.{workspaceId}.mongo-changes`.

Partition key: `{workspaceId}:{database_name}.{collection_name}` — ensures per-collection ordering within a workspace.

Message value: CloudEvents JSON envelope (MongoChangeEvent schema, §2.2).

Message headers:
```
ce-type:          console.mongo-capture.change
ce-source:        /data-sources/{dataSourceRef}/collections/{database}.{collection}
ce-tenantid:      {tenantId}
ce-workspaceid:   {workspaceId}
```

#### ResumeTokenStore — persistence strategy

Resume token is persisted **after** `producer.send()` resolves. If the bridge crashes between receiving a change event and persisting the token, the change stream will re-deliver the event on restart (at-least-once). Consumers must handle duplicates by `event.id` UUID.

### 2.6 Lifecycle audit events to Kafka

**`services/provisioning-orchestrator/src/events/realtime/MongoCaptureLifecyclePublisher.mjs`**

Topic: `console.mongo-capture.lifecycle` (retention: 30 days)  
Event types:
- `console.mongo-capture.capture-enabled`
- `console.mongo-capture.capture-disabled`
- `console.mongo-capture.capture-errored`
- `console.mongo-capture.capture-paused`
- `console.mongo-capture.capture-resumed`
- `console.mongo-capture.quota-exceeded`
- `console.mongo-capture.oversized-event`
- `console.mongo-capture.stream-invalidated`

Structure: CloudEvents 1.0 envelope, mirrors `PgCaptureLifecyclePublisher` (T02).

### 2.7 Environment variables

| Variable | Default | Used by | Description |
|---|---|---|---|
| `MONGO_CDC_CACHE_TTL_SECONDS` | `30` | mongo-cdc-bridge | How often to reload active capture configs from PostgreSQL |
| `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` | `10` | mongo-cdc-bridge | Max retries on transient change stream failure before marking errored |
| `MONGO_CDC_MAX_MESSAGE_BYTES` | `900000` | mongo-cdc-bridge | Kafka message size limit (bytes); oversized events publish reference event |
| `MONGO_CDC_MAX_EVENTS_PER_SECOND` | `1000` | mongo-cdc-bridge | Per-workspace Kafka publish rate limit |
| `MONGO_CAPTURE_DEFAULT_WORKSPACE_QUOTA` | `10` | provisioning-orchestrator | Default max captured collections per workspace |
| `MONGO_CAPTURE_DEFAULT_TENANT_QUOTA` | `50` | provisioning-orchestrator | Default max captured collections per tenant |
| `MONGO_CAPTURE_KAFKA_TOPIC_LIFECYCLE` | `console.mongo-capture.lifecycle` | provisioning-orchestrator | Lifecycle audit topic |
| `MONGO_CDC_KAFKA_BROKERS` | (from platform) | mongo-cdc-bridge | Comma-separated Kafka broker list |
| `MONGO_CDC_KAFKA_CLIENT_ID` | `mongo-cdc-bridge` | mongo-cdc-bridge | Kafka client identifier |
| `MONGO_CDC_PG_CONNECTION_STRING` | (from platform) | mongo-cdc-bridge | PostgreSQL connection for config cache + resume token store |

### 2.8 Kafka topic provisioning

New topics to create via platform topic management (US-EVT-03 conventions):

| Topic | Partitions | Retention | Purpose |
|---|---|---|---|
| `console.mongo-capture.lifecycle` | 6 | 30 days | Capture enable/disable/error audit events |
| `{tenantId}.{workspaceId}.mongo-changes` | 12 | 7 days (configurable) | Per-workspace MongoDB change events |

The per-workspace `mongo-changes` topic is created at workspace provisioning time or lazily on first enable via `KafkaTopicProvisioner` called from `mongo-capture-enable` action (same pattern as T02).

### 2.9 API contracts (OpenAPI fragments)

**POST `/workspaces/{workspaceId}/mongo-captures`**

Request body:
```json
{
  "data_source_ref": "string",
  "database_name": "mydb",
  "collection_name": "products",
  "capture_mode": "delta"
}
```

Response `201`:
```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "tenant_id": "uuid",
  "data_source_ref": "string",
  "database_name": "mydb",
  "collection_name": "products",
  "capture_mode": "delta",
  "status": "active",
  "activation_ts": "ISO8601",
  "actor_identity": "string"
}
```

Error codes: `QUOTA_EXCEEDED` (429), `COLLECTION_NOT_FOUND` (404), `DATA_SOURCE_NOT_ACCESSIBLE` (400), `REPLICA_SET_REQUIRED` (400), `CAPTURE_ALREADY_ACTIVE` (409).

**DELETE `/workspaces/{workspaceId}/mongo-captures/{captureId}`**

Response `204`.  
Error codes: `CAPTURE_NOT_FOUND` (404), `CAPTURE_ALREADY_DISABLED` (409).

**GET `/workspaces/{workspaceId}/mongo-captures`**

Query params: `status` (filter), `page`, `limit`.  
Response `200`: `{ items: [...], total: N }`.

**GET `/tenants/{tenantId}/mongo-captures/summary`**

Response `200`: `{ workspaces: [{ workspace_id, active_count, quota_max, collections: [...] }] }`.

---

## 3. Data Model Summary

```
mongo_capture_configs
  id, tenant_id, workspace_id, data_source_ref,
  database_name, collection_name, capture_mode,
  status, activation_ts, deactivation_ts,
  actor_identity, last_error,
  created_at, updated_at

mongo_capture_quotas
  id, scope (workspace|tenant), scope_id,
  max_collections, created_at, updated_at

mongo_capture_resume_tokens
  capture_id → mongo_capture_configs.id (PK + FK),
  resume_token (JSONB), updated_at

mongo_capture_audit_log
  id, capture_id→, tenant_id, workspace_id,
  actor_identity, action, before_state (jsonb),
  after_state (jsonb), request_id, created_at
```

**Multi-tenancy isolation**:
- All PostgreSQL queries include `tenant_id` and `workspace_id` predicates (never lookup by capture_id alone).
- Row-level security policies on `mongo_capture_configs` and `mongo_capture_audit_log` restrict reads to matching `tenant_id`.
- Kafka topic names embed `{tenantId}.{workspaceId}` — structural cross-workspace routing is impossible.
- MongoDB connections are per-data-source-ref (not shared across tenants); workspace identity is enforced at config lookup time, not MongoDB RBAC (MongoDB RBAC enforcement is a US-MGDATA-02 concern).

---

## 4. Test Strategy

### 4.1 Unit tests (`services/mongo-cdc-bridge/tests/unit/`)

| Test file | What it covers |
|---|---|
| `MongoChangeEventMapper.test.mjs` | Correct mapping of MongoDB change stream documents for `insert`, `update` (delta and full-document modes), `replace`, `delete`; handles missing `fullDocument` gracefully (e.g. for delete); maps `clusterTime` and `wallTime`; maps `documentKey._id` correctly for ObjectId, string, and composite keys |
| `MongoCaptureConfigCache.test.mjs` | Hot-reload on TTL expiry; cache hit avoids DB round-trip; handles DB error gracefully (returns stale cache, logs error); correctly diffs new/removed configs and emits add/remove signals |
| `ResumeTokenStore.test.mjs` | Upsert persists token; get returns stored token; get returns null for missing capture; delete removes token |

### 4.2 Unit tests (`services/provisioning-orchestrator/tests/unit/realtime/`)

| Test file | What it covers |
|---|---|
| `MongoCaptureConfig.test.mjs` | Validation: required fields, invalid status, invalid capture_mode, qualified namespace |
| `MongoCaptureConfigRepository.test.mjs` | Quota guard: rejects over-limit, race condition test with concurrent inserts, idempotent create (ON CONFLICT) |
| `mongo-capture-enable.test.mjs` | Validates JWT, quota check, audit publish, returns correct 201/409/429 |
| `mongo-capture-disable.test.mjs` | Status transition, resume token deletion, audit publish, 204/404/409 |

### 4.3 Integration tests

**`services/mongo-cdc-bridge/tests/integration/mongo-capture-to-kafka.integration.test.mjs`**

Requires: local MongoDB replica set (e.g. `mongodb://localhost:27017/?replicaSet=rs0`), local Kafka (Docker Compose or testcontainers), local PostgreSQL for config/token store.

Scenarios:
1. Enable capture on collection `products` → INSERT document → consume from Kafka topic → assert CloudEvents envelope matches `MongoChangeEvent` schema.
2. UPDATE document (delta mode) → assert `event_type = 'update'`, `update_description` contains changed fields, `full_document` is null.
3. UPDATE document (full-document mode) → assert `full_document` contains post-image.
4. REPLACE document → assert `event_type = 'replace'`, `full_document` contains replacement document.
5. DELETE document → assert `event_type = 'delete'`, `document_key` present, `full_document` null.
6. Disable capture → INSERT document → assert no new event on topic within 5 s timeout.
7. Bridge restart mid-stream → assert no event loss (at-least-once; duplicates acceptable; verify by resume token continuity).
8. Two workspaces sharing one MongoDB cluster → assert events from workspace A never appear on workspace B topic.
9. Concurrent high-volume INSERT (500 documents) → assert all events published; events for same collection maintain insertion order within partition.
10. `ChangeStreamInvalidate` (collection drop while active) → assert capture marked `errored`; assert other active captures on same data source continue unaffected.
11. Quota enforcement: attempt to enable capture beyond workspace quota → assert `QUOTA_EXCEEDED` returned; assert `mongo_capture_configs` row count not exceeded.
12. Oversized document mutation exceeding `MONGO_CDC_MAX_MESSAGE_BYTES` → assert reference event published; assert `capture-oversized-event` audit log entry present.

### 4.4 Contract tests

- Kafka message schema validated against JSON Schema stored as:
  - `services/internal-contracts/mongo-capture-change-event.schema.json`
  - `services/internal-contracts/mongo-capture-lifecycle-event.schema.json`
- Schemas align with CloudEvents 1.0 + domain-specific `data` fields.

### 4.5 Operational validations

- `GET /health` returns `200` when all active change stream watchers are connected and Kafka producer is ready; `503` otherwise (with details on which captures are unhealthy).
- `GET /metrics` exposes:
  - `mongo_cdc_events_published_total{workspace_id, collection}`
  - `mongo_cdc_publish_lag_seconds{workspace_id}` (wall time from `clusterTime` to Kafka ack)
  - `mongo_cdc_watcher_error_count{workspace_id, capture_id}`
  - `mongo_cdc_active_streams_gauge`

---

## 5. Risks, Mitigations & Edge Cases

| Risk | Impact | Mitigation |
|---|---|---|
| MongoDB not running as replica set | Change streams unavailable (`CHANGE_STREAM_NOT_SUPPORTED`) | `mongo-capture-enable` probes `hello` command on data source; rejects with `REPLICA_SET_REQUIRED` (400) if standalone. US-MGDATA-02 should enforce replica set topology at provisioning time. |
| Collection dropped while capture active | `ChangeStreamInvalidate` event; no further events | `ChangeStreamWatcher` catches `ChangeStreamInvalidateError`; marks capture `errored`; emits `capture-stream-invalidated` audit event; stops only this watcher. Other watchers unaffected. |
| Replica set primary election | Transient cursor disconnect | MongoDB driver reconnects automatically and resumes stream from last resume token. Bridge adds exponential backoff + retry count. Falls back to `errored` status after `MONGO_CDC_MAX_RECONNECT_ATTEMPTS`. |
| Kafka broker temporarily unavailable | Buffered events and/or delivery delay | Bridge pauses event processing (cursor not advanced, no `clusterTime` acknowledge) until Kafka producer recovers. Resume token only updated post-Kafka-ack. Event replay via resume token when Kafka recovers. |
| Oversized document (event exceeds Kafka message size limit) | Event dropped silently | Bridge checks event size before publish. Publishes lightweight reference event: `{ event_type, collection_name, document_key, capture_config_id, reason: "oversized" }`. Records `capture-oversized-event` audit entry. |
| Sharded cluster topology change | Change stream may be re-established | MongoDB driver handles shard migrations transparently via resume token. If stream is invalidated due to permanent topology change, bridge marks capture `errored` and audits. |
| Resume token clock skew after extended downtime | Resume token may have expired (oplog rolled over) | Bridge detects `ChangeStreamHistoryLost` error; marks capture `errored`; records audit event with `reason: "oplog-rollover"`. Admin must re-enable capture (new start position). |
| High-throughput collection flooding Kafka | Consumer lag, topic saturation | `MONGO_CDC_MAX_EVENTS_PER_SECOND` per-workspace rate limiter in `KafkaChangePublisher`. Excess triggers `capture-paused` audit event; capture auto-resumes when throughput drops (configurable cooldown). |
| Quota race condition (concurrent enable requests) | Over-allocation | `MongoCaptureConfigRepository.create` uses PostgreSQL advisory lock on `(workspace_id, 'mongo_capture_quota')` + count check + INSERT in one transaction. |
| Duplicate events to Kafka on bridge restart | Consumer idempotency burden | Acceptable under at-least-once guarantee. Consumers must handle duplicates by `event.id` UUID. Document in consumer guide. |

### Rollback strategy

- DDL migration is additive (four new tables) — can be rolled back by dropping them in reverse dependency order. No foreign keys into existing tables (additive only).
- `mongo-cdc-bridge` Kubernetes Deployment can be scaled to 0 replicas to disable all MongoDB CDC without affecting other services.
- Capture configs persist in `mongo_capture_configs` with `status = 'disabled'` — no data loss on rollback.
- Resume tokens in `mongo_capture_resume_tokens` are FK-cascade-deleted when a capture is deleted; no orphan cleanup needed.

---

## 6. Dependencies & Sequencing

### 6.1 Prerequisites before starting implementation

- [ ] Confirm US-DX-01-T01 (channel model) provides `realtime_channels` table with `mongodb-changes` channel type and `kafka_topic_pattern` for MongoDB data sources.
- [ ] Confirm US-DX-01-T02 (pg-cdc-bridge) patterns are established — this task mirrors those patterns for MongoDB; shared patterns should be stable before reuse.
- [ ] Confirm US-MGDATA-02 provisions MongoDB data sources as replica sets (or sharded cluster with replica set shards) — change streams require this topology.
- [ ] Confirm Kafka topic lifecycle management (US-EVT-03) can create topics on demand or at workspace bootstrap.
- [ ] MongoDB npm driver (`mongodb` package) available in the `services/mongo-cdc-bridge` workspace.

### 6.2 Implementation sequence

```
Step 1 — Migration & models (no external deps)
  081-mongo-capture-config.sql
  MongoCaptureConfig.mjs, MongoChangeEvent.mjs

Step 2 — Repositories (depends on Step 1)
  MongoCaptureConfigRepository.mjs
  MongoCaptureAuditRepository.mjs
  MongoCaptureQuotaRepository.mjs
  MongoResumeTokenRepository.mjs

Step 3 — OpenWhisk actions (depends on Step 2)
  mongo-capture-enable.mjs
  mongo-capture-disable.mjs
  mongo-capture-list.mjs
  mongo-capture-tenant-summary.mjs

Step 4 — Lifecycle publisher (depends on Step 2)
  MongoCaptureLifecyclePublisher.mjs

Step 5 — mongo-cdc-bridge service (depends on Step 1; parallelizable with Steps 2-4)
  MongoCaptureConfigCache.mjs
  ResumeTokenStore.mjs
  MongoChangeEventMapper.mjs
  ChangeStreamWatcher.mjs
  ChangeStreamManager.mjs
  KafkaChangePublisher.mjs
  index.mjs
  HealthServer.mjs + MetricsCollector.mjs

Step 6 — Helm chart for mongo-cdc-bridge (depends on Step 5)

Step 7 — Unit & integration tests (parallel with Steps 2-6)

Step 8 — Internal contract schemas (depends on Step 5 interface stabilization)
  internal-contracts/mongo-capture-change-event.schema.json
  internal-contracts/mongo-capture-lifecycle-event.schema.json

Step 9 — OpenAPI contract update in gateway-config (depends on Step 3)
```

Steps 2–4 and Step 5 can be developed in parallel by separate developers once Step 1 is complete.

---

## 7. Criteria of Done & Expected Evidence

| Criterion | Verification |
|---|---|
| Migration runs cleanly forward and backward | `npm run migrate:up` and `npm run migrate:down` in provisioning-orchestrator succeed without errors; all four tables created and dropped cleanly |
| `mongo-capture-enable` accepts a valid request and returns 201 | Unit test + manual smoke test via `curl` through APISIX |
| INSERT on captured collection produces a Kafka event within 5 s | Integration test scenario 1 passes (SC-001) |
| UPDATE event in delta mode contains `update_description` without `full_document` | Integration test scenario 2 passes |
| UPDATE event in full-document mode contains `full_document` | Integration test scenario 3 passes |
| DELETE event contains `document_key` | Integration test scenario 5 passes |
| No cross-workspace leakage under concurrent load | Integration test scenario 8: two workspaces, concurrent mutations, assert topic isolation (SC-006) |
| At-least-once delivery across bridge restart | Integration test scenario 7: kill bridge mid-stream, restart, verify no gap via resume token continuity |
| `ChangeStreamInvalidate` does not cascade to other active captures | Integration test scenario 10: drop collection, assert other capture continues (SC-004 analog) |
| Audit record queryable within 30 s of lifecycle operation | Integration test: enable capture, query `mongo_capture_audit_log`, assert row present with correct action and actor (SC-002) |
| Quota enforcement — no race-condition over-allocation | Integration test scenario 11: concurrent enable requests against quota, assert exactly quota-max succeed |
| Oversized event produces reference event + audit log | Integration test scenario 12 |
| Bridge `/health` reflects stream health | Manual test: stop MongoDB → health returns 503; reconnect → returns 200 |
| All unit tests pass with no skips | `pnpm test` in both `provisioning-orchestrator` and `mongo-cdc-bridge` exits 0 |
| OpenAPI spec updated | `gateway-config/openapi.json` includes new `/mongo-captures` paths; CI contract validation passes |
| Kafka schema contract tests pass | `internal-contracts` test suite validates event envelopes against JSON Schema |
| Helm chart deploys to test namespace | `helm install mongo-cdc-bridge ./services/mongo-cdc-bridge/helm/mongo-cdc-bridge` succeeds without errors |
| 50 simultaneous active captures without latency degradation | Load test or integration test with 50 concurrent watchers publishing events (SC-003) |
