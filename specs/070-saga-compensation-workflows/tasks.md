# Tasks: Saga/Compensation for Console Backend Workflows

**Feature**: `070-saga-compensation-workflows`  
**Task ID**: US-UIB-01-T04  
**Epic**: EP-16 — Backend funcional de la consola  
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura  
**Generated**: 2026-03-29  
**Spec**: `specs/070-saga-compensation-workflows/spec.md`  
**Plan**: `specs/070-saga-compensation-workflows/plan.md`

> **Scope boundary**: T04 only — saga orchestration engine, state persistence, compensation triggering and retry, idempotency, correlation propagation, saga state exposure, and workflow step definitions. Does NOT include: audit pipeline implementation (T05), E2E failure testing (T06), job/operation status UI (US-UIB-02), or individual OpenWhisk action base implementations (T02).

---

## File Map

### New Files to Create

| # | Path | Description |
|---|------|-------------|
| F-01 | `services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql` | DDL: `saga_instances`, `saga_steps`, `saga_compensation_log` |
| F-02 | `apps/control-plane/src/saga/saga-config.mjs` | Tunable defaults: retry counts, backoff, recovery thresholds |
| F-03 | `apps/control-plane/src/saga/saga-state-store.mjs` | PostgreSQL persistence facade (CRUD for saga instances and steps) |
| F-04 | `apps/control-plane/src/saga/saga-idempotency.mjs` | Idempotency key check and result cache |
| F-05 | `apps/control-plane/src/saga/saga-correlation.mjs` | Correlation-id lifecycle and context enrichment |
| F-06 | `apps/control-plane/src/saga/saga-compensation.mjs` | Compensation sequencer with retry/backoff loop |
| F-07 | `apps/control-plane/src/saga/saga-engine.mjs` | Core orchestrator: forward execution + compensation trigger + recovery |
| F-08 | `apps/control-plane/src/saga/saga-definitions.mjs` | Step registry for WF-CON-001 through WF-CON-006 |
| F-09 | `apps/control-plane/src/saga/saga-status.mjs` | Status query surface (consumed by US-UIB-02) |
| F-10 | `apps/control-plane/src/saga/index.mjs` | Barrel export for the saga module |
| F-11 | `services/internal-contracts/src/saga-contract.json` | JSON Schema: `SagaStatusResponse` |
| F-12 | `tests/saga/saga-engine.test.mjs` | Unit tests: engine orchestration |
| F-13 | `tests/saga/saga-compensation.test.mjs` | Unit tests: compensation sequencer |
| F-14 | `tests/saga/saga-idempotency.test.mjs` | Unit tests: idempotency key behavior |
| F-15 | `tests/saga/saga-state-store.test.mjs` | Unit tests: state store CRUD with in-memory stubs |
| F-16 | `tests/saga/saga-definitions.test.mjs` | Unit tests: step definition completeness assertions |

### Files to Modify

| # | Path | Change Description |
|---|------|--------------------|
| M-01 | `services/internal-contracts/src/index.mjs` | Add export of `sagaContract` from `./saga-contract.json` |
| M-02 | `apps/control-plane/src/workflows/wf-con-001.mjs` | Wrap steps to accept `sagaCtx`; export `forward` + `compensate` per step |
| M-03 | `apps/control-plane/src/workflows/wf-con-002.mjs` | Same as M-02 |
| M-04 | `apps/control-plane/src/workflows/wf-con-003.mjs` | Same as M-02 |
| M-05 | `apps/control-plane/src/workflows/wf-con-004.mjs` | Same as M-02 |
| M-06 | `apps/control-plane/src/workflows/wf-con-006.mjs` | Same as M-02 (scaffold stubs if WF-CON-006 is not yet fully defined) |
| M-07 | `apps/control-plane/src/console-backend-functions.mjs` | Expose `executeSaga` and `getSagaStatus` invocation wrappers |

---

## Validation Commands

Run these after implementation to verify task completion:

```bash
# 1. Confirm all new source files exist
ls apps/control-plane/src/saga/*.mjs
ls services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql
ls services/internal-contracts/src/saga-contract.json
ls tests/saga/*.test.mjs

# 2. Run full unit test suite (Node built-in test runner)
node --test tests/saga/saga-engine.test.mjs
node --test tests/saga/saga-compensation.test.mjs
node --test tests/saga/saga-idempotency.test.mjs
node --test tests/saga/saga-state-store.test.mjs
node --test tests/saga/saga-definitions.test.mjs

# 3. Validate saga-contract.json is importable and structurally sound
node -e "import('./services/internal-contracts/src/saga-contract.json', { assert: { type: 'json' } }).then(m => console.log('Contract OK:', Object.keys(m.default)))"

# 4. Verify barrel export includes all saga modules
node -e "import('./apps/control-plane/src/saga/index.mjs').then(m => console.log('Exports:', Object.keys(m)))"

# 5. Smoke test internal-contracts index exports sagaContract
node -e "import('./services/internal-contracts/src/index.mjs').then(m => { if (!m.sagaContract) throw new Error('sagaContract not exported'); console.log('sagaContract OK'); })"

# 6. Run all saga tests via root test runner (adjust command per AGENTS.md)
node --test 'tests/saga/**/*.test.mjs'
```

