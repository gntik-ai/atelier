# Tasks: US-BKP-02-T01 — Exportación de configuración funcional de tenants

**Branch**: `115-functional-config-export`
**Input**: `specs/115-functional-config-export/{spec.md,plan.md,data-model.md,research.md,contracts/}`
**Story**: US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants
**Epic**: EP-20 — Backup, recuperación y continuidad operativa
**Task ID**: US-BKP-02-T01 | **Prioridad**: P1 | **Tamaño**: M
**Depends on**: US-TEN-04 (tenant model), US-BKP-01 (deployment profile)
**Excludes (sibling tasks)**: US-BKP-02-T02 through T06

## Format: `[ID] [P?] [Story?] Description — file/path`

- **[P]**: Can run in parallel (different files, no hard dependency on other open tasks)
- **[Story]**: Which user story this task belongs to
- All file paths are absolute relative to repo root

## File-Path Contract (implementation reference)

The following new files MUST be created by this implementation:

```text
# Backend — provisioning-orchestrator
services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql
services/provisioning-orchestrator/src/collectors/types.mjs
services/provisioning-orchestrator/src/collectors/registry.mjs
services/provisioning-orchestrator/src/collectors/iam-collector.mjs
services/provisioning-orchestrator/src/collectors/postgres-collector.mjs
services/provisioning-orchestrator/src/collectors/mongo-collector.mjs
services/provisioning-orchestrator/src/collectors/kafka-collector.mjs
services/provisioning-orchestrator/src/collectors/functions-collector.mjs
services/provisioning-orchestrator/src/collectors/s3-collector.mjs
services/provisioning-orchestrator/src/repositories/config-export-audit-repository.mjs
services/provisioning-orchestrator/src/events/config-export-events.mjs
services/provisioning-orchestrator/src/actions/tenant-config-export.mjs
services/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs

# Backend — unit tests (co-located alongside service tests)
services/provisioning-orchestrator/tests/collectors/iam-collector.test.mjs
services/provisioning-orchestrator/tests/collectors/postgres-collector.test.mjs
services/provisioning-orchestrator/tests/collectors/mongo-collector.test.mjs
services/provisioning-orchestrator/tests/collectors/kafka-collector.test.mjs
services/provisioning-orchestrator/tests/collectors/functions-collector.test.mjs
services/provisioning-orchestrator/tests/collectors/s3-collector.test.mjs
services/provisioning-orchestrator/tests/actions/tenant-config-export.action.test.mjs
services/provisioning-orchestrator/tests/actions/tenant-config-export-domains.action.test.mjs

# Frontend — web-console
apps/web-console/src/api/configExportApi.ts
apps/web-console/src/components/ConfigExportDomainSelector.tsx
apps/web-console/src/components/ConfigExportResultPanel.tsx
apps/web-console/src/pages/ConsoleTenantConfigExportPage.tsx
apps/web-console/src/__tests__/ConfigExportDomainSelector.test.tsx
apps/web-console/src/__tests__/ConfigExportResultPanel.test.tsx
apps/web-console/src/__tests__/ConsoleTenantConfigExportPage.test.tsx

# Integration tests
tests/integration/115-functional-config-export/export-api.test.mjs
tests/integration/115-functional-config-export/domains-api.test.mjs
tests/integration/115-functional-config-export/fixtures/tenant-seed.sql
tests/integration/115-functional-config-export/fixtures/keycloak-realm-seed.json
tests/integration/115-functional-config-export/helpers/mock-collectors.mjs

# Gateway and IAM (EXTEND existing files — do not recreate from scratch)
services/gateway-config/routes/backup-admin-routes.yaml      ← extend or create
services/keycloak-config/scopes/backup-scopes.yaml           ← extend or create
```

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Validate project environment, run prerequisites check, confirm branch is correct and structure is in place.

- [ ] T001 Verify branch `115-functional-config-export` is active, run `.specify/scripts/bash/check-prerequisites.sh --json` from repo root, and confirm FEATURE_DIR resolves to `specs/115-functional-config-export/`
- [ ] T002 [P] Confirm `services/provisioning-orchestrator/src/` directory structure exists with `actions/`, `events/`, `migrations/`, `repositories/` subdirectories and that `services/provisioning-orchestrator/tests/` exists for unit tests
- [ ] T003 [P] Confirm `apps/web-console/src/{api,components,pages,__tests__}/` directories exist or create them as needed for console work

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, registry skeleton, DB migration, audit repository, and Kafka event publisher — no user-story logic yet. All subsequent phases depend on this being complete.

**⚠️ CRITICAL**: No collector or action work can begin until T004–T010 are complete.

