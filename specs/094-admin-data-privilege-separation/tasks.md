<!-- markdownlint-disable MD022 MD031 MD040 -->
# Tasks — US-SEC-02-T04: Admin–Data Privilege Separation

**Feature Branch**: `094-admin-data-privilege-separation`
**Generated**: 2026-03-31
**Status**: Ready for implementation
**Bounded artifacts**: This file + `plan.md` are the only files the implement step needs to read.
**Spec reference**: `specs/094-admin-data-privilege-separation/spec.md`

---

## File-Path Map (Canonical — implement step must use exactly these paths)

> All paths are relative to repo root `/root/projects/falcone`.

| Token | Path |
|-------|------|
| `SQL_MIGRATION` | `services/provisioning-orchestrator/src/migrations/094-admin-data-privilege-separation.sql` |
| `LUA_PLUGIN` | `services/gateway-config/plugins/scope-enforcement.lua` |
| `LUA_PLUGIN_TEST` | `services/gateway-config/tests/plugins/scope-enforcement-domain_spec.lua` |
| `ROUTE_CATALOG` | `services/gateway-config/public-route-catalog.json` |
| `HELM_VALUES` | `services/gateway-config/helm/values.yaml` |
| `ACTION_ASSIGN` | `services/provisioning-orchestrator/src/actions/privilege-domain-assign.mjs` |
| `ACTION_QUERY` | `services/provisioning-orchestrator/src/actions/privilege-domain-query.mjs` |
| `ACTION_AUDIT` | `services/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs` |
| `ACTION_RECORDER` | `services/provisioning-orchestrator/src/actions/privilege-domain-event-recorder.mjs` |
| `ACTION_MIGRATE` | `services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs` |
| `MODEL` | `services/provisioning-orchestrator/src/models/privilege-domain-assignment.mjs` |
| `REPO` | `services/provisioning-orchestrator/src/repositories/privilege-domain-repository.mjs` |
| `EVENTS` | `services/provisioning-orchestrator/src/events/privilege-domain-events.mjs` |
| `TEST_ASSIGN` | `services/provisioning-orchestrator/src/tests/actions/privilege-domain-assign.test.mjs` |
| `TEST_AUDIT` | `services/provisioning-orchestrator/src/tests/actions/privilege-domain-audit-query.test.mjs` |
| `TEST_MIGRATE` | `services/provisioning-orchestrator/src/tests/actions/api-key-domain-migration.test.mjs` |
| `PAGE_DOMAIN` | `apps/web-console/src/pages/ConsolePrivilegeDomainPage.tsx` |
| `PAGE_DOMAIN_TEST` | `apps/web-console/src/pages/ConsolePrivilegeDomainPage.test.tsx` |
| `PAGE_AUDIT` | `apps/web-console/src/pages/ConsolePrivilegeDomainAuditPage.tsx` |
| `PAGE_AUDIT_TEST` | `apps/web-console/src/pages/ConsolePrivilegeDomainAuditPage.test.tsx` |
| `API_CLIENT` | `apps/web-console/src/services/privilege-domain-api.ts` |
| `CONTRACT_ASSIGN` | `services/internal-contracts/src/privilege-domain-assignment.schema.json` |
| `CONTRACT_DENIAL` | `services/internal-contracts/src/privilege-domain-denial.schema.json` |
| `ADR` | `docs/adr/adr-094-privilege-domain-separation.md` |
| `AGENTS_MD` | `AGENTS.md` |

---

## Task Dependency Graph

```
T01 (SQL migration)
  └─► T02 (endpoint classification seed)
        └─► T03 (Lua plugin extension)
              ├─► T04 (Lua plugin tests)
              ├─► T05 (MODEL + REPO + EVENTS)
              │     ├─► T06 (ACTION_ASSIGN)
              │     │     └─► T07 (TEST_ASSIGN)
              │     ├─► T08 (ACTION_QUERY)
              │     ├─► T09 (ACTION_RECORDER)
              │     │     └─► T10 (ACTION_AUDIT)
              │     │           └─► T11 (TEST_AUDIT)
              │     └─► T12 (ACTION_MIGRATE)
              │           └─► T13 (TEST_MIGRATE)
              ├─► T14 (API_CLIENT)
              │     ├─► T15 (PAGE_DOMAIN + PAGE_DOMAIN_TEST)
              │     └─► T16 (PAGE_AUDIT + PAGE_AUDIT_TEST)
              ├─► T17 (JSON Schema contracts)
              ├─► T18 (Helm values + ROUTE_CATALOG)
              └─► T19 (ADR + AGENTS.md)
```

---

## Tasks

### T01 — SQL Migration: new tables + schema extensions

**File**: `SQL_MIGRATION`
**Depends on**: none
**Type**: NEW FILE — SQL DDL

Create `services/provisioning-orchestrator/src/migrations/094-admin-data-privilege-separation.sql` with the following content (verbatim from plan.md §5, all statements idempotent):

