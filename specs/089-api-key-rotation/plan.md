# Implementation Plan: Zero-Downtime API Key Rotation

**Branch**: `089-api-key-rotation` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-DX-02-T05 | **Epic**: EP-17 | **Story**: US-DX-02  
**Input**: Permitir rotación de API keys sin downtime planificado y documentar el procedimiento.

---

## Summary

Extend the existing `rotateServiceAccountCredential` workflow (WF-CON-004) and supporting infrastructure with a **grace-period rotation model** that keeps both the old and new credential valid for a configurable overlap window. The change spans:

1. **Data layer** — new PostgreSQL tables for rotation state, rotation history, and tenant rotation policies; migration of the existing `ServiceAccountCredentialReference` lifecycle to include `rotating_deprecated` status.
2. **Backend workflows** — extend WF-CON-004 to emit a grace-period rotation event and schedule expiry; new OpenWhisk action for sweep-based expiry; Kafka audit events.
3. **API contract** — extend `ServiceAccountCredentialRotationRequest` schema with `gracePeriodSeconds`; add new endpoints for rotation status/history and force-complete; new tenant policy endpoints.
4. **Auth layer** — extend APISIX credential verification to accept two simultaneous keys during overlap and inject a `Credential-Deprecated` response header.
5. **Console UI** — rotation status badge, in-progress indicator, force-complete action, rotation history panel in `ConsoleServiceAccountsPage`.
6. **Documentation** — inject a rotation-procedure section into the workspace developer docs (integration with US-DX-02-T03 / `workspace-docs-service`).

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (existing `services/provisioning-orchestrator`), React 18 + Tailwind CSS + shadcn/ui (console)  
**Storage**: PostgreSQL (rotation state, policy, history), Keycloak (credential lifecycle), APISIX (gateway consumer key verification)  
**Testing**: Node built-in `node:test` (backend unit/integration), Vitest (console unit), existing contract-test harness  
**Target Platform**: Kubernetes/OpenShift (Helm), multi-tenant BaaS  
**Project Type**: Multi-service monorepo (control-plane + provisioning-orchestrator + webhook-engine + web-console + workspace-docs-service)  
**Performance Goals**: Grace-period expiry enforced within 60 s of deadline; rotation API p95 < 300 ms  
**Constraints**: Multi-tenancy isolation; RBAC on all rotation actions; secrets never committed; Keycloak is the source of truth for credential issuance; APISIX enforces authentication  
**Scale/Scope**: Per-workspace service accounts, per-tenant policy, up to `maxActiveCredentials` (≤ 3) simultaneous keys per service account

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation of Concerns | ✅ PASS | Changes stay within existing `apps/`, `services/`, `tests/`, `charts/` top-level directories. No new top-level folders. |
| II. Incremental Delivery First | ✅ PASS | Phased plan: data → workflow → API → UI → docs. Each phase independently deployable. |
| III. Kubernetes / OpenShift Compatibility | ✅ PASS | New OpenWhisk actions follow existing patterns. DB migrations via Helm job. No host-specific assumptions. |
| IV. Quality Gates at the Root | ✅ PASS | All new tests wired into existing root-level test scripts. Contract changes extend existing OpenAPI validation. |
| V. Documentation as Part of the Change | ✅ PASS | ADR / docs update included in implementation steps. |
| Secrets | ✅ PASS | No secret values committed; Keycloak-managed credential material handled via adapter contracts only. |
| pnpm workspaces | ✅ PASS | New packages follow existing workspace member pattern. |

---

## Project Structure

### Documentation (this feature)

```text
specs/089-api-key-rotation/
├── plan.md              ← this file
├── research.md          (Phase 0 — resolved below inline)
├── data-model.md        (Phase 1 output)
├── contracts/           (Phase 1 output)
│   ├── rotation-request.schema.json
│   ├── rotation-status.schema.json
│   ├── rotation-history.schema.json
│   ├── tenant-rotation-policy.schema.json
│   └── rotation-events.kafka.json
└── tasks.md             (Phase 2 — /speckit.tasks command)
```

