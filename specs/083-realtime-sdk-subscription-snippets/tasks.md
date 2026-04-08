# Tasks: Realtime SDK Subscription Snippets & Examples

**Branch**: `083-realtime-sdk-subscription-snippets`  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T05  
**Generated**: 2026-03-30

---

## File Path Map (implement reference)

All artifacts to be created or modified in this feature:

### New files

```text
apps/web-console/src/lib/snippets/snippet-catalog.ts              ← EXTEND (new resource type added)
apps/web-console/src/lib/snippets/snippet-types.ts                ← EXTEND (new ResourceType member)
apps/web-console/src/lib/snippets/snippet-generator.ts            ← EXTEND (3 new token handlers)
apps/web-console/src/lib/snippets/snippet-catalog.test.ts         ← EXTEND (realtime catalog assertions)
apps/web-console/src/lib/snippets/snippet-generator.test.ts       ← EXTEND (new token fill tests)
apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.tsx      ← NEW
apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.test.tsx ← NEW
apps/web-console/src/pages/ConsoleRealtimePage.tsx                ← NEW
apps/web-console/src/pages/ConsoleRealtimePage.test.tsx           ← NEW
docs/guides/realtime/index.md                                     ← NEW
docs/guides/realtime/frontend-quickstart.md                       ← NEW
docs/guides/realtime/nodejs-quickstart.md                         ← NEW
docs/guides/realtime/python-quickstart.md                         ← NEW
docs/README.md                                                     ← EXTEND (link to realtime guides)
scripts/lint-snippet-templates.mjs                                ← NEW
scripts/lint-snippet-templates.test.mjs                           ← NEW
package.json                                                       ← EXTEND (lint:snippets script)
```

### Key constants / identifiers

- New `ResourceType` value: `'realtime-subscription'`
- New `sessionStorage` key: `realtime-snippet-lang`
- New console route: `/console/workspaces/:workspaceId/realtime`
- New template IDs: `realtime-js-browser-basic`, `realtime-nodejs-backend-basic`, `realtime-python-backend-basic`, `realtime-js-browser-filter`, `realtime-nodejs-backend-filter`, `realtime-python-backend-filter`, `realtime-js-browser-reconnect`, `realtime-nodejs-backend-reconnect`, `realtime-python-backend-reconnect`
- New lint script entry: `"lint:snippets": "node scripts/lint-snippet-templates.mjs"`

---

## Task List

### T-01 — Extend `snippet-types.ts`: add `'realtime-subscription'` ResourceType

**Track**: A (Frontend infra)  
**Priority**: P0 (unblocks all other frontend tasks)  
**Dependencies**: none  
**File**: `apps/web-console/src/lib/snippets/snippet-types.ts`

**What to do**:
1. Open `snippet-types.ts` and locate the `ResourceType` union type definition.
2. Add `'realtime-subscription'` as a new member of the union, adjacent to existing resource types.
3. If `SnippetContext` does not already have `workspaceId?: string` and `resourceExtraA?: string | null` fields, add them. These are the context fields used by the new token handlers.
4. No other changes to this file.

**Acceptance**:
- `ResourceType` union includes `'realtime-subscription'`.
- TypeScript compiles without errors (`pnpm --filter web-console tsc --noEmit`).

---

### T-02 — Extend `snippet-generator.ts`: add 3 new token handlers

**Track**: A  
**Priority**: P0 (unblocks T-04, T-05)  
**Dependencies**: T-01  
**File**: `apps/web-console/src/lib/snippets/snippet-generator.ts`

**What to do**:
1. Locate the `fillTemplate` function (or equivalent) and the regex that matches `{TOKEN}` patterns.
2. Extend the regex to include three new patterns: `{WORKSPACE_ID}`, `{REALTIME_ENDPOINT}`, `{CHANNEL_TYPE}`.
   - Extended regex (append to existing): `|\{WORKSPACE_ID\}|\{REALTIME_ENDPOINT\}|\{CHANNEL_TYPE\}`