1. `CREATE TABLE IF NOT EXISTS privilege_domain_assignments` with columns:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id UUID NOT NULL`
   - `workspace_id UUID NOT NULL`
   - `member_id UUID NOT NULL`
   - `structural_admin BOOLEAN NOT NULL DEFAULT false`
   - `data_access BOOLEAN NOT NULL DEFAULT false`
   - `assigned_by UUID NOT NULL`
   - `assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `UNIQUE (tenant_id, workspace_id, member_id)`
   - Indexes: `idx_pda_workspace_member` on `(workspace_id, member_id)`, `idx_pda_tenant_structural` on `(tenant_id, workspace_id) WHERE structural_admin = true`

2. `CREATE OR REPLACE VIEW workspace_structural_admin_count` — counts `structural_admin = true` per `(workspace_id, tenant_id)`.

3. `CREATE TABLE IF NOT EXISTS privilege_domain_denials` with columns:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id UUID NOT NULL`
   - `workspace_id UUID` (nullable)
   - `actor_id TEXT NOT NULL`
   - `actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous'))`
   - `credential_domain TEXT CHECK (credential_domain IN ('structural_admin','data_access','none'))`
   - `required_domain TEXT NOT NULL CHECK (required_domain IN ('structural_admin','data_access'))`
   - `http_method TEXT NOT NULL`
   - `request_path TEXT NOT NULL`
   - `source_ip INET`
   - `correlation_id TEXT NOT NULL`
   - `denied_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - Indexes: `idx_pdd_tenant_denied_at` on `(tenant_id, denied_at DESC)`, `idx_pdd_workspace_denied_at` on `(workspace_id, denied_at DESC) WHERE workspace_id IS NOT NULL`, `idx_pdd_required_domain` on `(required_domain, denied_at DESC)`

4. `CREATE TABLE IF NOT EXISTS privilege_domain_assignment_history` with columns:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `assignment_id UUID NOT NULL`
   - `tenant_id UUID NOT NULL`
   - `workspace_id UUID NOT NULL`
   - `member_id UUID NOT NULL`
   - `change_type TEXT NOT NULL CHECK (change_type IN ('assigned','revoked','migrated','system'))`
   - `privilege_domain TEXT NOT NULL CHECK (privilege_domain IN ('structural_admin','data_access'))`
   - `changed_by UUID NOT NULL`
   - `changed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `correlation_id TEXT`
   - Index: `idx_pdah_workspace_member` on `(workspace_id, member_id, changed_at DESC)`

5. `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS privilege_domain TEXT CHECK (privilege_domain IN ('structural_admin','data_access','pending_classification'))` — nullable for migration grace period.

6. `ALTER TABLE endpoint_scope_requirements ADD COLUMN IF NOT EXISTS privilege_domain TEXT CHECK (privilege_domain IN ('structural_admin','data_access'))` — nullable; NULL treated as unclassified (fail-closed).

**Acceptance**: re-runnable without error; all tables/indexes/views exist after execution.

---

### T02 — Endpoint classification seed (UPDATE endpoint_scope_requirements)

**File**: `SQL_MIGRATION` (append to the same file as T01, separated by a clear comment block)
**Depends on**: T01
**Type**: SQL DML — data seed

Append to the migration file a seed block (idempotent `UPDATE ... SET privilege_domain = '...' WHERE request_path LIKE '...' AND privilege_domain IS NULL`) classifying all known public-API endpoints per plan.md §5.4:

**structural_admin** paths (exact list from plan.md §5.4):
```
POST   /v1/tenants
PUT    /v1/tenants/:id (pattern match: /v1/tenants/%)
DELETE /v1/tenants/:id
POST   /v1/workspaces
PUT    /v1/workspaces/:id
DELETE /v1/workspaces/:id
POST   /v1/workspaces/:id/members
DELETE /v1/workspaces/:id/members/:memberId
POST   /v1/schemas
PUT    /v1/schemas/:id
DELETE /v1/schemas/:id
POST   /v1/functions
DELETE /v1/functions/:id
PUT    /v1/functions/:id/config
POST   /v1/api-keys
DELETE /v1/api-keys/:id
POST   /v1/services/configure
PUT    /v1/quotas
GET    /v1/workspaces/:id/members
GET    /v1/schemas
```

**data_access** paths:
```
GET    /v1/collections/:name/documents
POST   /v1/collections/:name/documents
PUT    /v1/collections/:name/documents/:id
DELETE /v1/collections/:name/documents/:id
POST   /v1/collections/:name/query
GET    /v1/objects/:bucket/:key
PUT    /v1/objects/:bucket/:key
DELETE /v1/objects/:bucket/:key
POST   /v1/functions/:id/invoke
GET    /v1/analytics/query
POST   /v1/events/publish
GET    /v1/events/subscribe
```

Use PostgreSQL pattern-based UPDATEs with `request_path` matching. If `endpoint_scope_requirements` uses a different column name for the path, use `path` or `endpoint_path` — check by reading the migration file from T03/093-scope-enforcement-blocking and use the correct column name; fall back to `request_path`.

**Acceptance**: after seed, `SELECT COUNT(*) FROM endpoint_scope_requirements WHERE privilege_domain IS NULL` returns 0 for all rows that were previously classified by T03.

---

### T03 — Lua plugin extension: privilege-domain evaluation

**File**: `LUA_PLUGIN`
**Depends on**: T01, T02
**Type**: MODIFY EXISTING FILE

Extend `services/gateway-config/plugins/scope-enforcement.lua` (established by feature 093). Do NOT rewrite existing T03 logic — append domain-evaluation code after the existing scope/plan checks.

