# Implementation Plan: Console Workflow Backend Functions

**Branch**: `068-console-workflow-functions` | **Date**: 2026-03-29 | **Spec**: `specs/068-console-workflow-functions/spec.md`  
**Task**: US-UIB-01-T02  
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura  
**Epic**: EP-16 — Backend funcional de la consola  
**Catalog dependency**: `specs/067-console-workflow-catalog/catalog.md` (US-UIB-01-T01, delivered)  
**Infrastructure dependency**: `specs/004-console-openwhisk-backend/plan.md` (US-FN-03-T04, delivered)

---

## Summary

Implement five server-side OpenWhisk workflow functions covering WF-CON-001 through WF-CON-004 and WF-CON-006, plus a no-op extension point for WF-CON-005. Each function runs inside the workspace-scoped OpenWhisk namespace established by 004-console-openwhisk-backend, validates caller authorization before any mutation, enforces idempotency via caller-provided keys, consumes platform services exclusively through the BaaS API surface, and produces structured audit-ready output. Asynchronous workflows (WF-CON-002, WF-CON-003) return a job reference on invocation and expose a status query. This plan is tightly bounded to T02; it explicitly excludes saga/compensation (T04), audit pipeline wiring (T05), and E2E tests (T06), while ensuring all function output is structurally compatible with those layers.

---

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — new workflow function modules land in `apps/control-plane/src/workflows/`; adapter extensions stay additive in `services/adapters/src/openwhisk-admin.mjs`; contract JSON artifacts stay in `services/internal-contracts/src/`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — each workflow function can be developed and verified independently; the five functions plus the WF-CON-005 extension point can each be merged individually.
- **Kubernetes and OpenShift Compatibility**: PASS — no new cluster-level infrastructure is introduced; the idempotency store is in-memory for the function runtime, backed by the BaaS PostgreSQL state API for durability.
- **Quality Gates at the Root**: PASS — all new modules are exercisable via the existing root `node:test` scripts and contract validation tooling.
- **Documentation as Part of the Change**: PASS — spec, plan, and checklist artifacts are in the feature branch.
- **API Symmetry**: PASS — no privileged back-channel is introduced; all service interactions go through the same BaaS API surface used by external consumers.
- **T02 scope boundary**: PASS — saga/compensation (T04), audit pipeline wiring (T05), and E2E scenarios (T06) are explicitly not implemented here, but all outputs are structured to support them without rework.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM modules  
**Runtime target**: Apache OpenWhisk 2.0.x / 2.1.x, `nodejs:20` runtime  
**Primary adapter dependencies**: `services/adapters/src/openwhisk-admin.mjs`, `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/postgresql-admin.mjs`, `services/adapters/src/kafka-admin.mjs`, `services/adapters/src/storage-admin.mjs` (S3), `services/adapters/src/storage-tenant-context.mjs`  
**Authorization infrastructure**: `apps/control-plane/src/console-backend-functions.mjs` (delivered by 004), `apps/control-plane/src/authorization-context.mjs`, `services/internal-contracts/src/authorization-model.json`  
**Contract infrastructure**: `services/internal-contracts/src/index.mjs`, `services/internal-contracts/src/internal-service-map.json`  
**Testing**: Node built-in `node:test`, existing root validation scripts  
**No new cluster resources** are provisioned by this task.

---

## Target Architecture and Flow

### Synchronous Workflow (WF-CON-001, WF-CON-004, WF-CON-006)

```text
Console UI / Test caller
       │ HTTP POST /v1/workflows/{workflowId}/invoke
       ▼
APISIX Gateway  →  validates workspace_service_account token
       │
       ▼
control_api enforcement surface
  → resolves actor_type, tenantId, workspaceId
  → calls console-backend-functions.mjs:validateConsoleBackendScope()
       │
       ▼
apps/control-plane/src/workflows/{workflow-id}.mjs
  1. validateInvocationRequest(request, callerContext)
     → checks idempotency key; returns cached result if duplicate
     → checks role authorization (per workflow)
     → checks tenant/workspace boundary
  2. executeWorkflowSteps(validatedRequest)
     → each step calls BaaS API surface exclusively
     → builds audit-ready structured output per step
  3. recordIdempotencyResult(key, result)
  4. return WorkflowResult
       │
       ▼
Caller receives synchronous WorkflowResult
```

### Asynchronous Workflow (WF-CON-002, WF-CON-003)

```text
Console UI / Test caller
       │ HTTP POST /v1/workflows/{workflowId}/invoke
       ▼
[same gateway + enforcement surface as above]
       │
       ▼
apps/control-plane/src/workflows/{workflow-id}.mjs
  1. validateInvocationRequest()  [same guards]
  2. registerJob(idempotencyKey) → jobRef
  3. dispatch OpenWhisk async action  [non-blocking]
  4. return { jobRef, status: 'pending' }  ← within 2s
       │
       ▼
Caller polls: GET /v1/workflows/jobs/{jobRef}/status
       │
       ▼
apps/control-plane/src/workflows/job-status.mjs
  → reads execution record from BaaS state store
  → returns { jobRef, status, result?, errorSummary? }
```

