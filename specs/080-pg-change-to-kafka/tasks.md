# Tasks: US-DX-01-T02 — PostgreSQL Change Data Capture → Kafka

**Feature Branch**: `080-pg-change-to-kafka`  
**Epic**: EP-17 / US-DX-01 / US-DX-01-T02  
**Created**: 2026-03-30  
**Status**: Ready for implementation  
**Inputs**: spec.md, plan.md  
**Scope**: Implementation tasks only — no PR, merge, or deploy steps.

---

## Task Index

| # | ID | Area | File(s) touched | Depends on |
|---|-----|------|-----------------|------------|
| 1 | T02-01 | Migration | `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql` | — |
| 2 | T02-02 | Domain models | `services/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs` | T02-01 |
| 3 | T02-03 | Domain models | `services/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs` | T02-01 |
| 4 | T02-04 | Repository | `services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs` | T02-02 |
| 5 | T02-05 | Repository | `services/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs` | T02-01 |
| 6 | T02-06 | Repository | `services/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs` | T02-01 |
| 7 | T02-07 | Event publisher | `services/provisioning-orchestrator/src/events/realtime/PgCaptureLifecyclePublisher.mjs` | T02-05 |
| 8 | T02-08 | Action | `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs` | T02-04, T02-06, T02-07 |
| 9 | T02-09 | Action | `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs` | T02-04, T02-07 |
| 10 | T02-10 | Action | `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs` | T02-04 |
| 11 | T02-11 | Action | `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs` | T02-04, T02-06 |
| 12 | T02-12 | Bridge service | `services/pg-cdc-bridge/package.json` | — |
| 13 | T02-13 | Bridge service | `services/pg-cdc-bridge/src/CaptureConfigCache.mjs` | T02-01, T02-12 |
| 14 | T02-14 | Bridge service | `services/pg-cdc-bridge/src/WalEventDecoder.mjs` | T02-12 |
| 15 | T02-15 | Bridge service | `services/pg-cdc-bridge/src/RouteFilter.mjs` | T02-13, T02-14 |
| 16 | T02-16 | Bridge service | `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs` | T02-03, T02-12 |
| 17 | T02-17 | Bridge service | `services/pg-cdc-bridge/src/PgWalListener.mjs` | T02-14, T02-15, T02-16 |
| 18 | T02-18 | Bridge service | `services/pg-cdc-bridge/src/WalListenerManager.mjs` | T02-13, T02-17 |
| 19 | T02-19 | Bridge service | `services/pg-cdc-bridge/src/HealthServer.mjs` | T02-18 |
| 20 | T02-20 | Bridge service | `services/pg-cdc-bridge/src/MetricsCollector.mjs` | T02-18 |
| 21 | T02-21 | Bridge service | `services/pg-cdc-bridge/src/index.mjs` | T02-18, T02-19, T02-20 |
| 22 | T02-22 | Helm chart | `services/pg-cdc-bridge/helm/pg-cdc-bridge/Chart.yaml` | T02-12 |
| 23 | T02-23 | Helm chart | `services/pg-cdc-bridge/helm/pg-cdc-bridge/values.yaml` | T02-22 |
| 24 | T02-24 | Helm chart | `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/deployment.yaml` | T02-22, T02-23 |
| 25 | T02-25 | Helm chart | `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/configmap.yaml` | T02-22 |
| 26 | T02-26 | Helm chart | `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/service.yaml` | T02-22 |
| 27 | T02-27 | Contracts | `services/internal-contracts/src/pg-capture-change-event.json` | T02-03 |
| 28 | T02-28 | Contracts | `services/internal-contracts/src/pg-capture-lifecycle-event.json` | T02-07 |
| 29 | T02-29 | Gateway config | `services/gateway-config/base/public-api-routing.yaml` | T02-08, T02-09, T02-10, T02-11 |
| 30 | T02-30 | Unit tests | `services/pg-cdc-bridge/tests/unit/WalEventDecoder.test.mjs` | T02-14 |
| 31 | T02-31 | Unit tests | `services/pg-cdc-bridge/tests/unit/RouteFilter.test.mjs` | T02-15 |
| 32 | T02-32 | Unit tests | `services/pg-cdc-bridge/tests/unit/CaptureConfigCache.test.mjs` | T02-13 |
| 33 | T02-33 | Unit tests | `services/provisioning-orchestrator/tests/unit/realtime/CaptureConfig.test.mjs` | T02-02 |
| 34 | T02-34 | Unit tests | `services/provisioning-orchestrator/tests/unit/realtime/CaptureConfigRepository.test.mjs` | T02-04 |
| 35 | T02-35 | Unit tests | `services/provisioning-orchestrator/tests/unit/realtime/pg-capture-enable.test.mjs` | T02-08 |
| 36 | T02-36 | Unit tests | `services/provisioning-orchestrator/tests/unit/realtime/pg-capture-disable.test.mjs` | T02-09 |
| 37 | T02-37 | Integration test | `services/pg-cdc-bridge/tests/integration/pg-capture-to-kafka.integration.test.mjs` | T02-21 |

---

## Detailed Tasks

### T02-01 · PostgreSQL migration — pg capture tables

**File**: `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql`  
**Depends on**: —  
**Acceptance**: Migration runs forward and backward without errors. `pg_capture_configs`, `pg_capture_quotas`, and `pg_capture_audit_log` exist with all specified columns and indexes after `migrate:up`. All three tables are absent after `migrate:down`.

