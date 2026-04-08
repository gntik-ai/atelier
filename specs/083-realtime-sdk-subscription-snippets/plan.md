# Implementation Plan: Realtime SDK Subscription Snippets & Examples

**Branch**: `083-realtime-sdk-subscription-snippets` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/083-realtime-sdk-subscription-snippets/spec.md`  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T05

---

## Summary

Tasks T01–T04 have established the full realtime pipeline: channel/subscription model, PostgreSQL and MongoDB CDC bridges to Kafka, and authorization/scope/filter enforcement. **This task makes that pipeline consumable by external developers** by delivering:

1. A **Realtime Snippets panel** embedded in the administrative console's workspace realtime section — contextualised with the active workspace's endpoint, ID, and provisioned channel types.
2. **Snippet templates** covering JavaScript (browser), Node.js (backend), and Python (backend) — each demonstrating authentication, subscription, filtering, reconnection with backoff, and token refresh.
3. **Developer documentation guides** published to the platform docs site — standalone, with prerequisites, endpoint discovery, common error codes, and troubleshooting.
4. **Automated syntax-validity validation** of all snippet templates as part of the CI pipeline, preventing drift between API contracts and examples.

The implementation extends the existing snippet infrastructure from `065-connection-snippets` (`apps/web-console/src/lib/snippets/`, `ConnectionSnippets.tsx`) rather than introducing a parallel system, ensuring UI consistency and minimising surface area.

---

## Technical Context

**Language/Runtime (frontend)**: TypeScript, React 18, Tailwind CSS + shadcn/ui (`apps/web-console`)  
**Language/Runtime (backend)**: Node.js 20+ ESM (`services/realtime-gateway/`, OpenWhisk actions)  
**Existing infrastructure reused**:
- `apps/web-console/src/lib/snippets/snippet-types.ts` — `ResourceType`, `SnippetContext`, `SnippetEntry`, `SnippetGroup`
- `apps/web-console/src/lib/snippets/snippet-catalog.ts` — `SNIPPET_CATALOG` keyed by `ResourceType`
- `apps/web-console/src/lib/snippets/snippet-generator.ts` — `generateSnippets(resourceType, context)`
- `apps/web-console/src/components/console/ConnectionSnippets.tsx` — snippet panel UI with copy-to-clipboard
- `services/realtime-gateway/` — existing auth/filter/session infrastructure from T01–T04

**Testing**: Vitest + `@testing-library/react` (console); `node:test` (backend scripts)  
**Target Platform**: Kubernetes / OpenShift via Helm; pnpm monorepo  
**Performance goal**: Snippet panel renders in < 2 s (pure client-side generation, no new network call)  
**Constraints**: No real tokens or secrets in any snippet or guide; injection-safe template rendering; ARIA-accessible code blocks; snippet templates are the single source of truth shared by console and docs.

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I — Monorepo Separation | ✅ PASS | New realtime types and templates extend existing `lib/snippets/`; new console page under `apps/web-console`; docs under `docs/guides/` |
| II — Incremental Delivery | ✅ PASS | Snippet panel is purely additive; no existing component modified destructively |
| III — K8s/OpenShift Compatibility | ✅ PASS | Frontend-only change; no new service or Helm chart required |
| IV — Quality Gates at Root | ✅ PASS | Tests runnable via `pnpm test` at root; snippet lint script registered in CI |
| V — Docs as Part of Change | ✅ PASS | Documentation guides are deliverables of this task, committed in `docs/guides/realtime/` |
| Secrets not committed | ✅ PASS | All token fields use `<YOUR_ACCESS_TOKEN>` placeholder; enforced by template lint |
| pnpm workspaces | ✅ PASS | No new package; extends existing workspace packages |

**No violations — proceed.**

---

## Project Structure

### New artifacts

```text
specs/083-realtime-sdk-subscription-snippets/
├── plan.md              ← This file
└── tasks.md             ← /speckit.tasks output (NOT created here)

