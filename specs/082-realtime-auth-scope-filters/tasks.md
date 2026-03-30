# Tasks: Realtime Subscription Authentication, Scopes & Event Filters

**Branch**: `082-realtime-auth-scope-filters`  
**Generated**: 2026-03-30  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T04  
**Track**: Spec Kit → `speckit.implement`

---

## Token Optimization Rules (MANDATORY for implement step)

> **Read these rules before touching any file.**

1. **DO NOT read** `apps/control-plane/openapi/control-plane.openapi.json` — it is too large and will exhaust context. Use only the relevant family files under `apps/control-plane/openapi/families/`.
2. Relevant family files for this feature: `auth.openapi.json`, `iam.openapi.json`, `websockets.openapi.json`, `workspaces.openapi.json`, `events.openapi.json`.
3. Read source files **only when you are about to edit them**. Do not pre-load files "just in case".
4. For migration files: write and commit incrementally — one migration per task group, not all at once.
5. When referencing existing T01 channel/subscription code, read only the specific module(s) you need to call, not entire directories.
6. Unit tests: write each test file immediately after its implementation counterpart; do not accumulate all tests at the end.

---

## Implementation File Map

The implement step MUST create/modify exactly the files listed below (and no others without explicit justification).

### New Files to Create

```
services/realtime-gateway/
  package.json
  src/config/env.mjs
  src/auth/token-validator.mjs
  src/auth/scope-checker.mjs
  src/auth/session-manager.mjs
  src/filters/filter-parser.mjs
  src/filters/filter-evaluator.mjs
  src/filters/complexity-checker.mjs
  src/isolation/tenant-workspace-guard.mjs
  src/audit/audit-publisher.mjs
  src/repositories/scope-mapping-repository.mjs
  src/repositories/auth-record-repository.mjs
  src/migrations/001-create-realtime-scope-channel-mappings.sql
  src/migrations/002-create-realtime-subscription-auth-records.sql
  src/migrations/003-create-realtime-sessions.sql
  src/actions/validate-subscription-auth.mjs
  src/actions/handle-scope-revocation.mjs

tests/unit/realtime-gateway/
  token-validator.test.mjs
  scope-checker.test.mjs
  filter-parser.test.mjs
  filter-evaluator.test.mjs
  tenant-workspace-guard.test.mjs
  audit-publisher.test.mjs

tests/integration/realtime-gateway/
  subscription-auth-flow.test.mjs
  event-filter-enforcement.test.mjs

specs/082-realtime-auth-scope-filters/contracts/openapi/
  realtime-auth-v1.yaml

specs/082-realtime-auth-scope-filters/contracts/kafka/
  realtime-auth-granted.schema.json
  realtime-auth-denied.schema.json
  realtime-session-suspended.schema.json
  realtime-session-resumed.schema.json

charts/realtime-gateway/
  Chart.yaml
  values.yaml
  templates/configmap-apisix-plugin.yaml
  templates/deployment.yaml
  templates/secret-ref.yaml

docs/adr/
  adr-082-scope-revocation-strategy.md
```

### Files to Read (reference only — do NOT modify)

```
apps/control-plane/openapi/families/auth.openapi.json       ← JWT/auth contract reference
apps/control-plane/openapi/families/iam.openapi.json        ← scope definitions reference
apps/control-plane/openapi/families/websockets.openapi.json ← existing subscription endpoints
apps/control-plane/openapi/families/workspaces.openapi.json ← workspace resource shapes
apps/control-plane/openapi/families/events.openapi.json     ← event payload shapes
```

### Files to Modify (existing — minimal targeted edits only)

```
pnpm-workspace.yaml   ← add services/realtime-gateway
```

---

## Task Groups (dependency-ordered)

Tasks within a group that share no internal dependency may be worked in parallel. Groups must be completed in order.

---

### GROUP A — Foundation (no runtime deps)

**A-1: Package scaffold**

