# Tasks: E2E Tests for Complex Workflows with Partial Failure Compensation

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Backlog**: US-UIB-01-T06 · Epic EP-16
**Runner**: `node:test` (built-in, ESM)
**Entry point**: `node --test tests/e2e/workflows/**/*.test.mjs`

---

## Dependency Map

```text

T001 (scaffold dirs)
  ├── T002 (fault-injector.mjs)        → T008, T009, T010
  ├── T003 (audit-asserter.mjs)        → T008, T009, T010, T013
  ├── T004 (idempotency-tracker.mjs)   → T011
  ├── T005 (workflow-runner.mjs)       → T008, T009, T010, T011, T012, T013
  ├── T006 (tenant-context.mjs)        → T012
  └── T007 (fixtures)                  → T009, T010
        ↓
T008 (happy-path.test.mjs)
T009 (partial-failure.test.mjs)
T010 (compensation-retry.test.mjs)
T011 (idempotency.test.mjs)
T012 (multi-tenant-isolation.test.mjs)
T013 (audit-traceability.test.mjs)
        ↓
T014 (index.mjs suite entry)
T015 (package.json script)
T016 (ADR document)

```text

---

## T001 — Scaffold directory structure

**File paths to create (empty or minimal)**:

```text

tests/e2e/workflows/helpers/.gitkeep
tests/e2e/workflows/fixtures/fault-injection/.gitkeep
tests/e2e/workflows/fixtures/workflow-configs/.gitkeep

```text

**Action**: Create the above directory skeleton. No logic yet—just ensures subsequent tasks have their parent directories.

**Validation**:

```bash

test -d tests/e2e/workflows/helpers && test -d tests/e2e/workflows/fixtures/fault-injection && echo OK

```text

---

## T002 — Implement `tests/e2e/workflows/helpers/fault-injector.mjs`

**Purpose**: Provide per-workflow-step fault injection without modifying production code.  
Uses the `__setWorkflowDependenciesForTest` hook pattern already established in each workflow module.

**Imports needed** (already in production code):
- `../../apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs` → `__setWorkflowDependenciesForTest`
- `../../apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs` → `__setWorkflowDependenciesForTest`
- `../../apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs` → `__setWorkflowDependenciesForTest`

**API to implement**:

```js

// Inject a failure at a specific step ordinal of a named workflow.
// stepOrdinal is 1-based. All prior steps succeed; the target step throws.
// Returns a restore() function to reset dependencies after the test.
export function injectStepFailure(workflowId, stepOrdinal, opts = {})
// opts.errorCode  — string error code attached to thrown Error (default: 'INJECTED_FAULT')
// opts.retryUntil — number of attempts before succeeding (for compensation-retry tests)
// Returns: { restore }

// Reset all injected faults for a given workflowId.
export function restoreWorkflow(workflowId)

```text

**Step key → dependency map** (drive injection by overriding the named dependency):

| workflowId  | stepOrdinal | dependency key to override |
|-------------|-------------|---------------------------|
| WF-CON-002  | 1           | `createRealm`              |
| WF-CON-002  | 2           | `writeTenantRecord`        |
| WF-CON-002  | 3           | `createTopicNamespace`     |
| WF-CON-002  | 4           | `registerApisixRoutes`     |
| WF-CON-003  | 1           | `createClient`             |
| WF-CON-003  | 2           | `writeWorkspaceRecord`     |
| WF-CON-003  | 3           | `provisionWorkspaceStorageBoundary` |
| WF-CON-004  | 1           | `createKeycloakCredential` |
| WF-CON-004  | 2           | `syncApisixConsumer`       |
| WF-CON-004  | 3           | `recordCredentialMetadata` |

**Fault injection mechanism**: Dynamic import each workflow module and call their `__setWorkflowDependenciesForTest({ <key>: async () => { throw err } })`. This is the established pattern in the repo (no production code touched).

