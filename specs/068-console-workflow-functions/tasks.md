# Tasks: US-UIB-01-T02 — Console Workflow Backend Functions

**Spec**: `specs/068-console-workflow-functions/spec.md`
**Plan**: `specs/068-console-workflow-functions/plan.md` ← primary source
**Catalog**: `specs/067-console-workflow-catalog/catalog.md`
**Branch**: `068-console-workflow-functions`
**Story**: US-UIB-01 | **Epic**: EP-16
**Generated**: 2026-03-29
**Scope boundary**: T02 only. T03/T04/T05/T06 are excluded. All outputs must be structurally compatible with those tasks without requiring rework.

---

## File Path Map (Complete)

### Files to CREATE (new)

| Path | Role |
|---|---|
| `services/internal-contracts/src/console-workflow-invocation.json` | JSON schema — invocation request + result envelope |
| `services/internal-contracts/src/console-workflow-job-status.json` | JSON schema — async job status record |
| `apps/control-plane/src/workflows/workflow-invocation-contract.mjs` | Pure validation/normalization — no I/O |
| `apps/control-plane/src/workflows/idempotency-store.mjs` | Idempotency key lifecycle via BaaS state API |
| `apps/control-plane/src/workflows/job-status.mjs` | Async job tracking and status query |
| `apps/control-plane/src/workflows/index.mjs` | Workflow registry + WF-CON-005 extension point |
| `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs` | WF-CON-001 synchronous handler |
| `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs` | WF-CON-002 async handler |
| `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs` | WF-CON-003 async handler |
| `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` | WF-CON-004 synchronous handler |
| `apps/control-plane/src/workflows/wf-con-006-service-account.mjs` | WF-CON-006 synchronous handler |
| `tests/unit/wf-con-001-user-approval.test.mjs` | Unit tests — WF-CON-001 |
| `tests/unit/wf-con-002-tenant-provisioning.test.mjs` | Unit tests — WF-CON-002 |
| `tests/unit/wf-con-003-workspace-creation.test.mjs` | Unit tests — WF-CON-003 |
| `tests/unit/wf-con-004-credential-generation.test.mjs` | Unit tests — WF-CON-004 |
| `tests/unit/wf-con-006-service-account.test.mjs` | Unit tests — WF-CON-006 |
| `tests/unit/workflow-idempotency-store.test.mjs` | Unit tests — idempotency-store |
| `tests/unit/workflow-job-status.test.mjs` | Unit tests — job-status |
| `tests/contracts/console-workflow-invocation.contract.test.mjs` | Contract tests — invocation schema |
| `tests/contracts/console-workflow-job-status.contract.test.mjs` | Contract tests — job status schema |
| `tests/resilience/console-workflow-authorization.test.mjs` | Resilience tests — authz rejection paths |

### Files to MODIFY (additive only — no existing behavior changed)

| Path | Change |
|---|---|
| `services/internal-contracts/src/authorization-model.json` | Add `workflow_authorization` top-level key (additive patch) |
| `services/adapters/src/openwhisk-admin.mjs` | Add 4 exports: constant prefix, jobRef builder, dispatch wrapper, action refs map |

### Files to READ (context — do not modify)

| Path | Why |
|---|---|
| `apps/control-plane/src/console-backend-functions.mjs` | Existing `validateConsoleBackendScope()` — consume, do not duplicate |
| `apps/control-plane/src/authorization-context.mjs` | Existing `callerContext` resolution shape |
| `services/internal-contracts/src/authorization-model.json` | Existing top-level keys to avoid collision |
| `services/internal-contracts/src/index.mjs` | Existing export surface to follow convention |
| `services/internal-contracts/src/internal-service-map.json` | Existing service map — read for consistency |
| `services/adapters/src/openwhisk-admin.mjs` | Existing exports — patch must be strictly additive |
| `services/adapters/src/keycloak-admin.mjs` | Verify: `createRealm`, `createClient`, `assignRole`, `createServiceAccount` exist |
| `services/adapters/src/postgresql-admin.mjs` | Verify: data write/read API for membership, workspace, credential, service account records |
| `services/adapters/src/kafka-admin.mjs` | Verify: `createTopicNamespace` exists (WF-CON-002 blocker if missing) |
| `services/adapters/src/storage-admin.mjs` | Verify: S3 storage helpers |
| `services/adapters/src/storage-tenant-context.mjs` | Verify: `provisionWorkspaceStorageBoundary` exists (WF-CON-003 blocker if missing) |
| `specs/068-console-workflow-functions/plan.md` | Primary implementation authority |
| `specs/067-console-workflow-catalog/catalog.md` | Workflow metadata, actor types, service lists |

---

## Phase 0 — Pre-flight Adapter Verification

> **Before writing any workflow function**, verify the adapter surface. Block if critical exports are absent.

### T02-P0-01 — Verify adapter exports

**Action**: Read each adapter file listed below and confirm the required exports exist.
**Files to read**: `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/postgresql-admin.mjs`, `services/adapters/src/kafka-admin.mjs`, `services/adapters/src/storage-tenant-context.mjs`, `services/adapters/src/openwhisk-admin.mjs`

**Required exports to confirm**:

| Adapter | Required exports | Used by |
|---|---|---|
| `keycloak-admin.mjs` | `createRealm`, `createClient`, `assignRole`, `createServiceAccount` | WF-CON-001, WF-CON-002, WF-CON-003, WF-CON-006 |
| `postgresql-admin.mjs` | Membership write, workspace write, credential metadata write, service account write | All workflow functions |
| `kafka-admin.mjs` | `createTopicNamespace` | WF-CON-002 Step C |
| `storage-tenant-context.mjs` | `provisionWorkspaceStorageBoundary` | WF-CON-003 Step C |
| `openwhisk-admin.mjs` | Existing dispatch API (before additive patch) | WF-CON-002, WF-CON-003 |