### BaaS API consumption rule (enforced for all workflows)

Every service interaction in a workflow step MUST use the existing adapter modules (`keycloak-admin.mjs`, `postgresql-admin.mjs`, etc.) which proxy to the governed BaaS REST API surface. Direct database connections, raw Keycloak admin REST calls outside the adapter boundary, or any internal-only service endpoint are forbidden. This preserves the constraint from 004-console-openwhisk-backend.

---

## Project Structure

### Documentation (this feature)

```text
specs/068-console-workflow-functions/
├── spec.md
├── plan.md                           ← this file
└── checklists/
    └── requirements.md
```

### Source Code

```text
apps/
└── control-plane/
    └── src/
        └── workflows/
            ├── index.mjs                         ← new: workflow registry and extension point (WF-CON-005)
            ├── workflow-invocation-contract.mjs  ← new: shared invocation request/response types
            ├── idempotency-store.mjs             ← new: idempotency key management module
            ├── job-status.mjs                    ← new: async job tracking and status query
            ├── wf-con-001-user-approval.mjs      ← new: WF-CON-001 function
            ├── wf-con-002-tenant-provisioning.mjs ← new: WF-CON-002 function
            ├── wf-con-003-workspace-creation.mjs  ← new: WF-CON-003 function
            ├── wf-con-004-credential-generation.mjs ← new: WF-CON-004 function
            └── wf-con-006-service-account.mjs    ← new: WF-CON-006 function

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs                  ← additive: workflow dispatch helpers,
│                                                    async job registration constants
└── internal-contracts/
    └── src/
        ├── console-workflow-invocation.json     ← new: invocation request/response schema
        ├── console-workflow-job-status.json     ← new: job status schema
        └── authorization-model.json            ← additive: workflow-scoped role requirements

tests/
├── unit/
│   ├── wf-con-001-user-approval.test.mjs
│   ├── wf-con-002-tenant-provisioning.test.mjs
│   ├── wf-con-003-workspace-creation.test.mjs
│   ├── wf-con-004-credential-generation.test.mjs
│   ├── wf-con-006-service-account.test.mjs
│   ├── workflow-idempotency-store.test.mjs
│   └── workflow-job-status.test.mjs
├── contracts/
│   ├── console-workflow-invocation.contract.test.mjs
│   └── console-workflow-job-status.contract.test.mjs
└── resilience/
    └── console-workflow-authorization.test.mjs
```

---

## Artifact-by-Artifact Change Plan

### 1. `services/internal-contracts/src/console-workflow-invocation.json` *(new)*

Define the canonical JSON schema for workflow invocation requests and results. All five workflow functions share this schema envelope; workflow-specific payload fields are carried in a typed `input` object keyed by `workflowId`.

**Request envelope fields**:
- `workflowId` (string, required): one of `WF-CON-001`..`WF-CON-006`
- `idempotencyKey` (string, required): caller-provided UUID v4 or equivalent
- `callerContext` (object, required): `{ actor, actorType, tenantId, workspaceId, correlationId }`
- `input` (object, required): workflow-specific payload (typed per workflowId)
- `asyncHint` (boolean, optional): caller preference for async dispatch; ignored for sync-only workflows

**Result envelope fields**:
- `workflowId` (string)
- `idempotencyKey` (string)
- `status` (enum: `succeeded` | `failed` | `pending` | `running`)
- `jobRef` (string | null): populated only for async workflows
- `output` (object | null): workflow-specific result payload
- `errorSummary` (object | null): `{ code, message, failedStep }` — no internal stack traces
- `auditFields` (object): `{ workflowId, actor, tenantId, workspaceId, timestamp, affectedResources[], outcome }` — required for T05 pipeline compatibility

**Per-workflow `input` shapes**:

| workflowId | Required input fields |
|---|---|
| `WF-CON-001` | `userId`, `targetWorkspaceId`, `requestedRole` |
| `WF-CON-002` | `tenantSlug`, `tenantDisplayName`, `adminEmail` |
| `WF-CON-003` | `workspaceName`, `workspaceSlug`, `storageClass?` |
| `WF-CON-004` | `credentialAction` (generate / rotate / revoke), `targetWorkspaceId`, `credentialId?` |
| `WF-CON-005` | *(reserved — no concrete fields; returns NOT_IMPLEMENTED)* |
| `WF-CON-006` | `serviceAccountAction` (create / scope / rotate / deactivate / delete), `serviceAccountId?`, `scopeBindings?` |