**Additions to the plugin** (in the `access` phase handler, after existing T03 checks):

1. **Extract `privilege_domain` from credential**:
   ```lua
   -- From JWT claim (prefer) or APISIX consumer tag for API keys
   local credential_domain = kong.request.get_header("X-API-Key-Domain")
     or (jwt_claims and jwt_claims["privilege_domain"])
     or "none"
   ```

2. **Lookup endpoint's required domain** via shared dict `privilege_domain_cache` (LRU, TTL = `PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS` env var, default 60):
   ```lua
   local cache_key = method .. ":" .. path
   local required_domain = privilege_domain_cache:get(cache_key)
   if not required_domain then
     -- fetch from PostgreSQL via existing DB helper (same pattern as T03 scope lookup)
     required_domain = fetch_endpoint_privilege_domain(method, path)
     if required_domain then
       privilege_domain_cache:set(cache_key, required_domain, cache_ttl)
     end
   end
   ```

3. **platform_admin bypass**: if `kong.ctx.shared.actor_role == "platform_admin"` → skip domain check, inject `X-Privilege-Domain: platform_admin`, continue.

4. **Domain check** (only when `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` env var is `"true"`):
   ```lua
   if required_domain ~= nil and credential_domain ~= required_domain then
     -- emit Kafka event fire-and-forget (existing Kafka sidecar pattern from T03)
     emit_privilege_domain_denied_event({...})
     if enforcement_enabled then
       return kong.response.exit(403, {
         error = "PRIVILEGE_DOMAIN_MISMATCH",
         requiredDomain = required_domain,
         credentialDomain = credential_domain
       })
     end
     -- else: log-only mode, continue
   end
   ```
   If `required_domain == nil` (unclassified endpoint) and enforcement is enabled → exit 403 with `CONFIG_ERROR`.

5. **Inject header** `X-Privilege-Domain: {credential_domain}` on allowed requests.

6. **Kafka event payload** for `privilege_domain_denied`:
   ```lua
   {
     eventType = "privilege_domain_denied",
     tenantId = kong.ctx.shared.tenant_id,
     workspaceId = kong.ctx.shared.workspace_id,
     actorId = kong.ctx.shared.actor_id,
     actorType = kong.ctx.shared.actor_type,
     credentialDomain = credential_domain,
     requiredDomain = required_domain,
     httpMethod = method,
     requestPath = path,
     correlationId = kong.request.get_header("X-Correlation-ID") or ngx.var.request_id,
     occurredAt = ngx.utctime()
   }
   ```

7. **Cache invalidation**: expose a helper function `invalidate_privilege_domain_cache()` that calls `privilege_domain_cache:flush_all()` — used by the APISIX admin API route added in T18.

**Acceptance**: plugin compiles without error; T03 existing tests still pass.

---

### T04 — Lua plugin tests

**File**: `LUA_PLUGIN_TEST`
**Depends on**: T03
**Type**: NEW FILE — Lua busted test suite

Create `services/gateway-config/tests/plugins/scope-enforcement-domain_spec.lua` with `busted` test cases covering:

1. `credential_domain == required_domain` → request passes (200 passthrough), `X-Privilege-Domain` header injected.
2. `credential_domain != required_domain` AND `enforcement_enabled = true` → returns 403 `PRIVILEGE_DOMAIN_MISMATCH`, Kafka event emitted (mocked).
3. `credential_domain != required_domain` AND `enforcement_enabled = false` → request passes (log-only), Kafka event emitted.
4. `required_domain == nil` (unclassified endpoint) AND `enforcement_enabled = true` → returns 403 `CONFIG_ERROR`.
5. `actor_role == "platform_admin"` → domain check bypassed regardless of domains.
6. No `privilege_domain` claim in JWT → `credential_domain = "none"` → blocked if enforcement enabled.
7. Cache hit path (shared dict populated) → no DB call.
8. Cache miss path → DB call, result cached.

---

### T05 — Model, Repository, Events modules

**Files**: `MODEL`, `REPO`, `EVENTS`
**Depends on**: T01
**Type**: NEW FILES — ESM Node.js 20+

#### `MODEL` (`privilege-domain-assignment.mjs`)
```js
// Pure validation & type definitions (no DB calls)
export const DOMAINS = Object.freeze(['structural_admin', 'data_access']);
export const ACTOR_TYPES = Object.freeze(['user','service_account','api_key','anonymous']);
export const CHANGE_TYPES = Object.freeze(['assigned','revoked','migrated','system']);

export function validateAssignment({ structural_admin, data_access }) {
  if (typeof structural_admin !== 'boolean' || typeof data_access !== 'boolean') {
    throw new Error('INVALID_ASSIGNMENT: both structural_admin and data_access must be boolean');
  }
  return { structural_admin, data_access };
}

export function validatePrivilegeDomain(domain) {
  if (!DOMAINS.includes(domain)) throw new Error(`INVALID_DOMAIN: ${domain}`);
  return domain;
}
```

#### `REPO` (`privilege-domain-repository.mjs`)
All methods accept a `pg` pool/client parameter (no module-level singleton):