**Blockers**:
- Missing `createTopicNamespace` → WF-CON-002 Step C is blocked; file a BaaS surface gap issue before implementing WF-CON-002.
- Missing `provisionWorkspaceStorageBoundary` → WF-CON-003 Step C is blocked; file gap before WF-CON-003.
- Missing Keycloak realm/client exports → WF-CON-002 and WF-CON-003 blocked.

**If blocker found**: Stub the missing adapter export with a `throw new Error('NOT_YET_IMPLEMENTED: <export>')` guard. This allows workflow function shells to be written and tested with mocks while the BaaS gap is resolved.

**Done criterion**: Each required export is confirmed present or stubbed with a documented blocker note in the relevant task comment.

---

## Phase 1 — Contract Artifacts

> Foundation layer. All later phases depend on these artifacts being stable.

### T02-P1-01 — Create `console-workflow-invocation.json`

**File**: `services/internal-contracts/src/console-workflow-invocation.json` *(new)*
**Read first**: `services/internal-contracts/src/index.mjs` (naming convention), `plan.md` §1

**Schema content**:

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "console-workflow-invocation",
  "title": "Console Workflow Invocation Request and Result",
  "definitions": {
    "callerContext": {
      "type": "object",
      "required": ["actor", "actorType", "tenantId", "correlationId"],
      "properties": {
        "actor": { "type": "string" },
        "actorType": { "type": "string", "enum": ["workspace_admin", "tenant_owner", "superadmin"] },
        "tenantId": { "type": "string" },
        "workspaceId": { "type": ["string", "null"] },
        "correlationId": { "type": "string" }
      }
    },
    "auditFields": {
      "type": "object",
      "required": ["workflowId", "actor", "tenantId", "timestamp", "affectedResources", "outcome"],
      "properties": {
        "workflowId": { "type": "string" },
        "actor": { "type": "string" },
        "tenantId": { "type": "string" },
        "workspaceId": { "type": ["string", "null"] },
        "timestamp": { "type": "string", "format": "date-time" },
        "affectedResources": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["type", "id"],
            "properties": { "type": { "type": "string" }, "id": { "type": "string" } }
          }
        },
        "outcome": { "type": "string", "enum": ["succeeded", "failed"] }
      }
    },
    "errorSummary": {
      "type": "object",
      "required": ["code", "message"],
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string" },
        "failedStep": { "type": ["string", "null"] }
      }
    },
    "invocationRequest": {
      "type": "object",
      "required": ["workflowId", "idempotencyKey", "callerContext", "input"],
      "properties": {
        "workflowId": { "type": "string", "pattern": "^WF-CON-0[0-9]{2}$" },
        "idempotencyKey": { "type": "string", "format": "uuid" },
        "callerContext": { "$ref": "#/definitions/callerContext" },
        "input": { "type": "object" },
        "asyncHint": { "type": "boolean" }
      }
    },
    "workflowResult": {
      "type": "object",
      "required": ["workflowId", "idempotencyKey", "status"],
      "properties": {
        "workflowId": { "type": "string" },
        "idempotencyKey": { "type": "string" },
        "status": { "type": "string", "enum": ["succeeded", "failed", "pending", "running"] },
        "jobRef": { "type": ["string", "null"] },
        "output": { "type": ["object", "null"] },
        "errorSummary": { "oneOf": [{ "$ref": "#/definitions/errorSummary" }, { "type": "null" }] },
        "auditFields": { "$ref": "#/definitions/auditFields" }
      }
    }
  },
  "workflowInputShapes": {
    "WF-CON-001": { "required": ["userId", "targetWorkspaceId", "requestedRole"] },
    "WF-CON-002": { "required": ["tenantSlug", "tenantDisplayName", "adminEmail"] },
    "WF-CON-003": { "required": ["workspaceName", "workspaceSlug"] },
    "WF-CON-004": { "required": ["credentialAction", "targetWorkspaceId"],
      "credentialAction": { "enum": ["generate", "rotate", "revoke"] } },
    "WF-CON-005": {},
    "WF-CON-006": { "required": ["serviceAccountAction"],
      "serviceAccountAction": { "enum": ["create", "scope", "rotate", "deactivate", "delete"] } }
  }
}
```

**Done criterion**: File exists at path; JSON is valid; `definitions.invocationRequest`, `definitions.workflowResult`, and `definitions.auditFields` all present with required fields matching plan §1.

---

### T02-P1-02 — Create `console-workflow-job-status.json`

**File**: `services/internal-contracts/src/console-workflow-job-status.json` *(new)*
**Read first**: `plan.md` §2

**Schema content**: Object with `required: ["jobRef", "workflowId", "idempotencyKey", "status", "createdAt", "updatedAt"]`. `status` enum: `["pending", "running", "succeeded", "failed"]`. `result` and `errorSummary` nullable. `auditFields` ref to the same definition structure as invocation schema.

**Done criterion**: File exists; JSON valid; status enum covers all four values; `auditFields` property present.

---

### T02-P1-03 — Patch `authorization-model.json` (additive)

**File**: `services/internal-contracts/src/authorization-model.json` *(modify — additive only)*
**Read first**: Entire current content of the file to find the correct insertion point and avoid key collision.

**Change**: Add the following top-level key. Do NOT touch any existing keys:

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

**Done criterion**: `workflow_authorization` key exists with 6 entries; existing top-level keys unchanged; `npm run test:contracts` at repo root passes without modification (DoD-11).

---

## Phase 2 — Shared Modules

> All workflow functions depend on this phase. Complete before Phase 3/4.

### T02-P2-01 — Patch `openwhisk-admin.mjs` (additive)

**File**: `services/adapters/src/openwhisk-admin.mjs` *(modify — additive only)*
**Read first**: Entire file to understand existing exports, dispatch signature, and namespace handling.

**Additions** (append to end of file, no existing lines modified):

```js
// ── T02 additions: workflow dispatch helpers ──────────────────────────────────