### 2. `services/internal-contracts/src/console-workflow-job-status.json` *(new)*

Schema for the async job status record:
- `jobRef` (string, UUID)
- `workflowId` (string)
- `idempotencyKey` (string)
- `status` (enum: `pending` | `running` | `succeeded` | `failed`)
- `createdAt` (ISO 8601)
- `updatedAt` (ISO 8601)
- `result` (object | null): populated on `succeeded`
- `errorSummary` (object | null): `{ code, message, failedStep }` — populated on `failed`
- `auditFields` (object): same shape as result envelope `auditFields`

### 3. `services/internal-contracts/src/authorization-model.json` *(additive)*

Add workflow-scoped role requirements under a new `workflow_authorization` key:

```jsonc
"workflow_authorization": {
  "WF-CON-001": { "required_roles": ["workspace_admin", "tenant_owner"], "isolation": "tenant-scoped" },
  "WF-CON-002": { "required_roles": ["superadmin"], "isolation": "superadmin" },
  "WF-CON-003": { "required_roles": ["tenant_owner"], "isolation": "tenant-scoped" },
  "WF-CON-004": { "required_roles": ["workspace_admin", "tenant_owner"], "isolation": "tenant-scoped" },
  "WF-CON-005": { "required_roles": [], "isolation": "tenant-scoped", "provisional": true },
  "WF-CON-006": { "required_roles": ["workspace_admin", "tenant_owner"], "isolation": "tenant-scoped" }
}
```

No existing keys are modified.

### 4. `services/adapters/src/openwhisk-admin.mjs` *(additive)*

Export the following additions (no existing exports modified):

- `OPENWHISK_WORKFLOW_ASYNC_JOB_STATUS_PREFIX = 'wf_job'` — stable prefix for job reference IDs
- `buildWorkflowAsyncJobRef(workflowId, idempotencyKey)` → deterministic job reference string for deduplication
- `dispatchWorkflowAction(namespace, actionRef, payload, annotation)` → thin wrapper over existing dispatch, injects `initiating_surface: 'console_backend'` and workflow-specific activation annotation fields (`workflowId`, `correlationId`, `tenantId`, `workspaceId`)
- `OPENWHISK_WORKFLOW_ACTION_REFS` (frozen object) → maps each `WF-CON-NNN` to its canonical action name in the workspace namespace

### 5. `apps/control-plane/src/workflows/workflow-invocation-contract.mjs` *(new)*

Pure validation and normalization module (no I/O):

- `validateInvocationRequest(raw)` → validates against `console-workflow-invocation.json` schema; returns `{ ok, request, violations[] }`
- `validateCallerAuthorization(callerContext, workflowId, authorizationModel)` → checks role, tenant boundary, superadmin constraint; returns `{ authorized, reason? }`
- `buildAuditFields(workflowId, callerContext, affectedResources, outcome)` → constructs the `auditFields` object required in every result; does not emit events (T05 responsibility)
- `buildErrorResult(workflowId, idempotencyKey, code, message, failedStep)` → constructs a normalized failure result envelope

### 6. `apps/control-plane/src/workflows/idempotency-store.mjs` *(new)*

Manages idempotency key lifecycle within and across invocations:

- `checkIdempotency(key)` → returns `{ state: 'new' | 'pending' | 'succeeded' | 'failed', cachedResult? }`  
  Implementation: queries BaaS PostgreSQL state API (`/v1/state/idempotency-keys/{key}`); falls back to in-process map for unit testing.
- `markPending(key, workflowId, jobRef?)` → writes pending state via BaaS state API
- `markSucceeded(key, result)` → writes succeeded state + result via BaaS state API
- `markFailed(key, errorSummary)` → writes failed state + error summary via BaaS state API
- Concurrency guard: if `checkIdempotency` returns `'pending'`, the caller receives a `409 Conflict` response with the existing `jobRef` rather than starting a duplicate execution.
- Token expiry safety: stores the idempotency record independently of the caller token; a mid-execution token expiry does not corrupt the record.

**BaaS state API contract**: the module calls `POST /v1/state/idempotency-keys` and `GET /v1/state/idempotency-keys/{key}`. If this endpoint is not yet available in the BaaS surface, the module falls back to a PostgreSQL direct write via `postgresql-data-api.mjs` adapter — this is flagged as a **dependency risk** (see Risks section).

### 7. `apps/control-plane/src/workflows/job-status.mjs` *(new)*

Async job tracking:

- `registerJob(workflowId, idempotencyKey, callerContext)` → creates a job record, returns `jobRef`
- `updateJobStatus(jobRef, status, resultOrError)` → called by the async action on completion/failure
- `queryJobStatus(jobRef, callerContext)` → validates caller is authorized for the job's tenantId, returns job status record; must respond within 1 second SLO
- Status transitions: `pending → running → succeeded | failed` (no direct `pending → succeeded` skip in async workflows)

