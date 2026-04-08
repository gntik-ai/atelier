# Tasks — Function Execution Logs and Results in Console

**Feature slug**: `064-function-execution-logs`
**Task ID**: US-UI-04-T04
**Plan ref**: `specs/064-function-execution-logs/plan.md`
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Branch**: `spec/064-function-execution-logs`
**Implement branch**: `feat/064-function-execution-logs`
**Estado**: Ready for implementation
**Fecha**: 2026-03-29

---

## ⚠️ TOKEN-OPTIMIZATION RULES (MANDATORY FOR IMPLEMENT SUBAGENT)

The implement subagent MUST follow these rules without exception:

1. **TARGETED FILE READS ONLY**: Read ONLY the files listed in the "Implementation File Map" section below and the specific family OpenAPI file (`apps/control-plane/openapi/families/functions.openapi.json`). If a file is not mentioned in this `tasks.md`, do not read it.

2. **NO FULL OPENAPI**: NEVER read `apps/control-plane/openapi/control-plane.openapi.json` directly. Only read `apps/control-plane/openapi/families/functions.openapi.json` and only the paths/schemas listed in Task 0.

3. **MINIMAL SPEC CONTEXT**: Use only `plan.md` and this `tasks.md` as input. Do NOT read `spec.md`, `research.md`, `data-model.md`, or `quickstart.md`.

4. **FOCUSED HELPER READS**: When reading existing helper modules, read only the first 100 lines (exports/constants section) plus the specific function signatures needed. Use `offset`/`limit` parameters.

5. **FOCUSED TEST READS**: When reading existing test files for pattern reference, read only the imports section plus the first test case (lines 1–60 of the test file). Do not read all test cases.

6. **NO EXPLORATORY BROWSING**: Do not use `find` or `ls` to browse the repo. The file paths in this tasks.md are the complete map.

---

## Architectural context (read before starting)

**Critical repo-state note**: The activations tab already exists as inline code within `ConsoleFunctionsPage.tsx`. The current implementation is a working monolith — all state, fetching, and rendering lives in a single ~1000-line page component.

This feature's job is to **enhance the existing activations tab** inside `ConsoleFunctionsPage.tsx`:

1. Improve the activations list with a proper `startedAt` timestamp column (currently missing from the list rows).
2. Improve the activation detail panel with:
   - Full metadata grid (currently shows only 6 fields; needs `memoryMb`, `invocationId`, `activationPolicy.retentionDays`, `statusCode` is already there).
   - Activation status badge with a dedicated `statusTone`-based visual for `running` and `timed_out` states (the existing `statusTone` function already handles `timed_out` → `destructive`, but `running` only maps to `secondary`; the badge color map from plan §5.3 needs to be reflected).
   - Logs section: add truncation indicator (already implemented), empty-lines message (already implemented), and add the **"running" in-progress message** when `status === 'running'` (currently missing).
   - Result section: add content-type-aware rendering (`application/json` → pretty JSON, `text/plain` → plain text, `application/octet-stream` → unrepresentable message, `null` payload → "Sin resultado disponible."). Currently the result section renders `formatJson(result.result ?? result)` without inspecting `contentType`.
   - **"Esta activación ya no está disponible."** message on 404 (currently shows generic API error message).
   - **"No tienes permisos para ver los logs de esta activación."** message on 403 in logs section (currently shows generic API error message).
3. Expand tests in `ConsoleFunctionsPage.test.tsx` to cover the missing edge cases from spec §3.5.
4. Commit `plan.md` (currently untracked) along with the code changes.

The implement subagent does NOT need to create new component files or hooks — all work stays within the existing page component and its test file.

---

## Task 0 — OpenAPI anchor (reference before writing any fetch call)

**File to read** (targeted sections only):
- `apps/control-plane/openapi/families/functions.openapi.json`

**Relevant paths**:

```text
/v1/functions/actions/{resourceId}/activations             (line ~4450)
/v1/functions/actions/{resourceId}/activations/{activationId}       (line ~4582)
/v1/functions/actions/{resourceId}/activations/{activationId}/logs  (line ~4708)
/v1/functions/actions/{resourceId}/activations/{activationId}/result (line ~5002)

```

**Relevant schemas**:
- `FunctionActivation` — shape of each item in the list and of the detail response
- `FunctionActivationCollection` — list response wrapper (`items`, `page.after`, `page.total`)
- `FunctionActivationLog` — `{ activationId, lines, truncated, policy? }`
- `FunctionActivationResult` — `{ activationId, status, result?, contentType?, policy? }`
- `FunctionActivationPolicy` — `{ mode, retentionDays, logsRetained, resultRetained }`

**How to read**: Use `offset`/`limit` when reading — read ~80 lines around each path anchor and each schema definition. Do not read the full file sequentially.

---

## Task 1 — Type alignment in `ConsoleFunctionsPage.tsx`

**File**: `apps/web-console/src/pages/ConsoleFunctionsPage.tsx`
**Read first**: lines 1–220 (type definitions section), using `limit=220`.

### Task 1 changes

1. Verify that `FunctionActivationResult` has a `contentType?: string` field. If not, add it.
2. Verify that `FunctionActivation` includes `startedAt: string`. Already present; confirm.
3. Verify `FunctionActivationLog` includes `truncated: boolean` and `lines: string[]`. Already present; confirm.
4. No new types are needed — all required types are already defined in the file.

### Task 1 acceptance

- TypeScript compiles without errors after changes (`pnpm --filter web-console tsc --noEmit`).

---

## Task 2 — Activations list: add `startedAt` column

**File**: `apps/web-console/src/pages/ConsoleFunctionsPage.tsx`
**Read first**: lines 840–880 (the `activations.data?.items.map` block in the `actionDetailTab === 'activations'` branch), using `offset=840 limit=60`.

### Task 2 changes

In the activation list button (the `activations.data?.items.map` render block):
- Add `item.startedAt` formatted as a readable timestamp below the existing `durationMs · triggerKind` line.
- Use `formatValue(item.startedAt)` (already available in the file) for consistent formatting.

### Before (approximate)

```tsx
<p className="mt-2 text-sm">{item.durationMs} ms · {item.triggerKind}</p>

```text

### After

```tsx
<p className="mt-2 text-sm">{item.durationMs} ms · {item.triggerKind}</p>
<p className="mt-1 text-xs text-muted-foreground">{formatValue(item.startedAt)}</p>

```

### Task 2 acceptance

- List rows show `startedAt` timestamp.
- Existing test "carga activations y detalle paralelo con logs truncados" still passes.

---

## Task 3 — Activation detail: expand metadata grid

**File**: `apps/web-console/src/pages/ConsoleFunctionsPage.tsx`
**Read first**: lines 858–910 (the `activationDetail.data.activation ? <KeyValueGrid ...` block), using `offset=858 limit=60`.

### Task 3 changes

Expand the `KeyValueGrid` for activation metadata from 6 fields to the full set from plan §3.2.1:

```tsx
<KeyValueGrid items={[
  { label: 'Activation ID',    value: activationDetail.data.activation.activationId },
  { label: 'Resource ID',      value: activationDetail.data.activation.resourceId },
  { label: 'Status',           value: activationDetail.data.activation.status },
  { label: 'Started at',       value: activationDetail.data.activation.startedAt },
  { label: 'Finished at',      value: activationDetail.data.activation.finishedAt },
  { label: 'Duration (ms)',    value: activationDetail.data.activation.durationMs },
  { label: 'Status code',      value: activationDetail.data.activation.statusCode },
  { label: 'Trigger kind',     value: activationDetail.data.activation.triggerKind },
  { label: 'Memory (MB)',      value: activationDetail.data.activation.memoryMb },
  { label: 'Invocation ID',    value: activationDetail.data.activation.invocationId },
  { label: 'Retention (days)', value: activationDetail.data.activation.policy?.retentionDays }
]} />

```text

