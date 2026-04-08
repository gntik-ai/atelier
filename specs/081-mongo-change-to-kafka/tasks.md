# Tasks: MongoDB Change Stream Capture → Kafka Realtime Channels

**Input**: Design documents from `specs/081-mongo-change-to-kafka/`
**Prerequisites**: `plan.md`, `spec.md`
**Branch**: `081-mongo-change-to-kafka`
**Story**: `US-DX-01-T03`
**Epic**: `EP-17 — Realtime, webhooks y experiencia de desarrollador`

**Depends on**:
- US-DX-01-T01 (channel/subscription model — `realtime_channels` table, `mongodb-changes` channel type, `kafka_topic_pattern`)
- US-DX-01-T02 (pg-cdc-bridge — establishes shared patterns for actions, repositories, event publishers, and Kafka producer)

**Tests**: Unit, integration, and contract coverage are required. At-least-once delivery guarantees, tenant isolation, and quota enforcement are non-negotiable correctness requirements that must be verifiable through the test suite before PR handoff.

**Organization**: Tasks follow the 9-step implementation sequence from plan §6.2. Parallelism is noted per task. All tasks reference exact file paths.

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel with other [P] tasks in same phase (no incomplete dependency overlap)
- All file paths are relative to `/root/projects/falcone/`

---

## File-Path Map (for constrained implement step)

> Provide this section to the implement agent so it reads only relevant files.

### Read before any implementation task

| File | Purpose |
|---|---|
| `specs/081-mongo-change-to-kafka/spec.md` | Feature spec, acceptance scenarios, FR-001–FR-013 |
| `specs/081-mongo-change-to-kafka/plan.md` | Architecture, artefact definitions, full SQL migration |
| `services/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs` | T02 domain model pattern to mirror |
| `services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs` | T02 repository pattern (quota guard, ON CONFLICT) |
| `services/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs` | T02 audit repository pattern |
| `services/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs` | T02 quota repository pattern |
| `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs` | T02 action pattern (JWT validation, quota check, audit, 201/409/429) |
| `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs` | T02 action pattern (status transition, audit, 204/404/409) |
| `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs` | T02 list action pattern |
| `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs` | T02 tenant summary action pattern |
| `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql` | T02 migration shape for table/index/FK reference |
| `services/pg-cdc-bridge/src/CaptureConfigCache.mjs` | T02 hot-reload config cache pattern |
| `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs` | T02 kafkajs producer pattern |
| `services/pg-cdc-bridge/src/HealthServer.mjs` | T02 health server pattern |
| `services/pg-cdc-bridge/src/index.mjs` | T02 bridge entry-point pattern |
| `services/internal-contracts/pg-capture-change-event.json` | T02 change event CloudEvents schema (adapt for MongoDB) |
| `services/internal-contracts/pg-capture-lifecycle-event.json` | T02 lifecycle event schema (adapt for MongoDB) |
| `services/internal-contracts/domain-model.json` | Existing domain entities |
| `services/internal-contracts/public-route-catalog.json` | Existing route catalog (add 4 new entries) |
| `services/internal-contracts/internal-service-map.json` | Service map (add mongo-cdc-bridge ownership) |
| `services/gateway-config/base/gateway.yaml` | APISIX gateway config base |
| `services/gateway-config/base/public-api-routing.yaml` | Public API routing (add mongo-capture routes) |

### Do NOT read

- `services/gateway-config/base/control-plane.openapi.json` (too large — use `public-api-routing.yaml` and family-specific OpenAPI fragment only)

---

## Phase 1: Migration & Domain Models (no external deps)

**Purpose**: Establish the four PostgreSQL tables and two domain model classes. All subsequent phases depend on these.

- [ ] T001 Write migration file `services/provisioning-orchestrator/src/migrations/081-mongo-capture-config.sql`
  - Create tables exactly as specified in plan §2.1:
    - `mongo_capture_configs` (id, tenant_id, workspace_id, data_source_ref, database_name, collection_name, capture_mode, status, activation_ts, deactivation_ts, actor_identity, last_error, created_at, updated_at; UNIQUE constraint on workspace+datasource+db+collection; CHECK constraints on capture_mode and status)
    - `mongo_capture_quotas` (id, scope CHECK IN ('workspace','tenant'), scope_id, max_collections, created_at, updated_at; UNIQUE on scope+scope_id)
    - `mongo_capture_resume_tokens` (capture_id PK + FK cascade delete, resume_token JSONB, updated_at)
    - `mongo_capture_audit_log` (id, capture_id FK set null, tenant_id, workspace_id, actor_identity, action, before_state JSONB, after_state JSONB, request_id, created_at)
  - Create all indexes: `idx_mongo_capture_workspace`, `idx_mongo_capture_tenant`, `idx_mongo_capture_datasource`, `idx_mongo_capture_audit_workspace`, `idx_mongo_capture_audit_tenant`
  - Include `-- down` section: DROP all four tables in reverse dependency order
  - Pattern: mirror `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql`