### 8. `apps/control-plane/src/workflows/index.mjs` *(new)*

Workflow registry and WF-CON-005 extension point:

```js
// Registry maps workflowId → handler module
const WORKFLOW_REGISTRY = new Map([
  ['WF-CON-001', () => import('./wf-con-001-user-approval.mjs')],
  ['WF-CON-002', () => import('./wf-con-002-tenant-provisioning.mjs')],
  ['WF-CON-003', () => import('./wf-con-003-workspace-creation.mjs')],
  ['WF-CON-004', () => import('./wf-con-004-credential-generation.mjs')],
  ['WF-CON-006', () => import('./wf-con-006-service-account.mjs')],
]);

export function registerWorkflow(workflowId, handlerImport) { ... }
export async function resolveWorkflowHandler(workflowId) {
  if (!WORKFLOW_REGISTRY.has(workflowId)) {
    if (workflowId === 'WF-CON-005') return { notImplemented: true };
    throw new WorkflowNotFoundError(workflowId);
  }
  return (await WORKFLOW_REGISTRY.get(workflowId)()).default;
}
```

The `registerWorkflow` export is the WF-CON-005 extension point: future workflow handlers can be registered without modifying existing functions (FR-010 compliance).

### 9. `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs` *(new)*

**Catalog**: WF-CON-001 | Actors: `workspace_admin`, `tenant_owner` | Services: Keycloak, PostgreSQL | Isolation: tenant-scoped | Idempotency: required | Audit: sensitive

**Shared sub-workflow**: SWF-CON-B (Keycloak role assignment and scope binding)

**Execution steps**:
1. `validateInvocationRequest` + `validateCallerAuthorization` (role: workspace_admin | tenant_owner, same tenant)
2. Check idempotency key — return cached result if already processed
3. Mark idempotency key as `pending`
4. Via `keycloak-admin.mjs` adapter → assign `requestedRole` to `userId` in tenant realm (BaaS Keycloak API)
5. Via `postgresql-admin.mjs` adapter → update membership record from `pending` to `active` for `userId` + `targetWorkspaceId` (BaaS PostgreSQL data API)
6. Build `auditFields` with `affectedResources: [{ type: 'keycloak_role_assignment', id }, { type: 'membership_record', id }]`
7. Mark idempotency key as `succeeded`; return result envelope

**Mode**: synchronous — returns complete result inline.

**Authorization guard**: reject if `callerContext.tenantId !== targetWorkspaceId.tenantId`; reject if role is insufficient.

**Idempotency**: step 4 (Keycloak role assignment) is idempotent by nature of role assignment semantics. Step 5 uses SWF-CON-C pattern via `idempotency-store.mjs`.

**Secret handling**: none — no credential material transits this function.

### 10. `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs` *(new)*

**Catalog**: WF-CON-002 | Actors: `superadmin` | Services: Keycloak, PostgreSQL, Kafka, APISIX | Isolation: superadmin | Idempotency: required | Audit: sensitive

**Shared sub-workflow**: SWF-CON-A (Keycloak realm/client provisioning)

**Execution steps** (async dispatch):
1. `validateInvocationRequest` + `validateCallerAuthorization` (role: superadmin only — FR-008)
2. Check idempotency key — return cached jobRef if already registered
3. `registerJob(...)` → `jobRef`; mark idempotency key as `pending`
4. Dispatch OpenWhisk async action `wf-con-002-tenant-provisioning-action` with full payload + annotation
5. Return `{ jobRef, status: 'pending' }` to caller ← must happen within 2 seconds

**Async action internal steps** (run inside OpenWhisk `nodejs:20` action):
- Step A: Via `keycloak-admin.mjs` → create Keycloak realm for tenant (SWF-CON-A)
- Step B: Via `postgresql-admin.mjs` → write tenant boundary record
- Step C: Via `kafka-admin.mjs` → create Kafka topic namespace for tenant
- Step D: Via APISIX adapter (gateway-config service) → register tenant route configuration

Each step records its completion state via `updateJobStatus`; failures capture `failedStep` in `errorSummary`.

**Mode**: asynchronous — synchronous phase returns jobRef; async action completes steps A–D.

**Superadmin enforcement**: step 1 must verify `callerContext.actorType === 'superadmin'` before proceeding. This is the last line of defense per FR-008 / spec edge case.

**State consistency**: if step C or D fails after steps A/B have succeeded, the function marks the job as `failed` with `failedStep` populated. T04 (saga/compensation) will handle rollback; this function must not attempt partial rollback.

### 11. `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs` *(new)*

**Catalog**: WF-CON-003 | Actors: `tenant_owner` | Services: Keycloak, PostgreSQL, S3 | Isolation: tenant-scoped | Idempotency: required | Audit: standard

