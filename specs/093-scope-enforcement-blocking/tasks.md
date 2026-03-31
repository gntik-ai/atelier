# Tasks: Scope Enforcement & Out-of-Scope Blocking

**Feature**: 093-scope-enforcement-blocking  
**Task ID**: US-SEC-02-T03 | **Epic**: EP-18 | **Story**: US-SEC-02  
**Input**: Design documents from `specs/093-scope-enforcement-blocking/`  
**Prerequisites**: plan.md ✅, spec.md ✅  
**Branch**: `093-scope-enforcement-blocking`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete-task dependencies)
- **[Story]**: Maps to user stories from spec.md (US1–US5)
- Exact file paths included per task

---

## Implementation-Ready File Path Map

> **Token-optimization contract for the implement step.**  
> Read ONLY the files listed below — do not perform full OpenAPI reads, broad directory scans,
> or exploratory browsing.  Targeted reads only.

| Role | Paths to read |
|------|--------------|
| **Existing migration reference** | `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql` (first 60 lines for header/pattern) |
| **Existing action reference** | `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs` (first 80 lines for action wrapper pattern) |
| **Existing Kafka events reference** | `services/provisioning-orchestrator/src/events/` — targeted reads of one event publisher file only |
| **Existing repo reference** | `services/provisioning-orchestrator/src/repositories/` — one repository file to confirm pg-query pattern |
| **Family OpenAPI (write target)** | `apps/control-plane/openapi/families/workspaces.openapi.json` — read only the `paths` keys and the `components/schemas` keys section (no full file read) |
| **Internal contracts index** | `services/internal-contracts/src/index.mjs` — tail 30 lines only (to see export pattern for append) |
| **Console page reference** | `apps/web-console/src/pages/ConsoleSecretsPage.tsx` (first 80 lines for page structure pattern) |
| **Console component reference** | `apps/web-console/src/components/console/` — one existing component file (first 60 lines) |
| **Console lib reference** | `apps/web-console/src/lib/` — one existing `console-*.ts` helper (first 60 lines) |
| **Test harness reference** | `tests/scope-enforcement/` — directory does not exist yet; no read needed |
| **gateway-config plugin reference** | `services/gateway-config/plugins/` — list directory only; read zero bytes of existing plugins |
| **AGENTS.md** | Full read required once at start (already in context) |

**Files to create (new — no pre-read required):**

```text
services/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql
services/provisioning-orchestrator/src/models/scope-enforcement-denial.mjs
services/provisioning-orchestrator/src/repositories/scope-enforcement-repo.mjs
services/provisioning-orchestrator/src/events/scope-enforcement-events.mjs
services/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs
services/provisioning-orchestrator/src/actions/scope-enforcement-event-recorder.mjs
services/gateway-config/plugins/scope-enforcement.lua
services/gateway-config/openapi-fragments/scope-enforcement.yaml
services/internal-contracts/src/scope-enforcement-denial-event.json
services/internal-contracts/src/scope-enforcement-denial-query-response.json
apps/web-console/src/pages/ConsoleScopeEnforcementPage.tsx
apps/web-console/src/pages/ConsoleScopeEnforcementPage.test.tsx
apps/web-console/src/components/console/ScopeEnforcementDenialsTable.tsx
apps/web-console/src/components/console/ScopeEnforcementDenialsTable.test.tsx
apps/web-console/src/lib/console-scope-enforcement.ts
tests/scope-enforcement/plugin.integration.test.mjs
tests/scope-enforcement/audit-query.integration.test.mjs
docs/adr/093-scope-enforcement-blocking.md
```

**Files to extend (targeted read before edit):**

```text
services/internal-contracts/src/index.mjs          ← append new exports
services/gateway-config/base/public-api-routing.yaml ← add plugin reference (targeted read of plugin section only)
```

---

## Phase 1: Setup

**Purpose**: Confirm tooling, branch, and scaffold missing directories.

- [ ] T001 Confirm branch `093-scope-enforcement-blocking` is checked out and working tree is clean
- [ ] T002 [P] Create `services/gateway-config/plugins/` directory if absent (idempotent)
- [ ] T003 [P] Create `services/gateway-config/openapi-fragments/` directory if absent (idempotent)
- [ ] T004 [P] Create `tests/scope-enforcement/` directory if absent (idempotent)
- [ ] T005 [P] Create `docs/adr/` directory if absent (idempotent)

