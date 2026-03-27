# Tasks: Console Backend on OpenWhisk

**Input**: Design documents from `/specs/004-console-openwhisk-backend/`  
**Prerequisites**: `plan.md`, `spec.md`, `checklists/requirements.md`  
**Branch**: `004-console-openwhisk-backend`  
**Story**: `US-FN-03-T04`

**Tests**: Unit, adapter, contract, and resilience coverage are required for this feature because multi-tenant isolation, public-API parity, and trace attribution must remain verifiable through the repo’s quality gates.

**Organization**: Tasks are grouped by phase so the console backend increment remains independently testable and can be validated before PR handoff.

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependency overlap)
- Include exact file paths in every task

---

## Phase 1: Setup (Spec Artifact Finalization)

**Purpose**: Confirm the spec package is complete and the branch is ready for implementation.

- [x] T001 Confirm `specs/004-console-openwhisk-backend/spec.md` is finalized and on the feature branch
- [x] T002 Confirm `specs/004-console-openwhisk-backend/plan.md` is finalized and on the feature branch
- [x] T003 Confirm `specs/004-console-openwhisk-backend/checklists/requirements.md` is finalized and on the feature branch
- [x] T004 Create the execution task list in `specs/004-console-openwhisk-backend/tasks.md`

---

## Phase 2: Foundational (Contracts and Identity Boundary)

**Purpose**: Establish the authorization model extension, service-map ownership note, and base contract coverage that all console-backend code depends on. Nothing downstream should proceed until the propagation target and denial identifiers are stable.

**⚠️ CRITICAL**: No console backend authorization scenario is complete until the authorization-model and service-map validations pass with the new contract entries.

- [ ] T005 Extend `services/internal-contracts/src/authorization-model.json` with the console backend activation contract:
  - add `propagation_targets.console_backend_activation` with carrier `activation_annotation`
  - include fields `actor`, `tenant_id`, `workspace_id`, `correlation_id`, `initiating_surface`
  - require `tenant_id`, `workspace_id`, `correlation_id`, and `initiating_surface`
  - add denial scenarios `AUTHZ-FN-CON-001` and `AUTHZ-FN-CON-002`
  - do not alter existing role catalogs, permission matrices, or unrelated enforcement surfaces

- [ ] T006 [P] Patch `services/internal-contracts/src/internal-service-map.json` so `control_api` explicitly owns acceptance of console backend invocation requests and annotation of the initiating surface before dispatch, without creating a private API path.

- [ ] T007 [P] Extend `tests/contracts/authorization-model.contract.test.mjs` and `tests/contracts/internal-service-map.contract.test.mjs` so the new propagation target, denial identifiers, and service-map responsibility are validated by the existing repo contract suite.

**Checkpoint**: The console backend activation contract and service ownership note are stable enough for adapter and control-plane code.

---

## Phase 3: Adapter Surface (Blocks Control-Plane and Resilience Work)

**Purpose**: Add the OpenWhisk adapter primitives that stamp console-backend attribution and reject out-of-scope requests before dispatch.

- [ ] T008 Extend `services/adapters/src/openwhisk-admin.mjs` with console-backend adapter primitives:
  - export `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE = 'console_backend'`
  - add `buildConsoleBackendActivationAnnotation(context)` for `{ actor, tenantId, workspaceId, correlationId }`
  - add `validateConsoleBackendInvocationRequest(request, context)` to reject missing scope and cross-tenant payloads
  - extend the adapter call builder so a console-surface flag injects console attribution into the activation annotation
  - preserve existing tenant invocation, quota, versioning, and secret behavior

- [ ] T009 [P] Extend `tests/adapters/openwhisk-admin.test.mjs` with additive coverage for:
  - complete annotation field propagation
  - invalid requests with missing tenant/workspace scope
  - invalid requests that attempt cross-tenant or cross-workspace access
  - exported `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE === 'console_backend'`
  - no regression in existing adapter tests

**Checkpoint**: The adapter can build and validate console backend invocations while preserving current governed behavior.

---

## Phase 4: Control-Plane Module and Unit Coverage

**Purpose**: Create the console-backend-specific control-plane module and extend the functions admin surface so the repo exposes a typed, testable console-backend invocation path.

- [ ] T010 Create `apps/control-plane/src/console-backend-functions.mjs` as the isolated console backend module:
  - export `CONSOLE_BACKEND_INITIATING_SURFACE = 'console_backend'`
  - export `CONSOLE_BACKEND_ACTOR_TYPE = 'workspace_service_account'`
  - add `getConsoleBackendIdentityRequirements()`
  - add `buildConsoleBackendWorkflowInvocation(context, actionRef, payload)`
  - add `validateConsoleBackendScope(context)`
  - add `summarizeConsoleBackendFunctionsSurface()`

- [ ] T011 [P] Extend `apps/control-plane/src/functions-admin.mjs` with additive console-backend support:
  - re-export `buildConsoleBackendActivationAnnotation` and `validateConsoleBackendInvocationRequest`
  - add `getConsoleBackendFunctionsIdentityContract()` returning the expected console actor shape
  - add `buildConsoleBackendInvocationEnvelope(context, payload)` that validates `responseMode`, `triggerContext.kind`, `tenantId`, and `workspaceId`
  - preserve existing route summaries, compatibility helpers, and non-console behavior