- [ ] T004 Create shared types contract — `services/provisioning-orchestrator/src/collectors/types.mjs`
  - Export `DomainStatus` union (`'ok' | 'empty' | 'error' | 'not_available' | 'not_requested'`)
  - Export `CollectorResult` interface (domain_key, status, exported_at, items_count?, data?, error?, reason?)
  - Export `ExportArtifact` interface (export_timestamp, tenant_id, format_version, deployment_profile, correlation_id, domains[])
  - Export `DomainAvailability` and `ExportDomainsResponse` interfaces
  - Export `redactSensitiveFields(obj, extraKeys?)` — dual-layer redaction: explicit key list (secret/password/passwd/token/key/credential/private/auth) + JWT/AWS/PEM pattern heuristic; replaces matched values with `"***REDACTED***"`

- [ ] T005 Create collector registry skeleton — `services/provisioning-orchestrator/src/collectors/registry.mjs`
  - Export `getRegistry(deploymentProfile)` returning a Map of `domainKey → collectorFn`
  - Read `CONFIG_EXPORT_OW_ENABLED` (default `false`) and `CONFIG_EXPORT_MONGO_ENABLED` (default `false`) to conditionally register functions and mongo collectors
  - Read `CONFIG_EXPORT_DEPLOYMENT_PROFILE` (default `standard`) for profile-based availability
  - Stub entries: each unregistered domain returns a `not_available` CollectorResult
  - Export `KNOWN_DOMAINS` constant list: `['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']`

- [ ] T006 Create database migration — `services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql`
  - CREATE TABLE IF NOT EXISTS `config_export_audit_log` with all columns per data-model.md DDL: id UUID PK, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_type TEXT CHECK IN ('superadmin','sre','service_account'), domains_requested TEXT[] NOT NULL, domains_exported TEXT[] NOT NULL, domains_failed TEXT[] NOT NULL DEFAULT '{}', domains_not_available TEXT[] NOT NULL DEFAULT '{}', result_status TEXT CHECK IN ('ok','partial','failed'), artifact_bytes INT, format_version TEXT NOT NULL DEFAULT '1.0', correlation_id TEXT NOT NULL, export_started_at TIMESTAMPTZ NOT NULL, export_ended_at TIMESTAMPTZ NOT NULL, error_detail TEXT
  - CREATE INDEX idx_config_export_tenant ON config_export_audit_log(tenant_id, export_started_at DESC)
  - CREATE INDEX idx_config_export_actor ON config_export_audit_log(actor_id, export_started_at DESC)
  - CREATE INDEX idx_config_export_corr_id ON config_export_audit_log(correlation_id)

- [ ] T007 [P] Create audit log repository — `services/provisioning-orchestrator/src/repositories/config-export-audit-repository.mjs`
  - Export `insertExportAuditLog(pgClient, record)` — inserts a row into `config_export_audit_log`; record shape matches table columns exactly
  - Input validation: required fields checked; actor_type validated against allowed enum
  - Uses parameterized queries; no raw string interpolation

- [ ] T008 [P] Create Kafka event publisher — `services/provisioning-orchestrator/src/events/config-export-events.mjs`
  - Export `publishExportCompleted(kafkaProducer, eventPayload)` — publishes to topic `CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED` (env var, default `console.config.export.completed`)
  - Event schema per data-model.md: event_type, schema_version '1.0', correlation_id, tenant_id, actor_id, actor_type, domains_requested[], domains_exported[], domains_failed[], domains_not_available[], result_status, artifact_bytes, format_version, export_started_at, export_ended_at, emitted_at
  - Fire-and-forget: catches and logs Kafka errors without throwing; export does NOT abort on Kafka failure

**Checkpoint**: Foundation ready — types, registry, migration, audit repo, event publisher are all in place.

---

## Phase 3: User Story 1 — Exportación completa con orquestador y recolectores (P1) 🎯 MVP

**Goal**: Implement the main export orchestrator action, all six domain collectors, and the auxiliary domains endpoint. Together these deliver the full export capability (RF-T01-01 through RF-T01-12).

**Independent Test**: POST `/v1/admin/tenants/{tenant_id}/config/export` returns a JSON artifact with `export_timestamp`, `tenant_id`, `format_version: "1.0"`, `deployment_profile`, and a `domains` array containing one entry per enabled domain with `status` ∈ {ok, empty, error, not_available}.

---

### Phase 3A: Core Orchestrator Action (US1)

- [ ] T009 [US1] Implement main export orchestrator action — `services/provisioning-orchestrator/src/actions/tenant-config-export.mjs`
  - OpenWhisk action entry point: `export async function main(params)`
  - Extract and validate JWT from `params.__ow_headers.authorization`; verify roles (`superadmin`, `sre`, `service_account`) and scope `platform:admin:config:export`; return 403 if unauthorized; return 404 if tenant not found (call tenant existence check)
  - Parse optional `domains` body param; validate against `KNOWN_DOMAINS`; return 400 for unknown domains; if absent, use all available domains
  - Generate `correlation_id` (e.g., `req-${nanoid(10)}` or UUID v4)
  - Resolve `deploymentProfile` from `CONFIG_EXPORT_DEPLOYMENT_PROFILE` env var (default `standard`)
  - Build collector invocations from registry; apply `CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS` (default 8000) timeout per collector using `Promise.race` with a timeout rejection
  - Run all collectors in parallel using `Promise.allSettled`; map each result to a `CollectorResult`; handle rejected promises as `status: 'error'` with error message
  - Build `ExportArtifact` per data-model.md spec: all metadata fields + domains array
  - Check artifact JSON byte size; if > `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` (default 10485760) return 422 with size info
  - Determine HTTP status: 200 if all domains ok/empty/not_available, 207 if any domain has `status: 'error'`
  - Call `insertExportAuditLog` (PostgreSQL); call `publishExportCompleted` (Kafka, fire-and-forget)
  - Return artifact as HTTP response body