export const OPENWHISK_WORKFLOW_ASYNC_JOB_STATUS_PREFIX = 'wf_job';

export const OPENWHISK_WORKFLOW_ACTION_REFS = Object.freeze({
  'WF-CON-001': 'console/wf-con-001-user-approval',
  'WF-CON-002': 'console/wf-con-002-tenant-provisioning',
  'WF-CON-003': 'console/wf-con-003-workspace-creation',
  'WF-CON-004': 'console/wf-con-004-credential-generation',
  'WF-CON-006': 'console/wf-con-006-service-account',
});

/**
 * Builds a deterministic job reference for deduplication purposes.
 * @param {string} workflowId  e.g. 'WF-CON-002'
 * @param {string} idempotencyKey  UUID v4
 * @returns {string}
 */
export function buildWorkflowAsyncJobRef(workflowId, idempotencyKey) {
  return `${OPENWHISK_WORKFLOW_ASYNC_JOB_STATUS_PREFIX}_${workflowId}_${idempotencyKey.replace(/-/g, '')}`;
}

/**
 * Dispatches a workflow OpenWhisk action with standard console_backend annotations.
 * @param {string} namespace  OpenWhisk namespace
 * @param {string} actionRef  e.g. OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-002']
 * @param {object} payload  Full invocation request passed to the action
 * @param {{ workflowId: string, correlationId: string, tenantId: string, workspaceId?: string }} annotation
 * @returns {Promise<{ activationId: string }>}
 */
export async function dispatchWorkflowAction(namespace, actionRef, payload, annotation) {
  // Uses existing dispatch infrastructure; injects console_backend surface marker.
  return dispatch(namespace, actionRef, {
    ...payload,
    _annotation: {
      initiating_surface: 'console_backend',
      workflowId: annotation.workflowId,
      correlationId: annotation.correlationId,
      tenantId: annotation.tenantId,
      workspaceId: annotation.workspaceId ?? null,
    },
  });
}
```

> **Note**: `dispatch` refers to the existing internal dispatch function already in `openwhisk-admin.mjs`. If the existing module uses a different internal helper name, align the call accordingly after reading the file.

**Done criterion**: Four new exports present; no existing export removed or modified; module imports cleanly in unit tests.

---

### T02-P2-02 — Create `workflow-invocation-contract.mjs`

**File**: `apps/control-plane/src/workflows/workflow-invocation-contract.mjs` *(new)*
**Read first**: `apps/control-plane/src/console-backend-functions.mjs`, `apps/control-plane/src/authorization-context.mjs`, `services/internal-contracts/src/console-workflow-invocation.json`, `services/internal-contracts/src/authorization-model.json`

**Exports** (pure functions — zero I/O, zero side effects):

```js
/**
 * Validates a raw invocation request against the console-workflow-invocation JSON schema.
 * @param {unknown} raw
 * @returns {{ ok: boolean, request?: object, violations?: string[] }}
 */
export function validateInvocationRequest(raw) { ... }

/**
 * Validates caller authorization against workflow_authorization from authorization-model.json.
 * Checks: (1) role in required_roles, (2) tenant boundary for tenant-scoped, (3) superadmin check.
 * @param {object} callerContext  { actor, actorType, tenantId, workspaceId }
 * @param {string} workflowId
 * @param {object} authorizationModel  the workflow_authorization section
 * @returns {{ authorized: boolean, reason?: string }}
 */
export function validateCallerAuthorization(callerContext, workflowId, authorizationModel) { ... }

/**
 * Builds the auditFields object for inclusion in every result envelope.
 * IMPORTANT: Does NOT emit events (T05 responsibility). Pure construction.
 * @param {string} workflowId
 * @param {object} callerContext
 * @param {Array<{type: string, id: string}>} affectedResources
 * @param {'succeeded'|'failed'} outcome
 * @returns {object}  auditFields
 */
export function buildAuditFields(workflowId, callerContext, affectedResources, outcome) { ... }

/**
 * Constructs a normalized failure result envelope. Does not throw.
 * @param {string} workflowId
 * @param {string} idempotencyKey
 * @param {string} code  e.g. 'FORBIDDEN', 'INVALID_REQUEST'
 * @param {string} message
 * @param {string|null} failedStep
 * @returns {object}  WorkflowResult with status:'failed'
 */
export function buildErrorResult(workflowId, idempotencyKey, code, message, failedStep) { ... }
```

**Implementation notes**:
- Load `authorization-model.json` at module init via `import authModel from '…/authorization-model.json' assert { type: 'json' }` (or `fs.readFileSync` if dynamic loading is required). Pass the `workflow_authorization` section to `validateCallerAuthorization`.
- `validateCallerAuthorization` must enforce: if `isolation === 'superadmin'`, reject unless `callerContext.actorType === 'superadmin'`. If `isolation === 'tenant-scoped'`, reject if `callerContext.tenantId` is absent or mismatched with the target resource's tenant.
- `buildAuditFields` must always populate `timestamp` as `new Date().toISOString()`.

**Done criterion**: Module exports all four functions; unit tests in `workflow-invocation-contract` (included in `workflow-idempotency-store.test.mjs` or a dedicated test) import and call all four without errors.

---

### T02-P2-03 — Create `idempotency-store.mjs`

**File**: `apps/control-plane/src/workflows/idempotency-store.mjs` *(new)*
**Read first**: `services/adapters/src/postgresql-admin.mjs` (data write API shape)

**Exports**:

```js
/**
 * Checks idempotency state for a given key.
 * Primary path: calls BaaS state API GET /v1/state/idempotency-keys/{key}
 * Fallback: queries PostgreSQL via postgresql-admin.mjs adapter if state API unavailable
 * @param {string} key
 * @returns {Promise<{ state: 'new'|'pending'|'succeeded'|'failed', cachedResult?: object, jobRef?: string }>}
 */
export async function checkIdempotency(key) { ... }

