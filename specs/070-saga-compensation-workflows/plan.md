# Implementation Plan: Saga/Compensation for Console Backend Workflows

**Branch**: `070-saga-compensation-workflows` | **Date**: 2026-03-29 | **Spec**: `specs/070-saga-compensation-workflows/spec.md`  
**Task**: US-UIB-01-T04  
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura  
**Epic**: EP-16 — Backend funcional de la consola  
**Catalog dependency**: `specs/067-console-workflow-catalog/catalog.md` (v1.0.0, US-UIB-01-T01, delivered)  
**Upstream dependency**: `specs/068-console-workflow-functions/plan.md` (US-UIB-01-T02, delivered)  
**Upstream dependency**: `specs/069-console-endpoint-separation/plan.md` (US-UIB-01-T03, delivered)

> **Scope boundary**: This plan covers T04 only — saga/compensation orchestration model, step state persistence, compensation triggering and retry, idempotency enforcement, correlation propagation, and saga state exposure. It does NOT include: audit pipeline implementation (T05), E2E failure testing (T06), job/operation status UI (US-UIB-02), or individual OpenWhisk action implementations (T02).

---

## 1. Summary

Implement a reusable saga orchestration engine as an ESM module inside `apps/control-plane/src/` that wraps the workflow step sequences defined by T02 with durable-state tracking, automatic compensation on failure, idempotent retries, and correlation-id propagation. The engine is invoked by the backend-tier workflow endpoints established in T03 and exposes saga state through a queryable status model consumable by US-UIB-02.

All five non-provisional workflows (WF-CON-001 through WF-CON-004, WF-CON-006) gain saga behavior. The provisional WF-CON-005 entry is registered as an extension point that can be wired to a saga definition once the concrete workflow is specified.

Durable state is stored in the platform's existing PostgreSQL infrastructure via the `services/adapters/src/postgresql-data-api.mjs` adapter. No new cluster infrastructure is required.

---

## 2. Constitution Check

- **Monorepo Separation of Concerns**: PASS — saga engine lands in `apps/control-plane/src/saga/`; PostgreSQL DDL for state tables lands in `services/provisioning-orchestrator/src/`; contract artifacts stay in `services/internal-contracts/src/`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — engine core can be merged and tested before any workflow definition is wired; each workflow definition can be added and verified independently.
- **Kubernetes and OpenShift Compatibility**: PASS — no new cluster-level resources; saga state table is additive to the existing PostgreSQL tenant boundary provisioned in prior features.
- **Quality Gates at the Root**: PASS — all new modules are exercisable via the existing root `node:test` scripts.
- **Documentation as Part of the Change**: PASS — spec, plan, and checklist artifacts accompany the branch.
- **API Symmetry**: PASS — saga state is exposed only through the existing backend-tier API surface; no privileged back-channel is introduced.
- **T04 scope boundary**: PASS — individual action implementations (T02), audit wiring (T05), E2E tests (T06), and job-status UI (US-UIB-02) are explicitly excluded. All saga outputs are structured to support those layers without rework.

---

## 3. Technical Context

**Language/Version**: Node.js 20+ ESM modules  
**Runtime target**: Apache OpenWhisk 2.0.x / 2.1.x, `nodejs:20`  
**Primary adapter dependencies**:
- `services/adapters/src/postgresql-data-api.mjs` — durable saga state
- `services/adapters/src/postgresql-admin.mjs` — schema migrations
- `apps/control-plane/src/console-backend-functions.mjs` — authorization surface (delivered by 004)
- `apps/control-plane/src/authorization-context.mjs` — caller context resolution
- `services/internal-contracts/src/index.mjs` — contract publication
- `services/internal-contracts/src/internal-service-map.json` — service registry

**Testing**: Node built-in `node:test`, existing root validation scripts  
**No new cluster resources** are provisioned by this task.

---

## 4. Target Architecture

### 4.1 Component Map

