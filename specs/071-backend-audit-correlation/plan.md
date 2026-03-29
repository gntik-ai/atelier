# Implementation Plan: Console Backend Audit and Correlation

**Branch**: `071-backend-audit-correlation` | **Date**: 2026-03-29 | **Spec**: `specs/071-backend-audit-correlation/spec.md`
**Task**: US-UIB-01-T05
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura
**Epic**: EP-16 — Backend funcional de la consola
**Upstream dependencies**:
- `specs/067-console-workflow-catalog/catalog.md` (US-UIB-01-T01, delivered)
- `specs/068-console-workflow-functions/plan.md` (US-UIB-01-T02, delivered)
- `specs/069-console-endpoint-separation/plan.md` (US-UIB-01-T03, delivered)
- `specs/070-saga-compensation-workflows/plan.md` (US-UIB-01-T04, delivered)

> **Scope boundary**: This plan covers T05 only — wiring audit emission and correlation-id propagation into the saga engine and all workflow function modules. It does NOT include: saga engine restructuring (T04), E2E failure and compensation tests (T06), new audit query/export surfaces (US-OBS-02), new UI screens, or new report products. All work must be compatible with and extend the existing infrastructure without rework.

---

## 1. Summary

Wire every console backend workflow execution to the platform's existing audit pipeline and ensure every execution carries a stable correlation identifier from initiation through terminal state. The saga engine (T04) already generates a `correlationId` via `saga-correlation.mjs` and propagates it as `sagaCtx.correlationId` through every step. This task adds the audit emission calls that consume that context: a **start record** at saga creation, a **terminal record** at completed/compensated/failed state, and a **step-milestone record** at each step transition that is significant per the workflow's audit classification in the catalog. All records must conform to the canonical `observability-audit-event-schema` (v2026-03-28), respect tenant/workspace scope isolation, apply the default masked profile for sensitive fields, and emit into the Kafka audit transport backbone.

Additionally, this task addresses the gap documented in `saga-engine.mjs` at the `// TODO(T05)` comment: the compensation-failed alert path must be wired through the real `events-admin.mjs` event bus rather than the no-op placeholder.

---

## 2. Constitution Check

- **Monorepo Separation of Concerns**: PASS — new audit emission module lands in `apps/control-plane/src/workflows/`; no new top-level directories are introduced; contract artifacts remain in `services/internal-contracts/src/`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — audit wiring can be added workflow-by-workflow without breaking existing function invocations or saga orchestration.
- **Kubernetes and OpenShift Compatibility**: PASS — no new cluster-level resources; all audit transport is via the existing Kafka topic provisioned by the audit pipeline feature; masking and schema compliance are contract-checked at build/test time.
- **Quality Gates at the Root**: PASS — all new modules are exercisable via the existing root `node:test` scripts and the contract validation tooling.
- **Documentation as Part of the Change**: PASS — spec, plan, and checklist artifacts accompany the branch.
- **API Symmetry**: PASS — no new public routes are introduced; the existing audit correlation query surface (US-OBS-02-T05) remains the consumer-facing lookup endpoint; this task only feeds the data into that surface.
- **T05 scope boundary**: PASS — saga orchestration restructuring (T04), E2E tests (T06), and any new audit UI (US-OBS-02) are explicitly excluded.

---

## 3. Technical Context

**Language/Version**: Node.js 20+ ESM modules
**Runtime target**: Apache OpenWhisk 2.0.x / 2.1.x, `nodejs:20`
**Primary dependencies**:
- `apps/control-plane/src/saga/saga-engine.mjs` — integration point for start/terminal audit calls and TODO(T05) alert wiring
- `apps/control-plane/src/saga/saga-correlation.mjs` — existing `enrichContextWithCorrelation` and `buildCorrelationId`
- `apps/control-plane/src/events-admin.mjs` — existing event bus adapter for Kafka emission
- `services/internal-contracts/src/observability-audit-event-schema.json` (v2026-03-28) — canonical audit record schema
- `services/internal-contracts/src/observability-audit-pipeline.json` (v2026-03-28) — Kafka topic and subsystem roster
- `services/internal-contracts/src/observability-audit-correlation-surface.json` (v2026-03-28) — correlation surface contract (read-only reference)
- `services/internal-contracts/src/console-workflow-invocation.json` — `auditFields` definition
- `services/adapters/src/audit-admin.mjs` or equivalent — platform audit emission adapter (to be confirmed; may need thin shim if absent for `openwhisk` subsystem)
- `apps/control-plane/src/workflows/` — all workflow step files (T02 deliverables)
**Testing**: Node built-in `node:test`, existing root validation scripts, contract schema validation
**No new cluster resources** are provisioned by this task.

