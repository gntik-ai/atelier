# Tasks: Workspace Capability Catalog

**Branch**: `090-workspace-capability-catalog` | **Date**: 2026-03-30
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Task ID**: US-DX-02-T06 | **Epic**: EP-17 | **Story**: US-DX-02

---

## File Path Map

> All paths relative to repository root. Use this map during the `speckit.implement` step.

| Key | Path | Action |
|-----|------|--------|
| `MIGRATION` | `services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql` | CREATE |
| `BUILDER` | `services/workspace-docs-service/src/capability-catalog-builder.mjs` | CREATE |
| `SNIPPET_DATA` | `services/internal-contracts/src/snippet-catalog-data.json` | CREATE |
| `SCHEMA_RESPONSE` | `services/internal-contracts/src/workspace-capability-catalog-response.json` | CREATE |
| `SCHEMA_EVENT` | `services/internal-contracts/src/workspace-capability-catalog-accessed-event.json` | CREATE |
| `CONTRACTS_INDEX` | `services/internal-contracts/src/index.mjs` | UPDATE |
| `ACTION` | `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs` | CREATE |
| `GATEWAY_ROUTE` | `services/gateway-config/routes/workspace-capability-catalog.yaml` | CREATE |
| `CONSOLE_PAGE` | `apps/web-console/src/pages/ConsoleCapabilityCatalogPage.tsx` | CREATE |
| `CONSOLE_PAGE_TEST` | `apps/web-console/src/pages/ConsoleCapabilityCatalogPage.test.tsx` | CREATE |
| `UNIT_BUILDER_TEST` | `tests/unit/capability-catalog-builder.test.mjs` | CREATE |
| `UNIT_ACTION_TEST` | `tests/unit/workspace-capability-catalog-action.test.mjs` | CREATE |
| `CONTRACT_TEST` | `tests/contracts/workspace-capability-catalog.contract.test.mjs` | CREATE |
| `INTEGRATION_TEST` | `tests/integration/workspace-capability-catalog.integration.test.mjs` | CREATE |

---

## Task List

Tasks are ordered by dependency. Steps 2–3 may be parallelised; Step 6 may be parallelised with Steps 4–5.

---

### TASK-01 — Database Migration: `capability_catalog_metadata`

**Depends on**: nothing  
**File**: `MIGRATION`

Create the `capability_catalog_metadata` table and seed the six core capabilities.

**Implementation**:

```sql
-- services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql
BEGIN;

CREATE TABLE IF NOT EXISTS capability_catalog_metadata (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key    TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  category          TEXT NOT NULL,       -- 'data' | 'messaging' | 'compute' | 'storage'
  description       TEXT,
  catalog_version   TEXT NOT NULL DEFAULT '1.0.0',
  dependencies      JSONB NOT NULL DEFAULT '[]',     -- array of capability_key strings
  common_operations JSONB NOT NULL DEFAULT '[]',     -- metadata for example templates
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO capability_catalog_metadata
  (capability_key, display_name, category, description, dependencies)
VALUES
  ('postgres-database',     'PostgreSQL',             'data',      'Relational database',                   '[]'),
  ('mongo-collection',      'MongoDB',                'data',      'Document database',                     '[]'),
  ('kafka-events',          'Event Streaming',        'messaging', 'Kafka-based event bus',                 '[]'),
  ('realtime-subscription', 'Realtime Subscriptions', 'messaging', 'WebSocket realtime channels',           '["kafka-events"]'),
  ('serverless-function',   'Serverless Functions',   'compute',   'OpenWhisk function execution',          '[]'),
  ('storage-bucket',        'Object Storage',         'storage',   'S3-compatible object storage',          '[]')
ON CONFLICT (capability_key) DO NOTHING;

COMMIT;
```

**Acceptance**:
- Migration runs idempotently (execute twice, no errors on second run)
- `SELECT count(*) FROM capability_catalog_metadata` returns 6 after first run
- `realtime-subscription` row has `dependencies` = `["kafka-events"]`

---

### TASK-02 — Static Snippet Templates: `snippet-catalog-data.json`

**Depends on**: nothing (can run in parallel with TASK-03)  
**File**: `SNIPPET_DATA`

Create a static JSON file containing example code templates for all six capability categories. Each capability must have at least three operation examples per language (Node.js required; curl optional). Use `{HOST}`, `{PORT}`, `{WORKSPACE_ID}`, `{RESOURCE_NAME}`, `{REALTIME_ENDPOINT}` as interpolation placeholders.

**Structure**:

```jsonc
{
  "version": "1.0.0",
  "capabilities": {
    "postgres-database": {
      "operations": [
        {
          "operationId": "connect",
          "label": "Connect (Node.js)",
          "language": "nodejs",
          "code": "import { Client } from 'pg'\nconst client = new Client({ host: '{HOST}', port: {PORT}, ... })\nawait client.connect()",
          "hasPlaceholderSecrets": true,
          "secretPlaceholderRef": "Use the database credential shown in the workspace console."
        },
        { "operationId": "query", ... },
        { "operationId": "insert", ... },
        { "operationId": "list-tables", ... }
      ]
    },
    "mongo-collection": { "operations": [ /* connect, find, insertOne, listCollections */ ] },
    "kafka-events":      { "operations": [ /* produce, consume, list-topics */ ] },
    "realtime-subscription": { "operations": [ /* subscribe, receive, unsubscribe */ ], "dependencyNote": "Requires Event Streaming (kafka-events) to be enabled." },
    "serverless-function":   { "operations": [ /* invoke, list, get-logs */ ] },
    "storage-bucket":        { "operations": [ /* upload, download, list-objects */ ] }
  }
}
```

**Acceptance**:
- All 6 capability keys present
- Each capability has ≥ 3 operation entries
- All placeholders use the documented variable names
- `realtime-subscription` includes a `dependencyNote` referencing `kafka-events`
- File parses as valid JSON

---

### TASK-03 — JSON Schemas: Response + Audit Event

**Depends on**: nothing (can run in parallel with TASK-02)  
**Files**: `SCHEMA_RESPONSE`, `SCHEMA_EVENT`, `CONTRACTS_INDEX`

#### 3a — `workspace-capability-catalog-response.json`

JSON Schema (Draft 2020-12) for the full catalog response. Must capture:
- Required top-level fields: `workspaceId`, `tenantId`, `generatedAt`, `catalogVersion`, `capabilities`
- `capabilities` items: `id`, `displayName`, `category`, `enabled` (boolean), `status` (enum: `active|disabled|provisioning|deprovisioning`), `version`, `dependencies` (array of strings)
- When `enabled = true`: `examples` array with `operationId`, `label`, `language`, `code`, `hasPlaceholderSecrets`, `secretPlaceholderRef`; optional `quota` object
- When `enabled = false`: `examples` must be empty array; `enablementGuide` (non-empty string) required

#### 3b — `workspace-capability-catalog-accessed-event.json`

JSON Schema for the Kafka audit event. Required fields:
`eventType`, `workspaceId`, `tenantId`, `actorId`, `capabilityId` (nullable string), `accessDate`, `correlationId`, `timestamp`

#### 3c — Update `services/internal-contracts/src/index.mjs`

Add named exports for both schemas:

```js
export { default as workspaceCapabilityCatalogResponse } from './workspace-capability-catalog-response.json' assert { type: 'json' }
export { default as workspaceCapabilityCatalogAccessedEvent } from './workspace-capability-catalog-accessed-event.json' assert { type: 'json' }
```

**Acceptance**:
- Both schema files are valid JSON Schema Draft 2020-12
- `index.mjs` exports both without breaking existing exports

---

### TASK-04 — Core Logic: `capability-catalog-builder.mjs`

**Depends on**: TASK-02, TASK-03  
**File**: `BUILDER`

Assemble capability catalog entries from raw capability state + workspace context.

**Module Interface** (ESM):

```js
/**
 * @param {Object[]} capabilities       — rows from capability_catalog_metadata + effective state
 * @param {Object}   workspaceContext   — { workspaceId, tenantId, baseUrl, resourceNames, endpoints }
 * @returns {Object[]} capabilities array (matches response schema)
 */
export function buildCatalog(capabilities, workspaceContext) { ... }

/**
 * @param {string} capabilityKey
 * @param {boolean} enabled
 * @param {Object} workspaceContext
 * @returns {Object[]} examples array (empty if disabled)
 */
export function buildExamples(capabilityKey, enabled, workspaceContext) { ... }
```

**Logic**:
1. Load `snippet-catalog-data.json`
2. For each capability:
   - If `enabled = true`: interpolate template placeholders using `workspaceContext`, return ≥ 3 examples
   - If `enabled = false`: return `examples: []` and `enablementGuide` string (FR-006)
   - Annotate `dependencyNote` from snippet data (FR-012)
3. Map DB `capabilityStatus` → catalog `status` enum:
   - `active` / `enabled` → `"active"`
   - `disabled` → `"disabled"`
   - `provisioning` → `"provisioning"`
   - `deprovisioning` → `"deprovisioning"`

**Acceptance** (verified by UNIT_BUILDER_TEST):
- `buildExamples('postgres-database', true, ctx)` returns ≥ 3 examples with placeholders resolved
- `buildExamples('mongo-collection', false, ctx)` returns `[]` and builder returns `enablementGuide` string
- `buildCatalog(...)` includes `dependencyNote` on `realtime-subscription` entries
- Transitional status correctly mapped from DB value to catalog status enum

---