**What to implement**:
- `pg_capture_configs` table: `id UUID PK`, `tenant_id UUID NOT NULL`, `workspace_id UUID NOT NULL`, `data_source_ref VARCHAR(255) NOT NULL`, `schema_name VARCHAR(128) NOT NULL DEFAULT 'public'`, `table_name VARCHAR(128) NOT NULL`, `status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','errored','disabled'))`, `activation_ts TIMESTAMPTZ NOT NULL DEFAULT now()`, `deactivation_ts TIMESTAMPTZ`, `actor_identity VARCHAR(255) NOT NULL`, `last_error TEXT`, `lsn_start PG_LSN`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Unique constraint: `(workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE`.
- Indexes: `idx_pg_capture_workspace (workspace_id, status)`, `idx_pg_capture_tenant (tenant_id, status)`, `idx_pg_capture_datasource (data_source_ref, status)`.
- `pg_capture_quotas` table: `id UUID PK`, `scope VARCHAR(16) NOT NULL CHECK (scope IN ('workspace','tenant'))`, `scope_id UUID NOT NULL`, `max_tables INTEGER NOT NULL DEFAULT 10`, `created_at`, `updated_at`. Unique on `(scope, scope_id)`.
- `pg_capture_audit_log` table: `id UUID PK`, `capture_id UUID REFERENCES pg_capture_configs(id) ON DELETE SET NULL`, `tenant_id UUID NOT NULL`, `workspace_id UUID NOT NULL`, `actor_identity VARCHAR(255) NOT NULL`, `action VARCHAR(64) NOT NULL`, `before_state JSONB`, `after_state JSONB`, `request_id UUID`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Indexes on audit log: `idx_pg_capture_audit_workspace (workspace_id, created_at DESC)`, `idx_pg_capture_audit_tenant (tenant_id, created_at DESC)`.
- Down section: `DROP TABLE IF EXISTS pg_capture_audit_log; DROP TABLE IF EXISTS pg_capture_quotas; DROP TABLE IF EXISTS pg_capture_configs;`.

---

### T02-02 · Domain model — CaptureConfig

**File**: `services/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs`  
**Depends on**: T02-01  
**Acceptance**: Unit test T02-33 passes. `CaptureConfig.validate()` throws named errors for missing required fields and invalid status. `qualifiedTable()` returns `schema.table`.

**What to implement** (ESM `.mjs`, matches existing model patterns in `ChannelType.mjs`, `Subscription.mjs`):
- Export `CAPTURE_STATUSES = new Set(['active', 'paused', 'errored', 'disabled'])`.
- `CaptureConfig` class with constructor receiving attrs, static `validate(attrs)`, static `fromRow(row)`, instance `qualifiedTable()`, `toJSON()`.
- Required fields validated: `tenant_id`, `workspace_id`, `data_source_ref`, `table_name`, `actor_identity`. Errors: `CAPTURE_{FIELD}_REQUIRED`.
- Status validated against `CAPTURE_STATUSES`; error `INVALID_CAPTURE_STATUS`.
- Default `schema_name = 'public'`, `status = 'active'`.

---

### T02-03 · Domain model — CaptureChangeEvent

**File**: `services/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs`  
**Depends on**: T02-01  
**Acceptance**: The event factory produces a valid CloudEvents 1.0 envelope. T02-27 schema validates against instances produced by this class.

**What to implement**:
- Export `CaptureChangeEvent` class and `EVENT_TYPES = new Set(['insert', 'update', 'delete'])`.
- Constructor/factory `CaptureChangeEvent.create({ eventType, schema, table, lsn, committedAt, rowPayload, captureConfigId, workspaceId, tenantId, sequence })`.
- CloudEvents envelope fields: `specversion = '1.0'`, `type = 'console.pg-capture.change'`, `source = '/data-sources/{dataSourceRef}/tables/{schema}.{table}'`, `id` (generated UUIDv4), `time` (ISO8601), `tenantid`, `workspaceid`.
- `data` sub-object: `{ event_type, schema, table, lsn, committed_at, row_payload, capture_config_id, sequence }`.
- Static `fromKafkaMessage(msg)` for consumer-side parsing.
- Validates `event_type` is in `EVENT_TYPES`; throws `INVALID_CHANGE_EVENT_TYPE` otherwise.

---

### T02-04 · Repository — CaptureConfigRepository

**File**: `services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs`  
**Depends on**: T02-02  
**Acceptance**: Unit test T02-34 passes — quota guard rejects over-limit inserts, idempotent create returns existing record on conflict, concurrent enable requests (10 concurrent, quota=5) result in exactly 5 successful inserts.

**What to implement** (follows `SubscriptionRepository.mjs` pattern — accepts `pool` constructor arg, ESM export):
- `constructor(pool)`.
- `async create(captureConfigAttrs)`:  
  - Acquires PostgreSQL advisory lock on `hashtext(workspace_id || 'pg_capture_quota')`.  
  - Counts active captures for `workspace_id` and `tenant_id` against `pg_capture_quotas` (or env defaults `PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA`, `PG_CAPTURE_DEFAULT_TENANT_QUOTA`).  
  - On quota breach: throw `{ code: 'QUOTA_EXCEEDED', scope, limit, current }`.  
  - `INSERT INTO pg_capture_configs ... ON CONFLICT (workspace_id, data_source_ref, schema_name, table_name) DO UPDATE SET updated_at = now() WHERE pg_capture_configs.status = 'active' RETURNING *`.  
  - On conflict where existing status ≠ active: throw `{ code: 'CAPTURE_ALREADY_ACTIVE' }`.  
  - Returns `CaptureConfig.fromRow(row)`.
- `async findActive(dataSourceRef)` — `SELECT * FROM pg_capture_configs WHERE data_source_ref = $1 AND status = 'active'`.
- `async findByWorkspace(tenantId, workspaceId, status = null)` — includes optional status filter.
- `async findByTenantSummary(tenantId)` — aggregates active capture counts grouped by `workspace_id`.
- `async updateStatus(id, status, { lastError = null, deactivationTs = null, actorIdentity })` — `UPDATE pg_capture_configs SET status=$2, last_error=$3, deactivation_ts=$4, actor_identity=$5, updated_at=now() WHERE id=$1 RETURNING *`.
- `async disable(id, actorIdentity)` — delegates to `updateStatus(id, 'disabled', { deactivationTs: new Date(), actorIdentity })`.

---

### T02-05 · Repository — CaptureAuditRepository

**File**: `services/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs`  
**Depends on**: T02-01  
**Acceptance**: `append()` inserts a row into `pg_capture_audit_log` and returns the inserted row.