### Source Code (affected areas)

```text
services/provisioning-orchestrator/src/
├── migrations/
│   └── 089-api-key-rotation.sql          ← NEW
├── models/
│   ├── credential-rotation-state.mjs      ← NEW
│   ├── credential-rotation-history.mjs    ← NEW
│   └── tenant-rotation-policy.mjs         ← NEW
├── repositories/
│   ├── credential-rotation-repo.mjs       ← NEW
│   └── tenant-rotation-policy-repo.mjs    ← NEW
└── actions/
    └── credential-rotation-expiry-sweep.mjs  ← NEW

apps/control-plane/src/workflows/
└── wf-con-004-credential-generation.mjs   ← EXTEND (grace-period rotation path)

apps/control-plane/openapi/families/
└── workspaces.openapi.json                ← EXTEND (new schemas + endpoints)

apps/web-console/src/
├── pages/
│   └── ConsoleServiceAccountsPage.tsx     ← EXTEND (rotation status, force-complete, history)
├── components/console/
│   ├── ConsoleCredentialStatusBadge.tsx   ← EXTEND (rotating_deprecated status)
│   ├── CredentialRotationStatusPanel.tsx  ← NEW
│   └── CredentialRotationHistoryPanel.tsx ← NEW
└── lib/
    └── console-service-accounts.ts        ← EXTEND (rotateWithGracePeriod, forceCompleteRotation, fetchRotationHistory)

services/workspace-docs-service/src/
└── rotation-procedure-section.mjs         ← NEW (doc section injector)

services/gateway-config/
└── plugins/credential-rotation-header.yaml  ← NEW (APISIX plugin config for Credential-Deprecated header)

tests/
├── unit/
│   ├── wf-con-004-grace-period-rotation.test.mjs   ← NEW
│   ├── credential-rotation-expiry-sweep.test.mjs    ← NEW
│   └── tenant-rotation-policy.test.mjs              ← NEW
├── integration/
│   └── api-key-rotation-grace-period.test.mjs       ← NEW
└── contract/
    └── rotation-api-contract.test.mjs               ← NEW
```

---

## Phase 0: Research (resolved inline)

### R-001 — Grace-period enforcement mechanism

**Decision**: Server-side sweep via a new OpenWhisk action `credential-rotation-expiry-sweep` scheduled via the existing `scheduling-engine` cron mechanism.  
**Rationale**: Consistent with existing sweep patterns (`async-operation-timeout-sweep`). No new infrastructure required. Sweep runs every 30 s and invalidates credentials whose `deprecated_expires_at < NOW()`.  
**Alternatives rejected**: Redis TTL — adds infra dependency. Keycloak-native expiry — cannot enforce sub-minute precision across overlapping keys without Keycloak customization.

### R-002 — Dual-credential authentication in APISIX

**Decision**: Extend the APISIX consumer key verification via a custom Lua plugin (or extend the existing `workspace-openapi-sdk.openapi.json` gateway fragment) to allow a service account to have two simultaneously valid consumer keys during the grace period. The `Credential-Deprecated` response header is injected by an APISIX response rewrite plugin when the authenticated key is in `rotating_deprecated` state.  
**Rationale**: APISIX supports multiple consumer keys per consumer via the `key-auth` plugin with a `keys` array. The rotation state lookup is a fast PostgreSQL read keyed by credential fingerprint.  
**Alternatives rejected**: Keycloak token introspection per-request — too high latency for data-plane hot path.

### R-003 — Concurrent rotation conflict detection

**Decision**: Optimistic locking via a `rotation_lock_version` integer column on `service_account_credentials` table. A rotation attempt increments the lock; concurrent attempt detects stale version and returns 409.  
**Rationale**: PostgreSQL-native, no distributed lock manager needed. Idempotency key on WF-CON-004 already covers replay safety.