- [ ] T002 [P] Create domain model `services/provisioning-orchestrator/src/models/realtime/MongoCaptureConfig.mjs`
  - Export `CAPTURE_STATUSES` Set: `['active', 'paused', 'errored', 'disabled']`
  - Export `CAPTURE_MODES` Set: `['delta', 'full-document']`
  - Class `MongoCaptureConfig` with constructor, `static validate(attrs)`, `qualifiedNs()`, `static fromRow(row)`, `toJSON()`
  - Required fields (throw on missing): `tenant_id`, `workspace_id`, `data_source_ref`, `database_name`, `collection_name`, `actor_identity`
  - Defaults: `capture_mode = 'delta'`, `status = 'active'`
  - Pattern: mirror `services/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs`

- [ ] T003 [P] Create domain model `services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs`
  - Export factory function `buildMongoChangeEvent({ captureConfig, rawChangeDoc, eventId })` that returns a CloudEvents 1.0 JSON envelope
  - Fields: `specversion` ("1.0"), `type` ("console.mongo-capture.change"), `source` (`/data-sources/{dataSourceRef}/collections/{database}.{collection}`), `id` (uuid), `time` (ISO8601), `tenantid`, `workspaceid`
  - `data` sub-object: `event_type` (insert|update|replace|delete), `database_name`, `collection_name`, `document_key`, `capture_mode`, `full_document` (null if absent), `update_description` (null if absent), `cluster_time` (ISO8601 from `clusterTime`), `wall_time` (ISO8601 from `wallTime` if present), `capture_config_id`
  - Handle delta vs full-document mode: for `delta` updates set `full_document = null`; for `full-document` updates set `update_description = null`
  - Handle missing `fullDocument` for deletes (always null)
  - Pattern: mirror `services/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs` adapted for MongoDB

**Checkpoint**: Migration and models complete. Begin Phase 2 and Phase 5 in parallel.

---

## Phase 2: Repositories (depends on Phase 1)

**Purpose**: Data access layer for capture lifecycle, audit, quota enforcement, and resume token persistence.

- [ ] T004 Create `services/provisioning-orchestrator/src/repositories/realtime/MongoCaptureConfigRepository.mjs`
  - `create(config)`: PostgreSQL advisory lock on `(workspace_id, 'mongo_capture_quota')` + count check + INSERT in one transaction; ON CONFLICT returns existing row with `CAPTURE_ALREADY_ACTIVE` signal; throws `QUOTA_EXCEEDED` (workspace and tenant both checked)
  - `findActive(dataSourceRef)`: SELECT WHERE `data_source_ref = $1 AND status = 'active'` — used by bridge hot-reload
  - `findByWorkspace(tenantId, workspaceId, status?)`: list captures scoped to workspace+tenant
  - `findByTenantSummary(tenantId)`: per-workspace counts for tenant summary endpoint
  - `updateStatus(id, status, { lastError, deactivationTs, actorIdentity })`: safe lifecycle transition (always include `tenant_id` predicate)
  - `disable(id, actorIdentity)`: sets `status = 'disabled'`, stamps `deactivation_ts`, returns updated row
  - Pattern: mirror `services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs`

- [ ] T005 [P] Create `services/provisioning-orchestrator/src/repositories/realtime/MongoCaptureAuditRepository.mjs`
  - `append(auditRow)`: INSERT into `mongo_capture_audit_log`
  - `auditRow` shape: `{ capture_id?, tenant_id, workspace_id, actor_identity, action, before_state?, after_state?, request_id? }`
  - Valid `action` values: `capture-enabled`, `capture-disabled`, `capture-errored`, `capture-paused`, `capture-resumed`, `capture-quota-exceeded`, `capture-oversized-event`, `capture-stream-invalidated`
  - Pattern: mirror `services/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs`

- [ ] T006 [P] Create `services/provisioning-orchestrator/src/repositories/realtime/MongoCaptureQuotaRepository.mjs`
  - `getQuota(scope, scopeId)`: returns quota row or null (system default applied by caller)
  - `countActive(scope, scopeId)`: returns current count of `status = 'active'` captures for workspace or tenant scope
  - `upsert(scope, scopeId, maxCollections)`: INSERT ... ON CONFLICT DO UPDATE
  - Pattern: mirror `services/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs`

- [ ] T007 [P] Create `services/provisioning-orchestrator/src/repositories/realtime/MongoResumeTokenRepository.mjs`
  - `upsert(captureId, resumeToken)`: INSERT ... ON CONFLICT DO UPDATE; sets `updated_at = now()`
  - `get(captureId)`: returns `resume_token` JSONB or `null` if not found
  - `delete(captureId)`: DELETE by `capture_id`; used when capture is permanently disabled
  - Uses `pg` pool from shared connection factory (same pattern as other repositories)

**Checkpoint**: All repositories complete. Begin Phase 3 (actions), Phase 4 (lifecycle publisher) in parallel.

---

## Phase 3: OpenWhisk Actions — Management Plane (depends on Phase 2)

**Purpose**: API surface for capture lifecycle. Exposed via APISIX routes. Mirror T02 (`pg-capture-*`) action conventions.

