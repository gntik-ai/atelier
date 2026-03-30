# Tasks: Reconexión de Consola y Relectura de Estado de Jobs en Curso

**Task ID**: US-UIB-02-T05  
**Feature Branch**: `077-reconnect-job-state-reread`  
**Spec**: `specs/077-reconnect-job-state-reread/spec.md`  
**Plan**: `specs/077-reconnect-job-state-reread/plan.md`  
**Generated**: 2026-03-30  
**Status**: Ready

---

## Prerequisite Context

T01–T04 have established:
- `async_operations` PostgreSQL entity + FSM (T01)
- `GET /v1/async-operation-query` endpoint + `useActiveOperationsCount` hook + `OperationStatusBadge`, `OperationLogEntriesList`, `OperationResultSummary` components (T02)
- Idempotency key deduplication + `async-operation-retry.mjs` action (T03)
- Timeout sweep, cancellation, orphan recovery; states `timed_out`, `cancelled` added to `OperationStatus` (T04)

`OperationStatus` in `apps/web-console/src/lib/console-operations.ts` must be extended to include `timed_out` and `cancelled` (added by T04) before T05 tests compile.

---

## Task List

### TASK-01 — Extend `OperationStatus` type for terminal states added by T04

**File**: `apps/web-console/src/lib/console-operations.ts`  
**Type**: Code · Frontend  
**Depends on**: T04 (states must exist in backend; this is a TypeScript alignment)  
**Effort**: XS

**What to do**:
- Update the `OperationStatus` union type to include `'timed_out'` and `'cancelled'`:
  ```ts
  export type OperationStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'timed_out'
    | 'cancelled'
  ```
- Update `OperationFilters.status` accordingly (already typed via `OperationStatus`, no additional change needed).
- Verify no existing switch/if exhaustiveness checks break (add fallthrough cases as needed in `OperationStatusBadge`).

**Done when**: TypeScript compiles cleanly (`pnpm --filter web-console tsc --noEmit`).

---

### TASK-02 — Implement `reconcileOperations` pure utility

**File**: `apps/web-console/src/lib/reconcile-operations.ts`  
**Type**: Code · Frontend  
**Depends on**: TASK-01  
**Effort**: S

**What to do**:
- Create the file with the following exports:

```ts
import type { OperationStatus, OperationSummary } from './console-operations'

export type TerminalStatus = Extract<
  OperationStatus,
  'completed' | 'failed' | 'timed_out' | 'cancelled'
>

export const TERMINAL_STATUSES: ReadonlySet<OperationStatus> = new Set<OperationStatus>([
  'completed', 'failed', 'timed_out', 'cancelled',
])

export interface ReconciliationDelta {
  updated: OperationSummary[]     // state changed between local and remote
  added: OperationSummary[]       // present in remote, absent in local
  terminal: OperationSummary[]    // transitioned to terminal state during disconnection
  unavailable: string[]           // operationIds present in local but absent from remote (purged)
  unchanged: OperationSummary[]   // no change
}

/**
 * Pure function: compares a local snapshot to the remote list and returns the delta.
 * No side effects. Safe to call multiple times with the same inputs (idempotent).
 *
 * @param localSnapshot - Map of operationId → OperationSummary (client-side cache)
 * @param remoteOps     - Array returned by GET /v1/async-operation-query
 */
export function reconcileOperations(
  localSnapshot: ReadonlyMap<string, OperationSummary>,
  remoteOps: readonly OperationSummary[]
): ReconciliationDelta
```

- Implementation logic:
  1. Build a `Map` from `remoteOps` keyed by `operationId`.
  2. For each entry in `localSnapshot`:
     - If absent in remote map → push to `unavailable`.
     - If status changed → push to `updated`; if new status is terminal → also push to `terminal`.
     - If status unchanged → push to `unchanged`.
  3. For each remote op absent in `localSnapshot` → push to `added`.
  4. Return the `ReconciliationDelta`.