apps/web-console/src/
├── lib/snippets/
│   ├── snippet-types.ts              ← EXTEND: add 'realtime-subscription' ResourceType
│   ├── snippet-catalog.ts            ← EXTEND: add REALTIME_SUBSCRIPTION entry
│   ├── snippet-generator.ts          ← EXTEND: add {WORKSPACE_ID}, {REALTIME_ENDPOINT}, {CHANNEL_TYPE} tokens
│   ├── snippet-catalog.test.ts       ← EXTEND: add realtime subscription template assertions
│   └── snippet-generator.test.ts     ← EXTEND: add context-fill tests for new tokens
├── components/console/
│   ├── snippets/
│   │   └── RealtimeSnippetsPanel.tsx          ← NEW: wrapper panel with language selector + no-capability guard
│   │   └── RealtimeSnippetsPanel.test.tsx     ← NEW: unit tests
│   └── ConnectionSnippets.tsx                 ← NO CHANGE (reused as-is)
└── pages/
    └── ConsoleRealtimePage.tsx                ← NEW: workspace realtime section; integrates <RealtimeSnippetsPanel>
    └── ConsoleRealtimePage.test.tsx           ← NEW: page-level tests

docs/guides/realtime/
├── index.md                         ← NEW: navigation entry for realtime quick-start guides
├── frontend-quickstart.md           ← NEW: JavaScript/TypeScript browser subscription guide
├── nodejs-quickstart.md             ← NEW: Node.js backend subscription guide
└── python-quickstart.md             ← NEW: Python backend subscription guide