- [ ] T008 Create `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs`
  - HTTP: `POST /workspaces/{workspaceId}/mongo-captures`
  - Request body: `{ data_source_ref, database_name, collection_name, capture_mode? }`
  - Logic:
    1. Validate Keycloak JWT from `params.__ow_headers.authorization`; extract `workspace_id`, `tenant_id`, `actor_identity`
    2. Validate body fields; reject 400 on missing `data_source_ref`, `database_name`, or `collection_name`
    3. Check workspace quota via `MongoCaptureQuotaRepository`; reject 429 `QUOTA_EXCEEDED` if exceeded; also check tenant quota
    4. Check collection accessibility (attempt `listCollections` probe on workspace MongoDB or check data source registry); reject 404 `COLLECTION_NOT_FOUND` or 400 `REPLICA_SET_REQUIRED` / `DATA_SOURCE_NOT_ACCESSIBLE`
    5. `MongoCaptureConfigRepository.create(config)`; returns 409 `CAPTURE_ALREADY_ACTIVE` on conflict
    6. `MongoCaptureAuditRepository.append({ action: 'capture-enabled', ... })`
    7. Publish to `console.mongo-capture.lifecycle` via `MongoCaptureLifecyclePublisher`
    8. Return 201 with full capture config JSON
  - Pattern: mirror `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs`

- [ ] T009 [P] Create `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-disable.mjs`
  - HTTP: `DELETE /workspaces/{workspaceId}/mongo-captures/{captureId}`
  - Logic:
    1. Validate JWT; extract workspace+tenant scope
    2. Load capture by `(captureId, workspaceId, tenantId)`; reject 404 `CAPTURE_NOT_FOUND`
    3. Reject 409 `CAPTURE_ALREADY_DISABLED` if `status = 'disabled'`
    4. `MongoCaptureConfigRepository.disable(id, actorIdentity)`
    5. `MongoResumeTokenRepository.delete(captureId)` — clean up resume token
    6. `MongoCaptureAuditRepository.append({ action: 'capture-disabled', before_state, after_state })`
    7. Publish lifecycle event
    8. Return 204
  - Pattern: mirror `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs`

- [ ] T010 [P] Create `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-list.mjs`
  - HTTP: `GET /workspaces/{workspaceId}/mongo-captures`
  - Query params: `status` (optional filter), `page`, `limit`
  - Returns `{ items: [...], total: N }` with full capture config objects
  - Always scoped by `(workspaceId, tenantId)` from JWT; never returns cross-tenant data
  - Pattern: mirror `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs`

- [ ] T011 [P] Create `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-tenant-summary.mjs`
  - HTTP: `GET /tenants/{tenantId}/mongo-captures/summary`
  - Returns `{ workspaces: [{ workspace_id, active_count, quota_max, collections: [...] }] }`
  - Scoped by `tenantId` from JWT; validates caller has tenant-level scope
  - Pattern: mirror `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs`

---

## Phase 4: Lifecycle Event Publisher (depends on Phase 2)

**Purpose**: Kafka audit events for all capture lifecycle operations.

- [ ] T012 Create `services/provisioning-orchestrator/src/events/realtime/MongoCaptureLifecyclePublisher.mjs`
  - Topic: `console.mongo-capture.lifecycle` (from env `MONGO_CAPTURE_KAFKA_TOPIC_LIFECYCLE`, default `console.mongo-capture.lifecycle`)
  - CloudEvents 1.0 envelope; event types:
    - `console.mongo-capture.capture-enabled`
    - `console.mongo-capture.capture-disabled`
    - `console.mongo-capture.capture-errored`
    - `console.mongo-capture.capture-paused`
    - `console.mongo-capture.capture-resumed`
    - `console.mongo-capture.quota-exceeded`
    - `console.mongo-capture.oversized-event`
    - `console.mongo-capture.stream-invalidated`
  - `publish({ eventType, captureId, tenantId, workspaceId, actorIdentity, beforeState?, afterState?, requestId? })` method
  - `kafkajs` producer with `acks: -1`; idempotent mode; mirrors `PgCaptureLifecyclePublisher` pattern from T02
  - Pattern: look for `services/provisioning-orchestrator/src/events/` T02 lifecycle publisher and adapt

---

## Phase 5: mongo-cdc-bridge Service (depends on Phase 1 models; parallelizable with Phases 2–4)

**Purpose**: Long-running Kubernetes Deployment that opens MongoDB change streams and publishes to Kafka.

- [ ] T013 Bootstrap `services/mongo-cdc-bridge/package.json`
  - `"type": "module"`, `"name": "@falcone/mongo-cdc-bridge"`
  - Dependencies: `mongodb` (official driver), `kafkajs`, `pg`
  - Dev dependencies: Node.js built-in `node:test`
  - Scripts: `start`, `test`, `test:unit`, `test:integration`
  - Pattern: mirror `services/pg-cdc-bridge/package.json` structure

- [ ] T014 Create `services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs`
  - Polls `mongo_capture_configs` (WHERE `status = 'active'`) every `MONGO_CDC_CACHE_TTL_SECONDS` (default 30 s) via `pg`
  - On initial load and each refresh: diffs current running set vs DB set; emits `'added'` and `'removed'` events (EventEmitter) per changed capture config
  - On DB error: logs error, returns stale cache (does not throw/crash)
  - Pattern: mirror `services/pg-cdc-bridge/src/CaptureConfigCache.mjs`