### R-004 — Credential count enforcement during grace period

**Decision**: Before initiating a grace-period rotation, the workflow checks `SELECT COUNT(*) FROM service_account_rotation_states WHERE service_account_id = $1 AND state IN ('active','rotating_deprecated')`. If count ≥ `credentialPolicy.maxActiveCredentials`, return 422 with error code `CREDENTIAL_LIMIT_EXCEEDED`.  
**Rationale**: Consistent with spec FR-015. Count includes both old (deprecated) and new (active) keys.

### R-005 — Documentation section injection

**Decision**: Add a `rotation-procedure-section.mjs` module to `workspace-docs-service` that exports a `buildRotationProcedureSection(workspaceContext)` function. `doc-assembler.mjs` imports and calls it when building the credentials section.  
**Rationale**: Follows the existing assembler extension pattern. No schema changes to the docs service storage.

---

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md) (generated below inline — to be materialized as separate file by tasks step).

#### New table: `service_account_rotation_states`

```sql
CREATE TABLE service_account_rotation_states (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              TEXT NOT NULL,
  workspace_id           TEXT NOT NULL,
  service_account_id     TEXT NOT NULL,
  new_credential_id      TEXT NOT NULL,           -- sac_* id of the freshly issued key
  old_credential_id      TEXT NOT NULL,           -- sac_* id of the key being deprecated
  rotation_type          TEXT NOT NULL CHECK (rotation_type IN ('grace_period','immediate')),
  grace_period_seconds   INTEGER NOT NULL DEFAULT 0,
  deprecated_expires_at  TIMESTAMPTZ,             -- NULL when rotation_type = 'immediate'
  initiated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initiated_by           TEXT NOT NULL,           -- user ID
  state                  TEXT NOT NULL CHECK (state IN ('in_progress','completed','force_completed','expired')),
  completed_at           TIMESTAMPTZ,
  completed_by           TEXT,
  rotation_lock_version  INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX uq_rotation_in_progress
  ON service_account_rotation_states (service_account_id)
  WHERE state = 'in_progress';

CREATE INDEX idx_rotation_expiry
  ON service_account_rotation_states (deprecated_expires_at)
  WHERE state = 'in_progress' AND deprecated_expires_at IS NOT NULL;
```

#### New table: `service_account_rotation_history`

```sql
CREATE TABLE service_account_rotation_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  service_account_id   TEXT NOT NULL,
  rotation_state_id    UUID REFERENCES service_account_rotation_states(id),
  rotation_type        TEXT NOT NULL,
  grace_period_seconds INTEGER NOT NULL,
  old_credential_id    TEXT,
  new_credential_id    TEXT,
  initiated_by         TEXT NOT NULL,
  initiated_at         TIMESTAMPTZ NOT NULL,
  completed_at         TIMESTAMPTZ,
  completed_by         TEXT,
  completion_reason    TEXT CHECK (completion_reason IN ('expired','force_completed','immediate'))
);

CREATE INDEX idx_rotation_history_sa
  ON service_account_rotation_history (service_account_id, initiated_at DESC);
```

#### New table: `tenant_rotation_policies`

```sql
CREATE TABLE tenant_rotation_policies (
  tenant_id                   TEXT PRIMARY KEY,
  max_credential_age_days     INTEGER,           -- NULL = no limit
  max_grace_period_seconds    INTEGER,           -- NULL = no limit
  warn_before_expiry_days     INTEGER DEFAULT 14,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  TEXT NOT NULL
);
```

#### Extension to `ServiceAccountCredentialStatus` enum

Add `rotating_deprecated` to the existing enum:

```text
"active" | "rotating_deprecated" | "rotation_due" | "revoked" | "expired"
```

The migration file is `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql`.

---

### API Contracts

#### Extended: `ServiceAccountCredentialRotationRequest`