- [ ] T010 [US1] Implement auxiliary domains endpoint action — `services/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs`
  - OpenWhisk action entry point: `export async function main(params)`
  - Same auth check as T009 (same roles + scope)
  - Verify tenant exists; return 404 if not
  - Resolve deployment profile from env var
  - For each known domain, determine `availability` from registry (available / not_available / degraded)
  - Return `ExportDomainsResponse` per data-model.md: tenant_id, deployment_profile, queried_at (ISO UTC), domains[{domain_key, availability, description, reason?}]

---

### Phase 3B: Domain Collectors (US1) — implement in complexity-ascending order per plan

- [ ] T011 [P] [US1] Implement IAM collector — `services/provisioning-orchestrator/src/collectors/iam-collector.mjs`
  - Export `async function collect(tenantId, options)` returning `CollectorResult`
  - Reads env vars: `CONFIG_EXPORT_KEYCLOAK_ADMIN_URL`, `CONFIG_EXPORT_KEYCLOAK_REALM`, `CONFIG_EXPORT_KEYCLOAK_CLIENT_ID`, `CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET`
  - Obtains service-account token via `POST /realms/master/protocol/openid-connect/token` (client_credentials)
  - Extracts: realm settings (displayName, SSO/token lifespans, login/email themes, sslRequired), roles, groups, clients (with `secret: "***REDACTED***"`), client scopes, identity providers, realm role mappings — all filtered to tenant realm (realm = `tenantId` or configured prefix)
  - Applies `redactSensitiveFields` from types.mjs to entire data payload before returning
  - Returns `status: 'empty'` if realm exists but has no custom configuration; `status: 'error'` on fetch failure

- [ ] T012 [P] [US1] Implement S3 storage collector — `services/provisioning-orchestrator/src/collectors/s3-collector.mjs`
  - Export `async function collect(tenantId, options)` returning `CollectorResult`
  - Reads env vars: `CONFIG_EXPORT_S3_ENDPOINT`, `CONFIG_EXPORT_S3_ACCESS_KEY_ID`, `CONFIG_EXPORT_S3_SECRET_ACCESS_KEY`
  - Lists buckets filtered by prefix `{tenantId}-` (or tenant-scoped by naming convention per research.md)
  - For each bucket: retrieves versioning configuration, lifecycle rules, bucket policy (JSON), and CORS rules (if configured)
  - Assembles `data.buckets[]` per data-model.md schema: name, region, versioning, lifecycle_rules, bucket_policy, cors_rules
  - No secret redaction needed in bucket policies (credentials excluded by design per research.md R-04); applies `redactSensitiveFields` as safety net
  - Returns `status: 'empty'` if no buckets found; `status: 'not_available'` if endpoint env var absent