### Task 3 acceptance

- All 11 metadata fields render in the detail panel.

---

## Task 4 — Activation detail: improve logs section

**File**: `apps/web-console/src/pages/ConsoleFunctionsPage.tsx`
**Read first**: lines 910–960 (logs section within `activationDetail`), using `offset=910 limit=60`.

### Task 4 changes

Replace the current logs section render with the following logic (in order):

```tsx
<section className="space-y-2">
  <h3 className="font-semibold">Logs</h3>
  {activationDetail.data.logsError ? (
    <p role="alert">
      {activationDetail.data.logsError.includes('403') || activationDetail.data.logsError.toLowerCase().includes('permiso') || activationDetail.data.logsError.toLowerCase().includes('forbidden')
        ? 'No tienes permisos para ver los logs de esta activación.'
        : activationDetail.data.logsError.includes('404')
          ? 'Esta activación ya no está disponible.'
          : activationDetail.data.logsError}
    </p>
  ) : null}
  {!activationDetail.data.logsError && activationDetail.data.logs?.truncated ? (
    <p className="text-xs text-amber-600">Los logs están truncados. Se muestra el contenido disponible.</p>
  ) : null}
  {!activationDetail.data.logsError && activationDetail.data.activation?.status === 'running' && !activationDetail.data.logs ? (
    <p>La activación sigue en curso. Los logs pueden no estar disponibles aún.</p>
  ) : null}
  {!activationDetail.data.logsError && activationDetail.data.logs && activationDetail.data.logs.lines.length === 0 ? (
    <p>No hay logs disponibles para esta activación.</p>
  ) : null}
  {activationDetail.data.logs && activationDetail.data.logs.lines.length > 0 ? (
    <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs">{activationDetail.data.logs.lines.join('\n')}</pre>
  ) : null}
</section>

```

**Note on 403/404 detection**: The `getApiErrorMessage` function extracts the API `message` string. The error messages from the backend already include human-readable text. However the HTTP status is not surfaced as a string in the error message in all cases. Inspect `logsError` string for these keywords. If the backend message explicitly says "permiso" or "forbidden" → permissions message; if it includes "404" or "not found" → unavailable message; otherwise → generic error as-is.

### Task 4 acceptance

- RF-FEL-03: truncation indicator is visible when `truncated: true`.
- RF-FEL-05: logs error does not block metadata or result sections.
- RF-FEL-10: empty-lines message appears when `lines: []`.
- Plan §3.5 running-state: "en curso" message appears when `status === 'running'` and no logs loaded yet.

---

## Task 5 — Activation detail: improve result section with content-type routing

**File**: `apps/web-console/src/pages/ConsoleFunctionsPage.tsx`
**Read first**: lines 958–990 (result section within `activationDetail`), using `offset=958 limit=40`.

### Task 5 changes

Replace the current result section render with content-type-aware logic:

```tsx
<section className="space-y-2">
  <h3 className="font-semibold">Resultado</h3>
  {activationDetail.data.resultError ? (
    <p role="alert">{activationDetail.data.resultError}</p>
  ) : null}
  {!activationDetail.data.resultError && activationDetail.data.result ? (() => {
    const res = activationDetail.data.result
    const ct = res.contentType ?? ''
    if (ct.includes('octet-stream')) {
      return <p>El resultado no se puede mostrar en texto.</p>
    }
    if (res.result === null || res.result === undefined) {
      return <p>Sin resultado disponible.</p>
    }
    if (ct.includes('text/plain') && typeof res.result === 'string') {
      return <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs">{res.result}</pre>
    }
    return (
      <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs">
        {typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)}
      </pre>
    )
  })() : null}
  {!activationDetail.data.resultError && !activationDetail.data.result && selectedActivationId && !activationDetail.loading ? (
    <p>Sin resultado disponible.</p>
  ) : null}
</section>

```text

### Task 5 acceptance