### TASK-05 — OpenWhisk Action: `workspace-capability-catalog.mjs`

**Depends on**: TASK-01, TASK-03, TASK-04  
**File**: `ACTION`

Main OpenWhisk action handler. Node.js 20+ ESM.

**Handler Logic**:

```text
1. Extract workspaceId from path params; optional capabilityId
2. Extract JWT context (workspaceId claim, actorId, tenantId) using authorization-context.mjs pattern
3. Enforce workspace-scope: if path workspaceId ≠ JWT workspaceId claim → 403
4. Query PostgreSQL:
   SELECT ccm.*, wcs.enabled, wcs.status, wcs.quota
   FROM capability_catalog_metadata ccm
   LEFT JOIN workspace_capability_state wcs
     ON wcs.capability_key = ccm.capability_key
    AND wcs.workspace_id = $1
   [WHERE ccm.capability_key = $2]   -- only for single-capability path
5. If no workspace found (0 rows for a specific workspace_id + at least 1 ccm row) → 404
6. Delegate to buildCatalog(rows, workspaceContext) → capabilities[]
7. Fire-and-forget: emit Kafka audit event to console.workspace.capability-catalog.accessed
8. Return 200 JSON response matching workspace-capability-catalog-response.json schema
```

**Error codes** (per plan.md API Contracts):
- `WORKSPACE_NOT_FOUND` → 404 (existence-leak safe)
- `CAPABILITY_NOT_FOUND` → 404 (unknown capabilityId)
- `UNAUTHORIZED` → 401
- `FORBIDDEN` → 403
- `INTERNAL_ERROR` → 500

**Kafka event**: emit `{ eventType, workspaceId, tenantId, actorId, capabilityId, accessDate, correlationId, timestamp }` to topic `console.workspace.capability-catalog.accessed` (fire-and-forget, log failure as warn).

**Acceptance** (verified by UNIT_ACTION_TEST):
- Request with mismatched workspace claim → 403
- Missing/invalid JWT → 401
- Unknown workspaceId → 404 (same as inaccessible)
- Unknown capabilityId → 404
- Valid full-catalog request → 200 with 6 capability items
- Valid single-capability request → 200 with 1 capability item
- Kafka failure does not fail the request (warn logged, response still 200)

---

### TASK-06 — APISIX Gateway Route

**Depends on**: TASK-05  
**File**: `GATEWAY_ROUTE`

Define APISIX routes for both catalog endpoints following existing `services/gateway-config/routes/` patterns.

**Routes**:
- `GET /v1/workspaces/{workspaceId}/capability-catalog`
- `GET /v1/workspaces/{workspaceId}/capability-catalog/{capabilityId}`

**Plugins** (following existing route definitions):
- Keycloak JWT validation plugin
- Workspace-scope enforcement plugin
- Correlation-ID injection
- Prometheus metrics plugin

**Acceptance**:
- YAML is valid and follows existing gateway-config naming conventions
- Both paths defined with GET method
- Auth and scope plugins present

---

### TASK-07 — Console Page: `ConsoleCapabilityCatalogPage.tsx`

**Depends on**: TASK-05 (API contract finalised)  
**Files**: `CONSOLE_PAGE`, `CONSOLE_PAGE_TEST`

React 18 + Tailwind CSS + shadcn/ui page at route `/workspaces/:workspaceId/capabilities`.

**UI Structure**:
- Page header: "Capability Catalog" + workspace name
- Grid of capability cards (one per capability, 6 total)
  - Enabled badge (green) or Disabled badge (grey)
  - Status badge for transitional states (yellow "Provisioning" / "Deprovisioning")
  - Quota info if present (enabled capabilities)
  - Dependency note if present
  - Collapsible section: code examples (syntax-highlighted, copyable) — only shown when `enabled = true`
  - "Not Enabled" state with `enablementGuide` text — shown when `enabled = false`
- Loading skeleton (shadcn Skeleton component)
- Error boundary with retry button

**Data Fetching**: Use existing console data-fetching pattern (likely `useSWR` or React Query hooking into the action endpoint). Mock action response for tests.

**Acceptance** (verified by CONSOLE_PAGE_TEST):
- Enabled capability renders at least one code block
- Disabled capability renders `enablementGuide` text, no code block
- Loading state renders skeleton, not card grid
- Error state renders error message with retry button
- Transitional state renders yellow status badge

---

### TASK-08 — Unit Tests

**Depends on**: TASK-04, TASK-05  
**Files**: `UNIT_BUILDER_TEST`, `UNIT_ACTION_TEST`

Use `node:test` (Node 20 built-in). No network calls; mock `pg` and `kafkajs`.

#### `tests/unit/capability-catalog-builder.test.mjs`