**Note**: For saga-engine-level tests (`executeSaga`), fault injection works differently. The saga engine calls the step forward functions from `saga-definitions.mjs` which imports from the actual wf-con-XXX.mjs modules. Those modules export named functions (not dependency-injected for the saga path). For saga-level E2E, fault injection must instead override the `forward` function at the saga definitions level. Implement a second internal helper:

```js

// Override a saga step's forward function to throw on the given call number.
// Uses a module-level Map keyed by workflowId+stepKey.
export function injectSagaStepFailure(workflowId, stepKey, opts = {})
// opts.errorCode
// opts.failOnAttempt — 1-indexed; previous attempts succeed (default: 1 = first call fails)
// Returns: { restore }

```text

This helper patches `sagaDefinitions` from `saga-definitions.mjs` in-process. Import the Map and mutate the target step's `forward` inside `beforeEach`, restore in `afterEach`.

**Validation**:

```bash

node --input-type=module <<'EOF'
import { injectSagaStepFailure } from './tests/e2e/workflows/helpers/fault-injector.mjs';
const { restore } = injectSagaStepFailure('WF-CON-002', 'create-postgresql-boundary');
console.assert(typeof restore === 'function', 'restore must be a function');
restore();
console.log('fault-injector.mjs OK');
EOF

```text

---

## T003 — Implement `tests/e2e/workflows/helpers/audit-asserter.mjs`

**Purpose**: Capture and assert workflow audit events emitted by `workflow-audit.mjs`.  
Uses `__setWorkflowAuditHooksForTesting` (already exported from `apps/control-plane/src/workflows/workflow-audit.mjs`).

**API to implement**:

```js

// Install an in-memory audit capture hook. Returns a capture object.
// Must be called before executeSaga in each test.
export function installAuditCapture()
// Returns: {
//   records: AuditRecord[],           // all emitted records in order
//   byCorrelationId(id): AuditRecord[],
//   assertComplete(correlationId, expectedEventTypes): void,
//   assertCompensationOrder(correlationId, expectedStepKeys): void,
//   assertTenantIsolation(allowedTenantId): void,
//   restore(): void
// }

```text

**Implementation notes**:
- Import `{ __setWorkflowAuditHooksForTesting }` from `../../../../apps/control-plane/src/workflows/workflow-audit.mjs` (relative from `tests/e2e/workflows/helpers/`)
- `emitAuditRecord` override pushes to `records[]`
- `assertComplete` checks that every `expectedEventType` appears in `records` for the given `correlationId`
- `assertCompensationOrder` verifies compensation events appear in reverse step-ordinal order
- `assertTenantIsolation` asserts no records exist with `tenantId !== allowedTenantId`
- `restore()` re-installs a no-op hook

**Validation**:

```bash

node --input-type=module <<'EOF'
import { installAuditCapture } from './tests/e2e/workflows/helpers/audit-asserter.mjs';
const capture = installAuditCapture();
console.assert(Array.isArray(capture.records), 'records must be array');
console.assert(typeof capture.restore === 'function', 'restore must be function');
capture.restore();
console.log('audit-asserter.mjs OK');
EOF

```text

---

## T004 — Implement `tests/e2e/workflows/helpers/idempotency-tracker.mjs`

**Purpose**: Generate unique idempotency keys per CI run and assert deduplication outcomes.

**API to implement**:

```js

// Generate a unique idempotency key scoped to the current test run.
// Prefixed with 'e2e-<timestamp>-' to avoid collisions across CI runs.
export function makeIdempotencyKey(label = '')
// Returns: string, e.g. 'e2e-1711800000000-tenant-provisioning-happy'

// Assert that a second saga result with the same key matches the first (dedup).
export function assertIdempotentResult(firstResult, secondResult)
// Throws AssertionError if results differ on status, sagaId, or output shape

```text

**Validation**:

```bash

node --input-type=module <<'EOF'
import { makeIdempotencyKey, assertIdempotentResult } from './tests/e2e/workflows/helpers/idempotency-tracker.mjs';
const k = makeIdempotencyKey('test');
console.assert(k.startsWith('e2e-'), 'key must start with e2e-');
console.log('idempotency-tracker.mjs OK');
EOF

```text

---

## T005 — Implement `tests/e2e/workflows/helpers/workflow-runner.mjs`

**Purpose**: Thin wrapper around `executeSaga` providing a consistent test-callable interface with sensible test defaults.

**API to implement**:

```js

// Run a saga workflow with a fully populated caller context.
// Returns the executeSaga result directly.
export async function runWorkflow(workflowId, params = {}, contextOverrides = {})
// Default context: { tenantId: 'test-tenant-a', workspaceId: 'ws-test-001',
//                    actorType: 'svc', actorId: 'e2e-test-runner' }
// contextOverrides merged on top of defaults.

```text

**Import**:

```js

import { executeSaga } from '../../../../apps/control-plane/src/saga/saga-engine.mjs';

```text

**Validation**:

```bash

node --input-type=module <<'EOF'
import { runWorkflow } from './tests/e2e/workflows/helpers/workflow-runner.mjs';
console.assert(typeof runWorkflow === 'function', 'runWorkflow must be function');
console.log('workflow-runner.mjs OK');
EOF

```text

---

## T006 — Implement `tests/e2e/workflows/helpers/tenant-context.mjs`

**Purpose**: Build distinct, named tenant contexts for multi-tenant isolation tests.

**API to implement**:

```js

// Return a fully populated caller context for tenant A (fixed test tenant).
export function tenantAContext(overrides = {})
// Returns: { tenantId: 'test-tenant-a', workspaceId: 'ws-tenant-a-001',
//             actorType: 'svc', actorId: 'e2e-runner-a', ...overrides }

// Return a fully populated caller context for tenant B (second test tenant).
export function tenantBContext(overrides = {})
// Returns: { tenantId: 'test-tenant-b', workspaceId: 'ws-tenant-b-001',
//             actorType: 'svc', actorId: 'e2e-runner-b', ...overrides }

```text

**Validation**:

```bash

node --input-type=module <<'EOF'
import { tenantAContext, tenantBContext } from './tests/e2e/workflows/helpers/tenant-context.mjs';
const a = tenantAContext(); const b = tenantBContext();
console.assert(a.tenantId !== b.tenantId, 'tenants must differ');
console.log('tenant-context.mjs OK');
EOF

```text

---

## T007 — Create fixture files

### `tests/e2e/workflows/fixtures/workflow-configs/wf-con-002.json`

```json

{
  "workflowId": "WF-CON-002",
  "label": "tenant-provisioning",
  "stepCount": 4,
  "stepKeys": [
    "create-keycloak-realm",
    "create-postgresql-boundary",
    "create-kafka-namespace",
    "configure-apisix-routes"
  ]
}

```text

### `tests/e2e/workflows/fixtures/workflow-configs/wf-con-003.json`

```json

{
  "workflowId": "WF-CON-003",
  "label": "workspace-creation",
  "stepCount": 3,
  "stepKeys": [
    "create-keycloak-client",
    "create-postgresql-workspace",
    "reserve-s3-storage"
  ]
}

```text

### `tests/e2e/workflows/fixtures/workflow-configs/wf-con-004.json`

```json

{
  "workflowId": "WF-CON-004",
  "label": "credential-generation",
  "stepCount": 3,
  "stepKeys": [
    "create-keycloak-credential",
    "sync-apisix-consumer",
    "record-credential-metadata"
  ]
}

```text

### `tests/e2e/workflows/fixtures/fault-injection/fail-at-step-2.json`

```json

{
  "failAtStepOrdinal": 2,
  "errorCode": "INJECTED_STEP_FAULT",
  "description": "Forces failure at step 2; steps at ordinal 1 succeed and must be compensated."
}

```text

### `tests/e2e/workflows/fixtures/fault-injection/fail-at-last-step.json`

