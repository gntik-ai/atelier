# Tasks — US-SEC-02-T02: Rotación de Secretos sin Redespliegue

**Feature Branch**: `092-secret-rotation-no-redeploy`  
**Task ID**: US-SEC-02-T02  
**Epic**: EP-18 — Seguridad funcional transversal  
**Plan source**: `specs/092-secret-rotation-no-redeploy/plan.md`  
**Status**: Ready for implementation  
**Depends on**: US-SEC-02-T01 (`091-secure-secret-storage`) — Vault OSS + ESO + `secret_metadata` operativos

---

## File-Path Map (implement scope)

The following files must be created or modified. **No other files are in scope.**

### New files — Backend

| Path | Type |
|---|---|
| `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql` | SQL migration |
| `services/provisioning-orchestrator/src/models/secret-version-state.mjs` | Model + constants |
| `services/provisioning-orchestrator/src/models/secret-rotation-event.mjs` | Model + constants |
| `services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs` | Repository |
| `services/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs` | OpenWhisk action |
| `services/provisioning-orchestrator/src/actions/secret-rotation-revoke.mjs` | OpenWhisk action |
| `services/provisioning-orchestrator/src/actions/secret-rotation-expiry-sweep.mjs` | OpenWhisk action (cron) |
| `services/provisioning-orchestrator/src/actions/secret-rotation-propagation-timeout-sweep.mjs` | OpenWhisk action (cron) |
| `services/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs` | OpenWhisk action |
| `services/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs` | OpenWhisk action |
| `services/provisioning-orchestrator/tests/secret-rotation-repo.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-version-state.model.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-rotation-event.model.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-rotation-initiate.action.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-rotation-revoke.action.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-rotation-expiry-sweep.action.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-consumer-ack.action.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/secret-rotation-propagation-timeout-sweep.action.test.mjs` | Unit test |
| `services/provisioning-orchestrator/tests/integration/secret-rotation-initiate.integration.test.mjs` | Integration test |
| `services/provisioning-orchestrator/tests/integration/secret-rotation-grace-expiry.integration.test.mjs` | Integration test |
| `services/provisioning-orchestrator/tests/integration/secret-rotation-revoke.integration.test.mjs` | Integration test |
| `services/provisioning-orchestrator/tests/integration/secret-consumer-propagation.integration.test.mjs` | Integration test |
| `services/provisioning-orchestrator/tests/integration/secret-rotation-multi-tenant-isolation.integration.test.mjs` | Integration test |
| `services/provisioning-orchestrator/tests/contract/secret-rotation-api.contract.test.mjs` | Contract test |

### New files — Frontend

| Path | Type |
|---|---|
| `apps/web-console/src/pages/ConsoleSecretsPage.tsx` | React page |
| `apps/web-console/src/pages/ConsoleSecretsPage.test.tsx` | Page test |
| `apps/web-console/src/pages/ConsoleSecretRotationPage.tsx` | React page |
| `apps/web-console/src/pages/ConsoleSecretRotationPage.test.tsx` | Page test |
| `apps/web-console/src/actions/secretRotationActions.ts` | Console actions |

### Modified files

| Path | Change |
|---|---|
| `apps/web-console/src/router.tsx` | Add two lazy routes: `/secrets` and `/secrets/:encodedSecretPath/rotate` |
| `AGENTS.md` | Add "Secure Secret Rotation" section in `<!-- MANUAL ADDITIONS START -->` block |

### OpenAPI family file (if rotation endpoints are added to control-plane API)

| Path | Change |
|---|---|
| `apps/control-plane/openapi/families/platform.openapi.json` | Add paths under `/v1/platform/secrets/{domain}/{secretName}/rotate`, `/v1/platform/secrets/{domain}/{secretName}/versions/{vaultVersion}/revoke`, `/v1/platform/secrets/{domain}/{secretName}/history`, `/v1/platform/secrets/{domain}/{secretName}/consumer-ack` |

> **Note**: Only `platform.openapi.json` is in scope. Do NOT reference or modify `control-plane.openapi.json`.

---

## Step 1 — PostgreSQL Migration

**File**: `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql`

Create the following tables exactly as specified in plan §3.1. No changes to existing tables.

### Tables