scripts/
└── lint-snippet-templates.mjs       ← NEW: Node.js 20+ ESM script; syntax-validates all snippet templates
```

### Artifacts modified

```text
apps/web-console/src/lib/snippets/snippet-types.ts     ← add ResourceType 'realtime-subscription'
apps/web-console/src/lib/snippets/snippet-catalog.ts   ← add SNIPPET_CATALOG['realtime-subscription']
apps/web-console/src/lib/snippets/snippet-generator.ts ← add {WORKSPACE_ID}, {REALTIME_ENDPOINT}, {CHANNEL_TYPE} token handlers
```

---

## Phase 0: Research & Decisions

### Decision 1 — Reuse vs. new snippet infrastructure

**Decision**: Extend the existing `snippet-catalog / snippet-generator / ConnectionSnippets` system from `065-connection-snippets`. Add `'realtime-subscription'` as a new `ResourceType`.

**Rationale**: The catalog/generator pattern already handles template filling, placeholder notes, secret masking, clipboard copy, and accessibility. Reusing it avoids UI divergence and keeps DX consistent across all resource types.

**Impact**: `snippet-types.ts` gains one new union member; `snippet-catalog.ts` gains a new catalog entry; `snippet-generator.ts` gains three new context tokens. `ConnectionSnippets.tsx` is used as-is inside `RealtimeSnippetsPanel.tsx`.

---

### Decision 2 — New context tokens for realtime

**Decision**: Introduce three new template tokens beyond the existing set:

| Token | Filled from | Fallback |
|-------|-------------|---------|
| `{REALTIME_ENDPOINT}` | `context.resourceHost` (reuses existing field, semantics: realtime WebSocket/SSE base URL) | `<REALTIME_ENDPOINT>` |
| `{WORKSPACE_ID}` | `context.workspaceId` | `<WORKSPACE_ID>` |
| `{CHANNEL_TYPE}` | `context.resourceExtraA` (first provisioned channel type, e.g. `postgresql-changes`) | `<CHANNEL_TYPE>` |

**Rationale**: No new fields added to `SnippetContext` — existing fields (`resourceHost`, `workspaceId`, `resourceExtraA`) map cleanly to the three realtime-specific placeholders. Token names in templates are self-documenting.

---

### Decision 3 — Transport protocol (WebSocket vs. SSE)

**Decision**: Snippets target **WebSocket** as the primary transport (consistent with T01 architecture choice). An SSE variant is included only as a `codeTemplate` comment line noting it as an alternative, not as a separate snippet entry. This matches OQ1 resolution in the spec.

**Rationale**: Minimises the snippet count at launch while documenting the alternative. SSE-specific snippets can be added as a fast follow-up once T01 confirms SSE support in production.

---

### Decision 4 — Language selector state management

**Decision**: Language selection state lives in `RealtimeSnippetsPanel.tsx` local state (`useState`). The selected language is also persisted to `sessionStorage` under key `realtime-snippet-lang` so it survives page navigation within the same session (per FR-014).

**Rationale**: No global store needed; session-scoped persistence satisfies the spec requirement without introducing prop drilling or context changes.

---

### Decision 5 — No-capability guard

**Decision**: When the workspace has no provisioned data sources or `context.resourceState` indicates realtime is not available, `RealtimeSnippetsPanel.tsx` renders a descriptive `<Alert>` (shadcn/ui) instead of snippets. It links to provisioning documentation. No broken or misleading snippets are shown (per FR-010).

**Rationale**: The guard check is: `context.resourceExtraA == null || context.resourceState === 'unavailable'`. If `context.resourceExtraA` is null, `generateSnippets` would produce only placeholder-filled templates, which is confusing rather than useful.

---

### Decision 6 — Documentation guide format

**Decision**: Guides are Markdown files in `docs/guides/realtime/`. Each guide is self-contained (prerequisites → endpoint discovery → authentication → subscription snippet → filter example → reconnection example → common errors). Snippet code blocks are duplicated from the catalog templates with real placeholder names substituted, maintained in sync by the lint script (see Decision 7).

**Rationale**: Static Markdown is the existing docs authoring format. The lint script detects drift between catalog templates and guide code blocks.

---

### Decision 7 — Snippet lint script

**Decision**: A Node.js 20+ ESM script `scripts/lint-snippet-templates.mjs` validates every `codeTemplate` string in `SNIPPET_CATALOG['realtime-subscription']` for syntactic correctness in its target language:
- JavaScript/TypeScript: parsed with `node:vm` `Script` constructor (syntax-only, no execution).
- Python: validated via a heuristic check (balanced brackets, no bare `<` outside string literals) — full Python AST parsing is not available in Node; the script delegates to `python3 -c "import ast; ast.parse(…)"` if `python3` is on PATH, otherwise marks as `WARN`.

The script exits non-zero if any template fails validation. It is registered as a CI step in `.github/workflows/` (or equivalent pipeline config).

---

## Phase 1: Snippet Templates (Catalog Design)

### `SNIPPET_CATALOG['realtime-subscription']` — 9 template entries

The catalog entry covers three categories × three languages.  
Template tokens: `{REALTIME_ENDPOINT}`, `{WORKSPACE_ID}`, `{CHANNEL_TYPE}`, `<YOUR_ACCESS_TOKEN>` (literal placeholder, not a filled token — intentionally opaque).

#### Category A — Basic subscription (3 entries)

**A-1: JavaScript (browser) — WebSocket subscription**

```typescript
{
  id: 'realtime-js-browser-basic',
  label: 'JavaScript (browser) — WebSocket subscription',
  codeTemplate: `// Requires: a valid Keycloak access token for this workspace
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const TOKEN = '<YOUR_ACCESS_TOKEN>'  // replace with your token

const ws = new WebSocket(
  \`\${ENDPOINT}/workspaces/\${WORKSPACE_ID}/realtime/connect\`,
  ['v1.falcone.realtime']
)

ws.addEventListener('open', () => {
  // Subscribe to a channel once the connection is established
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    filter: {}  // no filter — receive all events on this channel
  }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'event') {
    console.log('Received event:', msg.payload)
  }
})

ws.addEventListener('error', (err) => console.error('WebSocket error', err))
ws.addEventListener('close', (e) => console.log('Connection closed', e.code, e.reason))`,
  secretTokens: ['<YOUR_ACCESS_TOKEN>'],
  secretPlaceholderRef: 'Obtain your access token from Keycloak: POST /realms/<realm>/protocol/openid-connect/token'
}
```

**A-2: Node.js (backend) — WebSocket subscription with service-account token**

```typescript
{
  id: 'realtime-nodejs-backend-basic',
  label: 'Node.js (backend) — WebSocket subscription',
  codeTemplate: `// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'  // obtain via client_credentials grant

const ws = new WebSocket(
  \`\${ENDPOINT}/workspaces/\${WORKSPACE_ID}/realtime/connect\`,
  { headers: { Authorization: \`Bearer \${SERVICE_ACCOUNT_TOKEN}\` } }
)

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    filter: {}
  }))
})

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'event') {
    console.log('Event received:', msg.payload)
  }
})

ws.on('error', (err) => console.error('WS error', err))
ws.on('close', (code, reason) => console.log('Closed', code, reason.toString()))`,
  secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
  secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant with your client_id and client_secret.'
}
```

**A-3: Python (backend) — WebSocket subscription**

```typescript
{
  id: 'realtime-python-backend-basic',
  label: 'Python (backend) — WebSocket subscription',
  codeTemplate: `# pip install websockets
import asyncio, json, websockets

ENDPOINT = "{REALTIME_ENDPOINT}"
WORKSPACE_ID = "{WORKSPACE_ID}"
SERVICE_ACCOUNT_TOKEN = "<YOUR_SERVICE_ACCOUNT_TOKEN>"

async def subscribe():
    uri = f"{ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect"
    headers = {"Authorization": f"Bearer {SERVICE_ACCOUNT_TOKEN}"}
    async with websockets.connect(uri, additional_headers=headers) as ws:
        await ws.send(json.dumps({
            "type": "subscribe",
            "channelType": "{CHANNEL_TYPE}",
            "filter": {}
        }))
        async for message in ws:
            msg = json.loads(message)
            if msg.get("type") == "event":
                print("Event:", msg["payload"])

asyncio.run(subscribe())`,
  secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
  secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant.'
}
```

#### Category B — Filtered subscription (3 entries, one per language)

Each template adds a `filter` object to the `subscribe` message: `{ operation: 'INSERT', entity: 'orders' }`, demonstrating the exact filter syntax accepted by the T04 subscription API.

**B-1: JavaScript (browser) — Filtered subscription**  
**B-2: Node.js (backend) — Filtered subscription**  
**B-3: Python (backend) — Filtered subscription**

*(Code structure identical to Category A entries with the filter object populated; not repeated verbatim here to avoid plan verbosity — full template strings live in `snippet-catalog.ts`.)*

#### Category C — Reconnection with backoff + token refresh (3 entries)

**C-1: JavaScript (browser) — Reconnection + token refresh**  

```typescript
{
  id: 'realtime-js-browser-reconnect',
  label: 'JavaScript (browser) — Reconnection with backoff & token refresh',
  codeTemplate: `const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'

let token = '<YOUR_ACCESS_TOKEN>'
let attempt = 0
const MAX_BACKOFF_MS = 30_000

async function refreshToken() {
  // Replace with your token-refresh logic (e.g., Keycloak refresh_token grant)
  const resp = await fetch('/auth/refresh', { method: 'POST' })
  const data = await resp.json()
  return data.access_token
}

function connect() {
  const ws = new WebSocket(
    \`\${ENDPOINT}/workspaces/\${WORKSPACE_ID}/realtime/connect?token=\${encodeURIComponent(token)}\`,
    ['v1.falcone.realtime']
  )

  ws.addEventListener('open', () => {
    attempt = 0
    ws.send(JSON.stringify({ type: 'subscribe', channelType: '{CHANNEL_TYPE}', filter: {} }))
  })

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'event') console.log('Event:', msg.payload)
    if (msg.type === 'token_expired') {
      ws.close(4001, 'token_expired')
    }
  })

  ws.addEventListener('close', async (e) => {
    const backoff = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS)
    attempt++
    if (e.code === 4001) {
      token = await refreshToken()
    }
    setTimeout(connect, backoff)
  })
}

connect()`,
  secretTokens: ['<YOUR_ACCESS_TOKEN>'],
  secretPlaceholderRef: 'Replace refreshToken() with your Keycloak token-refresh implementation.'
}
```

**C-2: Node.js (backend) — Reconnection with backoff**  
**C-3: Python (backend) — Reconnection with backoff**  

*(Same reconnection pattern adapted to `ws` and `websockets` libraries respectively.)*

---

## Phase 2: Frontend — RealtimeSnippetsPanel Component

### `apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.tsx`

**Props interface**:

```typescript
interface RealtimeSnippetsPanelProps {
  workspaceId: string
  realtimeEndpoint: string | null       // null → realtime not provisioned
  channelTypes: string[]                // derived from provisioned data sources
  realtimeEnabled: boolean
}
```

**Behaviour**:
1. If `!realtimeEnabled || channelTypes.length === 0`: render `<Alert variant="info">` explaining realtime requires at least one provisioned data source, with link to provisioning docs. No snippets shown.
2. Otherwise: build a `SnippetContext` with `resourceHost = realtimeEndpoint`, `workspaceId`, `resourceExtraA = channelTypes[0]` (primary channel type shown; secondary types listed as a note).
3. Render a language selector (`<Tabs>` from shadcn/ui) defaulting to `'javascript'`. Persist selection to `sessionStorage` under `realtime-snippet-lang`.
4. For each language tab: filter `generateSnippets('realtime-subscription', context)` entries by language prefix (`id.startsWith('realtime-js-')`, `realtime-nodejs-`, `realtime-python-`).
5. Render `<ConnectionSnippets>` for the selected language's entries — reusing the existing component for code blocks, copy-to-clipboard, and notes rendering.
6. If `channelTypes.length > 1`: render a `<p className="text-sm text-muted-foreground">` note listing the other available channel types and instructing the developer to change `channelType` in the snippet accordingly.

**Accessibility**:
- `<section aria-labelledby="realtime-snippets-heading">` wrapping the panel.
- `<Tabs>` uses `role="tablist"` / `role="tab"` (shadcn/ui default; verify with axe-core in tests).
- Code blocks inherit `<pre><code>` from `ConnectionSnippets.tsx` — already keyboard-navigable and screen-reader-friendly.
- `aria-live="polite"` on the copy confirmation region (delegated to `ConnectionSnippets.tsx` — verify it is already present; add if missing).

### `apps/web-console/src/pages/ConsoleRealtimePage.tsx`

A new page component in the workspace console showing the realtime section. Integrates `<RealtimeSnippetsPanel>` with workspace context data. The page fetches (or receives via props/context) workspace metadata including:
- `realtimeEndpoint` — from workspace config (or APISIX route derived from workspace ID)
- `channelTypes` — derived from provisioned data sources list
- `realtimeEnabled` — whether T01 subscription model is active for this workspace

The page is registered in the console router at `/console/workspaces/:workspaceId/realtime`.

---

## Phase 3: Snippet Token Extension (`snippet-generator.ts`)

Add three new token handlers to `fillTemplate` and `getTokenValue`:

```typescript
// New tokens added to the regex and switch:
// {WORKSPACE_ID}  → context.workspaceId ?? '<WORKSPACE_ID>'
// {REALTIME_ENDPOINT} → context.resourceHost ?? '<REALTIME_ENDPOINT>'
// {CHANNEL_TYPE}  → context.resourceExtraA ?? '<CHANNEL_TYPE>'
```

The `fillTemplate` regex in `snippet-generator.ts` is extended:

```typescript
/\{HOST\}|\{PORT\}|\{RESOURCE_NAME\}|\{RESOURCE_EXTRA_A\}|\{RESOURCE_EXTRA_B\}|\{PASSWORD\}|\{WORKSPACE_ID\}|\{REALTIME_ENDPOINT\}|\{CHANNEL_TYPE\}/g
```

`snippet-types.ts` gains:

```typescript
export type ResourceType =
  | 'postgres-database'
  | 'mongo-collection'
  | 'storage-bucket'
  | 'serverless-function'
  | 'iam-client'
  | 'realtime-subscription'  // NEW