---

## 4. Target Architecture

### 4.1 Component Map

```text
┌─────────────────────────────────────────────────────────────────────┐
│  APISIX backend-tier endpoint  (T03)                                │
│  POST /console/v1/internal/workflows/{workflowId}/invoke            │
└────────────────────────┬────────────────────────────────────────────┘
                         │  callerContext  (carries correlationId or empty)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/control-plane/src/saga/saga-engine.mjs  (T04, MODIFIED)       │
│                                                                     │
│  1. saga-correlation.mjs → assign/preserve correlationId            │
│  2. ► workflow-audit.mjs → emitWorkflowStarted(sagaCtx)             │
│  3. for each step:                                                  │
│       a. step.forward(params, sagaCtx)                              │
│       b. ► workflow-audit.mjs → emitStepMilestone(step, sagaCtx)    │
│  4. ► workflow-audit.mjs → emitWorkflowTerminal(sagaCtx, outcome)   │
│  5. Compensation failure → events-admin.mjs [TODO(T05) wired here]  │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/control-plane/src/workflows/workflow-audit.mjs  (NEW)         │
│                                                                     │
│  buildStartRecord(sagaCtx) → AuditRecord                            │
│  buildTerminalRecord(sagaCtx, outcome) → AuditRecord                │
│  buildStepMilestoneRecord(step, sagaCtx) → AuditRecord              │
│  emitAuditRecord(record) → calls events-admin.mjs                   │
│  maskSensitiveFields(record, sensitivityMap) → masked AuditRecord   │
│  validateRecordSchema(record) → throws on violation                 │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/control-plane/src/events-admin.mjs                            │
│  Kafka audit topic (platform audit backbone)                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Correlation-ID Lifecycle

```text
callerContext.correlationId present?
  YES → saga-correlation.mjs preserves it as-is; all audit records carry that value
  NO  → saga-correlation.mjs generates:
          saga:{workflowId}:{tenantId}:{timestamp_base36}:{random8}
        All audit records for this execution carry that generated value

Throughout saga execution:
  sagaCtx.correlationId = stable value for the full execution
  retries → same sagaCtx → same correlationId (FR-007)
  compensation steps → same sagaCtx → same correlationId
```

### 4.3 Audit Record Lifecycle per Execution

```text
1. saga-engine.mjs: createSagaInstance()
   → workflow-audit.mjs: emitWorkflowStarted(sagaCtx)
   → AuditRecord { phase: console_initiation, result: 'started', correlationId }

2. Per step success:
   → workflow-audit.mjs: emitStepMilestone(stepDef, 'succeeded', sagaCtx)
   → AuditRecord { phase: control_plane_execution, result: 'step_succeeded', correlationId }

3. Per step failure before compensation:
   → workflow-audit.mjs: emitStepMilestone(stepDef, 'failed', sagaCtx, { error })
   → AuditRecord { phase: control_plane_execution, result: 'step_failed', correlationId }

4. Terminal — completed:
   → workflow-audit.mjs: emitWorkflowTerminal(sagaCtx, 'completed')
   → AuditRecord { phase: audit_persistence, result: 'completed', correlationId }

5. Terminal — compensated / compensation-failed:
   → workflow-audit.mjs: emitWorkflowTerminal(sagaCtx, status)
   → AuditRecord { phase: audit_persistence, result: status, correlationId }
   → If compensation-failed: events-admin.mjs alert [wires the TODO(T05) stub]