/**
 * Marks an idempotency key as pending.
 * Uses INSERT ON CONFLICT DO NOTHING semantics (concurrent 409 guard).
 * @param {string} key
 * @param {string} workflowId
 * @param {string} tenantId
 * @param {string|null} workspaceId
 * @param {string|null} jobRef  populated for async workflows
 * @returns {Promise<{ written: boolean }>}
 *   written:false means concurrent caller already holds the key → caller returns 409
 */
export async function markPending(key, workflowId, tenantId, workspaceId, jobRef) { ... }

/**
 * Marks an idempotency key as succeeded, stores result summary (no secret material).
 * @param {string} key
 * @param {object} resultSummary  WorkflowResult without credential values
 * @returns {Promise<void>}
 */
export async function markSucceeded(key, resultSummary) { ... }

/**
 * Marks an idempotency key as failed, stores error summary.
 * @param {string} key
 * @param {object} errorSummary  { code, message, failedStep }
 * @returns {Promise<void>}
 */
export async function markFailed(key, errorSummary) { ... }
```

**Implementation notes**:
- The module must **never** store credential/secret values in the idempotency record. Callers must strip secret material before calling `markSucceeded`.
- If the BaaS state API (`/v1/state/idempotency-keys`) returns 404/503, fall back to direct PostgreSQL via `postgresql-admin.mjs` using the `idempotency_keys` table schema defined in plan.md §Data Model. If neither path is available, throw a `BaaSStateUnavailableError` — the workflow must abort and return `503 DOWNSTREAM_UNAVAILABLE`.
- Expose an `_resetForTest()` helper (not exported in production build) for unit test isolation.

**Data model** (PostgreSQL table, if migration needed):

```sql
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT PRIMARY KEY,
  workflow_id    TEXT NOT NULL,
  tenant_id      TEXT NOT NULL,
  workspace_id   TEXT,
  job_ref        TEXT,
  state          TEXT NOT NULL CHECK (state IN ('pending','succeeded','failed')),
  result_summary JSONB,
  error_summary  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ
);
```

> If this table is absent from the current BaaS schema, a migration file must be placed at `services/provisioning-orchestrator/migrations/YYYYMMDD_add_idempotency_keys.sql`.

**Done criterion**: `workflow-idempotency-store.test.mjs` covers all four exported functions with mocked adapters; concurrent-key 409 guard path tested.

---

### T02-P2-04 — Create `job-status.mjs`

**File**: `apps/control-plane/src/workflows/job-status.mjs` *(new)*
**Read first**: `services/adapters/src/postgresql-admin.mjs`, `apps/control-plane/src/workflows/idempotency-store.mjs` (dependency)

**Exports**:

```js
/**
 * Creates a new async job record; returns the jobRef.
 * @param {string} workflowId
 * @param {string} idempotencyKey
 * @param {object} callerContext
 * @returns {Promise<string>}  jobRef
 */
export async function registerJob(workflowId, idempotencyKey, callerContext) { ... }

/**
 * Updates job status and result/error. Called by the async action on completion/failure.
 * Enforces state machine: pending → running → succeeded|failed only.
 * @param {string} jobRef
 * @param {'running'|'succeeded'|'failed'} status
 * @param {object|null} resultOrError
 * @returns {Promise<void>}
 */
export async function updateJobStatus(jobRef, status, resultOrError) { ... }

/**
 * Returns current job status for a jobRef. Validates caller tenantId matches job tenantId.
 * @param {string} jobRef
 * @param {object} callerContext  { tenantId }
 * @returns {Promise<object>}  job status record (console-workflow-job-status.json shape)
 * @throws {CrossTenantJobAccessError}  if callerContext.tenantId !== job.tenantId
 */
export async function queryJobStatus(jobRef, callerContext) { ... }
```

**Data model** (PostgreSQL table, if migration needed):

```sql
CREATE TABLE IF NOT EXISTS workflow_jobs (
  job_ref         TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL REFERENCES idempotency_keys(key),
  tenant_id       TEXT NOT NULL,
  workspace_id    TEXT,
  actor           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  result          JSONB,
  error_summary   JSONB
);
```

**Done criterion**: `workflow-job-status.test.mjs` covers `registerJob`, status transitions, cross-tenant rejection, and SLO assertion (response under 1 s with mocked adapter).

---

### T02-P2-05 — Create `index.mjs` (workflow registry)

**File**: `apps/control-plane/src/workflows/index.mjs` *(new)*
**Read first**: `plan.md` §8

**Content**:

```js
// apps/control-plane/src/workflows/index.mjs
// Workflow registry and WF-CON-005 extension point.

class WorkflowNotFoundError extends Error {
  constructor(workflowId) {
    super(`Workflow not found: ${workflowId}`);
    this.code = 'WORKFLOW_NOT_FOUND';
    this.workflowId = workflowId;
  }
}

const WORKFLOW_REGISTRY = new Map([
  ['WF-CON-001', () => import('./wf-con-001-user-approval.mjs')],
  ['WF-CON-002', () => import('./wf-con-002-tenant-provisioning.mjs')],
  ['WF-CON-003', () => import('./wf-con-003-workspace-creation.mjs')],
  ['WF-CON-004', () => import('./wf-con-004-credential-generation.mjs')],
  ['WF-CON-006', () => import('./wf-con-006-service-account.mjs')],
]);

/**
 * Registers a workflow handler import factory.
 * This is the WF-CON-005 extension point per FR-010.
 */
export function registerWorkflow(workflowId, handlerImport) {
  WORKFLOW_REGISTRY.set(workflowId, handlerImport);
}

/**
 * Resolves a workflow handler module for a given workflowId.
 * WF-CON-005 returns { notImplemented: true } (501 response).
 * Unknown IDs throw WorkflowNotFoundError (404 response).
 */
export async function resolveWorkflowHandler(workflowId) {
  if (!WORKFLOW_REGISTRY.has(workflowId)) {
    if (workflowId === 'WF-CON-005') return { notImplemented: true };
    throw new WorkflowNotFoundError(workflowId);
  }
  return (await WORKFLOW_REGISTRY.get(workflowId)()).default;
}