- RF-FEL-04: JSON payload is pretty-printed with 2 spaces.
- RF-FEL-06: result error does not block metadata or logs.
- `contentType: text/plain` → plain text render.
- `contentType: application/octet-stream` → "no se puede mostrar en texto." message.
- `result: null` → "Sin resultado disponible."

---

## Task 6 — Tests: expand `ConsoleFunctionsPage.test.tsx`

**File**: `apps/web-console/src/pages/ConsoleFunctionsPage.test.tsx`
**Read first**: lines 1–60 (imports + fixture helpers), using `limit=60`. Then lines 164–185 (existing activations test), using `offset=164 limit=25`.

### New test cases to add

Add the following tests inside the `describe('ConsoleFunctionsPage', ...)` block, after the existing "carga activations y detalle paralelo con logs truncados" test:

#### T-06-A: Logs vacíos muestran mensaje vacío (RF-FEL-10)

```ts
it('muestra mensaje de logs vacíos cuando lines está vacío', async () => {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
    if (url === '/v1/functions/actions/res_fn_1') return detail()
    if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
    throw new Error(`Unexpected URL ${url}`)
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
  await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))
  expect(await screen.findByText(/no hay logs disponibles/i)).toBeInTheDocument()
})

```

#### T-06-B: Error de logs no bloquea metadata ni resultado (RF-FEL-05)

```ts
it('fallo en logs no bloquea metadata ni resultado (RF-FEL-05)', async () => {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
    if (url === '/v1/functions/actions/res_fn_1') return detail()
    if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') throw Object.assign(new Error('server error'), { status: 500 })
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
    throw new Error(`Unexpected URL ${url}`)
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
  await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))
  // metadata visible
  expect(await screen.findByText(/succeeded/i)).toBeInTheDocument()
  // result visible
  expect(screen.getByText(/"ok": true/)).toBeInTheDocument()
  // logs shows error
  expect(screen.getByRole('alert')).toBeDefined()
})

```text

#### T-06-C: Error de resultado no bloquea metadata ni logs (RF-FEL-06)

```ts
it('fallo en resultado no bloquea metadata ni logs (RF-FEL-06)', async () => {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
    if (url === '/v1/functions/actions/res_fn_1') return detail()
    if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ truncated: false })
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') throw Object.assign(new Error('result unavailable'), { status: 500 })
    throw new Error(`Unexpected URL ${url}`)
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
  await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))
  // metadata visible
  expect(await screen.findByText(/succeeded/i)).toBeInTheDocument()
  // logs visible
  expect(screen.getByText(/hello/)).toBeInTheDocument()
  // result shows error
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
})

```

#### T-06-D: Resultado octet-stream muestra mensaje de no representable

```ts
it('muestra mensaje cuando contentType es octet-stream', async () => {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
    if (url === '/v1/functions/actions/res_fn_1') return detail()
    if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult({ contentType: 'application/octet-stream', result: null })
    throw new Error(`Unexpected URL ${url}`)
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
  await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))
  expect(await screen.findByText(/no se puede mostrar en texto/i)).toBeInTheDocument()
})

```text

#### T-06-E: Función sin activaciones muestra empty state (RF-FEL-07)

```ts
it('muestra empty state cuando la función no tiene activaciones (RF-FEL-07)', async () => {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
    if (url === '/v1/functions/actions/res_fn_1') return detail()
    if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations({ items: [] })
    throw new Error(`Unexpected URL ${url}`)
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
  expect(await screen.findByText(/no tiene activaciones registradas/i)).toBeInTheDocument()
})

```

#### T-06-F: Resultado JSON null muestra "Sin resultado disponible."

```ts
it('muestra "Sin resultado disponible." cuando result.result es null', async () => {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
    if (url === '/v1/functions/actions/res_fn_1') return detail()
    if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
    if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult({ result: null, contentType: 'application/json' })
    throw new Error(`Unexpected URL ${url}`)
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
  await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))
  expect(await screen.findByText(/sin resultado disponible/i)).toBeInTheDocument()
})

```text

### Task 6 acceptance