```

---

## Phase 4: Developer Documentation Guides

### `docs/guides/realtime/index.md`

Navigation page listing the three quick-start guides with one-line descriptions. Reachable within 2 clicks from `docs/README.md` (add entry there too).

### `docs/guides/realtime/frontend-quickstart.md`

Structure:
1. **Prerequisites** — platform account, workspace with ≥1 data source, Keycloak access token obtained via Authorization Code flow.
2. **Endpoint discovery** — how to find the realtime endpoint URL in the console or via the workspace API.
3. **Basic subscription** — A-1 snippet with inline annotation.
4. **Applying filters** — B-1 snippet with table of supported filter fields (`operation`, `entity`, `predicates`).
5. **Reconnection & token refresh** — C-1 snippet with explanation of backoff strategy.
6. **Common errors** — table: `4001 token_expired`, `4003 scope_denied`, `4008 quota_exceeded`, `4010 channel_unavailable` — each with cause and resolution.

### `docs/guides/realtime/nodejs-quickstart.md`

Structure mirrors `frontend-quickstart.md` using A-2, B-2, C-2 snippets. Adds section on obtaining a service-account token via `client_credentials` grant.

### `docs/guides/realtime/python-quickstart.md`

Structure mirrors `frontend-quickstart.md` using A-3, B-3, C-3 snippets. Adds `asyncio` event loop setup note.

**Consistency rule**: Every code block in the docs that corresponds to a catalog template is extracted from the same source string (the lint script verifies this — see Phase 5).

---

## Phase 5: Snippet Lint Script

### `scripts/lint-snippet-templates.mjs`

**Algorithm**:
1. Import `SNIPPET_CATALOG` from `apps/web-console/src/lib/snippets/snippet-catalog.ts` — use `tsx` to transpile on-the-fly, or maintain a parallel `.mjs` mirror of just the realtime templates for the lint script (simpler, avoids build dependency).
2. For each template in `SNIPPET_CATALOG['realtime-subscription']`:
   a. Fill all `{TOKEN}` placeholders with their fallback values (e.g. `{REALTIME_ENDPOINT}` → `https://example.com`).
   b. **JavaScript templates**: parse with `new vm.Script(filledCode)` — catches syntax errors.
   c. **Python templates**: if `python3` is on PATH, run `python3 -c "import ast; ast.parse(open('/dev/stdin').read())"` with the filled code on stdin.
