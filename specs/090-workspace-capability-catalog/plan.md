# Implementation Plan: Workspace Capability Catalog

**Branch**: `090-workspace-capability-catalog` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-DX-02-T06 | **Epic**: EP-17 | **Story**: US-DX-02

## Summary

Expose a structured, workspace-scoped capability catalog API that returns the enabled/disabled status and contextualised usage examples for all six core platform capabilities (PostgreSQL, MongoDB, event streaming, realtime subscriptions, serverless functions, object storage). The catalog is served as an OpenWhisk action behind APISIX, enforces Keycloak-based workspace-scoped access control, emits Kafka audit events, and complements the existing `effective-capabilities` endpoint in the control-plane. A new console page surfaces the catalog in the React/Tailwind UI.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka audit), Apache OpenWhisk action wrapper patterns (established in provisioning-orchestrator), React 18 + Tailwind CSS + shadcn/ui (console)
**Storage**: PostgreSQL (workspace capability state via existing `EffectiveCapabilityResolution` schema; new migration for catalog quota metadata), internal-contracts JSON schemas
**Testing**: `node:test` (Node 20 built-in) for backend; Vitest + React Testing Library for console
**Target Platform**: Kubernetes / OpenShift; action deployed via Helm chart in `services/provisioning-orchestrator`
**Project Type**: BaaS multi-tenant web service (control-plane + OpenWhisk actions + React console)
**Performance Goals**: catalog retrieval p95 < 150 ms (cached capability resolution + static example generation)
**Constraints**: multi-tenancy, workspace isolation, no secrets in repository, all APIs versioned under `/v1/`
**Scale/Scope**: per workspace, covering 6 capability categories, audit event per request

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I — Monorepo Separation | ✅ PASS | New action under `services/provisioning-orchestrator/src/actions/`; new console page under `apps/web-console/src/pages/`; new contracts under `services/internal-contracts/src/` |
| II — Incremental Delivery | ✅ PASS | Action + migration first; console page second; both independently reviewable |
| III — Kubernetes/OpenShift Compatibility | ✅ PASS | OpenWhisk action packaging; no new Helm values that break OpenShift defaults |
| IV — Quality Gates at Root | ✅ PASS | New tests added to existing `node --test` and Vitest root-level gates |
| V — Documentation as Part of Change | ✅ PASS | This plan.md + data-model.md + contracts/ constitute the documentation artefacts |

*No violations. Complexity table not required.*

## Project Structure

### Documentation (this feature)

```text
specs/090-workspace-capability-catalog/
├── plan.md              ← This file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/           ← Phase 1 output
│   ├── workspace-capability-catalog-response.json
│   └── workspace-capability-catalog-accessed-event.json
└── tasks.md             ← Phase 2 output (speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
# Option 1: Monorepo additions to existing services

services/
├── provisioning-orchestrator/
│   └── src/
│       ├── actions/
│       │   └── workspace-capability-catalog.mjs       [NEW] OpenWhisk action
│       └── migrations/
│           └── 090-workspace-capability-catalog.sql   [NEW] capability_catalog_metadata table
│
├── internal-contracts/
│   └── src/
│       ├── workspace-capability-catalog-response.json  [NEW] response schema
│       ├── workspace-capability-catalog-accessed-event.json [NEW] audit event schema
│       └── index.mjs                                   [UPDATED] export new schemas
│
├── workspace-docs-service/
│   └── src/
│       └── capability-catalog-builder.mjs              [NEW] capability catalog assembly logic

apps/
└── web-console/
    └── src/
        ├── pages/
        │   ├── ConsoleCapabilityCatalogPage.tsx         [NEW] catalog UI page
        │   └── ConsoleCapabilityCatalogPage.test.tsx    [NEW]
        └── actions/
            └── workspace-capability-catalog.mjs         [NEW] console action adapter

tests/
└── contracts/
    └── workspace-capability-catalog.contract.test.mjs  [NEW] contract test

services/
└── gateway-config/
    └── routes/
        └── workspace-capability-catalog.yaml           [NEW] APISIX route definition
```text

**Structure Decision**: Single monorepo additions pattern. The action lives in `provisioning-orchestrator` (established home for workspace-scoped OpenWhisk actions). Example-assembly logic lives in `workspace-docs-service` (already owns snippet interpolation). New schemas land in `internal-contracts`. Console page under `apps/web-console`.

---

## Architecture & Flow

### Component Map

