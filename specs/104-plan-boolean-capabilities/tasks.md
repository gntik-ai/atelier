# Tasks: Plan Boolean Capabilities

**Branch**: `104-plan-boolean-capabilities` | **Generated**: 2026-03-31
**Task ID**: US-PLAN-02-T02 | **Epic**: EP-19 | **Story**: US-PLAN-02
**Input artifacts**: `plan.md` (this session) + `spec.md`

---

## Implement Constraints (mandatory — enforced during `speckit.implement`)

1. **TARGETED FILE READS ONLY** — implement reads only the files listed in the File Path Map below and the relevant OpenAPI family file; no broad repo reads.
2. **NO FULL OPENAPI** — never read `apps/control-plane/openapi/control-plane.openapi.json`; read only `apps/control-plane/openapi/families/platform.openapi.json` when API contract details are needed.
3. **MINIMAL SPEC CONTEXT** — implement receives only `plan.md` and `tasks.md`; do NOT read `spec.md`, `research.md`, `data-model.md`, or `quickstart.md`.
4. **FOCUSED HELPER READS** — for any helper module, read only the first 100 lines plus the exact function-signature slice needed; never read a full helper file beyond that unless a specific function body is required.
5. **FOCUSED TEST READS** — for any existing test, read only the import block plus the first relevant test case for pattern reference.
6. **NO EXPLORATORY BROWSING** — no broad `find`/`ls` invocations; the File Path Map below is the complete navigation map.

---

## File Path Map

### Read-only reference files (pattern/context — targeted slices only)

```text

services/provisioning-orchestrator/src/models/quota-dimension.mjs           ← key/validation pattern
services/provisioning-orchestrator/src/models/plan.mjs                       ← Plan class, validateBooleanMap
services/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs  ← catalog query pattern
services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs              ← TX + audit + optimistic lock pattern
services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs   ← toCapabilityList + resolveEffectiveEntitlements (full — small file)
services/provisioning-orchestrator/src/actions/plan-limits-set.mjs           ← action structure + requireSuperadmin pattern
services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs   ← profile query action pattern
services/provisioning-orchestrator/src/actions/plan-update.mjs               ← plan update + audit + Kafka pattern
services/provisioning-orchestrator/src/actions/plan-effective-entitlements-get.mjs  ← tenant auth pattern + capability response shape
services/provisioning-orchestrator/src/events/plan-limit-events.mjs          ← Kafka emit pattern
services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql   ← catalog DDL + seed + trigger pattern
tests/integration/103-hard-soft-quota-overrides/fixtures/seed-plans-with-quota-types.mjs  ← fakeDb pattern (imports + first case only)
tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs             ← test structure (imports + first case only)

```text

### New files to create

```text

services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql
services/provisioning-orchestrator/src/models/boolean-capability.mjs
services/provisioning-orchestrator/src/repositories/boolean-capability-catalog-repository.mjs
services/provisioning-orchestrator/src/repositories/plan-capability-repository.mjs
services/provisioning-orchestrator/src/events/plan-capability-events.mjs
services/provisioning-orchestrator/src/actions/capability-catalog-list.mjs
services/provisioning-orchestrator/src/actions/plan-capability-set.mjs
services/provisioning-orchestrator/src/actions/plan-capability-profile-get.mjs
services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs
services/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs
tests/integration/104-plan-boolean-capabilities/fixtures/seed-capability-catalog.mjs
tests/integration/104-plan-boolean-capabilities/fixtures/seed-plans-with-capabilities.mjs
tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs
tests/integration/104-plan-boolean-capabilities/plan-capability-crud.test.mjs
tests/integration/104-plan-boolean-capabilities/plan-capability-profile.test.mjs
tests/integration/104-plan-boolean-capabilities/tenant-effective-capabilities.test.mjs
tests/integration/104-plan-boolean-capabilities/capability-audit.test.mjs
tests/integration/104-plan-boolean-capabilities/capability-isolation.test.mjs
specs/104-plan-boolean-capabilities/contracts/capability-catalog-list.json
specs/104-plan-boolean-capabilities/contracts/plan-capability-set.json
specs/104-plan-boolean-capabilities/contracts/plan-capability-profile-get.json
specs/104-plan-boolean-capabilities/contracts/tenant-effective-capabilities-get.json
specs/104-plan-boolean-capabilities/contracts/plan-capability-audit-query.json

```text

### Files to modify

```text

services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs  ← enhance toCapabilityList with catalog join
services/provisioning-orchestrator/src/actions/plan-create.mjs                             ← add catalog key validation for capabilities
services/provisioning-orchestrator/src/actions/plan-update.mjs                             ← add catalog key validation + per-capability audit events

```text

---

## Tasks

### T01 — Migration: `boolean_capability_catalog` table + seed

**File**: `services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql`

**Pattern reference**: `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql` (first 40 lines — catalog DDL + seed + trigger pattern)

**DDL**:

```sql

CREATE TABLE IF NOT EXISTS boolean_capability_catalog (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key VARCHAR(64)  NOT NULL UNIQUE,
  display_label  VARCHAR(255) NOT NULL,
  description    TEXT         NOT NULL,
  platform_default BOOLEAN    NOT NULL DEFAULT false,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  sort_order     INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boolean_capability_catalog_active_sort
  ON boolean_capability_catalog (is_active, sort_order);

DROP TRIGGER IF EXISTS trg_boolean_capability_catalog_updated_at ON boolean_capability_catalog;
CREATE TRIGGER trg_boolean_capability_catalog_updated_at
BEFORE UPDATE ON boolean_capability_catalog
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

```text