```text
┌──────────────────────────────────────────────────────────────────────┐
│  APISIX backend-tier  (T03)                                          │
│  POST /console/v1/internal/workflows/{workflowId}/invoke             │
│  GET  /console/v1/internal/workflows/jobs/{sagaId}/state             │
└───────────────────────┬──────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  apps/control-plane/src/saga/                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  saga-engine.mjs            (core orchestrator)                 │ │
│  │  saga-definitions.mjs       (WF registry → step arrays)         │ │
│  │  saga-state-store.mjs       (PostgreSQL persistence facade)      │ │
│  │  saga-compensation.mjs      (compensation sequencer + retries)   │ │
│  │  saga-idempotency.mjs       (key check / result cache)          │ │
│  │  saga-correlation.mjs       (correlation-id lifecycle)           │ │
│  │  saga-status.mjs            (state query surface for US-UIB-02)  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  apps/control-plane/src/workflows/  (T02 step callables)             │
│  wf-con-001.mjs  wf-con-002.mjs  wf-con-003.mjs                     │
│  wf-con-004.mjs  wf-con-006.mjs                                      │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ postgresql-data-api.mjs
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PostgreSQL  (existing cluster database)                             │
│  saga_instances   saga_steps   saga_compensation_log                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Saga Execution Flow — Forward Path

```text
invoke(workflowId, params, callerContext)
  1. saga-idempotency.mjs  → check idempotency key; return cached result if duplicate
  2. saga-state-store.mjs  → INSERT saga_instances (status=executing, correlation_id)
  3. for each step in definition (ordered):
       a. saga-state-store.mjs → INSERT saga_steps (step_ordinal, status=pending)
       b. call step.forward(params, sagaContext)
       c. if success → UPDATE saga_steps(status=succeeded, output_snapshot)
       d. if failure → compensate() then throw
  4. UPDATE saga_instances(status=completed)
  5. saga-idempotency.mjs → cache result against key
  6. return { sagaId, status: 'completed', output }
```

### 4.3 Saga Execution Flow — Compensation Path

```text
compensate(sagaInstance, failedStepOrdinal)
  1. collect succeeded steps in reverse order (ordinal N → 1)
  2. for each step (reverse):
       a. saga-compensation.mjs → call step.compensate(input_snapshot, sagaContext)
          retry loop: max_retries (configurable, default 3), exponential backoff
          if step already compensated (idempotent check) → skip
       b. if retry success → UPDATE saga_steps(status=compensated)
       c. if all retries exhausted → UPDATE saga_steps(status=compensation-failed)
                                     log to saga_compensation_log
  3. if any step is compensation-failed:
       UPDATE saga_instances(status=compensation-failed)
       emit ALERT event via events-admin.mjs
  4. else: UPDATE saga_instances(status=compensated)
```

### 4.4 Recovery Flow (Process Restart)

```text
saga-engine.mjs:recoverInFlightSagas()
  1. SELECT * FROM saga_instances WHERE status IN ('executing','compensating')
     AND updated_at < NOW() - INTERVAL '<staleness_threshold>'
  2. for each stale saga:
       a. if status=executing → apply recovery policy:
            policy=resume  → re-enter forward loop from first pending/failed step
            policy=compensate → trigger compensate() for all succeeded steps
       b. if status=compensating → resume compensation from last uncompensated succeeded step
  Called on OpenWhisk action cold-start and by a scheduled heartbeat action.