**Shared sub-workflows**: SWF-CON-A (Keycloak client provisioning), SWF-CON-C (PostgreSQL idempotent write)

**Execution steps** (async dispatch):
1. `validateInvocationRequest` + `validateCallerAuthorization` (role: tenant_owner, same tenant)
2. Check idempotency key — return cached jobRef if already registered
3. `registerJob(...)` → `jobRef`; mark idempotency key as `pending`
4. Return `{ jobRef, status: 'pending' }` within 2 seconds

**Async action internal steps**:
- Step A: Via `keycloak-admin.mjs` → create Keycloak client for workspace (SWF-CON-A)
- Step B: Via `postgresql-admin.mjs` → write workspace record (SWF-CON-C idempotency)
- Step C: Via `storage-tenant-context.mjs` → provision S3 storage boundary for workspace

**State consistency**: partial provisioning (e.g., Keycloak client created, S3 failed) is captured as `failed` with `failedStep`. T04 handles compensation.

**Mode**: asynchronous.

### 12. `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` *(new)*

**Catalog**: WF-CON-004 | Actors: `workspace_admin`, `tenant_owner` | Services: Keycloak, APISIX, PostgreSQL | Isolation: tenant-scoped | Idempotency: required | Audit: sensitive

**Shared sub-workflow**: SWF-CON-C (PostgreSQL idempotent write)

**Execution steps** (synchronous):
1. `validateInvocationRequest` + `validateCallerAuthorization` (role: workspace_admin | tenant_owner, same workspace)
2. Check idempotency key — return cached result (without re-transmitting secret material; see below)
3. Mark idempotency key as `pending`
4. Branch on `credentialAction`:
   - `generate`: Via `keycloak-admin.mjs` → create client secret in Keycloak workspace client; Via APISIX adapter → register consumer key; Via `postgresql-admin.mjs` → write credential metadata record
   - `rotate`: Via `keycloak-admin.mjs` → regenerate client secret; Via APISIX adapter → update consumer key; Via `postgresql-admin.mjs` → update metadata record
   - `revoke`: Via `keycloak-admin.mjs` → disable/delete client credential; Via APISIX adapter → remove consumer key; Via `postgresql-admin.mjs` → mark credential as revoked
5. Build result: secret material included in `output.credential` only for `generate` and `rotate` — **one-time exposure** (FR-007)
6. Mark idempotency key as `succeeded`; store result **without** secret material in idempotency record (idempotent retry returns metadata only, not re-transmitted secret)

**Secret handling (FR-007)**: the raw credential value is returned to the caller in the single HTTP response. It is NOT stored in the idempotency record. A retry on the same idempotency key returns a success result with `output.credential = null` and `output.credentialId` for lookup — the caller must treat the first response as the only opportunity to retrieve the secret value.

**Mode**: synchronous.

### 13. `apps/control-plane/src/workflows/wf-con-006-service-account.mjs` *(new)*

**Catalog**: WF-CON-006 | Actors: `workspace_admin`, `tenant_owner` | Services: Keycloak, PostgreSQL | Isolation: tenant-scoped | Idempotency: required | Audit: sensitive

**Shared sub-workflow**: SWF-CON-B (Keycloak role assignment and scope binding)

**Execution steps** (synchronous):
1. `validateInvocationRequest` + `validateCallerAuthorization` (role: workspace_admin | tenant_owner, same workspace)
2. Check idempotency key — return cached result if already processed
3. Mark idempotency key as `pending`
4. Branch on `serviceAccountAction`:
   - `create`: Via `keycloak-admin.mjs` → create service account client + subject; Via `postgresql-admin.mjs` → write service account record binding it to workspace
   - `scope`: Via `keycloak-admin.mjs` → update service account scope bindings (SWF-CON-B); Via `postgresql-admin.mjs` → update scope metadata
   - `rotate`: Via `keycloak-admin.mjs` → regenerate service account credentials; Via `postgresql-admin.mjs` → update credential metadata
   - `deactivate`: Via `keycloak-admin.mjs` → disable service account; Via `postgresql-admin.mjs` → mark account as inactive
   - `delete`: Via `keycloak-admin.mjs` → delete service account client; Via `postgresql-admin.mjs` → mark account as deleted
5. Build `auditFields` with full affected resource list
6. Mark idempotency key as `succeeded`; return result envelope

**Secret handling**: `rotate` action follows the same one-time exposure pattern as WF-CON-004.

**Mode**: synchronous.

---

## Data Model

### Idempotency Key Record (BaaS state store / PostgreSQL fallback)