```

### 4.4 Step Audit Classification

Not every workflow step emits a milestone record to avoid audit noise. Each workflow step in the saga definition registry is annotated with an `auditMilestone` flag (boolean, default `false`) that the engine consults. Steps marked `auditMilestone: true` emit a record; unmarked steps do not. The initial default for all existing steps is `false`; the task adds `auditMilestone: true` for all multi-system mutation steps (role assignment, tenant creation, workspace provisioning, credential binding, service-account registration) as identified in the catalog.

---

## 5. Data Model and Schema

This task does **not** introduce new database tables. All durable state for saga lifecycle already lives in the PostgreSQL `saga_instances` and `saga_steps` tables delivered by T04. Audit records are append-only and emitted to Kafka; persistence downstream of Kafka is the responsibility of the audit pipeline (US-OBS-02-T01, already delivered).

### 5.1 Audit Record Fields Populated by this Task

The table below maps task output to the `observability-audit-event-schema.json` v2026-03-28 contract fields:

| Schema field | Source |
|---|---|
| `event_id` | `crypto.randomUUID()` — stable immutable UUID per emission |
| `event_timestamp` | `new Date().toISOString()` — UTC ISO-8601 |
| `schema_version` | `"2026-03-28"` — from contract |
| `actor.actor_id` | `sagaCtx.actorId` |
| `actor.actor_type` | `sagaCtx.actorType` (e.g., `workspace_admin`, `tenant_owner`, `superadmin`) |
| `scope.mode` | `tenant_workspace` if workspaceId present, else `tenant` |
| `scope.tenant_id` | `sagaCtx.tenantId` |
| `scope.workspace_id` | `sagaCtx.workspaceId` (when `mode = tenant_workspace`) |
| `resource.subsystem_id` | `"openwhisk"` |
| `resource.resource_type` | `"console_workflow"` |
| `resource.resource_id` | `sagaCtx.sagaId` |
| `resource.parent_resource_id` | `sagaCtx.workflowId` |
| `action.category` | `"console_workflow_execution"` |
| `action.action_id` | e.g., `"workflow.started"`, `"workflow.completed"`, `"step.succeeded"` |
| `result.outcome` | `"started"` / `"completed"` / `"failed"` / `"compensated"` / `"compensation-failed"` / `"step_succeeded"` / `"step_failed"` |
| `correlation_id` | `sagaCtx.correlationId` — stable throughout execution |
| `origin.surface` | `"console_backend"` — matches `console_initiation` timeline phase |
| `detail` | structured detail object (workflow name, step key, outcome reason) — sensitive fields masked |
| `maskingApplied` | `true` if any masking applied; `false` otherwise |
| `maskedFieldRefs` | array of field paths masked (may be empty) |
| `sensitivityCategories` | array of sensitivity categories present (may be empty) |

### 5.2 Masking Policy

Records emitted by console backend workflow functions must not expose secrets, tokens, credentials, or raw provider locators. The `workflow-audit.mjs` module applies the `default_masked` profile from `observability-audit-correlation-surface.json` before emitting. The masking strategy is:

- Input `params` are never included in the `detail` block.
- `detail.stepOutput` is excluded by default; only structured metadata about the outcome is included.
- If a `detail` field matches a known sensitive field identifier (`password`, `secret`, `token`, `credential`, `key`), it is replaced with `[REDACTED]` and its path is recorded in `maskedFieldRefs`.

---

## 6. Module Specifications

### 6.1 `apps/control-plane/src/workflows/workflow-audit.mjs` (NEW)

**Purpose**: Centralised audit record builder and emitter for all console backend workflow executions.

**Exports**:

```js
// Emit a workflow-started record
export async function emitWorkflowStarted(sagaCtx): Promise<{ eventId }>

// Emit a step milestone record (only called when step.auditMilestone === true)
export async function emitStepMilestone(stepDef, stepStatus, sagaCtx, detail?): Promise<{ eventId }>

// Emit a terminal record (completed / compensated / compensation-failed / failed)
export async function emitWorkflowTerminal(sagaCtx, terminalStatus, detail?): Promise<{ eventId }>

// Validate an audit record against the canonical schema
export function validateAuditRecord(record): { ok, violations }