```json

{
  "failAtStepOrdinal": "last",
  "errorCode": "INJECTED_LAST_STEP_FAULT",
  "description": "Forces failure at the final step; all prior steps must be compensated."
}

```text

**Validation**:

```bash

node -e "['wf-con-002','wf-con-003','wf-con-004'].forEach(f => { const d = JSON.parse(require('fs').readFileSync('tests/e2e/workflows/fixtures/workflow-configs/'+f+'.json')); console.assert(d.workflowId, f+' missing workflowId'); }); console.log('fixtures OK')"

```text

---

## T008 — Implement `tests/e2e/workflows/happy-path.test.mjs`

**Covers**: FR-001, FR-009, SC-001  
**Workflows under test**: WF-CON-002, WF-CON-003, WF-CON-004

**Test cases** (use `test()` from `node:test`):

1. `WF-CON-002 happy path: all 4 steps complete, status is completed, correlationId is present`
   - Call `runWorkflow('WF-CON-002', { idempotencyKey: makeIdempotencyKey('wf002-happy') })`
   - Assert `result.status === 'completed'`
   - Assert `result.sagaId` is a non-empty string
   - Assert audit capture contains `workflow.started` and `workflow.completed` events for the correlationId

2. `WF-CON-003 happy path: all 3 steps complete, status is completed`
   - Same pattern for WF-CON-003

3. `WF-CON-004 happy path: all 3 steps complete, status is completed`
   - Same pattern for WF-CON-004

4. `WF-CON-002 idempotent happy path: second execution with same key returns original result without re-executing steps`
   - Run WF-CON-002 once, record sagaId
   - Run again with same idempotencyKey
   - Assert second result matches first (same `status`, same `sagaId` OR same output shape)
   - Assert audit records contain only one `workflow.started` event for that correlationId

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

```text

**Validation**:

```bash

node --test tests/e2e/workflows/happy-path.test.mjs

```text

Expected: all 4 tests pass (or skip with clear message if saga dependencies unavailable).

---

## T009 — Implement `tests/e2e/workflows/partial-failure.test.mjs`

**Covers**: FR-002, FR-003, SC-001, SC-002  
**Workflows under test**: WF-CON-002 (fail at step 2), WF-CON-003 (fail at last step), WF-CON-004 (fail at step 1)

**Test cases**:

1. `WF-CON-002: fail at step 2 → steps [1] are compensated in reverse order`
   - `beforeEach`: `injectSagaStepFailure('WF-CON-002', 'create-postgresql-boundary')`
   - Call `runWorkflow('WF-CON-002', ...)`
   - Assert `result.status === 'compensated'` or `'failed'` (not `'completed'`)
   - Assert audit capture shows compensation for `create-keycloak-realm` (the only completed step before failure)
   - Assert no step after the failed step was executed

2. `WF-CON-003: fail at last step (reserve-s3-storage) → steps [1,2] compensated in reverse order`
   - Inject failure at `reserve-s3-storage`
   - Assert compensation events for `create-postgresql-workspace` then `create-keycloak-client` (reverse)
   - `assertCompensationOrder(correlationId, ['create-postgresql-workspace', 'create-keycloak-client'])`

3. `WF-CON-004: fail at step 1 (create-keycloak-credential) → compensation is a no-op`
   - Inject failure at `create-keycloak-credential`
   - Assert `result.status` is not `'completed'`
   - Assert audit capture has zero compensation events (nothing was committed)

4. `WF-CON-002: fail at step 2 → saga status is not completed and no orphan output for unexecuted steps`
   - After compensation, assert the saga final status is not `'completed'`
   - Assert no step-level output for steps 3 and 4 (they must never have run)

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeEach, afterEach } from 'node:test';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

```text

**Validation**:

```bash

node --test tests/e2e/workflows/partial-failure.test.mjs

```text

---

## T010 — Implement `tests/e2e/workflows/compensation-retry.test.mjs`

**Covers**: FR-007, SC-006

**Test cases**:

1. `WF-CON-003: compensation action that fails once retries and eventually succeeds`
   - Inject failure at `reserve-s3-storage` (forces compensation of steps 1+2)
   - Use `injectSagaStepFailure` with `opts.compensationFailOnAttempt = 1` for `create-postgresql-workspace`'s compensate function
   - Assert `result.allCompensated === true` (using `compensateSaga` directly or by inspecting saga engine output)
   - Assert compensation attempt count for the retried step is ≥ 2 and ≤ 3 (SC-006: within 3 retry attempts)

2. `WF-CON-002: compensation action that exhausts retries marks saga as compensation-failed`
   - Inject step failure at `create-kafka-namespace` (step 3)
   - Inject permanent compensation failure for `create-postgresql-boundary` (step 2)
   - Assert `result.status === 'compensation-failed'`
   - Assert `result.failedSteps` contains `create-postgresql-boundary`

**Note**: The compensation retry logic lives in `compensateSaga` (`apps/control-plane/src/saga/saga-compensation.mjs`). Since saga-engine delegates to it, assertions can be on the saga engine result (`result.allCompensated`, `result.failedSteps`). If the engine does not expose these directly, import `compensateSaga` and test it in concert.

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

```text

**Validation**:

```bash

node --test tests/e2e/workflows/compensation-retry.test.mjs

```text

---

## T011 — Implement `tests/e2e/workflows/idempotency.test.mjs`

**Covers**: FR-006, SC-005, User Story 5

**Test cases**:

1. `WF-CON-002 idempotent re-execution: same idempotencyKey returns original result, no second audit started event`
   - Run WF-CON-002 with `key = makeIdempotencyKey('idem-002')`
   - Capture first `result` and audit records
   - Reset audit capture
   - Run again with same `key`
   - `assertIdempotentResult(firstResult, secondResult)`
   - Assert second run has zero `workflow.started` audit events (steps not re-executed)

2. `WF-CON-003: compensated workflow re-triggered with a new key executes fresh`
   - Run WF-CON-003 with injected step failure (gets compensated)
   - Re-run WF-CON-003 with a different new key (no fault injection)
   - Assert second run has `status === 'completed'`
   - Assert second run has a distinct `sagaId` from the first

3. `WF-CON-004: in-progress saga key returns in-progress status without launching duplicate`
   - Use `checkIdempotencyKey` / `recordIdempotencyResult` directly to pre-seed an in-progress saga record
   - Call `runWorkflow('WF-CON-004', { idempotencyKey: seededKey })`
   - Assert `result.status === 'in-progress'`

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { makeIdempotencyKey, assertIdempotentResult } from './helpers/idempotency-tracker.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { checkIdempotencyKey } from '../../../../apps/control-plane/src/saga/saga-idempotency.mjs';

```text

**Validation**:

```bash

node --test tests/e2e/workflows/idempotency.test.mjs

```text

---

## T012 — Implement `tests/e2e/workflows/multi-tenant-isolation.test.mjs`

**Covers**: FR-005, SC-004, User Story 3

**Test cases**:

1. `Tenant A success + Tenant B failure: A's audit records unaffected by B's compensation`
   - Install shared audit capture
   - Run WF-CON-002 under `tenantAContext()` — no faults (succeeds)
   - Run WF-CON-003 under `tenantBContext()` with fault at step 2 (gets compensated)
   - `capture.assertTenantIsolation('test-tenant-a')` on tenant A's captured records
   - Assert no tenant-B records appear in tenant A's correlation ID audit trail

2. `Tenant A audit query returns only tenant A records`
   - Run both tenants concurrently with `Promise.all`
   - After both complete, call `capture.byCorrelationId(tenantACorrelationId)`
   - Assert every record has `tenantId === 'test-tenant-a'`
   - Assert tenantB records never appear in the result

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { tenantAContext, tenantBContext } from './helpers/tenant-context.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

```text

**Validation**:

```bash