3. For each guide in `docs/guides/realtime/*.md`:
   a. Extract fenced code blocks tagged `js`, `ts`, `javascript`, `typescript`, `python`.
   b. Cross-reference against catalog templates: the filled template must appear as a substring of the guide code block (allowing for annotation comments).
   c. Warn if a guide code block is not traceable to any catalog template.
4. Exit 0 if no errors; exit 1 on any validation failure.

**Registration**: Add to `package.json` scripts at root level (`"lint:snippets": "node scripts/lint-snippet-templates.mjs"`) and invoke from CI.

---

## Environment Variables

No new environment variables are required for this task. The realtime endpoint URL is a workspace-level configuration value served by the existing workspace metadata API (already exposed via `services/realtime-gateway` or workspace provisioning service). The console page reads it from the workspace context, not from environment variables.

---

## Testing Strategy

### Unit Tests — Frontend

| Test file | Coverage |
|-----------|---------|
| `lib/snippets/snippet-catalog.test.ts` (extended) | `SNIPPET_CATALOG['realtime-subscription']` exists; has entries for all 3 languages × 3 categories; no entry contains a real token pattern; `<YOUR_ACCESS_TOKEN>` placeholder present |
| `lib/snippets/snippet-generator.test.ts` (extended) | `{WORKSPACE_ID}` fills from `context.workspaceId`; `{REALTIME_ENDPOINT}` fills from `context.resourceHost`; `{CHANNEL_TYPE}` fills from `context.resourceExtraA`; fallback placeholders rendered when context values are null |
| `components/console/snippets/RealtimeSnippetsPanel.test.tsx` (new) | No-capability guard renders alert when `realtimeEnabled=false`; alert renders when `channelTypes=[]`; language selector defaults to JS; sessionStorage key written on language switch; language switch shows correct snippets; secondary channel types note rendered when `channelTypes.length > 1`; copy button accessible via keyboard |
| `pages/ConsoleRealtimePage.test.tsx` (new) | Page renders `<RealtimeSnippetsPanel>` with correct props; loading state shown while workspace metadata fetches; error state shown on fetch failure |