// Apply default_masked profile to a detail object
export function maskAuditDetail(detail): { masked, maskedFieldRefs, sensitivityCategories }
```

**Key invariants**:
- `correlationId` must be present in `sagaCtx`; throws `AUDIT_MISSING_CORRELATION_ID` if absent.
- `tenantId` must be present in `sagaCtx`; throws `AUDIT_MISSING_TENANT_ID` if absent.
- Emission failure is caught and logged as a non-fatal observability condition; it does not interrupt saga execution (fire-and-forget with error capture).
- All records pass `validateAuditRecord()` before emission; validation failure is treated as a critical structured-log warning.

### 6.2 `apps/control-plane/src/saga/saga-engine.mjs` (MODIFIED)

**Changes**:
1. Import `workflow-audit.mjs` functions.
2. After `createSagaInstance`: call `emitWorkflowStarted(sagaCtx)`.
3. After each `updateStepStatus('succeeded')`: check `stepDef.auditMilestone` and if true, call `emitStepMilestone(stepDef, 'succeeded', sagaCtx, lastStepOutput)`.
4. After `updateStepStatus('failed')`: check `stepDef.auditMilestone` and if true, call `emitStepMilestone(stepDef, 'failed', sagaCtx, { message: error?.message })`.
5. Replace `// TODO(T05): wire real alert` comment in `emitCompensationFailedAlert` with a real `events-admin.mjs` emit call.
6. After each `updateSagaStatus` call that sets a terminal status (`completed`, `compensated`, `compensation-failed`): call `emitWorkflowTerminal(sagaCtx, status, ...)`.

### 6.3 `apps/control-plane/src/saga/saga-definitions.mjs` (MODIFIED)

**Changes**: Add `auditMilestone: boolean` property to each step definition object in `sagaDefinitions`. Default is `false`. Steps that mutate IAM, tenant provisioning, workspace resources, credentials, or service accounts are set to `true` (see catalog for classification). The `auditMilestone` flag is defined in the step definition schema; it is never read from external input.

### 6.4 `services/internal-contracts/src/index.mjs` (MODIFIED)

**Changes**: Export a new helper `getAuditEventSchemaForSubsystem(subsystemId)` if it does not already exist, to allow `workflow-audit.mjs` to read the canonical subsystem audit configuration without reimporting the full schema inline.

No schema files are modified by this task; only the export surface of the index is extended.

---

## 7. Contract Artifacts

### 7.1 New contract: `services/internal-contracts/src/console-workflow-audit-policy.json` (NEW)

This file captures the audit emission policy for console backend workflows so that downstream consumers (US-OBS-02, T06 test authors) can reference the exact classification rules without reading the engine source. Contents:

```json
{
  "version": "2026-03-29",
  "scope": "US-UIB-01-T05",
  "subsystem_id": "openwhisk",
  "resource_type": "console_workflow",
  "origin_surface": "console_backend",
  "timeline_phase": "console_initiation",
  "guaranteed_records_per_execution": ["workflow.started", "workflow.terminal"],
  "conditional_records_per_execution": ["step.milestone (when auditMilestone=true)"],
  "masking_profile": "default_masked",
  "correlation_id_policy": {
    "passthrough": "preserve caller-provided correlationId",
    "generated": "saga:{workflowId}:{tenantId}:{timestamp_base36}:{random8}",
    "retry_behavior": "correlation_id is immutable for the full execution including retries and compensation"
  },
  "scope_modes": ["tenant", "tenant_workspace"],
  "sensitive_field_handling": "detail block excludes input params; output snapshots excluded by default; known sensitive identifiers replaced with [REDACTED]",
  "audit_milestone_steps": {
    "WF-CON-001": ["assign-keycloak-role", "update-membership-record"],
    "WF-CON-002": ["create-tenant-namespace", "create-tenant-db", "create-tenant-kafka-topics", "create-tenant-storage"],
    "WF-CON-003": ["create-workspace-namespace", "create-workspace-db", "create-workspace-kafka-topics"],
    "WF-CON-004": ["create-credential-record", "bind-credential-to-iam", "store-credential-pointer"],
    "WF-CON-006": ["register-service-account", "bind-service-account-scopes", "record-service-account-audit-ref"]
  }
}
```

---

## 8. Files to Create / Modify

### New Files

| Path | Purpose |
|---|---|
| `apps/control-plane/src/workflows/workflow-audit.mjs` | Centralised audit record builder and emitter |
| `services/internal-contracts/src/console-workflow-audit-policy.json` | Declarative audit emission policy for T05 |
| `tests/workflows/workflow-audit.test.mjs` | Unit tests for workflow-audit.mjs |
| `tests/workflows/workflow-audit-schema.test.mjs` | Contract validation tests for emitted records |

