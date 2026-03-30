# Implementation Plan: Per-Workspace Developer Documentation Generation

**Branch**: `087-workspace-docs-generation` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-DX-02-T03 | **Epic**: EP-17 | **Story**: US-DX-02  
**Input**: Generar documentación por workspace con base URL, credenciales, endpoints habilitados y ejemplos.

## Summary

This plan implements a **per-workspace developer documentation page** accessible from the console and via a structured API endpoint. The page dynamically assembles an integration guide from live workspace state: base URL (from `/v1/workspaces/{workspaceId}/api-surface`), enabled services and their endpoints (from `/v1/workspaces/{workspaceId}/effective-capabilities`), authentication instructions (bound Keycloak clients and API keys), and pre-filled code examples extended from the existing `snippet-catalog.ts` pattern. A lightweight `workspace_doc_notes` PostgreSQL table persists admin-authored custom notes per workspace. An OpenWhisk action (`workspace-docs`) backs the API endpoint at `GET /v1/workspaces/{workspaceId}/docs`.

The design avoids generating static documents: the documentation is composed at request time from live workspace state. Sensitive credentials appear only as descriptive placeholders, never as raw secrets. The console adds a `ConsoleDocsPage` under the existing workspace navigation, reusing `ConnectionSnippets` and adding a new `WorkspaceDocSections` component. Audit events are emitted per session/day-level access.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`) for backend; TypeScript + React 18 + Tailwind CSS + shadcn/ui for frontend  
**Primary Dependencies**: Apache OpenWhisk (action wrapper pattern), `pg` (PostgreSQL), `kafkajs` (Kafka audit), APISIX gateway (route registration), Keycloak (token validation via X-Auth-* context headers)  
**Storage**: PostgreSQL (new `workspace_doc_notes` table), no new MongoDB entities  
**Testing**: `node:test` (backend unit + integration), Vitest (frontend unit), Playwright (E2E smoke)  
**Target Platform**: Kubernetes / OpenShift via Helm  
**Project Type**: Multi-tenant BaaS — control-plane web service + React console  
**Performance Goals**: Documentation API response ≤ 400ms p95 (composed from cached effective-capabilities and api-surface responses)  
**Constraints**: Multi-tenant isolation (tenant_id + workspace_id scoping), secrets never in plaintext, sanitised custom notes (XSS prevention), audit events at session granularity  
**Scale/Scope**: Workspace-level feature; reads existing capability state, writes only to `workspace_doc_notes`

## Constitution Check

*GATE: Must pass before implementation. Re-evaluated after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | New action in `services/workspace-docs-service/`, new page in `apps/web-console/src/pages/`, internal contract in `services/internal-contracts/src/` |
| II. Incremental Delivery | ✅ PASS | T01 and T02 are soft-dependencies; this task uses existing webhook/scheduling endpoint availability flags from `effective-capabilities`, not the full T01/T02 implementations |
| III. Kubernetes/OpenShift Compatibility | ✅ PASS | Helm chart follows existing `services/webhook-engine` pattern; no privileged contexts introduced |
| IV. Quality Gates at Root | ✅ PASS | Test scripts added to root; CI entry uses existing pnpm workspace test runner |
| V. Documentation as Part of the Change | ✅ PASS | This `plan.md`, `data-model.md`, `contracts/`, and `quickstart.md` are produced as part of this change |

No constitution violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/087-workspace-docs-generation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── workspace-docs-api.openapi.json
│   └── workspace-doc-note-events.json
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
services/workspace-docs-service/
├── package.json                         # ESM, "type": "module"
├── actions/
│   └── workspace-docs.mjs              # OpenWhisk action: GET /v1/workspaces/{id}/docs + notes CRUD
├── src/
│   ├── doc-assembler.mjs               # Composes WorkspaceDocView from api-surface + effective-capabilities
│   ├── note-repository.mjs             # CRUD for workspace_doc_notes (pg)
│   ├── note-sanitiser.mjs              # DOMPurify-compatible server-side sanitisation (no unsafe HTML)
│   ├── doc-audit.mjs                   # Emits console.workspace.docs.accessed (session-level dedup)
│   ├── snippet-context-builder.mjs     # Maps service endpoint records → SnippetContext objects
│   └── config.mjs                      # Env var bindings
├── migrations/
│   └── 087-workspace-doc-notes.sql     # DDL for workspace_doc_notes
└── tests/
    ├── doc-assembler.test.mjs
    ├── note-repository.test.mjs
    ├── note-sanitiser.test.mjs
    └── workspace-docs.action.test.mjs

apps/web-console/src/
├── pages/
│   ├── ConsoleDocsPage.tsx             # New workspace documentation page
│   └── ConsoleDocsPage.test.tsx
├── components/console/
│   ├── WorkspaceDocSections.tsx        # Renders enabled service sections with snippets
│   ├── WorkspaceDocSections.test.tsx
│   ├── WorkspaceDocNotes.tsx           # Admin-editable custom notes panel
│   ├── WorkspaceDocNotes.test.tsx
│   └── WorkspaceDocAuthSection.tsx     # Authentication instructions (no raw secrets)
├── lib/
│   └── console-workspace-docs.ts      # API client: fetch docs, CRUD notes

services/internal-contracts/src/
├── workspace-docs-response.json        # JSON Schema: WorkspaceDocsResponse
├── workspace-doc-note.json             # JSON Schema: WorkspaceDocNote
└── workspace-docs-accessed-event.json # JSON Schema: audit event

services/gateway-config/
└── openapi-fragments/
    └── workspace-docs.openapi.json     # APISIX route registration fragment
```