export { WorkflowNotFoundError };
```

**Done criterion**: `resolveWorkflowHandler('WF-CON-005')` returns `{ notImplemented: true }` (DoD-02); unknown ID throws `WorkflowNotFoundError`; all five registered IDs resolve to their module defaults.

---

## Phase 3 — Synchronous Workflow Functions

> Depends on Phase 2. Steps 2 and 3 from plan.md recommended sequence.

### T02-P3-01 — WF-CON-001: `wf-con-001-user-approval.mjs`

**File**: `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs` *(new)*
**Read first**: `plan.md` §9, `catalog.md` WF-CON-001 entry, `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/postgresql-admin.mjs`

**Handler signature**:

```js
/**
 * @param {object} request  Validated invocation request (console-workflow-invocation.json shape)
 * @returns {Promise<object>}  WorkflowResult (status: 'succeeded' | 'failed')
 */
export default async function handleUserApproval(request) { ... }
```

**Execution sequence** (strict order):
1. `validateInvocationRequest(request)` → abort with `buildErrorResult(..., 'INVALID_REQUEST', ...)` if not OK.
2. Load `authorizationModel.workflow_authorization` → call `validateCallerAuthorization(request.callerContext, 'WF-CON-001', ...)` → abort with `buildErrorResult(..., 'FORBIDDEN', ...)` if not authorized.
3. Double-check: `request.callerContext.tenantId === derivedTenantId(request.input.targetWorkspaceId)` → abort if mismatch (TOCTOU guard).
4. `checkIdempotency(request.idempotencyKey)` → if `succeeded|failed`: return `cachedResult` immediately (no re-execution). If `pending`: return `buildErrorResult(..., 'DUPLICATE_INVOCATION', ...)` with HTTP 409.
5. `markPending(request.idempotencyKey, 'WF-CON-001', tenantId, workspaceId, null)`.
6. Via `keycloak-admin.mjs`: assign `request.input.requestedRole` to `request.input.userId` in tenant realm. Record `affectedResources`: `[{ type: 'keycloak_role_assignment', id: <assignment_id> }]`.
7. Via `postgresql-admin.mjs`: update membership record → status `active`. Record `affectedResources`: append `{ type: 'membership_record', id: <record_id> }`.
8. `buildAuditFields('WF-CON-001', callerContext, affectedResources, 'succeeded')`.
9. Construct result: `{ workflowId: 'WF-CON-001', idempotencyKey, status: 'succeeded', jobRef: null, output: { userId, targetWorkspaceId, grantedRole }, auditFields }`.
10. Strip any secret material (none in this workflow — step is a no-op here, kept for consistency).
11. `markSucceeded(request.idempotencyKey, resultWithoutSecrets)`.
12. Return full result (with any non-secret output).

**Error handling**: any step failure → `markFailed(key, errorSummary)` → return `buildErrorResult` with populated `failedStep`. No partial rollback (T04 responsibility).

**Secret handling**: none — this workflow does not touch credentials.

**Done criterion**: `wf-con-001-user-approval.test.mjs` passes all cases listed in Phase 5.

---

### T02-P3-02 — WF-CON-006: `wf-con-006-service-account.mjs`

**File**: `apps/control-plane/src/workflows/wf-con-006-service-account.mjs` *(new)*
**Read first**: `plan.md` §13, `catalog.md` WF-CON-006 entry, `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/postgresql-admin.mjs`

**Handler signature**: same pattern as WF-CON-001.

**Execution sequence** (common prefix: steps 1–5 identical to WF-CON-001 with `workflowId='WF-CON-006'`):

**Branch on `request.input.serviceAccountAction`**:

| Action | Keycloak step | PostgreSQL step | Returns secret? |
|---|---|---|---|
| `create` | `createServiceAccount(...)` | Write service account record bound to workspaceId | No |
| `scope` | `updateServiceAccountScopeBindings(...)` (SWF-CON-B) | Update scope metadata record | No |
| `rotate` | `regenerateServiceAccountCredentials(...)` | Update credential metadata record | Yes — one-time |
| `deactivate` | `disableServiceAccount(...)` | Mark account inactive | No |
| `delete` | `deleteServiceAccount(...)` | Mark account deleted | No |

**Secret handling for `rotate`** (FR-007):
- Return credential value in `output.credential` in the response.
- Store result **without** credential value in `markSucceeded(key, resultSansSecret)`.
- Idempotent retry: return `{ output: { serviceAccountId, credentialId, rotatedAt, credential: null } }` — do NOT re-transmit secret.

**Done criterion**: `wf-con-006-service-account.test.mjs` passes all five action branches + secret one-time exposure test.

---

### T02-P3-03 — WF-CON-004: `wf-con-004-credential-generation.mjs`

**File**: `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` *(new)*
**Read first**: `plan.md` §12, `catalog.md` WF-CON-004 entry, `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/storage-admin.mjs` (for APISIX adapter — confirm path), `services/adapters/src/postgresql-admin.mjs`

> **Note**: plan.md references an APISIX adapter. Verify its module path in the adapters directory. Likely `services/adapters/src/apisix-admin.mjs` or similar. Read the adapters directory before implementing.

**Handler signature**: same pattern.

**Execution sequence** (common prefix: steps 1–5):

**Branch on `request.input.credentialAction`**:

| Action | Step A (Keycloak) | Step B (APISIX) | Step C (PostgreSQL) | Secret exposure |
|---|---|---|---|---|
| `generate` | Create client secret for workspace client | Register consumer key | Write credential metadata record | Yes — `output.credential` |
| `rotate` | Regenerate client secret | Update consumer key | Update metadata record | Yes — `output.credential` |
| `revoke` | Disable/delete client credential | Remove consumer key | Mark credential revoked | No |

**Secret handling** (FR-007, identical to WF-CON-006 rotate):
- `generate` and `rotate`: include raw credential in response `output.credential`.
- `markSucceeded(key, resultSansSecret)` — idempotency record never contains secret.
- Retry on same key returns `{ output: { credentialId, credentialType, credential: null } }`.

**Done criterion**: `wf-con-004-credential-generation.test.mjs` passes all three branches + DoD-09 (retry returns null credential).

---

## Phase 4 — Asynchronous Workflow Functions

> Depends on Phase 2. Parallel with Phase 3 after T02-P2-xx complete.
> Requires adapter verification from Phase 0 before finalizing steps C/D.

### T02-P4-01 — WF-CON-003: `wf-con-003-workspace-creation.mjs`

**File**: `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs` *(new)*
**Read first**: `plan.md` §11, `catalog.md` WF-CON-003 entry, `services/adapters/src/storage-tenant-context.mjs`, `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/postgresql-admin.mjs`, `services/adapters/src/openwhisk-admin.mjs`

**Handler signature**:

```js
export default async function handleWorkspaceCreation(request) { ... }
```

**Synchronous phase** (must complete and return within 2 s):
1–4. `validateInvocationRequest` → `validateCallerAuthorization` (role: `tenant_owner`) → check idempotency → `registerJob(...)` → `markPending(key, 'WF-CON-003', tenantId, null, jobRef)`.
5. `dispatchWorkflowAction(namespace, OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-003'], payload, annotation)` — **non-blocking** (fire and forget; activation ID logged but not awaited).
6. Return `{ workflowId: 'WF-CON-003', idempotencyKey, status: 'pending', jobRef }`.

**Async action internal steps** (runs inside OpenWhisk action body — same file, exported as `runWorkspaceCreationAction`):
- Step A: Via `keycloak-admin.mjs` → `createClient(...)` for workspace (SWF-CON-A). `updateJobStatus(jobRef, 'running', null)`.
- Step B: Via `postgresql-admin.mjs` → write workspace record (SWF-CON-C idempotency). Record `failedStep: 'write_workspace_record'` if fails.
- Step C: Via `storage-tenant-context.mjs` → `provisionWorkspaceStorageBoundary(...)`. Record `failedStep: 'provision_storage_boundary'` if fails.
- On all steps success: `updateJobStatus(jobRef, 'succeeded', result)`.
- On any step failure: `updateJobStatus(jobRef, 'failed', { code: 'STEP_FAILURE', message, failedStep })`. **No partial rollback** (T04).

**Done criterion**: unit test asserts: (a) synchronous response returns `jobRef` + `status:'pending'`; (b) no adapter calls made in synchronous path beyond job registration and dispatch; (c) async action steps invoked in correct order with mocked adapters (DoD-08).

---

### T02-P4-02 — WF-CON-002: `wf-con-002-tenant-provisioning.mjs`

**File**: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs` *(new)*
**Read first**: `plan.md` §10, `catalog.md` WF-CON-002 entry, `services/adapters/src/keycloak-admin.mjs`, `services/adapters/src/postgresql-admin.mjs`, `services/adapters/src/kafka-admin.mjs`, APISIX adapter (verify path)

**Handler signature**: same pattern.

**Critical security check** (DoD-05, FR-008):
- Step 1 must verify `request.callerContext.actorType === 'superadmin'` **explicitly** before any other step. This is the function's last line of defense. If `actorType !== 'superadmin'`, return `buildErrorResult('WF-CON-002', key, 'FORBIDDEN', 'Superadmin required', null)` immediately.

**Synchronous phase** (must complete within 2 s):
1. Superadmin check (above).
2. `validateInvocationRequest` → `validateCallerAuthorization` (double-check via model).
3. Check idempotency → return cached jobRef if already registered.
4. `registerJob(...)` → `markPending(key, 'WF-CON-002', 'superadmin', null, jobRef)`.
5. `dispatchWorkflowAction(namespace, OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-002'], payload, annotation)`.
6. Return `{ workflowId: 'WF-CON-002', idempotencyKey, status: 'pending', jobRef }`.

**Async action internal steps**:
- Step A: Via `keycloak-admin.mjs` → `createRealm(tenantSlug)` + baseline realm configuration (SWF-CON-A). `updateJobStatus(jobRef, 'running', null)`.
- Step B: Via `postgresql-admin.mjs` → write tenant boundary record. `failedStep: 'write_tenant_record'` on failure.
- Step C: Via `kafka-admin.mjs` → `createTopicNamespace(tenantSlug)`. `failedStep: 'create_kafka_namespace'` on failure. **If adapter export missing → abort with `NOT_YET_IMPLEMENTED` and mark job failed**.
- Step D: Via APISIX adapter → register tenant route configuration. `failedStep: 'register_apisix_routes'` on failure.
- On all success: `updateJobStatus(jobRef, 'succeeded', result)`.
- On any failure: `updateJobStatus(jobRef, 'failed', errorSummary)`. **No partial rollback** (T04).

**Done criterion**: unit test asserts: (a) non-superadmin token → immediate 403 before any other processing; (b) synchronous response returns `jobRef` + `status:'pending'`; (c) four async steps invoked in order (DoD-05, DoD-08).

---

## Phase 5 — Test Suites

> All tests use `node:test` (built-in). All adapter calls mocked — no live HTTP.

### T02-P5-01 — Unit test: `wf-con-001-user-approval.test.mjs`

**File**: `tests/unit/wf-con-001-user-approval.test.mjs` *(new)*

**Test cases** (minimum required):
1. Happy path: valid request, workspace_admin role, correct tenant → `status:'succeeded'`, auditFields populated.
2. Wrong role (tenant_member) → `FORBIDDEN`, no adapter calls made.
3. Cross-tenant request (`callerContext.tenantId !== workspace.tenantId`) → `FORBIDDEN`, no adapter calls.
4. Idempotency: duplicate key (state=`succeeded`) → returns cached result, no re-execution of adapter steps.
5. Idempotency: duplicate key (state=`pending`) → returns 409 `DUPLICATE_INVOCATION`.
6. Keycloak adapter failure at step 6 → `markFailed` called, result has `failedStep:'assign_keycloak_role'`.
7. PostgreSQL adapter failure at step 7 → `markFailed` called, result has `failedStep:'update_membership_record'`.
8. `auditFields.affectedResources` contains both keycloak_role_assignment and membership_record entries.

### T02-P5-02 — Unit test: `wf-con-002-tenant-provisioning.test.mjs`

**Test cases**:
1. Non-superadmin token → immediate 403, no jobRef created, no adapter calls.
2. Superadmin token → synchronous response has `jobRef` + `status:'pending'` within mocked time.
3. `registerJob` is called; `dispatchWorkflowAction` is called with correct action ref.
4. Async action: all four steps succeed → `updateJobStatus(..., 'succeeded', ...)`.
5. Async action: Step C (Kafka) fails → `updateJobStatus(..., 'failed', { failedStep:'create_kafka_namespace' })`.
6. Async action: Step A (Keycloak) fails → `updateJobStatus(..., 'failed', { failedStep:'create_keycloak_realm' })`.
7. Duplicate idempotency key (state=`pending`) → returns cached jobRef, no new job registration.

### T02-P5-03 — Unit test: `wf-con-003-workspace-creation.test.mjs`

**Test cases**:
1. Non-tenant_owner role → 403 before any provisioning.
2. Correct tenant_owner → synchronous `jobRef` + `status:'pending'`.
3. Async action: Keycloak client + PostgreSQL write + S3 boundary all succeed.
4. Async action: S3 step fails → `failedStep:'provision_storage_boundary'`.
5. Cross-tenant (callerContext.tenantId mismatch) → 403.

### T02-P5-04 — Unit test: `wf-con-004-credential-generation.test.mjs`

**Test cases**:
1. `generate` action → `output.credential` populated in response; `markSucceeded` called without credential value.
2. `generate` retry (same key, state=`succeeded`) → `output.credential === null` (DoD-09).
3. `rotate` action → same secret one-time pattern as generate.
4. `revoke` action → no credential in output; metadata updated.
5. APISIX adapter failure in any branch → step marked with `failedStep`.
6. Cross-tenant request → 403.
7. Under-privileged role → 403.

### T02-P5-05 — Unit test: `wf-con-006-service-account.test.mjs`

**Test cases**:
1. `create` action → service account record written, no secret in idempotency store.
2. `scope` action → scope bindings updated via SWF-CON-B.
3. `rotate` action → credential in response; idempotency record has no credential; retry returns null.
4. `deactivate` action → account marked inactive.
5. `delete` action → account marked deleted.
6. Cross-tenant + under-privileged role → 403.
7. `auditFields.affectedResources` lists all mutated resources for each action.

### T02-P5-06 — Unit test: `workflow-idempotency-store.test.mjs`

**Test cases**:
1. `checkIdempotency` on unknown key → `{ state: 'new' }`.
2. `markPending` → `checkIdempotency` returns `{ state: 'pending' }`.
3. `markSucceeded` with result → `checkIdempotency` returns `{ state: 'succeeded', cachedResult }`.
4. `markFailed` with errorSummary → `checkIdempotency` returns `{ state: 'failed' }`.
5. Concurrent `markPending` on same key: second call returns `{ written: false }` (409 guard path).
6. `markSucceeded` never stores secret material: pass a result with `credential: 'secret'`, assert stored record has no `credential` field.
7. BaaS state API unavailable → falls back to PostgreSQL adapter.

### T02-P5-07 — Unit test: `workflow-job-status.test.mjs`

**Test cases**:
1. `registerJob` → returns string jobRef matching `wf_job_*` pattern.
2. `updateJobStatus(jobRef, 'running', null)` → state transitions from `pending` to `running`.
3. `updateJobStatus(jobRef, 'succeeded', result)` → state transitions to `succeeded`, result stored.
4. `updateJobStatus(jobRef, 'failed', error)` → state transitions to `failed`.
5. Invalid transition (e.g., `succeeded → running`) → throws `InvalidJobStateTransitionError`.
6. `queryJobStatus` with correct tenantId → returns record.
7. `queryJobStatus` with wrong tenantId → throws `CrossTenantJobAccessError` (DoD-03 family).
8. `queryJobStatus` response time: mocked adapter resolves immediately; assert no artificial delays.

### T02-P5-08 — Contract test: `console-workflow-invocation.contract.test.mjs`

**File**: `tests/contracts/console-workflow-invocation.contract.test.mjs` *(new)*

**Test cases**:
1. Valid WF-CON-001 request → passes schema validation.
2. Valid WF-CON-002 request → passes.
3. Valid WF-CON-003 request → passes.
4. Valid WF-CON-004 request (all three `credentialAction` values) → each passes.
5. Valid WF-CON-005 request (empty input) → passes.
6. Valid WF-CON-006 request (all five `serviceAccountAction` values) → each passes.
7. Missing `idempotencyKey` → validation failure.
8. Missing `callerContext` → validation failure.
9. Sync result envelope: `auditFields` present and matches schema (DoD-10).
10. Async result envelope: `jobRef` populated, `status:'pending'`, no `auditFields` required at pending stage.
11. `errorSummary` shape when `status:'failed'`.

### T02-P5-09 — Contract test: `console-workflow-job-status.contract.test.mjs`

**Test cases**:
1. Job status record with all four `status` enum values → each passes schema.
2. `result` and `errorSummary` are nullable.
3. `auditFields` present when `status:'succeeded'`.
4. Cross-tenant rejection contract: `queryJobStatus` with mismatched `tenantId` → error, no record leaked.

### T02-P5-10 — Resilience test: `console-workflow-authorization.test.mjs`

**File**: `tests/resilience/console-workflow-authorization.test.mjs` *(new)*

**Test cases** (DoD-03, DoD-04, DoD-05):
1. Cross-tenant token → WF-CON-001 → 403, no Keycloak/PostgreSQL calls.
2. Cross-tenant token → WF-CON-003 → 403, no provisioning calls.
3. Cross-tenant token → WF-CON-004 → 403, no credential operations.
4. Cross-tenant token → WF-CON-006 → 403, no service account operations.
5. `tenant_member` role → WF-CON-001 → 403 (role `workspace_admin` required).
6. `workspace_admin` role → WF-CON-002 → 403 (`superadmin` required — DoD-05).
7. `workspace_admin` role → WF-CON-003 → 403 (`tenant_owner` required).
8. `tenant_owner` token (not `superadmin`) → WF-CON-002 → 403.
9. Unknown workflowId (`WF-CON-099`) → 404 `WORKFLOW_NOT_FOUND`.
10. WF-CON-005 → 501 `NOT_IMPLEMENTED`.
11. Invalid invocation request (missing fields) → 400 `INVALID_REQUEST`.

---

## Phase 6 — Integration Check

### T02-P6-01 — Root test suite passes

**Command**: `npm test` (from repo root)
**Expected**: All existing tests pass; new tests in `tests/unit/`, `tests/contracts/`, `tests/resilience/` are discovered and pass.
**Specifically verify**: `authorization-model.json` contract tests pass without modification (DoD-11, DoD-13).

### T02-P6-02 — Adapter surface check (manual)

Re-verify that no workflow module contains a direct database connection or raw Keycloak admin REST call outside an adapter module (DoD-12). Confirm via code review: all `import` statements in `apps/control-plane/src/workflows/*.mjs` reference only:
- `./workflow-invocation-contract.mjs`
- `./idempotency-store.mjs`
- `./job-status.mjs`
- `./index.mjs`
- `services/adapters/src/*.mjs`
- `services/internal-contracts/src/*.json`
- Node built-ins

Any direct service client import is a blocker for merge.

---

## Done Criteria (from plan.md + T02 scope)

| ID | Criterion | Evidence |
|---|---|---|
| DoD-01 | All five non-provisional workflow functions exist and export a default invocation handler | Each module at canonical path; unit test `import` succeeds |
| DoD-02 | WF-CON-005 returns `NOT_IMPLEMENTED` via registry extension point | Unit test for `index.mjs:resolveWorkflowHandler('WF-CON-005')` asserts `{ notImplemented: true }` |
| DoD-03 | Each function rejects cross-tenant requests with zero mutations | Resilience test T02-P5-10, cases 1–4 all pass (403, no adapter calls) |
| DoD-04 | Each function rejects under-privileged role with zero mutations | Resilience test T02-P5-10, cases 5–8 all pass (403) |
| DoD-05 | WF-CON-002 rejects non-superadmin caller | Resilience test case 6+8: tenant_owner → WF-CON-002 → 403 |
| DoD-06 | Idempotent retry returns original result without re-executing steps | Unit tests T02-P5-01 case 4; T02-P5-04 case 2; T02-P5-05 case 3 |
| DoD-07 | Concurrent duplicate key returns 409 | T02-P5-06 case 5: concurrent `markPending` → `written:false` → 409 |
| DoD-08 | WF-CON-002 and WF-CON-003 return jobRef within 2s | T02-P5-02 case 2, T02-P5-03 case 2: response shape `{ jobRef, status:'pending' }` |
| DoD-09 | WF-CON-004 retry returns null credential | T02-P5-04 case 2: generate → succeed → retry → `output.credential === null` |
| DoD-10 | Every sync result envelope includes fully populated `auditFields` | T02-P5-08 case 9: contract test validates auditFields schema |
| DoD-11 | `authorization-model.json` additive patch passes existing contract tests | `npm run test:contracts` passes unchanged (T02-P6-01) |
| DoD-12 | No direct DB connections or raw service calls in workflow modules | Code review + import audit (T02-P6-02) |
| DoD-13 | Root test suite passes with no regressions | `npm test` at repo root clean (T02-P6-01) |

---

## Explicit Out-of-Scope (T02 boundary)

The following are **excluded from this tasks.md** — do not implement:

- **T03**: SPA endpoint separation — not here.
- **T04**: Saga/compensation rollback. Functions record `failedStep`; rollback is T04's problem.
- **T05**: Audit pipeline wiring, correlation-id emission to external sink. Functions construct `auditFields`; pipeline is T05's.
- **T06**: E2E tests against live BaaS services; failure injection; concurrent race condition verification.
- **OpenWhisk deployment artifacts** (Helm charts, deployment YAML): function logic only. Deployment packaging handled by existing 004-console-openwhisk-backend tooling.
- **Migration scripts** for `idempotency_keys` / `workflow_jobs` tables: IF the BaaS state API is available, no migration is needed. If the fallback PostgreSQL path is needed, add migration at `services/provisioning-orchestrator/migrations/YYYYMMDD_add_workflow_state.sql` as a **conditional deliverable** only when Phase 0 confirms the BaaS state API is absent.

---

## Interface Notes for T03/T04/T05/T06 (dependency surface only)

- **T03** will need the `resolveWorkflowHandler` export from `index.mjs` to route `/v1/workflows/{workflowId}/invoke` requests. The handler function signature is: `(request: InvocationRequest) => Promise<WorkflowResult>`.
- **T04** will read `failedStep` from `errorSummary` in `idempotency_keys.error_summary` and `workflow_jobs.error_summary`. The field must be a stable step name string (not an error message).
- **T05** will consume `auditFields` from every `WorkflowResult`. The shape is already defined in `console-workflow-invocation.json#/definitions/auditFields`. No rework required.
- **T06** will import the same workflow handler modules from Phase 3/4 for E2E integration scenarios against live BaaS services.

---

*Tasks file: `specs/068-console-workflow-functions/tasks.md`*