- `upsertAssignment(client, { tenantId, workspaceId, memberId, structural_admin, data_access, assignedBy, correlationId })` — `INSERT ... ON CONFLICT (tenant_id, workspace_id, member_id) DO UPDATE SET ...`; also inserts into `privilege_domain_assignment_history`.
- `getAssignment(pool, { tenantId, workspaceId, memberId })` — single row.
- `listAssignments(pool, { tenantId, workspaceId })` — array.
- `getStructuralAdminCount(client, { workspaceId, tenantId })` — reads from `workspace_structural_admin_count` view; uses `SELECT ... FOR UPDATE` variant for the guard path (separate method `getStructuralAdminCountForUpdate`).
- `insertDenial(pool, denialRecord)` — INSERT into `privilege_domain_denials`.
- `queryDenials(pool, { tenantId, workspaceId, requiredDomain, actorId, from, to, limit, offset })` — SELECT with optional filters, returns `{ denials, total }`.

#### `EVENTS` (`privilege-domain-events.mjs`)
```js
export const TOPICS = Object.freeze({
  DENIED:     process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED    || 'console.security.privilege-domain-denied',
  ASSIGNED:   process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED  || 'console.security.privilege-domain-assigned',
  REVOKED:    process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED   || 'console.security.privilege-domain-revoked',
  LAST_ADMIN: process.env.PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN|| 'console.security.last-admin-guard-triggered',
});

export function buildDeniedEvent({ tenantId, workspaceId, actorId, actorType, credentialDomain, requiredDomain, httpMethod, requestPath, correlationId }) { ... }
export function buildAssignedEvent({ tenantId, workspaceId, memberId, privilegeDomain, assignedBy }) { ... }
export function buildRevokedEvent({ tenantId, workspaceId, memberId, privilegeDomain, revokedBy }) { ... }
export function buildLastAdminGuardEvent({ tenantId, workspaceId, memberId, attemptedBy }) { ... }
```

Each builder appends `occurredAt: new Date().toISOString()` and `eventType` field matching plan.md §6.5.

---

### T06 — OpenWhisk action: privilege-domain-assign

**File**: `ACTION_ASSIGN`
**Depends on**: T05
**Type**: NEW FILE — ESM OpenWhisk action

`services/provisioning-orchestrator/src/actions/privilege-domain-assign.mjs`

Implements `PUT /api/workspaces/:workspaceId/members/:memberId/privilege-domains`.

**Logic** (follows existing action patterns from T01–T03 actions in the same directory):
```
1. Parse & validate input: workspaceId, memberId, tenantId (from X-Tenant-ID header), structural_admin (bool), data_access (bool).
   → 400 VALIDATION_ERROR if missing or wrong types.

2. Authorization: verify actor holds structural_admin domain for the workspace
   (check privilege_domain_assignments or platform_admin role).
   → 403 FORBIDDEN if not authorized.

3. BEGIN TRANSACTION

4. Last-admin guard (only when revoking structural_admin):
   IF new_structural_admin == false AND current.structural_admin == true:
     count = getStructuralAdminCountForUpdate(client, { workspaceId, tenantId })
     IF count <= 1:
       ROLLBACK
       emit TOPICS.LAST_ADMIN event (fire-and-forget, outside TX)
       → 400 LAST_STRUCTURAL_ADMIN

5. upsertAssignment(client, {...})

6. COMMIT

7. Sync Keycloak roles (async, non-blocking for response):
   - Grant: POST /admin/realms/{realm}/users/{userId}/role-mappings/realm
             with role `structural_admin_{workspaceId}` or `data_access_{workspaceId}`
   - Revoke: DELETE equivalent
   Use KEYCLOAK_ADMIN_URL env var + service account token from Vault/ESO.

8. Invalidate APISIX privilege_domain_cache:
   DELETE {APISIX_ADMIN_URL}/apisix/admin/plugin_metadata/scope-enforcement
   (fire-and-forget, log errors, do not fail response)

9. Emit Kafka events:
   - If structural_admin changed → ASSIGNED or REVOKED event for structural_admin domain
   - If data_access changed → ASSIGNED or REVOKED event for data_access domain
   (fire-and-forget via existing kafkajs producer pattern)

10. Return 200 with updated assignment record.
```

**Error responses**: follows plan.md §6.2 exactly (400 LAST_STRUCTURAL_ADMIN, 403 FORBIDDEN, 409 CONFLICT on concurrent update).

---

### T07 — Tests: privilege-domain-assign

**File**: `TEST_ASSIGN`
**Depends on**: T06
**Type**: NEW FILE — node:test

`services/provisioning-orchestrator/src/tests/actions/privilege-domain-assign.test.mjs`

Test cases (use `node:test` + in-memory mocks for pg, kafkajs, Keycloak, APISIX admin):

1. Happy path: grant structural_admin → 200, DB upserted, Keycloak sync called, APISIX cache invalidated, Kafka ASSIGNED event emitted.
2. Happy path: revoke data_access when structural_admin count >= 2 → 200.
3. Last-admin guard: revoke structural_admin when count == 1 → 400 LAST_STRUCTURAL_ADMIN.
4. Last-admin guard: concurrent revocation (simulate SELECT FOR UPDATE contention) → one succeeds, one gets 400.
5. Actor without structural_admin domain → 403 FORBIDDEN.
6. Missing workspaceId param → 400 VALIDATION_ERROR.
7. Both domains unchanged (idempotent re-call) → 200, no duplicate history record.
8. Keycloak sync failure → 200 still returned (Keycloak async, non-blocking), error logged.
9. APISIX invalidation failure → 200 still returned, error logged.