- [ ] T015 [P] Create `services/mongo-cdc-bridge/src/ResumeTokenStore.mjs`
  - `get(captureId)`: SELECT `resume_token` FROM `mongo_capture_resume_tokens`; returns JSONB object or `null`
  - `upsert(captureId, resumeToken)`: INSERT ... ON CONFLICT DO UPDATE SET `resume_token = $2, updated_at = now()`
  - Uses `pg` pool; same connection factory pattern as provisioning-orchestrator repositories

- [ ] T016 [P] Create `services/mongo-cdc-bridge/src/MongoChangeEventMapper.mjs`
  - `map(rawChangeDoc, captureConfig)` → CloudEvents envelope (`MongoChangeEvent` schema from T003)
  - Handles operation types: `insert`, `update`, `replace`, `delete`
  - `delta` mode: sets `full_document = null` for updates; includes `update_description`
  - `full-document` mode: includes `full_document`; sets `update_description = null`
  - Deletes: `full_document = null` always; includes `document_key`
  - Maps `clusterTime` (Timestamp → ISO8601); maps `wallTime` if present (MongoDB 6+ field)
  - Maps `documentKey._id` for ObjectId, string, and composite key shapes
  - Generates unique `id` (UUIDv4) per event for consumer deduplication
  - Exports pure `map` function (no side effects; easy to unit test)

- [ ] T017 Create `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs`
  - `kafkajs` idempotent producer; `acks: -1`; brokers from `MONGO_CDC_KAFKA_BROKERS`; client ID from `MONGO_CDC_KAFKA_CLIENT_ID` (default `mongo-cdc-bridge`)
  - `publish(topic, partitionKey, cloudeventsEnvelope, headers)` async method
  - Partition key: `{workspaceId}:{database_name}.{collection_name}` (ensures per-collection ordering within workspace)
  - Message headers: `ce-type`, `ce-source`, `ce-tenantid`, `ce-workspaceid`
  - Resolves Kafka topic from `realtime_channels.kafka_topic_pattern` for workspace `mongodb-changes` channel (T01); fallback: `{tenantId}.{workspaceId}.mongo-changes`
  - Exposes `connect()` and `disconnect()` lifecycle methods
  - Pattern: mirror `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs`

- [ ] T018 Create `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`
  - One instance per active `mongo_capture_configs` row
  - Constructor: `({ captureConfig, mongoClient, kafkaPublisher, resumeTokenStore, auditCallback, statusUpdateCallback })`
  - `start()`: loads resume token via `ResumeTokenStore.get(captureId)`; opens MongoDB change stream on `client.db(database_name).collection(collection_name).watch(pipeline, options)`
    - `pipeline`: `[{ $match: { operationType: { $in: ['insert','update','replace','delete'] } } }]`
    - `options.fullDocument`: `'updateLookup'` for full-document mode; `'whenAvailable'` for delta mode
    - `options.resumeAfter`: stored token if present; else `options.startAtOperationTime = now`
  - **Event processing loop** per raw change doc:
    1. `MongoChangeEventMapper.map(rawDoc, captureConfig)` → CloudEvents envelope
    2. Measure serialized size; if > `MONGO_CDC_MAX_MESSAGE_BYTES`: call `auditCallback('capture-oversized-event', ...)`, publish lightweight reference event (`{ event_type, collection_name, document_key, capture_config_id, reason: 'oversized' }`), skip full event; else publish full event
    3. `await kafkaPublisher.publish(topic, partitionKey, envelope, headers)`
    4. After Kafka ack: `await resumeTokenStore.upsert(captureId, rawDoc._id)`
  - **`ChangeStreamInvalidateError` handling**: catch → call `statusUpdateCallback('errored', lastError)` → call `auditCallback('capture-stream-invalidated', ...)` → stop this watcher only (no throw)
  - **Transient reconnect**: exponential backoff (1 s → 2 s → 4 s ... max 60 s); up to `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` (default 10) retries before calling `statusUpdateCallback('errored', 'max-reconnect-exceeded')` and stopping
  - `stop()`: gracefully closes MongoDB change stream cursor; no further events processed
  - Exposes `isHealthy()` boolean for health endpoint

- [ ] T019 Create `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs`
  - Orchestrates all active `ChangeStreamWatcher` instances
  - `start()` sequence:
    1. `MongoCaptureConfigCache.load()` (initial load)
    2. For each active config: get resume token → `new ChangeStreamWatcher(...).start()`
    3. Register `MongoCaptureConfigCache` `'added'` event → start new watcher
    4. Register `MongoCaptureConfigCache` `'removed'` event → call `watcher.stop()` and remove from registry
    5. Start hot-reload poll timer
  - Maintains `Map<captureId, ChangeStreamWatcher>` registry
  - Provides `getActiveWatchers()` for health endpoint
  - Provides `shutdown()`: stops all watchers and disconnects MongoDB clients and Kafka producer

- [ ] T020 [P] Create `services/mongo-cdc-bridge/src/HealthServer.mjs`
  - HTTP server on port `MONGO_CDC_HEALTH_PORT` (default `8080`)
  - `GET /health`: returns `200 { status: 'ok', activeStreams: N, unhealthyStreams: [] }` if all watchers healthy; `503 { status: 'degraded', unhealthyStreams: [...] }` if any watcher is not healthy
  - `GET /metrics`: plain-text Prometheus format exposing metrics from `MetricsCollector`
  - Pattern: mirror `services/pg-cdc-bridge/src/HealthServer.mjs`