**Structure Decision**: New `services/workspace-docs-service/` service (consistent with `webhook-engine`, `scheduling-engine` pattern). Frontend additions under existing `apps/web-console`. Shared contracts in `services/internal-contracts`.

---

## Phase 0: Research

### R-001 — Existing api-surface and effective-capabilities contract shapes

**Decision**: Use existing public routes `GET /v1/workspaces/{workspaceId}/api-surface` and `GET /v1/workspaces/{workspaceId}/effective-capabilities` as the primary data sources for documentation assembly. These routes are already registered in `public-route-catalog.json` and are accessible to `developer_external`, `workspace_owner`, `workspace_admin`, `workspace_viewer` audiences.

**Rationale**: These endpoints already expose the base URL and the list of enabled capabilities. Building the docs action as a thin composition layer avoids duplicating workspace state and ensures documentation remains consistent with the actual workspace configuration.

**Alternatives considered**: Querying the control plane database directly (coupling risk), requiring a pre-generated document store (freshness risk).

---

### R-002 — Code example reuse strategy

**Decision**: Reuse `apps/web-console/src/lib/snippets/snippet-catalog.ts` templates on the backend by extracting templates into `services/internal-contracts/src/snippet-catalog-data.json` (shared source of truth). The frontend continues to use the TypeScript import; the backend reads the JSON version.

**Rationale**: Template parity between API and console responses without duplicating template strings. The `SnippetContext` interface maps directly to what `api-surface` + `effective-capabilities` returns.

**Alternatives considered**: Maintaining separate backend templates (drift risk), always generating snippets only in the browser (breaks API response requirement from US-3).

---

### R-003 — Custom notes persistence

**Decision**: PostgreSQL table `workspace_doc_notes` in the existing provisioning-orchestrator schema (or a dedicated workspace-docs-service schema). Notes stored as TEXT with server-side sanitisation applied at write time. No rich-text, no markdown parsing on first delivery.

**Rationale**: Consistent with multi-tenant data isolation pattern. Sanitisation at write prevents stored XSS. Simple `TEXT` avoids markdown parser dependency in first iteration.

**Alternatives considered**: MongoDB (no advantage for simple notes), Redis (not persistent enough), in-memory only (no persistence across restarts).

---

### R-004 — Audit event granularity

**Decision**: Emit `console.workspace.docs.accessed` Kafka event at most once per `(workspaceId, actorId, calendar-day)` using `workspace_doc_access_log` deduplification table (or `ON CONFLICT DO NOTHING` on a unique index). This avoids audit topic flooding while maintaining compliance visibility.

**Rationale**: FR-013 requires "per-session or per-day" audit granularity. Per-day with a unique-constraint dedup gives the lightest write overhead.

---

### R-005 — Realtime update strategy (≤ 30s from config change)

**Decision**: Documentation is composed at request time from live API calls to `api-surface` and `effective-capabilities`. No cache layer with TTL > 30 seconds. If the action result is cached (APISIX plugin), TTL must be ≤ 30 seconds. For the console page, a React Query `staleTime: 20_000` (20s) plus a manual refresh button covers the SC-003 requirement.