**What to implement** (mirrors `AuditRepository.mjs`):
- `constructor(pool)`.
- `async append({ captureId, tenantId, workspaceId, actorIdentity, action, beforeState, afterState, requestId })` — `INSERT INTO pg_capture_audit_log (...) VALUES (...) RETURNING *`.
- Valid `action` values: `capture-enabled`, `capture-disabled`, `capture-errored`, `capture-paused`, `capture-resumed`.

---

### T02-06 · Repository — CaptureQuotaRepository

**File**: `services/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs`  
**Depends on**: T02-01  
**Acceptance**: `getQuota()` returns null for unknown scope (caller applies env default), `countActive()` returns correct count, `upsert()` creates or updates quota row.

**What to implement**:
- `constructor(pool)`.
- `async getQuota(scope, scopeId)` — `SELECT * FROM pg_capture_quotas WHERE scope=$1 AND scope_id=$2`.
- `async countActive(scope, scopeId)` — for `scope='workspace'`: `SELECT COUNT(*) FROM pg_capture_configs WHERE workspace_id=$1 AND status='active'`; for `scope='tenant'`: aggregate by `tenant_id`.
- `async upsert(scope, scopeId, maxTables)` — `INSERT INTO pg_capture_quotas (scope, scope_id, max_tables) VALUES ($1,$2,$3) ON CONFLICT (scope, scope_id) DO UPDATE SET max_tables=$3, updated_at=now() RETURNING *`.

---

### T02-07 · Event publisher — PgCaptureLifecyclePublisher

**File**: `services/provisioning-orchestrator/src/events/realtime/PgCaptureLifecyclePublisher.mjs`  
**Depends on**: T02-05  
**Acceptance**: Publisher emits CloudEvents 1.0 envelopes to topic `console.pg-capture.lifecycle`; event `type` matches one of the defined lifecycle types.

**What to implement** (mirrors `SubscriptionLifecyclePublisher.mjs`):
- `constructor(kafkaProducer)`.
- `async publish(eventType, payload)` — eventType ∈ `{ 'capture-enabled', 'capture-disabled', 'capture-errored', 'capture-paused', 'capture-resumed', 'quota-exceeded' }`.
- Message structure: CloudEvents 1.0 envelope: `specversion`, `id` (UUIDv4), `type` (`console.pg-capture.{eventType}`), `source`, `time`, `tenantid`, `workspaceid`, `data: payload`.
- `kafkaProducer.send({ topic: process.env.PG_CAPTURE_KAFKA_TOPIC_LIFECYCLE ?? 'console.pg-capture.lifecycle', messages: [{ key: workspaceId, value: JSON.stringify(envelope) }] })`.

---

### T02-08 · OpenWhisk action — pg-capture-enable

**File**: `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs`  
**Depends on**: T02-04, T02-06, T02-07  
**Acceptance**: Unit test T02-35 passes. Returns `201` with capture config JSON on success; `429 QUOTA_EXCEEDED`, `409 CAPTURE_ALREADY_ACTIVE`, `404 TABLE_NOT_FOUND`, `503 REPLICATION_SLOT_LIMIT` on error paths.

**What to implement** (follows existing action patterns: ESM, `export async function main(params)`, Keycloak JWT from `params.__ow_headers.authorization`):
- Parse and validate JWT; extract `workspace_id`, `tenant_id`, `actor_identity`.
- Parse request body: `data_source_ref`, `schema_name` (default `'public'`), `table_name`. Reject with `400` if missing.
- `CaptureQuotaRepository.countActive('workspace', workspaceId)` + `getQuota('workspace', workspaceId)` → compare against `PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA` env (default `10`). If over limit: return `{ statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: 'workspace' } }`.
- Same check for tenant quota using `PG_CAPTURE_DEFAULT_TENANT_QUOTA` (default `50`).
- `CaptureConfigRepository.create(...)` — catch `CAPTURE_ALREADY_ACTIVE` → `409`, `QUOTA_EXCEEDED` → `429`.
- `CaptureAuditRepository.append(...)` + `PgCaptureLifecyclePublisher.publish('capture-enabled', ...)` (fire-and-forget; do not fail action on audit error).
- Return `{ statusCode: 201, body: captureConfig.toJSON() }`.

---

### T02-09 · OpenWhisk action — pg-capture-disable

**File**: `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs`  
**Depends on**: T02-04, T02-07  
**Acceptance**: Unit test T02-36 passes. Returns `204` on success; `404 CAPTURE_NOT_FOUND`; `409 CAPTURE_ALREADY_DISABLED`.

**What to implement**:
- Parse JWT; extract `workspace_id`, `tenant_id`, `actor_identity`.
- Load capture config by `captureId` from path params; verify `workspace_id` and `tenant_id` match → `404` if not found or ownership mismatch.
- If `status === 'disabled'` → `409 CAPTURE_ALREADY_DISABLED`.
- `CaptureConfigRepository.disable(id, actorIdentity)`.
- `CaptureAuditRepository.append(...)` + `PgCaptureLifecyclePublisher.publish('capture-disabled', ...)` (fire-and-forget).
- Return `{ statusCode: 204 }`.

---

### T02-10 · OpenWhisk action — pg-capture-list

**File**: `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs`  
**Depends on**: T02-04  
**Acceptance**: Returns `200` with `{ items: [...], total: N }`. Supports optional `status` query param.

**What to implement**:
- Parse JWT; extract `workspace_id`, `tenant_id`.
- Read optional query param `status` from `params.__ow_query.status`.
- `CaptureConfigRepository.findByWorkspace(tenantId, workspaceId, status)`.
- Return `{ statusCode: 200, body: { items: configs.map(c => c.toJSON()), total: configs.length } }`.

---

### T02-11 · OpenWhisk action — pg-capture-tenant-summary

**File**: `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs`  
**Depends on**: T02-04, T02-06  
**Acceptance**: Returns `200` with per-workspace summary array. Tenant owner JWT required.