### Modified Files

| Path | Change |
|---|---|
| `apps/control-plane/src/saga/saga-engine.mjs` | Add audit calls at start, step milestones, and terminal transitions; wire TODO(T05) alert |
| `apps/control-plane/src/saga/saga-definitions.mjs` | Add `auditMilestone` property to all step definitions |
| `services/internal-contracts/src/index.mjs` | Export `getAuditEventSchemaForSubsystem` if absent |

No files outside these paths should be touched by this task.

---

## 9. Testing Strategy

### 9.1 Unit Tests (`tests/workflows/workflow-audit.test.mjs`)

| Test case | Assertion |
|---|---|
| `emitWorkflowStarted` with valid sagaCtx | Returns `{ eventId }`, calls events-admin once |
| `emitWorkflowStarted` with missing correlationId | Throws `AUDIT_MISSING_CORRELATION_ID` |
| `emitWorkflowStarted` with missing tenantId | Throws `AUDIT_MISSING_TENANT_ID` |
| `emitWorkflowTerminal` with `completed` | Produces record with `result.outcome = 'completed'` |
| `emitWorkflowTerminal` with `compensation-failed` | Produces record with correct outcome |
| `emitStepMilestone` with `auditMilestone=true` step | Emits a record with `action_id = 'step.succeeded'` |
| `emitStepMilestone` with `auditMilestone=false` step | Does not emit (not called by engine) |
| `maskAuditDetail` with field containing `token` | Replaces value with `[REDACTED]`, records path in `maskedFieldRefs` |
| `maskAuditDetail` with no sensitive fields | Returns `maskedFieldRefs: []`, `maskingApplied: false` |
| `validateAuditRecord` with all required fields | `ok: true` |
| `validateAuditRecord` missing `correlation_id` | `ok: false`, violation listed |
| `validateAuditRecord` missing `actor.actor_id` | `ok: false` |

### 9.2 Contract Schema Validation (`tests/workflows/workflow-audit-schema.test.mjs`)

- Build one sample record per emission type (started, step-milestone, terminal) and validate each against the full `observability-audit-event-schema.json` schema structure.
- Validate `console-workflow-audit-policy.json` loads and parses without error.
- Verify `audit_milestone_steps` entries in the policy map to real step keys in `saga-definitions.mjs`.

### 9.3 Saga Engine Integration Tests (extend `tests/saga/`)

- Stub `workflow-audit.mjs` exports and run `executeSaga` for one workflow end-to-end; assert that `emitWorkflowStarted` and `emitWorkflowTerminal` were each called exactly once with matching `correlationId`.
- Confirm `correlationId` is identical in the start and terminal records.
- Simulate a step failure; assert `emitWorkflowTerminal` is called with `failed` or `compensated` outcome.
- Confirm `events-admin.mjs` alert is called on compensation-failed (was TODO stub).

### 9.4 Operational Validation (manual, post-merge)

- Trigger WF-CON-001 (user approval) end-to-end in a staging environment.
- Query the audit correlation surface for the returned `correlationId`.
- Confirm: (a) a start record exists, (b) at least two step-milestone records exist, (c) a terminal record exists, (d) all records share the same `correlationId`, (e) no secrets appear in any record's `detail` block.

---

## 10. Security and Multi-Tenancy

- Every record carries `scope.tenant_id`; workspace-scoped workflows also carry `scope.workspace_id`.
- Correlation lookup access is controlled by the existing `tenant.audit.correlate` / `workspace.audit.correlate` permissions from the audit correlation surface (US-OBS-02-T05) — this task only feeds records into that surface.
- Masking is applied unconditionally before emission; there is no opt-out path for sensitive fields.
- `workflow-audit.mjs` never reads from input `params`; it only reads from `sagaCtx` (actor, tenant, workspace, correlationId) and from the step definition's static `auditMilestone` flag and `key`.
- Emit failures are non-fatal to saga execution but are logged as a structured warning so that the audit pipeline can detect and surface any emission gap.

---

## 11. Observability