- [ ] T012 [P] Write `tests/unit/console-backend-functions.test.mjs` with coverage for:
  - identity contract shape
  - happy-path invocation envelope building
  - missing `tenantId` rejection
  - missing `workspaceId` rejection
  - valid scope acceptance
  - mismatched scope denial
  - non-empty console backend surface summary
  - console annotation re-export behavior and request validation re-export behavior

- [ ] T013 [P] Extend `tests/unit/functions-admin.test.mjs` with assertions for console-backend discoverability, console identity contract export, and envelope-builder behavior without regressing the current admin surface expectations.

**Checkpoint**: The control plane exposes a bounded console-backend path and unit tests prove the identity/scope rules.

---

## Phase 5: Contract Parity and Negative Scenarios

**Purpose**: Prove the console backend path honors the same public contract, denial shape, and traceability semantics as direct public API calls.

- [ ] T014 Add `tests/contracts/console-backend-functions.contract.test.mjs` to validate:
  - console backend invocation envelopes satisfy the governed invocation schema
  - `console_backend_activation` annotations satisfy the new propagation target
  - out-of-scope denials match `ErrorResponse` shape and gateway error taxonomy
  - allowed and denied outcomes remain parity-consistent with equivalent direct public API calls
  - trace metadata is distinguishable without leaking unrelated tenant data

- [ ] T015 [P] Add `tests/resilience/console-backend-authorization.test.mjs` for negative scenarios:
  - `AUTHZ-FN-CON-001` cross-tenant/workspace invocation denial
  - `AUTHZ-FN-CON-002` missing annotation rejection before dispatch
  - retry/idempotency behavior preserving the same authorization result
  - parity of business-level denials between console backend and direct public API calls
  - required `X-Correlation-Id` enforcement
  - distinguishable console-backend activation trace behavior

**Checkpoint**: Contract parity and negative authorization paths are proven.

---

## Phase 6: Representative Workflow and Readiness

**Purpose**: Deliver one representative console-backend workflow on the governed OpenWhisk path, then validate the branch for PR/CI handoff.

- [ ] T016 Implement one representative console-backend workflow path across `apps/control-plane/src/console-backend-functions.mjs`, `apps/control-plane/src/functions-admin.mjs`, and `services/adapters/src/openwhisk-admin.mjs` so a console-owned workflow can execute in OpenWhisk while consuming only the public BaaS APIs.

- [ ] T017 [P] Add a describe-only E2E scaffold in `tests/e2e/console/console-backend-openwhisk.test.mjs` describing:
  - happy path: authorized console backend workflow succeeds in the correct workspace through the public BaaS API surface
  - negative path: out-of-scope workspace request is rejected with the same governed denial shape
  - trace path: activation metadata remains attributable to `console_backend`

- [ ] T018 Regenerate derived public artifacts and validate the full bounded surface by running from repo root:
  - `npm run generate:public-api`
  - `npm run validate:public-api`
  - `npm run validate:openapi`
  - `npm run validate:service-map`
  - `npm run validate:authorization-model`
  - `npm run test:unit`
  - `npm run test:adapters`
  - `npm run test:contracts`
  - `npm run test:resilience`
  - `npm run lint`
  - fix any drift before moving to push/PR work

---

## Parallelization Notes

- T006 and T007 can proceed in parallel once the target `authorization-model.json` entry from T005 is decided.
- T009 can proceed in parallel with the latter part of T008 once the adapter helper signatures are fixed.
- T011, T012, and T013 can proceed in parallel once the control-plane module shape from T010 is stable.
- T014 and T015 can proceed in parallel once adapter + control-plane helper signatures and contract entries are stable.
- T017 can proceed in parallel with T016 once the representative workflow boundaries are agreed.
- T018 must run after all code, test, and generated-artifact work is complete.

## Done Criteria

- Console backend workflows can execute on the OpenWhisk path while consuming the same public BaaS APIs.
- Tenant, workspace, actor, correlation, and initiating-surface context are preserved end to end.
- Cross-tenant, cross-workspace, and scope-absent requests are rejected before dispatch.
- The console backend path does not create a privileged or private business API surface.
- Direct public API outcomes and console-backend outcomes remain parity-consistent for allowed and denied cases.
- Audit/trace consumers can distinguish `console_backend` activations without losing original scope attribution.
- Unit, adapter, contract, and resilience suites pass for the bounded feature surface.
- Generated public artifacts and repo validations stay in sync.
- Scope remains strictly bounded to `US-FN-03-T04`.

## Expected Evidence

- `authorization-model.json` diff adding `console_backend_activation` and the new denial scenarios.
- `internal-service-map.json` diff showing `control_api` console-backend responsibility.
- `openwhisk-admin.mjs`, `functions-admin.mjs`, and `console-backend-functions.mjs` diffs showing the bounded console-backend path.
- New/extended unit, adapter, contract, resilience, and E2E scaffold tests.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run validate:service-map`, `npm run validate:authorization-model`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, `npm run test:resilience`, and `npm run lint`.
- A PR diff showing no unrelated work from sibling tasks `US-FN-03-T01`, `US-FN-03-T02`, `US-FN-03-T03`, `US-FN-03-T05`, or `US-FN-03-T06`.