- Create `services/realtime-gateway/package.json` with `"type": "module"`, `"engines": {"node": ">=20"}`, and dependencies: `kafkajs`, `pg`, `jose`, `jwks-rsa`, `ajv`.
- Add `services/realtime-gateway` to `pnpm-workspace.yaml`.
- Create `src/config/env.mjs`: typed env-var loader that exports all variables listed in the plan's Environment Variables table. **Throw at startup** if a required variable is missing or clearly invalid. No secret defaults committed.
- **Acceptance**: `pnpm install` at root resolves without error.

**A-2: Database migrations**

- Write three SQL migration files (DDL only, no DML):
  - `001-create-realtime-scope-channel-mappings.sql` — see plan Phase 1 data model.
  - `002-create-realtime-subscription-auth-records.sql` — see plan Phase 1 data model.
  - `003-create-realtime-sessions.sql` — see plan Phase 1 data model.
- Each file must be idempotent (`CREATE TABLE IF NOT EXISTS`; `CREATE INDEX IF NOT EXISTS`).
- **Acceptance**: all three files apply cleanly against a blank PostgreSQL schema in CI.

**A-3: Repository layer**

- Implement `src/repositories/scope-mapping-repository.mjs`:
  - `getScopeMappings(db, tenantId, workspaceId): Promise<ScopeMappingRow[]>` — returns rows; empty array if none (triggers default behavior in scope checker).
  - `upsertScopeMapping(db, mapping): Promise<ScopeMappingRow>` — insert or update on conflict `(tenant_id, workspace_id, scope_name, channel_type)`.
  - All queries MUST include `tenant_id` as a parameter — never filter by workspace alone.
- Implement `src/repositories/auth-record-repository.mjs`:
  - `insertAuthRecord(db, record): Promise<void>` — insert-only; never update. Include `tenant_id` in all writes.