3. In the token-value switch/map, add handlers:
   - `{WORKSPACE_ID}` → `context.workspaceId ?? '<WORKSPACE_ID>'`
   - `{REALTIME_ENDPOINT}` → `context.resourceHost ?? '<REALTIME_ENDPOINT>'`
   - `{CHANNEL_TYPE}` → `context.resourceExtraA ?? '<CHANNEL_TYPE>'`
4. Do not modify existing token handlers.

**Acceptance**:
- `generateSnippets('realtime-subscription', { resourceHost: 'wss://rt.example.com', workspaceId: 'ws-123', resourceExtraA: 'postgresql-changes' })` fills all three tokens correctly.
- When context values are null/undefined, fallback placeholders (angle-bracket format) are returned.

---

### T-03 — Author 9 snippet templates in `snippet-catalog.ts`

**Track**: A  
**Priority**: P1  
**Dependencies**: T-01, T-02  
**File**: `apps/web-console/src/lib/snippets/snippet-catalog.ts`

**What to do**:

Add `SNIPPET_CATALOG['realtime-subscription']` as a new catalog entry. The entry must contain exactly 9 `SnippetEntry` objects organised in 3 categories × 3 languages:

#### Category A — Basic subscription

**A-1** `id: 'realtime-js-browser-basic'`, label `'JavaScript (browser) — WebSocket subscription'`  
Template body:

```javascript
// Requires: a valid Keycloak access token for this workspace
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const TOKEN = '<YOUR_ACCESS_TOKEN>'  // replace with your token

const ws = new WebSocket(
  `${ENDPOINT}/workspaces/${WORKSPACE_ID}/realtime/connect`,
  ['v1.falcone.realtime']
)

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    filter: {}
  }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'event') {
    console.log('Received event:', msg.payload)
  }
})

ws.addEventListener('error', (err) => console.error('WebSocket error', err))
ws.addEventListener('close', (e) => console.log('Connection closed', e.code, e.reason))
```

`secretPlaceholderRef`: `'Obtain your access token from Keycloak: POST /realms/<realm>/protocol/openid-connect/token'`

**A-2** `id: 'realtime-nodejs-backend-basic'`, label `'Node.js (backend) — WebSocket subscription'`  
Template body:

```javascript
// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'  // obtain via client_credentials grant

const ws = new WebSocket(
  `${ENDPOINT}/workspaces/${WORKSPACE_ID}/realtime/connect`,
  { headers: { Authorization: `Bearer ${SERVICE_ACCOUNT_TOKEN}` } }
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
ws.on('close', (code, reason) => console.log('Closed', code, reason.toString()))
```

`secretPlaceholderRef`: `'Obtain a service-account token via Keycloak client_credentials grant with your client_id and client_secret.'`

**A-3** `id: 'realtime-python-backend-basic'`, label `'Python (backend) — WebSocket subscription'`  
Template body:

```python
# pip install websockets
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

asyncio.run(subscribe())
```

`secretPlaceholderRef`: `'Obtain a service-account token via Keycloak client_credentials grant.'`

#### Category B — Filtered subscription

**B-1** `id: 'realtime-js-browser-filter'`, label `'JavaScript (browser) — Filtered subscription'`  
Same structure as A-1 but `filter` object in the `subscribe` message is:

```javascript
filter: { operation: 'INSERT', entity: 'orders' }
```

Add inline comment: `// Supported filter fields: operation (INSERT|UPDATE|DELETE), entity (table/collection name)`

**B-2** `id: 'realtime-nodejs-backend-filter'`, label `'Node.js (backend) — Filtered subscription'`  
Same as A-2 with filter: `{ operation: 'INSERT', entity: 'orders' }`

**B-3** `id: 'realtime-python-backend-filter'`, label `'Python (backend) — Filtered subscription'`  
Same as A-3 with filter: `{"operation": "INSERT", "entity": "orders"}`

#### Category C — Reconnection with backoff + token refresh

**C-1** `id: 'realtime-js-browser-reconnect'`, label `'JavaScript (browser) — Reconnection with backoff & token refresh'`  
Template body:

```javascript
const ENDPOINT = '{REALTIME_ENDPOINT}'
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
    `${ENDPOINT}/workspaces/${WORKSPACE_ID}/realtime/connect?token=${encodeURIComponent(token)}`,
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

connect()
```

**C-2** `id: 'realtime-nodejs-backend-reconnect'`, label `'Node.js (backend) — Reconnection with backoff'`  
Equivalent reconnection pattern using the `ws` npm package. Use a `reconnect()` function with `Math.min(1000 * 2 ** attempt, 30000)` backoff; no token-refresh section (service accounts handle token lifecycle separately). Include inline comment: `// Rotate your service-account token via Keycloak client_credentials if you receive close code 4001`.

**C-3** `id: 'realtime-python-backend-reconnect'`, label `'Python (backend) — Reconnection with backoff'`  
Equivalent async reconnection loop using `websockets` and `asyncio`. Implement exponential backoff via `await asyncio.sleep(min(1 * 2 ** attempt, 30))`. Include inline comment about rotating service-account token on code 4001.

**Additional requirements for all 9 entries**:
- `secretTokens` array must list the placeholder strings (`['<YOUR_ACCESS_TOKEN>']` or `['<YOUR_SERVICE_ACCOUNT_TOKEN>']`).
- No real tokens, JWTs, or credentials anywhere in the code templates.
- Templates must be syntactically valid JavaScript/TypeScript (for A-1, A-2, B-1, B-2, C-1, C-2) and syntactically valid Python (for A-3, B-3, C-3) — verified by T-08.

**Acceptance**:
- `Object.keys(SNIPPET_CATALOG['realtime-subscription']).length >= 9` (or equivalent array length check).
- Running `grep -r 'Bearer ' apps/web-console/src/lib/snippets/snippet-catalog.ts` returns zero matches with a real-looking JWT.

---

### T-04 — Extend `snippet-catalog.test.ts` and `snippet-generator.test.ts`

**Track**: A  
**Priority**: P1  
**Dependencies**: T-01, T-02, T-03  
**Files**:
- `apps/web-console/src/lib/snippets/snippet-catalog.test.ts`
- `apps/web-console/src/lib/snippets/snippet-generator.test.ts`

**Snippet-catalog tests to add**:
1. `SNIPPET_CATALOG['realtime-subscription']` is defined and has exactly 9 entries.
2. Each entry has `id`, `label`, `codeTemplate`, `secretTokens`, `secretPlaceholderRef`.
3. No entry's `codeTemplate` matches the regex `/Bearer [A-Za-z0-9_\-.]{20,}/` (no real JWT-like strings).
4. `<YOUR_ACCESS_TOKEN>` or `<YOUR_SERVICE_ACCOUNT_TOKEN>` is present in every entry's `codeTemplate`.
5. Entries for ids `realtime-js-browser-basic`, `realtime-nodejs-backend-basic`, `realtime-python-backend-basic` all exist.
6. Filter entries (B-1, B-2, B-3) contain `operation` and `entity` in their `codeTemplate`.
7. Reconnect entries (C-1, C-2, C-3) contain backoff logic (`2 **` or `pow` or `** attempt`) in their `codeTemplate`.

**Snippet-generator tests to add**:
1. `{WORKSPACE_ID}` in a template is replaced with `context.workspaceId` when provided.
2. `{REALTIME_ENDPOINT}` is replaced with `context.resourceHost` when provided.
3. `{CHANNEL_TYPE}` is replaced with `context.resourceExtraA` when provided.
4. When `context.workspaceId` is `undefined`, output contains `<WORKSPACE_ID>` placeholder.
5. When `context.resourceHost` is `undefined`, output contains `<REALTIME_ENDPOINT>` placeholder.
6. When `context.resourceExtraA` is `null`, output contains `<CHANNEL_TYPE>` placeholder.
7. All three tokens fill simultaneously in a single template call.

---

### T-05 — Build `RealtimeSnippetsPanel.tsx` component

