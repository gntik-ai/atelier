# Tasks: Per-Workspace Developer Documentation Generation

**Feature Branch**: `087-workspace-docs-generation`  
**Task ID**: US-DX-02-T03 | **Epic**: EP-17 | **Story**: US-DX-02  
**Input**: Design documents from `specs/087-workspace-docs-generation/`  
**Prerequisites**: `plan.md` ✅ `spec.md` ✅  
**Generated**: 2026-03-30

## Format: `[ID] [P?] [Story] Description — file-path`

- **[P]**: Can run in parallel (different files, no shared dependencies on incomplete tasks)
- **[Story]**: Maps to spec.md user story (US1–US4)
- Every task includes an exact file path

## File Path Map (Implementation Reference)

```text
services/workspace-docs-service/
  package.json
  src/
    config.mjs
    doc-assembler.mjs
    doc-audit.mjs
    note-repository.mjs
    note-sanitiser.mjs
    snippet-context-builder.mjs
  actions/
    workspace-docs.mjs
  migrations/
    087-workspace-doc-notes.sql
  tests/
    doc-assembler.test.mjs
    doc-audit.test.mjs
    note-repository.test.mjs
    note-sanitiser.test.mjs
    workspace-docs.action.test.mjs
    workspace-docs.integration.test.mjs

apps/web-console/src/
  lib/
    console-workspace-docs.ts
  components/console/
    WorkspaceDocAuthSection.tsx
    WorkspaceDocSections.tsx
    WorkspaceDocNotes.tsx
  pages/
    ConsoleDocsPage.tsx
  e2e/
    workspace-docs.spec.ts
  __tests__/
    ConsoleDocsPage.test.tsx
    WorkspaceDocSections.test.tsx
    WorkspaceDocNotes.test.tsx

services/internal-contracts/src/
  snippet-catalog-data.json
  workspace-docs-response.json
  workspace-doc-note.json
  workspace-docs-accessed-event.json

services/gateway-config/openapi-fragments/
  workspace-docs.openapi.json

services/gateway-config/
  public-route-catalog.json              ← append 4 new routes

charts/workspace-docs-service/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    secret.yaml
    configmap.yaml
```

---

## Phase 1: Setup (Service Scaffold)

**Purpose**: Establish the `workspace-docs-service` package and shared configuration so all subsequent backend tasks have a valid module to work in.