**Rationale**: The simplest path to SC-003. Caching at APISIX is optional and configurable per route without code changes.

---

## Phase 1: Design & Contracts

### Data Model Summary

See `data-model.md` (output below in this plan).

### API Contract Summary

See `contracts/workspace-docs-api.openapi.json`.

### Key Design Decisions

#### 1. WorkspaceDocsResponse shape

```json
{
  "workspaceId": "wrk-...",
  "tenantId": "ten-...",
  "generatedAt": "2026-03-30T16:00:00.000Z",
  "baseUrl": "https://api.workspace-slug.example.com",
  "authInstructions": {
    "method": "bearer_oidc",
    "tokenEndpoint": "https://iam.example.com/realms/tenant-slug/protocol/openid-connect/token",
    "clientIdPlaceholder": "<YOUR_CLIENT_ID>",
    "clientSecretPlaceholder": "<YOUR_CLIENT_SECRET>",
    "scopeHint": "openid profile",
    "consoleRef": "Settings → Applications → [your application] → Credentials"
  },
  "enabledServices": [
    {
      "serviceKey": "postgres-database",
      "category": "data",
      "label": "PostgreSQL",
      "endpoint": "pg.workspace-slug.example.com",
      "port": 5432,
      "resourceName": "app_db",
      "snippets": [
        {
          "id": "postgres-uri",
          "label": "URI PostgreSQL",
          "code": "postgresql://<PG_USER>:<YOUR_DB_PASSWORD>@pg.workspace-slug.example.com:5432/app_db?sslmode=require",
          "hasPlaceholderSecrets": true,
          "secretPlaceholderRef": "Usa la credencial del usuario de base de datos mostrada en la consola del workspace."
        }
      ]
    }
  ],
  "disabledServices": [],
  "customNotes": [
    {
      "noteId": "note-uuid",
      "content": "Contact platform-team for staging credentials.",
      "authorId": "usr-...",
      "createdAt": "2026-03-29T10:00:00.000Z",
      "updatedAt": "2026-03-29T10:00:00.000Z"
    }
  ]
}
```

#### 2. Service-to-snippet mapping

The `doc-assembler.mjs` translates each entry in `effective-capabilities` to a `SnippetContext`. The mapping table:

| Capability key | SnippetContext fields |
|---|---|
| `postgres-database` | host = PG endpoint, port = 5432, resourceName = DB name |
| `mongo-collection` | host = Mongo endpoint, port = 27017, resourceExtraA = DB name, resourceName = collection (or wildcard) |
| `storage-bucket` | host = S3 endpoint, resourceName = bucket name, resourceExtraA = region |
| `serverless-function` | host = OpenWhisk API GW URL, resourceName = function name |
| `realtime-subscription` | host = realtime gateway WS URL |
| `webhooks` | host = base URL + `/v1/webhooks` |
| `scheduling` | host = base URL + `/v1/schedules` |

#### 3. Custom note CRUD endpoints

Added to the same `workspace-docs.mjs` action:

- `POST /v1/workspaces/{workspaceId}/docs/notes` — create note (workspace_admin, workspace_owner)
- `PUT /v1/workspaces/{workspaceId}/docs/notes/{noteId}` — update note (same; must own or be admin)
- `DELETE /v1/workspaces/{workspaceId}/docs/notes/{noteId}` — soft-delete note
- `GET /v1/workspaces/{workspaceId}/docs` — returns notes inline (all workspace members)

#### 4. Authorization

All endpoints require `authRequired: true` with `gatewayAuthMode: bearer_oidc`. Context injected via APISIX headers (`X-Tenant-Id`, `X-Workspace-Id`, `X-Auth-Scopes`, `X-Actor-Roles`). Read access: `workspace_viewer` and above. Write (notes): `workspace_admin`, `workspace_owner`.

---

## Data Model

### New PostgreSQL Table: `workspace_doc_notes`

```sql
CREATE TABLE IF NOT EXISTS workspace_doc_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  content TEXT NOT NULL,                 -- sanitised at write time
  author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wdn_workspace
  ON workspace_doc_notes (tenant_id, workspace_id)
  WHERE deleted_at IS NULL;
```

### New PostgreSQL Table: `workspace_doc_access_log`

Used for audit deduplication (once per actor per day):

```sql
CREATE TABLE IF NOT EXISTS workspace_doc_access_log (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  access_date DATE NOT NULL DEFAULT current_date,
  PRIMARY KEY (workspace_id, actor_id, access_date)
);
```