| Test | Assertion |
|------|-----------|
| `buildExamples` — enabled postgres | returns array length ≥ 3; all `code` strings have placeholders resolved |
| `buildExamples` — disabled mongo | returns empty array |
| `buildCatalog` — disabled capability | item has `enablementGuide` string, `examples: []` |
| `buildCatalog` — realtime-subscription | item has non-empty `dependencyNote` |
| `buildCatalog` — transitional provisioning | item has `status: 'provisioning'` |

#### `tests/unit/workspace-capability-catalog-action.test.mjs`

| Test | Assertion |
|------|-----------|
| Mismatched workspace claim | 403 FORBIDDEN |
| Missing JWT | 401 UNAUTHORIZED |
| Unknown workspaceId | 404 WORKSPACE_NOT_FOUND |
| Unknown capabilityId | 404 CAPABILITY_NOT_FOUND |
| Full catalog — valid request | 200, `capabilities` array length 6 |
| Single-capability — valid request | 200, `capabilities` array length 1 |
| Kafka publish throws | still returns 200, warn log emitted |

---

### TASK-09 — Contract Tests

**Depends on**: TASK-03, TASK-05  
**File**: `CONTRACT_TEST`

Use `node:test`. Validate fixture responses against JSON Schema using `ajv` (already a dev dependency in the project).

| Test | Assertion |
|------|-----------|
| Full catalog fixture validates against `workspace-capability-catalog-response.json` | no schema errors |
| Single-capability fixture validates | no schema errors |
| Audit event fixture validates against `workspace-capability-catalog-accessed-event.json` | no schema errors |
| All 6 capability keys present in full-catalog fixture | `capabilities.map(c => c.id)` contains all 6 keys |
| Each enabled capability in fixture has `examples.length >= 3` | per capability item |
| Each disabled capability in fixture has `examples.length === 0` and non-empty `enablementGuide` | per capability item |

---

### TASK-10 — Integration Tests

**Depends on**: TASK-01, TASK-05  
**File**: `INTEGRATION_TEST`

Use `node:test`. Requires test PostgreSQL DB and test Kafka broker (follow existing integration test setup patterns in the repo).

| Test | Assertion |
|------|-----------|
| Full catalog for workspace with postgres + realtime enabled | 200, postgres `enabled: true`, realtime `enabled: true`, mongo `enabled: false` |
| Disabled capability returns empty examples + enablementGuide | validated against schema |
| Transitional state: workspace with postgres in `provisioning` | catalog shows `status: 'provisioning'` for postgres |
| Single-capability request for enabled capability | 200, single item, examples present |
| Audit event written to Kafka topic `console.workspace.capability-catalog.accessed` | consumer receives message within 5s |
| Migration idempotency | run migration SQL twice, second run succeeds with no errors |

---

## Implementation Order Summary

```text
TASK-01 ──────────────────────────────────────────────────────────────────────┐
                                                                               │
TASK-02 ────────────────────────────────────────────────┐                     │
                                                         │                     │
TASK-03 ────────────────────────────────────────────────┤                     │
                                                         ▼                     ▼
                                               TASK-04 ──────────► TASK-05 ──► TASK-06
                                                                        │
                                                         ┌──────────────┤
                                                         ▼              ▼
                                                     TASK-07        TASK-08
                                                                        │
                                                                    TASK-09
                                                                        │
                                                                    TASK-10
```

**Critical path**: TASK-01 → TASK-04 → TASK-05 → TASK-08 → TASK-09 → TASK-10

---

## Criteria of Done

Matches plan.md CoD table. All tasks complete when:

| # | Criterion | Verified by |
|---|-----------|-------------|
| 1 | `GET /v1/workspaces/{id}/capability-catalog` returns 6 capabilities with correct `enabled` | CONTRACT_TEST, INTEGRATION_TEST |
| 2 | Each enabled capability has ≥ 3 contextualised examples | CONTRACT_TEST |
| 3 | Disabled capabilities return `examples: []` and non-empty `enablementGuide` | UNIT_BUILDER_TEST, CONTRACT_TEST |
| 4 | Transitional states (`provisioning`, `deprovisioning`) correctly reflected | UNIT_ACTION_TEST, INTEGRATION_TEST |
| 5 | Unauthenticated requests → 401 | UNIT_ACTION_TEST |
| 6 | Inaccessible workspace → 404 (no existence leak) | UNIT_ACTION_TEST |
| 7 | Audit event emitted on every access | INTEGRATION_TEST |
| 8 | Cross-capability dependency notes present (realtime → kafka-events) | UNIT_BUILDER_TEST |
| 9 | Console page renders enabled/disabled states, code blocks, guidance text | CONSOLE_PAGE_TEST |
| 10 | All tests pass at root-level quality gates (`pnpm test`) | CI |
| 11 | Migration is idempotent | INTEGRATION_TEST |
| 12 | `plan.md`, contracts/, schemas committed | Git log |