### Unit Tests — Backend (snippet lint)

| Test | Coverage |
|------|---------|
| `scripts/lint-snippet-templates.test.mjs` (new, `node:test`) | All JS template strings pass `vm.Script` parse; no template contains a real credential pattern (`/Bearer [A-Za-z0-9_\-.]{20,}/`); Python templates (if python3 available) pass `ast.parse` |

### Accessibility Validation

- Automated axe-core check run as part of `RealtimeSnippetsPanel.test.tsx` using `@axe-core/react` (or `vitest-axe`) — asserts zero critical violations on the rendered panel.
- Keyboard navigation test: tab-through to copy button, press Enter, assert `copiedId` state update.

### Visual Smoke Test (manual / CI screenshot)

- Storybook story for `RealtimeSnippetsPanel` covering: enabled+contextualised, enabled+no-context (fallback placeholders), disabled (no-capability alert), multiple channel types.

### Integration Tests

No new backend integration tests for this task — the realtime API surface under test is the responsibility of T01–T04. This task's backend validation is limited to the snippet lint script.

### Documentation Consistency Check (CI)

The lint script (`scripts/lint-snippet-templates.mjs`) is the primary automated guard. Runs on every PR touching `apps/web-console/src/lib/snippets/` or `docs/guides/realtime/`.