- [ ] T001 Create `services/workspace-docs-service/package.json` with `"type": "module"`, `name: "@falcone/workspace-docs-service"`, and peer dependencies `pg`, `kafkajs` (mirrors `services/webhook-engine/package.json` layout)
- [ ] T002 Create `services/workspace-docs-service/src/config.mjs` exporting `WORKSPACE_DOCS_DB_URL`, `KAFKA_BROKERS`, `INTERNAL_API_BASE_URL`, `WORKSPACE_DOCS_NOTE_MAX_LENGTH` (default 4096) from `process.env` with validation guards
- [ ] T003 [P] Extract shared snippet template data into `services/internal-contracts/src/snippet-catalog-data.json` — a JSON array of `{ id, serviceKey, language, label, codeTemplate, placeholders[] }` records covering all 7 capability types defined in plan.md (postgres-database, mongo-collection, storage-bucket, serverless-function, realtime-subscription, webhooks, scheduling); verify parity with existing `apps/web-console/src/lib/snippets/snippet-catalog.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, shared contracts, and gateway skeleton that all user-story phases depend on. No user story work can start until this phase is complete.

**⚠️ CRITICAL**: T004 (migration), T005 (JSON Schema contracts), and T007 (action skeleton) must be complete before any US1–US4 implementation tasks.

- [ ] T004 Create `services/workspace-docs-service/migrations/087-workspace-doc-notes.sql` with DDL for `workspace_doc_notes` (id UUID PK, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, content TEXT NOT NULL, author_id TEXT NOT NULL, created_at/updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ) and `workspace_doc_access_log` (workspace_id TEXT, actor_id TEXT, access_date DATE, PRIMARY KEY (workspace_id, actor_id, access_date)) plus their indexes; prefix with `SET search_path TO workspace_docs_service` (no cross-schema dependency)
- [ ] T005 [P] Create JSON Schema files in `services/internal-contracts/src/`: `workspace-docs-response.json` (full `WorkspaceDocsResponse` shape with `workspaceId`, `tenantId`, `generatedAt`, `baseUrl`, `authInstructions`, `enabledServices[]`, `customNotes[]`), `workspace-doc-note.json` (`noteId`, `content`, `authorId`, `createdAt`, `updatedAt`), and `workspace-docs-accessed-event.json` (`eventType`, `workspaceId`, `tenantId`, `actorId`, `accessDate`, `correlationId`)
- [ ] T006 [P] Create `services/gateway-config/openapi-fragments/workspace-docs.openapi.json` registering 4 APISIX routes (`GET /v1/workspaces/{workspaceId}/docs`, `POST /v1/workspaces/{workspaceId}/docs/notes`, `PUT /v1/workspaces/{workspaceId}/docs/notes/{noteId}`, `DELETE /v1/workspaces/{workspaceId}/docs/notes/{noteId}`) with `gatewayAuthMode: bearer_oidc` and context-header injection pattern matching existing fragments
- [ ] T007 Create `services/workspace-docs-service/actions/workspace-docs.mjs` — OpenWhisk action entry point with `export async function main(params)` that dispatches by `params.method` + `params.path` to stub handlers returning `{ statusCode: 501 }` for each of the 4 routes; validates presence of `X-Tenant-Id`, `X-Workspace-Id`, `X-Actor-Roles` context headers and returns 403 if missing (mirrors `webhook-management.mjs` dispatch pattern)
- [ ] T008 [P] Append 4 new route entries to `services/gateway-config/public-route-catalog.json` under family `workspaces`, `downstreamService: workspace_docs_service`, covering the same 4 routes as T006 with audiences `developer_external`, `workspace_owner`, `workspace_admin`, `workspace_viewer` for GET and `workspace_admin`, `workspace_owner` for POST/PUT/DELETE

**Checkpoint**: Migration can be applied, contracts exist, gateway skeleton is registered, action entry point compiles — user story phases can begin.

---

## Phase 3: User Story 1 — View Workspace Documentation Page (Priority: P1) 🎯 MVP

**Goal**: A workspace member navigates to `/workspaces/:workspaceId/docs` in the console and sees the workspace's base URL, authentication instructions, and a list of all currently enabled services (no disabled services shown), all derived from live workspace state.

**Independent Test**: With a workspace that has PostgreSQL and storage enabled (realtime disabled), navigating to the docs page shows base URL, auth instructions, PostgreSQL section, and storage section — but no realtime section. Refreshing after enabling realtime causes it to appear within 30 seconds.

- [ ] T009 [US1] Implement `services/workspace-docs-service/src/snippet-context-builder.mjs` — exports `buildSnippetContexts(apiSurface, effectiveCapabilities)` that maps each capability entry to a `SnippetContext` object using the 7-type mapping table from plan.md (postgres-database → host/port/resourceName, mongo-collection → host/port/resourceExtraA, storage-bucket → host/resourceName/resourceExtraA region, serverless-function → host/resourceName, realtime-subscription → host WS URL, webhooks → `${baseUrl}/v1/webhooks`, scheduling → `${baseUrl}/v1/schedules`); reads templates from `services/internal-contracts/src/snippet-catalog-data.json`
- [ ] T010 [US1] Implement `services/workspace-docs-service/src/doc-assembler.mjs` — exports `assembleWorkspaceDocs(ctx, db, internalClient)` that: (1) fetches `GET /v1/workspaces/{id}/api-surface` and `GET /v1/workspaces/{id}/effective-capabilities` in parallel with a 2-second timeout, (2) calls `buildSnippetContexts`, (3) loads active custom notes via `listNotes`, (4) builds and returns a `WorkspaceDocsResponse` conforming to `workspace-docs-response.json`; on upstream 404 → propagates as 404; on timeout/503 → returns `{ stale: true, ... }` with available partial data
- [ ] T011 [P] [US1] Implement `services/workspace-docs-service/src/doc-audit.mjs` — exports `recordAccess(db, kafkaProducer, workspaceId, actorId, correlationId)` that executes `INSERT INTO workspace_doc_access_log ... ON CONFLICT DO NOTHING` and, when the insert writes 1 row (first access of the day), publishes a `workspace-docs-accessed-event` to the existing `console.audit` Kafka topic using the `observability-audit-event-schema.json` envelope
- [ ] T012 [US1] Wire `GET /v1/workspaces/{workspaceId}/docs` in `services/workspace-docs-service/actions/workspace-docs.mjs` — replace stub with real handler that calls `assembleWorkspaceDocs` and `recordAccess`; enforces `workspace_viewer` or higher role; returns `WorkspaceDocsResponse` JSON with `Content-Type: application/json`; maps assembler errors to 403/404/503 with `{ code, message }` bodies
- [ ] T013 [P] [US1] Create `apps/web-console/src/components/console/WorkspaceDocAuthSection.tsx` — renders `authInstructions` from `WorkspaceDocsResponse` using shadcn/ui `Card`; displays `tokenEndpoint`, `clientIdPlaceholder`, `scopeHint`, and `consoleRef` as a formatted guide; never renders raw secrets; accepts `authInstructions: WorkspaceDocsResponse['authInstructions']` prop
- [ ] T014 [P] [US1] Create `apps/web-console/src/lib/console-workspace-docs.ts` — exports `fetchWorkspaceDocs(workspaceId: string, token: string): Promise<WorkspaceDocsResponse>` using the existing `apps/web-console/src/lib/http.ts` fetch wrapper; also exports `createDocNote`, `updateDocNote`, `deleteDocNote` stubs (typed, throw `NotImplemented` until US4)
- [ ] T015 [P] [US1] Create `apps/web-console/src/components/console/WorkspaceDocSections.tsx` — receives `enabledServices: WorkspaceDocsResponse['enabledServices']`; renders each service as a collapsible shadcn/ui `Accordion` panel with category badge, endpoint URL, and port; renders "No services enabled yet" empty state with link to workspace settings when array is empty; uses React Query `staleTime: 20_000` via parent
- [ ] T016 [US1] Create `apps/web-console/src/pages/ConsoleDocsPage.tsx` — main page component that: (1) calls `fetchWorkspaceDocs` with React Query (`staleTime: 20_000`), (2) renders loading skeleton, (3) composes `WorkspaceDocAuthSection` + `WorkspaceDocSections` + `WorkspaceDocNotes` (stub), (4) shows breadcrumb, `generatedAt` timestamp, and manual Refresh button that invalidates the React Query cache; reads `workspaceId` from route params
- [ ] T017 [US1] Register route `workspaces/:workspaceId/docs` in `apps/web-console/src/router.tsx` pointing to `<ConsoleDocsPage />`; add "Documentation" navigation link in workspace sidebar menu at the same level as existing workspace nav items (follow pattern of `ConsoleRealtimePage` link)

---

## Phase 4: User Story 2 — Copy Pre-Filled Code Examples (Priority: P1)

**Goal**: Each enabled service section shows at least one contextualised code snippet with workspace-specific values pre-filled and sensitive values replaced by descriptive placeholders. A "Copy" button copies the full snippet and shows transient confirmation.

**Independent Test**: PostgreSQL section shows a connection URI with actual host/port/dbname pre-filled and `<YOUR_DB_PASSWORD>` as placeholder; clicking Copy places the full URI on the clipboard; at least 3 language variants (e.g., URI, Node.js, Python) are available.

- [ ] T018 [US2] Extend `services/workspace-docs-service/src/snippet-context-builder.mjs` to substitute workspace-specific values from `SnippetContext` into code templates from `snippet-catalog-data.json` and produce rendered snippet strings; mark `hasPlaceholderSecrets: true` and populate `secretPlaceholderRef` for all service types that require credentials (postgres-database, mongo-collection, storage-bucket); ensure all 7 capability types produce at least 1 rendered snippet
- [ ] T019 [P] [US2] Extend `apps/web-console/src/components/console/WorkspaceDocSections.tsx` to render snippets inside each service panel using the existing `ConnectionSnippets` component (from spec 065) — pass the `snippets[]` array from each `enabledServices` entry; add a "Copy" `<Button>` per snippet that calls `navigator.clipboard.writeText(code)` and toggles a transient "Copied ✓" label for 2 seconds via local state
- [ ] T020 [P] [US2] Add language/tool tab selector to each service snippet group in `apps/web-console/src/components/console/WorkspaceDocSections.tsx` — when a service has multiple snippets with distinct `label` values (e.g., "Node.js", "Python", "Go"), render shadcn/ui `Tabs` with one tab per language; default to first available tab; preserve selected tab in `sessionStorage` key `docs-snippet-tab-${serviceKey}`

---

## Phase 5: User Story 3 — Retrieve Documentation via API (Priority: P2)

**Goal**: An authenticated caller can `GET /v1/workspaces/{workspaceId}/docs` and receive a structured `WorkspaceDocsResponse` JSON body (not HTML) respecting the same auth model as the console, parseable and suitable for automation/codegen.

**Independent Test**: Calling the endpoint with a valid bearer token for a workspace viewer returns HTTP 200 with a JSON body that validates against `workspace-docs-response.json`; calling with no token returns 401 at the gateway; calling with a token lacking workspace access returns 403 from the action.

- [ ] T021 [US3] Add contract validation test in `services/workspace-docs-service/tests/workspace-docs.action.test.mjs` — import `workspace-docs-response.json` schema, call the action's GET handler with a mocked `internalClient`, and assert the response body validates with `ajv`; cover: (a) workspace with 2 enabled services, (b) workspace with 0 services, (c) upstream `effective-capabilities` returns 503 → action returns `{ statusCode: 503, body: { code: "UPSTREAM_UNAVAILABLE" } }`
- [ ] T022 [P] [US3] Harden error handling in `services/workspace-docs-service/actions/workspace-docs.mjs` GET handler — map all assembler error cases to proper HTTP status codes: `WORKSPACE_NOT_FOUND` → 404, `INSUFFICIENT_PERMISSIONS` → 403, upstream timeout → 503 with `{ code: "UPSTREAM_UNAVAILABLE" }`, unexpected errors → 500 with safe message; add `X-Correlation-Id` passthrough from params to response headers
- [ ] T023 [P] [US3] Add `X-API-Version: 2026-03-01` validation in `services/workspace-docs-service/actions/workspace-docs.mjs` — reject requests with unsupported API version headers with `{ statusCode: 400, body: { code: "UNSUPPORTED_API_VERSION" } }`; document accepted version in `services/gateway-config/openapi-fragments/workspace-docs.openapi.json` operation description

---

## Phase 6: User Story 4 — Workspace Admin Customises Documentation Notes (Priority: P3)

**Goal**: A workspace admin can create, edit, and delete custom notes that appear on the documentation page. Non-admins see notes in read-only mode. All note content is sanitised at write time.

**Independent Test**: Admin POSTs a note with content `"Contact platform-team for staging credentials."` → 201 response → GET docs shows note in `customNotes[]`. Admin POSTs a note with `<script>alert(1)</script>` → stored content has script tag stripped. Workspace viewer POSTs to notes endpoint → 403.

- [ ] T024 [US4] Implement `services/workspace-docs-service/src/note-sanitiser.mjs` — exports `sanitise(content: string): string` that strips all HTML tags (regex `/<[^>]+>/g`), replaces `&lt;`/`&gt;`/`&amp;` entities with plain chars, removes ASCII control characters (`\x00-\x1F` excluding `\n\t`), trims whitespace, and throws `INVALID_NOTE_CONTENT` if result is empty or exceeds `WORKSPACE_DOCS_NOTE_MAX_LENGTH` characters
- [ ] T025 [P] [US4] Implement `services/workspace-docs-service/src/note-repository.mjs` — exports `insertNote(db, tenantId, workspaceId, authorId, sanitisedContent)`, `updateNote(db, tenantId, workspaceId, noteId, sanitisedContent)`, `softDeleteNote(db, tenantId, workspaceId, noteId)`, `listNotes(db, tenantId, workspaceId)` — all queries include `WHERE tenant_id = $1 AND workspace_id = $2` clauses; `updateNote` and `softDeleteNote` return `null` if note not found (for 404 mapping); `listNotes` filters `WHERE deleted_at IS NULL`
- [ ] T026 [US4] Wire notes CRUD in `services/workspace-docs-service/actions/workspace-docs.mjs` — implement `POST /docs/notes` (role check: `workspace_admin | workspace_owner`, call `sanitise` then `insertNote`, return 201 with `WorkspaceDocNote`), `PUT /docs/notes/:noteId` (same role check, `sanitise` + `updateNote`, return 200 or 404), `DELETE /docs/notes/:noteId` (same role check, `softDeleteNote`, return 204 or 404); return 422 `INVALID_NOTE_CONTENT` on sanitiser throw; return 403 `FORBIDDEN` on insufficient role
- [ ] T027 [P] [US4] Create `apps/web-console/src/components/console/WorkspaceDocNotes.tsx` — accepts `notes: WorkspaceDocNote[]`, `workspaceId: string`, `isAdmin: boolean`, and mutation callbacks; when `isAdmin=true`: renders a shadcn/ui `Textarea` for new note with "Add note" submit button, and Edit/Delete actions per existing note (optimistic update with rollback on error); when `isAdmin=false`: renders notes in read-only `<p>` blocks; calls `createDocNote`/`updateDocNote`/`deleteDocNote` from `console-workspace-docs.ts`; implement the previously-stubbed exports in `apps/web-console/src/lib/console-workspace-docs.ts`
- [ ] T028 [P] [US4] Add role-based notes section integration to `apps/web-console/src/pages/ConsoleDocsPage.tsx` — pass `isAdmin` prop derived from workspace role context (same pattern as other role-gated console sections); position `WorkspaceDocNotes` below `WorkspaceDocSections` in page layout

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Tests, Helm chart, and final operational wiring. Parallelisable across backend/frontend/infra workstreams.

- [ ] T029 [P] Create backend unit tests `services/workspace-docs-service/tests/note-sanitiser.test.mjs` — test: strips `<script>alert(1)</script>`, strips `<img onerror="...">`, passes clean text unchanged, rejects empty post-strip with `INVALID_NOTE_CONTENT`, rejects content exceeding `WORKSPACE_DOCS_NOTE_MAX_LENGTH`
- [ ] T030 [P] Create backend unit tests `services/workspace-docs-service/tests/doc-assembler.test.mjs` — mock `internalClient` to return: (a) api-surface + 2 capabilities → verify response shape, (b) api-surface + 0 capabilities → `enabledServices: []`, (c) api-surface upstream 503 → assembler propagates error with `stale: true`
- [ ] T031 [P] Create backend unit tests `services/workspace-docs-service/tests/note-repository.test.mjs` — using `pg` against a local test database (Docker-in-test): insert note, list notes, update note, soft-delete note, verify cross-tenant isolation (listNotes for tenant A does not return tenant B notes)
- [ ] T032 [P] Create backend integration test `services/workspace-docs-service/tests/workspace-docs.integration.test.mjs` — end-to-end against real test PostgreSQL DB: (1) create note as admin → list → update → soft-delete cycle, (2) `workspace_doc_access_log` dedup: call `recordAccess` 5 times same day same actor → exactly 1 row in log, 1 Kafka event emitted; uses `node:test` runner
- [ ] T033 [P] Create frontend unit tests `apps/web-console/src/__tests__/WorkspaceDocSections.test.tsx` (Vitest) — renders loading state, renders service panels for mocked `enabledServices`, renders empty state when `enabledServices: []`, copy button triggers `navigator.clipboard.writeText` with correct code string
- [ ] T034 [P] Create frontend unit tests `apps/web-console/src/__tests__/WorkspaceDocNotes.test.tsx` (Vitest) — admin sees textarea + add button, viewer sees read-only blocks, optimistic add renders note immediately, on API error rolls back to previous state
- [ ] T035 [P] Create frontend unit tests `apps/web-console/src/__tests__/ConsoleDocsPage.test.tsx` (Vitest) — renders skeleton during loading, renders all 3 sections on successful fetch, renders error state on fetch failure, Refresh button invalidates React Query cache
- [ ] T036 [P] Create Playwright E2E smoke test `apps/web-console/e2e/workspace-docs.spec.ts` — 4 scenarios: (1) navigate to docs page → base URL visible, (2) click Copy on first snippet → clipboard content matches snippet code, (3) admin adds note → note visible in viewer session, (4) admin deletes note → note disappears
- [ ] T037 Create Helm chart `charts/workspace-docs-service/Chart.yaml` (name, version, appVersion), `charts/workspace-docs-service/values.yaml` (image, replicas, env placeholders), and `charts/workspace-docs-service/templates/deployment.yaml` + `secret.yaml` (`WORKSPACE_DOCS_DB_URL`, `KAFKA_BROKERS`, `INTERNAL_API_BASE_URL` from K8s Secret ref) + `configmap.yaml` (non-sensitive vars); mirror `services/webhook-engine` Helm layout
- [ ] T038 [P] Add `workspace-docs-service` test script to pnpm workspace root `package.json` scripts section so `pnpm test --filter workspace-docs-service` exercises all `node:test` files under `services/workspace-docs-service/tests/`

---

## Dependencies Graph

```text
Phase 1 (T001–T003)
  └── Phase 2 (T004–T008)
        ├── Phase 3: US1 (T009–T017)  ← MVP — deliver first
        │     └── Phase 4: US2 (T018–T020)  ← builds on US1 components
        │           └── Phase 5: US3 (T021–T023)  ← hardens US1 API
        │                 └── Phase 6: US4 (T024–T028)  ← extends US1 with notes
        │                       └── Phase 7: Polish (T029–T038)
        └── T006, T008 [P] with T005