- A structured log entry at `warn` level is emitted whenever `emitWorkflowStarted`, `emitStepMilestone`, or `emitWorkflowTerminal` catches an error from the transport layer, including the `sagaId`, `correlationId`, and error message.
- The compensation-failed alert (wired from the TODO(T05) stub) emits a structured event via `events-admin.mjs` with `type: 'saga.compensation-failed'`, `sagaId`, `workflowId`, and `failedSteps`. This event is consumable by the existing alert pipeline without new route configuration.
- The existing `observability-audit-pipeline.json` subsystem roster already includes `openwhisk` as a subsystem. The emission freshness threshold defined there applies to records emitted by this task.

---

## 12. Idempotency and Retry Safety

- `emitWorkflowStarted` is called once per saga instance (after `createSagaInstance`). If the saga is recovered from a stale state by `recoverInFlightSagas`, a `emitWorkflowTerminal` call is made with the recovered status; a second `emitWorkflowStarted` is intentionally not re-emitted to avoid duplicate start records.
- Step milestone records are emitted inside the step execution loop; if a step is retried within the saga engine, the step's `saga_steps` row is updated but a new `emitStepMilestone` is issued only for the final outcome of that step (success or failure), not for each attempt. This keeps the audit trail compact while still recording the final state.
- `correlationId` is generated once by `saga-correlation.mjs` at `createSagaInstance` time and written into `saga_instances.correlation_id`; all subsequent milestone and terminal records read it from `sagaCtx` which is populated from the persisted value at recovery time.

---

## 13. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `events-admin.mjs` does not have an `emitAuditRecord` path for the `openwhisk` subsystem | Medium | Confirm during Phase 0 research. If absent, add a thin shim that routes to the existing Kafka audit topic using the same emission pattern used by other subsystem adapters. |
| Saga recovery path (stale sagas) skips audit emission | Medium | Add a dedicated `emitWorkflowTerminal` call in `recoverInFlightSagas` when a saga is marked failed/compensated; guard with a check that no terminal record already exists in the `saga_instances` metadata. |
| `maskAuditDetail` is too aggressive and strips useful diagnostic context | Low | Mask by field-name match only (not by value pattern); keep structured metadata (step key, workflowId, outcome reason) always in the clear. Review masking list in `console-workflow-audit-policy.json` as part of PR review. |
| Audit emission adds latency to saga execution | Low | Emission is asynchronous (`await` is used only to catch transport errors, not to block saga flow); the Kafka publish call is already fire-and-optimistic elsewhere in the platform. |
| `validateAuditRecord` catches a schema violation at runtime | Low | Treat as `warn` log, not a thrown error; the record is not emitted. Add a test that explicitly exercises a bad record to confirm the warn path works. |

---

## 14. Dependencies and Sequencing

### 14.1 Pre-conditions (must be available before implementation starts)

1. `specs/068-console-workflow-functions/` — workflow step modules (`apps/control-plane/src/workflows/wf-con-*.mjs`) are present.
2. `specs/070-saga-compensation-workflows/` — saga engine, definitions, and state store modules are present.
3. `services/internal-contracts/src/observability-audit-event-schema.json` (v2026-03-28) — available (confirmed present in repo).
4. `apps/control-plane/src/events-admin.mjs` — Kafka event bus adapter is present (confirmed present in repo).

### 14.2 Recommended Implementation Sequence

1. Read `observability-audit-event-schema.json` and `observability-audit-pipeline.json` to confirm `openwhisk` subsystem roster and emission field requirements.
2. Create `workflow-audit.mjs` with stub `emitWorkflowStarted`, `emitWorkflowTerminal`, `emitStepMilestone`, `maskAuditDetail`, `validateAuditRecord`.
3. Write and pass unit tests for `workflow-audit.mjs` before touching the engine.
4. Annotate `saga-definitions.mjs` step objects with `auditMilestone` flags per the policy JSON.
5. Modify `saga-engine.mjs`: add audit calls, wire TODO(T05) alert.
6. Extend saga engine integration tests to assert audit call counts and `correlationId` stability.
7. Create `console-workflow-audit-policy.json` contract artifact.
8. Update `services/internal-contracts/src/index.mjs` to export the new contract.
9. Run all root quality gates and verify no regressions in existing saga or workflow tests.