---

## Tasks

Tasks are ordered by dependency. Each task is self-contained and executable by a constrained implement subagent. Tasks within the same group may be parallelized.

---

### GROUP A — DDL Migration
> Prerequisite for all state-store work. No code dependencies.

---

#### TASK-001 — Create PostgreSQL DDL migration for saga state tables

**File to create**: `services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql`

**What to implement**:  
Create three tables with all columns, constraints, and indexes as specified in plan.md §5.1:

1. **`saga_instances`** table:
   - Columns: `saga_id UUID PK`, `workflow_id TEXT NOT NULL`, `idempotency_key TEXT UNIQUE`, `correlation_id TEXT NOT NULL`, `tenant_id TEXT NOT NULL`, `workspace_id TEXT`, `actor_type TEXT NOT NULL`, `actor_id TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'executing'`, `recovery_policy TEXT NOT NULL DEFAULT 'compensate'`, `input_snapshot JSONB NOT NULL`, `output_snapshot JSONB`, `error_summary JSONB`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - Valid status values (comment): `executing | compensating | completed | compensated | compensation-failed`
   - Valid recovery_policy values (comment): `resume | compensate`
   - Indexes: `idx_saga_instances_status_updated ON (status, updated_at)`, `idx_saga_instances_correlation ON (correlation_id)`, `idx_saga_instances_tenant ON (tenant_id)`

2. **`saga_steps`** table:
   - Columns: `step_id UUID PK`, `saga_id UUID NOT NULL REFERENCES saga_instances(saga_id)`, `step_ordinal INTEGER NOT NULL`, `step_key TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'pending'`, `input_snapshot JSONB NOT NULL`, `output_snapshot JSONB`, `error_detail JSONB`, `compensation_attempts INTEGER NOT NULL DEFAULT 0`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - Valid status values (comment): `pending | executing | succeeded | failed | compensating | compensated | compensation-failed`
   - Constraints: `UNIQUE(saga_id, step_ordinal)`
   - Indexes: `idx_saga_steps_saga_id ON (saga_id)`