```

**Parallelisable within phases**:
- Phase 3: Backend (T009–T012) parallel with Frontend scaffolding (T013–T015) — join at T016 (ConsoleDocsPage)
- Phase 6: Backend notes (T024–T026) parallel with Frontend notes (T027–T028) — join at action integration test
- Phase 7: All test tasks (T029–T036) fully parallel; T037 (Helm) parallel with all tests

---

## Parallel Execution Examples

**Sprint Day 1–2** (Phase 1 + 2, all parallel-safe):
- Agent A: T001 → T002 → T004 (service scaffold + migration)
- Agent B: T003 → T005 (contracts + snippet catalog)
- Agent C: T006 → T008 (gateway + route catalog)
- Agent D: T007 (action skeleton)

**Sprint Day 3–5** (Phase 3 — US1 MVP):
- Agent A: T009 → T010 → T011 → T012 (backend assembler pipeline)
- Agent B: T013 + T014 + T015 (frontend components in parallel) → T016 → T017

**Sprint Day 6–7** (Phase 4 + 5 — US2 + US3):
- Agent A: T018 → T021 → T022 → T023 (snippets + API hardening)
- Agent B: T019 + T020 (frontend snippet rendering in parallel)

**Sprint Day 8–9** (Phase 6 — US4):
- Agent A: T024 → T025 → T026 (sanitiser + repository + action CRUD)
- Agent B: T027 → T028 (frontend notes component)

**Sprint Day 10** (Phase 7 — all parallel):
- T029–T036 (all test files, fully parallel)
- T037 (Helm chart)
- T038 (root pnpm script)

---

## Implementation Strategy

**MVP Scope** (deliver independently): Phase 1 + 2 + Phase 3 (T001–T017)

MVP delivers: workspace docs page with base URL, auth instructions, enabled services list, and empty notes area. Sufficient for DoD-1, DoD-2, DoD-3, DoD-8.

**Increment 2**: Phase 4 (T018–T020) — adds pre-filled copy-to-clipboard snippets (DoD-3 fully).

**Increment 3**: Phase 5 (T021–T023) — hardens API contract for automation use (DoD-1 formally verified).

**Increment 4**: Phase 6 (T024–T028) — admin custom notes (DoD-4, DoD-5, DoD-6).

**Increment 5**: Phase 7 (T029–T038) — full test suite + Helm chart (DoD-10, DoD-11).

---

## Summary

| Metric | Count |
|--------|-------|
| Total tasks | 38 |
| Phase 1 (Setup) | 3 |
| Phase 2 (Foundational) | 5 |
| Phase 3 (US1 — P1 MVP) | 9 |
| Phase 4 (US2 — P1) | 3 |
| Phase 5 (US3 — P2) | 3 |
| Phase 6 (US4 — P3) | 5 |
| Phase 7 (Polish) | 10 |
| Parallelisable tasks [P] | 22 |
| Backend tasks | 23 |
| Frontend tasks | 12 |
| Infrastructure/contracts | 3 |

---

*Tasks generated by speckit.tasks for US-DX-02-T03 on 2026-03-30.*