**Track**: A  
**Priority**: P1  
**Dependencies**: T-01, T-02, T-03  
**File**: `apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.tsx`

**Props interface**:

```typescript
interface RealtimeSnippetsPanelProps {
  workspaceId: string
  realtimeEndpoint: string | null   // null → realtime not provisioned
  channelTypes: string[]            // derived from provisioned data sources
  realtimeEnabled: boolean
}
```

**Implementation requirements**:

1. **No-capability guard**: If `!realtimeEnabled || channelTypes.length === 0`:
   - Render `<Alert variant="info">` (shadcn/ui) with message: `"Realtime subscriptions require at least one provisioned data source. Visit the provisioning section to configure your workspace."`.
   - Include a link pointing to `/console/workspaces/${workspaceId}/provisioning`.
   - Do not render any snippet content.

2. **Language selector**: Use `<Tabs>` from shadcn/ui with tabs: `javascript`, `nodejs`, `python`.
   - Default: read from `sessionStorage.getItem('realtime-snippet-lang')` or fall back to `'javascript'`.
   - On tab change: write selected language to `sessionStorage.setItem('realtime-snippet-lang', lang)`.

3. **Context building**: Build a `SnippetContext`:

   ```typescript
   const ctx: SnippetContext = {
     resourceHost: realtimeEndpoint ?? undefined,
     workspaceId,
     resourceExtraA: channelTypes[0] ?? null,
   }
   ```

4. **Snippet rendering**: Call `generateSnippets('realtime-subscription', ctx)`. Filter results by language prefix:
   - `javascript` tab: entries whose `id` starts with `'realtime-js-'`
   - `nodejs` tab: entries whose `id` starts with `'realtime-nodejs-'`
   - `python` tab: entries whose `id` starts with `'realtime-python-'`
   - Render `<ConnectionSnippets entries={filteredEntries} />` (reuse existing component).

5. **Multi-channel note**: If `channelTypes.length > 1`, render below the snippets:

   ```tsx
   <p className="text-sm text-muted-foreground mt-2">
     Additional channel types available: {channelTypes.slice(1).join(', ')}. 
     Change the <code>channelType</code> value in the snippet accordingly.
   </p>
   ```

6. **Accessibility wrapper**:

   ```tsx
   <section aria-labelledby="realtime-snippets-heading">
     <h2 id="realtime-snippets-heading" className="sr-only">Realtime Subscription Snippets</h2>
     {/* content */}
   </section>
   ```

7. **`aria-live` audit**: Check `ConnectionSnippets.tsx` for `aria-live="polite"` on the copy-feedback element. If missing, add it in `ConnectionSnippets.tsx` as a one-line fix (document in commit).

**Acceptance**:
- Component renders without TypeScript errors.
- No-capability guard shown when `realtimeEnabled=false`.
- Language tabs switch correctly.
- `sessionStorage` updated on tab change.

---

### T-06 — Write `RealtimeSnippetsPanel.test.tsx`

**Track**: A  
**Priority**: P1  
**Dependencies**: T-05  
**File**: `apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.test.tsx`

**Test cases** (use Vitest + `@testing-library/react`):

1. **Guard — realtimeEnabled=false**: Renders alert, does not render snippet code blocks.
2. **Guard — channelTypes=[]**: Renders alert even when `realtimeEnabled=true`.
3. **Guard — link**: Alert contains link to `/console/workspaces/ws-test/provisioning`.
4. **Default language**: Without sessionStorage set, first rendered tab is JavaScript.
5. **SessionStorage read on mount**: If `sessionStorage` contains `'nodejs'`, component mounts with Node.js tab active.
6. **SessionStorage write on switch**: Switching to Python tab writes `'python'` to `sessionStorage`.
7. **Snippet content — JavaScript**: JavaScript tab renders a code block containing `WebSocket` and `{CHANNEL_TYPE}` replaced (or `postgresql-changes` with mock context).
8. **Snippet content — Node.js**: Node.js tab renders `import WebSocket from 'ws'`.
9. **Snippet content — Python**: Python tab renders `import asyncio`.
10. **Multi-channel note**: When `channelTypes=['postgresql-changes', 'mongodb-changes']`, note with `mongodb-changes` rendered.
11. **Copy button keyboard-accessible**: Find copy button by `role="button"`, simulate `Enter` keypress, assert copy feedback visible (or mock clipboard).
12. **Accessibility**: Run `axe` (via `vitest-axe` or `@axe-core/react`) on rendered component; assert zero critical violations.