**Checkpoint**: Directories exist; on correct branch. All subsequent phases can begin.

---

## Phase 2: Data Model & Contracts (Blocking Prerequisites)

**Purpose**: PostgreSQL migration, domain models, and JSON schemas that everything else depends on.

**⚠️ CRITICAL**: No phase 3+ work can begin until T006–T012 are complete.

- [ ] T006 Create `services/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql` — idempotent SQL with:
  - `CREATE TABLE IF NOT EXISTS scope_enforcement_denials` — columns: `id UUID PK DEFAULT gen_random_uuid()`, `tenant_id UUID NOT NULL`, `workspace_id UUID`, `actor_id TEXT NOT NULL`, `actor_type TEXT NOT NULL CHECK IN ('user','service_account','api_key','anonymous')`, `denial_type TEXT NOT NULL CHECK IN ('SCOPE_INSUFFICIENT','PLAN_ENTITLEMENT_DENIED','WORKSPACE_SCOPE_MISMATCH','CONFIG_ERROR')`, `http_method TEXT NOT NULL`, `request_path TEXT NOT NULL`, `required_scopes TEXT[]`, `presented_scopes TEXT[]`, `missing_scopes TEXT[]`, `required_entitlement TEXT`, `current_plan_id TEXT`, `source_ip INET`, `correlation_id TEXT NOT NULL`, `denied_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - Indexes: `idx_sed_tenant_denied_at ON (tenant_id, denied_at DESC)`, `idx_sed_workspace_denied_at ON (workspace_id, denied_at DESC) WHERE workspace_id IS NOT NULL`, `idx_sed_denial_type ON (denial_type, denied_at DESC)`, `idx_sed_actor ON (actor_id, tenant_id, denied_at DESC)`
  - `CREATE TABLE IF NOT EXISTS endpoint_scope_requirements` — columns: `id UUID PK DEFAULT gen_random_uuid()`, `http_method TEXT NOT NULL`, `path_pattern TEXT NOT NULL`, `required_scopes TEXT[] NOT NULL`, `required_entitlements TEXT[]`, `workspace_scoped BOOLEAN NOT NULL DEFAULT true`, `description TEXT`, `declared_by TEXT NOT NULL CHECK IN ('config','migration','admin')`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `UNIQUE (http_method, path_pattern)`
  - Index: `idx_esr_method_path ON (http_method, path_pattern)`
  - Idempotency note: use `ON CONFLICT (http_method, path_pattern) DO UPDATE SET ...` pattern for seeded routes

- [ ] T007 Create `services/provisioning-orchestrator/src/models/scope-enforcement-denial.mjs` — ESM module exporting:
  - `createScopeEnforcementDenial({ tenantId, workspaceId, actorId, actorType, denialType, httpMethod, requestPath, requiredScopes, presentedScopes, missingScopes, requiredEntitlement, currentPlanId, sourceIp, correlationId, deniedAt })` — plain-object factory
  - `validateScopeEnforcementDenial(record)` — throws `TypeError` with field name for any missing required field
  - `DENIAL_TYPES` — frozen object with string constants: `SCOPE_INSUFFICIENT`, `PLAN_ENTITLEMENT_DENIED`, `WORKSPACE_SCOPE_MISMATCH`, `CONFIG_ERROR`

- [ ] T008 Create `services/internal-contracts/src/scope-enforcement-denial-event.json` — JSON Schema draft-07 for `ScopeEnforcementDenialEvent` (full schema as defined in plan.md §6.2), with `required` array and all property definitions including `event_id`, `event_type`, `tenant_id`, `workspace_id`, `actor_id`, `actor_type`, `http_method`, `request_path`, `required_scopes`, `presented_scopes`, `missing_scopes`, `required_entitlement`, `current_plan_id`, `source_ip`, `correlation_id`, `denied_at`

- [ ] T009 Create `services/internal-contracts/src/scope-enforcement-denial-query-response.json` — JSON Schema draft-07 for `ScopeEnforcementDenialQueryResponse`: object with `denials` (array of denial records), `next_cursor` (string, nullable), `total_in_window` (integer)

- [ ] T010 Extend `services/internal-contracts/src/index.mjs` — append named exports for `scopeEnforcementDenialEventSchema` (from `./scope-enforcement-denial-event.json`) and `scopeEnforcementDenialQueryResponseSchema` (from `./scope-enforcement-denial-query-response.json`); read tail-30-lines first to match existing export pattern

- [ ] T011 Create `services/provisioning-orchestrator/src/repositories/scope-enforcement-repo.mjs` — ESM module exporting:
  - `insertDenial(client, record)` — parameterised `pg` INSERT with `ON CONFLICT (correlation_id, denied_at) DO NOTHING` for idempotency on Kafka redelivery
  - `queryDenials(client, { tenantId, workspaceId, denialType, actorId, from, to, limit, cursor })` — keyset pagination; if `tenantId` is `null` (superadmin), returns all tenants; enforces max `to - from` ≤ 30 days; returns `{ denials, nextCursor, totalInWindow }`
  - `countDenialsInWindow(client, { tenantId, from, to })` — COUNT query for total_in_window
  - All queries use named `$1`-style parameterisation; no string interpolation

- [ ] T012 [P] Add seed rows to `093-scope-enforcement.sql` (append after table DDL) — `INSERT INTO endpoint_scope_requirements (http_method, path_pattern, required_scopes, required_entitlements, workspace_scoped, description, declared_by) VALUES ...` for key public routes (e.g., `POST /v1/functions/:id/deploy` → `['functions:deploy']`, `GET /v1/db/collections` → `['db:read']`, `POST /v1/realtime/subscriptions` → `['realtime:subscribe']` with `required_entitlements=['realtime:subscribe']`) using `ON CONFLICT (http_method, path_pattern) DO UPDATE SET required_scopes=EXCLUDED.required_scopes`

**Checkpoint**: Migration SQL parses cleanly; models import without errors; schemas are valid JSON; index.mjs exports compile.

---

## Phase 3: APISIX Plugin — Core Enforcement (Priority P1)

**Purpose**: The Lua plugin that performs scope, workspace, and plan enforcement at the gateway. This is the critical security gate.

- [ ] T013 Create `services/gateway-config/plugins/scope-enforcement.lua` — Lua 5.1 / OpenResty plugin with:
  - Plugin metadata: `plugin_name = "scope-enforcement"`, `priority = 2900` (after `jwt-auth`/`key-auth` plugins), `version = "0.1.0"`
  - `schema` table: `required_scopes (array of strings)`, `required_entitlements (array of strings, optional)`, `workspace_scoped (boolean, default true)`
  - `_M.access(conf, ctx)` implementing the 8-step evaluation sequence from plan.md §4.3:
    1. Extract token claims from ctx (`scope`/`scp`, `workspace_id`, `tenant_id`, `plan_id`, `role`) — 401 if no valid claims
    2. Resolve `required_scopes` from `conf` (local) and LRU cache miss → `endpoint_scope_requirements` table lookup via internal HTTP
    3. If no requirement declared → `emit_config_error` + return 403 CONFIG_ERROR
    4. Scope evaluation: `token_scopes ⊇ required_scopes` → else 403 SCOPE_INSUFFICIENT with missing list
    5. Workspace check: if `conf.workspace_scoped`, extract workspace from path; compare to `claims.workspace_id`; bypass for `role == platform_admin`; else 403 WORKSPACE_SCOPE_MISMATCH
    6. Plan entitlement check: `get_plan_entitlements(tenant_id)` via `ngx.shared.scope_plan_cache` (TTL 30 s) or HTTP fallback; compute missing entitlements; else 403 PLAN_ENTITLEMENT_DENIED
    7. Fire-and-forget Kafka emit via `ngx.timer.at(0, emit_denial_event, ...)` for each denial path
    8. Inject `X-Enforcement-Verified: true`, `X-Verified-Tenant-Id`, `X-Verified-Workspace-Id` on allowed requests
  - `deny(status, code, detail)` helper — renders JSON body matching plan.md §6.3 error shapes
  - `emit_denial_event(premature, payload)` — ngx timer callback that posts to sidecar Kafka publisher endpoint (non-blocking)
  - LRU cache `lrucache.new(200)` for scope requirements, TTL 60 s
  - `ngx.shared.scope_plan_cache` for plan entitlements, TTL 30 s

- [ ] T014 Create `services/gateway-config/openapi-fragments/scope-enforcement.yaml` — YAML declaring `scope-enforcement` plugin schema, example config per route group (`/v1/functions/**`, `/v1/db/**`, `/v1/realtime/**`, `/v1/workspaces/**`), and environment variable references for cache TTLs

- [ ] T015 Extend `services/gateway-config/base/public-api-routing.yaml` — add `scope-enforcement` plugin reference under the global plugin chain with `enabled: ${SCOPE_ENFORCEMENT_ENABLED:-false}` feature flag; read only the plugin configuration section of the file before editing

- [ ] T016 Create unit test stubs directory and file `tests/scope-enforcement/plugin.integration.test.mjs` — Node `node:test` integration test (not Lua busted; tests plugin behavior via HTTP against APISIX mock):
  - Test setup: start APISIX test container or mock HTTP server with plugin loaded
  - `@unit` cases: valid scope → 200 + `X-Enforcement-Verified` header present; insufficient scope → 403 `SCOPE_INSUFFICIENT`; empty scope set → 403 `SCOPE_INSUFFICIENT`; unrecognized scope in token → treated as absent (deny); workspace match → 200; workspace mismatch → 403 `WORKSPACE_SCOPE_MISMATCH`; platform_admin bypasses workspace check; plan entitlement granted → 200; plan entitlement denied → 403 `PLAN_ENTITLEMENT_DENIED`; no endpoint declaration → 403 `CONFIG_ERROR`; expired token (handled by prior plugin) → 401 before scope check
  - `@e2e` tagged cases (smoke): end-to-end trigger + Kafka event emitted + PG record persisted within 5 s
  - Use `node:test` `describe`/`it` with subtests; skip `@e2e` when env `SCOPE_ENFORCEMENT_E2E` is not set

**Checkpoint**: Plugin file is valid Lua syntax; YAML fragments are valid; routing config diff is minimal and correct; integration test file exists with correct structure.

---

## Phase 4: Audit Backend (Priority P1)

**Purpose**: Kafka event publisher, Kafka→PG consumer, and query action for the audit trail.

- [ ] T017 Create `services/provisioning-orchestrator/src/events/scope-enforcement-events.mjs` — ESM Kafka publisher module:
  - `publishScopeEnforcementDenial(kafkaProducer, denial)` — publishes to topic from `SCOPE_ENFORCEMENT_KAFKA_TOPIC_SCOPE_DENIED` (default `console.security.scope-denied`), `SCOPE_ENFORCEMENT_KAFKA_TOPIC_PLAN_DENIED`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_WORKSPACE_MISMATCH`, or `SCOPE_ENFORCEMENT_KAFKA_TOPIC_CONFIG_ERROR` based on `denial.denialType`
  - `publishConfigError(kafkaProducer, payload)` — convenience wrapper for `CONFIG_ERROR` type
  - Message key: `tenant_id` for partitioning
  - Message value: JSON serialisation of `ScopeEnforcementDenialEvent` schema
  - Follows existing `kafkajs` publisher pattern from `provisioning-orchestrator/src/events/`

- [ ] T018 Create `services/provisioning-orchestrator/src/actions/scope-enforcement-event-recorder.mjs` — OpenWhisk action (follows `async-operation-retry.mjs` pattern):
  - Kafka consumer → PostgreSQL recorder
  - Main handler: parse incoming Kafka message batch; for each message, call `insertDenial(client, record)` (idempotent INSERT); commit offset only after successful PG write
  - Error handling: log malformed messages; skip and continue (no poison-pill retry loop); metrics counter for skipped messages
  - Dependencies: `pg` pool via `createPool()`, `scope-enforcement-repo.mjs`, `scope-enforcement-denial.mjs` validator

- [ ] T019 Create `services/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs` — OpenWhisk action for querying denials:
  - Accepts HTTP params: `tenant_id`, `workspace_id`, `denial_type`, `actor_id`, `from` (ISO8601, required), `to` (ISO8601, required), `limit` (default 100, max 500), `cursor` (opaque keyset)
  - RBAC enforcement: if caller role is `platform_admin` (superadmin): any `tenant_id` or none; if role is `tenant_owner`/`workspace_admin`: force `tenant_id` to caller's tenant_id
  - Input validation: `to - from` ≤ 30 days → 400 `QUERY_WINDOW_EXCEEDED`; unknown `denial_type` → 400 `INVALID_DENIAL_TYPE`
  - Calls `queryDenials(client, params)` from `scope-enforcement-repo.mjs`
  - Returns `ScopeEnforcementDenialQueryResponse` — array of denial records with `next_cursor` and `total_in_window`

- [ ] T020 Create unit test `tests/scope-enforcement/audit-query.integration.test.mjs` — `node:test` tests:
  - Setup: create PG test DB, run `093-scope-enforcement.sql`, insert synthetic denial records for 2 tenant IDs
  - Cases: superadmin gets all tenants; tenant-owner gets only their tenant's denials; `denial_type` filter works; `actor_id` filter works; `from`/`to` filter works; keyset cursor pagination returns non-overlapping pages; window > 30 days returns 400; missing `from`/`to` returns 400; `limit` capped at 500
  - Teardown: drop test schema

**Checkpoint**: Event publisher compiles; recorder action follows established OpenWhisk pattern; query action unit tests pass.

---

## Phase 5: Console UI (Priority P2)

**Purpose**: Denial audit page for tenant owners and superadmins.

- [ ] T021 Create `apps/web-console/src/lib/console-scope-enforcement.ts` — typed API client:
  - `fetchDenials(params: DenialQueryParams): Promise<DenialQueryResponse>` — GET `/api/security/scope-enforcement/denials` with query string built from params
  - `DenialQueryParams` TypeScript interface: `tenantId?, workspaceId?, denialType?, actorId?, from, to, limit?, cursor?`
  - `DenialQueryResponse` TypeScript interface: `denials: ScopeEnforcementDenial[], nextCursor: string | null, totalInWindow: number`
  - `ScopeEnforcementDenial` TypeScript interface matching JSON schema fields
  - `exportDenialsAsCsv(denials: ScopeEnforcementDenial[]): string` — serialises denial array to CSV with headers
  - Follows patterns from existing `apps/web-console/src/lib/console-*.ts` helpers

- [ ] T022 Create `apps/web-console/src/components/console/ScopeEnforcementDenialsTable.tsx` — React component:
  - Props: `denials: ScopeEnforcementDenial[]`, `isLoading: boolean`, `onLoadMore?: () => void`, `hasMore: boolean`, `isSuperadmin: boolean`
  - Columns: timestamp (`denied_at`), denial type badge (color-coded: red for SCOPE_INSUFFICIENT, orange for PLAN_ENTITLEMENT_DENIED, yellow for WORKSPACE_SCOPE_MISMATCH, grey for CONFIG_ERROR), actor (`actor_id` + `actor_type`), resource (`http_method` + `request_path`), missing scopes/entitlement, tenant (visible only for superadmin), source IP
  - Filter controls: `denial_type` select, `actor_id` text input, `workspace_id` text input, date-range picker for `from`/`to`
  - "Export CSV" button using `exportDenialsAsCsv`; download via `URL.createObjectURL`
  - Empty state: "No denial events in this period"
  - Uses shadcn/ui Table, Badge, Select, Input, DatePicker components

- [ ] T023 Create `apps/web-console/src/pages/ConsoleScopeEnforcementPage.tsx` — page component:
  - Fetches denials on mount using `fetchDenials` with default `from = now - 24h`, `to = now`
  - Renders `ScopeEnforcementDenialsTable` with fetched data
  - Summary strip: total denials in window (SCOPE_INSUFFICIENT / PLAN_ENTITLEMENT_DENIED / WORKSPACE_SCOPE_MISMATCH / CONFIG_ERROR counts)
  - `CONFIG_ERROR` count > 0 → amber alert banner: "⚠ Unconfigured endpoints detected. Check platform configuration." (visible to superadmins only)
  - Refresh button + auto-refresh toggle (30 s interval)
  - Page title: "Scope Enforcement — Denial Events"
  - Route: `/console/security/scope-enforcement`

- [ ] T024 [P] Create `apps/web-console/src/components/console/ScopeEnforcementDenialsTable.test.tsx` — Vitest + React Testing Library:
  - Renders denial rows correctly
  - Denial type badges have correct color classes
  - Tenant column hidden when `isSuperadmin=false`
  - Export CSV button triggers download
  - Load more button calls `onLoadMore`
  - Empty state renders when `denials=[]`

- [ ] T025 [P] Create `apps/web-console/src/pages/ConsoleScopeEnforcementPage.test.tsx` — Vitest:
  - Renders summary strip with correct counts
  - CONFIG_ERROR banner visible only for superadmin when count > 0
  - Refresh triggers new `fetchDenials` call
  - Date filter change triggers new query

**Checkpoint**: UI components render without TypeScript errors; Vitest tests pass.

---

## Phase 6: Observability & Documentation

**Purpose**: Prometheus metrics, Grafana alerts, ADR, and AGENTS.md update.

- [ ] T026 [P] Create `docs/adr/093-scope-enforcement-blocking.md` — Architecture Decision Record:
  - Context: need for gateway-layer scope enforcement
  - Decision: APISIX Lua plugin in `access` phase with LRU cache + PostgreSQL fallback
  - Alternatives considered: OPA sidecar (rejected — network round-trip), external auth service (rejected — SPOF)
  - Consequences: p95 enforcement < 5 ms; TTL 30 s propagation window for plan changes; fail-closed as default
  - Status: Accepted

- [ ] T027 Update `AGENTS.md` — append new section `## Scope Enforcement (093-scope-enforcement-blocking)` after `## Secure Secret Rotation` section:
  - New PostgreSQL tables: `scope_enforcement_denials`, `endpoint_scope_requirements`
  - New Kafka topics: `console.security.scope-denied` (30d), `console.security.plan-denied` (30d), `console.security.workspace-mismatch` (30d), `console.security.config-error` (7d)
  - New APISIX plugin: `services/gateway-config/plugins/scope-enforcement.lua`
  - New OpenWhisk actions: `scope-enforcement-audit-query`, `scope-enforcement-event-recorder`
  - New console page: `ConsoleScopeEnforcementPage.tsx`
  - New env vars: `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS` (default 30), `SCOPE_ENFORCEMENT_REQUIREMENTS_CACHE_TTL_SECONDS` (default 60), `SCOPE_ENFORCEMENT_AUDIT_QUERY_MAX_DAYS` (default 30), `SCOPE_ENFORCEMENT_KAFKA_TOPIC_SCOPE_DENIED`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_PLAN_DENIED`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_WORKSPACE_MISMATCH`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_CONFIG_ERROR`, `SCOPE_ENFORCEMENT_ENABLED` (feature flag, default false)
  - Enforcement model: APISIX plugin phase `access` → deny before backend; Kafka fire-and-forget audit; PG query surface; fail-closed on missing endpoint declaration

**Checkpoint**: ADR file present; AGENTS.md updated with all new tables/topics/env vars.

---

## Phase 7: Activation & Final Validation

**Purpose**: Enable feature flag progressively and verify done criteria.

- [ ] T028 [P] Add Helm values entry `scopeEnforcement.enabled: false` to `services/gateway-config/helm/values.yaml` (or equivalent chart values file) — enables phased rollout without code changes; confirm `public-api-routing.yaml` reads this env var

- [ ] T029 Perform schema contract validation: run existing `services/internal-contracts` validation script (or `node --test`) against `scope-enforcement-denial-event.json` and `scope-enforcement-denial-query-response.json` — must pass with zero errors

- [ ] T030 Run full test suite smoke check:
  - `node --test tests/scope-enforcement/` → all unit tests pass
  - `npx vitest run apps/web-console/src/pages/ConsoleScopeEnforcementPage.test.tsx apps/web-console/src/components/console/ScopeEnforcementDenialsTable.test.tsx` → all Vitest tests pass
  - All pre-existing tests remain green (no regressions)

**Checkpoint (Final)**: All done criteria DON-01 through DON-12 from plan.md §13 are addressed by corresponding tasks. Feature flag off by default.

---

## Done Criteria Coverage Map

| DON-ID | Covered by Task(s) |
|--------|--------------------|
| DON-01 | T013, T016 |
| DON-02 | T013, T016 |
| DON-03 | T013, T016 |
| DON-04 | T013, T016 |
| DON-05 | T017, T018, T020 |
| DON-06 | T019, T020 |
| DON-07 | T013, T016 |
| DON-08 | T013, T016 |
| DON-09 | T030 (benchmark note in PR description) |
| DON-10 | T028, T015 |
| DON-11 | T027 |
| DON-12 | T026 |