3. **`saga_compensation_log`** table:
   - Columns: `log_id UUID PK`, `saga_id UUID NOT NULL REFERENCES saga_instances(saga_id)`, `step_id UUID NOT NULL REFERENCES saga_steps(step_id)`, `attempt INTEGER NOT NULL`, `outcome TEXT NOT NULL`, `error_detail JSONB`, `executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - Valid outcome values (comment): `succeeded | failed | skipped-idempotent`

All statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.

**Acceptance check**: File exists, contains all three `CREATE TABLE IF NOT EXISTS` blocks, all three index groups, and all FK constraints.

---

### GROUP B — Configuration and Pure Utility Modules
> No database dependency. Can be implemented immediately after TASK-001 is authored.

---

#### TASK-002 — Create `saga-config.mjs`

**File to create**: `apps/control-plane/src/saga/saga-config.mjs`

**What to implement**:  
Export a single named constant `SAGA_CONFIG` with the following structure (see plan.md §9):

```js
export const SAGA_CONFIG = {
  compensation: {
    maxRetries: 3,
    baseDelayMs: 500,
    backoffMultiplier: 2.0,
    maxDelayMs: 10_000
  },
  recovery: {
    staleness_threshold_ms: 60_000,
    default_policy: 'compensate'
  },
  idempotency: {
    ttl_ms: 86_400_000
  }
};
```

Environment variable overrides (read from `process.env` at module load, fall back to defaults):
- `SAGA_COMPENSATION_MAX_RETRIES` → `compensation.maxRetries` (parseInt)
- `SAGA_COMPENSATION_BASE_DELAY_MS` → `compensation.baseDelayMs` (parseInt)
- `SAGA_COMPENSATION_MAX_DELAY_MS` → `compensation.maxDelayMs` (parseInt)
- `SAGA_RECOVERY_STALENESS_MS` → `recovery.staleness_threshold_ms` (parseInt)

**Acceptance check**: Module loads without error; `SAGA_CONFIG.compensation.maxRetries` equals 3 (or env override value).

---

#### TASK-003 — Create `saga-correlation.mjs`

**File to create**: `apps/control-plane/src/saga/saga-correlation.mjs`

**What to implement** (see plan.md §7.5):

```js
// Public API
export function buildCorrelationId(workflowId, callerContext): string
export function enrichContextWithCorrelation(sagaCtx, existingCorrelationId): SagaContext
```

**`buildCorrelationId(workflowId, callerContext)`**:
- Returns a string in format: `saga:{workflowId}:{tenantId}:{timestamp}:{random8}`
- `timestamp` is `Date.now()` as base36
- `random8` is 8 random alphanumeric characters

**`enrichContextWithCorrelation(sagaCtx, existingCorrelationId)`**:
- If `existingCorrelationId` is provided (non-null), builds a child ID: `{existingCorrelationId}::saga:{sagaCtx.workflowId}:{random8}` and attaches it as `sagaCtx.correlationId`
- If no existing ID, calls `buildCorrelationId` and attaches the result
- Returns the enriched `sagaCtx`

No external dependencies. Pure ESM module.

**Acceptance check**: `buildCorrelationId('WF-CON-002', { tenantId: 't1' })` returns a string matching `^saga:WF-CON-002:t1:[a-z0-9]+:[a-z0-9]{8}$`.

---

### GROUP C — State Store
> Depends on: TASK-001 (for schema knowledge), TASK-002 (for config).

---

#### TASK-004 — Create `saga-state-store.mjs`

**File to create**: `apps/control-plane/src/saga/saga-state-store.mjs`

**What to implement** (see plan.md §7.2):

```js
// Public API
export async function createSagaInstance(workflowId, params, callerCtx, correlationId, idempotencyKey): SagaInstance
export async function updateSagaStatus(sagaId, status, outputOrError): void
export async function createSagaStep(sagaId, ordinal, key, input): SagaStep
export async function updateStepStatus(stepId, status, outputOrError): void
export async function updateStepCompensationAttempts(stepId, attempts): void
export async function getInFlightSagas(stalenessMs): SagaInstance[]
export async function getSagaById(sagaId): SagaInstance
export async function listStepsForSaga(sagaId): SagaStep[]
export async function appendCompensationLog(sagaId, stepId, attempt, outcome, errorDetail): void
```

**Implementation requirements**:
- Import and use `services/adapters/src/postgresql-data-api.mjs` exclusively. No raw DB connections.
- `createSagaInstance`: INSERT into `saga_instances`; returns the inserted row.
- `updateSagaStatus`: UPDATE `saga_instances SET status = $status, updated_at = NOW()` (+ set `output_snapshot` or `error_summary` when provided) WHERE `saga_id = $id`.
- `createSagaStep`: INSERT into `saga_steps`; returns inserted row.
- `updateStepStatus`: UPDATE `saga_steps SET status = $status, updated_at = NOW()` (+ `output_snapshot` or `error_detail` when provided) WHERE `step_id = $id`.
- `getInFlightSagas`: SELECT FROM `saga_instances WHERE status IN ('executing','compensating') AND updated_at < NOW() - INTERVAL $staleness`.
- All queries that expose data to a caller must accept and enforce `tenant_id` in WHERE clauses (see plan.md §12).
- Do NOT write secrets or full credential values to `input_snapshot` / `output_snapshot`; document this with a JSDoc comment.

**Acceptance check**: File exists; all exported functions are async; `createSagaInstance` and `createSagaStep` call the PostgreSQL adapter; no raw `pg` import present.

---

### GROUP D — Idempotency Module
> Depends on: TASK-004 (uses state store).

---

#### TASK-005 — Create `saga-idempotency.mjs`

**File to create**: `apps/control-plane/src/saga/saga-idempotency.mjs`

**What to implement** (see plan.md §7.4):

```js
// Public API
export async function checkIdempotencyKey(key, tenantId): IdempotencyRecord | null
export async function recordIdempotencyResult(key, tenantId, sagaId, result): void
```

**`checkIdempotencyKey(key, tenantId)`**:
- Query `saga_instances WHERE idempotency_key = $key AND tenant_id = $tenantId`
- If no row found: return `null`
- If row found and `status = 'completed'`: return `{ sagaId, status: 'completed', result: output_snapshot }`
- If row found and `status = 'executing'`: return `{ sagaId, status: 'in-progress' }`
- If row found and `status` is terminal error: return `{ sagaId, status: row.status }`

**`recordIdempotencyResult(key, tenantId, sagaId, result)`**:
- UPDATE `saga_instances SET output_snapshot = $result WHERE saga_id = $sagaId AND tenant_id = $tenantId`
- The `idempotency_key` field is set during `createSagaInstance` in the state store (TASK-004); this function only updates the result cache.

**Acceptance check**: `checkIdempotencyKey` for unknown key returns null; for a completed saga returns cached result.

---

### GROUP E — Compensation Sequencer
> Depends on: TASK-002 (config), TASK-004 (state store).

---

#### TASK-006 — Create `saga-compensation.mjs`

**File to create**: `apps/control-plane/src/saga/saga-compensation.mjs`

**What to implement** (see plan.md §7.3 and §4.3):

```js
// Public API
export async function compensateSaga(sagaInstance, succeededSteps, definition, sagaCtx): CompensationResult
// CompensationResult: { allCompensated: boolean, failedSteps: string[] }
```

**Algorithm**:

1. Sort `succeededSteps` by `step_ordinal` descending (reverse order).
2. For each step:
   a. Find the matching step definition in `definition.steps` by ordinal.
   b. If `step.status === 'compensated'`: log as `skipped-idempotent` via state store and continue (idempotent skip).
   c. UPDATE step status to `'compensating'` via state store.
   d. Retry loop (up to `SAGA_CONFIG.compensation.maxRetries`):
      - Attempt `stepDef.compensate(step.input_snapshot, step.output_snapshot, sagaCtx)`.
      - On success: UPDATE step status to `'compensated'`; append log entry `outcome='succeeded'`; break.
      - On failure: increment attempt counter; append log entry `outcome='failed'`; if retries remain, wait `min(baseDelayMs * (backoffMultiplier ^ attempt), maxDelayMs)` ms, then retry.
   e. If all retries exhausted: UPDATE step status to `'compensation-failed'`; add step key to `failedSteps`.
3. Return `{ allCompensated: failedSteps.length === 0, failedSteps }`.

**Backoff helper** (private):
```js
function backoffDelay(attempt, config) {
  return Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs
  );
}
```

**Acceptance check**: File exists; `compensateSaga` iterates steps in reverse ordinal order; retries up to `maxRetries`; returns `{ allCompensated, failedSteps }`.

---

### GROUP F — Core Engine
> Depends on: TASK-003, TASK-004, TASK-005, TASK-006.

---

#### TASK-007 — Create `saga-engine.mjs`

**File to create**: `apps/control-plane/src/saga/saga-engine.mjs`

**What to implement** (see plan.md §7.1, §4.2, §4.3, §4.4):

```js
// Public API
export async function executeSaga(workflowId, params, callerContext): SagaResult
export async function recoverInFlightSagas(stalenessThresholdMs): RecoverySummary
```

**`executeSaga(workflowId, params, callerContext)`**:

1. Resolve definition from `saga-definitions.mjs` by `workflowId`. Throw `{ code: 'WORKFLOW_NOT_FOUND' }` if missing.
2. If definition is `provisional: true`, return `{ status: 'not-implemented', workflowId }` immediately (no DB row).
3. Check idempotency key (from `params.idempotencyKey` if provided) via `saga-idempotency.mjs`:
   - If `status: 'completed'` → return cached result.
   - If `status: 'in-progress'` → return `{ status: 'in-progress', sagaId }`.
4. Build correlation context via `saga-correlation.mjs` (`buildCorrelationId` or use `callerContext.correlationId` as parent).
5. INSERT `saga_instances` via state store (`status='executing'`).
6. Build `sagaCtx = { sagaId, correlationId, tenantId, workspaceId, actorType, actorId }`.
7. For each step in definition (ascending `ordinal`):
   a. INSERT `saga_steps` (`status='pending'`).
   b. UPDATE step to `status='executing'`.
   c. Call `stepDef.forward(params, sagaCtx)`.
   d. On success: UPDATE step `status='succeeded'`, store `output_snapshot`.
   e. On failure: UPDATE step `status='failed'`, store `error_detail`. Call `compensateSaga(...)` with all previously `succeeded` steps. Then UPDATE `saga_instances.status` to `'compensated'` or `'compensation-failed'`. Throw error (caller receives failure).
8. UPDATE `saga_instances.status = 'completed'`.
9. Cache result via `saga-idempotency.mjs` if idempotency key was provided.
10. Return `{ sagaId, status: 'completed', output: lastStepOutput }`.

**Rule**: Do NOT proceed to step N+1 until step N is durably recorded as `succeeded` (FR-011).

**`recoverInFlightSagas(stalenessThresholdMs)`** (see plan.md §4.4):

1. Call `state-store.getInFlightSagas(stalenessThresholdMs)`.
2. For each stale saga:
   - Load step list via `listStepsForSaga`.
   - If `saga.status = 'executing'` and `recovery_policy = 'compensate'`: trigger `compensateSaga` for all `succeeded` steps.
   - If `saga.status = 'compensating'`: resume `compensateSaga` for all steps NOT yet `compensated`.
3. Return summary `{ recovered: number, failedToRecover: string[] }`.

**Emit alert** on `compensation-failed` outcome: import `apps/control-plane/src/events-admin.mjs` and publish a `saga.compensation-failed` event with `{ sagaId, workflowId, failedSteps }`. If `events-admin.mjs` does not exist, add a `// TODO(T05): wire real alert` comment stub.