**What to implement**:
- Parse JWT; verify `tenant_id` from token matches path param `tenantId`; verify `tenant_owner` role claim.
- `CaptureConfigRepository.findByTenantSummary(tenantId)` — returns rows grouped by `workspace_id`.
- `CaptureQuotaRepository.getQuota('tenant', tenantId)` → resolve `quota_max` (falls back to `PG_CAPTURE_DEFAULT_TENANT_QUOTA`).
- Return `{ statusCode: 200, body: { workspaces: [...], tenant_id: tenantId } }`.

---

### T02-12 · Bridge service — package.json

**File**: `services/pg-cdc-bridge/package.json`  
**Depends on**: —  
**Acceptance**: `pnpm install` in the directory succeeds. `pnpm start` launches `src/index.mjs`.

**What to implement**:
```json
{
  "name": "@falcone/pg-cdc-bridge",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.mjs",
  "scripts": {
    "start": "node src/index.mjs",
    "test": "node --test tests/unit/**/*.test.mjs"
  },
  "dependencies": {
    "pg": "^8.11.0",
    "kafkajs": "^2.2.4",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "testcontainers": "^10.0.0"
  }
}
```
Also create `services/pg-cdc-bridge/src/` directory structure (empty placeholders for subsequent tasks).

---

### T02-13 · Bridge — CaptureConfigCache

**File**: `services/pg-cdc-bridge/src/CaptureConfigCache.mjs`  
**Depends on**: T02-01, T02-12  
**Acceptance**: Unit test T02-32 passes. Cache reloads after TTL expiry. On DB error during reload, returns stale cache and logs error without throwing.

**What to implement**:
- `constructor({ pool, ttlSeconds = Number(process.env.PG_CDC_CACHE_TTL_SECONDS ?? 30) })`.
- `async getActiveConfigs(dataSourceRef)` — returns array of active capture config rows. On first call or after TTL: queries `pg_capture_configs WHERE data_source_ref = $1 AND status = 'active'`. Caches result keyed by `dataSourceRef`.
- `invalidate(dataSourceRef)` — clears specific cache entry.
- Internal `_cache = new Map()` with `{ rows, expiresAt }` per key.
- On reload failure: logs `[CaptureConfigCache] reload failed: {err.message}` and returns last cached value (or empty array if no prior value).

---

### T02-14 · Bridge — WalEventDecoder

**File**: `services/pg-cdc-bridge/src/WalEventDecoder.mjs`  
**Depends on**: T02-12  
**Acceptance**: Unit test T02-30 passes. Correctly decodes pgoutput `Relation`, `Insert`, `Update`, `Delete` messages. Returns `null` for `TRUNCATE` (treated as no-op). Does not throw on unrecognized message type.

**What to implement**:
- `class WalEventDecoder`:
  - `decodeMessage(buffer, lsn)` — entry point. Reads first byte (`R`=Relation, `I`=Insert, `U`=Update, `D`=Delete, `T`=Truncate, `B`=Begin, `C`=Commit). Returns structured object or `null`.
  - `_decodeRelation(buf)` — returns `{ relationId, namespace, relationName, columns: [{ name, typeId }] }`. Stores in internal `_relations = new Map()`.
  - `_decodeInsert(buf, lsn)` — returns `{ type: 'insert', relation, newRow, lsn }`.
  - `_decodeUpdate(buf, lsn)` — returns `{ type: 'update', relation, newRow, oldRow, lsn }` (`oldRow` may be null if not configured with `REPLICA IDENTITY FULL`).
  - `_decodeDelete(buf, lsn)` — returns `{ type: 'delete', relation, oldRow, lsn }`.
  - `_decodeRowData(buf, offset, relation)` — reads tuple data, returns `{ fields: { [colName]: value } }`.
- pgoutput binary format reference: PostgreSQL logical streaming replication protocol (proto_version=1). Message layout as documented at https://www.postgresql.org/docs/current/protocol-logicalrep-message-formats.html.
- Relation messages update internal `_relations` map; subsequent row messages reference relation by OID.

---

### T02-15 · Bridge — RouteFilter

**File**: `services/pg-cdc-bridge/src/RouteFilter.mjs`  
**Depends on**: T02-13, T02-14  
**Acceptance**: Unit test T02-31 passes. Returns matching `CaptureConfig` row for active captures, `null` for unconfigured tables. Events from workspace A never match workspace B's filter configs.

**What to implement**:
- `constructor(captureConfigCache)`.
- `async match(decodedEvent, dataSourceRef)`:
  - Calls `captureConfigCache.getActiveConfigs(dataSourceRef)`.
  - Filters configs where `schema_name === decodedEvent.relation.namespace` AND `table_name === decodedEvent.relation.relationName`.
  - Returns array of matching configs (may be multiple workspaces sharing same physical DB).
  - Returns empty array if none match.
- `async matchForWorkspace(decodedEvent, dataSourceRef, workspaceId)` — same but additionally filters by `workspace_id`. Used for workspace-isolated publishing paths.

---

### T02-16 · Bridge — KafkaChangePublisher