- [ ] T013 [P] [US1] Implement Kafka collector — `services/provisioning-orchestrator/src/collectors/kafka-collector.mjs`
  - Export `async function collect(tenantId, options)` returning `CollectorResult`
  - Reads env vars: `CONFIG_EXPORT_KAFKA_BROKERS`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD`
  - Instantiates `kafkajs` Admin client; connects
  - Lists all topics; filters by prefix `{tenantId}.`
  - For each tenant topic: fetches partition count, replication factor, topic-level config overrides (retention.ms, cleanup.policy, etc.)
  - Fetches ACLs: uses `describeAcls` or equivalent; filters by resourceName prefix `{tenantId}.`; if client-side filtering required, fetches all and filters (per research.md section 8)
  - Lists consumer groups filtered by prefix `{tenantId}.cg.`; includes group state and member count (no offset data)
  - Assembles `data.{topics[], acls[], consumer_groups[]}` per data-model.md schema
  - Disconnects Admin client in finally block
  - Applies `redactSensitiveFields` (catches any sasl.password leakage)
  - Returns `status: 'empty'` if no tenant topics found

- [ ] T014 [P] [US1] Implement PostgreSQL metadata collector — `services/provisioning-orchestrator/src/collectors/postgres-collector.mjs`
  - Export `async function collect(tenantId, options)` returning `CollectorResult`
  - Reads env var: `CONFIG_EXPORT_PG_DATABASE_URL`
  - Creates `pg.Pool` from DSN; queries `information_schema` and `pg_catalog`
  - For tenant schema (schema_name = tenantId or configured prefix via `CONFIG_EXPORT_PG_SCHEMA_PREFIX`):
    - Tables: `information_schema.tables` → columns (`information_schema.columns` with data_type, is_nullable, column_default), constraints (`information_schema.table_constraints` + `information_schema.key_column_usage`), indexes (`pg_indexes`)
    - Views: `information_schema.views` with view_definition
    - Extensions: `pg_extension` listing
    - Grants: `information_schema.role_table_grants` and `information_schema.role_usage_grants` scoped to schema
  - Assembles `data.schemas[]` per data-model.md: schema_name, owner, tables[], views[], extensions[], grants[]
  - Closes pool in finally block
  - Returns `status: 'empty'` if schema exists but has no tables/views; `status: 'error'` on connection/query failure

- [ ] T015 [P] [US1] Implement OpenWhisk functions collector — `services/provisioning-orchestrator/src/collectors/functions-collector.mjs`
  - Export `async function collect(tenantId, options)` returning `CollectorResult`
  - Returns `{ status: 'not_available', ... }` immediately if `CONFIG_EXPORT_OW_ENABLED !== 'true'`
  - Reads env vars: `CONFIG_EXPORT_OW_API_HOST`, `CONFIG_EXPORT_OW_AUTH_TOKEN`
  - Uses `undici` (or `fetch`) to call OpenWhisk REST API: `GET /api/v1/namespaces/{tenantId}/actions`, `GET /api/v1/namespaces/{tenantId}/packages`, `GET /api/v1/namespaces/{tenantId}/triggers`, `GET /api/v1/namespaces/{tenantId}/rules`
  - For each action: retrieves full action definition (kind, limits, parameters, annotations); fetches `exec.code` and base64-encodes as `code_base64`; if code unavailable (e.g., ZIP attachment), sets `code_base64: null, code_available: false`
  - Redacts `parameters` entries where `encrypt: true` OR where key matches sensitive patterns — sets `value: "***REDACTED***"`
  - Assembles `data.{namespace, actions[], packages[], triggers[], rules[]}` per data-model.md schema
  - Returns `status: 'empty'` if namespace has no actions/packages

- [ ] T016 [P] [US1] Implement MongoDB metadata collector — `services/provisioning-orchestrator/src/collectors/mongo-collector.mjs`
  - Export `async function collect(tenantId, options)` returning `CollectorResult`
  - Returns `{ status: 'not_available', ... }` immediately if `CONFIG_EXPORT_MONGO_ENABLED !== 'true'`
  - Reads env var: `CONFIG_EXPORT_MONGO_URI`
  - Connects using `mongodb` driver `MongoClient`; targets database = `tenantId` or prefix from `CONFIG_EXPORT_MONGO_DB_PREFIX`
  - For each database matching tenant scope: runs `listCollections()`, and for each collection: `aggregate([{ $indexStats: {} }])` or `collection.indexes()` for index info; retrieves validator/jsonSchema from collection options
  - If sharding info accessible via `db.admin().command({ listShards: 1 })`, captures shard config; otherwise `sharding: null`
  - Assembles `data.databases[]` per data-model.md: db_name, collections[{collection_name, options, validator, indexes[]}], sharding
  - Closes client in finally block
  - Returns `status: 'empty'` if database exists but has no collections; `status: 'error'` on connection failure

---

### Phase 3C: Unit Tests — Collectors and Actions (US1)

- [ ] T017 [P] [US1] Write unit tests for `iam-collector.mjs` — `services/provisioning-orchestrator/tests/collectors/iam-collector.test.mjs`
  - Uses `node:test` + `node:assert`; mocks `fetch`/`undici` for Keycloak Admin API responses
  - Test: successful collection returns `CollectorResult` with `status: 'ok'` and expected data shape
  - Test: client `secret` field is `"***REDACTED***"` in output
  - Test: tenant isolation — mock returns realm for correct tenantId only
  - Test: empty realm returns `status: 'empty'`
  - Test: Keycloak unreachable → `status: 'error'` with descriptive message

- [ ] T018 [P] [US1] Write unit tests for `postgres-collector.mjs` — `services/provisioning-orchestrator/tests/collectors/postgres-collector.test.mjs`
  - Mocks `pg.Pool` queries returning controlled `information_schema` rows
  - Test: schema with tables/columns/constraints/indexes returns correct nested structure
  - Test: schema with no tables returns `status: 'empty'`
  - Test: pg connection error → `status: 'error'`

- [ ] T019 [P] [US1] Write unit tests for `mongo-collector.mjs` — `services/provisioning-orchestrator/tests/collectors/mongo-collector.test.mjs`
  - Mocks `MongoClient` and `listCollections` / `indexes` commands
  - Test: successful collection returns `status: 'ok'` with databases/collections structure
  - Test: `CONFIG_EXPORT_MONGO_ENABLED=false` → `status: 'not_available'` without any network call
  - Test: mongo timeout → `status: 'error'` with message

- [ ] T020 [P] [US1] Write unit tests for `kafka-collector.mjs` — `services/provisioning-orchestrator/tests/collectors/kafka-collector.test.mjs`
  - Mocks `kafkajs.Kafka` Admin client with controlled topic/ACL/group lists
  - Test: topics filtered to `{tenantId}.` prefix only (multi-tenant isolation)
  - Test: ACLs filtered by tenantId prefix
  - Test: consumer groups filtered by `{tenantId}.cg.` prefix
  - Test: no tenant topics → `status: 'empty'`
  - Test: Kafka AdminClient connect failure → `status: 'error'`

- [ ] T021 [P] [US1] Write unit tests for `functions-collector.mjs` — `services/provisioning-orchestrator/tests/collectors/functions-collector.test.mjs`
  - Mocks OpenWhisk REST API responses via `undici` mock or fetch mock
  - Test: `CONFIG_EXPORT_OW_ENABLED=false` → `status: 'not_available'` (no network call)
  - Test: action parameter with `encrypt: true` → `value: "***REDACTED***"`
  - Test: action code included as base64 string
  - Test: code unavailable (non-inline action) → `code_base64: null, code_available: false`
  - Test: namespace with no actions → `status: 'empty'`

- [ ] T022 [P] [US1] Write unit tests for `s3-collector.mjs` — `services/provisioning-orchestrator/tests/collectors/s3-collector.test.mjs`
  - Mocks S3 API (ListBuckets, GetBucketVersioning, GetBucketLifecycle, GetBucketPolicy, GetBucketCors)
  - Test: buckets filtered by `{tenantId}-` prefix
  - Test: bucket with full config returns versioning, lifecycle, policy, cors
  - Test: no matching buckets → `status: 'empty'`
  - Test: S3 endpoint env var absent → `status: 'not_available'`

- [ ] T023 [US1] Write unit tests for orchestrator action `tenant-config-export.mjs` — `services/provisioning-orchestrator/tests/actions/tenant-config-export.action.test.mjs`
  - Uses mock registry from `tests/integration/115-functional-config-export/helpers/mock-collectors.mjs`
  - Test: all collectors succeed → HTTP 200 with valid `ExportArtifact` shape
  - Test: one collector (mongo) fails → HTTP 207; failing domain has `status: 'error'`; other domains have `status: 'ok'` or `status: 'empty'`
  - Test: collector timeout (exceeds `CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS`) → domain `status: 'error'`
  - Test: artifact too large → HTTP 422
  - Test: unauthorized role → HTTP 403
  - Test: unknown tenant → HTTP 404
  - Test: `domains` filter → artifact only contains requested domains (others absent or `status: 'not_requested'`)
  - Test: `ExportArtifact.format_version === '1.0'`
  - Test: `correlation_id` is present and non-empty
  - Test: `insertExportAuditLog` is called once per request
  - Test: `publishExportCompleted` is called once per request (fire-and-forget; even if Kafka mock throws, export succeeds)

- [ ] T024 [US1] Write unit tests for domains action `tenant-config-export-domains.mjs` — `services/provisioning-orchestrator/tests/actions/tenant-config-export-domains.action.test.mjs`
  - Test: standard profile with OW disabled → `functions` domain has `availability: 'not_available'`
  - Test: all six domains returned regardless of profile
  - Test: queried_at is present ISO UTC string
  - Test: unauthorized role → HTTP 403
  - Test: unknown tenant → HTTP 404

---

## Phase 4: User Story 2 — Gateway routing, IAM scopes, and Console UI (P2)

**Goal**: Expose the export API through APISIX (routing + JWT auth + rate limiting), register the Keycloak scope, and deliver the Console page with domain selector and result panel (RF-T01-01 via gateway, CA-08 authorization verified at gateway).

**Independent Test**: An authorized user can navigate to the Console export page, select domains, trigger export, and download the JSON artifact. An unauthorized user (tenant owner) receives 403 from APISIX before the action is even invoked.

---

### Phase 4A: Gateway and IAM (US2)

- [ ] T025 [US2] Extend or create APISIX routing — `services/gateway-config/routes/backup-admin-routes.yaml`
  - If file exists: add two new route entries following the pattern of existing backup routes
  - If file does not exist: create it following the pattern of closest routes YAML in `services/gateway-config/routes/`
  - Route 1: `POST /v1/admin/tenants/{tenant_id}/config/export` → upstream: `tenant-config-export` OpenWhisk action; auth: JWT validation plugin (Keycloak JWKS); required scope: `platform:admin:config:export`; rate-limit: configurable via APISIX plugin; upstream timeout: 30s (to accommodate collector parallelism ≤ 25s nominal)
  - Route 2: `GET /v1/admin/tenants/{tenant_id}/config/export/domains` → upstream: `tenant-config-export-domains`; same auth; shorter timeout: 10s
  - Denied roles: tenant_owner (not included in allow-list); returns 403 at gateway

- [ ] T026 [P] [US2] Extend or create Keycloak scope config — `services/keycloak-config/scopes/backup-scopes.yaml`
  - If file exists: add scope entry `platform:admin:config:export` with description and protocol mappers
  - If file does not exist: create it following the pattern of adjacent scope YAML files in `services/keycloak-config/scopes/`
  - Scope assigned to roles: `superadmin`, `sre`, `service_account`; NOT assigned to `tenant_owner`

---

### Phase 4B: Console Frontend (US2)

- [ ] T027 [US2] Implement API client layer — `apps/web-console/src/api/configExportApi.ts`
  - Export TypeScript types: `ExportRequest`, `DomainResult`, `ExportArtifact`, `ExportDomainsResponse` per data-model.md TypeScript types section
  - Export `async function getExportableDomains(tenantId: string): Promise<ExportDomainsResponse>` — GET `/v1/admin/tenants/{tenantId}/config/export/domains`
  - Export `async function exportTenantConfig(tenantId: string, request: ExportRequest): Promise<{ artifact: ExportArtifact; status: 200 | 207 }>` — POST to export endpoint; handles 200, 207, 403, 404, 422, 429 with typed errors
  - Include proper Content-Type headers; forward auth token from session context

- [ ] T028 [P] [US2] Implement `ConfigExportDomainSelector` component — `apps/web-console/src/components/ConfigExportDomainSelector.tsx`
  - Props: `domains: DomainAvailability[]`, `selectedDomains: string[]`, `onChange(domains: string[])`, `disabled?: boolean`
  - Renders a checkbox list with domain descriptions; disables checkboxes for `not_available` domains with a tooltip reason
  - Has a "Select All Available" shortcut
  - Accessible (ARIA labels, keyboard navigation)

- [ ] T029 [P] [US2] Implement `ConfigExportResultPanel` component — `apps/web-console/src/components/ConfigExportResultPanel.tsx`
  - Props: `artifact: ExportArtifact | null`, `isLoading: boolean`, `error?: string`
  - Shows loading spinner while `isLoading`
  - When artifact available: renders metadata header (tenant_id, format_version, export_timestamp, deployment_profile, correlation_id), domain status badges (ok=green, empty=grey, error=red, not_available=dimmed), and a "Download JSON" button that triggers browser download of the artifact as `config-export-{tenantId}-{timestamp}.json`
  - Shows inline error message for domains with `status: 'error'`

- [ ] T030 [US2] Implement `ConsoleTenantConfigExportPage` — `apps/web-console/src/pages/ConsoleTenantConfigExportPage.tsx`
  - Fetches `getExportableDomains` on mount
  - Renders `ConfigExportDomainSelector` (populated from domains response) and an "Export" button
  - On export trigger: calls `exportTenantConfig`; shows 207 partial warning if applicable; passes result to `ConfigExportResultPanel`
  - Handles 403 (show permission denied), 404 (show tenant not found), 422 (show artifact too large with domain filter hint), 429 (show rate-limited with retry hint)

---

### Phase 4C: Console Tests (US2)

- [ ] T031 [P] [US2] Write component tests for `ConfigExportDomainSelector` — `apps/web-console/src/__tests__/ConfigExportDomainSelector.test.tsx`
  - Uses `vitest` + React Testing Library
  - Test: renders all domains; disables not_available ones
  - Test: checkbox toggle fires `onChange` with updated selection
  - Test: "Select All Available" selects only available domains

- [ ] T032 [P] [US2] Write component tests for `ConfigExportResultPanel` — `apps/web-console/src/__tests__/ConfigExportResultPanel.test.tsx`
  - Test: loading state renders spinner
  - Test: artifact with mixed statuses renders correct badge colors
  - Test: "Download JSON" button triggers a download with correct filename
  - Test: domain with `status: 'error'` shows error message

- [ ] T033 [US2] Write page tests for `ConsoleTenantConfigExportPage` — `apps/web-console/src/__tests__/ConsoleTenantConfigExportPage.test.tsx`
  - Mocks `configExportApi.ts` functions
  - Test: on mount, calls `getExportableDomains` and populates domain selector
  - Test: export button triggers `exportTenantConfig` with selected domains
  - Test: 403 response shows permission denied message
  - Test: 422 response shows artifact-too-large message with filter hint

---

## Phase 5: User Story 3 — Integration Tests and End-to-End Validation (P2)

**Goal**: Verify the full export flow against real or near-real services in CI: API contract, multi-tenant isolation, partial degradation, event emission, and all acceptance criteria.

**Independent Test**: All integration tests in `tests/integration/115-functional-config-export/` pass in CI with configured fixture services.

- [ ] T034 Create integration test fixtures — `tests/integration/115-functional-config-export/fixtures/tenant-seed.sql`
  - INSERT statements to create a test tenant in `config_export_audit_log` and any required tenant registry tables
  - Creates schema `test_tenant_115` in PostgreSQL with at least one table and one view
  - Safe to run multiple times (idempotent)

- [ ] T035 [P] Create Keycloak realm fixture — `tests/integration/115-functional-config-export/fixtures/keycloak-realm-seed.json`
  - Minimal Keycloak realm JSON for `test_tenant_115`: includes one client, one role, one group
  - Client has `secret` field set to a known test value (not a real credential)
  - Used by integration tests to verify IAM collector redacts `secret` → `"***REDACTED***"`

- [ ] T036 [P] Create mock-collectors helper — `tests/integration/115-functional-config-export/helpers/mock-collectors.mjs`
  - Exports `buildMockRegistry(overrides)` — returns a registry Map with controllable per-domain results
  - Exports `stubCollector(status, data)` — returns a `() => Promise<CollectorResult>` with given status/data
  - Exports `timeoutCollector(delayMs)` — returns a collector that resolves after delayMs (for timeout tests)
  - Used by action unit tests (T023, T024) and integration tests

- [ ] T037 [US3] Write export API integration test — `tests/integration/115-functional-config-export/export-api.test.mjs`
  - Uses `undici` (or `node:fetch`) to call APISIX endpoint; uses test tenant + test auth token
  - Test CA-01: full export, all available domains; artifact contains metadata root fields (CA-12)
  - Test CA-02: `domains: ["iam", "kafka"]` → only those two sections in response
  - Test CA-03: profile without OW → functions domain has `status: 'not_available'`
  - Test CA-05: IAM client secret → `"***REDACTED***"` in artifact
  - Test CA-06: mock mongo timeout (via env override) → HTTP 207; mongo section `status: 'error'`
  - Test CA-07: export for tenantA does not contain tenantB resources
  - Test CA-08: tenant_owner token → HTTP 403
  - Test CA-09: after successful export, Kafka event `config.export.completed` is consumable on topic
  - Test CA-11: two consecutive exports without config changes → same functional content (excluding timestamps)
  - Test CA-12: artifact root contains `export_timestamp`, `tenant_id`, `format_version`, `deployment_profile`, `correlation_id`

- [ ] T038 [P] [US3] Write domains API integration test — `tests/integration/115-functional-config-export/domains-api.test.mjs`
  - Test CA-10: GET domains endpoint for tenant in standard profile (OW disabled) → `functions` has `availability: 'not_available'`
  - Test: response includes all 6 domains; `queried_at` is ISO UTC; `deployment_profile` matches env

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: AGENTS.md update, final checklist validation, and any cleanup that spans multiple phases.

- [ ] T039 Update `AGENTS.md` with Functional Config Export section — `AGENTS.md`
  - Add section under `<!-- MANUAL ADDITIONS START -->` with:
    - New files created (collectors, actions, migration, console)
    - New env vars (all 19 listed in plan.md)
    - New Kafka topic `console.config.export.completed` (90d retention)
    - New PostgreSQL table `config_export_audit_log`
    - New APISIX routes: `POST /v1/admin/tenants/{tenant_id}/config/export` and `GET .../domains`
    - New Keycloak scope: `platform:admin:config:export`
    - Optional components: `CONFIG_EXPORT_OW_ENABLED=false`, `CONFIG_EXPORT_MONGO_ENABLED=false`

- [ ] T040 [P] Verify no secrets in test fixtures or repository — scan all new files
  - Run `grep -rn --include="*.mjs" --include="*.ts" --include="*.sql" --include="*.json" --include="*.yaml" "password\|secret\|token\|AKID\|private_key" tests/integration/115-functional-config-export/ services/provisioning-orchestrator/tests/collectors/` and confirm only test-stub / placeholder values exist; no real credentials
  - Confirm `CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET`, `CONFIG_EXPORT_S3_SECRET_ACCESS_KEY`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD`, `CONFIG_EXPORT_OW_AUTH_TOKEN` never hard-coded in source