**Acceptance check**: `executeSaga` inserts saga instance, iterates steps, triggers compensation on failure; `recoverInFlightSagas` processes stale sagas.

---

### GROUP G — Workflow Step Definitions
> Depends on: TASK-007 (engine structure/contract), M-02 through M-06 (step callables).

---

#### TASK-008 — Create `saga-definitions.mjs` with WF-CON-001 through WF-CON-006

**File to create**: `apps/control-plane/src/saga/saga-definitions.mjs`

**What to implement** (see plan.md §6):

Export a single `Map` (or plain object keyed by `workflowId`) containing definitions for all 6 cataloged workflows. Each definition:

```js
{
  workflowId: 'WF-CON-XXX',
  provisional: boolean,      // true only for WF-CON-005
  recoveryPolicy: 'compensate' | 'resume',
  steps: [
    {
      ordinal: N,
      key: 'step-key-string',
      forward: async (params, sagaCtx) => { ... },
      compensate: async (inputSnapshot, outputSnapshot, sagaCtx) => { ... }
    }
  ]
}
```

**WF-CON-001 — User Approval (2 steps)**:
| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `assign-keycloak-role` | Import and call the `assignKeycloakRole` forward from `../workflows/wf-con-001.mjs` | Call `revokeKeycloakRole` compensate |
| 2 | `update-membership-record` | Import and call `updateMembershipRecord` forward | Call `revertMembershipRecord` compensate |