**Done when**: Function exported and all TASK-03 unit tests pass.

---

### TASK-03 — Unit tests for `reconcileOperations`

**File**: `tests/unit/reconcile-operations.test.mjs`  
**Type**: Test · Unit  
**Depends on**: TASK-02  
**Effort**: S

**What to do** — implement tests using `node:test` + `assert`:

1. **empty-delta**: local === remote → all fields empty arrays, `unchanged` has all ops.
2. **state-transition-to-failed**: running → failed → appears in `updated` and `terminal`.
3. **state-transition-to-completed**: running → completed → appears in `updated` and `terminal`.
4. **state-transition-to-timed-out**: running → timed_out → appears in `updated` and `terminal`.
5. **state-transition-to-cancelled**: running → cancelled → appears in `updated` and `terminal`.
6. **non-terminal-update**: pending → running → appears in `updated`, NOT in `terminal`.
7. **added-op**: op in remote but not local → appears in `added` only.
8. **unavailable-op**: op in local but not remote → operationId in `unavailable`.
9. **idempotence**: calling reconcile twice with same inputs returns structurally equal deltas.
10. **multi-op-mixed**: snapshot with 4 ops, remote with 3 changed + 1 added + 1 removed → verify all fields.
11. **empty-local-snapshot**: empty Map, remote has 2 ops → both in `added`.
12. **empty-remote**: local has 2 ops → both in `unavailable`.

**Done when**: `node --test tests/unit/reconcile-operations.test.mjs` exits 0, all 12 cases pass.

---

### TASK-04 — Implement `useReconnectStateSync` hook

**File**: `apps/web-console/src/lib/hooks/use-reconnect-state-sync.ts`  
**Type**: Code · Frontend  
**Depends on**: TASK-02  
**Effort**: M

**What to do**:

```ts
import type { ReconciliationDelta } from '@/lib/reconcile-operations'

export interface ReconnectStateSyncOptions {
  tenantId: string
  workspaceId: string | null
  /** Called with the delta after each successful reconciliation */
  onStateChanged?: (delta: ReconciliationDelta) => void
  /** Milliseconds to debounce reconnect events. Default: 500 */
  debounceMs?: number
}

export interface ReconnectStateSyncResult {
  isSyncing: boolean
  lastSyncedAt: Date | null
  syncError: Error | null
}

export function useReconnectStateSync(
  options: ReconnectStateSyncOptions
): ReconnectStateSyncResult
```

Implementation requirements:
1. Subscribe to `window.addEventListener('online', ...)` and `document.addEventListener('visibilitychange', ...)` (fire only when `document.visibilityState === 'visible'`).
2. Debounce trigger events by `debounceMs` (default 500 ms) — multiple rapid events produce a single fetch.
3. On trigger: call `requestConsoleSessionJson` (from `@/lib/console-session`) to validate token freshness; if 401 is returned, set `syncError` with an auth-expired sentinel and do NOT proceed with re-fetch (caller / auth layer handles redirect).
4. Call `fetchAsyncOperationQuery` (from `@/lib/console-operations`) with `{ queryType: 'list', filters: { status: ['running', 'pending'], tenantId, workspaceId }, pagination: { limit: 100, offset: 0 } }`. If total > 100, fetch subsequent pages in sequence until all ops retrieved.
5. Build local snapshot from the current React state / store; call `reconcileOperations(localSnapshot, remoteOps)`.
6. Dispatch delta via `onStateChanged` callback.
7. Update `isSyncing`, `lastSyncedAt`, `syncError` accordingly.
8. Clean up listeners on unmount.

Logging: use `console.debug('[reconnect-sync]', ...)` for each re-fetch cycle (timestamp, delta sizes).

**Done when**: Hook exports compile cleanly and TASK-05 unit tests pass.

---

### TASK-05 — Unit tests for `useReconnectStateSync`