### 14.3 Unblocked Downstream Work

- **US-UIB-01-T06** (E2E tests): can now assert full workflow traces against a real audit trail.
- **US-OBS-02** consumers: the `openwhisk` subsystem records from console workflows now feed the correlation, query, and export surfaces without additional adapter work.

---

## 15. Criteria of Done

| # | Criterion | Evidence |
|---|---|---|
| 1 | `workflow-audit.mjs` exists and all unit tests pass | `node:test` output: 0 failures |
| 2 | `workflow-audit-schema.test.mjs` passes contract validation for all three record types | `node:test` output: 0 failures |
| 3 | Saga engine integration tests assert `emitWorkflowStarted` and `emitWorkflowTerminal` called once each per execution | `node:test` output |
| 4 | `correlationId` is identical in start and terminal records for a sample execution | Test assertion on stub call args |
| 5 | `console-workflow-audit-policy.json` contract artifact is present and parses without error | File exists; `JSON.parse` succeeds |
| 6 | `saga-definitions.mjs` has `auditMilestone` on every step and the policy JSON `audit_milestone_steps` matches | Code review + schema test |
| 7 | TODO(T05) compensation-failed alert stub is replaced with real `events-admin.mjs` call | Code review; test covers the path |
| 8 | No new test failures introduced in existing saga or workflow test suites | Root `node:test` clean run |
| 9 | Audit records in any sample execution contain no raw secrets, tokens, or credentials | Manual review of test output + `maskAuditDetail` unit tests |
| 10 | All changes are committed on branch `071-backend-audit-correlation` with a conventional-commit message | `git log` |

---

## Project Structure

### Documentation (this feature)

```text
specs/071-backend-audit-correlation/
├── spec.md              ← input specification
├── plan.md              ← this file
└── tasks.md             ← Phase 2 output (/speckit.tasks command — NOT created by this plan)
```

### Source Code (repository root)

```text
apps/control-plane/src/
├── saga/
│   ├── saga-engine.mjs           ← MODIFIED: audit calls + TODO(T05) wired
│   └── saga-definitions.mjs      ← MODIFIED: auditMilestone flags added
└── workflows/
    └── workflow-audit.mjs        ← NEW: audit record builder and emitter

services/internal-contracts/src/
├── console-workflow-audit-policy.json  ← NEW: declarative audit emission policy
└── index.mjs                     ← MODIFIED: export getAuditEventSchemaForSubsystem

tests/workflows/
├── workflow-audit.test.mjs       ← NEW: unit tests
└── workflow-audit-schema.test.mjs ← NEW: contract validation tests
```

**Structure Decision**: `workflow-audit.mjs` lives under `apps/control-plane/src/workflows/` alongside the workflow step modules it supports. This mirrors the pattern established by T02 (`wf-con-*.mjs`, `workflow-invocation-contract.mjs`) and keeps the audit concern local to the workflow layer rather than promoting it to the saga engine directory. The saga engine imports from the workflow layer, maintaining a clean dependency direction (engine → workflow-audit → events-admin).

---

## Phase 0: Research Findings

| Decision | Rationale | Alternatives Considered |
|---|---|---|
| Re-use `events-admin.mjs` for audit emission | Already wired to Kafka audit backbone; adding a second emission path would create transport inconsistency | Direct Kafka client call — rejected: bypasses existing topic/partition governance |
| Non-fatal emit errors | Saga correctness (idempotency, compensation) must not be blocked by audit transport issues | Failing the saga on emit error — rejected: creates availability risk from an observability dependency |
| `auditMilestone` annotation on step definitions rather than per-workflow config | Co-locates the audit classification with the step it describes; makes additions visible at PR review time | Separate audit-classification config file — rejected: extra indirection with no benefit |
| Fire-and-forget with error capture (not `await`-blocking saga) | Keeps p95 latency of saga execution unaffected by audit transport jitter | Awaiting emit before proceeding — rejected unless required by compliance gate; no such gate applies here |
| `workflow-audit.mjs` never reads input `params` | Prevents accidental secret exposure in audit records; masking-by-name is a backup, not the primary control | Including filtered params — rejected: filter logic is error-prone; better to exclude at source |