### No new MongoDB collections or Kafka topics (beyond existing audit pipeline)

Audit events emitted to existing `console.audit` topic using the existing `observability-audit-event-schema.json` envelope, with `eventType: "workspace.docs.accessed"`.

---

## API Contracts

### `GET /v1/workspaces/{workspaceId}/docs`

**Request headers**: `Authorization: Bearer <token>`, `X-Correlation-Id`, `X-API-Version: 2026-03-01`

**Response 200**:

```json
{
  "workspaceId": "string",
  "tenantId": "string",
  "generatedAt": "string (ISO 8601)",
  "baseUrl": "string (URI)",
  "authInstructions": {
    "method": "string (bearer_oidc | api_key)",
    "tokenEndpoint": "string (URI) | null",
    "clientIdPlaceholder": "string",
    "clientSecretPlaceholder": "string",
    "scopeHint": "string",
    "consoleRef": "string"
  },
  "enabledServices": [
    {
      "serviceKey": "string",
      "category": "string (data | storage | functions | realtime | webhooks | scheduling | events)",
      "label": "string",
      "endpoint": "string (URI or host)",
      "port": "integer | null",
      "resourceName": "string | null",
      "snippets": [
        {
          "id": "string",
          "label": "string",
          "code": "string",
          "notes": ["string"],
          "hasPlaceholderSecrets": "boolean",
          "secretPlaceholderRef": "string | null"
        }
      ]
    }
  ],
  "customNotes": [
    {
      "noteId": "string (UUID)",
      "content": "string",
      "authorId": "string",
      "createdAt": "string (ISO 8601)",
      "updatedAt": "string (ISO 8601)"
    }
  ]
}
```

**Response 403**: `{ "code": "FORBIDDEN", "message": "Insufficient workspace access" }`  
**Response 404**: `{ "code": "WORKSPACE_NOT_FOUND", "message": "Workspace not found or inaccessible" }`  
**Response 503**: `{ "code": "UPSTREAM_UNAVAILABLE", "message": "Unable to resolve workspace configuration" }`

---

### `POST /v1/workspaces/{workspaceId}/docs/notes`

**Audiences**: `workspace_admin`, `workspace_owner`

**Request body**:

```json
{ "content": "string (max 4096 chars, plain text)" }
```

**Response 201**:

```json
{
  "noteId": "string (UUID)",
  "content": "string (sanitised)",
  "authorId": "string",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

**Response 422**: `{ "code": "INVALID_NOTE_CONTENT", "message": "Content too long or empty" }`  
**Response 403**: `{ "code": "FORBIDDEN", "message": "Only workspace admins can manage notes" }`

---

### `PUT /v1/workspaces/{workspaceId}/docs/notes/{noteId}`

Same request/response shape as POST but updates existing note. `noteId` must belong to the workspace.  
**Response 404**: `{ "code": "NOTE_NOT_FOUND" }`

---

### `DELETE /v1/workspaces/{workspaceId}/docs/notes/{noteId}`

**Response 204**: No content on success.  
**Response 404**: `{ "code": "NOTE_NOT_FOUND" }`

---

## Implementation Sequence

### Step 1 — Migration (standalone, no dependencies)

`services/workspace-docs-service/migrations/087-workspace-doc-notes.sql`

- Creates `workspace_doc_notes` and `workspace_doc_access_log` tables.
- Runnable with existing migration runner pattern (see `services/provisioning-orchestrator`).

---

### Step 2 — Backend service scaffolding

New `services/workspace-docs-service/` following `services/webhook-engine` layout:

1. `package.json` — ESM, peer deps: `pg`, `kafkajs`
2. `src/config.mjs` — env bindings (`WORKSPACE_DOCS_DB_URL`, `KAFKA_BROKERS`, `INTERNAL_API_BASE_URL`, `WORKSPACE_DOCS_NOTE_MAX_LENGTH`)
3. `src/note-sanitiser.mjs` — strips HTML tags and control characters; replaces `<`, `>`, `&` entities; rejects if result empty after strip
4. `src/note-repository.mjs` — `insertNote`, `updateNote`, `softDeleteNote`, `listNotes(tenantId, workspaceId)`
5. `src/doc-audit.mjs` — `recordAccess(db, workspaceId, actorId)` with `INSERT ... ON CONFLICT DO NOTHING`, then publishes Kafka event
6. `src/snippet-context-builder.mjs` — maps `EffectiveCapabilityRecord[]` + `ApiSurfaceRecord` to `SnippetContext[]`
7. `src/doc-assembler.mjs` — orchestrates: fetch api-surface → fetch effective-capabilities → build snippet contexts → render snippets → attach notes → return `WorkspaceDocsResponse`

---

### Step 3 — OpenWhisk action

`services/workspace-docs-service/actions/workspace-docs.mjs`

Following the `webhook-management.mjs` pattern:

```js
export async function main(params) {
  const { db, kafka, internalClient, env = process.env,
          method = 'GET', path = '/', body = {}, auth = {} } = params;
  const ctx = { tenantId: auth.tenantId, workspaceId: auth.workspaceId, actorId: auth.actorId, roles: auth.roles ?? [] };

  // Route dispatch
  // GET  /v1/workspaces/:id/docs           → assembleDoc
  // POST /v1/workspaces/:id/docs/notes     → createNote
  // PUT  /v1/workspaces/:id/docs/notes/:nid → updateNote
  // DELETE /v1/workspaces/:id/docs/notes/:nid → deleteNote
}
```

Internal API calls (to `api-surface` and `effective-capabilities`) use `internalClient` (injected, same pattern as existing provisioning-orchestrator actions using internal service map).

---

### Step 4 — Gateway route registration

`services/gateway-config/openapi-fragments/workspace-docs.openapi.json`

New routes registered:
- `GET /v1/workspaces/{workspaceId}/docs`
- `POST /v1/workspaces/{workspaceId}/docs/notes`
- `PUT /v1/workspaces/{workspaceId}/docs/notes/{noteId}`
- `DELETE /v1/workspaces/{workspaceId}/docs/notes/{noteId}`

APISIX upstream: `workspace-docs-service` OpenWhisk action group. Auth: `bearer_oidc`. Context headers injected as per existing pattern.

Update `public-route-catalog.json` to register the 4 new routes (family: `workspaces`, downstreamService: `workspace_docs_service`).

---

### Step 5 — Frontend: API client

`apps/web-console/src/lib/console-workspace-docs.ts`

```typescript
export interface WorkspaceDocsResponse { ... }
export interface WorkspaceDocNote { ... }