---

### T-07 — Build `ConsoleRealtimePage.tsx` and its test

**Track**: A  
**Priority**: P1  
**Dependencies**: T-05  
**Files**:
- `apps/web-console/src/pages/ConsoleRealtimePage.tsx`
- `apps/web-console/src/pages/ConsoleRealtimePage.test.tsx`

**Page implementation**:

1. The page receives `workspaceId` from the router param (`:workspaceId`).
2. Fetches workspace realtime metadata from the existing workspace API (or workspace context). Derive:
   - `realtimeEndpoint`: from workspace config (field: `realtimeEndpointUrl` or equivalent).
   - `channelTypes`: from `workspace.dataSources` — map each data source type to its channel type (`postgresql` → `postgresql-changes`, `mongodb` → `mongodb-changes`).
   - `realtimeEnabled`: `workspace.features?.realtime === true`.
3. While fetching: render a loading skeleton (shadcn/ui `Skeleton` or equivalent).
4. On fetch error: render an `<Alert variant="destructive">` with a generic error message and a retry button.
5. On success: render `<RealtimeSnippetsPanel workspaceId={workspaceId} realtimeEndpoint={realtimeEndpoint} channelTypes={channelTypes} realtimeEnabled={realtimeEnabled} />`.
6. Register the route in the console router at `/console/workspaces/:workspaceId/realtime`. (Add route entry to the existing router config file — locate via `grep -r 'workspaces/:workspaceId' apps/web-console/src` to find router config location.)

**Page tests** (Vitest + RTL + `msw` or mock):

1. **Loading state**: While API request is pending, loading skeleton rendered, panel not rendered.
2. **Success state**: After API resolves with realtime-enabled workspace data, `<RealtimeSnippetsPanel>` rendered with correct props.
3. **Error state**: After API rejects, destructive alert rendered.
4. **Channel type mapping**: `postgresql` data source in workspace data produces `channelTypes=['postgresql-changes']`.
5. **Disabled state**: `features.realtime=false` passes `realtimeEnabled=false` to panel.

---

### T-08 — Write `scripts/lint-snippet-templates.mjs` and its test

**Track**: C (Tooling)  
**Priority**: P1  
**Dependencies**: T-03 (templates must exist before lint script runs on them)  
**Files**:
- `scripts/lint-snippet-templates.mjs`
- `scripts/lint-snippet-templates.test.mjs`

**Lint script implementation** (Node.js 20+ ESM):