```sql
idempotency_keys (table or state API resource)
  key            TEXT PRIMARY KEY
  workflow_id    TEXT NOT NULL
  tenant_id      TEXT NOT NULL
  workspace_id   TEXT
  job_ref        TEXT              -- populated for async workflows
  state          TEXT NOT NULL     -- 'pending' | 'succeeded' | 'failed'
  result_summary JSONB             -- stored on succeeded (no secret material)
  error_summary  JSONB             -- stored on failed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  expires_at     TIMESTAMPTZ       -- TTL for cleanup; suggested: 30 days
```

If this table does not yet exist in the BaaS PostgreSQL schema, a migration script (`services/provisioning-orchestrator/migrations/`) must be provided as part of this task (see Risks).

### Async Job Status Record (BaaS state store / PostgreSQL fallback)

```sql
workflow_jobs (table or state API resource)
  job_ref        TEXT PRIMARY KEY
  workflow_id    TEXT NOT NULL
  idempotency_key TEXT NOT NULL REFERENCES idempotency_keys(key)
  tenant_id      TEXT NOT NULL
  workspace_id   TEXT
  actor          TEXT NOT NULL
  status         TEXT NOT NULL     -- 'pending' | 'running' | 'succeeded' | 'failed'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  result         JSONB             -- populated on succeeded
  error_summary  JSONB             -- populated on failed: { code, message, failedStep }
```

### No new MongoDB, Kafka topic, or S3 bucket

State tracking is PostgreSQL-only. The functions themselves may provision Kafka topics or S3 buckets *as their workflow output*, but they do not store their own operational state there.

---

## API Contracts

### Invocation endpoint (consumed by console UI and internal tests)

```http
POST /v1/workflows/{workflowId}/invoke
Authorization: Bearer <workspace_service_account_token>
Content-Type: application/json

{
  "idempotencyKey": "uuid-v4",
  "input": { ...workflow-specific fields... }
}
```

Response (sync, success):

```json
{
  "workflowId": "WF-CON-001",
  "idempotencyKey": "...",
  "status": "succeeded",
  "jobRef": null,
  "output": { ...workflow-specific result... },
  "auditFields": { "workflowId": "WF-CON-001", "actor": "...", "tenantId": "...", "workspaceId": "...", "timestamp": "...", "affectedResources": [...], "outcome": "succeeded" }
}
```

Response (async, accepted):

```json
{
  "workflowId": "WF-CON-002",
  "idempotencyKey": "...",
  "status": "pending",
  "jobRef": "wf_job_abc123"
}
```

**Error codes**:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Schema validation failure |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Token valid but insufficient role or cross-tenant |
| 409 | `DUPLICATE_INVOCATION` | Same idempotency key is currently `pending` |
| 404 | `WORKFLOW_NOT_FOUND` | Unknown workflowId |
| 501 | `NOT_IMPLEMENTED` | WF-CON-005 or unimplemented variant |
| 503 | `DOWNSTREAM_UNAVAILABLE` | BaaS API dependency temporarily unavailable; safe to retry |

### Job status endpoint

```http
GET /v1/workflows/jobs/{jobRef}/status
Authorization: Bearer <workspace_service_account_token>
```

Response:

```json
{
  "jobRef": "wf_job_abc123",
  "workflowId": "WF-CON-002",
  "status": "running",
  "createdAt": "...",
  "updatedAt": "...",
  "result": null,
  "errorSummary": null
}
```

Authorization on status query: the querying actor must belong to the same `tenantId` as the job record. No cross-tenant job status leakage.

---

## Testing Strategy

### Unit tests (`tests/unit/`)

One test file per workflow function plus the shared modules:

| Test file | Coverage |
|---|---|
| `wf-con-001-user-approval.test.mjs` | Role validation, tenant boundary, step sequencing, idempotency paths, audit field construction |
| `wf-con-002-tenant-provisioning.test.mjs` | Superadmin enforcement, async dispatch, job reference generation, step recording |
| `wf-con-003-workspace-creation.test.mjs` | Tenant owner enforcement, async dispatch, sub-workflow SWF-CON-A and SWF-CON-C invocation |
| `wf-con-004-credential-generation.test.mjs` | All three `credentialAction` branches, secret one-time exposure, idempotent retry with null credential |
| `wf-con-006-service-account.test.mjs` | All five `serviceAccountAction` branches, SWF-CON-B invocation, audit field completeness |
| `workflow-idempotency-store.test.mjs` | `checkIdempotency` states, `markPending/Succeeded/Failed`, concurrency 409 guard |
| `workflow-job-status.test.mjs` | `registerJob`, status transitions, cross-tenant rejection, 1s response SLO assertion |

All unit tests use `node:test` with module mocking for adapters. No live HTTP calls.

### Contract tests (`tests/contracts/`)

| Test file | Coverage |
|---|---|
| `console-workflow-invocation.contract.test.mjs` | Request schema validation for all six workflow inputs; result envelope shape for sync and async; `auditFields` completeness |
| `console-workflow-job-status.contract.test.mjs` | Job status record schema; all status enum values; cross-tenant rejection contract |