node --test tests/e2e/workflows/multi-tenant-isolation.test.mjs

```text

---

## T013 — Implement `tests/e2e/workflows/audit-traceability.test.mjs`

**Covers**: FR-004, SC-003, User Story 4

**Test cases**:

1. `WF-CON-002 success: audit log reconstructable from single correlationId`
   - Run WF-CON-002, capture correlationId from result
   - `capture.assertComplete(correlationId, ['workflow.started', 'step.completed', 'workflow.completed'])`
   - Assert all 4 step milestones appear in order

2. `WF-CON-003 compensated failure: audit log contains failure + compensation entries`
   - Inject failure at step 3, run WF-CON-003
   - `capture.assertComplete(correlationId, ['workflow.started', 'step.completed', 'step.failed', 'step.compensated', 'workflow.compensated'])`
   - Assert each compensation entry references the tenantId and actorId from the original context

3. `WF-CON-004 success: all step milestones tagged with tenantId and actorId`
   - Run WF-CON-004 under `tenantAContext({ actorId: 'audit-test-actor' })`
   - Assert every audit record has `tenantId === 'test-tenant-a'` and `actorId === 'audit-test-actor'`

4. `WF-CON-002 edge case: first step failure → no compensation events, only failure event present`
   - Inject failure at step 1 (`create-keycloak-realm`)
   - Assert zero `step.compensated` events in audit log
   - Assert exactly one `step.failed` event

**Imports**:

```js

import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './helpers/workflow-runner.mjs';
import { installAuditCapture } from './helpers/audit-asserter.mjs';
import { injectSagaStepFailure } from './helpers/fault-injector.mjs';
import { tenantAContext } from './helpers/tenant-context.mjs';
import { makeIdempotencyKey } from './helpers/idempotency-tracker.mjs';

```text

**Validation**:

```bash

node --test tests/e2e/workflows/audit-traceability.test.mjs

```text

---

## T014 — Implement `tests/e2e/workflows/index.mjs`

**Purpose**: Suite entry point for CI. Dynamically imports and runs all test files.

**Implementation**:

```js

// tests/e2e/workflows/index.mjs
// CI entry point: node tests/e2e/workflows/index.mjs
// Relies on node:test's --test flag for discovery; this file documents intent.

export const suiteFiles = [
  './happy-path.test.mjs',
  './partial-failure.test.mjs',
  './compensation-retry.test.mjs',
  './idempotency.test.mjs',
  './multi-tenant-isolation.test.mjs',
  './audit-traceability.test.mjs',
];

// Run with: node --test tests/e2e/workflows/*.test.mjs
// Or individually: node --test tests/e2e/workflows/happy-path.test.mjs

```text

**Validation**:

```bash

node -e "import('./tests/e2e/workflows/index.mjs').then(m => { console.assert(m.suiteFiles.length === 6, 'must list 6 test files'); console.log('index.mjs OK'); })"

```text

---

## T015 — Add `test:e2e:workflows` script to `package.json`

**File**: `/root/projects/falcone/package.json`

**Change**: Add to the `"scripts"` object:

```json

"test:e2e:workflows": "node --test tests/e2e/workflows/*.test.mjs"

```text

**Also add** to the `"test"` composite script (append to the existing chain):

```text

&& npm run test:e2e:workflows

```text

**Validation**:

```bash

node -e "const p = JSON.parse(require('fs').readFileSync('package.json')); console.assert(p.scripts['test:e2e:workflows'], 'script missing'); console.log('package.json OK')"

```text

---

## T016 — Write `docs/adr/ADR-E2E-001-fault-injection-mechanism.md`

**File**: `docs/adr/ADR-E2E-001-fault-injection-mechanism.md`

**Required sections**:

```markdown

# ADR-E2E-001: Fault Injection Mechanism for Saga E2E Tests

**Status**: Accepted  
**Date**: 2026-03-30  
**Backlog**: US-UIB-01-T06