**File**: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs`  
**Depends on**: T02-03, T02-12  
**Acceptance**: Published messages arrive on correct per-workspace topic. Partition key is `{workspaceId}:{schema}.{table}`. In-order delivery within same partition key. Rate limiter throttles per-workspace burst.

**What to implement**:
- `constructor({ kafka, maxEventsPerSecond = Number(process.env.PG_CDC_MAX_EVENTS_PER_SECOND ?? 1000) })`.
- `async initialize()` — creates `kafkajs` producer with `{ idempotent: true, acks: -1 }`.
- `async publish(captureConfig, decodedEvent, lsn, committedAt)`:
  - Builds `CaptureChangeEvent` using T02-03 factory.
  - Resolves topic: `process.env.PG_CDC_KAFKA_TOPIC_PREFIX ?? `${captureConfig.tenant_id}.${captureConfig.workspace_id}.pg-changes``.
  - Partition key: `${captureConfig.workspace_id}:${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}`.
  - Kafka message headers: `{ 'ce-type': 'console.pg-capture.change', 'ce-tenantid': captureConfig.tenant_id, 'ce-workspaceid': captureConfig.workspace_id, 'ce-source': `/data-sources/${captureConfig.data_source_ref}/tables/${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}` }`.
  - Per-workspace rate limiter (token bucket or simple sliding window using `Map<workspaceId, {count, windowStart}>`). When limit exceeded: emits `'rate-limited'` event and skips publish (logs warning with workspace context).
- `async disconnect()` — `producer.disconnect()`.

---

### T02-17 · Bridge — PgWalListener

**File**: `services/pg-cdc-bridge/src/PgWalListener.mjs`  
**Depends on**: T02-14, T02-15, T02-16  
**Acceptance**: Opens replication connection to PostgreSQL, decodes WAL stream, routes events to KafkaChangePublisher. LSN acknowledged to PostgreSQL only after Kafka `send()` resolves (at-least-once guarantee).

**What to implement**:
- `constructor({ connectionString, dataSourceRef, decoder, routeFilter, publisher, slotName })`.
  - `slotName` defaults to `cdc_${dataSourceRef.slice(0, 8)}` (deterministic hash; max 64 chars).
- `async start()`:
  - `const client = new Client({ connectionString, replication: 'database' })`.
  - `await client.connect()`.
  - Ensure replication slot: `CREATE_REPLICATION_SLOT ${slotName} LOGICAL pgoutput` (suppress error if slot already exists: check `code === '42710'`).
  - `await client.query(`START_REPLICATION SLOT ${slotName} LOGICAL 0/0 (proto_version '1', publication_names 'falcone_cdc')`)`.
  - On `copyData` message: call `decoder.decodeMessage(buffer, lsn)`. If result non-null, call `routeFilter.match(result, dataSourceRef)`. For each matching config, call `publisher.publish(config, result, lsn, committedAt)`. After all publishes resolve, send LSN acknowledgement: `client.query(`UPDATE_REPLICATION_SLOT ...`)` or standard standby status update.
  - On error: emit `'error'` event; set `_running = false`. Caller (`WalListenerManager`) handles reconnect.
- `async stop()` — end replication stream, disconnect client.
- `isRunning` getter.

---

### T02-18 · Bridge — WalListenerManager

**File**: `services/pg-cdc-bridge/src/WalListenerManager.mjs`  
**Depends on**: T02-13, T02-17  
**Acceptance**: Starts one `PgWalListener` per unique `data_source_ref`. Reconnects on listener error with exponential backoff (max 60s). Tracks `MetricsCollector` listener state.

**What to implement**:
- `constructor({ pool, kafka, decoderFactory, routeFilterFactory, publisherFactory, metricsCollector })`.
- `async start()`:
  - Query `SELECT DISTINCT data_source_ref FROM pg_capture_configs WHERE status = 'active'`.
  - For each `data_source_ref`: instantiate and start a `PgWalListener`.
  - Store in `_listeners = new Map<dataSourceRef, { listener, backoffMs }>`.
- `_scheduleReconnect(dataSourceRef, backoffMs)` — `setTimeout` with `Math.min(backoffMs * 2, 60000)`. On reconnect attempt: call `_startListener(dataSourceRef)`.
- `async stop()` — stop all listeners.
- Refreshes known `data_source_ref` list every `PG_CDC_CACHE_TTL_SECONDS` seconds to pick up newly enabled captures on previously unknown data sources.

---

### T02-19 · Bridge — HealthServer

**File**: `services/pg-cdc-bridge/src/HealthServer.mjs`  
**Depends on**: T02-18  
**Acceptance**: `GET /health` returns `200 { status: 'ok', listeners: [...] }` when all listeners are running and Kafka producer is connected; `503` otherwise.

**What to implement**:
- `constructor({ port = 8080, listenerManager, kafkaPublisher })`.
- `start()` — creates `http.createServer` on `port`.
- `GET /health`: collects health from `listenerManager` (all listeners `isRunning`) and `kafkaPublisher` (producer connected). Returns `200` or `503`.
- `GET /metrics`: returns Prometheus-format text output from `MetricsCollector`.
- `stop()` — closes server.

---

### T02-20 · Bridge — MetricsCollector

**File**: `services/pg-cdc-bridge/src/MetricsCollector.mjs`  
**Depends on**: T02-18  
**Acceptance**: Exposes counters and gauges in Prometheus text format. Each metric includes relevant labels.

**What to implement**:
- Metrics:
  - `pg_cdc_events_published_total{workspace_id, table}` — counter.
  - `pg_cdc_publish_lag_seconds{workspace_id}` — gauge (time from WAL commit to Kafka send).
  - `pg_cdc_replication_lag_bytes{data_source_ref}` — gauge (estimated WAL lag).
  - `pg_cdc_events_rate_limited_total{workspace_id}` — counter.
- `increment(metric, labels)`, `set(metric, labels, value)` methods.
- `toPrometheus()` — serializes all metrics to Prometheus text format string.

---

### T02-21 · Bridge — index.mjs (entry point)

**File**: `services/pg-cdc-bridge/src/index.mjs`  
**Depends on**: T02-18, T02-19, T02-20  
**Acceptance**: Process starts without errors given valid env vars. Graceful shutdown on `SIGTERM`/`SIGINT` (stops listeners, closes Kafka producer, closes health server).

**What to implement**:
- Read env vars: `PG_CDC_KAFKA_BROKERS`, `PG_CDC_KAFKA_CLIENT_ID` (default `pg-cdc-bridge`), `DATABASE_URL` (provisioning-orchestrator PostgreSQL, for `pg_capture_configs` reads), `PG_CDC_CACHE_TTL_SECONDS`.
- Initialize `Pool` (pg), `Kafka` (kafkajs), `MetricsCollector`, `KafkaChangePublisher`, `WalListenerManager`, `HealthServer`.
- `await publisher.initialize()`, `await manager.start()`, `healthServer.start()`.
- Register `process.on('SIGTERM', shutdown)` and `process.on('SIGINT', shutdown)` where `shutdown` stops manager, disconnects publisher, stops health server.

---

### T02-22 · Helm — Chart.yaml

**File**: `services/pg-cdc-bridge/helm/pg-cdc-bridge/Chart.yaml`  
**Depends on**: T02-12  
**Acceptance**: `helm lint` passes.

**What to implement**:
```yaml
apiVersion: v2
name: pg-cdc-bridge
description: PostgreSQL Change Data Capture to Kafka bridge
type: application
version: 1.0.0
appVersion: "1.0.0"
```

---

### T02-23 · Helm — values.yaml

**File**: `services/pg-cdc-bridge/helm/pg-cdc-bridge/values.yaml`  
**Depends on**: T02-22  
**Acceptance**: Contains all required env var defaults. `helm install --dry-run` passes.

**What to implement**:
```yaml
replicaCount: 1
image:
  repository: falcone/pg-cdc-bridge
  tag: "1.0.0"
  pullPolicy: IfNotPresent