- [ ] T021 [P] Create `services/mongo-cdc-bridge/src/MetricsCollector.mjs`
  - Tracks and exposes:
    - `mongo_cdc_events_published_total{workspace_id, collection}` — counter
    - `mongo_cdc_publish_lag_seconds{workspace_id}` — histogram (wall time from `clusterTime` to Kafka ack)
    - `mongo_cdc_watcher_error_count{workspace_id, capture_id}` — counter
    - `mongo_cdc_active_streams_gauge` — gauge (count of active `ChangeStreamWatcher` instances)
  - Prometheus plain-text format output for `/metrics`

- [ ] T022 Create `services/mongo-cdc-bridge/src/index.mjs`
  - Entry point: reads all env vars with defaults; validates required vars (`MONGO_CDC_PG_CONNECTION_STRING`, `MONGO_CDC_KAFKA_BROKERS`)
  - Instantiates `pg.Pool`, Kafka producer, `MongoCaptureConfigCache`, `ChangeStreamManager`, `HealthServer`
  - Starts `HealthServer` then `ChangeStreamManager`
  - Registers SIGTERM/SIGINT handlers for graceful shutdown: `manager.shutdown()` then `healthServer.close()` then `pgPool.end()`
  - Pattern: mirror `services/pg-cdc-bridge/src/index.mjs`

**Checkpoint**: Bridge service fully scaffolded. Begin Phase 6 and tests.

---

## Phase 6: Helm Chart (depends on Phase 5 service scaffolding)

**Purpose**: Kubernetes deployment descriptor for `mongo-cdc-bridge`.

- [ ] T023 Create `services/mongo-cdc-bridge/helm/mongo-cdc-bridge/Chart.yaml`
  - `apiVersion: v2`, `name: mongo-cdc-bridge`, version matching service version
  - Description: "MongoDB Change Stream CDC bridge for Falcone realtime pipeline"

- [ ] T024 [P] Create `services/mongo-cdc-bridge/helm/mongo-cdc-bridge/templates/deployment.yaml`
  - Kind: `Deployment`, 1 replica (singleton; resume tokens ensure consistency)
  - Image: `{{ .Values.image.repository }}:{{ .Values.image.tag }}`
  - EnvFrom `configMapRef` for non-secret env vars
  - Env from Secrets for `MONGO_CDC_PG_CONNECTION_STRING`, `MONGO_CDC_KAFKA_BROKERS`
  - LivenessProbe + ReadinessProbe: `httpGet /health :8080`
  - Resources: requests `cpu: 100m, memory: 256Mi`; limits `cpu: 500m, memory: 512Mi`

- [ ] T025 [P] Create `services/mongo-cdc-bridge/helm/mongo-cdc-bridge/templates/configmap.yaml`
  - ConfigMap with all non-secret environment variables and their default values:
    `MONGO_CDC_CACHE_TTL_SECONDS`, `MONGO_CDC_MAX_RECONNECT_ATTEMPTS`, `MONGO_CDC_MAX_MESSAGE_BYTES`, `MONGO_CDC_MAX_EVENTS_PER_SECOND`, `MONGO_CAPTURE_DEFAULT_WORKSPACE_QUOTA`, `MONGO_CAPTURE_DEFAULT_TENANT_QUOTA`, `MONGO_CAPTURE_KAFKA_TOPIC_LIFECYCLE`, `MONGO_CDC_KAFKA_CLIENT_ID`, `MONGO_CDC_HEALTH_PORT`

- [ ] T026 [P] Create `services/mongo-cdc-bridge/helm/mongo-cdc-bridge/templates/service.yaml`
  - Kind: `Service`, ClusterIP, port 8080 (health/metrics)

---

## Phase 7: Unit & Integration Tests (parallel with Phases 2–6)

**Purpose**: Verify correctness of all components in isolation and end-to-end.

### Bridge unit tests

- [ ] T027 Create `services/mongo-cdc-bridge/tests/unit/MongoChangeEventMapper.test.mjs`
  - Uses `node:test` + `node:assert`
  - Test cases (each with explicit assertion):
    - `insert` operation: `event_type = 'insert'`, `full_document` present, `update_description = null`
    - `update` delta mode: `event_type = 'update'`, `update_description` present, `full_document = null`
    - `update` full-document mode: `event_type = 'update'`, `full_document` present, `update_description = null`
    - `replace` operation: `event_type = 'replace'`, `full_document` present
    - `delete` operation: `event_type = 'delete'`, `document_key` present, `full_document = null`
    - Missing `fullDocument` on delete (graceful null handling)
    - ObjectId `_id` in `document_key` serialized as string
    - String `_id` preserved
    - Composite key `_id` serialized as JSON
    - `clusterTime` mapped to ISO8601
    - `wallTime` mapped when present; absent field not set (or null)
    - CloudEvents `specversion = '1.0'` and `type = 'console.mongo-capture.change'` always present
    - Unique `id` (UUIDv4) generated per call