## Context
E2E tests for saga/compensation workflows (US-UIB-01-T06) must inject failures at
specific workflow steps to validate compensation paths, without modifying production code.

## Decision
Use in-process saga-definitions patching via the `sagaDefinitions` Map exported from
`apps/control-plane/src/saga/saga-definitions.mjs`. Each test temporarily replaces the
target step's `forward` function with one that throws on the configured call number.
The original function is captured before mutation and restored in `afterEach`.

For workflow-module-level tests (wf-con-XXX-*.mjs), use each module's existing
`__setWorkflowDependenciesForTest` hook.

## Rationale
- No production code is modified at test time.
- In-process patching avoids network-level fault injection infrastructure.
- The `sagaDefinitions` Map is module-scope; patching it affects only the current
  test process and is trivially restorable.
- Consistent with the existing `__setWorkflowAuditHooksForTesting` pattern.

## Alternatives Considered
1. **Environment-variable flags read by production code**: Rejected — requires production
   code changes; violates spec constraint.
2. **Network-level proxy fault injection (e.g., Toxiproxy)**: Rejected — requires
   external services; incompatible with offline CI.
3. **Separate stub action registrations in OpenWhisk**: Deferred — relevant only for
   HTTP-level E2E against a live OpenWhisk cluster.

## Consequences
- Tests are in-process only; they do not validate HTTP routing through APISIX.
- Compensation assertions rely on `workflow-audit.mjs` captures, not live DB queries.
- Live-environment E2E (APISIX → OpenWhisk → DB) is a future separate concern.

```text

**Validation**:

```bash

test -f docs/adr/ADR-E2E-001-fault-injection-mechanism.md && echo "ADR OK"

```text

---

## Delivery Checklist

After all tasks are implemented, run:

```bash

# 1. Validate all helpers are importable
node --input-type=module <<'EOF'
import './tests/e2e/workflows/helpers/fault-injector.mjs';
import './tests/e2e/workflows/helpers/audit-asserter.mjs';
import './tests/e2e/workflows/helpers/idempotency-tracker.mjs';
import './tests/e2e/workflows/helpers/workflow-runner.mjs';
import './tests/e2e/workflows/helpers/tenant-context.mjs';
console.log('All helpers import OK');
EOF

# 2. Run full E2E workflow test suite
node --test tests/e2e/workflows/*.test.mjs

# 3. Or via npm script
npm run test:e2e:workflows

# 4. Verify ADR exists
test -f docs/adr/ADR-E2E-001-fault-injection-mechanism.md && echo "ADR present"

# 5. Verify fixtures
ls tests/e2e/workflows/fixtures/workflow-configs/wf-con-002.json \
   tests/e2e/workflows/fixtures/workflow-configs/wf-con-003.json \
   tests/e2e/workflows/fixtures/workflow-configs/wf-con-004.json && echo "Fixtures OK"

```text

**All 6 test files must produce `pass` output (or `skip` with an explanatory message if a hard dependency is unavailable). Zero `fail` results are acceptable in CI.**

---

## Notes for the Implement Step

- **Relative import paths**: All helpers reference production code via paths relative to `tests/e2e/workflows/helpers/`, i.e., `../../../../apps/control-plane/src/...`.
- **No new npm dependencies**: Use only `node:test`, `node:assert/strict`, `node:crypto` (already available in Node 20+ ESM).
- **`sagaDefinitions` mutation guard**: `injectSagaStepFailure` must always restore the original `forward`/`compensate` function even if the test throws. Use `try/finally` or `afterEach` restore pattern.
- **Audit hook contention**: Only one audit hook can be active at a time. In multi-tenant tests (`T012`), install a single shared capture hook and filter by `tenantId` in assertions.
- **Saga state store**: The state store uses a lazy-loaded PostgreSQL adapter that no-ops when no DB is available (returns `{ rows: [] }`). Tests remain green in offline CI; assertions that depend on state-store reads (e.g., idempotency) must handle the no-op case by asserting the engine-level return value only.