---

### T08 — OpenWhisk action: privilege-domain-query

**File**: `ACTION_QUERY`
**Depends on**: T05
**Type**: NEW FILE — ESM OpenWhisk action

`services/provisioning-orchestrator/src/actions/privilege-domain-query.mjs`

Implements:
- `GET /api/workspaces/:workspaceId/members/:memberId/privilege-domains` → `getAssignment()`
- `GET /api/workspaces/:workspaceId/members/privilege-domains` → `listAssignments()`

RBAC: tenant-owner or platform_admin can read. Returns 404 if member not found.
Response shape per plan.md §6.1.

---

### T09 — OpenWhisk action: privilege-domain-event-recorder

**File**: `ACTION_RECORDER`
**Depends on**: T05
**Type**: NEW FILE — ESM OpenWhisk action

`services/provisioning-orchestrator/src/actions/privilege-domain-event-recorder.mjs`

Kafka consumer (`TOPICS.DENIED`) → parse event payload → call `insertDenial(pool, {...})`.

Pattern: follows existing `scope-enforcement-event-recorder.mjs` from T03 if present; otherwise follows `async-operation-retry.mjs` pattern.

- Validates event schema before insert (required fields: `tenantId`, `actorId`, `requiredDomain`, `httpMethod`, `requestPath`, `correlationId`).
- On missing required fields: logs warning, skips insert (no throw).
- Idempotent: if `correlation_id` already exists in `privilege_domain_denials`, skip insert (use `INSERT ... ON CONFLICT (correlation_id) DO NOTHING` — add a UNIQUE constraint on `correlation_id` in T01 SQL if not already there; amend the migration file for `privilege_domain_denials`).

**Amendment to T01**: add `UNIQUE (correlation_id)` to `privilege_domain_denials`.

---

### T10 — OpenWhisk action: privilege-domain-audit-query

**File**: `ACTION_AUDIT`
**Depends on**: T09
**Type**: NEW FILE — ESM OpenWhisk action

`services/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs`

Implements `GET /api/security/privilege-domains/denials` per plan.md §6.3.

Query params: `tenantId`, `workspaceId`, `requiredDomain`, `actorId`, `from`, `to`, `limit` (default 50, max 200), `offset` (default 0).

RBAC:
- `platform_admin` → may query any tenant.
- `tenant_owner` → may only query own `tenantId` (enforced by adding `AND tenant_id = $actor_tenant_id` to WHERE).
- Others → 403.

Calls `queryDenials(pool, {...})`. Returns shape per plan.md §6.3.

Performance: index-backed query; response time target < 300 ms for 30-day window (per plan.md §2).

---

### T11 — Tests: privilege-domain-audit-query

**File**: `TEST_AUDIT`
**Depends on**: T10
**Type**: NEW FILE — node:test

`services/provisioning-orchestrator/src/tests/actions/privilege-domain-audit-query.test.mjs`

Test cases:
1. platform_admin queries any tenant → all matching denials returned.
2. tenant_owner queries own tenant → filtered correctly.
3. tenant_owner attempts to query different tenant → 403.
4. Filter by `requiredDomain = structural_admin` → only structural denials.
5. Filter by `from` / `to` time range → correct temporal filtering.
6. `limit` > 200 → clamped to 200.
7. Empty result set → `{ denials: [], total: 0, limit: 50, offset: 0 }`.
8. Missing tenantId for platform_admin → 400 VALIDATION_ERROR.

---

### T12 — OpenWhisk action: api-key-domain-migration

**File**: `ACTION_MIGRATE`
**Depends on**: T05
**Type**: NEW FILE — ESM OpenWhisk action — one-shot

`services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs`

Logic:
```
1. SELECT all api_keys WHERE privilege_domain IS NULL.

2. For each key:
   a. Inspect last_used_endpoint_category (if column exists) or last_used_path.
   b. Heuristic classification:
      - If all recent usage maps to structural_admin paths → assign 'structural_admin'.
      - If all recent usage maps to data_access paths → assign 'data_access'.
      - If mixed or no usage history → assign 'pending_classification'.

3. UPDATE api_keys SET privilege_domain = classified_domain WHERE id = key_id
   AND privilege_domain IS NULL  (prevents overwriting already-classified keys).

4. For keys assigned 'pending_classification':
   - emit a notification event (use TOPICS.ASSIGNED with a special note field
     pending_review: true) to alert the workspace owner.

5. Return summary: { classified: N, pending: M, alreadyClassified: K }
```

Idempotent: safe to re-run; will only process keys with `privilege_domain IS NULL`.

Respects `APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS` env var (log warning if already past grace period and keys still unclassified; do not block them yet — that is done by the constraint upgrade in a separate Helm job).

---

### T13 — Tests: api-key-domain-migration

**File**: `TEST_MIGRATE`
**Depends on**: T12
**Type**: NEW FILE — node:test

`services/provisioning-orchestrator/src/tests/actions/api-key-domain-migration.test.mjs`