---

## Parallelization

| Track A (Frontend) | Track B (Documentation) | Track C (Tooling) |
|-------------------|------------------------|------------------|
| Extend `snippet-types.ts`, `snippet-catalog.ts`, `snippet-generator.ts` with new resource type and tokens | Write `docs/guides/realtime/` markdown guides | Write `scripts/lint-snippet-templates.mjs` |
| Build `RealtimeSnippetsPanel.tsx` + tests | Write `docs/guides/realtime/index.md` | Register lint script in CI config |
| Build `ConsoleRealtimePage.tsx` + tests | — | — |

Track C can start in parallel with Track A (lint script structure is known before templates are final). Track B depends on Track A (snippet code must be stable before guide code blocks are authored).

---

## Implementation Sequence

1. **Step 1** — Extend `snippet-types.ts`: add `'realtime-subscription'` to `ResourceType`.
2. **Step 2** — Extend `snippet-generator.ts`: add `{WORKSPACE_ID}`, `{REALTIME_ENDPOINT}`, `{CHANNEL_TYPE}` token handlers to `getTokenValue` and the `fillTemplate` regex.
3. **Step 3** — Author all 9 template entries (A1–A3, B1–B3, C1–C3) in `snippet-catalog.ts` under `'realtime-subscription'`.
4. **Step 4** — Extend `snippet-catalog.test.ts` and `snippet-generator.test.ts` with new assertions.
5. **Step 5** — Build `RealtimeSnippetsPanel.tsx` (language selector, no-capability guard, `ConnectionSnippets` integration) + `RealtimeSnippetsPanel.test.tsx`.
6. **Step 6** — Build `ConsoleRealtimePage.tsx` (workspace metadata integration, router registration) + `ConsoleRealtimePage.test.tsx`.
7. **Step 7** — Write `docs/guides/realtime/` guides (index, frontend, nodejs, python). Verify code blocks match catalog templates.
8. **Step 8** — Write `scripts/lint-snippet-templates.mjs` and `scripts/lint-snippet-templates.test.mjs`. Register in root `package.json` and CI pipeline.
9. **Step 9** — Run `pnpm test` and `node scripts/lint-snippet-templates.mjs` at root; fix any failures.
10. **Step 10** — Manual accessibility smoke test: keyboard navigation and screen reader label check on `RealtimeSnippetsPanel`.