```json
{
  "type": "object",
  "required": ["requestedByUserId", "rotateReason"],
  "additionalProperties": false,
  "properties": {
    "requestedByUserId": { "type": "string", "pattern": "^usr_[0-9a-z]+$" },
    "rotateReason":      { "type": "string", "minLength": 3, "maxLength": 255 },
    "gracePeriodSeconds": {
      "type": "integer",
      "minimum": 0,
      "maximum": 86400,
      "default": 0,
      "description": "Duration in seconds during which both old and new credentials remain valid. 0 = immediate rotation."
    },
    "requestedTtl":             { "$ref": "#/components/schemas/DurationString" },
    "revokePreviousCredential": { "type": "boolean", "description": "Deprecated; use gracePeriodSeconds=0 for immediate revocation." }
  }
}
```

#### New: `CredentialRotationStatus` (response schema)

```json
{
  "type": "object",
  "required": ["rotationStateId","state","rotationType","newCredentialId","initiatedAt","initiatedBy"],
  "properties": {
    "rotationStateId":      { "type": "string", "format": "uuid" },
    "state":                { "type": "string", "enum": ["in_progress","completed","force_completed","expired"] },
    "rotationType":         { "type": "string", "enum": ["grace_period","immediate"] },
    "newCredentialId":      { "type": "string" },
    "oldCredentialId":      { "type": "string" },
    "gracePeriodSeconds":   { "type": "integer" },
    "deprecatedExpiresAt":  { "type": "string", "format": "date-time" },
    "initiatedAt":          { "type": "string", "format": "date-time" },
    "initiatedBy":          { "type": "string" },
    "completedAt":          { "type": "string", "format": "date-time" },
    "remainingSeconds":     { "type": "integer", "description": "Seconds until old credential expires; 0 when not in_progress." }
  }
}
```

#### New: `CredentialRotationHistoryEntry`

```json
{
  "type": "object",
  "required": ["id","rotationType","initiatedAt","initiatedBy","completionReason"],
  "properties": {
    "id":                  { "type": "string", "format": "uuid" },
    "rotationType":        { "type": "string", "enum": ["grace_period","immediate"] },
    "gracePeriodSeconds":  { "type": "integer" },
    "oldCredentialId":     { "type": "string" },
    "newCredentialId":     { "type": "string" },
    "initiatedBy":         { "type": "string" },
    "initiatedAt":         { "type": "string", "format": "date-time" },
    "completedAt":         { "type": "string", "format": "date-time" },
    "completionReason":    { "type": "string", "enum": ["expired","force_completed","immediate"] }
  }
}
```

#### New: `TenantRotationPolicy`

```json
{
  "type": "object",
  "required": ["tenantId"],
  "additionalProperties": false,
  "properties": {
    "tenantId":               { "type": "string" },
    "maxCredentialAgeDays":   { "type": ["integer","null"], "minimum": 1 },
    "maxGracePeriodSeconds":  { "type": ["integer","null"], "minimum": 0 },
    "warnBeforeExpiryDays":   { "type": "integer", "minimum": 1, "default": 14 }
  }
}
```