Test cases:
1. Key with only structural_admin usage history → assigned `structural_admin`.
2. Key with only data_access usage history → assigned `data_access`.
3. Key with mixed usage → assigned `pending_classification`, notification event emitted.
4. Key with no usage history → assigned `pending_classification`.
5. Key already classified (`privilege_domain` NOT NULL) → skipped (not overwritten).
6. Re-run after partial classification → only unclassified keys processed.
7. Returns correct summary `{ classified, pending, alreadyClassified }`.

---

### T14 — Console API client

**File**: `API_CLIENT`
**Depends on**: T06, T08, T10
**Type**: NEW FILE — TypeScript

`apps/web-console/src/services/privilege-domain-api.ts`

Typed HTTP client (uses existing `fetch` wrapper in the console, following pattern of other `*-api.ts` files in the same directory):

```typescript
export interface PrivilegeDomainAssignment {
  memberId: string;
  workspaceId: string;
  tenantId: string;
  structural_admin: boolean;
  data_access: boolean;
  assignedAt: string;
  updatedAt: string;
}

export interface DenialRecord {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  actorId: string;
  actorType: 'user' | 'api_key' | 'service_account' | 'anonymous';
  credentialDomain: 'structural_admin' | 'data_access' | 'none' | null;
  requiredDomain: 'structural_admin' | 'data_access';
  httpMethod: string;
  requestPath: string;
  sourceIp: string | null;
  correlationId: string;
  deniedAt: string;
}

export interface DenialsResponse {
  denials: DenialRecord[];
  total: number;
  limit: number;
  offset: number;
}

// Functions to implement:
export async function getPrivilegeDomainAssignment(workspaceId: string, memberId: string): Promise<PrivilegeDomainAssignment>
export async function listPrivilegeDomainAssignments(workspaceId: string): Promise<PrivilegeDomainAssignment[]>
export async function updatePrivilegeDomainAssignment(workspaceId: string, memberId: string, assignment: Pick<PrivilegeDomainAssignment, 'structural_admin' | 'data_access'>): Promise<PrivilegeDomainAssignment>
export async function queryPrivilegeDomainDenials(params: { tenantId?: string; workspaceId?: string; requiredDomain?: string; actorId?: string; from?: string; to?: string; limit?: number; offset?: number }): Promise<DenialsResponse>
```

---

### T15 — Console page: ConsolePrivilegeDomainPage

**Files**: `PAGE_DOMAIN`, `PAGE_DOMAIN_TEST`
**Depends on**: T14
**Type**: NEW FILES — React 18 + TypeScript + Tailwind + shadcn/ui

#### `PAGE_DOMAIN` (`ConsolePrivilegeDomainPage.tsx`)

Route: `/workspaces/:workspaceId/members/:memberId/privilege-domains` (or inline panel within the members page).

UI requirements (per spec.md User Story 2 and plan.md §4.2):
- Two clearly labelled sections: **"Structural Administration"** and **"Data Access"**.
- Each section shows a toggle Switch (shadcn/ui) for the domain.
- Confirmation Dialog (shadcn/ui) before revoking any domain: "Are you sure you want to revoke [domain] privileges for [member name]?".
- **Last-admin guard UI**: if `structural_admin = true` and member is the only structural admin (API returns `LAST_STRUCTURAL_ADMIN` on attempt), the structural toggle is disabled with a tooltip: "This member is the only Structural Admin. Assign another Structural Admin before revoking this privilege."
- Loading state (skeleton), error state (Alert), success toast.
- Calls `getPrivilegeDomainAssignment` on mount; calls `updatePrivilegeDomainAssignment` on confirmed toggle.

#### `PAGE_DOMAIN_TEST` (`ConsolePrivilegeDomainPage.test.tsx`)

Vitest + React Testing Library tests:
1. Renders two separate sections with correct labels.
2. Toggle for structural_admin calls `updatePrivilegeDomainAssignment` with correct payload.
3. Confirmation dialog appears before revocation.
4. Last-admin guard: structural toggle disabled + tooltip shown when only admin.
5. API 400 `LAST_STRUCTURAL_ADMIN` response → error alert shown, toggle reverted.
6. Loading skeleton visible while API call in-flight.

---

### T16 — Console page: ConsolePrivilegeDomainAuditPage

**Files**: `PAGE_AUDIT`, `PAGE_AUDIT_TEST`
**Depends on**: T14
**Type**: NEW FILES — React 18 + TypeScript + Tailwind + shadcn/ui

#### `PAGE_AUDIT` (`ConsolePrivilegeDomainAuditPage.tsx`)

Route: `/admin/security/privilege-domain-denials` (superadmin only).

UI requirements (per spec.md User Story 3 and plan.md §4.2):
- Filter bar: `requiredDomain` dropdown (structural_admin | data_access | all), `tenantId` text input, `workspaceId` text input, `actorId` text input, date range picker (`from`, `to`).
- Results table with columns: Denied At, Actor ID, Actor Type, Credential Domain, Required Domain, HTTP Method, Path, Source IP, Correlation ID.
- Pagination (limit/offset).
- Badge showing count of denials in last 24 h (from filtered result with `from = now-24h`).
- Export button: downloads visible results as CSV.
- Loading, empty, and error states.
- Calls `queryPrivilegeDomainDenials` on filter change (debounced 300 ms).