```text
[APISIX Gateway]
    │  route: GET /v1/workspaces/{workspaceId}/capability-catalog
    │  route: GET /v1/workspaces/{workspaceId}/capability-catalog/{capabilityId}
    │
    ▼ (Keycloak JWT validation, workspace-scope enforcement)
[OpenWhisk Action: workspace-capability-catalog.mjs]
    │
    ├──► [PostgreSQL] — read workspace capability state
    │       JOIN workspace_plans + provider_capability_records
    │       + capability_catalog_metadata (quota hints, dependency graph)
    │
    ├──► [capability-catalog-builder.mjs] — assemble examples
    │       uses snippet-catalog-data.json templates
    │       interpolates workspace base URL + resource context
    │       enforces disabled-capability suppression (FR-006)
    │
    ├──► [Kafka producer] — emit audit event
    │       topic: console.workspace.capability-catalog.accessed
    │
    └──► JSON response ──► [APISIX] ──► caller
```

### Key Design Decisions

1. **Reuse `effective-capabilities` data**: The action reads from the same PostgreSQL tables that back `/v1/workspaces/{id}/effective-capabilities` (already in the control-plane OpenAPI). No duplication of source of truth; the new action enriches the raw capability status with examples and quota metadata.

2. **Example generation is stateless and synchronous**: Examples are assembled from `snippet-catalog-data.json` + workspace config at request time. No pre-generation job needed at this scope.

3. **Separate catalog endpoint from workspace docs (T03)**: T03 generates a full human-readable documentation document; T06 is a structured, machine-readable catalog. They share the example interpolation logic via `capability-catalog-builder.mjs` but remain separate endpoints.

4. **Single-capability query support (FR-013)**: The path `/capability-catalog/{capabilityId}` returns one capability item; the base path returns all six.

5. **Transitional states (FR-007)**: Sourced from `capabilityStatus` field in `ProviderCapabilityStatus` (already present in `ResolvedCapability`). The action maps `provisioning`/`deprovisioning` to transitional catalog states.

6. **Audit on every access (FR-011)**: Kafka publish is fire-and-forget with structured logging on failure (no blocking of the response).

---

## Data Model

### New PostgreSQL Table: `capability_catalog_metadata`

```sql
-- migration: 090-workspace-capability-catalog.sql
CREATE TABLE IF NOT EXISTS capability_catalog_metadata (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key       TEXT NOT NULL UNIQUE,     -- e.g. 'postgres-database'
  display_name         TEXT NOT NULL,
  category             TEXT NOT NULL,            -- 'data', 'messaging', 'compute', 'storage'
  description          TEXT,
  catalog_version      TEXT NOT NULL DEFAULT '1.0.0',
  dependencies         JSONB NOT NULL DEFAULT '[]',  -- array of capability_key strings
  common_operations    JSONB NOT NULL DEFAULT '[]',  -- metadata for example operations
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 6 core capabilities
INSERT INTO capability_catalog_metadata (capability_key, display_name, category, description, dependencies)
VALUES
  ('postgres-database',       'PostgreSQL',              'data',      'Relational database',           '[]'),
  ('mongo-collection',        'MongoDB',                 'data',      'Document database',             '[]'),
  ('kafka-events',            'Event Streaming',         'messaging', 'Kafka-based event bus',         '[]'),
  ('realtime-subscription',   'Realtime Subscriptions',  'messaging', 'WebSocket realtime channels',   '["kafka-events"]'),
  ('serverless-function',     'Serverless Functions',    'compute',   'OpenWhisk function execution',  '[]'),
  ('storage-bucket',          'Object Storage',          'storage',   'S3-compatible object storage',  '[]')
ON CONFLICT (capability_key) DO NOTHING;
```

*Note*: This table holds catalog metadata only. The enabled/disabled status continues to live in the existing workspace capability state tables (read via `EffectiveCapabilityResolution`).

### Existing Tables Referenced (read-only)

- `workspace_plans` + `provider_capability_records` — source of enabled status per workspace
- `async_operations` — used only for transitional state correlation (if provisioning in flight)
- `snippet-catalog-data.json` (internal-contracts) — static example templates (no DB needed)

---

## API Contracts

### `GET /v1/workspaces/{workspaceId}/capability-catalog`

**Headers**: `Authorization: Bearer <token>`, `X-Api-Version: 1`, `X-Correlation-Id: <uuid>`

**Response 200** (schema: `workspace-capability-catalog-response.json`):

```json
{
  "workspaceId": "ws-123",
  "tenantId": "t-abc",
  "generatedAt": "2026-03-30T20:00:00Z",
  "catalogVersion": "1.0.0",
  "capabilities": [
    {
      "id": "postgres-database",
      "displayName": "PostgreSQL",
      "category": "data",
      "description": "Relational database",
      "enabled": true,
      "status": "active",
      "version": "1.0.0",
      "quota": { "maxConnections": 20, "storageGb": 10 },
      "dependencies": [],
      "examples": [
        {
          "operationId": "connect",
          "label": "Connect (Node.js)",
          "language": "nodejs",
          "code": "import { Client } from 'pg'\nconst client = new Client({ host: 'pg.ws-123.example.com', ... })",
          "hasPlaceholderSecrets": true,
          "secretPlaceholderRef": "Use the database credential shown in the workspace console."
        }
      ]
    },
    {
      "id": "mongo-collection",
      "displayName": "MongoDB",
      "category": "data",
      "enabled": false,
      "status": "disabled",
      "examples": [],
      "enablementGuide": "Contact your workspace administrator to enable MongoDB."
    }
  ]
}
```