**WF-CON-002 — Tenant Provisioning (4 steps)**:
| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `create-keycloak-realm` | `createKeycloakRealm` | `deleteKeycloakRealm` |
| 2 | `create-postgresql-boundary` | `createPostgresqlBoundary` | `deletePostgresqlBoundary` |
| 3 | `create-kafka-namespace` | `createKafkaNamespace` | `deleteKafkaNamespace` |
| 4 | `configure-apisix-routes` | `configureApisixRoutes` | `removeApisixRoutes` |

**WF-CON-003 — Workspace Creation (3 steps)**:
| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `create-keycloak-client` | `createKeycloakClient` | `deleteKeycloakClient` |
| 2 | `create-postgresql-workspace` | `createPostgresqlWorkspace` | `deletePostgresqlWorkspace` |
| 3 | `reserve-s3-storage` | `reserveS3Storage` | `releaseS3Storage` |

**WF-CON-004 — Credential Generation (3 steps)**:
| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `create-keycloak-credential` | `createKeycloakCredential` | `revertKeycloakCredential` |
| 2 | `sync-apisix-consumer` | `syncApisixConsumer` | `removeApisixConsumer` |
| 3 | `record-credential-metadata` | `recordCredentialMetadata` | `deleteCredentialMetadata` |

**WF-CON-005 — Extension Point**:
- `provisional: true`, `steps: []`
- Include a comment: `// WF-CON-005 is provisional; add steps when catalog entry is finalized`

**WF-CON-006 — Scaffold**:
- Import step callables from `../workflows/wf-con-006.mjs`
- If the file does not yet define named exports, use async stub functions that `throw new Error('WF-CON-006 step not implemented')` (matching the catalog entry status)
- Include a comment: `// WF-CON-006 steps to be completed when catalog entry is finalized per specs/067`

**Forward/compensate idempotency pattern** (add JSDoc for each step callable):
- Forward: query-before-create; if resource exists with matching params, return existing as output.
- Compensate: query-before-delete; if resource absent, log as skipped and return success.

**Acceptance check**: `sagaDefinitions.get('WF-CON-002').steps.length === 4`; every non-provisional step has `typeof step.forward === 'function'` and `typeof step.compensate === 'function'`.

---

#### TASK-009 — Adapt workflow step files to export `forward` + `compensate` per step

**Files to modify**: `apps/control-plane/src/workflows/wf-con-001.mjs` through `wf-con-006.mjs`

**What to implement**:

For each workflow file, ensure each step function is exported with the contract expected by `saga-definitions.mjs`:
- Each step's **forward** function signature: `async (params, sagaCtx) => outputSnapshot`
- Each step's **compensate** function signature: `async (inputSnapshot, outputSnapshot, sagaCtx) => void`
- The `sagaCtx` parameter must be accepted (even if not yet used, to satisfy the engine contract).

If the existing file already exports differently (e.g., a single default export or a handler), add named exports for each step without removing existing exports (backward compatible).

**Example pattern** (add to each file):

```js
// Step 1 forward
export async function createKeycloakRealm(params, sagaCtx) { /* existing logic */ }
// Step 1 compensate
export async function deleteKeycloakRealm(inputSnapshot, outputSnapshot, sagaCtx) { /* reverse logic */ }
```