#### `PAGE_AUDIT_TEST` (`ConsolePrivilegeDomainAuditPage.test.tsx`)

Vitest + RTL tests:
1. Renders filter bar and empty table on initial load.
2. Selecting `requiredDomain = structural_admin` triggers API call with correct param.
3. Results displayed in table with correct column values.
4. 24h denial badge shows correct count.
5. Export button generates CSV with correct rows.
6. Pagination: clicking next page increments offset.

---

### T17 — JSON Schema contracts

**Files**: `CONTRACT_ASSIGN`, `CONTRACT_DENIAL`
**Depends on**: T05
**Type**: NEW FILES — JSON Schema (draft-07)

#### `CONTRACT_ASSIGN` (`privilege-domain-assignment.schema.json`)
JSON Schema for the privilege domain assignment entity and the `assigned`/`revoked` Kafka events:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PrivilegeDomainAssignmentEvent",
  "type": "object",
  "required": ["eventType","tenantId","workspaceId","memberId","privilegeDomain","occurredAt"],
  "properties": {
    "eventType": { "type": "string", "enum": ["privilege_domain_assigned","privilege_domain_revoked","last_admin_guard_triggered"] },
    "tenantId": { "type": "string", "format": "uuid" },
    "workspaceId": { "type": "string", "format": "uuid" },
    "memberId": { "type": "string", "format": "uuid" },
    "privilegeDomain": { "type": "string", "enum": ["structural_admin","data_access"] },
    "assignedBy": { "type": "string", "format": "uuid" },
    "revokedBy": { "type": "string", "format": "uuid" },
    "attemptedBy": { "type": "string", "format": "uuid" },
    "occurredAt": { "type": "string", "format": "date-time" }
  }
}
```

#### `CONTRACT_DENIAL` (`privilege-domain-denial.schema.json`)
JSON Schema for the `privilege_domain_denied` Kafka event:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PrivilegeDomainDeniedEvent",
  "type": "object",
  "required": ["eventType","tenantId","actorId","actorType","requiredDomain","httpMethod","requestPath","correlationId","occurredAt"],
  "properties": {
    "eventType": { "type": "string", "const": "privilege_domain_denied" },
    "tenantId": { "type": "string", "format": "uuid" },
    "workspaceId": { "type": ["string","null"], "format": "uuid" },
    "actorId": { "type": "string" },
    "actorType": { "type": "string", "enum": ["user","api_key","service_account","anonymous"] },
    "credentialDomain": { "type": ["string","null"], "enum": ["structural_admin","data_access","none",null] },
    "requiredDomain": { "type": "string", "enum": ["structural_admin","data_access"] },
    "httpMethod": { "type": "string" },
    "requestPath": { "type": "string" },
    "correlationId": { "type": "string" },
    "occurredAt": { "type": "string", "format": "date-time" }
  }
}
```

---

### T18 — Helm values + Route catalog update

**Files**: `HELM_VALUES`, `ROUTE_CATALOG`
**Depends on**: T03
**Type**: MODIFY EXISTING FILES

#### `HELM_VALUES` (`services/gateway-config/helm/values.yaml`)

Add under the `env:` section (or equivalent block for gateway-config ConfigMap):
```yaml
PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS: "60"
PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED: "false"
PRIVILEGE_DOMAIN_LAST_ADMIN_GUARD_ENABLED: "true"
APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS: "14"
PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED: "console.security.privilege-domain-denied"
PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED: "console.security.privilege-domain-assigned"
PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED: "console.security.privilege-domain-revoked"
PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN: "console.security.last-admin-guard-triggered"
```

#### `ROUTE_CATALOG` (`services/gateway-config/public-route-catalog.json`)

For each route entry in the JSON array, add a `"privilege_domain"` field with value `"structural_admin"` or `"data_access"` per the classification table in plan.md §5.4. If the file does not exist yet (not created by T03), create it as a JSON array with the classified routes as minimal stubs: `[{ "method": "POST", "path": "/v1/tenants", "privilege_domain": "structural_admin" }, ...]`.

---

### T19 — ADR + AGENTS.md update

**Files**: `ADR`, `AGENTS_MD`
**Depends on**: T01–T18 (conceptually; can be written in parallel)
**Type**: NEW FILE + MODIFY EXISTING FILE

#### `ADR` (`docs/adr/adr-094-privilege-domain-separation.md`)

Standard ADR format:
```markdown
# ADR-094: Admin–Data Privilege Separation

## Status
Accepted

## Context
[Summarise the problem: a single compromised admin credential exposing all tenant data; need for hard privilege-plane boundary in a multi-tenant BaaS.]

## Decision
Implement exactly two top-level privilege domains (`structural_admin` / `data_access`):
- Every platform permission classified into exactly one domain.
- Enforcement via extension of the existing APISIX scope-enforcement plugin (T03).
- Domain claims carried in Keycloak JWT (`privilege_domain` claim) and in `api_keys.privilege_domain` column.
- PostgreSQL tables: `privilege_domain_assignments`, `privilege_domain_denials`, `privilege_domain_assignment_history`.
- Feature flag `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` allows log-only rollout before hard enforcement.

## Consequences
- Positive: hard security boundary, reduced blast radius of compromised credentials.
- Negative: ops overhead to classify all legacy API keys during migration.
- Mitigation: grace period (`APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS`) + pending_classification state.

## Alternatives Considered
- ABAC per-row policies: out of scope; too granular for this feature.
- Separate APISIX plugin: rejected to avoid duplicating claim extraction and cache logic from T03.
- Three domains (including observability): deferred as future extension.
```