**Response 200 — single capability** (`GET /v1/workspaces/{workspaceId}/capability-catalog/{capabilityId}`):
Same shape but `capabilities` array contains exactly one item.

**Error codes**:

| Code | HTTP | Meaning |
|------|------|---------|
| `WORKSPACE_NOT_FOUND` | 404 | Workspace does not exist or caller has no access (no existence leak) |
| `CAPABILITY_NOT_FOUND` | 404 | capabilityId not recognised |
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `FORBIDDEN` | 403 | Token valid but no workspace access |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

### Audit Event: `console.workspace.capability-catalog.accessed`

```json
{
  "eventType": "workspace.capability-catalog.accessed",
  "workspaceId": "ws-123",
  "tenantId": "t-abc",
  "actorId": "user-xyz",
  "capabilityId": null,
  "accessDate": "2026-03-30",
  "correlationId": "req-uuid",
  "timestamp": "2026-03-30T20:00:00.123Z"
}
```

Topic: `console.workspace.capability-catalog.accessed` (retention: 30d, partitioned by `workspaceId`)

---

## Implementation Modules

### `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`

Responsibilities:
1. Parse and validate input (`workspaceId`, optional `capabilityId`, JWT context)
2. Enforce workspace-scoped authorization (reuse `authorization-context.mjs` pattern)
3. Query PostgreSQL: JOIN `capability_catalog_metadata` with effective capabilities for the workspace
4. Delegate example assembly to `capability-catalog-builder.mjs`
5. Emit Kafka audit event (fire-and-forget)
6. Return structured catalog response

### `services/workspace-docs-service/src/capability-catalog-builder.mjs`

Responsibilities:
1. Accept `{ capabilityKey, enabled, status, workspaceContext }` per capability
2. Load templates from `snippet-catalog-data.json` filtered by `serviceKey`
3. Interpolate placeholders: `{HOST}`, `{PORT}`, `{RESOURCE_NAME}`, `{WORKSPACE_ID}`, `{REALTIME_ENDPOINT}` from `workspaceContext`
4. Return examples array (empty array if `enabled === false`)
5. Return `enablementGuide` string when `enabled === false` (FR-006)
6. Annotate cross-capability dependencies (FR-012)

### `services/internal-contracts/src/workspace-capability-catalog-response.json`

JSON Schema (Draft 2020-12) for the catalog response envelope, exported from `index.mjs`.

### `services/internal-contracts/src/workspace-capability-catalog-accessed-event.json`

JSON Schema for the Kafka audit event.

### `apps/web-console/src/pages/ConsoleCapabilityCatalogPage.tsx`

- Route: `/workspaces/:workspaceId/capabilities`
- Renders capability cards with enabled/disabled badges
- Collapsible example code blocks per capability (syntax-highlighted)
- "Not enabled" state with enablement guidance text
- Loading skeleton + error boundary

### `services/gateway-config/routes/workspace-capability-catalog.yaml`

APISIX route for:
- `GET /v1/workspaces/{workspaceId}/capability-catalog`
- `GET /v1/workspaces/{workspaceId}/capability-catalog/{capabilityId}`

With Keycloak JWT auth plugin and workspace-scope enforcement plugin (following existing gateway-config patterns).

---

## Test Strategy

### Unit Tests (node:test)

| File | What's tested |
|------|--------------|
| `tests/unit/capability-catalog-builder.test.mjs` | Example assembly: enabled capability → 3+ examples; disabled → empty array + guide; dependency annotation |
| `tests/unit/workspace-capability-catalog-action.test.mjs` | Action: authorization rejection (403/401), 404 on unknown workspace, 200 with correct structure, single-capability path |

### Contract Tests

| File | What's tested |
|------|--------------|
| `tests/contracts/workspace-capability-catalog.contract.test.mjs` | Response validates against `workspace-capability-catalog-response.json` schema; audit event validates against event schema; each of 6 capabilities present in full-catalog response |

### Integration Tests

| File | What's tested |
|------|--------------|
| `tests/integration/workspace-capability-catalog.integration.test.mjs` | Action against test DB: enabled workspace returns examples; disabled capability returns empty examples + guide; transitional state returns `status: provisioning`; audit event written to Kafka topic |

### Console Tests (Vitest + RTL)

| File | What's tested |
|------|--------------|
| `ConsoleCapabilityCatalogPage.test.tsx` | Renders catalog with mocked action response; enabled capability shows code block; disabled capability shows guide text; loading state; error state |