**`secret_version_states`**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `secret_path TEXT NOT NULL` — e.g. `platform/postgresql/app-password`
- `domain TEXT NOT NULL` — one of `platform`, `tenant`, `functions`, `gateway`, `iam`
- `tenant_id UUID` — nullable for platform-scoped secrets
- `secret_name TEXT NOT NULL`
- `vault_version INTEGER NOT NULL` — KV v2 version number from Vault
- `state TEXT NOT NULL CHECK (state IN ('active','grace','expired','revoked'))`
- `grace_period_seconds INTEGER NOT NULL DEFAULT 0`
- `grace_expires_at TIMESTAMPTZ` — NULL for `active` state; set when transitioning to `grace`
- `activated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `expired_at TIMESTAMPTZ` — set when state transitions to `expired` or `revoked`
- `initiated_by TEXT NOT NULL` — actor identity
- `revocation_justification TEXT`
- `rotation_lock_version INTEGER NOT NULL DEFAULT 0` — optimistic lock counter

**Indexes on `secret_version_states`**:
- `CREATE UNIQUE INDEX uq_secret_active_version ON secret_version_states (secret_path) WHERE state = 'active'` — enforces max one active version per path
- `CREATE INDEX idx_svs_grace_expiry ON secret_version_states (grace_expires_at) WHERE state = 'grace' AND grace_expires_at IS NOT NULL`
- `CREATE INDEX idx_svs_domain_tenant ON secret_version_states (domain, tenant_id)`

**`secret_consumer_registry`**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `secret_path TEXT NOT NULL`
- `consumer_id TEXT NOT NULL` — e.g. `apisix`, `keycloak`, `kafka-broker`
- `consumer_namespace TEXT NOT NULL` — k8s namespace
- `eso_external_secret_name TEXT` — name of ExternalSecret CRD to annotate for refresh
- `reload_mechanism TEXT NOT NULL CHECK (reload_mechanism IN ('eso_annotation','sighup','api_reload','pool_refresh'))`
- `registered_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `registered_by TEXT NOT NULL`
- `UNIQUE (secret_path, consumer_id)`

**`secret_propagation_events`**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `secret_path TEXT NOT NULL`
- `vault_version INTEGER NOT NULL`
- `consumer_id TEXT NOT NULL`
- `state TEXT NOT NULL CHECK (state IN ('pending','confirmed','timeout','failed'))`
- `requested_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `confirmed_at TIMESTAMPTZ`
- `timeout_at TIMESTAMPTZ`
- `error_detail TEXT`

**Indexes on `secret_propagation_events`**:
- `CREATE INDEX idx_spe_pending ON secret_propagation_events (secret_path, vault_version) WHERE state = 'pending'`

**`secret_rotation_events`** — append-only audit log
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `secret_path TEXT NOT NULL`
- `domain TEXT NOT NULL`
- `tenant_id UUID`
- `event_type TEXT NOT NULL CHECK (event_type IN ('initiated','grace_started','consumer_reload_requested','consumer_reload_confirmed','consumer_reload_timeout','grace_expired','revoked','revoke_confirmed','rotation_failed'))`
- `vault_version_new INTEGER`
- `vault_version_old INTEGER`
- `grace_period_seconds INTEGER`
- `actor_id TEXT NOT NULL`
- `actor_roles TEXT[]`
- `occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `detail JSONB DEFAULT '{}'::jsonb` — metadata only, never contains secret values

**Indexes on `secret_rotation_events`**:
- `CREATE INDEX idx_sre_path_time ON secret_rotation_events (secret_path, occurred_at DESC)`

### Acceptance check

```sql
\d secret_version_states  -- shows table + both indexes
SELECT indexname FROM pg_indexes WHERE tablename='secret_version_states';
-- must include: uq_secret_active_version, idx_svs_grace_expiry, idx_svs_domain_tenant
```

---

## Step 2 — Models

### `services/provisioning-orchestrator/src/models/secret-version-state.mjs`

```js
export const SECRET_STATES = Object.freeze(['active', 'grace', 'expired', 'revoked']);
export const SECRET_DOMAINS = Object.freeze(['platform', 'tenant', 'functions', 'gateway', 'iam']);
export const SECRET_ROTATION_MIN_GRACE_SECONDS = parseInt(process.env.SECRET_ROTATION_MIN_GRACE_SECONDS ?? '300', 10);
export const SECRET_ROTATION_MAX_GRACE_SECONDS = parseInt(process.env.SECRET_ROTATION_MAX_GRACE_SECONDS ?? '86400', 10);

// Validates a full secret_version_states record; throws Error with descriptive message on failure
export function validateSecretVersionState(record) { /* ... */ }

// Creates a new record object for INSERT; does NOT persist
export function createSecretVersionRecord({ secretPath, domain, tenantId, secretName, vaultVersion, gracePeriodSeconds, initiatedBy }) { /* ... */ }

// ensureNoSecretMaterial: throw if object contains disallowed keys (value, data, password, token, key, secret)
export function ensureNoSecretMaterial(obj) { /* ... */ }
```