#### `AGENTS_MD` (`AGENTS.md`)

Append to the `<!-- MANUAL ADDITIONS START -->` ... `<!-- MANUAL ADDITIONS END -->` block a new section:

```markdown
## Admin-Data Privilege Separation (094-admin-data-privilege-separation)

- Two privilege domains enforced at APISIX plugin level: `structural_admin` (resource lifecycle, config, schema, deployment) and `data_access` (read/write/query/delete application data).
- New PostgreSQL tables: `privilege_domain_assignments`, `privilege_domain_denials`, `privilege_domain_assignment_history`.
- Extension of `services/gateway-config/plugins/scope-enforcement.lua` (T03) to evaluate `privilege_domain` claim from JWT or `api_keys.privilege_domain`.
- New OpenWhisk actions: `privilege-domain-assign`, `privilege-domain-query`, `privilege-domain-audit-query`, `privilege-domain-event-recorder`, `api-key-domain-migration`.
- New console pages: `ConsolePrivilegeDomainPage.tsx`, `ConsolePrivilegeDomainAuditPage.tsx`.
- New Kafka topics: `console.security.privilege-domain-denied` (30d), `console.security.privilege-domain-assigned` (30d), `console.security.privilege-domain-revoked` (30d), `console.security.last-admin-guard-triggered` (30d).
- New env vars: `PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS` (default 60), `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` (default false), `PRIVILEGE_DOMAIN_LAST_ADMIN_GUARD_ENABLED` (default true), `APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS` (default 14), `PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED`, `PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED`, `PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED`, `PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN`.
- Last-admin guard: `SELECT FOR UPDATE` in `privilege-domain-assign` prevents removing the last structural-admin from a workspace.
- Keycloak realm roles: `structural_admin_{workspaceId}` and `data_access_{workspaceId}`.
- Legacy API keys migrated by `api-key-domain-migration` action; ambiguous keys flagged as `pending_classification`.
- Feature flag `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false` allows log-only observation before hard enforcement.
```

---

## Acceptance Test Matrix

| ID | Task(s) | Scenario | Expected Result |
|----|---------|----------|-----------------|
| AC-01 | T03, T09 | Credential `data_access` → POST /v1/schemas (structural_admin endpoint) | HTTP 403 PRIVILEGE_DOMAIN_MISMATCH + Kafka event emitted + `privilege_domain_denials` row inserted |
| AC-02 | T03, T09 | Credential `structural_admin` → GET /v1/collections/x/documents (data_access endpoint) | HTTP 403 + event + denial row |
| AC-03 | T06, T08 | User with both domains (dual assignment) performs structural + data ops | Both HTTP 200; each logged under correct domain |
| AC-04 | T06, T07 | Tenant owner revokes structural_admin from last remaining structural admin | HTTP 400 LAST_STRUCTURAL_ADMIN; guard event emitted |
| AC-05 | T03, T12 | API key with `privilege_domain = data_access` calls structural endpoint | HTTP 403 |
| AC-06 | T06 | Domain assignment changed for active session → next request (within ≤ 60 s) | Keycloak session invalidated + APISIX cache flushed |
| AC-07 | T12 | API key with `pending_classification` within grace period | Request passes with log warning |
| AC-08 | T10, T11 | Superadmin queries denials filtered by `requiredDomain = structural_admin` | Only structural_admin denials in response |
| AC-09 | T03, T04 | `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false` → any cross-domain request | HTTP 200 (passes through), Kafka event still emitted |
| AC-10 | T03, T04 | Unclassified endpoint with enforcement enabled | HTTP 403 CONFIG_ERROR |

---

## Implementation Notes for Constrained Implement Step

1. **Do NOT read `apps/control-plane/openapi/control-plane.openapi.json`** — all endpoint paths and shapes needed are fully specified in this file and plan.md.
2. **Do NOT browse the repo broadly** — only read files listed in the File-Path Map above plus:
   - `services/provisioning-orchestrator/src/actions/scope-enforcement-event-recorder.mjs` (if it exists) as a pattern reference for T09.
   - `services/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs` or any existing action as a pattern reference for action boilerplate.
3. **Lua plugin**: read `LUA_PLUGIN` before modifying it; do not overwrite the T03 portions.
4. **AGENTS.md**: preserve the existing `<!-- MANUAL ADDITIONS START/END -->` block; append inside it.
5. **Kafka topics**: all 4 new topics use 30-day retention (consistent with prior T03 topics).
6. **pg pool pattern**: all repository methods accept an injected `pool` or `client` parameter — no module-level singletons (consistent with existing provisioning-orchestrator patterns).
7. **ESM**: all `.mjs` files must use `import`/`export` syntax; no `require()`.
8. **Idempotency amendment**: T09 requires adding `UNIQUE (correlation_id)` to `privilege_domain_denials` in `SQL_MIGRATION` — ensure this constraint is present before implementing the action.