**Seed** (7 rows, `ON CONFLICT (capability_key) DO NOTHING`):

| capability_key      | display_label               | platform_default | sort_order |
|---------------------|-----------------------------|-----------------|------------|
| `sql_admin_api`     | SQL Admin API               | false           | 10         |
| `passthrough_admin` | Passthrough Admin Proxy     | false           | 20         |
| `realtime`          | Realtime Subscriptions      | false           | 30         |
| `webhooks`          | Outbound Webhooks           | false           | 40         |
| `public_functions`  | Public Serverless Functions | false           | 50         |
| `custom_domains`    | Custom Domains              | false           | 60         |
| `scheduled_functions` | Scheduled Functions       | false           | 70         |

**No DDL change to `plans`** — `capabilities JSONB NOT NULL DEFAULT '{}'::jsonb` already exists from migration 097.

**Acceptance**: `psql` schema dump shows `boolean_capability_catalog` with 7 seeded rows, `is_active = true`, correct `sort_order`. Migration idempotent via `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`. Runs cleanly after `097-plan-entity-tenant-assignment.sql`.

---

### T02 — Model: `boolean-capability.mjs`

**File**: `services/provisioning-orchestrator/src/models/boolean-capability.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/models/quota-dimension.mjs` (first 25 lines — key pattern + class structure)

**Exports**:

```js

// Regex: snake_case, starts with letter, 1–64 chars
const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidCapabilityKey(key) { ... }

export class BooleanCapability {
  constructor({ capabilityKey, displayLabel, description, platformDefault = false, isActive = true, sortOrder = 0 } = {})
  validate()  // throws { code: 'INVALID_CAPABILITY_KEY' | 'VALIDATION_ERROR' }
}

// Merges plan's explicit capabilities JSONB with catalog defaults.
// Returns: { capabilityKey, displayLabel, description, enabled, source, platformDefault }[]
// source: 'explicit' | 'platform_default'
// Orphaned keys (in plan JSONB but not in activeCatalog) returned with status: 'orphaned'
export function buildCapabilityProfile(planCapabilitiesJsonb, activeCatalogEntries) { ... }

// Tenant-facing: display labels + enabled only, no keys/descriptions/source
// Returns: { displayLabel, enabled }[]
export function buildTenantCapabilityView(planCapabilitiesJsonb, activeCatalogEntries) { ... }

// Detects which keys in toSet differ from current plan state.
// Returns { changed: [{capabilityKey, previousState, newState}], unchanged: [capabilityKey] }
export function diffCapabilities(currentJsonb, toSet) { ... }

```text

**Key rules**:
- `isValidCapabilityKey`: string, matches `CAPABILITY_KEY_PATTERN`
- `buildCapabilityProfile`: iterate active catalog → explicit plan value OR `platformDefault`; keys in plan JSONB absent from active catalog → append as `{ capabilityKey, enabled, status: 'orphaned' }`
- `diffCapabilities`: no-op when `toSet[key] === currentJsonb[key]`; missing key treated as inheriting default (not as explicit `false`) for diff purposes — i.e., if plan has no key and we set `false` to a key whose `platformDefault` is `false`, it IS a write (explicit false vs. absent) but NOT a no-op. No-op: `toSet[key] === currentJsonb[key]` (both must exist and be equal).

**Acceptance**: Model validates keys, rejects non-snake_case keys, rejects non-boolean values, profile merge returns correct `source` field.

---

### T03 — Repository: `boolean-capability-catalog-repository.mjs`

**File**: `services/provisioning-orchestrator/src/repositories/boolean-capability-catalog-repository.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs` (full file — small, exact structural analog)

**Exports**:

```js

// Returns BooleanCapability[] ordered by sort_order ASC
export async function listActiveCatalog(pgClient) { ... }

// Returns BooleanCapability[] — includes inactive when includeInactive=true
export async function listAllCatalog(pgClient, { includeInactive = false } = {}) { ... }

// Returns BooleanCapability | null
export async function getByKey(pgClient, capabilityKey) { ... }

// Returns boolean — only counts is_active=true entries
export async function capabilityKeyExists(pgClient, capabilityKey) { ... }

// Validates all keys in a Set/Array against active catalog.
// Returns { valid: true } or throws { code: 'INVALID_CAPABILITY_KEY', invalidKeys: [...] }
export async function validateCapabilityKeys(pgClient, capabilityKeys) { ... }

```text

**SQL for `listActiveCatalog`**:

```sql

SELECT capability_key, display_label, description, platform_default, is_active, sort_order
  FROM boolean_capability_catalog
 WHERE is_active = true
 ORDER BY sort_order ASC, capability_key ASC

```text

**Acceptance**: `listActiveCatalog` returns 7 entries; `capabilityKeyExists('nonexistent')` → false; `validateCapabilityKeys(['realtime', 'bad_key'])` → throws with `invalidKeys: ['bad_key']`.

---

### T04 — Repository: `plan-capability-repository.mjs`

**File**: `services/provisioning-orchestrator/src/repositories/plan-capability-repository.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs` (full file — TX + optimistic lock + audit insert pattern)

**Exports**:

```js

// Read-only: returns { id, status, slug, displayName, capabilities } or null
export async function getPlanCapabilities(pgClient, planId) { ... }

// Transactional: merges toSet into plan.capabilities, writes audit events, returns result.
// Lifecycle guard: archived → throws { code: 'PLAN_ARCHIVED' }
// Optimistic concurrency via FOR UPDATE (lock_timeout from env CAPABILITY_LOCK_TIMEOUT_MS, default 5000)
// No-op detection: skips DB write + audit for keys where value is unchanged
// Returns { planId, planSlug, changed, unchanged, effectiveCapabilities, planStatus }
export async function setCapabilities(pgClient, { planId, capabilitiesToSet, actorId, correlationId }) { ... }

```text

**`setCapabilities` algorithm**:
1. `BEGIN`; `SET LOCAL lock_timeout`
2. `SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1 FOR UPDATE`
3. If not found → throw `PLAN_NOT_FOUND`; if `status === 'archived'` → throw `PLAN_ARCHIVED`
4. Call `diffCapabilities(plan.capabilities, capabilitiesToSet)` → `{ changed, unchanged }`
5. If `changed.length === 0` → `COMMIT`; return early with `changed: [], unchanged`
6. Merge: `nextCapabilities = { ...plan.capabilities, ...Object.fromEntries(changed.map(c => [c.capabilityKey, c.newState])) }`
7. `UPDATE plans SET capabilities = $2::jsonb, updated_at = NOW(), updated_by = $3 WHERE id = $1 RETURNING id, status, slug, display_name, capabilities`
8. For each item in `changed`: `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`
   - `action_type`: `'plan.capability.enabled'` or `'plan.capability.disabled'` based on `newState`
   - `previous_state`: `{ capabilityKey, previousState: item.previousState }`
   - `new_state`: `{ capabilityKey, newState: item.newState }`
9. `COMMIT`; return result
10. On `error.code === '55P03'` → throw `{ code: 'CONCURRENT_CAPABILITY_CONFLICT' }`; always `ROLLBACK` on error

**`getPlanCapabilities` SQL**:

```sql

SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1

```text

**Acceptance**: `setCapabilities` with all-no-op input returns `changed: []` with zero DB writes; archived plan throws `PLAN_ARCHIVED`; concurrent lock timeout throws `CONCURRENT_CAPABILITY_CONFLICT`.

---

### T05 — Events: `plan-capability-events.mjs`

**File**: `services/provisioning-orchestrator/src/events/plan-capability-events.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/events/plan-limit-events.mjs` (full file — small, exact Kafka emit pattern)

**Exports**:

```js

const TOPIC_ENABLED  = process.env.CAPABILITY_KAFKA_TOPIC_ENABLED  ?? 'console.plan.capability.enabled';
const TOPIC_DISABLED = process.env.CAPABILITY_KAFKA_TOPIC_DISABLED ?? 'console.plan.capability.disabled';

// Emits one Kafka message per changed capability (fire-and-forget; logs warn on failure).
// changedItems: [{ capabilityKey, displayLabel, previousState, newState }]
export async function emitCapabilityEvents(kafkaProducer, { planId, planSlug, changedItems, actorId, correlationId, timestamp }, options = {}) { ... }

```text

**Event envelope** (per changed capability):

```json

{
  "eventType": "console.plan.capability.enabled",
  "correlationId": "<uuid>",
  "actorId": "<actor>",
  "planId": "<uuid>",
  "planSlug": "professional",
  "timestamp": "<ISO8601>",
  "payload": {
    "capabilityKey": "realtime",
    "displayLabel": "Realtime Subscriptions",
    "previousState": null,
    "newState": true
  }
}

```text

- Topic: `TOPIC_ENABLED` when `newState === true`; `TOPIC_DISABLED` when `newState === false`
- Message key: `planId`
- No-producer guard: if `!kafkaProducer?.send`, skip emit silently (return events array)
- Failure: catch, log warn, do NOT re-throw (fire-and-forget)

**Acceptance**: emits one message per changed capability to correct topic; graceful no-op when producer is null/undefined.

---

### T06 — Action: `capability-catalog-list.mjs`

**File**: `services/provisioning-orchestrator/src/actions/capability-catalog-list.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` (full file — superadmin guard + catalog query pattern)

**Logic**:
1. `requireSuperadmin(params)` → `{ code: 'FORBIDDEN' }` if not superadmin
2. `const includeInactive = Boolean(params.includeInactive)`
3. Call `catalogRepository.listAllCatalog(db, { includeInactive })` or `listActiveCatalog(db)`
4. Return `{ statusCode: 200, body: { capabilities: [...mapped], total: capabilities.length } }`

**Response shape per entry**:

```json

{
  "capabilityKey": "sql_admin_api",
  "displayLabel": "SQL Admin API",
  "description": "Enables direct SQL admin access to the tenant's PostgreSQL databases",
  "platformDefault": false,
  "isActive": true,
  "sortOrder": 10
}

```text

**Error codes**: `FORBIDDEN → 403`

**Acceptance**: Returns 7 active capabilities when `includeInactive=false`; rejects non-superadmin with 403.

---

### T07 — Action: `plan-capability-set.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-capability-set.mjs`

**Pattern reference**:
- `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs` (full file — action structure, requireSuperadmin, error map)
- `services/provisioning-orchestrator/src/repositories/plan-capability-repository.mjs` (T04, created in this branch)

**Input params**: `{ planId, capabilities: { [capabilityKey]: boolean } }`