If any workflow file does not yet exist (e.g., WF-CON-006), create it with stub implementations that `throw new Error('Not implemented: <step name>')`.

**Idempotency pattern for every step function**:
- Forward: check if resource already exists before creating. If it does and matches expected params, return existing resource data as output.
- Compensate: check if resource exists before deleting. If it does not, return immediately (treat as already compensated).

**Acceptance check**: Each wf-con-*.mjs exports named functions for every step's `forward` and `compensate`. No existing exports removed.

---

### GROUP H — Status Query Surface and Contract

> Depends on: TASK-004 (state store).

---

#### TASK-010 — Create `saga-status.mjs`

**File to create**: `apps/control-plane/src/saga/saga-status.mjs`

**What to implement** (see plan.md §7.6):

```js
// Public API
export async function getSagaStatus(sagaId, callerContext): SagaStatusResponse
export async function listSagasForTenant(tenantId, filters, callerContext): SagaStatusPage
```

**`getSagaStatus(sagaId, callerContext)`**:
- Load `saga_instances` row via state store.
- Enforce tenant isolation: if `callerContext.role !== 'superadmin'` AND `sagaInstance.tenant_id !== callerContext.tenantId`, throw `{ code: 'FORBIDDEN', message: 'Cross-tenant saga access denied' }`.
- Load `saga_steps` for `sagaId` via state store.
- Return `SagaStatusResponse` (shape defined in plan.md §7.6):
  ```js
  {
    sagaId, workflowId, correlationId,
    status,
    currentStep: null | { ordinal, key, status },
    steps: [ { ordinal, key, status, updatedAt } ],
    startedAt, updatedAt,
    errorSummary: null | { failedStep, reason, uncompensatedSteps: [] }
  }
  ```
- `currentStep` is the first step with `status` in `['executing','compensating']`, or `null`.
- `errorSummary` is populated when `saga.status === 'compensation-failed'`.

**`listSagasForTenant(tenantId, filters, callerContext)`**:
- Enforce: only superadmin or a caller with matching `tenantId` may query.
- Support `filters`: `{ workflowId?, status?, limit?, offset? }` (defaults: `limit=20`, `offset=0`).
- Returns `{ items: SagaStatusResponse[], total: number, limit, offset }`.

**Acceptance check**: `getSagaStatus` rejects cross-tenant access for non-superadmin callers; returns `SagaStatusResponse` conforming to plan.md §7.6 shape.

---

#### TASK-011 — Create `saga-contract.json`

**File to create**: `services/internal-contracts/src/saga-contract.json`

**What to implement** (see plan.md §8):

Create the JSON Schema document exactly as specified in plan.md §8:
- Root: `SagaStatusResponse` with required fields `sagaId`, `workflowId`, `correlationId`, `status`, `steps`.
- `status` enum: `["executing","compensating","completed","compensated","compensation-failed"]`
- `currentStep`: `oneOf [null, SagaStepSummary]`
- `steps`: array of `SagaStepSummary`
- `SagaStepSummary` definition with `ordinal`, `key`, `status`, `updatedAt`; `status` enum includes all 7 step states.
- `SagaErrorSummary` definition with `failedStep`, `reason`, `uncompensatedSteps`.

**Acceptance check**: File is valid JSON; `JSON.parse(fs.readFileSync(...))` does not throw; `$schema`, `title`, `required`, `definitions` keys present.

---

#### TASK-012 — Add `sagaContract` export to `services/internal-contracts/src/index.mjs`

**File to modify**: `services/internal-contracts/src/index.mjs`

**What to add**:

```js
export { default as sagaContract } from './saga-contract.json' assert { type: 'json' };
```

Add this export without removing or modifying any existing exports.

**Acceptance check**: `import { sagaContract } from './services/internal-contracts/src/index.mjs'` resolves and `sagaContract.title === 'SagaStatusResponse'`.

---

### GROUP I — Barrel Export and Console Wiring

> Depends on: all saga module tasks (TASK-002 through TASK-010).

---

#### TASK-013 — Create `apps/control-plane/src/saga/index.mjs` barrel export

**File to create**: `apps/control-plane/src/saga/index.mjs`

**What to implement**:

```js
export { executeSaga, recoverInFlightSagas } from './saga-engine.mjs';
export { getSagaStatus, listSagasForTenant } from './saga-status.mjs';
export { SAGA_CONFIG } from './saga-config.mjs';
// Do not re-export internal modules (state-store, idempotency, etc.) — they are internal to the saga package
```

**Acceptance check**: `import { executeSaga, getSagaStatus } from './apps/control-plane/src/saga/index.mjs'` resolves.