#### New API endpoints (to be added to `workspaces.openapi.json`)

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-status` | Get current rotation state |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-force-complete` | Force-complete an in-progress rotation |
| `GET` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-history` | List past rotations |
| `GET` | `/v1/tenants/{tenantId}/rotation-policy` | Get tenant rotation policy |
| `PUT` | `/v1/tenants/{tenantId}/rotation-policy` | Set/update tenant rotation policy |

All new endpoints carry `x-family: workspaces`, `x-scope: workspace` or `tenant`, `x-rate-limit-class: control-read` / `control-write`, and `x-audiences` aligned with existing service-account endpoints.

#### Kafka audit events (new topics)

| Topic | Retention | Payload key fields |
|-------|-----------|-------------------|
| `console.credential-rotation.initiated` | 90d | `tenantId`, `workspaceId`, `serviceAccountId`, `rotationType`, `gracePeriodSeconds`, `actorId`, `newCredentialId`, `oldCredentialId` |
| `console.credential-rotation.deprecated-expired` | 90d | as above + `deprecatedExpiresAt` |
| `console.credential-rotation.force-completed` | 90d | as above + `completedBy` |
| `console.credential-rotation.policy-violation` | 30d | `tenantId`, `workspaceId`, `requestedGracePeriodSeconds`, `policyMaxGracePeriodSeconds` |
| `console.credential-rotation.age-warning` | 30d | `tenantId`, `workspaceId`, `serviceAccountId`, `credentialId`, `credentialAgeDays`, `policyMaxAgeDays` |

---

## Implementation Sequence

### Step 1 — DB migration (prerequisite for all backend)

**File**: `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql`  
Create all three new tables. Extend `ServiceAccountCredentialStatus` enum in comments (enum is enforced at app level; OpenAPI schema update is the source of truth).  
**Idempotency**: `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX … IF NOT EXISTS`.

### Step 2 — Models & repositories

New files:
- `services/provisioning-orchestrator/src/models/credential-rotation-state.mjs` — plain object factory + validation
- `services/provisioning-orchestrator/src/models/credential-rotation-history.mjs`
- `services/provisioning-orchestrator/src/models/tenant-rotation-policy.mjs`
- `services/provisioning-orchestrator/src/repositories/credential-rotation-repo.mjs` — CRUD + expiry sweep query
- `services/provisioning-orchestrator/src/repositories/tenant-rotation-policy-repo.mjs`

Repository contract (key methods):

```js
// credential-rotation-repo.mjs
createRotationState({ tenantId, workspaceId, serviceAccountId, newCredentialId, oldCredentialId, rotationType, gracePeriodSeconds, initiatedBy })
getInProgressRotation(serviceAccountId)
listExpiredRotations()                    // for sweep
completeRotation({ id, completedBy, completionReason })
listRotationHistory({ serviceAccountId, limit, offset })
```

### Step 3 — Extend WF-CON-004 (grace-period rotation path)

Modify `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs`:

1. When `credentialAction === 'rotate'` and `input.gracePeriodSeconds > 0`:
   a. Validate against tenant policy (reject if `gracePeriodSeconds > policy.maxGracePeriodSeconds`).
   b. Check active credential count; reject if limit exceeded.
   c. Check for in-progress rotation; return 409 `ROTATION_IN_PROGRESS` if found.
   d. Issue new credential via `dependencies.rotateCredential` (Keycloak issues new key without revoking old).
   e. Update APISIX consumer to add the new key alongside the old key (`dependencies.updateGatewayCredential` extended to dual-key mode).
   f. Persist rotation state record via `dependencies.writeRotationState`.
   g. Publish `console.credential-rotation.initiated` Kafka event.
   h. Return `202` with `rotationStateId`, `newCredentialId`, `deprecatedExpiresAt` in output.

2. When `credentialAction === 'rotate'` and `gracePeriodSeconds === 0` (or omitted): preserve existing immediate rotation path, but also write a history record with `completion_reason = 'immediate'` and publish the Kafka audit event.

3. Add new `credentialAction === 'force-complete-rotation'`:
   a. Validate RBAC.
   b. Load in-progress rotation; 404 if none.
   c. Revoke old credential in Keycloak.
   d. Remove old consumer key from APISIX.
   e. Mark rotation state as `force_completed` in DB.
   f. Write history record.
   g. Publish `console.credential-rotation.force-completed` Kafka event.

New dependency injection points added to `defaultDependencies`:

```js
writeRotationState, getInProgressRotation, completeRotation, getTenantRotationPolicy
```

### Step 4 — Expiry sweep OpenWhisk action

**File**: `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs`

Pattern follows `async-operation-timeout-sweep.mjs`:
1. Query `listExpiredRotations()` (up to 100 records per sweep).
2. For each: revoke old credential in Keycloak, remove from APISIX, mark state `expired`, write history record, publish `console.credential-rotation.deprecated-expired` event.
3. Return `{ processed: N, errors: [] }`.

Register in scheduling-engine cron at 30 s interval.

### Step 5 — API contract extension

Extend `apps/control-plane/openapi/families/workspaces.openapi.json`:
- Extend `ServiceAccountCredentialRotationRequest` with `gracePeriodSeconds`.
- Add `rotating_deprecated` to `ServiceAccountCredentialStatus` enum.
- Add schemas: `CredentialRotationStatus`, `CredentialRotationHistoryEntry`, `CredentialRotationHistoryPage`, `TenantRotationPolicy`.
- Add new paths for rotation-status, rotation-force-complete, rotation-history, tenant policy GET/PUT.

### Step 6 — APISIX dual-key support

**File**: `services/gateway-config/plugins/credential-rotation-header.yaml`

- Configure APISIX `key-auth` plugin to accept `keys` array per consumer (already supported in APISIX 3.x).
- Add response rewrite plugin to inject `Credential-Deprecated: true; expires=<ISO8601>` header when authenticated key's status is `rotating_deprecated`. This requires a lightweight lookup in the credential metadata store on the hot path — implement as a Lua snippet in the APISIX plugin chain that reads from a Redis-backed cache (or falls back to the DB with a short TTL cache).

### Step 7 — Console UI extensions

**`ConsoleCredentialStatusBadge.tsx`**: Add visual variant for `rotating_deprecated` (amber badge with clock icon).

**New `CredentialRotationStatusPanel.tsx`**:
- Shows: new key creation time, old key expiry, remaining grace period countdown, "Force Complete" button.
- Polling interval: 30 s refresh while in-progress.
- Permission guard: only renders for `workspace_admin`/`workspace_owner`.

**New `CredentialRotationHistoryPanel.tsx`**:
- Paginated table: timestamp, actor, rotation type, grace period, completion reason.

**`ConsoleServiceAccountsPage.tsx`**:
- Extend `handleRotate` to pass `gracePeriodSeconds` input (new dialog or inline numeric input).
- Render `CredentialRotationStatusPanel` when account has in-progress rotation.
- Add rotation history accordion below credential details.

**`console-service-accounts.ts`**:
- `rotateWithGracePeriod(workspaceId, serviceAccountId, gracePeriodSeconds, reason)` — POST to `credential-rotations` with new field.
- `forceCompleteRotation(workspaceId, serviceAccountId)` — POST to `rotation-force-complete`.
- `fetchRotationStatus(workspaceId, serviceAccountId)` — GET `rotation-status`.
- `fetchRotationHistory(workspaceId, serviceAccountId, page)` — GET `rotation-history`.

### Step 8 — Workspace docs rotation procedure section

**File**: `services/workspace-docs-service/src/rotation-procedure-section.mjs`

Exports `buildRotationProcedureSection(workspaceContext)` that returns a structured markdown section with:
- Step-by-step rotation procedure (console and API flows).
- Grace period explanation.
- Code examples in JavaScript (Node.js `fetch`) and Python (`requests`) — minimum two languages per FR-010.
- Warning about concurrent rotation constraint.
- Link to credential management console page.

**`doc-assembler.mjs`**: Import and call `buildRotationProcedureSection` when the credentials section is assembled; inject result as a subsection under "API Keys & Credentials".

### Step 9 — Tenant rotation policy management

**New OpenWhisk action or extend WF-CON-004** with `credentialAction === 'set-tenant-rotation-policy'` (tenant-scoped, requires `tenant_owner`/`tenant_admin`).

Alternatively expose via a lightweight Express-style handler in `apps/control-plane` following the pattern of existing tenant-level settings endpoints.

Policy enforcement: injected into WF-CON-004 validation step — retrieve policy via `dependencies.getTenantRotationPolicy`, compare requested `gracePeriodSeconds` against `policy.maxGracePeriodSeconds`.

Age-warning sweep: reuse `credential-rotation-expiry-sweep.mjs` with a second query — find credentials whose `issuedAt < NOW() - INTERVAL '(maxCredentialAgeDays - warnBeforeExpiryDays) days'`; publish `console.credential-rotation.age-warning` events.

---

## Testing Strategy

### Unit tests (`tests/unit/`)

| File | Coverage |
|------|----------|
| `wf-con-004-grace-period-rotation.test.mjs` | Grace-period initiation, immediate rotation with history, force-complete, concurrent conflict (409), policy violation (422), credential limit exceeded (422), service account deletion mid-rotation |
| `credential-rotation-expiry-sweep.test.mjs` | Happy path sweep, partial failures, idempotency on re-run |
| `tenant-rotation-policy.test.mjs` | Policy CRUD, enforcement in rotation workflow, age-warning logic |

All use dependency injection pattern (`__setWorkflowDependenciesForTest` / `__resetWorkflowDependenciesForTest`) — consistent with existing WF-CON-004 test harness.

### Integration tests (`tests/integration/`)

| File | Coverage |
|------|----------|
| `api-key-rotation-grace-period.test.mjs` | End-to-end: rotate → both keys auth OK → old key deprecated header → expiry sweep → old key rejected; force-complete path; immediate path |

Uses real PostgreSQL (test DB) and stub Keycloak adapter via dependency injection.

### Contract tests (`tests/contract/`)

| File | Coverage |
|------|----------|
| `rotation-api-contract.test.mjs` | Validates OpenAPI schemas for `CredentialRotationStatus`, `CredentialRotationHistoryEntry`, `TenantRotationPolicy` against example fixtures in `specs/089-api-key-rotation/contracts/` |

### Console UI tests (`apps/web-console/src/__tests__/`)

- `CredentialRotationStatusPanel.test.tsx` — renders in-progress state, force-complete button, countdown.
- `CredentialRotationHistoryPanel.test.tsx` — renders history entries, pagination.
- Extend `ConsoleServiceAccountsPage.test.tsx` — grace period input, rotation status visibility.

### Operational validations

- Sweep action runs and processes > 0 records within 30 s of grace period expiry (verified via `console.credential-rotation.deprecated-expired` Kafka event).
- `Credential-Deprecated` header present on authenticated requests using deprecated key.
- No failed auth on requests using new key immediately after rotation initiation.

---

## Risk & Mitigation Register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| APISIX dual-key consumer config not supported in deployed version | High | Verify APISIX 3.x `key-auth` plugin `keys` array support in pre-deploy check; fallback: store old key in a secondary consumer tied to same service account |
| Keycloak does not support issuing new credential without revoking old in atomic call | High | In `keycloak-admin.mjs`, implement `issueAdditionalCredential` that creates a second client secret before revoking the first; wrap in try/catch with compensating revoke |
| Sweep action misses expiry due to scheduler downtime | Medium | Expiry is checked server-side on every authentication attempt (APISIX plugin reads `deprecated_expires_at`); sweep is belt-and-suspenders |
| Concurrent rotation conflict window between optimistic lock check and insert | Low | Unique partial index `uq_rotation_in_progress` on `service_account_rotation_states` provides DB-level conflict guarantee |
| Rotation history unbounded growth | Low | Scheduled purge job (extend sweep action) to archive records older than 180 days; future concern |
| `Credential-Deprecated` header leaks internal rotation state to external callers | Info | Acceptable by design (spec FR-005); header value is expiry time only, not internal IDs |

---

## Rollback Plan

1. **DB**: Migration is additive only (new tables). Rollback: drop new tables (no existing table modification). Existing `ServiceAccountCredentialStatus` enum values are unchanged.
2. **WF-CON-004**: Grace-period path is additive (new `if` branch on `gracePeriodSeconds > 0`). Existing `rotate` path unchanged. Deploy old binary = old behaviour.
3. **APISIX**: Gateway config change is additive. Remove new plugin config to revert to single-key auth.
4. **Console**: New components are conditionally rendered. Feature flag or removal of import reverts UI.

---

## Observability

- All rotation lifecycle events emitted to Kafka topics with full context fields (tenant, workspace, actor, credential IDs, timestamps).
- OpenWhisk action invocation logs capture sweep results (`processed`, `errors`).
- `deprecated_expires_at` indexed for monitoring query: `SELECT COUNT(*) FROM service_account_rotation_states WHERE state = 'in_progress'` — alert if > threshold.
- Console feedback messages on rotation initiation include `deprecatedExpiresAt` timestamp for operator visibility.

---

## Security

- RBAC enforced at WF-CON-004 entry point (existing `validateCallerAuthorization`); rotation and force-complete require `workspace_admin` / `workspace_owner` / `tenant_admin` roles.
- Tenant policy enforcement prevents grace periods longer than tenant-configured maximum.
- Active credential count enforcement (FR-015) prevents credential proliferation.
- Audit events recorded for every rotation action (FR-007), including actor identity and rotation type.
- `Credential-Deprecated` header does not expose new credential details; only expiry time.
- Old credential revocation in Keycloak and removal from APISIX are both required for complete invalidation; sweep ensures expiry even if console UI is not used.

---

## Dependencies and Sequencing

```text
Step 1 (DB migration)
  └─ Step 2 (models/repos)
       └─ Step 3 (WF-CON-004 extension)
       └─ Step 4 (expiry sweep)
            └─ Step 9 (tenant policy + age warning)
  └─ Step 5 (OpenAPI contract)
       └─ Step 7 (console UI)
  └─ Step 6 (APISIX dual-key) ← can parallel with Step 3
  └─ Step 8 (docs section) ← can parallel with Step 3+