**File**: `apps/web-console/src/lib/hooks/use-reconnect-state-sync.test.ts`  
**Type**: Test · Unit (React)  
**Depends on**: TASK-04  
**Effort**: S  
**Tools**: Vitest (existing in `apps/web-console/vite.config.ts`) + `@testing-library/react-hooks` or `renderHook` from RTL

Tests to implement:

1. **no-fetch-on-token-expired**: mock `requestConsoleSessionJson` to reject with 401; fire `online` event; assert `syncError` is set and `fetchAsyncOperationQuery` is NOT called.
2. **no-fetch-on-hidden-tab**: fire `visibilitychange` when `document.visibilityState = 'hidden'`; assert no fetch.
3. **fetch-on-visible-tab**: fire `visibilitychange` when `visibilityState = 'visible'`; assert fetch is called once.
4. **debounce**: fire `online` event 5 times within 100 ms; assert exactly 1 fetch invocation.
5. **is-syncing-lifecycle**: assert `isSyncing` is `true` while fetch is in-flight and `false` after.
6. **last-synced-at**: after successful fetch, `lastSyncedAt` is a recent `Date`.
7. **sync-error-on-api-failure**: mock API to throw; assert `syncError` is populated.
8. **cleanup-on-unmount**: unmount hook; fire `online`; assert no state updates (no warnings).

**Done when**: `pnpm --filter web-console test` runs all 8 cases green.

---

### TASK-06 — Extend `OperationStatusBanner` for reconciliation delta display

**File**: `apps/web-console/src/components/console/OperationStatusBanner.tsx` *(new file; banner component referenced in plan — create if it does not exist, or extend `ActiveOperationsIndicator` if that is the existing UI surface for status display)*  
**Type**: Code · Frontend  
**Depends on**: TASK-02  
**Effort**: S

**What to do**:
- Locate whether T02 delivered an `OperationStatusBanner` component. If not, create it at the path above.
- Accept the following props:
  ```ts
  interface OperationStatusBannerProps {
    delta: ReconciliationDelta | null
    onDismiss?: () => void
    /** Auto-dismiss after N ms. Default 30000 */
    autoDismissMs?: number
  }
  ```
- Render nothing when `delta` is null or all arrays are empty.
- When `delta.terminal.length > 0`: show a consolidated summary grouping by status, e.g. "2 operaciones completadas, 1 falló mientras estabas desconectado."
- When `delta.unavailable.length > 0`: append "N operaciones ya no están disponibles (eliminadas o purgadas)."
- Include `role="status"` and `aria-live="polite"` for accessibility.
- Include a dismiss button (calls `onDismiss`) and auto-dismiss timer.
- Use existing Tailwind + shadcn/ui primitives consistent with the project UI kit.

**Done when**: Component renders correctly in TASK-07 integration tests.

---

### TASK-07 — Integration tests: reconnect UI flow

**File**: `apps/web-console/src/components/console/OperationStatusBanner.test.tsx`  
**Type**: Test · Integration (React Testing Library + MSW)  
**Depends on**: TASK-04, TASK-06  
**Effort**: M

Tests to implement using RTL + `msw` (already available as dev dep):

1. **banner-shows-terminal-delta**: render a component that uses `useReconnectStateSync`; MSW returns an op that transitioned from `running` to `failed`; assert banner text mentions "falló".
2. **banner-shows-completed-delta**: op transitioned to `completed`; assert banner text mentions "completada".
3. **banner-shows-unavailable**: op present locally but absent from MSW response; assert "no disponible" text in banner.
4. **banner-dismisses**: click dismiss button; assert banner is removed from DOM.
5. **retry-button-disabled-for-running**: after reconciliation, op still `running`; assert "Reintentar" button is `disabled` / has `aria-disabled="true"`.
6. **retry-button-disabled-for-completed**: op now `completed`; assert "Reintentar" button is `disabled`.
7. **no-retry-prompt-for-failed-with-idempotency**: op `failed` and backend supports retry; clicking "Reintentar" triggers the existing idempotency-key retry path (calls the correct endpoint once).
8. **multitenant-mock**: MSW handler returns only ops for `tenantId=A`; assert ops from `tenantId=B` are never rendered.
9. **token-expired-shows-reauth**: MSW returns 401 on first request after `online` event; assert reauth prompt / error indicator appears.
10. **backend-unavailable**: MSW returns 503; assert "No se puede obtener el estado actual" error message and a "Reintentar sincronización" button.