### `services/provisioning-orchestrator/src/models/secret-rotation-event.mjs`

```js
export const ROTATION_EVENT_TYPES = Object.freeze([
  'initiated', 'grace_started', 'consumer_reload_requested',
  'consumer_reload_confirmed', 'consumer_reload_timeout',
  'grace_expired', 'revoked', 'revoke_confirmed', 'rotation_failed'
]);

export function validateRotationEvent(record) { /* ... */ }
export function createRotationEventRecord({ secretPath, domain, tenantId, eventType, vaultVersionNew, vaultVersionOld, gracePeriodSeconds, actorId, actorRoles, detail }) { /* ... */ }
```

---

## Step 3 — Repository

### `services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs`

All functions accept `client` as first arg (pg pool or transaction client). Pure data layer — no business logic, no Vault calls, no Kafka calls.

| Function | Signature | Behavior |
|---|---|---|
| `insertSecretVersion` | `(client, record)` → `record` | INSERT into `secret_version_states`; returns inserted row |
| `getActiveVersion` | `(client, secretPath)` → `row \| null` | SELECT WHERE secret_path=$1 AND state='active' |
| `getGraceVersion` | `(client, secretPath)` → `row \| null` | SELECT WHERE secret_path=$1 AND state='grace' |
| `transitionToGrace` | `(client, { secretPath, gracePeriodSeconds, initiatedBy })` → `row` | UPDATE state='grace', grace_expires_at=NOW()+interval; returns updated row |
| `revokeVersion` | `(client, { id, justification, actorId })` → `row` | UPDATE state='revoked', expired_at=NOW(), revocation_justification; returns row |
| `listExpiredGraceVersions` | `(client, batchSize)` → `row[]` | SELECT WHERE state='grace' AND grace_expires_at <= NOW() LIMIT batchSize FOR UPDATE SKIP LOCKED |
| `expireGraceVersion` | `(client, { id, actorId })` → `row` | UPDATE state='expired', expired_at=NOW() |
| `insertRotationEvent` | `(client, record)` → `row` | INSERT into `secret_rotation_events`; calls `ensureNoSecretMaterial(record.detail)` before insert |
| `listRotationHistory` | `(client, { secretPath, limit, offset })` → `{ rows, total }` | SELECT … ORDER BY occurred_at DESC with COUNT(*) OVER() |
| `upsertConsumer` | `(client, record)` → `row` | INSERT … ON CONFLICT (secret_path, consumer_id) DO UPDATE |
| `listConsumers` | `(client, secretPath)` → `row[]` | SELECT from `secret_consumer_registry` WHERE secret_path=$1 |
| `insertPropagationEvent` | `(client, record)` → `row` | INSERT into `secret_propagation_events` |
| `confirmPropagation` | `(client, { secretPath, vaultVersion, consumerId })` → `row` | UPDATE state='confirmed', confirmed_at=NOW() WHERE state='pending'; idempotent — no-op if already confirmed |
| `listPendingPropagations` | `(client, { secretPath, vaultVersion })` → `row[]` | SELECT WHERE state='pending' |
| `listTimedOutPropagations` | `(client, { timeoutThreshold, batchSize })` → `row[]` | SELECT WHERE state='pending' AND requested_at < $1 LIMIT $2 FOR UPDATE SKIP LOCKED |
| `markPropagationTimeout` | `(client, { id })` → `row` | UPDATE state='timeout', timeout_at=NOW() |

---

## Step 4 — Core Actions

Pattern: each action exports `main(params)` + `resolveDependencies(params)` (same as `credential-rotation-expiry-sweep.mjs` in the same directory). All actions are pure ESM (`import`/`export`). Dependencies injected for testability.

### `secret-rotation-initiate.mjs`

**Required params**: `{ auth, secretPath, domain, tenantId?, newValue, gracePeriodSeconds?, justification }`