**Logic**:
1. `requireSuperadmin(params)` → 403
2. Validate `params.capabilities` is a non-null object with ≥1 key → `400 NO_CAPABILITIES_SPECIFIED`
3. Validate all values are booleans → `400 INVALID_CAPABILITY_VALUE`
4. `await catalogRepository.validateCapabilityKeys(db, Object.keys(params.capabilities))` → `400 INVALID_CAPABILITY_KEY`
5. `const correlationId = params.correlationId ?? randomUUID()`
6. `const result = await planCapabilityRepository.setCapabilities(db, { planId: params.planId, capabilitiesToSet: params.capabilities, actorId: actor.id, correlationId })`
7. If `result.changed.length > 0`:
   - Resolve display labels from `catalogRepository.listActiveCatalog(db)` for changed keys
   - `await emitCapabilityEvents(producer, { planId, planSlug, changedItems: result.changed (enriched with displayLabel), actorId, correlationId, timestamp: new Date().toISOString() })`
8. Return:

```json

{
  "statusCode": 200,
  "body": {
    "planId": "<uuid>",
    "planSlug": "professional",
    "changed": [{ "capabilityKey": "realtime", "previousState": null, "newState": true }],
    "unchanged": ["sql_admin_api"],
    "effectiveCapabilities": { "sql_admin_api": true, "realtime": true, ... }
  }
}

```text

**Error map**:

```js

const ERROR_STATUS_CODES = {
  FORBIDDEN: 403,
  INVALID_CAPABILITY_KEY: 400,
  INVALID_CAPABILITY_VALUE: 400,
  NO_CAPABILITIES_SPECIFIED: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_ARCHIVED: 409,
  CONCURRENT_CAPABILITY_CONFLICT: 409
};

```text

**Acceptance**: Enable 2 capabilities → `changed.length === 2`; no-op → `changed: [], unchanged: [key]`; archived plan → 409; unknown key → 400.

---

### T08 — Action: `plan-capability-profile-get.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-capability-profile-get.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` (full file — profile query pattern)

**Logic**:
1. `requireSuperadmin(params)` → 403
2. `const plan = await planCapabilityRepository.getPlanCapabilities(db, params.planId)` → 404 if null
3. `const activeCatalog = await catalogRepository.listActiveCatalog(db)`
4. `const profile = buildCapabilityProfile(plan.capabilities, activeCatalog)` → array of `{ capabilityKey, displayLabel, description, enabled, source, platformDefault }`
5. Extract orphans from profile (entries with `status: 'orphaned'`) into `orphanedCapabilities`
6. Return:

```json

{
  "statusCode": 200,
  "body": {
    "planId": "<uuid>",
    "planSlug": "professional",
    "planDisplayName": "Professional",
    "planStatus": "active",
    "capabilityProfile": [
      {
        "capabilityKey": "realtime",
        "displayLabel": "Realtime Subscriptions",
        "description": "...",
        "enabled": true,
        "source": "explicit",
        "platformDefault": false
      }
    ],
    "orphanedCapabilities": []
  }
}

```text

**`source`**: `"explicit"` when key is present in `plan.capabilities` JSONB; `"platform_default"` otherwise.

**Error map**: `{ FORBIDDEN: 403, PLAN_NOT_FOUND: 404 }`

**Acceptance**: Profile contains all 7 active catalog entries; orphaned key shown in `orphanedCapabilities` with `status: 'orphaned'`; two plans have structurally identical profile schemas.

---

### T09 — Action: `tenant-effective-capabilities-get.mjs`

**File**: `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/actions/plan-effective-entitlements-get.mjs` (imports + `resolveTenantId` function — first 25 lines)

**Logic**:
1. `resolveTenantId(params)` — superadmin may pass any `tenantId`; tenant owner may only query own tenant
2. `const assignment = await assignmentRepository.getCurrent(db, tenantId)`
3. If no assignment → return `{ statusCode: 200, body: { tenantId, noAssignment: true, capabilities: [] } }`
4. `const plan = await planCapabilityRepository.getPlanCapabilities(db, assignment.planId)`
5. `const activeCatalog = await catalogRepository.listActiveCatalog(db)`
6. `const capabilities = buildTenantCapabilityView(plan.capabilities, activeCatalog)`
   - Returns `{ displayLabel, enabled }[]` only — no keys, no descriptions, no source
7. Return:

```json

{
  "statusCode": 200,
  "body": {
    "tenantId": "acme-corp",
    "planSlug": "professional",
    "capabilities": [
      { "displayLabel": "SQL Admin API", "enabled": true },
      { "displayLabel": "Realtime Subscriptions", "enabled": true }
    ]
  }
}

```text

**Error map**: `{ FORBIDDEN: 403, TENANT_NOT_FOUND: 404 }`

**Cross-tenant isolation**: `resolveTenantId` already enforces this; tenant owner cannot pass a different `tenantId`.

**Acceptance**: Tenant response has no `capabilityKey` fields; no-assignment case returns `noAssignment: true`; superadmin can query any tenant; tenant owner blocked from querying other tenants (403).

---

### T10 — Action: `plan-capability-audit-query.mjs`

**File**: `services/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs`

**Pattern reference**: `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` (imports + guard — first 5 lines)

**Input params**: `{ planId?, capabilityKey?, actorId?, fromDate?, toDate?, page? = 1, pageSize? = 50 }`

**SQL** (against `plan_audit_events`):