- [ ] T028 [P] Create `services/mongo-cdc-bridge/tests/unit/MongoCaptureConfigCache.test.mjs`
  - Uses `node:test`; mocks `pg.Pool` with stub query results
  - Test cases:
    - Initial load returns all active configs from DB
    - Cache hit within TTL avoids DB round-trip (call count = 1)
    - After TTL expiry, next access triggers DB reload
    - DB error during reload: returns stale cache, does not throw
    - `'added'` event emitted for config present in reload but absent before
    - `'removed'` event emitted for config absent in reload but present before
    - No events emitted when config set unchanged between polls

- [ ] T029 [P] Create `services/mongo-cdc-bridge/tests/unit/ResumeTokenStore.test.mjs`
  - Uses `node:test`; mocks `pg.Pool`
  - Test cases:
    - `upsert` executes correct SQL with `captureId` and `resumeToken` JSONB
    - `get` returns parsed resume token object when row exists
    - `get` returns `null` when no row found
    - `delete` executes DELETE by `capture_id`
    - DB error on `upsert` propagates exception

### Provisioning-orchestrator unit tests

- [ ] T030 [P] Create `services/provisioning-orchestrator/tests/unit/realtime/MongoCaptureConfig.test.mjs`
  - Uses `node:test`
  - Test cases:
    - Valid construction with all required fields
    - Throws `MONGO_CAPTURE_TENANT_ID_REQUIRED` on missing `tenant_id`
    - Throws on missing `workspace_id`, `data_source_ref`, `database_name`, `collection_name`, `actor_identity`
    - Throws `INVALID_MONGO_CAPTURE_STATUS` on unknown status value
    - Throws `INVALID_MONGO_CAPTURE_MODE` on unknown capture_mode value
    - `qualifiedNs()` returns `"mydb.products"` format
    - `static fromRow(row)` produces identical object to constructor call
    - Default `capture_mode = 'delta'` when not provided
    - Default `status = 'active'` when not provided

- [ ] T031 [P] Create `services/provisioning-orchestrator/tests/unit/realtime/MongoCaptureConfigRepository.test.mjs`
  - Uses `node:test`; mocks `pg.Pool` with transaction stub
  - Test cases:
    - `create()` within quota inserts and returns new config
    - `create()` over workspace quota throws `QUOTA_EXCEEDED`
    - `create()` over tenant quota throws `QUOTA_EXCEEDED`
    - `create()` on duplicate (workspace+datasource+db+collection) returns `CAPTURE_ALREADY_ACTIVE` signal
    - `findActive(dataSourceRef)` returns only `status = 'active'` rows
    - `findByWorkspace(tenantId, workspaceId)` scopes by both tenant and workspace (verify predicate)
    - `updateStatus` updates status and `updated_at`
    - `disable` sets `status = 'disabled'` and stamps `deactivation_ts`

- [ ] T032 [P] Create `services/provisioning-orchestrator/tests/unit/realtime/mongo-capture-enable.test.mjs`
  - Uses `node:test`; mocks all repository and publisher dependencies
  - Test cases:
    - Valid request → 201 with capture config JSON
    - Missing `data_source_ref` → 400
    - Missing `collection_name` → 400
    - Workspace quota exceeded → 429 `QUOTA_EXCEEDED`
    - Collection not found in data source → 404 `COLLECTION_NOT_FOUND`
    - MongoDB standalone (not replica set) → 400 `REPLICA_SET_REQUIRED`
    - Duplicate enable on active capture → 409 `CAPTURE_ALREADY_ACTIVE`
    - Audit `append` called exactly once on success
    - Lifecycle event published exactly once on success
    - Invalid JWT → 401

- [ ] T033 [P] Create `services/provisioning-orchestrator/tests/unit/realtime/mongo-capture-disable.test.mjs`
  - Uses `node:test`; mocks repositories
  - Test cases:
    - Valid disable → 204; `status` set to `disabled`; resume token deleted
    - Capture not found → 404 `CAPTURE_NOT_FOUND`
    - Already disabled → 409 `CAPTURE_ALREADY_DISABLED`
    - Audit `append` called with `action = 'capture-disabled'` and `before_state` / `after_state`
    - Lifecycle event published on success

### Integration tests