**Default deps injected via `resolveDependencies`**: `db`, `repo` (secret-rotation-repo), `vaultClient`, `publishEvent`, `triggerEsoRefresh`

**Logic** (implement exactly this sequence):

1. **Auth check**: verify `auth.roles` includes `superadmin` OR (`platform-operator` AND `domain` in `['platform','gateway','iam','functions']`) OR (`tenant-owner` AND `auth.tenantId === tenantId` AND `domain === 'tenant'`). Return `{ error: { code: 'FORBIDDEN', status: 403 } }` on failure.
2. **Validate grace period**: `gracePeriodSeconds` defaults to `SECRET_ROTATION_DEFAULT_GRACE_SECONDS` (env, default 1800). Reject if < `SECRET_ROTATION_MIN_GRACE_SECONDS` (300) or > `SECRET_ROTATION_MAX_GRACE_SECONDS` (86400) with `{ error: { code: 'INVALID_GRACE_PERIOD', status: 422 } }`.
3. **Read current state from PG**: `getActiveVersion(client, secretPath)` and `getGraceVersion(client, secretPath)`.
4. **Chained rotation check**: if a grace version already exists, invalidate it immediately (UPDATE state='expired' via `expireGraceVersion`) within the upcoming transaction — this is the "max two versions" enforcement step.
5. **PostgreSQL transaction** (BEGIN … COMMIT):
   a. `transitionToGrace(client, { secretPath, gracePeriodSeconds, initiatedBy: auth.sub })` on the current active version.
   b. `insertSecretVersion(client, { secretPath, domain, tenantId, secretName, vaultVersion: <TBD from Vault response>, state: 'active', gracePeriodSeconds: 0, initiatedBy: auth.sub })` — `vaultVersion` is filled after Vault write (see step 6 note below).
   c. `insertRotationEvent(client, { eventType: 'initiated', ... })`
   d. `insertRotationEvent(client, { eventType: 'grace_started', gracePeriodSeconds, ... })`
6. **Vault write**: `PUT /v1/{VAULT_MOUNT}/data/{secretPath}` with `{ data: { value: newValue } }` via Vault KV v2 API. Parse `version` from Vault response; update the `secret_version_states` row inserted in step 5b with `vault_version = response.data.version`.
7. **Vault failure rollback**: if Vault write fails, ROLLBACK the PG transaction. Return `{ error: { code: 'VAULT_WRITE_FAILED', status: 502 } }`.
8. COMMIT PG transaction.
9. **Propagation**: for each consumer in `listConsumers(client, secretPath)`:
   - `insertPropagationEvent(client, { secretPath, vaultVersion, consumerId, state: 'pending' })`
   - if `consumer.reload_mechanism === 'eso_annotation'`: call `triggerEsoRefresh(consumer.eso_external_secret_name, consumer.consumer_namespace)`
   - `publishEvent('console.secrets.consumer.reload-requested', { consumerId, secretPath, vaultVersion, requestedAt })`
10. `publishEvent('console.secrets.rotation.initiated', { secretPath, domain, tenantId, actor: auth.sub, vaultVersionNew: vaultVersion, vaultVersionOld: previousVersion })`
11. `publishEvent('console.secrets.rotation.grace-started', { secretPath, gracePeriodSeconds, graceExpiresAt })`
12. Return `{ rotationId: <uuid>, vaultVersionNew: vaultVersion, vaultVersionOld: previousVaultVersion, gracePeriodSeconds, graceExpiresAt }`.

> **Implementation note on step 5b/6**: Use a two-phase approach — insert with `vault_version = -1` as placeholder within the TX, commit, then perform Vault write, then UPDATE the row with the real `vault_version`. This preserves atomicity: if Vault write fails, rollback the whole TX including the placeholder row.

### `secret-rotation-revoke.mjs`

**Required params**: `{ auth, secretPath, domain, tenantId?, vaultVersion, justification, forceRevoke? }`

**Logic**:

1. Auth check (same as initiate).
2. Fetch target version: SELECT from `secret_version_states` WHERE secret_path=$1 AND vault_version=$2. Return `404 VERSION_NOT_FOUND` if missing.
3. Fetch active version of same path: `getActiveVersion(client, secretPath)`.
4. **Safety check**: if target is the only version that is `active` or `grace` (no other valid version exists for this path): if `forceRevoke !== true` → return `{ error: { code: 'REVOKE_LEAVES_NO_ACTIVE_VERSION', status: 409 } }`.
5. **PG transaction**:
   a. `revokeVersion(client, { id: target.id, justification, actorId: auth.sub })`
   b. `insertRotationEvent(client, { eventType: 'revoked', vaultVersionOld: vaultVersion, ... })`