- [ ] T041 Run quickstart validation — follow `specs/115-functional-config-export/quickstart.md`
  - Execute the local smoke-test procedure documented in quickstart.md
  - Verify: migration applies cleanly (`psql`), action can be invoked locally with mock env vars, all unit tests pass (`node --test`)

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)        → No dependencies; start immediately
Phase 2 (Foundational) → Requires Phase 1 complete; BLOCKS all user-story work
Phase 3 (US1)          → Requires Phase 2 complete; 3A before 3C; 3B in parallel with 3C after 3A starts
Phase 4 (US2)          → Requires Phase 2 complete; 4A and 4B can run in parallel; 4C after 4B
Phase 5 (US3)          → Requires Phase 3 and Phase 4 complete
Phase 6 (Polish)       → Requires Phase 3, 4, 5 complete
```

### Task-Level Critical Dependencies

| Task | Depends On |
|------|-----------|
| T005 (registry) | T004 (types) |
| T007 (audit repo) | T006 (migration DDL) |
| T009 (orchestrator) | T004, T005, T007, T008 |
| T010 (domains action) | T004, T005 |
| T011–T016 (collectors) | T004 (types) |
| T017–T022 (collector tests) | T011–T016 respectively |
| T023 (orchestrator test) | T009, T036 (mock-collectors) |
| T024 (domains test) | T010, T036 |
| T025 (APISIX routes) | T009, T010 deployed |
| T027 (API client) | T025 routes defined |
| T028–T029 (components) | T027 (types from API layer) |
| T030 (page) | T027, T028, T029 |
| T031–T033 (console tests) | T028–T030 respectively |
| T037–T038 (integration tests) | T034, T035, T036, and Phase 3 + Phase 4 complete |
| T039 (AGENTS.md) | All implementation tasks done |
| T040 (secret scan) | All new files exist |
| T041 (quickstart) | All implementation + tests done |

---

## Parallel Execution Opportunities

### Phase 2 Parallel Group (after T001–T003)

```
T004 (types)  →  T005 (registry) [sequential: registry imports types]
T006 (migration)  →  T007 (audit repo) [sequential: repo uses table]
T008 (kafka events) [parallel with T007]
```

### Phase 3B Collectors — Full Parallel Group (after T004)

```
T011 (IAM)        ─┐
T012 (S3)         ─┤
T013 (Kafka)      ─┤  all parallel — independent files, independent external APIs
T014 (PostgreSQL) ─┤
T015 (OpenWhisk)  ─┤
T016 (MongoDB)    ─┘
```

### Phase 3C Unit Tests — Full Parallel Group (after 3B)

```
T017 (iam test)       ─┐
T018 (pg test)        ─┤
T019 (mongo test)     ─┤  all parallel after respective collector exists
T020 (kafka test)     ─┤
T021 (functions test) ─┤
T022 (s3 test)        ─┘
T023 (orchestrator test) — after T009 + T036
T024 (domains test)      — after T010 + T036
```

### Phase 4 Parallel Groups

```
T025 (gateway routes) ─┐  parallel to Phase 4B frontend
T026 (KC scopes)       ─┘