### Resilience tests (`tests/resilience/`)

| Test file | Coverage |
|---|---|
| `console-workflow-authorization.test.mjs` | Cross-tenant rejection (wrong tenantId on token), under-privileged role rejection for each workflow, superadmin-only WF-CON-002 rejection for non-superadmin, invalid workflowId 404, WF-CON-005 501 response |

**Explicitly excluded from this task** (T06 scope):
- E2E workflow execution against live BaaS services
- Partial failure / mid-execution downstream timeout simulation
- Concurrent dual-invocation race condition verification
- Saga/compensation validation

---

## Security

- **Tenant isolation** is enforced in `validateCallerAuthorization` before any step executes. A function that passes validation still double-checks `tenantId` equality before each service API call to prevent TOCTOU drift.
- **Secret material** (WF-CON-004, WF-CON-006 rotate) is never stored in the idempotency record, never logged, and never included in audit fields. Only credential metadata (`credentialId`, `credentialType`, `rotatedAt`) is stored.
- **Token expiry mid-execution**: the idempotency record is written with the validated authorization context at invocation time. If the token expires after validation, the already-recorded authorization context governs the execution; no re-validation is attempted mid-flight. The function completes or fails cleanly — it does not access the expired token for further authorization decisions.
- **Superadmin enforcement** (WF-CON-002): the function itself is the last line of defense. Even if the gateway mis-routes a tenant-scoped token, the function checks `actorType === 'superadmin'` and rejects before any provisioning step.
- **Activation annotation**: all functions inject `initiating_surface: 'console_backend'` per the 004-console-openwhisk-backend pattern, enabling audit consumers to distinguish console-originated activations from direct tenant invocations.
- **BaaS API surface compliance**: no direct database connections, no raw Keycloak admin REST, no internal-only service endpoints. Enforced via code review and contract tests that assert adapter module usage.

---

## Observability and Audit-Readiness

Every function result envelope includes a fully populated `auditFields` object:

```json
{
  "workflowId": "WF-CON-001",
  "actor": "<actor identity>",
  "tenantId": "<tenantId>",
  "workspaceId": "<workspaceId>",
  "timestamp": "<ISO 8601>",
  "affectedResources": [
    { "type": "keycloak_role_assignment", "id": "<id>" },
    { "type": "membership_record", "id": "<id>" }
  ],
  "outcome": "succeeded" | "failed"
}
```

Sensitive workflows (WF-CON-001, WF-CON-002, WF-CON-004, WF-CON-006) populate `affectedResources` with all mutated resource identifiers. The audit pipeline (T05) consumes this field without requiring rework.

`correlationId` is propagated from `callerContext` into the activation annotation and into all BaaS API calls made within the function, preserving the trace chain for T05.

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BaaS state API (`/v1/state/idempotency-keys`) endpoint does not yet exist | Medium | High | `idempotency-store.mjs` falls back to `postgresql-data-api.mjs` adapter with a migration script. If even the fallback table is absent, this is a **blocker** requiring T01/TEN-01 dependency resolution before WF-CON-002 and WF-CON-003 can be safely deployed. |
| Keycloak adapter doesn't expose realm creation (needed for WF-CON-002) | Low | High | `keycloak-admin.mjs` was extended by US-FN-03 and US-TEN-01. Verify `createRealm` and `createClient` exist before starting WF-CON-002. If absent, file a BaaS surface gap as a blocker. |
| S3 storage boundary provisioning API missing for WF-CON-003 | Low | Medium | `storage-tenant-context.mjs` was introduced by 008-tenant-storage-context. Verify `provisionWorkspaceStorageBoundary` is exported. If absent, WF-CON-003 step C blocks; file gap. |
| Kafka admin adapter doesn't cover topic namespace creation for WF-CON-002 | Low | Medium | `kafka-admin.mjs` scope needs verification. If namespace provisioning is absent, WF-CON-002 step C blocks. |
| Concurrent same-key invocations race to write idempotency record | Medium | Medium | `markPending` uses `INSERT ... ON CONFLICT DO NOTHING` semantics via the BaaS state API. The second concurrent caller gets a 409. |
| WF-CON-002 or WF-CON-003 async action exceeds OpenWhisk action timeout | Low | Medium | Both actions should complete well within 60s. If not, T04's saga pattern (out of scope here) handles continuation. For now, job status `failed` with `failedStep` is the correct outcome. |

---

## Dependencies and Sequencing

### Pre-conditions (must be verified before coding begins)