---

#### TASK-014 — Wire `executeSaga` and `getSagaStatus` into `console-backend-functions.mjs`

**File to modify**: `apps/control-plane/src/console-backend-functions.mjs`

**What to add** (without removing existing exports):

1. Import `executeSaga` and `getSagaStatus` from `./saga/index.mjs`.
2. Export an `invokeWorkflow` wrapper:

   ```js
   export async function invokeWorkflow(workflowId, params, callerContext) {
     return executeSaga(workflowId, params, callerContext);
   }
   ```

3. Export a `queryWorkflowStatus` wrapper:

   ```js
   export async function queryWorkflowStatus(sagaId, callerContext) {
     return getSagaStatus(sagaId, callerContext);
   }
   ```

**Acceptance check**: Both `invokeWorkflow` and `queryWorkflowStatus` are exported from `console-backend-functions.mjs`.

---

### GROUP J — Test Suite

> Can be authored in parallel with implementation tasks; must pass once implementation is complete.

---

#### TASK-015 — Unit tests: `tests/saga/saga-engine.test.mjs`

**File to create**: `tests/saga/saga-engine.test.mjs`

**Test cases to implement** using `node:test` and mock adapters (in-memory stub for state store, no real PostgreSQL):

1. **Happy path**: `executeSaga('WF-CON-001', validParams, callerCtx)` — all steps succeed → `saga_instances.status = 'completed'`, all `saga_steps.status = 'succeeded'`.
2. **Compensation trigger**: Inject failure in step 2 of a 3-step workflow → `compensateSaga` is called for step 1 only; `saga_instances.status = 'compensated'`.
3. **Idempotency cached result**: Pre-populate mock state with completed saga for key `k1`; call `executeSaga` again with same key → returns cached result, no new DB rows.
4. **In-progress idempotency**: Pre-populate mock with `status='executing'` saga → returns `{ status: 'in-progress', sagaId }`.
5. **Recovery — compensate policy**: Seed mock with stale `executing` saga; call `recoverInFlightSagas(60000)` → stale saga is compensated.
6. **Correlation propagation**: Verify that `sagaCtx.correlationId` is non-null and matches expected format during step execution.
7. **WF-CON-005 provisional**: `executeSaga('WF-CON-005', ...)` returns `{ status: 'not-implemented' }` without inserting DB rows.
8. **Step ordering (FR-011)**: Verify step N+1 is not called until step N is recorded as succeeded (use call order tracking in mocks).

**Test infrastructure**: Create an in-memory mock for `saga-state-store.mjs` that stores data in `Map` objects. Mock `events-admin.mjs` as a no-op.

**Acceptance check**: All 8 test cases pass with `node --test tests/saga/saga-engine.test.mjs`.

---

#### TASK-016 — Unit tests: `tests/saga/saga-compensation.test.mjs`

**File to create**: `tests/saga/saga-compensation.test.mjs`

**Test cases to implement**:

1. **Reverse order**: 3 succeeded steps → compensation executes in order 3→2→1.
2. **Retry success on attempt 2**: First attempt throws; second attempt succeeds → step reaches `'compensated'`.
3. **All retries exhausted**: All 3 attempts throw → step reaches `'compensation-failed'`; `failedSteps` array contains step key.
4. **Idempotent skip**: Step already has `status='compensated'` → skips execution, logs `skipped-idempotent`, returns `allCompensated: true`.
5. **Backoff timing**: Verify delays between retries follow exponential backoff (mock `setTimeout` / clock).
6. **Mixed result**: 2 steps compensate successfully, 1 fails permanently → `allCompensated: false`, `failedSteps.length === 1`.

**Acceptance check**: All 6 test cases pass.

---

#### TASK-017 — Unit tests: `tests/saga/saga-idempotency.test.mjs`

**File to create**: `tests/saga/saga-idempotency.test.mjs`

**Test cases to implement**:

1. **Unknown key returns null**: `checkIdempotencyKey('unknown', 't1')` → `null`.
2. **Completed key returns cached result**: Pre-seed with completed saga → `{ sagaId, status: 'completed', result: ... }`.
3. **In-progress key**: Pre-seed with executing saga → `{ sagaId, status: 'in-progress' }`.
4. **Cross-tenant isolation**: Key `k1` for `tenant=t1` must not be found when queried with `tenant=t2`.

**Acceptance check**: All 4 test cases pass.

---

#### TASK-018 — Unit tests: `tests/saga/saga-state-store.test.mjs`

**File to create**: `tests/saga/saga-state-store.test.mjs`

**Test cases to implement** (mock PostgreSQL adapter, verify correct SQL fields and parameters):