T027 (api client)  →  T028 (DomainSelector), T029 (ResultPanel)  →  T030 (Page)
T031 (DomainSelector test) after T028
T032 (ResultPanel test)    after T029
T033 (Page test)           after T030
```

---

## Implementation Strategy

### MVP Scope (Phase 1 + 2 + 3 only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T008)
3. Complete Phase 3A: Orchestrator actions (T009–T010)
4. Complete Phase 3B: All six collectors (T011–T016)
5. Complete Phase 3C: Unit tests (T017–T024)
6. **STOP and VALIDATE**: POST to action directly (bypass APISIX) → confirm ExportArtifact shape, partial degradation, secret redaction
7. If validated: proceed to Phase 4 (gateway + console) and Phase 5 (integration tests)

### Incremental Delivery

- After Phase 3: Export works headlessly via OpenWhisk direct invocation
- After Phase 4: Export accessible via APISIX + Console UI
- After Phase 5: Full CI coverage, all CAs verified
- After Phase 6: Documentation complete, no secrets in repo

### Partial Degradation Contract (invariant across all phases)

At no point should a single collector failure abort the export. The orchestrator MUST:
1. Use `Promise.allSettled` (never `Promise.all`) for collector invocations
2. Map rejected promises → `{ status: 'error', error: rejection.message }`
3. Determine HTTP status as 207 if any domain is `error`; 200 otherwise
4. Always persist audit log + emit Kafka event regardless of partial failures

---

## Bounded Implementation Contract for `speckit.implement`

The `speckit.implement` step MUST:
1. Create only files listed in the **File-Path Contract** section above
2. Extend (not recreate) `backup-admin-routes.yaml` and `backup-scopes.yaml`
3. NOT modify any migration files outside `services/provisioning-orchestrator/src/migrations/`
4. NOT create OpenWhisk deployment descriptors (out of scope for this task — deployment is infra concern)
5. NOT implement import/reprovisioning logic (US-BKP-02-T03+)
6. NOT store the export artifact in any database or object storage (return as HTTP response body only)
7. Treat `CONFIG_EXPORT_OW_ENABLED` and `CONFIG_EXPORT_MONGO_ENABLED` as FALSE by default; code must handle graceful `not_available` without those env vars set
8. Use ESM (`"type": "module"`) for all `.mjs` files; no CommonJS `require()`
9. Use `node:test` + `node:assert` for backend tests; `vitest` + React Testing Library for console tests
10. Keep `format_version: "1.0"` hardcoded in the orchestrator (T02 formalizes versioning)

---

*Tasks generated for `speckit.tasks` stage — US-BKP-02-T01 | Branch: `115-functional-config-export`*
*Total tasks: 41 | Phases: 6 | Parallel opportunities: 20+ tasks*
*MVP scope: T001–T024 (Phases 1–3) | Full scope: T001–T041 (all phases)*
