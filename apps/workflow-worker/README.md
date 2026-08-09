# workflow-worker

Falcone Temporal **DSL interpreter worker**. Hosts the single generic
`DslInterpreterWorkflow` that executes any flow definition (apiVersion `v1.0`,
`packages/internal-contracts/src/flow-definition.json`) and the harness activities the
flow activity catalog (#360) plugs into.

## TypeScript / CommonJS deviation (why this is not an `.mjs` ESM service)

Unlike sibling services (`packages/realtime-gateway`, `packages/scheduling-engine`),
this package is **TypeScript compiled to CommonJS** and **deliberately does NOT declare
`"type": "module"`** in `package.json`.

This is a hard constraint of the **Temporal TypeScript SDK**, not a style choice:
`@temporalio/worker` processes workflow code through its **deterministic bundler**
(`bundleWorkflowCode`, Webpack under the hood). The bundler + the determinism sandbox
intercept Node built-ins at the module level, which is incompatible with Node's native
ESM loader (`import.meta`, top-level `await`, ESM resolution). The supported path is
CJS output. See `tsconfig.json` (`"module": "CommonJS"`).

## Runtime configuration (env)

| Variable             | Default            | Purpose                                    |
| -------------------- | ------------------ | ------------------------------------------ |
| `TEMPORAL_ADDRESS`   | `127.0.0.1:7233`   | Temporal frontend gRPC address             |
| `TEMPORAL_NAMESPACE` | `falcone-flows`    | Temporal namespace (tenancy ADR #356)      |
| `TEMPORAL_TASK_QUEUE`| `flows-main`       | Task queue the worker polls                |
| `WORKER_HEALTH_PORT` | `8080`             | HTTP probe port (`/livez`, `/readyz`)      |

Graceful shutdown: `SIGTERM`/`SIGINT` stops accepting new tasks, drains the current
poll, and exits 0.

## Node-ID activity naming convention (normative contract for monitoring #366)

Every activity dispatched by `DslInterpreterWorkflow` sets the Temporal **`activityId`
to the DSL node id** (optionally suffixed `#<loopCounter>` for an iterated node), via
`activityIdForNode` in `src/shared/naming.ts`. Because `activityId` is surfaced verbatim
on the `ActivityTaskScheduled` history event:

```text
history event ActivityTaskScheduled.activityId === DSL node.id   (or node.id#<n>)
```

every history event maps back unambiguously to a canvas node — no custom header parsing.
**#366 monitoring depends on this exact encoding.** Changing it is a breaking change to
the monitoring contract. A history-mapping test asserts it
(`tests/env/workflow-worker/node-id-naming.test.mjs`).

## Activity-interface contract (the #360 plug-in seam)

The activity catalog (#360) implements `executeTask` against the
`ActivityInput` → `ActivityResult` envelope in `src/shared/types.ts`:

```ts
interface ActivityInput {
  nodeId: string;                       // DSL node id (also the Temporal activityId)
  taskType: string;                     // catalog task identifier
  node: TaskNode;                       // the originating DSL task node
  params: Record<string, unknown>;      // resolved task parameters (node.input)
  tenant: TenantContext;                // tenant isolation envelope (tenantId, workspaceId, ...)
}
```

The interpreter NEVER invokes a task activity without a `TenantContext` (BaaS isolation
rule). This change ships only the stub `executeTask`; the real catalog replaces the body
while keeping the envelope stable.

### Workspace binding — the execution-token workspace is authoritative (#663)

Every first-party activity that touches a workspace-scoped surface — `llm.complete`
(BYOK provider/key/metering), `db.query` (RLS-scoped data), `events.publish`
(`evt.<workspaceId>.<topic>`), `functions.invoke` (function lookup) — executes against
the workspace the **per-execution token is bound to**: `TenantContext.workspaceId`,
which `src/activities/catalog.mjs::dispatchTask` validates against the execution token
(`assertExecutionToken`) **before** any registered activity runs.

`params.workspaceId` (the flow author's task `input`, i.e. `node.input`) is **never** a
legitimate way to choose the workspace. The shared resolver
`src/activities/workspace-binding.mjs::resolveActivityWorkspaceId(params, tenant)`
enforces this for all four activities:

- when the token workspace is present (production), it is used; a `params.workspaceId`
  that **differs** from it is rejected with a **non-retryable `FORBIDDEN`**
  (`"task input may not override the execution workspace"`). A `params.workspaceId` equal
  to the token workspace is a harmless no-op.
- when no token-bound workspace is present (the legacy interpreter graph-walk harness with
  execution-token enforcement disabled), it falls back to `params.workspaceId`.

Without this, a flow author who controls a task node's `input` could inject
`workspaceId: <sibling-workspace-B>` (same tenant) and make the task run against
workspace B's provider/key/quota/data while authenticated as workspace A — cross-workspace
resource theft. Asserted by `tests/blackbox/flow-activity-workspace-binding.test.mjs`.

### Execution-token key derivation rollout

Execution tokens use the `scrypt-v1` key derivation and are accepted only when the signed payload
declares that derivation. This deliberately fails closed for earlier HMAC-derived token formats.
Because a token can remain valid for up to 24 hours, an upgrade that changes this derivation must
be coordinated: pause new flow starts and schedules, wait 24 hours after the last token was minted,
roll out the control-plane executor and workflow worker together using the same release image set,
then resume flow starts. Do not use independent rolling updates of either component for this change.

## DSL → Temporal mapping (flow-definition-mapping.json)

| DSL node    | Temporal primitive                                           |
| ----------- | ------------------------------------------------------------ |
| `sequence`  | sequential awaits of each step                               |
| `parallel`  | `Promise.all` over branch futures                            |
| `task`      | `executeActivity('executeTask', { activityId, retry, ... })` |
| `branch`    | `evaluateExpression` activity per arm; route first truthy / default |
| `wait`      | `sleep(<ISO-8601 duration>)` durable timer                   |
| `approval`  | `setHandler(approvalSignal)`; `condition(signalReceived, timeout)` (no-timeout: `condition(signalReceived)`) |
| `sub-flow`  | `executeChild(DslInterpreterWorkflow)` inside a `CancellationScope` |

Per-task `retryPolicy` is mapped verbatim (`src/shared/mapping.ts`):
`maxAttempts → maximumAttempts`, `backoffCoefficient`, `initialInterval`,
`maximumInterval`, `nonRetryableErrors → nonRetryableErrorTypes`, and the
`timeouts.*` fields → the matching `ActivityOptions.*Timeout`.

### Approval node cancellation semantics

An `approval` node parks the run until the `flowApproval` signal arrives or the optional
`timeout` elapses. Cancelling the execution while it is parked on an approval node terminates
the run as **`Cancelled`** — it is never reinterpreted as a timeout. The timed wait uses
Temporal's built-in `condition(predicate, timeout)`, which manages the durable timer and lets an
external `CancelledFailure` propagate; the interpreter records **no** fabricated approval outcome
for a cancelled node (i.e. it does not write `{approved:false, timedOut:true}`). Legitimate
outcomes are unchanged: a real timeout records `{approved:false, timedOut:true}` and completes,
and an approval signal records `{approved, timedOut:false}` and completes.

### Sub-flow node — load-by-reference resolution

A `sub-flow` node runs the **real referenced child flow**. The parent starts the child as a
Temporal child workflow BY REFERENCE (`executeChild(DslInterpreterWorkflow, { flowId,
version, tenant, … })`), and the child resolves its own definition via the `loadFlowDefinition`
activity. That activity loads the **actual published version** from the control-plane Postgres
`flow_versions` table (`tenant_id, workspace_id, flow_id, version, definition_json`), scoped to
the **parent's tenant and workspace** (`TenantContext.tenantId` / `workspaceId`). It does **not**
substitute a placeholder.

- The store read is wired by `worker-deps.mjs::createFlowDefinitionLoader` (the
  `deps.loadFlowDefinition` dependency that `wireActivityDeps()` injects), bound to the worker's
  Postgres pool. `flow_versions` enforces **FORCE row-level security** keyed on the session GUCs
  `app.tenant_id` / `app.workspace_id`, and the worker connects as the non-`BYPASSRLS`
  `falcone_app` role — so the reader sets both GUCs inside a transaction (transaction-scoped
  `set_config(..., true)`) before the SELECT, which is ALSO explicitly predicate-scoped by
  tenant/workspace/flow/version (defense in depth). A cross-tenant or foreign-workspace
  reference therefore resolves to no row.
- An **unresolvable reference fails the parent** — it never silently completes a placeholder.
  The activity raises a non-retryable failure that `executeChild` propagates to the parent:
  - missing/foreign-scope `flowId`+`version` → `FlowDefinitionNotFound`;
  - a `version` that is not a positive integer → `InvalidFlowVersion`;
  - a stored definition with no nodes → `InvalidFlowDefinition`;
  - the loader dependency not wired into the worker → `CAPABILITY_UNAVAILABLE`.
- Version pinning is preserved across the boundary: the child loads + pins its own definition at
  child-workflow start, recorded in history (replay-deterministic). Top-level executions are
  unaffected — they carry the definition INLINE and never call `loadFlowDefinition`.

Asserted by `tests/env/workflow-worker/subflow-load-referenced-definition.test.mjs` (real-stack,
live Temporal + Postgres) and `tests/blackbox/flows-subflow-load-referenced-definition.test.mjs`.

## Determinism

All workflow code (`src/workflows/**`, plus the pure helpers it imports from
`src/shared/**`) uses ONLY Temporal SDK deterministic constructs — no `Date.now`,
`Math.random`, `fetch`, or I/O. CEL evaluation is delegated to the
`evaluateExpression` **activity** (runs outside the sandbox) per ADR-11 / design D4. The
SDK `WorkflowReplayer` is run over recorded fixture histories to catch regressions
(`tests/env/workflow-worker/replay.test.mjs`).

## Build

```text
pnpm --filter @in-falcone/workflow-worker build   # tsc → dist/ (CommonJS)
node dist/worker.js                                # run the worker
```

The container image (`Dockerfile`, `node:22-slim`, `USER 1000`) is built **from the
repo root** so the worker's workspace deps resolve, consistent with
`apps/control-plane-executor/Dockerfile`.