export async function fetchWorkspaceDocs(workspaceId: string, token: string): Promise<WorkspaceDocsResponse>
export async function createDocNote(workspaceId: string, content: string, token: string): Promise<WorkspaceDocNote>
export async function updateDocNote(workspaceId: string, noteId: string, content: string, token: string): Promise<WorkspaceDocNote>
export async function deleteDocNote(workspaceId: string, noteId: string, token: string): Promise<void>
```

Uses existing `apps/web-console/src/lib/http.ts` fetch wrapper.

---

### Step 6 — Frontend: Components

**`WorkspaceDocAuthSection.tsx`** — Renders authentication instructions. Displays `tokenEndpoint`, clientId placeholder, scope hint, and `consoleRef` link. Never renders raw secrets. Uses shadcn/ui `Card`, `Badge`.

**`WorkspaceDocSections.tsx`** — Receives `enabledServices[]`. Renders each service as a collapsible panel with its category badge, endpoint, and `ConnectionSnippets` component (already built in spec 065). If `enabledServices` is empty, renders a "No services enabled yet" empty state with a link to workspace settings.

**`WorkspaceDocNotes.tsx`** — Admin-editable textarea if `role ∈ {workspace_admin, workspace_owner}`. Non-admin users see read-only note blocks. Optimistic UI for create/update/delete with rollback on error.

**`ConsoleDocsPage.tsx`** — Main page composing all sections:
1. Title + breadcrumb
2. `WorkspaceDocAuthSection`
3. `WorkspaceDocSections` (with table of contents / anchor links if > 4 services)
4. `WorkspaceDocNotes`
5. "Last updated" timestamp + manual refresh button

---

### Step 7 — Router registration

`apps/web-console/src/router.tsx` — Add:

```tsx
{
  path: 'workspaces/:workspaceId/docs',
  element: <ConsoleDocsPage />
}
```

Add navigation link in workspace sidebar/nav menu (consistent with existing `ConsoleRealtimePage` link pattern).

---

### Step 8 — Helm chart

`charts/workspace-docs-service/` — Minimal Helm chart following `services/pg-cdc-bridge/helm` pattern. Includes:
- `Deployment` for the OpenWhisk action invoker (or registration in existing OpenWhisk namespace)
- `Secret` references (no hardcoded secrets) for `WORKSPACE_DOCS_DB_URL`, `KAFKA_BROKERS`, `INTERNAL_API_BASE_URL`
- `ConfigMap` for non-sensitive env vars

---

## Testing Strategy

### Unit tests (backend — `node:test`)

| Test file | Scenarios |
|---|---|
| `note-sanitiser.test.mjs` | strips `<script>`, `<img onerror>`, `&amp;` entities, rejects empty post-strip, passes clean text unchanged |
| `doc-assembler.test.mjs` | assembles correct response from mocked api-surface + capabilities, omits disabled services, handles upstream 404/503 gracefully |
| `note-repository.test.mjs` | insert/update/soft-delete isolation (tenant_id + workspace_id guard), list returns only active notes |
| `workspace-docs.action.test.mjs` | route dispatch (GET docs, POST note, PUT note, DELETE note), 403 when role insufficient, 404 when workspace not found, 503 when internal call fails |

### Unit tests (frontend — Vitest)

| Test file | Scenarios |
|---|---|
| `ConsoleDocsPage.test.tsx` | renders loading state, renders all sections on success, handles empty services list |
| `WorkspaceDocSections.test.tsx` | renders each service category, passes correct SnippetContext to ConnectionSnippets |
| `WorkspaceDocNotes.test.tsx` | admin sees edit controls, viewer sees read-only, optimistic add/delete with error rollback |

### Integration tests

- `workspace-docs.integration.test.mjs` — end-to-end action invocation with a real PostgreSQL test DB (Docker-in-test), verifying: note create → list → update → delete, audit log dedup (same actor same day = 1 row), `ON CONFLICT DO NOTHING` for access log.

### Contract tests

- `contracts/workspace-docs-api.openapi.json` used as the contract. Validation via `ajv` in a contract test that exercises the action with known inputs and validates all response shapes.

### E2E smoke (Playwright)

- `apps/web-console/e2e/workspace-docs.spec.ts`:
  1. Navigate to workspace docs page → verify base URL is visible
  2. Copy a snippet → verify clipboard content (requires `navigator.clipboard` mock or Playwright clipboard API)
  3. Admin adds a custom note → note appears for viewer role
  4. Admin deletes note → note disappears

### Operational validations

- Confirm `workspace_doc_access_log` has exactly 1 row after repeated same-day access
- Confirm Kafka `console.audit` contains `workspace.docs.accessed` event after first access
- Confirm `ConsoleDocsPage` reflects updated service list within 30s of workspace capability change (manual validation / SC-003)

---

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| `api-surface` / `effective-capabilities` upstream latency increases docs response time | Medium | Parallel fetch both endpoints; set 2s timeout with graceful degradation (return cached partial response with `stale: true` flag) |
| Snippet template divergence between frontend TypeScript and backend JSON | Medium | Single source of truth: `snippet-catalog-data.json` consumed by both; CI test verifies parity |
| XSS via custom notes if sanitiser is insufficient | High | Sanitiser rejects all HTML tags at write time; content stored as plain text; React rendering via `{content}` (not `dangerouslySetInnerHTML`) prevents stored XSS |
| Audit flood if documentation page is auto-refreshed frequently | Low | `workspace_doc_access_log` unique index per (workspace, actor, date) prevents repeated Kafka events |
| T01 (webhooks) not yet deployed when docs page renders | Low | `enabledServices` conditionally includes webhooks only when `effective-capabilities` reports it enabled; no hard T01 dependency |
| Migration running against wrong schema/database in multi-service setup | Medium | Migration file scoped to `workspace_docs_service` schema with explicit `SET search_path`; tested in CI against fresh DB |

---

## Security Considerations

- **No secrets in responses**: `authInstructions` contains only placeholder strings and public metadata (token endpoint URL, scope). Actual client secrets, DB passwords, and API keys are never returned.
- **Tenant isolation**: All DB queries include `tenant_id` and `workspace_id` clauses. Action verifies context headers are present; aborts with 403 if missing.
- **Role enforcement**: Note CRUD enforces `workspace_admin` / `workspace_owner` roles from `X-Actor-Roles` context header.
- **Input validation**: Custom note content: max 4096 characters, stripped of HTML/control characters at write time.
- **APISIX auth**: Routes registered with `gatewayAuthMode: bearer_oidc`; unauthenticated requests blocked at gateway before reaching the action.

---

## Observability

- **Kafka event**: `console.workspace.docs.accessed` — schema in `services/internal-contracts/src/workspace-docs-accessed-event.json`

  ```json
  {
    "eventType": "workspace.docs.accessed",
    "workspaceId": "...",
    "tenantId": "...",
    "actorId": "...",
    "accessDate": "2026-03-30",
    "correlationId": "..."
  }
  ```

- **Structured logs**: Action logs `doc_assembly_duration_ms`, `upstream_capabilities_latency_ms`, `upstream_api_surface_latency_ms` at INFO level.
- **Existing Kafka audit pipeline**: Reuses `console.audit` topic + schema envelope; no new topic required.

---

## Rollback Plan

- No destructive schema changes. The 2 new tables (`workspace_doc_notes`, `workspace_doc_access_log`) can be dropped cleanly with no impact on existing functionality.
- Router change is additive (new path, no modification to existing routes).
- OpenWhisk action is a new registration; disabling it reverts the feature without side effects.
- APISIX route registration can be reverted by removing the fragment from `workspace-docs.openapi.json` and re-applying gateway config.

---

## Dependencies and Parallelisation

| Dependency | Status | Notes |
|---|---|---|
| `GET /v1/workspaces/{workspaceId}/api-surface` | ✅ Existing | Already registered in public-route-catalog.json |
| `GET /v1/workspaces/{workspaceId}/effective-capabilities` | ✅ Existing | Already registered; returns capability list |
| `ConnectionSnippets` component (spec 065) | ✅ Existing | Reused as-is for snippet rendering |
| T01 (webhooks endpoints queryable) | ⚠️ Soft dependency | Webhooks section shown conditionally on capability flag |
| T02 (scheduling endpoints queryable) | ⚠️ Soft dependency | Scheduling section shown conditionally on capability flag |

**Parallelisable sub-tasks**:
- Backend service + migration (independent of frontend)
- Frontend components + API client (can be developed against mocked API response)
- Gateway route registration (can be done once action is registered in OpenWhisk)

---

## Criteria of Done

| # | Criterion | Verification |
|---|---|---|
| DoD-1 | `GET /v1/workspaces/{workspaceId}/docs` returns `WorkspaceDocsResponse` with correct base URL, enabled services, and pre-filled snippets | API call with a workspace that has PG + storage enabled; inspect response |
| DoD-2 | Response omits services not enabled for the workspace | Workspace with only PG enabled: response has 0 `storage-bucket` entries |
| DoD-3 | Sensitive values are placeholders in all code snippets | Assert `hasPlaceholderSecrets: true` for PG/Mongo/storage snippets; no real passwords in response |
| DoD-4 | `workspace_doc_notes` persists admin notes; notes appear in docs response | Create note as admin → GET docs → note in `customNotes` |
| DoD-5 | Non-admin (viewer) cannot create/edit/delete notes | POST /docs/notes with viewer token → 403 |
| DoD-6 | Custom note content is sanitised at write time | Insert note with `<script>alert(1)</script>` → GET docs → content is stripped |
| DoD-7 | `workspace_doc_access_log` has at most 1 row per (workspace, actor, calendar day) | Call GET docs 5 times same day → 1 row in access_log; Kafka audit has 1 event |
| DoD-8 | `ConsoleDocsPage` renders all enabled service sections with copy-to-clipboard working | E2E Playwright test passes |
| DoD-9 | Documentation page content updates within 30s of workspace capability change | Manual validation: enable realtime → refresh page ≤ 30s later → realtime section appears |
| DoD-10 | All unit and integration tests pass in CI from repo root | `pnpm test --filter workspace-docs-service` exits 0 |
| DoD-11 | Helm chart deploys without error on a clean Kubernetes namespace | `helm install workspace-docs-service charts/workspace-docs-service` succeeds |
| DoD-12 | `plan.md`, `data-model.md`, `contracts/`, and `quickstart.md` are committed on feature branch | Git log shows all plan artifacts in `specs/087-workspace-docs-generation/` |

---

## Complexity Tracking

No constitution violations. No complexity justification required.

---

*Plan generated by speckit.plan for US-DX-02-T03 on 2026-03-30.*