```javascript
// scripts/lint-snippet-templates.mjs
// Algorithm:
// 1. Load realtime templates from a lightweight parallel source (avoid full TS build):
//    - Either use tsx: `const { SNIPPET_CATALOG } = await import('../apps/web-console/src/lib/snippets/snippet-catalog.ts')` 
//      (requires `tsx` available in PATH, or via `node --import tsx/esm`)
//    - OR maintain a plain .mjs mirror of the realtime templates only (preferred for CI portability).
//    Decision: maintain `scripts/realtime-snippet-templates.data.mjs` as the authoritative template source 
//    for the lint script. This file is auto-generated from snippet-catalog.ts by a build step OR 
//    maintained manually and cross-checked by the lint script itself (simpler).
//    For this implementation: duplicate the 9 template strings in realtime-snippet-templates.data.mjs
//    with a TODO comment to automate the sync in a future task.
// 2. For each JS/TS template: parse with `new (await import('node:vm')).Script(filled)` — syntax check only.
// 3. For each Python template: run `python3 -c "import ast; ast.parse(open('/dev/stdin').read())"` 
//    via child_process.spawnSync with template code on stdin.
//    If python3 not in PATH: log WARN, continue (do not fail).
// 4. For each guide in docs/guides/realtime/*.md: extract ```js/ts/javascript/typescript/python blocks.
//    For each extracted block: check it contains the corresponding catalog snippet's distinctive identifier
//    (e.g., for JS basic: check `v1.falcone.realtime` appears in the block).
// 5. Check no template matches /Bearer [A-Za-z0-9_\-.]{20,}/ (no embedded real tokens).
// 6. Exit 0 on all pass; exit 1 on any error.
```

**Additionally**, create `scripts/realtime-snippet-templates.data.mjs` — a plain ESM file exporting the 9 template strings (duplicated from snippet-catalog.ts) for use by the lint script without requiring TypeScript transpilation.

**Lint test** (`scripts/lint-snippet-templates.test.mjs`, `node:test`):

1. JS templates parse without throwing via `vm.Script`.
2. No template contains a real-looking JWT (`/eyJ[A-Za-z0-9_\-]{20,}/`).
3. No template contains `/Bearer [A-Za-z0-9_\-\.]{20,}/`.
4. Python templates pass syntax check (skip if `python3` absent).
5. `<YOUR_ACCESS_TOKEN>` or `<YOUR_SERVICE_ACCOUNT_TOKEN>` appears in every template.

**package.json update** (root):
- Add `"lint:snippets": "node scripts/lint-snippet-templates.mjs"` to `scripts`.
- Add `"test:snippets": "node --test scripts/lint-snippet-templates.test.mjs"` to `scripts`.

---

### T-09 — Write documentation guides in `docs/guides/realtime/`

**Track**: B (Documentation)  
**Priority**: P1  
**Dependencies**: T-03 (snippet templates must be final before guides are authored)  
**Files**:
- `docs/guides/realtime/index.md`
- `docs/guides/realtime/frontend-quickstart.md`
- `docs/guides/realtime/nodejs-quickstart.md`
- `docs/guides/realtime/python-quickstart.md`
- `docs/README.md` (extend with link to realtime guides section)

**`docs/guides/realtime/index.md`** — navigation page:

```markdown
# Realtime Subscription Quick Start

Connect your applications to workspace change events in real time.