```sql

SELECT event_id, plan_id, action_type, previous_state, new_state, actor_id, created_at
  FROM plan_audit_events
 WHERE action_type IN ('plan.capability.enabled', 'plan.capability.disabled')
   AND ($1::uuid IS NULL OR plan_id = $1)
   AND ($2::text IS NULL OR previous_state->>'capabilityKey' = $2 OR new_state->>'capabilityKey' = $2)
   AND ($3::text IS NULL OR actor_id = $3)
   AND ($4::timestamptz IS NULL OR created_at >= $4)
   AND ($5::timestamptz IS NULL OR created_at <= $5)
 ORDER BY created_at ASC
 LIMIT $6 OFFSET $7

```text

Count query mirrors the WHERE clause with `SELECT COUNT(*)`.

**Response shape**:

```json

{
  "statusCode": 200,
  "body": {
    "events": [
      {
        "eventId": "<uuid>",
        "planId": "<uuid>",
        "planSlug": "starter",
        "actionType": "plan.capability.enabled",
        "capabilityKey": "webhooks",
        "previousState": null,
        "newState": true,
        "actorId": "admin@platform.io",
        "timestamp": "<ISO8601>"
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 50
  }
}

```text

Extract `capabilityKey` from `previous_state->>'capabilityKey'` or `new_state->>'capabilityKey'`.

**Error map**: `{ FORBIDDEN: 403 }`

**Acceptance**: Returns only `plan.capability.*` action types; filters by `planId` and `capabilityKey` independently; chronological ordering.

---

### T11 — Modify: `effective-entitlements-repository.mjs`

**File**: `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs`