---

## Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|------|--------|-----------|
| R1 | T01 realtime API surface still evolving — snippet connection URL pattern or subscribe message format may change before launch | Snippets show incorrect API call shape | Author snippets from the T01 published OpenAPI/AsyncAPI contract, not source code. Lint script detects schema drift. |
| R2 | Workspace metadata API does not yet expose `realtimeEndpoint` or `channelTypes` fields — snippets fall back to generic placeholders | Reduced DX value; developers must discover endpoints manually | Define minimum required metadata contract before Step 6; if not available, `RealtimeSnippetsPanel` renders with fallback placeholders plus an inline note directing developers to the console's configuration tab |
| R3 | Python template syntax validation unavailable in CI if `python3` not on PATH | Stale Python snippets not caught | Lint script emits `WARN` (not `ERROR`) for Python if `python3` absent; add `python3` to CI toolchain (Dockerfile or workflow dependency) |
| R4 | `ConnectionSnippets.tsx` lacks `aria-live` on copy feedback region | Accessibility gap for screen-reader users | Audit `ConnectionSnippets.tsx` in Step 5; add `aria-live="polite"` to feedback `<span>` if missing (this is a one-line change, not a blocker) |
| R5 | Documentation site content pipeline not ready to publish new guides | Docs guides delivered as committed Markdown but not live on site | Guides are committed as canonical source artifacts regardless; site publication is a deployment concern outside this task's scope |

---

## Criteria of Done

| # | Criterion | Evidence |
|---|-----------|---------|
| CD-01 | `SNIPPET_CATALOG['realtime-subscription']` contains ≥9 entries (3 languages × 3 categories) | `snippet-catalog.test.ts` assertion passes |
| CD-02 | All realtime snippet templates are syntactically valid in their target language | `node scripts/lint-snippet-templates.mjs` exits 0 |
| CD-03 | No snippet template contains a real token, credential, or secret value | Lint script regex check passes; `hasPlaceholderSecrets: true` set on all 9 entries |
| CD-04 | `{WORKSPACE_ID}`, `{REALTIME_ENDPOINT}`, `{CHANNEL_TYPE}` tokens fill correctly from `SnippetContext` | `snippet-generator.test.ts` assertions pass |
| CD-05 | `RealtimeSnippetsPanel` renders no-capability alert when `realtimeEnabled=false` or `channelTypes=[]` | `RealtimeSnippetsPanel.test.tsx` guard test passes |
| CD-06 | Language selector defaults to JavaScript and selection persists in `sessionStorage` | `RealtimeSnippetsPanel.test.tsx` state persistence test passes |
| CD-07 | Copy action works and provides visual confirmation; keyboard-activatable | `RealtimeSnippetsPanel.test.tsx` keyboard + clipboard test passes |
| CD-08 | Zero axe-core critical violations on rendered panel | `RealtimeSnippetsPanel.test.tsx` accessibility assertion passes |
| CD-09 | `ConsoleRealtimePage` renders at `/console/workspaces/:workspaceId/realtime` with correct props passed to panel | `ConsoleRealtimePage.test.tsx` passes |
| CD-10 | `docs/guides/realtime/` contains guides for JavaScript, Node.js, and Python — each with prerequisites, snippet, filter example, reconnection, and common errors | Files present and reviewed |
| CD-11 | Documentation guide code blocks are consistent with catalog templates | Lint script guide-consistency check passes |
| CD-12 | All tests pass at root | `pnpm test` exits 0 |
| CD-13 | `docs/guides/realtime/index.md` linked from `docs/README.md` | File present and linked |