1. **createSagaInstance**: Verify all required fields are present in the INSERT call (`saga_id`, `workflow_id`, `correlation_id`, `tenant_id`, `actor_type`, `actor_id`, `status='executing'`).
2. **updateSagaStatus to 'completed'**: Verify `status` and `updated_at` are updated; `output_snapshot` is set.
3. **createSagaStep + updateStepStatus**: Round-trip; verify `step_ordinal` and UNIQUE constraint logic.
4. **getInFlightSagas**: Mock returns 2 stale rows; verify returned array has 2 items.
5. **appendCompensationLog**: Verify `attempt`, `outcome`, and `executed_at` are written.

**Acceptance check**: All 5 test cases pass.

---

#### TASK-019 — Unit tests: `tests/saga/saga-definitions.test.mjs`

**File to create**: `tests/saga/saga-definitions.test.mjs`

**Test cases to implement**:

1. **All non-provisional workflows have ≥1 step**: `['WF-CON-001','WF-CON-002','WF-CON-003','WF-CON-004','WF-CON-006']` each have `steps.length >= 1`.
2. **Every step has `forward` and `compensate` functions**: For all non-provisional definitions and all steps.
3. **Ordinals are contiguous starting from 1**: No gaps, no duplicates.
4. **WF-CON-005 is provisional with 0 steps**: `provisional === true && steps.length === 0`.
5. **WF-CON-002 has exactly 4 steps**: Regression for the highest-risk workflow.
6. **Snapshot contract**: For each step, call `forward` with mock params and verify the returned output has the structure expected by the corresponding `compensate` signature (using a mock sagaCtx).

**Acceptance check**: All 6 test cases pass.

---

## Criteria of Done

Cross-reference with plan.md §17:

| CD | Criterion | Verifiable Evidence | Covered By |
|----|-----------|---------------------|------------|
| CD-01 | DDL migration exists with all 3 tables | File F-01 committed | TASK-001 |
| CD-02 | Engine executes WF-CON-001 through WF-CON-004 and WF-CON-006 (mocked) | TASK-015 tests pass | TASK-007, TASK-008 |
| CD-03 | Failed step triggers reverse compensation | `saga-engine.test.mjs` compensation test | TASK-007, TASK-006 |
| CD-04 | Compensation retries with exponential backoff | `saga-compensation.test.mjs` retry test | TASK-006, TASK-016 |
| CD-05 | Exhausted retries produce `compensation-failed` + alert | Unit test asserts status + event | TASK-007, TASK-006 |
| CD-06 | Duplicate idempotency key returns cached result | `saga-idempotency.test.mjs` | TASK-005, TASK-017 |
| CD-07 | `recoverInFlightSagas` detects stale sagas and compensates | Engine test with mock stale instance | TASK-007, TASK-015 |
| CD-08 | Every step carries `correlationId` in `sagaCtx` | Correlation propagation test in TASK-015 | TASK-003, TASK-007 |
| CD-09 | `getSagaStatus` returns schema-valid `SagaStatusResponse` | `saga-contract.json` + import test | TASK-010, TASK-011 |
| CD-10 | Cross-tenant rejection for non-superadmin callers | Status module test in TASK-010 | TASK-010 |
| CD-11 | All non-provisional definitions have `forward`+`compensate` per step | `saga-definitions.test.mjs` | TASK-008, TASK-019 |
| CD-12 | `index.mjs` exports `sagaContract` | Import smoke test | TASK-012 |
| CD-13 | No secrets written to snapshots | Code review; WF-CON-004 test assertion | TASK-009 |
| CD-14 | `node --test tests/saga/**/*.test.mjs` passes with zero failures | CI output | TASK-015–TASK-019 |

---

## Implementation Order (Recommended)

```text
TASK-001   (DDL migration)
TASK-002   (saga-config)        ← no deps
TASK-003   (saga-correlation)   ← no deps
  ↓
TASK-004   (saga-state-store)   ← needs TASK-002
  ↓
TASK-005   (saga-idempotency)   ← needs TASK-004
TASK-006   (saga-compensation)  ← needs TASK-002, TASK-004
  ↓
TASK-007   (saga-engine)        ← needs TASK-003, TASK-004, TASK-005, TASK-006
  ↓
TASK-008   (saga-definitions)   ← needs TASK-007 (interface contract)
TASK-009   (adapt wf files)     ← can parallel with TASK-008
TASK-010   (saga-status)        ← needs TASK-004
TASK-011   (saga-contract.json) ← no deps
TASK-012   (contracts/index)    ← needs TASK-011
  ↓
TASK-013   (barrel index)       ← needs all saga modules
TASK-014   (console-backend)    ← needs TASK-013
  ↓
TASK-015–019  (test suite)      ← can be authored earlier, must pass at end
```

---

*Tasks file: `specs/070-saga-compensation-workflows/tasks.md`*