**Read**: full file (it's small — ~50 lines)

**Change**: Replace `toCapabilityList` internal function with a version that uses the `boolean_capability_catalog` to resolve display labels and include capabilities not explicitly set on the plan (with platform defaults).

**New `toCapabilityList` behavior**:

```js

// catalogRows: rows from boolean_capability_catalog (active only)
// planCapabilities: plan.capabilities JSONB object
function toCapabilityList(planCapabilities = {}, catalogRows = []) {
  return catalogRows.map(row => ({
    capabilityKey: row.capability_key,
    displayLabel: row.display_label,
    enabled: Object.prototype.hasOwnProperty.call(planCapabilities, row.capability_key)
      ? Boolean(planCapabilities[row.capability_key])
      : Boolean(row.platform_default)
  })).sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey));
}

```text

Add catalog query to the existing `Promise.all` in `resolveEffectiveEntitlements`:

```js

const [catalogResult, boolCatalogResult, planResult] = await Promise.all([
  client.query('SELECT dimension_key, display_label, unit, default_value FROM quota_dimension_catalog ORDER BY dimension_key ASC'),
  client.query('SELECT capability_key, display_label, platform_default FROM boolean_capability_catalog WHERE is_active = true ORDER BY sort_order ASC, capability_key ASC'),
  client.query('SELECT id, slug, display_name, quota_dimensions, capabilities FROM plans WHERE id = $1', [planId])
]);

```text

Update `toCapabilityList` call: `toCapabilityList(plan.capabilities ?? {}, boolCatalogResult.rows)`.

**Backward compatibility**: The `capabilities` array in the returned entitlements now has richer `displayLabel` (from catalog) and includes all 7 catalog capabilities (not just explicitly-set ones). This is a non-breaking enrichment.

**Fallback**: If `boolean_capability_catalog` does not exist yet (migration not run) — catch `error.code === '42P01'` and fall back to old behavior (iterate plan capabilities only). This ensures the existing `plan-effective-entitlements-get` action does not break in environments where migration 104 hasn't run.

**Acceptance**: `resolveEffectiveEntitlements` returns all 7 catalog capabilities when catalog is seeded; falls back gracefully when table absent.

---

### T12 — Modify: `plan-create.mjs` — add catalog key validation

**File**: `services/provisioning-orchestrator/src/actions/plan-create.mjs`

**Read**: full file (small)

**Change**: After `Plan` constructor validation (which validates boolean map), add:

```js

if (Object.keys(plan.capabilities).length > 0) {
  await catalogRepository.validateCapabilityKeys(db, Object.keys(plan.capabilities));
}

```text

Import `boolean-capability-catalog-repository.mjs` as `catalogRepository`.

This validates that any capability keys provided at plan creation time exist in the active catalog. Existing plans with no capabilities are unaffected (empty object skips validation).

**Error**: propagates `{ code: 'INVALID_CAPABILITY_KEY' }` → 400 via existing error handler.

**Acceptance**: Creating a plan with `capabilities: { nonexistent: true }` → 400; creating with known keys → 201.

---

### T13 — Modify: `plan-update.mjs` — add catalog validation + per-capability audit events

**File**: `services/provisioning-orchestrator/src/actions/plan-update.mjs`

**Read**: full file (small)

**Changes**:
1. Import `boolean-capability-catalog-repository.mjs` and `plan-capability-events.mjs`
2. If `updates.capabilities` is provided and has ≥1 key → validate keys against catalog (same as T12)
3. After `planRepository.update` succeeds, if capabilities changed:
   - Compute diff between `result.previous.capabilities` and `result.current.capabilities`
   - For each changed capability, emit individual `plan.capability.enabled` / `plan.capability.disabled` audit events (INSERT into `plan_audit_events`)
   - Emit Kafka events via `emitCapabilityEvents`
4. Existing generic `plan.updated` audit event and Kafka event are kept as-is (additional per-capability events are additive)

**Acceptance**: Updating capabilities via `plan-update` emits per-capability audit rows in `plan_audit_events` alongside the existing `plan.updated` event.

---

### T14 — Fixtures: `seed-capability-catalog.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/fixtures/seed-capability-catalog.mjs`

**Pattern reference**: `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-plans-with-quota-types.mjs` (imports + `createFakeDb` function only)

**Exports**:

```js

export const CATALOG_SEED = [
  { capability_key: 'sql_admin_api', display_label: 'SQL Admin API', description: '...', platform_default: false, is_active: true, sort_order: 10 },
  { capability_key: 'passthrough_admin', display_label: 'Passthrough Admin Proxy', description: '...', platform_default: false, is_active: true, sort_order: 20 },
  { capability_key: 'realtime', display_label: 'Realtime Subscriptions', description: '...', platform_default: false, is_active: true, sort_order: 30 },
  { capability_key: 'webhooks', display_label: 'Outbound Webhooks', description: '...', platform_default: false, is_active: true, sort_order: 40 },
  { capability_key: 'public_functions', display_label: 'Public Serverless Functions', description: '...', platform_default: false, is_active: true, sort_order: 50 },
  { capability_key: 'custom_domains', display_label: 'Custom Domains', description: '...', platform_default: false, is_active: true, sort_order: 60 },
  { capability_key: 'scheduled_functions', display_label: 'Scheduled Functions', description: '...', platform_default: false, is_active: true, sort_order: 70 },
];

export function createFakeProducer() { ... }  // same pattern as 103 fixtures

export function createFakeDb() {
  // In-memory store with:
  // _boolCatalog: [...CATALOG_SEED]
  // plans: new Map()
  // assignments: new Map()
  // _planAuditEvents: []
  // query(sql, params): handles all SQL patterns needed by T06–T10
}

```text

**SQL patterns the fakeDb must handle** (add to `query` switch):
- `FROM boolean_capability_catalog WHERE is_active = true ORDER BY sort_order` → return active catalog rows
- `FROM boolean_capability_catalog WHERE is_active` (with `includeInactive` variant) → filter accordingly
- `FROM boolean_capability_catalog WHERE capability_key = $1` → single row lookup
- `SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1` → from `plans` Map
- `SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1 FOR UPDATE` → same (no real locking needed in fake)
- `UPDATE plans SET capabilities` → merge capabilities JSONB, return updated row
- `INSERT INTO plan_audit_events` → push to `_planAuditEvents`
- `FROM plan_audit_events WHERE action_type IN` → filter `_planAuditEvents` by action_type
- `FROM tenant_plan_assignments ... JOIN plans` → join from `assignments` Map

---

### T15 — Fixtures: `seed-plans-with-capabilities.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/fixtures/seed-plans-with-capabilities.mjs`

**Exports**:

```js

// Seeds the fakeDb with a standard set of test plans
export function seedPlans(db) {
  // plan-draft: status='draft', capabilities={}
  // plan-active-basic: status='active', capabilities={ webhooks: true }
  // plan-active-full: status='active', capabilities={ sql_admin_api: true, realtime: true, webhooks: true, public_functions: true }
  // plan-deprecated: status='deprecated', capabilities={ realtime: true }
  // plan-archived: status='archived', capabilities={}
  // plan-with-orphan: status='active', capabilities={ realtime: true, legacy_feature: true }
  //   (legacy_feature is NOT in CATALOG_SEED — simulates orphaned key)
}

// Seeds assignments
export function seedAssignments(db) {
  // tenant-basic → plan-active-basic
  // tenant-full → plan-active-full
  // tenant-none → no assignment
}

```text

---

### T16 — Integration Test: `capability-catalog.test.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as catalogList } from '../../../services/provisioning-orchestrator/src/actions/capability-catalog-list.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { CATALOG_SEED } from './fixtures/seed-capability-catalog.mjs';

```text

**Test cases**:
1. `catalog query returns all 7 active capabilities` — assert `body.total === 7`; verify each has `capabilityKey`, `displayLabel`, `description`, `platformDefault`, `isActive`, `sortOrder`
2. `catalog includes all 7 expected keys` — assert all of `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions` present
3. `includeInactive=false excludes soft-deleted entries` — add inactive entry to fakeDb catalog; assert not returned
4. `includeInactive=true includes soft-deleted entries` — assert inactive entry IS returned
5. `non-superadmin receives 403` — caller with `type: 'tenant'` throws with `statusCode: 403`

---

### T17 — Integration Test: `plan-capability-crud.test.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/plan-capability-crud.test.mjs`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setCapability } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-set.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans } from './fixtures/seed-plans-with-capabilities.mjs';

```text

**Test cases** (covering FR-003, FR-005, FR-010, FR-011, SC-001, SC-005, SC-008):
1. `enable realtime and webhooks on draft plan — both persisted and in changed` — assert `changed.length === 2`, `effectiveCapabilities.realtime === true`
2. `disable webhooks on plan that has it enabled — persisted as disabled, audit event recorded` — seed plan with `webhooks: true`; set `webhooks: false`; assert `changed[0].previousState === true && changed[0].newState === false`; assert `db._planAuditEvents` has entry with `action_type: 'plan.capability.disabled'`
3. `enable nonexistent_feature — rejected 400 INVALID_CAPABILITY_KEY` — assert throws with `statusCode: 400`, `code: 'INVALID_CAPABILITY_KEY'`
4. `no-op: enable already-enabled capability — changed empty, no audit event` — seed plan with `realtime: true`; set `realtime: true`; assert `body.changed.length === 0`; assert `db._planAuditEvents.length === 0`
5. `archived plan — rejected 409 PLAN_ARCHIVED` — use `plan-archived`; assert `statusCode: 409`
6. `deprecated plan — accepted with audit event` — use `plan-deprecated`; assert `statusCode: 200`; assert audit event written
7. `multiple capabilities in single request — individual audit events per capability` — set 3 new capabilities; assert `db._planAuditEvents.length === 3`
8. `no capabilities specified — rejected 400 NO_CAPABILITIES_SPECIFIED`
9. `non-boolean value — rejected 400 INVALID_CAPABILITY_VALUE`
10. `two plans have structurally identical effectiveCapabilities response shape` — assert same keys in both responses

---

### T18 — Integration Test: `plan-capability-profile.test.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/plan-capability-profile.test.mjs`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as profileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-profile-get.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans } from './fixtures/seed-plans-with-capabilities.mjs';

```text

**Test cases** (covering FR-004, FR-006, FR-017, SC-006):
1. `profile contains all 7 active catalog entries` — use `plan-active-full`; assert `capabilityProfile.length === 7`
2. `explicitly set capability has source="explicit"` — assert `realtime` entry has `source: 'explicit'`, `enabled: true`
3. `unset capability has source="platform_default"` — assert `custom_domains` (not in plan) has `source: 'platform_default'`, `enabled: false`
4. `plan with orphaned key — orphan flagged in orphanedCapabilities` — use `plan-with-orphan`; assert `orphanedCapabilities` contains entry with `capabilityKey: 'legacy_feature'`, `status: 'orphaned'`; assert `legacy_feature` NOT in `capabilityProfile`
5. `two plans produce structurally identical capabilityProfile schemas` — assert `Object.keys(plan1Profile).join() === Object.keys(plan2Profile).join()`
6. `plan not found — 404` — use unknown planId; assert `statusCode: 404`

---

### T19 — Integration Test: `tenant-effective-capabilities.test.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/tenant-effective-capabilities.test.mjs`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantCaps } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans, seedAssignments } from './fixtures/seed-plans-with-capabilities.mjs';

```text

**Test cases** (covering FR-007, FR-008, SC-002, SC-007):
1. `tenant on full plan sees correct capabilities` — use `tenant-full`; assert all 7 capabilities present; assert `sql_admin_api` enabled; assert `custom_domains` disabled
2. `tenant response contains only displayLabel and enabled — no capabilityKey or description` — assert no `capabilityKey` field in any capability entry
3. `tenant with no assignment returns noAssignment:true, empty array` — use `tenant-none`; assert `body.noAssignment === true`, `body.capabilities.length === 0`
4. `tenant owner cannot query other tenant — 403` — caller with `tenantId: 'tenant-full'` querying `tenant-basic` throws 403
5. `superadmin can query any tenant` — superadmin actor querying `tenant-full` succeeds

---

### T20 — Integration Test: `capability-audit.test.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/capability-audit.test.mjs`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setCapability } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-set.mjs';
import { main as auditQuery } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans } from './fixtures/seed-plans-with-capabilities.mjs';