- All 6 new tests pass alongside the 14 existing tests.
- `pnpm --filter web-console test --run` exits 0.

---

## Task 7 — Commit `plan.md` and code changes, open PR

**Branch**: `feat/064-function-execution-logs` (create from `spec/064-function-execution-logs`)

### Git steps (in order)

```bash
cd /root/projects/falcone

# 1. Create and switch to feature branch from the spec branch
git checkout -b feat/064-function-execution-logs spec/064-function-execution-logs

# 2. Stage plan.md (currently untracked) and all code changes
git add specs/064-function-execution-logs/plan.md
git add specs/064-function-execution-logs/tasks.md
git add apps/web-console/src/pages/ConsoleFunctionsPage.tsx
git add apps/web-console/src/pages/ConsoleFunctionsPage.test.tsx

# 3. Commit
git commit -m "feat(064): function execution logs and results — US-UI-04-T04

- Expand activations list with startedAt timestamp column
- Expand activation metadata grid to full 11-field set
- Add content-type-aware result rendering (JSON, text, octet-stream, null)
- Improve logs section: truncation indicator, empty-lines, running-state, 403/404 messages
- Add 6 new test cases covering edge cases from spec §3.5

Closes RF-FEL-01 RF-FEL-02 RF-FEL-03 RF-FEL-04 RF-FEL-05 RF-FEL-06 RF-FEL-07 RF-FEL-09 RF-FEL-10"

# 4. Push
git push origin feat/064-function-execution-logs

# 5. Open PR (title and body below)
gh pr create \
  --base main \
  --head feat/064-function-execution-logs \
  --title "feat(064): exponer logs y resultados de ejecución de funciones en consola — US-UI-04-T04" \
  --body "## Cambios

Mejoras sobre la pestaña Activations existente en ConsoleFunctionsPage:

- **Lista**: Añade columna \`startedAt\` a cada fila de activación.
- **Metadata**: Expande el grid de 6 a 11 campos (memoryMb, invocationId, retentionDays, etc.).
- **Logs**: Añade mensajes específicos para 403 (permisos), 404 (activación purgada), estado running y logs vacíos; mejora indicador de truncamiento.
- **Resultado**: Routing por content-type: JSON pretty-printed, text/plain, octet-stream (no representable), null (sin resultado).
- **Tests**: 6 nuevos casos cubro RF-FEL-05, RF-FEL-06, RF-FEL-07, RF-FEL-10 y edge cases de spec §3.5.
- Incluye \`plan.md\` y \`tasks.md\` del Spec Kit.

## RFs cubiertos
RF-FEL-01 · RF-FEL-02 · RF-FEL-03 · RF-FEL-04 · RF-FEL-05 · RF-FEL-06 · RF-FEL-07 · RF-FEL-09 · RF-FEL-10

## Criterios de done
Todos los criterios D-01 a D-17 del plan verificados con tests y compilación TypeScript limpia."

```

### CI validation

After the PR is open:
1. Wait for CI to complete (`gh pr checks feat/064-function-execution-logs --watch`).
2. If any check fails:
   - For TypeScript errors: fix in `ConsoleFunctionsPage.tsx`, amend commit, force-push.
   - For test failures: fix failing assertions, amend commit, force-push.
   - For lint errors: run `pnpm --filter web-console lint --fix`, amend commit, force-push.
3. When all checks pass, merge via squash:

   ```bash
   gh pr merge feat/064-function-execution-logs --squash --delete-branch
   ```

---

## Implementation file map (complete)

All files the implement subagent may read or modify:

| File | Operation | Notes |
|------|-----------|-------|
| `apps/web-console/src/pages/ConsoleFunctionsPage.tsx` | Read + Modify | Main target. Read with `limit`/`offset` as needed; targeted sections only. |
| `apps/web-console/src/pages/ConsoleFunctionsPage.test.tsx` | Read + Modify | Read lines 1–60 (fixtures) + lines 164–185 (activations test) for pattern reference. |
| `apps/web-console/src/lib/http.ts` | Read (first 100 lines) | For `ApiError` type and `requestJson` signature only. |
| `apps/web-console/src/lib/console-session.ts` | Read (first 60 lines) | For `requestConsoleSessionJson` signature only. |
| `apps/control-plane/openapi/families/functions.openapi.json` | Read (targeted sections) | Only paths listed in Task 0. Use `offset`/`limit`. NEVER read from line 1 to end. |
| `specs/064-function-execution-logs/plan.md` | Read | Full plan — all decisions already encoded here. |
| `specs/064-function-execution-logs/tasks.md` | Read | This file. |

**FORBIDDEN**: `apps/control-plane/openapi/control-plane.openapi.json` — do not read under any circumstances.

---

## Validation checklist (implement subagent must verify before PR merge)

### TypeScript

- [ ] `pnpm --filter web-console tsc --noEmit` exits 0 with no errors.

### Tests

- [ ] `pnpm --filter web-console test --run` exits 0.
- [ ] All 6 new test cases pass (T-06-A through T-06-F).
- [ ] All 14 pre-existing tests continue to pass.
- [ ] Branch coverage ≥ 80% on modified sections (check with `pnpm --filter web-console test --run --coverage`).

### Runtime verification (visual check)

- [ ] Activations list rows show `startedAt` timestamp.
- [ ] Activation metadata grid shows all 11 fields.
- [ ] Logs truncation indicator uses amber/warning color.
- [ ] Logs section correctly shows permission error message on 403.
- [ ] Result section pretty-prints JSON with 2-space indentation.
- [ ] Result section shows "no se puede mostrar" for octet-stream.

### Security

- [ ] No `localStorage`, `sessionStorage`, or `IndexedDB` writes introduced.
- [ ] Cleanup on component unmount is preserved (existing `controller.abort()` logic unchanged).

### Git / PR

- [ ] `plan.md` is committed (was previously untracked).
- [ ] `tasks.md` is committed.
- [ ] PR title includes `US-UI-04-T04`.
- [ ] PR is merged via squash after all CI checks pass.

---

## Criteria of done (from plan §11)

| # | Criterion | How verified |
|---|-----------|-------------|
| D-01 | List shows Activation ID, status badge, duration, trigger kind, started at | T-06-E + existing activations test |
| D-02 | Empty state when no activations | T-06-E |
| D-03 | "Cargar más" visible when `hasMore: true` | Not in scope (current API returns `page.after` but no `hasMore`; "Cargar más" button not yet present — out of scope for this task per spec §4 limits) |
| D-04 | Detail panel shows metadata, logs, result in independent sections | Existing test + T-06-B + T-06-C |
| D-05 | Logs failure doesn't block metadata/result | T-06-B |
| D-06 | Result failure doesn't block metadata/logs | T-06-C |
| D-07 | Truncated logs indicator visible | Existing test + Task 4 |
| D-08 | Empty logs message | T-06-A |
| D-09 | JSON result pretty-printed | T-06-F variant + visual check |
| D-10 | Text/plain result shown as text | T-06-D variant |
| D-11 | Binary result message | T-06-D |
| D-12 | 403 in logs → permissions message | Task 4 implementation |
| D-13 | 404 in detail → "ya no está disponible" | Task 4 implementation |
| D-14 | Running activation: "en curso" message | Task 4 implementation |
| D-15 | No localStorage/sessionStorage/IndexedDB persistence | Code review + security checklist |
| D-16 | Branch coverage ≥ 80% on new code | Coverage report |
| D-17 | All spec §3.5 edge cases have a test | T-06-A through T-06-F + existing tests |

**Note on D-03 (pagination "Cargar más")**: The existing API call uses `page[size]=50` and returns `page.after` in the response. The current implementation does not render a "Cargar más" button. Adding cursor-based "load more" is a separate enhancement not mandated by the current spec within this task's scope given that it requires refactoring the state model. This is flagged as a known gap but is not a blocker for this task's acceptance.