env:
  PG_CDC_CACHE_TTL_SECONDS: "30"
  PG_CDC_WAL_KEEP_THRESHOLD_MB: "512"
  PG_CDC_MAX_EVENTS_PER_SECOND: "1000"
  PG_CDC_KAFKA_CLIENT_ID: "pg-cdc-bridge"
  PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA: "10"
  PG_CAPTURE_DEFAULT_TENANT_QUOTA: "50"
  PG_CAPTURE_KAFKA_TOPIC_LIFECYCLE: "console.pg-capture.lifecycle"
  PORT: "8080"
secrets:
  DATABASE_URL: ""
  PG_CDC_KAFKA_BROKERS: ""
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"
service:
  port: 8080
```

---

### T02-24 · Helm — deployment.yaml

**File**: `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/deployment.yaml`  
**Depends on**: T02-22, T02-23  
**Acceptance**: Deployment spec renders with correct env vars, resource limits, liveness/readiness probes against `/health`.

**What to implement**:
- `kind: Deployment`, replicas from `values.replicaCount`.
- Container env from `values.env` and secret refs for `DATABASE_URL`, `PG_CDC_KAFKA_BROKERS`.
- `livenessProbe` and `readinessProbe`: `httpGet: { path: /health, port: 8080 }`, initialDelaySeconds: 15, periodSeconds: 10.
- Resources from `values.resources`.

---

### T02-25 · Helm — configmap.yaml

**File**: `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/configmap.yaml`  
**Depends on**: T02-22  
**Acceptance**: ConfigMap renders with non-sensitive env vars.

**What to implement**:
- `kind: ConfigMap` — keys from `values.env` excluding secret values.

---

### T02-26 · Helm — service.yaml

**File**: `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/service.yaml`  
**Depends on**: T02-22  
**Acceptance**: Service renders with `ClusterIP`, port 8080.

**What to implement**:
- `kind: Service`, `type: ClusterIP`, `port: 8080`, `targetPort: 8080`.

---

### T02-27 · Contract schema — pg-capture-change-event.json

**File**: `services/internal-contracts/src/pg-capture-change-event.json`  
**Depends on**: T02-03  
**Acceptance**: Schema validates a `CaptureChangeEvent` instance produced by T02-03 without errors. Schema rejects messages missing required fields.

**What to implement** (JSON Schema draft-07, matches existing contract schemas):
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "pg-capture-change-event",
  "type": "object",
  "required": ["specversion","type","source","id","time","tenantid","workspaceid","data"],
  "properties": {
    "specversion": { "const": "1.0" },
    "type": { "const": "console.pg-capture.change" },
    "source": { "type": "string" },
    "id": { "type": "string", "format": "uuid" },
    "time": { "type": "string", "format": "date-time" },
    "tenantid": { "type": "string" },
    "workspaceid": { "type": "string" },
    "data": {
      "type": "object",
      "required": ["event_type","schema","table","lsn","committed_at","capture_config_id"],
      "properties": {
        "event_type": { "enum": ["insert","update","delete"] },
        "schema": { "type": "string" },
        "table": { "type": "string" },
        "lsn": { "type": "string" },
        "committed_at": { "type": "string", "format": "date-time" },
        "row_payload": { "type": "object" },
        "capture_config_id": { "type": "string" },
        "sequence": { "type": "integer" }
      }
    }
  }
}
```

---

### T02-28 · Contract schema — pg-capture-lifecycle-event.json

**File**: `services/internal-contracts/src/pg-capture-lifecycle-event.json`  
**Depends on**: T02-07  
**Acceptance**: Schema validates lifecycle events emitted by `PgCaptureLifecyclePublisher`.

**What to implement**:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "pg-capture-lifecycle-event",
  "type": "object",
  "required": ["specversion","type","source","id","time","tenantid","workspaceid","data"],
  "properties": {
    "specversion": { "const": "1.0" },
    "type": {
      "type": "string",
      "pattern": "^console\\.pg-capture\\.(capture-enabled|capture-disabled|capture-errored|capture-paused|capture-resumed|quota-exceeded)$"
    },
    "source": { "type": "string" },
    "id": { "type": "string", "format": "uuid" },
    "time": { "type": "string", "format": "date-time" },
    "tenantid": { "type": "string" },
    "workspaceid": { "type": "string" },
    "data": {
      "type": "object",
      "required": ["action","capture_id","table_name","actor_identity"],
      "properties": {
        "action": { "type": "string" },
        "capture_id": { "type": "string" },
        "table_name": { "type": "string" },
        "actor_identity": { "type": "string" },
        "before_state": { "type": "object" },
        "after_state": { "type": "object" },
        "error": { "type": "string" }
      }
    }
  }
}
```

---

### T02-29 · Gateway config — APISIX route registration

**File**: `services/gateway-config/base/public-api-routing.yaml`  
**Depends on**: T02-08, T02-09, T02-10, T02-11  
**Acceptance**: All four new API paths appear in routing config. Existing routes unmodified.

**What to implement** — append the following APISIX route entries:
```yaml
# US-DX-01-T02: PostgreSQL Change Data Capture routes
- id: pg-capture-enable
  uri: /workspaces/*/pg-captures
  methods: [POST]
  upstream: provisioning-orchestrator
  plugins:
    openwhisk:
      action: realtime/pg-capture-enable
    jwt-auth: {}
    
- id: pg-capture-disable
  uri: /workspaces/*/pg-captures/*
  methods: [DELETE]
  upstream: provisioning-orchestrator
  plugins:
    openwhisk:
      action: realtime/pg-capture-disable
    jwt-auth: {}

- id: pg-capture-list
  uri: /workspaces/*/pg-captures
  methods: [GET]
  upstream: provisioning-orchestrator
  plugins:
    openwhisk:
      action: realtime/pg-capture-list
    jwt-auth: {}