```

Steps 6 and 8 can run in parallel with Steps 3–4 once the DB migration is in place. Steps 7 and 9 depend on the API contract (Step 5) being final.

---

## Done Criteria (verifiable)

| ID | Criterion | Evidence |
|----|-----------|---------|
| DC-001 | `POST /credential-rotations` with `gracePeriodSeconds > 0` returns 202 and both old + new keys authenticate within the overlap window | Integration test green |
| DC-002 | Old credential automatically invalidated within 60 s of grace period expiry | Sweep action test + Kafka event `deprecated-expired` received |
| DC-003 | `POST /rotation-force-complete` immediately invalidates old key | Unit + integration test green |
| DC-004 | Concurrent rotation attempt returns 409 `ROTATION_IN_PROGRESS` | Unit test green |
| DC-005 | Grace period > tenant policy limit returns 422 `POLICY_VIOLATION` | Unit test green |
| DC-006 | `Credential-Deprecated` header present on requests authenticated with deprecated key, including expiry time | Integration test assertion |
| DC-007 | 100% of rotation actions appear in `service_account_rotation_history` and in Kafka audit topics | Integration test + event assertion |
| DC-008 | `GET /rotation-status` returns accurate `remainingSeconds` and rotation state | Unit + integration test green |
| DC-009 | `GET /rotation-history` returns chronological list with actor, type, timestamps | Integration test green |
| DC-010 | Console displays rotation status badge and `CredentialRotationStatusPanel` for in-progress rotations | Console component tests green |
| DC-011 | Workspace developer docs include rotation-procedure section with ≥ 2 language code examples | Doc assembler test + manual review of rendered output |
| DC-012 | Contract tests validate all new OpenAPI schemas against fixtures | Contract test suite green |
| DC-013 | All new tests wired into root-level test runner without failures | `pnpm test` green from repo root |
| DC-014 | No secrets committed; migration file reviewed clean | Git diff inspection |