### E2E Validation (manual / CI smoke)

- Hit `GET /v1/workspaces/{id}/capability-catalog` with valid Keycloak token → 200 with 6 capabilities
- Hit same endpoint with invalid token → 401
- Hit with other tenant's workspace ID → 404 (existence leak prevention)
- Verify audit event appears in Kafka topic within 5s

---

## Migration Strategy

```sql
-- 090-workspace-capability-catalog.sql
-- Safe: CREATE TABLE IF NOT EXISTS + INSERT ON CONFLICT DO NOTHING
-- No schema changes to existing tables
-- Rollback: DROP TABLE capability_catalog_metadata (no FK dependencies introduced)
```

- **Additive only**: no changes to existing tables, no breaking schema changes
- **Idempotent**: all statements are `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`
- **No locking**: new table, no `ALTER TABLE` on existing tables
- **RLS**: `capability_catalog_metadata` is a platform-wide lookup table; access controlled at action layer (no tenant-specific rows)

---

## Observability & Security

### Metrics

- `capability_catalog_requests_total` (labels: `workspace_id`, `capability_id`, `status_code`) — Prometheus counter via existing metrics pattern
- `capability_catalog_duration_ms` — histogram (p50, p95, p99)

### Structured Logging

- Every action invocation: `{ action: 'workspace-capability-catalog', workspaceId, capabilityId, durationMs, statusCode, correlationId }`
- Kafka publish failure: `{ level: 'warn', event: 'audit-publish-failed', ... }` (non-blocking)

### Security Controls

- JWT validation: delegated to APISIX Keycloak plugin (upstream of action)
- Workspace-scope enforcement: `authorization-context.mjs` pattern (existing); caller's `workspace_id` claim must match path `{workspaceId}`
- Existence leak prevention: 404 returned regardless of whether workspace exists or access is denied (FR-009)
- No secrets in response: examples use placeholder strings, not real credentials; `hasPlaceholderSecrets: true` flag set

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| effective-capabilities source data is stale | Low | Medium | Add `generatedAt` timestamp; document TTL expectation; cache at action layer with short TTL (30s) |
| Kafka audit publish blocks response | Low | High | Fire-and-forget with timeout; log failure; never block HTTP response |
| Cross-capability dependency graph grows complex | Medium | Low | `dependencies` field in `capability_catalog_metadata` is JSONB — extensible without migration |
| Console page references capabilityId that doesn't exist | Low | Low | 404 handled in page error boundary |
| New `capability_catalog_metadata` rows needed for future capabilities | Low | Low | INSERT via migration; additive process established |

---

## Dependencies & Sequencing

### Declared Dependencies

- US-GW-01 (APISIX routing): gateway route definition depends on gateway patterns being established ✅ (already done per AGENTS.md)
- US-DX-02-T01 through T05: capability catalog is independent of these; can be developed in parallel

### Recommended Implementation Sequence

```text
Step 1 (DB):   090-workspace-capability-catalog.sql migration
Step 2 (Core): capability-catalog-builder.mjs + unit tests
Step 3 (Core): workspace-capability-catalog-response.json + event schema in internal-contracts
Step 4 (Core): workspace-capability-catalog.mjs action + unit tests
Step 5 (APISIX): gateway route definition
Step 6 (Console): ConsoleCapabilityCatalogPage.tsx + test
Step 7 (Tests): contract + integration tests
Step 8 (Docs): quickstart.md
```

Steps 2–3 can be parallelised. Step 4 depends on Steps 1–3. Step 6 can be parallelised with Steps 4–5.

---

## Criteria of Done

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | `GET /v1/workspaces/{id}/capability-catalog` returns all 6 capabilities with correct `enabled` status | Contract test + integration test |
| 2 | Enabled capabilities include ≥ 3 contextualised examples each | Contract test asserts `examples.length >= 3` |
| 3 | Disabled capabilities return empty `examples` and non-empty `enablementGuide` | Unit test |
| 4 | Transitional states (`provisioning`, `deprovisioning`) correctly reflected | Integration test with mock transitional record |
| 5 | Unauthenticated requests rejected with 401 | Unit test |
| 6 | Requests for inaccessible workspaces rejected with 404 (no existence leak) | Unit test |
| 7 | Audit event emitted on every catalog access | Integration test verifies Kafka topic message |
| 8 | Cross-capability dependencies noted in examples (e.g. realtime depends on kafka-events) | Unit test on `capability-catalog-builder.mjs` |
| 9 | Console page renders catalog with enabled/disabled states, code blocks, and guidance text | RTL test |
| 10 | All tests pass at root-level quality gates (`pnpm test`) | CI gate |
| 11 | Migration is idempotent (run twice without error) | Migration test |
| 12 | `plan.md`, `data-model.md`, `contracts/`, `quickstart.md` committed | Git log |