- [ ] T034 Create `services/mongo-cdc-bridge/tests/integration/mongo-capture-to-kafka.integration.test.mjs`
  - Requires local MongoDB replica set (`MONGO_TEST_URI`), local Kafka (`KAFKA_TEST_BROKERS`), local PostgreSQL (`PG_TEST_CONNECTION_STRING`)
  - Uses `node:test`; each scenario is an isolated test
  - **Scenario 1** (FR-003, SC-001): Enable capture on `products` → INSERT → consume from topic → assert CloudEvents envelope matches `MongoChangeEvent` schema; assert delivery within 5 s
  - **Scenario 2** (FR-005): UPDATE in delta mode → assert `event_type = 'update'`, `update_description` present, `full_document = null`
  - **Scenario 3** (FR-005): UPDATE in full-document mode → assert `full_document` contains post-image, `update_description = null`
  - **Scenario 4**: REPLACE → assert `event_type = 'replace'`, `full_document` contains replacement document
  - **Scenario 5**: DELETE → assert `event_type = 'delete'`, `document_key` present, `full_document = null`
  - **Scenario 6** (FR-002): Disable capture → INSERT → assert no new event on topic within 5 s
  - **Scenario 7** (FR-006, SC-004): Kill bridge process mid-stream → restart → assert no gap via resume token continuity (duplicate events acceptable)
  - **Scenario 8** (FR-009, SC-006): Two workspaces on same MongoDB cluster → concurrent mutations → assert events from WS-A never appear on WS-B topic
  - **Scenario 9** (SC-003): 500 concurrent INSERTs on captured collection → assert all 500 events published; assert insertion order maintained within partition
  - **Scenario 10** (FR-010): Drop captured collection (triggers `ChangeStreamInvalidate`) → assert capture marked `errored` in DB → assert second active capture on same data source continues unaffected
  - **Scenario 11** (FR-007, SC-005): Concurrent enable requests against workspace quota (e.g., 3 concurrent at quota limit of 2) → assert exactly `quota_max` succeed; assert no over-allocation in `mongo_capture_configs`
  - **Scenario 12** (FR-013): Document mutation whose serialized event exceeds `MONGO_CDC_MAX_MESSAGE_BYTES` → assert reference event published to topic; assert `capture-oversized-event` in `mongo_capture_audit_log`
  - **Scenario 13** (FR-008, SC-002): Enable capture → query `mongo_capture_audit_log` → assert row with `action = 'capture-enabled'`, correct `actor_identity`, `workspace_id`, `tenant_id`, `collection_name`, and `created_at` within 30 s

---

## Phase 8: Internal Contract Schemas (depends on Phase 5 MongoChangeEventMapper stabilization)

**Purpose**: JSON Schema artifacts for Kafka event contracts used by consumers and contract test suite.

- [ ] T035 Create `services/internal-contracts/mongo-capture-change-event.json`
  - JSON Schema draft-07 validating the full CloudEvents `MongoChangeEvent` envelope
  - Required top-level: `specversion`, `type`, `source`, `id`, `time`, `tenantid`, `workspaceid`, `data`
  - `data` required: `event_type` (enum: insert|update|replace|delete), `database_name`, `collection_name`, `document_key`, `capture_mode`, `capture_config_id`
  - `data.full_document` nullable object
  - `data.update_description` nullable object with `updatedFields` (object) and `removedFields` (array)
  - `data.cluster_time` ISO8601 string
  - Pattern: mirror `services/internal-contracts/pg-capture-change-event.json` adapted for MongoDB fields

- [ ] T036 [P] Create `services/internal-contracts/mongo-capture-lifecycle-event.json`
  - JSON Schema for `console.mongo-capture.lifecycle` topic events
  - `type` enum: all 8 lifecycle event types from §2.6 of plan
  - Required `data` fields: `capture_id`, `tenant_id`, `workspace_id`, `actor_identity`, `action`
  - Optional `data` fields: `before_state`, `after_state`, `request_id`, `error_detail`
  - Pattern: mirror `services/internal-contracts/pg-capture-lifecycle-event.json`

- [ ] T037 [P] Patch `services/internal-contracts/domain-model.json` — add three new entity definitions:
  - `MongoCaptureConfig` (attributes: id, tenant_id, workspace_id, data_source_ref, database_name, collection_name, capture_mode, status, activation_ts, deactivation_ts, actor_identity, last_error)
  - `MongoCaptureQuota` (attributes: id, scope, scope_id, max_collections)
  - `MongoChangeEvent` (attributes: specversion, type, source, id, time, tenantid, workspaceid, data)
  - Add business invariant `BI-MONGO-CAPTURE-001`: "A change event from a captured MongoDB collection MUST NOT be delivered to a Kafka topic associated with a different workspace"
  - Do not modify existing entities

- [ ] T038 [P] Patch `services/internal-contracts/public-route-catalog.json` — add 4 new route entries:
  - `enableMongoCapture`: `POST /v1/realtime/workspaces/{workspaceId}/mongo-captures`, `resourceType: 'mongo_capture'`, `family: 'realtime'`, `tenantBinding: 'required'`, `workspaceBinding: 'required'`, `supportsIdempotencyKey: false`, `rateLimitClass: 'provisioning'`
  - `disableMongoCapture`: `DELETE /v1/realtime/workspaces/{workspaceId}/mongo-captures/{captureId}`, same profile minus idempotency key
  - `listMongoCaptures`: `GET /v1/realtime/workspaces/{workspaceId}/mongo-captures`, `rateLimitClass: 'read'`
  - `mongoCaptureTenantSummary`: `GET /v1/realtime/tenants/{tenantId}/mongo-captures/summary`, `tenantBinding: 'required'`, `workspaceBinding: 'none'`, `rateLimitClass: 'read'`
  - Match existing route shape exactly; do not modify existing entries

- [ ] T039 [P] Patch `services/internal-contracts/internal-service-map.json` — add `mongo-cdc-bridge` service entry with:
  - `responsibilities`: ["Opens MongoDB change streams for active captures", "Maps MongoDB change events to CloudEvents schema", "Publishes change events to per-workspace Kafka topics at-least-once", "Persists resume tokens after confirmed Kafka publish", "Detects and handles ChangeStreamInvalidate events", "Hot-reloads capture config from PostgreSQL without restart"]
  - `kafka_produces`: [`{tenantId}.{workspaceId}.mongo-changes`, `console.mongo-capture.lifecycle`]
  - `kafka_consumes`: []
  - `postgres_tables_read`: [`mongo_capture_configs`, `mongo_capture_resume_tokens`]
  - `postgres_tables_write`: [`mongo_capture_resume_tokens`]