6. **Vault soft-delete**: `DELETE /v1/{VAULT_MOUNT}/data/{secretPath}?versions=[vaultVersion]` (Vault KV v2 metadata API).
7. COMMIT.
8. `publishEvent('console.secrets.rotation.revoked', { secretPath, vaultVersion, revokedBy: auth.sub, justification, forceRevoke })`
9. Return `{ revokedVersion: vaultVersion, effectiveAt: now() }`.

### `secret-rotation-expiry-sweep.mjs`

**Pattern**: mirrors `credential-rotation-expiry-sweep.mjs` structure exactly.

**Params**: `{ batchSize? }` — invoked by k8s CronJob every 60 s.

**Logic**:
1. `listExpiredGraceVersions(client, batchSize ?? SECRET_ROTATION_SWEEP_BATCH_SIZE)`.
2. For each version:
   a. `expireGraceVersion(client, { id, actorId: 'system:expiry-sweep' })`
   b. Vault soft-delete: `DELETE /v1/{VAULT_MOUNT}/data/{secretPath}?versions=[oldVaultVersion]`
   c. `insertRotationEvent(client, { eventType: 'grace_expired', ... })`
   d. `publishEvent('console.secrets.rotation.grace-expired', { secretPath, vaultVersionOld, expiredAt: now() })`
3. Return `{ processed: N, errors: [...] }` — partial success allowed; errors logged individually.

### `secret-rotation-propagation-timeout-sweep.mjs`

**Params**: `{}` — invoked every 30 s.

**Logic**:
1. `listTimedOutPropagations(client, { timeoutThreshold: now() - RELOAD_ACK_TIMEOUT_SECONDS, batchSize: SECRET_ROTATION_SWEEP_BATCH_SIZE })`
2. For each: `markPropagationTimeout(client, { id })` + `insertRotationEvent(...)` with `eventType: 'consumer_reload_timeout'` + `publishEvent('console.secrets.consumer.reload-timeout', { consumerId, secretPath, vaultVersion })`
3. Return `{ processed: N, errors: [...] }`.

### `secret-rotation-consumer-status.mjs`

**Params**: `{ auth, secretPath, vaultVersion? }`

**Logic**: Auth check → `listConsumers(client, secretPath)` → for each consumer join `secret_propagation_events` WHERE vault_version matches (or latest version if not specified). Return `{ consumers: [{ consumer_id, reload_mechanism, state, confirmedAt, timeoutAt }] }`.

### `secret-consumer-ack.mjs`

**Params**: `{ consumerId, secretPath, vaultVersion }`

**Logic** (no auth token required — internal service-to-service call validated by APISIX mTLS or internal network policy):
1. `confirmPropagation(client, { secretPath, vaultVersion, consumerId })` (idempotent).
2. `insertRotationEvent(client, { eventType: 'consumer_reload_confirmed', actor_id: consumerId })`.
3. `publishEvent('console.secrets.consumer.reload-confirmed', { consumerId, secretPath, vaultVersion, confirmedAt: now() })`.
4. Return `{ ack: true }`.

---

## Step 5 — Sweeper CronJobs (Helm)

### `charts/in-falcone/values.yaml` additions

```yaml
secretRotation:
  enabled: true
  minGraceSeconds: 300
  maxGraceSeconds: 86400
  defaultGraceSeconds: 1800
  reloadAckTimeoutSeconds: 60
  sweepBatchSize: 50
  expirySweepCronSchedule: "*/1 * * * *"
  propagationTimeoutCronSchedule: "*/1 * * * *"
```

### Helm CronJob templates

**`charts/in-falcone/templates/cronjob-secret-rotation-expiry-sweep.yaml`**
- Schedule: `.Values.secretRotation.expirySweepCronSchedule`
- Runs OpenWhisk action `secret-rotation-expiry-sweep` via `owcli invoke` or equivalent
- `{{ if .Values.secretRotation.enabled }}` guard

**`charts/in-falcone/templates/cronjob-secret-rotation-propagation-timeout-sweep.yaml`**
- Schedule: `.Values.secretRotation.propagationTimeoutCronSchedule`
- Runs `secret-rotation-propagation-timeout-sweep` action
- `{{ if .Values.secretRotation.enabled }}` guard