| Guide | Audience | Runtime |
|-------|----------|---------|
| [Frontend Quick Start](./frontend-quickstart.md) | Browser app developers | JavaScript / TypeScript |
| [Node.js Quick Start](./nodejs-quickstart.md) | Backend service developers | Node.js 18+ |
| [Python Quick Start](./python-quickstart.md) | Backend service developers | Python 3.10+ |
```

**`docs/guides/realtime/frontend-quickstart.md`** — structure:
1. **Prerequisites** — platform account, workspace with ≥1 data source, Keycloak access token (Authorization Code flow). Link to token-obtaining docs.
2. **Endpoint discovery** — how to find the realtime endpoint URL in the console (workspace → Settings → Realtime) or via `GET /api/workspaces/{workspaceId}/config`.
3. **Basic subscription** — the A-1 snippet (JS browser, basic). Code block tagged `javascript`. Inline annotation explaining each section.
4. **Applying filters** — the B-1 snippet. Table of supported filter fields: `operation` (INSERT|UPDATE|DELETE), `entity` (table/collection name). Note: filter syntax must match T04 API.
5. **Reconnection & token refresh** — the C-1 snippet. Explanation of exponential backoff strategy and `4001 token_expired` close code.
6. **Common error codes** — table:

| Code | Meaning | Resolution |
|------|---------|-----------|
| 4001 | `token_expired` | Refresh access token via Keycloak refresh_token grant and reconnect |
| 4003 | `scope_denied` | Verify the token includes the required `realtime:subscribe` scope |
| 4008 | `quota_exceeded` | Concurrent subscription limit reached; close unused subscriptions |
| 4010 | `channel_unavailable` | Requested channel type not provisioned for this workspace |

**`docs/guides/realtime/nodejs-quickstart.md`** — mirrors frontend guide using A-2, B-2, C-2 snippets. Adds section on obtaining service-account token via `client_credentials` Keycloak grant (curl example with placeholders). Code blocks tagged `javascript`.

**`docs/guides/realtime/python-quickstart.md`** — mirrors frontend guide using A-3, B-3, C-3 snippets. Adds `asyncio` event loop setup note (`asyncio.run()` for Python 3.10+). Code blocks tagged `python`.

**`docs/README.md`** — add entry under an appropriate section:

```markdown
- [Realtime Subscriptions](./guides/realtime/index.md) — Connect to workspace change events from browser and backend apps.
```

**Acceptance**:
- All four files are present and well-formed Markdown.
- Each guide contains prerequisite section, at least one snippet code block per category (basic, filter, reconnect), and the error codes table.
- No guide contains real credentials, tokens, or workspace-specific values — only placeholders.
- Code block language tags are correct (`javascript` or `python`).

---

### T-10 — Run full test suite and lint validation

**Track**: Integration / QA  
**Priority**: P1 (final gate before commit)  
**Dependencies**: T-01 through T-09  
**Files**: none (validation step)

**Steps**:
1. `pnpm --filter web-console tsc --noEmit` — TypeScript typecheck must pass.
2. `pnpm test` (or `pnpm --filter web-console test`) — all tests including new ones must pass.
3. `node scripts/lint-snippet-templates.mjs` — lint script must exit 0.
4. `node --test scripts/lint-snippet-templates.test.mjs` — snippet lint tests must pass.
5. Manual accessibility check: open `RealtimeSnippetsPanel` Storybook story (if Storybook is configured), tab through to copy buttons, verify keyboard operation.
6. **Audit `ConnectionSnippets.tsx`**: confirm `aria-live="polite"` is present on copy feedback. If missing, add it and note in the commit.

**Acceptance**:
- Zero TypeScript errors.
- Zero failing unit tests.
- Lint script exits 0.
- `aria-live` present on copy feedback.

---

## Implementation Order

```text
T-01 (snippet-types.ts)
  └── T-02 (snippet-generator.ts)
        └── T-03 (snippet-catalog.ts)
              ├── T-04 (catalog + generator tests)
              ├── T-05 (RealtimeSnippetsPanel.tsx)
              │     └── T-06 (RealtimeSnippetsPanel.test.tsx)
              │           └── T-07 (ConsoleRealtimePage + test)
              ├── T-08 (lint script — can start in parallel with T-05)
              └── T-09 (docs guides — start after T-03 templates are final)
                    └── T-10 (full validation — final gate)
```

**Parallelizable after T-03**: T-05/T-06/T-07 (frontend), T-08 (tooling), T-09 (docs) can all proceed in parallel.

---

## Criteria of Done (from spec, mapped to tasks)

| # | Criterion | Task |
|---|-----------|------|
| CD-01 | `SNIPPET_CATALOG['realtime-subscription']` contains ≥9 entries | T-03, T-04 |
| CD-02 | All snippet templates syntactically valid in target language | T-08 |
| CD-03 | No snippet contains real token/credential | T-04, T-08 |
| CD-04 | `{WORKSPACE_ID}`, `{REALTIME_ENDPOINT}`, `{CHANNEL_TYPE}` fill from context | T-02, T-04 |
| CD-05 | No-capability alert when `realtimeEnabled=false` or `channelTypes=[]` | T-05, T-06 |
| CD-06 | Language selector defaults to JS, persists to sessionStorage | T-05, T-06 |
| CD-07 | Copy action works, keyboard-activatable, visual confirmation | T-05, T-06 |
| CD-08 | Zero axe-core critical violations | T-06 |
| CD-09 | `ConsoleRealtimePage` at correct route with correct props | T-07 |
| CD-10 | `docs/guides/realtime/` has guides for JS, Node.js, Python | T-09 |
| CD-11 | Doc guide code blocks consistent with catalog templates | T-08, T-09 |
| CD-12 | All tests pass | T-10 |
| CD-13 | `docs/README.md` links to realtime guides | T-09 |