---

## Phase 9: Gateway Config & OpenAPI Contract Update (depends on Phase 3)

**Purpose**: Expose new endpoints via APISIX and update public API contract.

- [ ] T040 Update `services/gateway-config/base/public-api-routing.yaml`
  - Add 4 APISIX route entries (one per action in Phase 3), mapping:
    - `POST /v1/realtime/workspaces/{workspaceId}/mongo-captures` → OpenWhisk action `realtime/mongo-capture-enable`
    - `DELETE /v1/realtime/workspaces/{workspaceId}/mongo-captures/{captureId}` → `realtime/mongo-capture-disable`
    - `GET /v1/realtime/workspaces/{workspaceId}/mongo-captures` → `realtime/mongo-capture-list`
    - `GET /v1/realtime/tenants/{tenantId}/mongo-captures/summary` → `realtime/mongo-capture-tenant-summary`
  - Follow existing route entry shape in file (auth plugin ref, upstream, methods, uri)
  - Do not modify existing routes

- [ ] T041 [P] Create OpenAPI fragment `services/gateway-config/openapi-fragments/mongo-capture.openapi.json`
  - Contains only the 4 paths and their request/response schemas as defined in plan §2.9
  - Schemas: request body for enable (data_source_ref, database_name, collection_name, capture_mode), response 201 capture config, response 200 list, response 200 tenant summary
  - Error codes: QUOTA_EXCEEDED (429), COLLECTION_NOT_FOUND (404), DATA_SOURCE_NOT_ACCESSIBLE (400), REPLICA_SET_REQUIRED (400), CAPTURE_ALREADY_ACTIVE (409), CAPTURE_NOT_FOUND (404), CAPTURE_ALREADY_DISABLED (409)
  - **Do NOT modify `control-plane.openapi.json`** directly — fragment will be merged by CI pipeline

---

## Completion Checklist

Before marking this story done, verify every Criterion of Done from plan §7:

- [ ] `npm run migrate:up` and `npm run migrate:down` succeed cleanly in provisioning-orchestrator
- [ ] `mongo-capture-enable` returns 201 for valid request (unit test + smoke test)
- [ ] INSERT on captured collection produces Kafka event within 5 s (integration test scenario 1)
- [ ] UPDATE delta mode contains `update_description` without `full_document` (scenario 2)
- [ ] UPDATE full-document mode contains `full_document` (scenario 3)
- [ ] DELETE contains `document_key` (scenario 5)
- [ ] No cross-workspace leakage under concurrent load (scenario 8)
- [ ] At-least-once delivery across bridge restart (scenario 7)
- [ ] `ChangeStreamInvalidate` does not cascade to other active captures (scenario 10)
- [ ] Audit record queryable within 30 s of lifecycle operation (scenario 13)
- [ ] Quota race-condition guard: no over-allocation (scenario 11)
- [ ] Oversized event produces reference event + audit log (scenario 12)
- [ ] `/health` reflects stream health
- [ ] All unit tests pass with no skips (`pnpm test` in both services exits 0)
- [ ] `services/gateway-config/openapi-fragments/mongo-capture.openapi.json` created; CI contract validation passes
- [ ] Kafka schema contract tests pass (`internal-contracts` test suite)
- [ ] `helm install mongo-cdc-bridge ./services/mongo-cdc-bridge/helm/mongo-cdc-bridge` succeeds

---

## Environment Variables Reference

| Variable | Default | Service | Notes |
|---|---|---|---|
| `MONGO_CDC_CACHE_TTL_SECONDS` | `30` | mongo-cdc-bridge | Config hot-reload interval |
| `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` | `10` | mongo-cdc-bridge | Before marking capture errored |
| `MONGO_CDC_MAX_MESSAGE_BYTES` | `900000` | mongo-cdc-bridge | Kafka message size ceiling |
| `MONGO_CDC_MAX_EVENTS_PER_SECOND` | `1000` | mongo-cdc-bridge | Per-workspace rate limit |
| `MONGO_CDC_HEALTH_PORT` | `8080` | mongo-cdc-bridge | Health + metrics HTTP port |
| `MONGO_CDC_KAFKA_BROKERS` | (required) | mongo-cdc-bridge | Comma-separated broker list |
| `MONGO_CDC_KAFKA_CLIENT_ID` | `mongo-cdc-bridge` | mongo-cdc-bridge | Kafka producer identity |
| `MONGO_CDC_PG_CONNECTION_STRING` | (required) | mongo-cdc-bridge | PostgreSQL DSN |
| `MONGO_CAPTURE_DEFAULT_WORKSPACE_QUOTA` | `10` | provisioning-orchestrator | Max captured collections per workspace |
| `MONGO_CAPTURE_DEFAULT_TENANT_QUOTA` | `50` | provisioning-orchestrator | Max captured collections per tenant |
| `MONGO_CAPTURE_KAFKA_TOPIC_LIFECYCLE` | `console.mongo-capture.lifecycle` | provisioning-orchestrator | Lifecycle audit topic name |