```text

**Test cases** (covering FR-009, FR-010, FR-013, SC-003):
1. `enable webhooks — audit event has correct actor, timestamp, plan, key, previousState null, newState true` — enable `webhooks` on plan with no prior capability; assert `db._planAuditEvents[0]` shape
2. `disable realtime — audit event has previousState true, newState false` — seed plan with `realtime: true`; disable it; assert audit event
3. `audit query returns events chronologically` — create 3 events; query; assert `events[0].timestamp <= events[1].timestamp`
4. `audit query filters by capabilityKey` — create events for `realtime` and `webhooks`; query with `capabilityKey: 'webhooks'`; assert only webhooks events returned
5. `Kafka event emitted for capability enable` — check `producer.messages` after enable; assert message on `console.plan.capability.enabled` topic with correct payload
6. `Kafka event emitted for capability disable` — check `producer.messages` after disable; assert message on `console.plan.capability.disabled` topic
7. `no-op: no audit event and no Kafka message` — enable already-enabled capability; assert `db._planAuditEvents.length === 0`; assert `producer.messages.length === 0`

---

### T21 — Integration Test: `capability-isolation.test.mjs`

**File**: `tests/integration/104-plan-boolean-capabilities/capability-isolation.test.mjs`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantCaps } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs';
import { main as setCapability } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-set.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans, seedAssignments } from './fixtures/seed-plans-with-capabilities.mjs';

```text

**Test cases** (covering FR-014, FR-015, SC-007):
1. `tenant-a capabilities invisible to tenant-b — separate responses` — both tenants on different plans; assert respective capabilities match only their own plan
2. `tenant owner can read own capabilities` — tenant actor queries own tenant; assert 200
3. `tenant owner cannot modify capabilities — 403` — tenant actor calls `plan-capability-set`; assert `statusCode: 403`
4. `tenant owner response excludes internal metadata` — no `description`, no `source`, no `platformDefault` in response

---

### T22 — Contract JSON files

**Files**: `specs/104-plan-boolean-capabilities/contracts/*.json` (5 files)

Generate JSON contract schemas for all 5 actions. Each contract must capture:
- `actionName`
- `description`
- `auth`: required actor type
- `input`: JSON Schema (parameters)
- `output`: JSON Schema (success response body)
- `errors`: array of `{ code, httpStatus, description }`