- **Unit test** `tests/unit/realtime-gateway/` (create a single combined test for repositories or per-module — author's choice): mock `pg` Pool/Client; verify SQL parameterization passes `tenant_id`; verify insert-only semantics for auth records.
- **Acceptance**: unit tests pass; `EXPLAIN` on parameterized queries hits `idx_rscm_tenant_workspace` / `idx_rsar_tenant_workspace`.

**A-4: Filter layer**

- Implement `src/filters/filter-parser.mjs`:
  - `parseFilter(raw): FilterSpec` — validate against JSON Schema (operation enum: `INSERT|UPDATE|DELETE`, optional; entity: string, optional; predicates: array of `{field: string, op: string, value: any}`, optional). Throw `FilterValidationError` with `validationErrors: string[]` on failure.
  - Accept `null` / `undefined` / `{}` as "pass-all" filter → `FilterSpec { passAll: true }`.
- Implement `src/filters/complexity-checker.mjs`:
  - `checkComplexity(filterSpec, maxPredicates): void` — throws `FilterValidationError` if `filterSpec.predicates.length > maxPredicates`.
- Implement `src/filters/filter-evaluator.mjs`:
  - `evaluateFilter(filterSpec, event): boolean` — returns `true` if event matches filter (AND semantics: operation match AND entity match AND all predicates match). Returns `true` if `filterSpec.passAll`.
  - Predicate `op` values for v1: `eq`, `neq`, `contains`. Reject unknown ops with `false` (safe default).
- **Unit tests** (`filter-parser.test.mjs`, `filter-evaluator.test.mjs`): cover valid filter; invalid operation enum; missing required fields treated as optional pass-through; max predicates exceeded; empty filter; all predicate op combinations; event that matches all criteria; event that fails on each individual criterion.
- **Acceptance**: unit tests pass; `parseFilter(null)` returns pass-all spec.

---

### GROUP B — Auth Core (depends on GROUP A complete)

**B-1: Token validator**

- Implement `src/auth/token-validator.mjs`:
  - `validateToken(bearerToken): Promise<DecodedClaims>` — verify JWT signature using Keycloak JWKS (`jose` + `jwks-rsa`); cache JWKS keys in-process with TTL = `JWKS_CACHE_TTL_SECONDS`.
  - If `kid` not found in cache, attempt re-fetch once before falling back to Keycloak introspection endpoint.
  - Throw `AuthError` with `code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED'` and `message` on failure.
  - `DecodedClaims` MUST include: `sub` (actor identity), `tenant_id` (custom claim), workspace-scoped scopes array, `exp`, `jti`.
- **Unit tests** (`token-validator.test.mjs`): mock `jwks-rsa` and `jose`; valid token → claims returned; expired token → `TOKEN_EXPIRED`; tampered signature → `TOKEN_INVALID`; unknown `kid` triggers introspection path; introspection returns inactive → `TOKEN_REVOKED`.
- **Acceptance**: unit tests pass; no real network calls in unit tests.

**B-2: Scope checker**

- Implement `src/auth/scope-checker.mjs`:
  - `checkScopes(claims, workspaceId, channelType, db): Promise<ScopeCheckResult>` where `ScopeCheckResult = { allowed: boolean, missingScope?: string, requiredScope?: string }`.
  - Logic (in order):
    1. Extract `tenantId` from `claims.tenant_id`. Reject if absent.
    2. Check workspace ownership: `claims` MUST reference `workspaceId` (workspace must be within the subscriber's authorized workspaces). Return `{ allowed: false, missingScope: 'workspace-access' }` if not.
    3. Load scope mappings for `(tenantId, workspaceId)` from DB (use in-process cache, TTL = `SCOPE_REVALIDATION_INTERVAL_SECONDS`).
    4. If no mappings: apply default — `realtime:read` in `claims.scopes` grants access to all channel types.
    5. If mappings exist: find a row where `scope_name` is present in `claims.scopes` AND `channel_type` matches `channelType` or is `'*'`. If none found, return denied with `missingScope`.
- **Unit tests** (`scope-checker.test.mjs`): default behavior (no mappings → allowed with `realtime:read`); custom mapping allows; custom mapping denies (correct `missingScope` returned); cross-workspace rejected; missing `tenant_id` in claims rejected.
- **Acceptance**: unit tests pass; cross-tenant call never reaches DB (rejected on claims check).

**B-3: Tenant/workspace guard**

- Implement `src/isolation/tenant-workspace-guard.mjs`:
  - `guardEvent(event, sessionContext): boolean` — `true` only if `event.tenantId === sessionContext.tenantId && event.workspaceId === sessionContext.workspaceId`.
  - This function is called **for every event** before delivery. Keep it allocation-free (no object creation on the hot path).
- **Unit tests** (`tenant-workspace-guard.test.mjs`): matching → `true`; mismatched tenant → `false`; mismatched workspace → `false`; both mismatched → `false`.
- **Acceptance**: unit tests pass; function is a pure synchronous predicate with no I/O.

**B-4: Audit publisher**

- Implement `src/audit/audit-publisher.mjs`:
  - `publishAuthDecision(decision: AuthDecision, { kafka, db }): Promise<void>`.
  - `AuthDecision` shape: `{ action: 'GRANTED'|'DENIED'|'SUSPENDED'|'RESUMED', tenantId, workspaceId, actorIdentity, subscriptionId?, channelType, scopesEvaluated, filterSnapshot?, denialReason?, suspensionReason?, timestamp }`.
  - Route `action` to the correct Kafka topic (from env vars). Validate payload against the JSON Schema in `contracts/kafka/` before publishing.
  - **Dual-write**: after Kafka publish, call `auth-record-repository.mjs#insertAuthRecord` — do not let a PostgreSQL failure abort the Kafka publish; log the DB error and continue.
- Write Kafka event schemas to `specs/082-realtime-auth-scope-filters/contracts/kafka/`:
  - `realtime-auth-granted.schema.json`
  - `realtime-auth-denied.schema.json` (adds `denialReason`, `missingScope`)
  - `realtime-session-suspended.schema.json` (adds `suspensionReason`: `TOKEN_EXPIRED|SCOPE_REVOKED`)
  - `realtime-session-resumed.schema.json` (adds `resumedAt`)
- **Unit tests** (`audit-publisher.test.mjs`): mock `kafkajs` producer and `db`; verify correct topic selected per action; verify message body matches schema; verify `insertAuthRecord` called; verify DB failure is logged but does not throw.
- **Acceptance**: unit tests pass; all four schema files are valid JSON Schema Draft-07.

---

### GROUP C — Session & Actions (depends on GROUP B complete)

**C-1: Session manager**

- Implement `src/auth/session-manager.mjs`:
  - `createSession(bearerToken, workspaceId, channelType, db): Promise<Session>` — call `validateToken`, extract claims, call `checkScopes`, write `realtime_sessions` row, start polling interval, return `Session { id, tenantId, workspaceId, actorIdentity, tokenJti, status }`.
  - `refreshToken(sessionId, newBearerToken, db): Promise<void>` — validate new token, update `realtime_sessions` row (`token_jti`, `token_expires_at`, `last_validated_at`, `status='ACTIVE'`), reset polling interval, publish `RESUMED` audit event if session was `SUSPENDED`.
  - `closeSession(sessionId, db): Promise<void>` — mark `CLOSED`, clear polling interval.
  - Polling interval (every `SCOPE_REVALIDATION_INTERVAL_SECONDS`): call Keycloak introspection; if inactive or scopes narrowed → update `status='SUSPENDED'`, publish `SUSPENDED` audit event with reason `SCOPE_REVOKED` or `TOKEN_EXPIRED`.
  - Token expiry watcher: separately check `token_expires_at` against wall clock; if within `TOKEN_EXPIRY_GRACE_SECONDS` of expiry, suspend.
  - On `closeSession` / process shutdown: clear all interval timers.
- **Integration tests** (`subscription-auth-flow.test.mjs`): full lifecycle — create session (valid token) → deliver events → simulate token expiry → assert session suspended within grace window → refresh token → assert session resumed → assert `RESUMED` audit event published.
- **Acceptance**: integration tests pass; no timer leaks (verify clearInterval called in all termination paths).

**C-2: Validate-subscription-auth OpenWhisk action**

- Implement `src/actions/validate-subscription-auth.mjs`:
  - Input params: `{ token, workspaceId, channelType, filter }`.
  - Execution steps (in order, short-circuit on first failure):
    1. `validateToken(token)` → `AuthError` → return `{ allowed: false, error: { code, message } }`.
    2. `checkScopes(claims, workspaceId, channelType, db)` → denied → return `{ allowed: false, error: { code: 'INSUFFICIENT_SCOPE', missingScope } }`.
    3. Check filter does not reference entities outside permitted scope (entity name must not be in an explicit deny list derived from scope mappings; in v1 this is a passthrough if no entity-level scope restrictions exist — document this).
    4. `parseFilter(filter)` + `checkComplexity(filterSpec, MAX_FILTER_PREDICATES)` → `FilterValidationError` → return `{ allowed: false, error: { code: 'INVALID_FILTER', validationErrors } }`.
    5. Check quota: count active subscriptions for `(tenantId, workspaceId, actorIdentity)` in `realtime_sessions`; if ≥ `MAX_SUBSCRIPTIONS_PER_WORKSPACE` → return `{ allowed: false, error: { code: 'QUOTA_EXCEEDED' } }`.
    6. `publishAuthDecision(GRANTED | DENIED, ...)`.
    7. Return `{ allowed: true, subscriptionContext: { tenantId, workspaceId, actorIdentity, channelType, filterSpec } }`.
  - Feature flag `REALTIME_AUTH_ENABLED`: if `'false'`, skip all checks and return `{ allowed: true, subscriptionContext: {} }` — log a `WARN` with `reason: 'AUTH_BYPASSED'`.
- **Acceptance**: tested via `subscription-auth-flow.test.mjs` grant/deny paths.

**C-3: Handle-scope-revocation OpenWhisk action**

- Implement `src/actions/handle-scope-revocation.mjs`:
  - Input params: `{ actorIdentity, revokedScopes, tenantId }` (from Keycloak event or polling trigger).
  - Find all `ACTIVE` sessions for `actorIdentity` in `realtime_sessions`.
  - For each matching session: update `status='SUSPENDED'`; call `publishAuthDecision(SUSPENDED, { suspensionReason: 'SCOPE_REVOKED', ... })`.
  - Return `{ suspendedCount: N }`.
- **Acceptance**: integration test in `subscription-auth-flow.test.mjs` verifies sessions suspended within 60 s of scope revocation event.

---

### GROUP D — API Contracts & Helm (can run in parallel with GROUP C)

**D-1: OpenAPI contract**

- Write `specs/082-realtime-auth-scope-filters/contracts/openapi/realtime-auth-v1.yaml` covering:
  - `POST /workspaces/{workspaceId}/realtime/subscriptions` — request body extension with `filter` field; all response codes (201, 400, 401, 403, 409).
  - `DELETE /workspaces/{workspaceId}/realtime/subscriptions/{subscriptionId}`.
  - `GET /workspaces/{workspaceId}/realtime/scope-mappings`.
  - `PUT /workspaces/{workspaceId}/realtime/scope-mappings`.
- Reference schemas from `apps/control-plane/openapi/families/websockets.openapi.json` and `workspaces.openapi.json` where shapes overlap. **Do not duplicate** already-defined schemas — `$ref` them.
- **Token optimization note**: read `apps/control-plane/openapi/families/websockets.openapi.json` for existing subscription endpoint shape before writing the contract. Do NOT read `control-plane.openapi.json`.
- **Acceptance**: `npx @apidevtools/swagger-parser validate realtime-auth-v1.yaml` exits 0.

**D-2: Helm chart**

- Create `charts/realtime-gateway/` with:
  - `Chart.yaml`: `apiVersion: v2`, `name: realtime-gateway`, `version: 0.1.0`.
  - `values.yaml`: all env vars from plan Environment Variables table as Helm values; no secret values in defaults; annotate secret refs with `# K8s Secret ref`.
  - `templates/deployment.yaml`: standard Deployment using `values.yaml` refs; liveness/readiness probes.
  - `templates/configmap-apisix-plugin.yaml`: APISIX `jwt-auth` plugin config referencing `apisix.jwtAuth.jwksUrl` from values.
  - `templates/secret-ref.yaml`: SecretKeyRef template for `DATABASE_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`, `KAFKA_BROKERS`.
- **Acceptance**: `helm template charts/realtime-gateway | kubectl apply --dry-run=client -f -` exits 0.

---

### GROUP E — Integration Tests & Security Validations (depends on GROUP C + D-1 complete)

**E-1: Event filter enforcement integration test**

- Implement `tests/integration/realtime-gateway/event-filter-enforcement.test.mjs`:
  - Set up a mock event stream (array of events with mixed operations/entities).
  - Create a subscription with filter `{ operation: 'INSERT', entity: 'orders' }`.
  - Feed events through `filterEvaluator` + `tenantWorkspaceGuard` pipeline.
  - Assert only `INSERT` events on `orders` are delivered.
  - Assert unfiltered subscription receives all permitted events.
  - Assert filtered subscription receives ≥ 50% fewer events than unfiltered (SC-005).
- **Acceptance**: test passes; `pnpm test` at root exits 0.

**E-2: Security validations**

- Add the following assertions to `subscription-auth-flow.test.mjs`:
  - Inject event with mismatched `tenantId` → `guardEvent` returns `false` → never delivered (SC-003).
  - Inject event with mismatched `workspaceId` under same tenant → `guardEvent` returns `false` → never delivered (SC-004).
  - Open connection with expired token → `validateToken` throws `TOKEN_EXPIRED` → connection rejected (SC-001).
  - Simulate token expiry mid-session → session suspended within `TOKEN_EXPIRY_GRACE_SECONDS + 5` seconds (SC-006).
- **Acceptance**: all security assertions pass; `pnpm test` exits 0.

---

### GROUP F — ADR & Final Validation (depends on ALL groups complete)

**F-1: ADR**

- Write `docs/adr/adr-082-scope-revocation-strategy.md` documenting:
  - **Context**: need to detect token expiry and scope revocation during active realtime sessions.
  - **Decision**: polling-based scope re-validation every `SCOPE_REVALIDATION_INTERVAL_SECONDS` seconds via Keycloak introspection (see plan Decision 2).
  - **Alternatives considered**: Keycloak event listener SPI (Kafka push); APISIX revocation list.
  - **Consequences**: predictable 30-second worst-case enforcement; no custom Keycloak extension required; polling load scales with active session count.
- **Acceptance**: file present and ≥ 200 words.

**F-2: Final CI validation**

- Run `pnpm test` from repo root — all unit and integration tests must pass.
- Run OpenAPI contract validation: `npx @apidevtools/swagger-parser validate specs/082-realtime-auth-scope-filters/contracts/openapi/realtime-auth-v1.yaml`.
- Run JSON Schema validation: each Kafka schema file must be valid Draft-07.
- Run Helm dry-run: `helm template charts/realtime-gateway | kubectl apply --dry-run=client -f -`.
- Run secret check: `git grep -r 'client_secret\|DATABASE_URL' -- '*.yaml' '*.json'` must return only template placeholders (no hardcoded values).
- Commit everything on branch `082-realtime-auth-scope-filters` and open a PR targeting `main`.
- **Acceptance**: all validations exit 0; PR created; CI green.

---

## Criteria of Done (from plan — implement step must satisfy all)

| ID | Criterion | Evidence |
|----|-----------|---------|
| CD-01 | `validateToken` rejects invalid/expired tokens | Unit tests passing; `TOKEN_INVALID` / `TOKEN_EXPIRED` thrown |
| CD-02 | Subscription creation denied for missing scope | Integration test + PostgreSQL audit record with `action='DENIED'` and `missingScope` |
| CD-03 | Zero cross-tenant event delivery | Security validation test passes; guard rejects |
| CD-04 | Zero cross-workspace event delivery | Security validation test passes |
| CD-05 | Filtered subscription receives ≥ 50% fewer events | Integration test assertion |
| CD-06 | Token expiry suspends delivery within 30 s | Integration test with controlled token TTL |
| CD-07 | Scope revocation suspends sessions within 60 s | Integration test with introspection mock |
| CD-08 | Auth decisions queryable in audit log within 5 s | Kafka consumer + PostgreSQL query in integration test |
| CD-09 | All unit + integration tests pass at root | `pnpm test` exits 0 |
| CD-10 | OpenAPI spec validates | Contract test exits 0 |
| CD-11 | Kafka schemas valid | JSON Schema contract test exits 0 |
| CD-12 | Helm renders without error | `helm template | kubectl apply --dry-run=client` exits 0 |
| CD-13 | ADR committed | `docs/adr/adr-082-scope-revocation-strategy.md` present |
| CD-14 | No plaintext secrets | `git grep` returns only placeholders |

---

## Dependency Graph (summary)

```
GROUP A (A-1 → A-2 → A-3 → A-4)  ←→  GROUP D (D-1, D-2) [parallel with A after A-1]
           ↓
GROUP B (B-1, B-2, B-3, B-4)       ←→  GROUP D [can continue in parallel]
           ↓
GROUP C (C-1 → C-2, C-3)
           ↓
GROUP E (E-1, E-2)
           ↓
GROUP F (F-1, F-2)
```

**Note**: D-1 and D-2 may start after A-1 (package scaffold) and run in parallel with GROUP B and GROUP C. All must be complete before GROUP F.