1. Branch `068-console-workflow-functions` exists and is checked out ✓ (confirmed in task brief)
2. `specs/067-console-workflow-catalog/catalog.md` is finalized ✓ (confirmed: v1.0.0 delivered)
3. `004-console-openwhisk-backend` infrastructure is in place ✓ (confirmed: modules present in `apps/control-plane/src/`)
4. `services/adapters/src/keycloak-admin.mjs` exports `createRealm`, `createClient`, `assignRole`, `createServiceAccount` — **verify before WF-CON-002/WF-CON-006**
5. `services/adapters/src/kafka-admin.mjs` exports `createTopicNamespace` — **verify before WF-CON-002**
6. `services/adapters/src/storage-tenant-context.mjs` exports `provisionWorkspaceStorageBoundary` — **verify before WF-CON-003**

### Recommended implementation sequence

Each step can be delivered and tested independently:

```text
Step 1 (foundational): contracts + shared modules
  → console-workflow-invocation.json
  → console-workflow-job-status.json
  → authorization-model.json (additive)
  → workflow-invocation-contract.mjs
  → idempotency-store.mjs
  → job-status.mjs
  → index.mjs (registry + WF-CON-005 extension point)
  → openwhisk-admin.mjs (additive)

Step 2 (sync, simple): WF-CON-001 and WF-CON-006
  → wf-con-001-user-approval.mjs
  → wf-con-006-service-account.mjs
  These share only Keycloak + PostgreSQL adapters; fast to verify.

Step 3 (sync, credential): WF-CON-004
  → wf-con-004-credential-generation.mjs
  Requires APISIX adapter verification.

Step 4 (async): WF-CON-003
  → wf-con-003-workspace-creation.mjs
  Requires S3 adapter verification.

Step 5 (async, complex): WF-CON-002
  → wf-con-002-tenant-provisioning.mjs
  Most dependencies (Keycloak realm, Kafka, APISIX). Implement last.

Step 6: test suites for all modules (unit + contract + resilience)
```

Steps 2 and 3 can be parallelized once Step 1 is complete. Steps 4 and 5 can be parallelized with each other once Step 1 is complete, but depend on adapter verification.

---

## Criteria of Done

| ID | Criterion | Evidence |
|---|---|---|
| DoD-01 | All five non-provisional workflow functions exist and export a default invocation handler | Module present at canonical path; unit test `import` succeeds |
| DoD-02 | WF-CON-005 returns `NOT_IMPLEMENTED` (501) via registry extension point | Unit test for `index.mjs:resolveWorkflowHandler('WF-CON-005')` asserts `notImplemented: true` |
| DoD-03 | Each function rejects cross-tenant requests with zero mutations | Resilience test suite passes: all six cross-tenant scenarios return 403 |
| DoD-04 | Each function rejects under-privileged role with zero mutations | Resilience test suite passes: all per-workflow role rejection scenarios return 403 |
| DoD-05 | WF-CON-002 rejects non-superadmin caller | Resilience test: tenant_owner token → WF-CON-002 returns 403 |
| DoD-06 | Idempotent retry returns original result without re-executing steps | Unit test: invoke with key K → succeed → invoke again with key K → verify no second step execution, same result returned |
| DoD-07 | Concurrent duplicate key returns 409 | Unit test: two concurrent `checkIdempotency` on same pending key → one proceeds, one gets 409 |
| DoD-08 | WF-CON-002 and WF-CON-003 return jobRef within 2s in tests | Unit test with mocked async dispatch asserts response shape includes `jobRef` and `status: 'pending'` |
| DoD-09 | WF-CON-004 result on retry returns null credential (not re-transmitted) | Unit test: generate → succeed (credential in output) → retry same key → output.credential is null |
| DoD-10 | Every result envelope includes fully populated `auditFields` | Contract test validates `auditFields` schema for all five workflows; all required fields present |
| DoD-11 | `authorization-model.json` additive patch passes existing contract tests | Root contract test `npm run test:contracts` passes without modification |
| DoD-12 | No direct database connections or raw service API calls in workflow modules | Code review + contract tests assert only adapter module imports are used |
| DoD-13 | Root test suite passes (no regressions) | `npm test` at repo root passes clean |

---

## Explicit Out-of-Scope Boundary

The following are **excluded** from this plan and must not be implemented here:

- **T03**: Endpoint separation between SPA-consumed and backend-only routes — not in this plan.
- **T04**: Saga/compensation rollback logic — not in this plan. Functions fail cleanly and record `failedStep`; rollback is T04's responsibility.
- **T05**: Audit pipeline wiring, correlation-id emission to external audit sink — not in this plan. Functions produce audit-ready output only.
- **T06**: E2E tests against live BaaS services, failure injection scenarios — not in this plan.
- **OpenWhisk action deployment artifacts** (Helm charts, deployment YAML): the function *logic* modules are implemented here; deployment packaging is assumed to be handled by the existing 004-console-openwhisk-backend deployment tooling.

---

*Plan file: `specs/068-console-workflow-functions/plan.md`*