Files:
- `capability-catalog-list.json`
- `plan-capability-set.json`
- `plan-capability-profile-get.json`
- `tenant-effective-capabilities-get.json`
- `plan-capability-audit-query.json`

---

### T23 — Update `AGENTS.md`

**File**: `/root/projects/_active/AGENTS.md` (or repo `AGENTS.md` if present)

**Pattern**: Append a new `<!-- MANUAL ADDITIONS -->` section following the same format as existing entries.

**Content to add**:

```markdown

## Plan Boolean Capabilities (104-plan-boolean-capabilities)

- New PostgreSQL table: `boolean_capability_catalog` (governed catalog of boolean platform features per plan).
- Existing column `plans.capabilities JSONB` (from 097) is now validated against `boolean_capability_catalog` on all writes.
- New OpenWhisk actions: `capability-catalog-list`, `plan-capability-set`, `plan-capability-profile-get`, `tenant-effective-capabilities-get`, `plan-capability-audit-query`.
- New Kafka topics: `console.plan.capability.enabled` (30d), `console.plan.capability.disabled` (30d).
- New env vars: `CAPABILITY_KAFKA_TOPIC_ENABLED` (default `console.plan.capability.enabled`), `CAPABILITY_KAFKA_TOPIC_DISABLED` (default `console.plan.capability.disabled`).
- Initial catalog seed: 7 capabilities — `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions` — all defaulting to `false`.
- Capability enforcement (blocking access at gateway/UI) deferred to US-PLAN-02-T05.
- `effective-entitlements-repository.mjs` enhanced: `toCapabilityList` now resolves display labels from catalog and includes all catalog capabilities (not just explicitly-set ones); backward-compatible fallback when table absent.
- New `plan_audit_events.action_type` values: `plan.capability.enabled`, `plan.capability.disabled`.

```text

---

## Implementation Sequence

Execute tasks in this order (respects dependencies):

```text

T01  →  T02  →  T03  →  T04  →  T05
                                  ↓
                T06  ←────────────┤
                T07  ←────────────┤
                T08  ←────────────┤
                T09  ←────────────┤
                T10  ←────────────┘
                  ↓
T11 (modify effective-entitlements-repository)
T12 (modify plan-create)
T13 (modify plan-update)
                  ↓
T14 + T15 (fixtures — parallel)
                  ↓
T16–T21 (integration tests — parallel per file)
                  ↓
T22 (contracts)
T23 (AGENTS.md)

```text

Parallel groups:
- **Group A** (independent): T02, T03 after T01
- **Group B** (after T03+T04+T05): T06, T09 (read-only actions)
- **Group C** (after T04+T05): T07, T08 (write+profile actions)
- **Group D** (after T10): T11, T12, T13
- **Group E** (after T14+T15): T16–T21 (all test files)

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAPABILITY_KAFKA_TOPIC_ENABLED` | `console.plan.capability.enabled` | Kafka topic for capability enabled events |
| `CAPABILITY_KAFKA_TOPIC_DISABLED` | `console.plan.capability.disabled` | Kafka topic for capability disabled events |
| `CAPABILITY_LOCK_TIMEOUT_MS` | `5000` | PostgreSQL lock timeout for capability update transactions |

---

## Criteria of Done

| ID | Criterion | Verified by |
|----|-----------|-------------|
| DOD-01 | Migration `104-plan-boolean-capabilities.sql` applied cleanly; `boolean_capability_catalog` has 7 rows | Schema dump |
| DOD-02 | `capability-catalog-list` returns 7 active capabilities with all metadata fields | T16 test 1–2 |
| DOD-03 | `plan-capability-set` enables/disables capabilities; changes reflected in `plans.capabilities` JSONB | T17 test 1–2 |
| DOD-04 | Capabilities not explicitly set on a plan inherit `platform_default` | T18 test 3 |
| DOD-05 | Unknown capability key rejected with `400 INVALID_CAPABILITY_KEY` | T17 test 3 |
| DOD-06 | `plan-capability-profile-get` returns all 7 catalog capabilities with `source` field | T18 test 1–2 |
| DOD-07 | `tenant-effective-capabilities-get` returns display labels + enabled only; no internal metadata | T19 test 2 |
| DOD-08 | Every capability change produces `plan_audit_events` row with correct fields | T20 test 1–2 |
| DOD-09 | No-op changes produce no audit events and no Kafka messages | T17 test 4, T20 test 7 |
| DOD-10 | Archived plans reject capability changes; deprecated plans accept with audit | T17 test 5–6 |
| DOD-11 | Each plan has independent capability configuration | T17 test 10 |
| DOD-12 | Kafka events emitted for every capability change on correct topics | T20 test 5–6 |
| DOD-13 | Only superadmin can modify capabilities; tenant owner is read-only | T21 test 3 |
| DOD-14 | Adding a new catalog entry does not modify existing plans | T16 test 3–4 |
| DOD-15 | Orphaned capability keys flagged in profile queries | T18 test 4 |
| DOD-16 | No cross-tenant data leakage in effective capabilities | T21 test 1 |
| DOD-17 | All 5 contract JSON files present | T22 file existence |
| DOD-18 | `AGENTS.md` updated with new env vars, Kafka topics, and table descriptions | T23 |
| DOD-19 | Unrelated untracked artifacts preserved (070/072) | `git status` check |