**Done when**: `pnpm --filter web-console test` passes all 10 cases.

---

### TASK-08 — Integration tests: multi-tenant isolation on reconnect

**File**: `apps/web-console/src/lib/hooks/use-reconnect-state-sync.tenant-isolation.test.ts`  
**Type**: Test · Integration (MSW)  
**Depends on**: TASK-04  
**Effort**: S

Tests:

1. **tenant-a-isolation**: hook configured with `tenantId='tenant-a'`; MSW intercepts `GET /v1/async-operation-query` and asserts the request includes `tenantId=tenant-a`; response includes ops for tenant-a only; assert no ops from tenant-b appear in delta.
2. **superadmin-cross-tenant**: hook configured with a superadmin session token; assert that the query includes the supervisable tenant IDs from the token claims.
3. **reduced-workspace-on-token-refresh**: simulate token refresh that removes workspace-B from claims; assert hook sends query with only workspace-A; ops for workspace-B appear as `unavailable` in delta.
4. **expired-token-blocks-reread**: MSW returns 401 for the query; assert `syncError` is set and the MSW handler was only called once (no retry without reauth).

**Done when**: All 4 tests pass in `pnpm --filter web-console test`.

---

### TASK-09 — Contract tests: `async-operation-query` endpoint used during reconnect

**File**: `tests/contract/async-operation-query-reconnect.contract.test.mjs`  
**Type**: Test · Contract  
**Depends on**: TASK-01 (types), T02 (endpoint already exists)  
**Effort**: S

Using `node:test` + `assert`:

1. **200-with-running-pending-filter**: invoke the OpenWhisk action `async-operation-query.mjs` with `{ queryType: 'list', filters: { status: ['running', 'pending'], tenantId: '<test-tenant>' }, pagination: { limit: 10, offset: 0 } }`; assert response shape matches `OperationListResponse`.
2. **401-expired-token**: pass an expired/missing auth header; assert HTTP 401 or action error with `ERR_UNAUTHORIZED`.
3. **403-tenant-mismatch**: pass a token for tenant-A but request ops for tenant-B; assert 403 / `ERR_FORBIDDEN`.
4. **pagination-supported**: request `limit: 2, offset: 0`; assert response contains `pagination.limit === 2` and `total` field.
5. **empty-result-for-no-ops**: filter by a tenant with no active ops; assert `items: []` and `total: 0`.

**Done when**: `node --test tests/contract/async-operation-query-reconnect.contract.test.mjs` exits 0 (or marks test as skip with appropriate message if test environment lacks live OpenWhisk).

---

### TASK-10 — ADR: reconnect state reconciliation strategy

**File**: `docs/adr/077-reconnect-job-state-reread.md`  
**Type**: Documentation  
**Depends on**: (none — can be authored in parallel with TASK-02)  
**Effort**: XS

**Content to include**:

1. **Context**: after T01–T04, the console lacks defined behavior when a user reconnects after a disconnection during an in-progress async operation.
2. **Decision 1 — Polling/re-fetch over WebSocket/SSE**: this phase uses a pull-on-reconnect strategy (triggered by `online` / `visibilitychange` events) rather than a persistent push connection, to avoid the operational complexity of WebSocket/SSE at this stage.
3. **Decision 2 — Frontend-only reconciliation**: no new backend endpoint for "diff"; the existing `GET /v1/async-operation-query` endpoint (T02) is reused. Reconciliation logic lives in the frontend (`reconcileOperations` pure utility).
4. **Decision 3 — Consolidated banner over individual notifications**: changes accumulated during disconnection are presented as a single summary notification to avoid notification flooding.
5. **Decision 4 — In-memory state only**: no localStorage/sessionStorage persistence of operation state; the backend is the single source of truth; local state is ephemeral.
6. **Decision 5 — Feature flag `CONSOLE_RECONNECT_SYNC_ENABLED`**: guards the auto-sync behavior to allow disabling without code deployment.
7. **Consequences**: backend remains unchanged (T01–T04 invariant); frontend carries reconciliation complexity; behavior degrades gracefully (no sync) when flag is off or backend is unavailable.

**Done when**: File committed and follows the existing ADR format in `docs/adr/`.

---

### TASK-11 — Wire `useReconnectStateSync` into the console operations page

**File**: `apps/web-console/src/pages/` *(operations list page identified from existing routing)*  
**Type**: Code · Frontend Integration  
**Depends on**: TASK-04, TASK-06  
**Effort**: S

**What to do**:
1. Identify the page component that renders the async operations list (likely the page that uses `useActiveOperationsCount` or renders `OperationLogEntriesList`).
2. Import and call `useReconnectStateSync({ tenantId, workspaceId, onStateChanged: handleDelta })`.
3. Store the received `ReconciliationDelta` in component state.
4. Render `<OperationStatusBanner delta={delta} onDismiss={() => setDelta(null)} />` above the operations list.
5. When delta contains `updated` ops, invalidate/refetch the local operations list so the table reflects the latest state.
6. Guard the entire feature with `CONSOLE_RECONNECT_SYNC_ENABLED` env flag (read via `import.meta.env.VITE_CONSOLE_RECONNECT_SYNC_ENABLED`; default `true`).

**Done when**: Manually verifiable: opening the operations page after a simulated `window.dispatchEvent(new Event('online'))` triggers a re-fetch and banner appears if delta is non-empty.

---

## Execution Order

```
TASK-01 (type extension)
  └─► TASK-02 (reconcileOperations util)
        ├─► TASK-03 (unit tests for util)
        └─► TASK-04 (useReconnectStateSync hook)
              ├─► TASK-05 (unit tests for hook)
              ├─► TASK-07 (integration UI tests)  ◄── also needs TASK-06
              ├─► TASK-08 (tenant isolation tests)
              └─► TASK-11 (wire into page)        ◄── also needs TASK-06

TASK-06 (OperationStatusBanner)  [parallel with TASK-04]
TASK-09 (contract tests)         [parallel with TASK-02+]
TASK-10 (ADR)                    [parallel with all]
```

---

## Done Criteria (all must be satisfied before PR)

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `OperationStatus` includes `timed_out` and `cancelled` | TypeScript compiles clean |
| 2 | `reconcileOperations` exported and all 12 unit tests pass | `node --test tests/unit/reconcile-operations.test.mjs` green |
| 3 | `useReconnectStateSync` hook exported and 8 unit tests pass | `pnpm --filter web-console test` green |
| 4 | `OperationStatusBanner` renders consolidated delta | 10 integration tests green |
| 5 | Multi-tenant isolation verified on reconnect | 4 tenant isolation tests green |
| 6 | Contract tests for query endpoint pass (or skip with message) | `node --test tests/contract/async-operation-query-reconnect.contract.test.mjs` exits 0 |
| 7 | Hook wired into operations page with feature flag guard | Manual smoke test + no TS errors |
| 8 | ADR committed | `docs/adr/077-reconnect-job-state-reread.md` present |
| 9 | No modifications to `services/provisioning-orchestrator/src/` | `git diff services/` shows nothing |
| 10 | `pnpm test` in repo root passes without new failures | CI green |