---

## Step 6 — OpenAPI: `platform.openapi.json`

**File**: `apps/control-plane/openapi/families/platform.openapi.json`

Add the following path groups (schemas inlined or added to the file's `components/schemas` section):

### Paths to add

```text
POST   /v1/platform/secrets/{domain}/{secretName}/rotate
         → body: { gracePeriodSeconds, justification, newValue }
         → 200: { rotationId, vaultVersionNew, vaultVersionOld, gracePeriodSeconds, graceExpiresAt }
         → 409: REVOKE_LEAVES_NO_ACTIVE_VERSION | ROTATION_IN_PROGRESS
         → 422: INVALID_GRACE_PERIOD
         → 502: VAULT_WRITE_FAILED

POST   /v1/platform/secrets/{domain}/{secretName}/versions/{vaultVersion}/revoke
         → body: { justification, forceRevoke? }
         → 200: { revokedVersion, effectiveAt }
         → 404: VERSION_NOT_FOUND
         → 409: REVOKE_LEAVES_NO_ACTIVE_VERSION

GET    /v1/platform/secrets/{domain}/{secretName}/history
         → query: limit, offset
         → 200: { items: [RotationEventItem], total }

GET    /v1/platform/secrets/{domain}/{secretName}/consumer-status
         → query: vaultVersion?
         → 200: { consumers: [ConsumerStatusItem] }

POST   /v1/platform/secrets/{domain}/{secretName}/consumer-ack
         → body: { consumerId, vaultVersion }
         → 200: { ack: true }
```

Path parameter `{domain}` enum: `platform`, `tenant`, `functions`, `gateway`, `iam`.

**Do NOT modify `control-plane.openapi.json`** — only `platform.openapi.json`.

---

## Step 7 — Console Pages

### `apps/web-console/src/pages/ConsoleSecretsPage.tsx`

- Fetch secrets inventory from existing `secret_metadata` endpoint (T01 artifact); enrich with version state from `GET /v1/platform/secrets/{domain}/{secretName}/history` (latest entry).
- Render `DataTable` (shadcn/ui) with columns: name, domain, tenant, version state badge, last rotated, actions.
- `SecretVersionBadge` component: green=active, yellow=grace, gray=expired, red=revoked.
- Action buttons: "Rotate" (navigates to `/secrets/:encodedSecretPath/rotate`), "History" (inline drawer), "Revoke" (opens `RevokeDialog`).
- `RevokeDialog`: confirms version to revoke, justification textarea, warning banner if revoking last valid version, calls `revokeSecretVersion(...)`.

### `apps/web-console/src/pages/ConsoleSecretRotationPage.tsx`

- Route param: `:encodedSecretPath` (URL-encoded secret path).
- **Rotation form**: `gracePeriodSeconds` as slider (300–86400) + number input, `justification` textarea (required), `newValue` password input. Submit calls `initiateRotation(...)`.
- **Rotation history table**: paginated list from `listRotationHistory(secretPath, { limit: 20, offset })`. Columns: event type, actor, timestamp, version new/old, grace period.
- **Consumer status panel**: auto-refreshes every 5 s via `getConsumerStatus(secretPath)`. Shows consumer ID, reload mechanism, state badge, confirmed/timeout timestamps. Stops polling once all consumers are `confirmed` or any are `timeout`.
- Confirmation dialog before submitting rotation.

### `apps/web-console/src/actions/secretRotationActions.ts`

```ts
export async function initiateRotation(
  secretPath: string,
  { gracePeriodSeconds, justification, newValue }: InitiateRotationInput
): Promise<RotationResult>

export async function revokeSecretVersion(
  secretPath: string,
  vaultVersion: number,
  { justification, forceRevoke }: RevokeInput
): Promise<RevokeResult>

export async function listRotationHistory(
  secretPath: string,
  { limit, offset }: PaginationInput
): Promise<RotationHistoryPage>

export async function getConsumerStatus(
  secretPath: string,
  vaultVersion?: number
): Promise<ConsumerStatusPage>
```

### `apps/web-console/src/router.tsx`

Add two lazy-loaded routes inside the existing `ConsoleShellLayout` protected section:

```tsx
const ConsoleSecretsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleSecretsPage')
  return { default: module.ConsoleSecretsPage }
})

const ConsoleSecretRotationPage = lazy(async () => {
  const module = await import('@/pages/ConsoleSecretRotationPage')
  return { default: module.ConsoleSecretRotationPage }
})

// routes:
{ path: '/secrets', element: <ConsoleSecretsPage /> }
{ path: '/secrets/:encodedSecretPath/rotate', element: <ConsoleSecretRotationPage /> }
```

---

## Step 8 — Tests

### Unit tests scope (mocked deps)

All unit tests use `node:test` + `assert` (no additional test framework). Mock `db`, `vaultClient`, `publishEvent`, `triggerEsoRefresh` via `resolveDependencies` injection.

| Test file | Key scenarios |
|---|---|
| `secret-rotation-repo.test.mjs` | `insertSecretVersion` rejects duplicate active; `transitionToGrace` computes `grace_expires_at` correctly; `uq_secret_active_version` index prevents two active rows; `insertRotationEvent` calls `ensureNoSecretMaterial`; `listExpiredGraceVersions` returns only expired grace rows |
| `secret-version-state.model.test.mjs` | `validateSecretVersionState` — valid states pass; invalid state throws; grace period below MIN throws; grace period above MAX throws; unknown domain throws |
| `secret-rotation-event.model.test.mjs` | All event types valid; unknown type throws |
| `secret-rotation-initiate.action.test.mjs` | Happy path returns rotationId; Vault failure triggers PG rollback + 502; `forceRevoke` not needed here; grace period default applied; chained rotation invalidates older grace version; 403 on insufficient roles; 422 on out-of-range grace |
| `secret-rotation-revoke.action.test.mjs` | Normal revoke; 409 on last-version without forceRevoke; 200 with forceRevoke; 404 on unknown version; audit event always created |
| `secret-rotation-expiry-sweep.action.test.mjs` | Processes N expired rows; partial error in one row does not stop others; returns correct `{ processed, errors }` |
| `secret-consumer-ack.action.test.mjs` | Happy path returns `{ ack: true }`; idempotent — second ACK for same (secretPath, vaultVersion, consumerId) is a no-op; rotation event inserted on first ACK only |
| `secret-rotation-propagation-timeout-sweep.action.test.mjs` | Detects pending propagations older than timeout; marks as timeout; publishes Kafka event |

### Integration tests scope (real PostgreSQL container)

Use existing test DB setup pattern from other integration tests in `tests/integration/`. Vault and Kafka calls remain mocked (inject stubs).

| Test file | Scenario |
|---|---|
| `secret-rotation-initiate.integration.test.mjs` | Full rotate against real PG: verify 1 active + 1 grace row; `secret_rotation_events` has `initiated` + `grace_started` rows |
| `secret-rotation-grace-expiry.integration.test.mjs` | Insert version with `grace_expires_at = NOW() - 1 second` → run sweep → verify state=`expired` in PG + correct event type in `secret_rotation_events` |
| `secret-rotation-revoke.integration.test.mjs` | Revoke grace version → verify state=`revoked` + active version still in PG |
| `secret-consumer-propagation.integration.test.mjs` | Register consumer → initiate rotation → post ACK → verify `secret_propagation_events.state = 'confirmed'` |
| `secret-rotation-multi-tenant-isolation.integration.test.mjs` | Insert secrets for tenant A and tenant B; rotate tenant A's secret; verify tenant B's `secret_version_states` unchanged |

### Contract tests

`tests/contract/secret-rotation-api.contract.test.mjs`:
- Call `main()` of both `secret-rotation-initiate.mjs` and `secret-rotation-revoke.mjs` with all-mocked deps.
- Assert response shape (fields present, types correct, no extra secret-value fields) for both success and error paths.

### Console tests

Use Vitest + React Testing Library (existing test framework in `apps/web-console`).

`ConsoleSecretsPage.test.tsx`:
- Renders table with mocked secrets inventory.
- `SecretVersionBadge` renders correct color class per state.
- Clicking "Rotate" navigates to `/secrets/:path/rotate`.
- `RevokeDialog` opens on "Revoke" click; shows warning banner when `forceRevoke` needed.

`ConsoleSecretRotationPage.test.tsx`:
- Renders rotation form with slider and input.
- Submits form: `initiateRotation` called with correct args.
- Consumer status panel renders correct state badges.
- Polling stops when all consumers confirmed.

---

## Step 9 — Environment Variables

Add to all relevant deployment configs (Helm values, `.env.example`, provisioning-orchestrator README):

```dotenv
SECRET_ROTATION_MIN_GRACE_SECONDS=300
SECRET_ROTATION_MAX_GRACE_SECONDS=86400
SECRET_ROTATION_DEFAULT_GRACE_SECONDS=1800
RELOAD_ACK_TIMEOUT_SECONDS=60
SECRET_ROTATION_SWEEP_BATCH_SIZE=50
VAULT_ADDR=https://vault.secret-store.svc.cluster.local:8200
VAULT_NAMESPACE=platform
VAULT_SKIP_VERIFY=false
```

> `VAULT_ADDR`, `VAULT_NAMESPACE`, `VAULT_SKIP_VERIFY` are already documented from T01 (`091-secure-secret-storage`) — reuse existing values; do not duplicate if already present.

---

## Step 10 — AGENTS.md Update

Append the following inside the `<!-- MANUAL ADDITIONS START -->` block of `/root/projects/_active/AGENTS.md` (after the existing "Secure Secret Storage" section):

```markdown
## Secure Secret Rotation (092-secret-rotation-no-redeploy)

- New PostgreSQL tables: `secret_version_states`, `secret_consumer_registry`, `secret_propagation_events`, `secret_rotation_events`.
- Migration file: `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql`.
- New OpenWhisk actions: `secret-rotation-initiate`, `secret-rotation-revoke`, `secret-rotation-expiry-sweep`, `secret-rotation-propagation-timeout-sweep`, `secret-consumer-ack`, `secret-rotation-consumer-status`.
- New Kafka topics: `console.secrets.rotation.initiated` (30d), `console.secrets.rotation.grace-started` (30d), `console.secrets.rotation.propagated` (30d), `console.secrets.rotation.grace-expired` (30d), `console.secrets.rotation.revoked` (90d), `console.secrets.consumer.reload-requested` (7d), `console.secrets.consumer.reload-confirmed` (30d), `console.secrets.consumer.reload-timeout` (30d).
- New env vars: `SECRET_ROTATION_MIN_GRACE_SECONDS`, `SECRET_ROTATION_MAX_GRACE_SECONDS`, `SECRET_ROTATION_DEFAULT_GRACE_SECONDS`, `RELOAD_ACK_TIMEOUT_SECONDS`, `SECRET_ROTATION_SWEEP_BATCH_SIZE`.
- New console pages: `ConsoleSecretsPage.tsx`, `ConsoleSecretRotationPage.tsx`.
- Max two valid versions per secret path enforced via `UNIQUE INDEX uq_secret_active_version`.
- Rotation is atomic: PostgreSQL TX committed before Vault write; rollback on Vault failure.
- Vault KV v2 used for native versioning; soft-delete on grace expiry and revocation.
```

---

## Done Criteria (Checklist)

- [ ] **CD-01** `092-secret-rotation.sql` applies cleanly; all four tables and all indexes present.
- [ ] **CD-02** `secret-rotation-initiate.mjs` integration test passes: 1 active + 1 grace row in `secret_version_states` after rotate.
- [ ] **CD-03** Chained rotation (third rotate) invalidates oldest grace version; `SELECT COUNT(*) FROM secret_version_states WHERE state IN ('active','grace') AND secret_path=X` = 2.
- [ ] **CD-04** Expiry sweep integration test: version with past `grace_expires_at` → state='expired' after sweep.
- [ ] **CD-05** `revokeSecretVersion` without `forceRevoke` when no backup → 409; with `forceRevoke=true` → 200.
- [ ] **CD-06** No unit or integration test inserts a `secret_rotation_events` row containing secret material in `detail` JSONB.
- [ ] **CD-07** Multi-tenant isolation integration test passes.
- [ ] **CD-08** `ConsoleSecretsPage.test.tsx` and `ConsoleSecretRotationPage.test.tsx` pass.
- [ ] **CD-09** `charts/in-falcone/values.yaml` contains `secretRotation` block; both CronJob templates rendered.
- [ ] **CD-10** `AGENTS.md` updated with "Secure Secret Rotation" section.
- [ ] **CD-11** `platform.openapi.json` contains five new paths; `control-plane.openapi.json` untouched.
- [ ] **CD-12** All unit tests pass (`node --test services/provisioning-orchestrator/tests/secret-rotation-*.test.mjs`).