- id: pg-capture-tenant-summary
  uri: /tenants/*/pg-captures/summary
  methods: [GET]
  upstream: provisioning-orchestrator
  plugins:
    openwhisk:
      action: realtime/pg-capture-tenant-summary
    jwt-auth: {}
```

---

### T02-30 · Unit test — WalEventDecoder

**File**: `services/pg-cdc-bridge/tests/unit/WalEventDecoder.test.mjs`  
**Depends on**: T02-14  
**Acceptance**: All test cases pass with `node --test`. No skips.

**Test cases**:
1. Decodes a well-formed `Insert` pgoutput message and returns `{ type: 'insert', relation, newRow }`.
2. Decodes an `Update` message; `newRow` contains updated field values.
3. Decodes a `Delete` message; `oldRow` contains primary key fields.
4. Returns `null` for `TRUNCATE` message.
5. Does not throw on unrecognized message type byte; returns `null`.
6. `_decodeRelation` stores relation in internal map and returns structured `{ relationId, namespace, relationName, columns }`.
7. `_decodeRowData` correctly maps column names to values using relation definition.

---

### T02-31 · Unit test — RouteFilter

**File**: `services/pg-cdc-bridge/tests/unit/RouteFilter.test.mjs`  
**Depends on**: T02-15  
**Acceptance**: All test cases pass. Workspace isolation confirmed.

**Test cases**:
1. `match()` returns config for table that has an active capture config.
2. `match()` returns empty array for table with no active capture config.
3. `match()` returns empty array for table whose capture status is `'disabled'`.
4. With two workspaces sharing a `dataSourceRef`, `match()` returns configs for both workspaces.
5. `matchForWorkspace()` returns only the config matching the specified `workspaceId`.
6. `matchForWorkspace()` returns empty array when `workspaceId` does not match any active config.

---

### T02-32 · Unit test — CaptureConfigCache

**File**: `services/pg-cdc-bridge/tests/unit/CaptureConfigCache.test.mjs`  
**Depends on**: T02-13  
**Acceptance**: All test cases pass.

**Test cases**:
1. First call queries DB and returns rows.
2. Subsequent call within TTL returns cached rows (DB not queried again — verified by mock call count).
3. Call after TTL expiry triggers DB re-query.
4. DB error during reload returns stale cached value without throwing.
5. DB error on first load (no stale cache) returns empty array without throwing.
6. `invalidate(dataSourceRef)` clears cache entry; next call re-queries DB.

---

### T02-33 · Unit test — CaptureConfig model

**File**: `services/provisioning-orchestrator/tests/unit/realtime/CaptureConfig.test.mjs`  
**Depends on**: T02-02  
**Acceptance**: All assertions pass.

**Test cases**:
1. Valid attrs construct without error.
2. Missing `tenant_id` throws `CAPTURE_TENANT_ID_REQUIRED`.
3. Missing `workspace_id` throws `CAPTURE_WORKSPACE_ID_REQUIRED`.
4. Missing `table_name` throws `CAPTURE_TABLE_NAME_REQUIRED`.
5. Invalid `status` throws `INVALID_CAPTURE_STATUS`.
6. `qualifiedTable()` returns `'public.orders'` when `schema_name = 'public'`, `table_name = 'orders'`.
7. `fromRow(dbRow)` returns `CaptureConfig` instance.
8. Default `schema_name` is `'public'`, default `status` is `'active'`.

---

### T02-34 · Unit test — CaptureConfigRepository

**File**: `services/provisioning-orchestrator/tests/unit/realtime/CaptureConfigRepository.test.mjs`  
**Depends on**: T02-04  
**Acceptance**: All assertions pass including race condition test.

**Test cases**:
1. `create()` inserts a record and returns a `CaptureConfig` instance.
2. `create()` throws `QUOTA_EXCEEDED` when workspace active count equals workspace quota.
3. `create()` throws `QUOTA_EXCEEDED` when tenant active count equals tenant quota.
4. `create()` is idempotent: second call with same table returns existing active record without error.
5. Concurrent `create()` calls (simulated): exactly N succeed when quota = N (advisory lock prevents over-allocation).
6. `findActive(dataSourceRef)` returns only `status = 'active'` rows.
7. `findByWorkspace()` filters by `tenant_id` and `workspace_id`.
8. `disable()` sets status to `'disabled'` and stamps `deactivation_ts`.

---

### T02-35 · Unit test — pg-capture-enable action

**File**: `services/provisioning-orchestrator/tests/unit/realtime/pg-capture-enable.test.mjs`  
**Depends on**: T02-08  
**Acceptance**: All assertions pass.

**Test cases**:
1. Valid JWT + valid body → `201` with capture config in response body.
2. Missing `table_name` → `400`.
3. Quota exceeded (workspace) → `429 QUOTA_EXCEEDED`.
4. Quota exceeded (tenant) → `429 QUOTA_EXCEEDED` with `scope: 'tenant'`.
5. Table already captured (active) → `409 CAPTURE_ALREADY_ACTIVE`.
6. Audit publish failure does not cause action to fail (fire-and-forget pattern).
7. Missing/invalid JWT → `401`.

---

### T02-36 · Unit test — pg-capture-disable action

**File**: `services/provisioning-orchestrator/tests/unit/realtime/pg-capture-disable.test.mjs`  
**Depends on**: T02-09  
**Acceptance**: All assertions pass.

**Test cases**:
1. Valid JWT + existing active capture → `204`.
2. `captureId` not found → `404`.
3. `captureId` belongs to different workspace → `404` (no information disclosure).
4. Capture already disabled → `409 CAPTURE_ALREADY_DISABLED`.
5. Audit publish failure does not cause action to fail.
6. Missing/invalid JWT → `401`.

---

### T02-37 · Integration test — pg-capture-to-kafka

**File**: `services/pg-cdc-bridge/tests/integration/pg-capture-to-kafka.integration.test.mjs`  
**Depends on**: T02-21  
**Acceptance**: All 7 scenarios pass. Requires local PostgreSQL with `wal_level = logical` and local Kafka (Docker Compose or testcontainers).

**Test scenarios**:
1. Enable capture on table `orders` → INSERT row → consume from Kafka → assert event structure matches `pg-capture-change-event.json` schema.
2. UPDATE row → assert `data.event_type = 'update'` and `data.row_payload` contains new values.
3. DELETE row → assert `data.event_type = 'delete'` and `data.row_payload` contains primary key.
4. Disable capture → INSERT row → assert no new event on topic within 5 s.
5. Bridge restart mid-transaction → assert no event loss (compare LSN range to published events; duplicates acceptable).
6. Two workspaces sharing one physical DB → assert events from workspace A never appear on workspace B's topic.
7. Concurrent high-volume INSERT (1000 rows) → assert all 1000 events published; events for same table arrive in commit order (monotonically increasing LSN values on consumer).

---

## File Path Reference (complete enumeration for implement agent)

All paths that must be created or modified during implementation of US-DX-01-T02:

### New files to create

```
services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql
services/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs
services/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs
services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs
services/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs
services/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs
services/provisioning-orchestrator/src/events/realtime/PgCaptureLifecyclePublisher.mjs
services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs
services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs
services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs
services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs
services/provisioning-orchestrator/tests/unit/realtime/CaptureConfig.test.mjs
services/provisioning-orchestrator/tests/unit/realtime/CaptureConfigRepository.test.mjs
services/provisioning-orchestrator/tests/unit/realtime/pg-capture-enable.test.mjs
services/provisioning-orchestrator/tests/unit/realtime/pg-capture-disable.test.mjs
services/pg-cdc-bridge/package.json
services/pg-cdc-bridge/src/index.mjs
services/pg-cdc-bridge/src/WalListenerManager.mjs
services/pg-cdc-bridge/src/PgWalListener.mjs
services/pg-cdc-bridge/src/WalEventDecoder.mjs
services/pg-cdc-bridge/src/RouteFilter.mjs
services/pg-cdc-bridge/src/CaptureConfigCache.mjs
services/pg-cdc-bridge/src/KafkaChangePublisher.mjs
services/pg-cdc-bridge/src/HealthServer.mjs
services/pg-cdc-bridge/src/MetricsCollector.mjs
services/pg-cdc-bridge/tests/unit/WalEventDecoder.test.mjs
services/pg-cdc-bridge/tests/unit/RouteFilter.test.mjs
services/pg-cdc-bridge/tests/unit/CaptureConfigCache.test.mjs
services/pg-cdc-bridge/tests/integration/pg-capture-to-kafka.integration.test.mjs
services/pg-cdc-bridge/helm/pg-cdc-bridge/Chart.yaml
services/pg-cdc-bridge/helm/pg-cdc-bridge/values.yaml
services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/deployment.yaml
services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/configmap.yaml
services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/service.yaml
services/internal-contracts/src/pg-capture-change-event.json
services/internal-contracts/src/pg-capture-lifecycle-event.json
```

### Existing files to modify

```
services/gateway-config/base/public-api-routing.yaml   (append 4 route entries)
```

---

## Environment Variables Reference

| Variable | Default | Service |
|---|---|---|
| `PG_CDC_CACHE_TTL_SECONDS` | `30` | pg-cdc-bridge |
| `PG_CDC_WAL_KEEP_THRESHOLD_MB` | `512` | pg-cdc-bridge |
| `PG_CDC_MAX_EVENTS_PER_SECOND` | `1000` | pg-cdc-bridge |
| `PG_CDC_KAFKA_BROKERS` | required | pg-cdc-bridge |
| `PG_CDC_KAFKA_CLIENT_ID` | `pg-cdc-bridge` | pg-cdc-bridge |
| `PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA` | `10` | provisioning-orchestrator |
| `PG_CAPTURE_DEFAULT_TENANT_QUOTA` | `50` | provisioning-orchestrator |
| `PG_CAPTURE_KAFKA_TOPIC_LIFECYCLE` | `console.pg-capture.lifecycle` | provisioning-orchestrator |

---

## Criteria of Done

| # | Criterion | Verification |
|---|---|---|
| 1 | Migration runs forward and backward | `migrate:up` and `migrate:down` exit 0 |
| 2 | `pg-capture-enable` returns 201 for valid request | T02-35 passes |
| 3 | INSERT on captured table produces Kafka event within 30s | T02-37 scenario 1 |
| 4 | Events for same table arrive in commit order | T02-37 scenario 7 (LSN monotonicity) |
| 5 | No cross-workspace event leakage | T02-37 scenario 6 |
| 6 | At-least-once delivery across bridge restart | T02-37 scenario 5 |
| 7 | Audit record queryable within 30s of lifecycle operation | T02-35 side-effect assertion |
| 8 | Quota enforcement — no race condition over-allocation | T02-34 concurrent test |
| 9 | DDL change does not cascade to other captures | T02-17 error isolation (bridge level) |
| 10 | `/health` reflects replication slot state | T02-19 manual smoke test |
| 11 | All unit tests pass | `pnpm test` exits 0 in both services |
| 12 | Gateway routes registered | T02-29 routing YAML rendered correctly |
| 13 | Kafka contract schemas validate | T02-27, T02-28 schema files exist and are valid JSON Schema |
| 14 | Helm chart lints cleanly | `helm lint services/pg-cdc-bridge/helm/pg-cdc-bridge` exits 0 |