```

---

## 5. Data Model

### 5.1 PostgreSQL DDL

**Table: `saga_instances`**

```sql
CREATE TABLE IF NOT EXISTS saga_instances (
  saga_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      TEXT         NOT NULL,                -- e.g. 'WF-CON-002'
  idempotency_key  TEXT         UNIQUE,                  -- caller-supplied; nullable for fire-and-forget
  correlation_id   TEXT         NOT NULL,
  tenant_id        TEXT         NOT NULL,
  workspace_id     TEXT,
  actor_type       TEXT         NOT NULL,
  actor_id         TEXT         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'executing',
    -- executing | compensating | completed | compensated | compensation-failed
  recovery_policy  TEXT         NOT NULL DEFAULT 'compensate',
    -- resume | compensate
  input_snapshot   JSONB        NOT NULL,
  output_snapshot  JSONB,
  error_summary    JSONB,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saga_instances_status_updated
  ON saga_instances(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_saga_instances_correlation
  ON saga_instances(correlation_id);
CREATE INDEX IF NOT EXISTS idx_saga_instances_tenant
  ON saga_instances(tenant_id);
```

**Table: `saga_steps`**

```sql
CREATE TABLE IF NOT EXISTS saga_steps (
  step_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id          UUID         NOT NULL REFERENCES saga_instances(saga_id),
  step_ordinal     INTEGER      NOT NULL,
  step_key         TEXT         NOT NULL,               -- human identifier, e.g. 'create-keycloak-realm'
  status           TEXT         NOT NULL DEFAULT 'pending',
    -- pending | executing | succeeded | failed | compensating | compensated | compensation-failed
  input_snapshot   JSONB        NOT NULL,
  output_snapshot  JSONB,
  error_detail     JSONB,
  compensation_attempts INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(saga_id, step_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_saga_steps_saga_id ON saga_steps(saga_id);
```

**Table: `saga_compensation_log`**

```sql
CREATE TABLE IF NOT EXISTS saga_compensation_log (
  log_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id          UUID         NOT NULL REFERENCES saga_instances(saga_id),
  step_id          UUID         NOT NULL REFERENCES saga_steps(step_id),
  attempt          INTEGER      NOT NULL,
  outcome          TEXT         NOT NULL,               -- succeeded | failed | skipped-idempotent
  error_detail     JSONB,
  executed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Migration file**: `services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql`

---

## 6. Saga Definitions — Workflow Step Registry

File: `apps/control-plane/src/saga/saga-definitions.mjs`

Each definition follows the schema:

```js
{
  workflowId: 'WF-CON-002',
  steps: [
    {
      ordinal: 1,
      key: 'create-keycloak-realm',
      forward: async (input, sagaCtx) => { /* calls wf-con-002 step fn */ },
      compensate: async (input, outputSnapshot, sagaCtx) => { /* reverse action */ }
    },
    // ...
  ],
  recoveryPolicy: 'compensate'  // default for all workflows; can be 'resume' per workflow
}
```

### 6.1 WF-CON-001 — User Approval (2 steps)

| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `assign-keycloak-role` | Assign Keycloak role via keycloak-admin adapter | Revoke Keycloak role |
| 2 | `update-membership-record` | Set PostgreSQL membership status to active | Set PostgreSQL membership status to pending |

### 6.2 WF-CON-002 — Tenant Provisioning (4 steps)

| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `create-keycloak-realm` | Create Keycloak realm | Delete Keycloak realm |
| 2 | `create-postgresql-boundary` | Insert PostgreSQL tenant boundary | Delete PostgreSQL tenant boundary |
| 3 | `create-kafka-namespace` | Create Kafka topic namespace | Delete Kafka topic namespace |
| 4 | `configure-apisix-routes` | Apply APISIX route configuration | Remove APISIX route configuration |

### 6.3 WF-CON-003 — Workspace Creation (3 steps)

| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `create-keycloak-client` | Create Keycloak client for workspace | Delete Keycloak client |
| 2 | `create-postgresql-workspace` | Insert PostgreSQL workspace record | Delete PostgreSQL workspace record |
| 3 | `reserve-s3-storage` | Create/reserve S3 storage boundary | Release/delete S3 storage boundary |

### 6.4 WF-CON-004 — Credential Generation (3 steps)

| Ordinal | Key | Forward | Compensate |
|---------|-----|---------|-----------|
| 1 | `create-keycloak-credential` | Create/rotate Keycloak client secret | Revert Keycloak credential to prior state |
| 2 | `sync-apisix-consumer` | Synchronize APISIX consumer key material | Remove APISIX consumer configuration |
| 3 | `record-credential-metadata` | Write credential metadata to PostgreSQL | Delete credential metadata record |

### 6.5 WF-CON-006 — (definition to be confirmed against 067 catalog)

WF-CON-006 steps are defined per the catalog entry at `specs/067-console-workflow-catalog/catalog.md`. Placeholder step scaffold with `forward` and `compensate` stubs is committed as the baseline; steps are completed when the catalog entry for WF-CON-006 is finalized.

### 6.6 WF-CON-005 — Extension Point

Registered with `steps: []` and `provisional: true`. Invocation returns `{ status: 'not-implemented', workflowId: 'WF-CON-005' }` without creating a saga instance. This prevents a gap where a new multi-service operation might be called without saga protection.

---

## 7. Module Specifications

### 7.1 `apps/control-plane/src/saga/saga-engine.mjs`

```js
// Public API
export async function executeSaga(workflowId, params, callerContext): SagaResult
export async function recoverInFlightSagas(stalenessThresholdMs): RecoverySummary
```

Responsibilities:
- Resolve definition from `saga-definitions.mjs`
- Enforce idempotency via `saga-idempotency.mjs`
- Orchestrate forward steps; trigger compensation on failure
- Propagate `sagaContext` (`{ sagaId, correlationId, tenantId, workspaceId, actorType, actorId }`) to every step callable
- Delegate persistence to `saga-state-store.mjs`

### 7.2 `apps/control-plane/src/saga/saga-state-store.mjs`

```js
export async function createSagaInstance(def, params, callerCtx): SagaInstance
export async function updateSagaStatus(sagaId, status, outputOrError): void
export async function createSagaStep(sagaId, ordinal, key, input): SagaStep
export async function updateStepStatus(stepId, status, outputOrError): void
export async function getInFlightSagas(stalenessMs): SagaInstance[]
export async function getSagaById(sagaId): SagaInstance
export async function listStepsForSaga(sagaId): SagaStep[]
```

Uses `services/adapters/src/postgresql-data-api.mjs` exclusively. No raw DB connections.

### 7.3 `apps/control-plane/src/saga/saga-compensation.mjs`

```js
export async function compensateSaga(sagaInstance, succeededSteps, definition, sagaCtx): CompensationResult
```

- Iterates `succeededSteps` in descending ordinal order
- For each step: calls `step.compensate()` with `input_snapshot` and `output_snapshot`
- Idempotent-check: if step already `compensated`, skip and continue
- Retry loop: configurable `maxRetries` (default 3), exponential backoff (`baseDelayMs` default 500)
- Writes each attempt to `saga_compensation_log` via state-store
- Returns `{ allCompensated: boolean, failedSteps: string[] }`

### 7.4 `apps/control-plane/src/saga/saga-idempotency.mjs`

```js
export async function checkIdempotencyKey(key, tenantId): IdempotencyRecord | null
export async function recordIdempotencyResult(key, tenantId, sagaId, result): void
```

Idempotency records are stored in `saga_instances.idempotency_key` (UNIQUE constraint). If a record exists and `status=completed`, return cached result. If `status=executing`, return `{ status: 'in-progress', sagaId }`.

### 7.5 `apps/control-plane/src/saga/saga-correlation.mjs`

```js
export function buildCorrelationId(workflowId, callerContext): string
export function enrichContextWithCorrelation(sagaCtx, existingCorrelationId): SagaContext
```

Format: `saga:{workflowId}:{tenantId}:{timestamp}:{random8}`. If caller provides a `X-Correlation-ID` header, it is preserved as the parent correlation and a child correlation is appended: `{parent}::saga:{workflowId}:{random8}`.

### 7.6 `apps/control-plane/src/saga/saga-status.mjs`

```js
export async function getSagaStatus(sagaId, callerContext): SagaStatusResponse
export async function listSagasForTenant(tenantId, filters, callerContext): SagaStatusPage
```

Returns the structured status model consumed by US-UIB-02 job/operation status subsystem:

```js
{
  sagaId: 'uuid',
  workflowId: 'WF-CON-002',
  correlationId: 'saga:WF-CON-002:...',
  status: 'executing' | 'compensating' | 'completed' | 'compensated' | 'compensation-failed',
  currentStep: { ordinal: 2, key: 'create-postgresql-boundary', status: 'executing' } | null,
  steps: [ { ordinal, key, status, updatedAt } ],
  startedAt: 'ISO8601',
  updatedAt: 'ISO8601',
  errorSummary: null | { failedStep, reason, uncompensatedSteps: [] }
}
```

---

## 8. Contract Artifacts

File: `services/internal-contracts/src/saga-contract.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SagaStatusResponse",
  "type": "object",
  "required": ["sagaId", "workflowId", "correlationId", "status", "steps"],
  "properties": {
    "sagaId":        { "type": "string", "format": "uuid" },
    "workflowId":    { "type": "string", "pattern": "^WF-CON-[0-9]{3}$" },
    "correlationId": { "type": "string" },
    "status":        { "type": "string", "enum": ["executing","compensating","completed","compensated","compensation-failed"] },
    "currentStep":   { "oneOf": [{ "type": "null" }, { "$ref": "#/definitions/SagaStepSummary" }] },
    "steps":         { "type": "array", "items": { "$ref": "#/definitions/SagaStepSummary" } },
    "startedAt":     { "type": "string", "format": "date-time" },
    "updatedAt":     { "type": "string", "format": "date-time" },
    "errorSummary":  { "oneOf": [{ "type": "null" }, { "$ref": "#/definitions/SagaErrorSummary" }] }
  },
  "definitions": {
    "SagaStepSummary": {
      "type": "object",
      "required": ["ordinal", "key", "status"],
      "properties": {
        "ordinal":   { "type": "integer", "minimum": 1 },
        "key":       { "type": "string" },
        "status":    { "type": "string", "enum": ["pending","executing","succeeded","failed","compensating","compensated","compensation-failed"] },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "SagaErrorSummary": {
      "type": "object",
      "required": ["failedStep", "reason"],
      "properties": {
        "failedStep":          { "type": "string" },
        "reason":              { "type": "string" },
        "uncompensatedSteps":  { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

Export from `services/internal-contracts/src/index.mjs`:
```js
export { default as sagaContract } from './saga-contract.json' assert { type: 'json' };
```

---

## 9. Configuration and Compensation Policy

File: `apps/control-plane/src/saga/saga-config.mjs`

```js
export const SAGA_CONFIG = {
  compensation: {
    maxRetries: 3,
    baseDelayMs: 500,
    backoffMultiplier: 2.0,
    maxDelayMs: 10_000
  },
  recovery: {
    staleness_threshold_ms: 60_000,   // 1 minute; saga assumed stale if no update
    default_policy: 'compensate'
  },
  idempotency: {
    ttl_ms: 86_400_000   // 24 hours; cached results expire
  }
};
```

Overridable per-workflow via the definition's `config` field; environment variables (`SAGA_COMPENSATION_MAX_RETRIES`, etc.) take precedence at runtime.

---

## 10. Files to Create / Modify

### New Files

| Path | Purpose |
|------|---------|
| `apps/control-plane/src/saga/saga-engine.mjs` | Core orchestrator |
| `apps/control-plane/src/saga/saga-definitions.mjs` | WF-CON-001..006 step registrations |
| `apps/control-plane/src/saga/saga-state-store.mjs` | PostgreSQL persistence facade |
| `apps/control-plane/src/saga/saga-compensation.mjs` | Compensation sequencer + retry |
| `apps/control-plane/src/saga/saga-idempotency.mjs` | Key check / result cache |
| `apps/control-plane/src/saga/saga-correlation.mjs` | Correlation-id lifecycle |
| `apps/control-plane/src/saga/saga-status.mjs` | Status query surface |
| `apps/control-plane/src/saga/saga-config.mjs` | Tuneable defaults |
| `apps/control-plane/src/saga/index.mjs` | Barrel export |
| `services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql` | DDL migration |
| `services/internal-contracts/src/saga-contract.json` | SagaStatusResponse JSON Schema |
| `tests/saga/saga-engine.test.mjs` | Engine unit tests |
| `tests/saga/saga-compensation.test.mjs` | Compensation sequencer tests |
| `tests/saga/saga-idempotency.test.mjs` | Idempotency key tests |
| `tests/saga/saga-state-store.test.mjs` | State store integration stubs |
| `tests/saga/saga-definitions.test.mjs` | Step definition completeness tests |

### Modified Files

| Path | Change |
|------|--------|
| `services/internal-contracts/src/index.mjs` | Export `sagaContract` |
| `apps/control-plane/src/workflows/wf-con-001.mjs` | Wrap steps to accept `sagaCtx`; export `forward`+`compensate` per step |
| `apps/control-plane/src/workflows/wf-con-002.mjs` | Same |
| `apps/control-plane/src/workflows/wf-con-003.mjs` | Same |
| `apps/control-plane/src/workflows/wf-con-004.mjs` | Same |
| `apps/control-plane/src/workflows/wf-con-006.mjs` | Same |
| `apps/control-plane/src/console-backend-functions.mjs` | Expose `executeSaga` and `getSagaStatus` invocation wrappers |

---

## 11. Testing Strategy

### 11.1 Unit Tests (`tests/saga/`)

| Test file | What it covers |
|-----------|---------------|
| `saga-engine.test.mjs` | Happy-path forward execution; failure triggers compensation; idempotency key returns cached result; `recoverInFlightSagas` restarts compensating sagas |
| `saga-compensation.test.mjs` | Reverse order execution; retry loop with backoff; idempotent skip (already compensated); all-retries-exhausted marks `compensation-failed` |
| `saga-idempotency.test.mjs` | New key returns null; existing completed key returns result; in-progress key returns `{ status: 'in-progress' }` |
| `saga-state-store.test.mjs` | CRUD stubs against an in-memory adapter mock; verifies all required fields are persisted |
| `saga-definitions.test.mjs` | Each non-provisional definition has ≥1 step; every step has `forward` and `compensate` functions; ordinals are contiguous from 1 |

All tests use Node built-in `node:test`. No new test frameworks introduced.

### 11.2 Contract Validation

- `saga-contract.json` is validated by the existing contract validation script at `scripts/validate-contracts.mjs` (or equivalent root script per the AGENTS.md conventions).
- `services/internal-contracts/src/index.mjs` exports are smoke-tested by `tests/internal-contracts/index.test.mjs`.

### 11.3 Integration Verification (manual, not automated in T04)

The following scenarios are defined for verification; automated E2E coverage is scoped to T06:

1. **Happy path WF-CON-002**: invoke tenant provisioning with valid params; assert `saga_instances.status = completed` and all four `saga_steps.status = succeeded`.
2. **Compensation trigger WF-CON-002**: inject a failure at step 3 (kafka); assert steps 2 and 1 reach `status = compensated`; assert `saga_instances.status = compensated`.
3. **Idempotency**: invoke same workflow twice with same `idempotency_key`; second call returns first result without new DB rows.
4. **Recovery**: set a saga to `executing` with `updated_at` in the past; call `recoverInFlightSagas`; verify compensation completes.
5. **Compensation retry**: force first two compensation attempts to fail; verify third attempt succeeds and step reaches `compensated`.
6. **Compensation-failed terminal state**: force all retries to fail; verify step reaches `compensation-failed`, `saga_instances.status = compensation-failed`, alert event emitted.

---

## 12. Security and Multi-Tenancy

- All reads/writes to `saga_instances` and `saga_steps` include `tenant_id` in WHERE clauses. State-store methods accept and enforce `tenantId`.
- `saga-status.mjs` queries validate that the requesting `callerContext.tenantId` matches `saga_instances.tenant_id` before returning data. Superadmin callers may query cross-tenant.
- `input_snapshot` and `output_snapshot` columns store the minimum required for compensation (step-specific IDs, not full credential values). Secrets are never written to saga state.
- Idempotency keys are namespaced by `tenant_id` to prevent cross-tenant key collisions.
- `correlation_id` is structural metadata only; it carries no authorization weight.

---

## 13. Observability

- Each saga state transition emits a structured log entry via the existing `observability-audit-correlation.mjs` adapter (audit pipeline wiring is T05; this plan ensures the log call sites are present with a no-op stub that T05 can wire).
- Alert emission on `compensation-failed` uses `apps/control-plane/src/events-admin.mjs` to publish a `saga.compensation-failed` event to the Kafka topic configured for platform alerts.
- `saga_instances.updated_at` is the heartbeat field for the recovery watchdog.

---

## 14. Idempotency Implementation Details

**Forward steps**: Each step callable must be idempotent. The implementation pattern is check-then-act with a read-before-write:

1. Before executing the forward action, the step function queries the target service to determine whether the resource already exists (using the step's output key, e.g., Keycloak realm name, PostgreSQL tenant ID).
2. If the resource already exists and matches the expected parameters, the step records `output_snapshot` from the read result and proceeds as if it succeeded.
3. If the resource exists but with conflicting parameters, the step fails with a `CONFLICT` error (not retried; triggers compensation).

**Compensation actions**: Same pattern. Query-before-delete: if the resource no longer exists, log as `skipped-idempotent` and mark the step `compensated`.

---

## 15. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PostgreSQL saga-state table contention under concurrent provisioning | Low-Medium | Indexed by `tenant_id`; step rows are isolated per saga; no full-table scans in hot path |
| OpenWhisk cold-start delays trigger false-positive stale saga recovery | Medium | `staleness_threshold_ms` defaults to 60s; cold-start is typically <10s; tunable per deployment |
| Compensation action itself has an undiscovered non-idempotent behavior | Medium | All compensation callables follow the query-before-delete pattern; T06 tests specifically exercise duplicate compensation |
| `input_snapshot` missing required data for compensation at rollback time | Low | Contract test (`saga-definitions.test.mjs`) asserts that each step's compensation function accepts and uses the snapshot structure produced by that step's forward function |
| WF-CON-006 catalog entry not yet fully specified | Low | Scaffold with stubs is committed; steps are completed once catalog entry is finalized. The engine itself is unblocked by this. |

---

## 16. Dependencies and Sequencing

### 16.1 Pre-conditions (must be available before implementation starts)

| Dependency | Source | Status |
|-----------|--------|--------|
| Workflow catalog (`catalog.md`) | specs/067 | Delivered (T01) |
| T02 workflow step functions | specs/068 | Delivered (T02); step callables must expose `forward`/`compensate` |
| Endpoint separation (backend-tier) | specs/069 | Delivered (T03); saga engine is invoked from backend-tier endpoints |
| PostgreSQL adapter (`postgresql-data-api.mjs`) | services/adapters | Present in repo |

### 16.2 Recommended Implementation Sequence

```
Step A  DDL migration: create saga_instances, saga_steps, saga_compensation_log
Step B  saga-state-store.mjs + unit stubs (enables all other modules to be tested)
Step C  saga-idempotency.mjs
Step D  saga-correlation.mjs
Step E  saga-compensation.mjs
Step F  saga-engine.mjs (assembles A-E)
Step G  saga-definitions.mjs for WF-CON-001 (simplest, 2 steps) + definition test
Step H  saga-definitions.mjs for WF-CON-002, WF-CON-003, WF-CON-004
Step I  saga-definitions.mjs for WF-CON-005 (stub) and WF-CON-006 (scaffold)
Step J  saga-status.mjs + contract artifact
Step K  Wire into console-backend-functions.mjs; update affected workflow modules
Step L  Full unit test suite passes; contract validation passes
```

Steps A–F can be developed and merged independently of the specific workflow definitions (G–I). Steps G–I can be parallelized across workflows once F is in place.

### 16.3 Unblocked Downstream Work

After plan.md is complete and implementation begins:
- **T05 (audit pipeline)**: can wire audit calls against the log-site stubs defined in section 13 without waiting for T04 to be fully merged.
- **T06 (E2E tests)**: can be authored against the integration verification scenarios in section 11.3 before T04 is fully stabilized.
- **US-UIB-02 (job status UI)**: can design UI against the `SagaStatusResponse` contract in `saga-contract.json`.

---

## 17. Criteria of Done

| # | Criterion | Verifiable Evidence |
|---|-----------|-------------------|
| CD-01 | `saga_instances`, `saga_steps`, `saga_compensation_log` tables exist in PostgreSQL | Migration file committed; `\d saga_instances` in psql |
| CD-02 | `saga-engine.mjs` executes WF-CON-001 through WF-CON-004 and WF-CON-006 forward path end-to-end (mocked adapters) | Unit tests pass |
| CD-03 | Failed step triggers compensation of all prior succeeded steps in reverse order | `saga-engine.test.mjs` compensation test passes |
| CD-04 | Compensation actions are retried up to `maxRetries` with exponential backoff | `saga-compensation.test.mjs` retry test passes |
| CD-05 | Exhausted compensation retries produce `compensation-failed` status and alert event | Unit test asserts status + event emission |
| CD-06 | Duplicate invocation with same `idempotency_key` returns first result without new DB rows | `saga-idempotency.test.mjs` test passes |
| CD-07 | `recoverInFlightSagas` detects stale `executing` sagas and compensates them | Engine unit test with mocked stale instance passes |
| CD-08 | Every saga step carries `correlation_id` in its `sagaContext` | Verified in `saga-engine.test.mjs` context propagation test |
| CD-09 | `saga-status.mjs` returns `SagaStatusResponse` conforming to `saga-contract.json` | Contract validation script passes |
| CD-10 | Tenant isolation: a caller cannot read saga state for a different tenant | `saga-status.test.mjs` cross-tenant rejection test passes |
| CD-11 | All non-provisional workflow definitions have ≥1 step with `forward` and `compensate` | `saga-definitions.test.mjs` completeness test passes |
| CD-12 | `services/internal-contracts/src/index.mjs` exports `sagaContract` | `tests/internal-contracts/index.test.mjs` import test passes |
| CD-13 | No secrets or credential values are written to `input_snapshot` or `output_snapshot` | Code review gate; unit test asserts snapshot structure for WF-CON-004 |
| CD-14 | Root `pnpm test` passes with zero failures | CI output |

---

*Plan file: `specs/070-saga-compensation-workflows/plan.md`*
