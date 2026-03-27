# Implementation Plan: Console Backend Execution in OpenWhisk via Public BaaS APIs

**Branch**: `004-console-openwhisk-backend` | **Date**: 2026-03-27 | **Spec**: `specs/004-console-openwhisk-backend/spec.md`
**Task**: US-FN-03-T04
**Input**: Feature specification from `/specs/004-console-openwhisk-backend/spec.md`

## Summary

Extend the governed `functions` surface so console backend workflows can execute in Apache OpenWhisk while consuming the same public BaaS APIs exposed to all other product consumers. Keep the increment bounded to: defining the console backend service identity, annotating activations with console-originated trace attribution, enforcing authorization parity between console backend and direct API calls, and providing contract and unit evidence that tenant/workspace/actor context is preserved. Do not introduce a separate privileged product surface for console backend behavior; the public BaaS API remains the canonical contract. This task must remain compatible with US-FN-03-T01 (versioning), T02 (secrets), and T03 (quota) already delivered, and must not absorb T05 or T06.

## Technical Context

**Language/Version**: Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets
**Primary Dependencies**: Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules, Keycloak admin adapter, internal-contracts index
**Storage**: repository contract/helper artifacts only in this increment; activation annotations are carried in the existing OpenWhisk activation record metadata; no new database tables
**Testing**: root validation scripts plus unit, adapter, contract, and resilience test suites
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners
**Project Type**: monorepo control-plane/API governance increment for a multi-tenant BaaS platform
**Performance Goals**: console backend annotation and validation remain synchronous and pre-dispatch; authorization evaluation adds no additional round-trips beyond the existing workspace scope resolution
**Constraints**: preserve tenant/workspace isolation, avoid secrets/versioning/quota/audit sibling scope, stay compatible with OpenWhisk-governed function administration and existing T01/T02/T03 artifacts, keep changes root-validated
**Scale/Scope**: one new control-plane module, two additive extensions to existing adapter and admin modules, two additive patches to internal contract JSON artifacts, and matching test suites

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — the new `console-backend-functions.mjs` module stays under `apps/control-plane/src/`; OpenWhisk adapter extensions stay under `services/adapters/src/`; contract JSON patches stay under `services/internal-contracts/src/`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the work adds identity helpers, activation annotation, and validation contracts without introducing new runtime infrastructure or forcing changes to the OpenWhisk cluster.
- **Kubernetes and OpenShift Compatibility**: PASS — no new deployment artifacts or cluster assumptions are introduced; Keycloak client configuration is operator-managed and external to this plan.
- **Quality Gates at the Root**: PASS — the feature can be validated through existing root OpenAPI and test commands without new scripts.
- **Documentation as Part of the Change**: PASS — spec, plan, and task artifacts are included in the feature branch.
- **API Symmetry**: PASS — no separate privileged surface is introduced; console backend workflows call the same public BaaS routes as all other consumers, and the authorization model enforces the same deny-by-default rules.

## Project Structure

### Documentation (this feature)

```text
specs/004-console-openwhisk-backend/
├── spec.md
├── plan.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    └── src/
        ├── console-backend-functions.mjs       ← new file: console backend identity and invocation module
        └── functions-admin.mjs                 ← additive: re-exports console backend helpers

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs                 ← additive: console backend annotation constant,
│                                                  annotation builder, invocation validator
└── internal-contracts/
    └── src/
        ├── authorization-model.json            ← additive: console_backend_activation propagation target
        │                                          + two denial scenario entries
        └── internal-service-map.json           ← additive: control_api responsibility description

tests/
├── unit/
│   └── console-backend-functions.test.mjs     ← new file: unit tests for new module
├── adapters/
│   └── openwhisk-admin.test.mjs               ← additive: assertions for console backend adapter exports
├── contracts/
│   └── console-backend-functions.contract.test.mjs  ← new file: annotation and scope contract tests
└── resilience/
    └── console-backend-authorization.test.mjs ← new file: negative scenario tests
```

**Structure Decision**: Keep the console backend logic in a dedicated `console-backend-functions.mjs` module following the established `console-auth.mjs` pattern. Do not merge console backend identity concerns into the generic `functions-admin.mjs` surface. The adapter extension follows the same additive pattern used by T01/T02/T03.

## Target Architecture and Flow

1. A console UI trigger or internal console process initiates a backend workflow request carrying a `workspace_service_account` bearer token issued by the Keycloak platform realm.
2. The APISIX gateway forwards the request to the `control_api` enforcement surface, which resolves `actor_type = workspace_service_account` and validates `tenant_id` and `workspace_id` from the request scope using the existing deny-by-default authorization rules.
3. The control-plane module (`console-backend-functions.mjs`) builds a typed invocation envelope that includes all required propagation fields and sets `initiating_surface: 'console_backend'` in the activation annotation.
4. The `openwhisk-admin.mjs` adapter injects the activation annotation into the invocation command and dispatches the action within the workspace-scoped OpenWhisk namespace and subject — the same namespace isolation used for all other tenant function invocations.
5. The OpenWhisk action runs under the workspace namespace and calls public BaaS REST API endpoints (for example `GET /v1/functions/workspaces/{workspaceId}/inventory`) using its own workspace service account token. No private back-channels or adapter bypasses are permitted.
6. The activation record is written to OpenWhisk with the annotation fields intact. Audit consumers can query the activation summary and distinguish `initiating_surface: 'console_backend'` from direct tenant invocations without losing the original `actor`, `tenant_id`, `workspace_id`, and `correlation_id` attribution.
7. Business-level outcomes returned to the caller (allowed, denied, quota-blocked, validation-failed) are identical to those returned for an equivalent direct public API request — no escalation, no loophole.

Authorization identity model: the console backend reuses the existing `workspace_service_account` actor type. The `enforcement_surfaces.functions_runtime` entry in `authorization-model.json` already binds `tenant_sources` and `workspace_sources` to `activation_annotation` and `request_header`. The only extension needed is a new `propagation_targets.console_backend_activation` entry that lists the required annotation fields and marks `initiating_surface` as mandatory.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/openwhisk-admin.mjs`

- Export a new constant `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE = 'console_backend'` to give all consumers a stable, typo-safe identifier for the console surface value.
- Export a new function `buildConsoleBackendActivationAnnotation(context)` that accepts `{ actor, tenantId, workspaceId, correlationId }` and returns an annotation object matching the `activation_annotation` schema already present in the adapter's `adapterContextTargets`; sets `initiating_surface: 'console_backend'` and includes all propagation fields.
- Export a new function `validateConsoleBackendInvocationRequest(request, context)` that verifies `tenantId` and `workspaceId` are present and match the caller's authorized scope, verifies no cross-tenant fields are present, and returns a normalized validation result consistent with the existing `validateOpenWhiskAdminRequest` pattern.
- Extend the internal invocation dispatch path to accept an optional `consoleSurface` flag that, when true, injects the console annotation before the invocation is submitted to OpenWhisk.
- No changes to: existing tenant invocation path, quota validation helpers, version/rollback helpers, or secret resolution helpers introduced by T01/T02/T03.

### `apps/control-plane/src/functions-admin.mjs`

- Import and re-export `buildConsoleBackendActivationAnnotation` and `validateConsoleBackendInvocationRequest` from the adapter so control-plane consumers have a single import surface.
- Export a new function `getConsoleBackendFunctionsIdentityContract()` that returns the expected actor identity shape (`actor_type: 'workspace_service_account'`, `initiating_surface: 'console_backend'`) for use by tests and the authorization model validation.
- Export a new function `buildConsoleBackendInvocationEnvelope(context, payload)` that wraps a standard `FunctionInvocationWriteRequest` with the console backend annotation and validates that `responseMode`, `triggerContext.kind: 'direct'`, `tenantId`, and `workspaceId` are all present before returning the typed command envelope.
- No changes to: existing route listing functions, runtime coverage summaries, compatibility flags, or T01/T02/T03 exports.

### `apps/control-plane/src/console-backend-functions.mjs` (new file)

Follows the pattern established by `console-auth.mjs`. Exports:

- `CONSOLE_BACKEND_INITIATING_SURFACE = 'console_backend'` — stable identifier for the console backend surface.
- `CONSOLE_BACKEND_ACTOR_TYPE = 'workspace_service_account'` — required actor type for console backend service accounts.
- `getConsoleBackendIdentityRequirements()` — returns the identity shape required for a console backend invocation request.
- `buildConsoleBackendWorkflowInvocation(context, actionRef, payload)` — builds a typed invocation envelope for a console backend workflow; throws if `tenantId`, `workspaceId`, or `correlationId` are absent.
- `validateConsoleBackendScope(context)` — validates that a console backend invocation does not attempt cross-tenant or cross-workspace access; returns a structured validation result.
- `summarizeConsoleBackendFunctionsSurface()` — returns an introspectable surface summary suitable for discoverability and audit inventory consumers.

### `services/internal-contracts/src/authorization-model.json`

- In `propagation_targets`, add a new entry `console_backend_activation` that lists the required annotation fields (`actor`, `tenant_id`, `workspace_id`, `correlation_id`, `initiating_surface`) with `initiating_surface` and `tenant_id` and `workspace_id` marked required.
- In `negative_scenarios`, add two new denial entries:
  - `AUTHZ-FN-CON-001`: Console backend service account attempts access outside its authorized workspace scope — must be denied.
  - `AUTHZ-FN-CON-002`: Console backend activation is dispatched without `tenant_id` or `workspace_id` annotation — must be rejected before dispatch.
- No changes to: existing role catalog, enforcement surface definitions, permission matrix entries, or propagation targets introduced by T01/T02/T03.

### `services/internal-contracts/src/internal-service-map.json`

- In the `control_api` service responsibilities array, add one entry: `"Accept console backend invocation requests and annotate them with the initiating console surface before dispatch, without exposing a private API path for the same business actions."`.
- No other service definitions or ownership boundaries are changed.

### `tests/unit/console-backend-functions.test.mjs` (new file)

Follows the pattern of `tests/unit/functions-admin.test.mjs`. Node test runner, no external dependencies. Covers: identity requirements shape, valid/invalid invocation envelope construction, scope validation for matching and mismatched tenant/workspace, surface summary non-empty, adapter annotation constant export, adapter annotation field completeness, adapter validation rejection for missing scope fields.

### `tests/adapters/openwhisk-admin.test.mjs` (additive)

Add assertions to the existing adapter test file for: `buildConsoleBackendActivationAnnotation` includes all required propagation fields; `validateConsoleBackendInvocationRequest` returns invalid for a cross-tenant payload; `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE` constant is exported with value `'console_backend'`.

### `tests/contracts/console-backend-functions.contract.test.mjs` (new file)

Follows the pattern of `tests/contracts/functions-versioning.contract.test.mjs`. Covers: console backend invocation envelope satisfies `FunctionInvocationWriteRequest` schema; annotation fields satisfy the `console_backend_activation` propagation target contract; scope rejection produces an `ErrorResponse`-compatible shape; allowed console backend call produces the same outcome shape as an equivalent direct public API call (authorization parity); denial for out-of-scope request produces `GW_` code pattern consistent with gateway error taxonomy.

### `tests/resilience/console-backend-authorization.test.mjs` (new file)

Negative scenario tests covering: `AUTHZ-FN-CON-001` — console service account invokes action in a different tenant workspace, expects denial; `AUTHZ-FN-CON-002` — console invocation dispatched without tenant/workspace annotation, expects pre-dispatch rejection; retry of a denied request with the same idempotency key produces the same authorization outcome; public API rejects a request and the console backend surfaces the identical business-level denial; console backend request missing `X-Correlation-Id` is rejected at the gateway level identically to a direct API request; activation with `initiating_surface: 'console_backend'` is distinguishable in the audit trace.

## Data Model and Metadata Impact

No new database tables or schema migrations are required. Activation annotations are metadata fields carried within the existing OpenWhisk activation record. The following governed concepts are introduced:

| Entity | Role | Notable fields |
|--------|------|----------------|
| `ConsoleBackendActivationAnnotation` | Trace attribution embedded in each OpenWhisk activation dispatched through the console backend path | `actor`, `tenant_id`, `workspace_id`, `correlation_id`, `initiating_surface` |
| `ConsoleBackendInvocationEnvelope` | Typed command wrapper for a console backend workflow invocation | `actionRef`, `payload`, `annotation`, `responseMode`, `triggerContext` |
| `ConsoleBackendScopeValidationResult` | Structured result of scope authorization check | `valid`, `reason`, `scope` |
| `ConsoleBackendIdentityRequirements` | Static identity shape required for console backend service accounts | `actor_type`, `initiating_surface`, `requiredScopes` |

The authorization model JSON receives two additive denial scenario entries (`AUTHZ-FN-CON-001`, `AUTHZ-FN-CON-002`) and one new `propagation_targets` entry. These are backward-compatible: existing entries are untouched and existing test coverage continues to pass.

## API and UX Considerations

- **API symmetry**: the console backend does not introduce new public routes. It uses the existing `POST /v1/functions/actions/{resourceId}/invocations` route and the same request schema. No new OpenAPI family file changes are required for this increment.
- **Response parity**: allowed and denied responses from the console backend path must be schema-identical to direct public API responses for the same operation. This is verified by the contract test comparing both paths for the same input.
- **Visibility boundary**: `initiating_surface: 'console_backend'` is activation annotation metadata; it must not appear in external-facing API response bodies unless it falls within an already-governed activation summary field.
- **Operator clarity**: rejection responses must identify whether the block originated from authorization, tenancy, validation, or missing scope — consistent with the existing `GW_` error code taxonomy.
- **No new UI work**: this task focuses on backend contract and governance behavior; no UI components are introduced or required.
- **Idempotency**: all mutating calls from console backend workflows to the public API must include an `Idempotency-Key` header as required by `public-api-taxonomy.json`. The existing 24-hour replay window applies identically.
- **No sibling scope creep**: this increment does not rework secrets, rollback, quota, import/export, or expanded audit surfaces.

## Testing Strategy

### Unit

Route exposure and identity contract checks in `tests/unit/console-backend-functions.test.mjs`. Covers: identity shape stability, invocation envelope construction with valid and invalid inputs, scope validation for matching and cross-tenant contexts, surface summary introspectability.

### Adapter

Validation and annotation tests in `tests/adapters/openwhisk-admin.test.mjs` (additive). Covers: annotation field completeness, cross-tenant rejection, stable constant export.

### Contract

OpenAPI contract assertions in `tests/contracts/console-backend-functions.contract.test.mjs`. Covers: envelope schema parity with `FunctionInvocationWriteRequest`, annotation contract compliance, error response schema consistency, authorization parity between console backend and direct API paths.

### Resilience

Negative scenario tests in `tests/resilience/console-backend-authorization.test.mjs`. Covers: cross-tenant denial, missing-scope pre-dispatch rejection, retry authorization stability, public API denial propagation, gateway header enforcement, audit trace distinguishability.

### E2E

No new runtime E2E environment is required in this task. The `tests/e2e/` package should receive a describe-only scaffold for: happy-path end-to-end invocation of a representative console backend action within the authorized workspace; negative-path invocation against a different workspace expecting HTTP 403 with an `ErrorResponse` body.

### Operational validation

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

## Risks and Mitigations

- **Risk**: Console service account token inadvertently inherits tenant-owner or cross-workspace roles during Keycloak provisioning.
  **Mitigation**: Scope list must be explicitly constrained at client creation time to the approved function invocation scopes only; a contract test asserts `actor_type = workspace_service_account` and not a broader role type.

- **Risk**: Activation annotation missing `initiating_surface` silently passes without audit trace.
  **Mitigation**: `validateConsoleBackendInvocationRequest` throws before dispatch if `initiating_surface` is absent; the resilience test `AUTHZ-FN-CON-002` and the contract test for annotation completeness both catch this condition.

- **Risk**: Console backend action calls a non-public internal endpoint, creating a hidden privileged path that violates FR-002.
  **Mitigation**: Code review gate enforced during implementation: `console-backend-functions.mjs` must import only from public-route contracts and the governed adapter; no direct database or internal service calls are permitted in console backend action modules.

- **Risk**: Retry of a failed console backend activation escalates scope on the second attempt.
  **Mitigation**: Authorization checks run on every invocation; idempotency replay does not bypass auth; resilience test `AUTHZ-FN-CON-002-RETRY` (retry variant) covers this path.

- **Risk**: Public API dependency unavailable while OpenWhisk runtime is available — action fails with an unhandled exception rather than a structured failure result.
  **Mitigation**: Console backend actions must catch non-2xx API responses and return a structured failure payload; the OpenWhisk runtime surfaces this as `status: 'failed'` in the activation record rather than silently bypassing the public API contract.

- **Risk**: Audit trace conflates console backend activations with tenant-direct invocations.
  **Mitigation**: `initiating_surface: 'console_backend'` is required in the activation annotation; the resilience test for audit distinguishability asserts this field is present and non-null on all console-originated activations.

- **Risk**: T04 implementation drifts into sibling scope (secrets, versioning, quota, import/export, audit expansion).
  **Mitigation**: The constitution check and scope boundary in the spec are explicit; any artifact change outside the files listed in the change plan requires explicit scope review before merging.

## Recommended Implementation Sequence

1. Patch `services/internal-contracts/src/authorization-model.json` and `internal-service-map.json` (contract-first); CI must pass with new entries before code changes begin.
2. Write `tests/contracts/console-backend-functions.contract.test.mjs` against the new authorization model entries to confirm the contract shape before implementation.
3. Extend `services/adapters/src/openwhisk-admin.mjs` with the console backend constant, annotation builder, and invocation validator; add additive assertions to `tests/adapters/openwhisk-admin.test.mjs`; all existing adapter tests must continue to pass.
4. Create `apps/control-plane/src/console-backend-functions.mjs` and extend `apps/control-plane/src/functions-admin.mjs` with the re-exports and new identity/envelope functions; write `tests/unit/console-backend-functions.test.mjs`; all existing functions-admin unit tests must continue to pass.
5. Write `tests/resilience/console-backend-authorization.test.mjs` covering all denial scenarios; run full test suite and fix any discovered gaps.
6. Implement one representative console backend OpenWhisk action (for example a `nodejs:20` inline-code action that calls `GET /v1/functions/workspaces/{workspaceId}/inventory` through the public API); add E2E scaffold in `tests/e2e/`.
7. Run root validation commands; capture passing output before opening the PR.

## Parallelization Notes

- Steps 1 and 2 (contract JSON patches and initial contract tests) can proceed simultaneously once the `console_backend_activation` propagation target shape is agreed.
- Step 3 (adapter extension) can begin immediately after the contract JSON is merged and CI is green; it does not block Steps 4 and 5 but those should wait for the adapter exports to be stable.
- Steps 4 and 5 can proceed in parallel once Step 3 is merged.
- Step 6 (representative action) can begin in parallel with Step 5 as long as the adapter exports and invocation envelope are stable.
- Step 7 (validation) must be the last gate before the PR is opened.

## Done Criteria

- At least one representative console backend workflow completes end-to-end in OpenWhisk using only the public BaaS API surface (SC-001).
- A console backend request cannot succeed outside the caller's authorized tenant or workspace scope (SC-002).
- Allowed and denied requests produce the same business-level outcome whether initiated directly through the public API or through the console backend path (SC-003).
- Audit consumers can identify console backend-originated activations and their tenant/workspace attribution via `initiating_surface: 'console_backend'` in the activation annotation (SC-004).
- Console backend behavior does not require a separate privileged product surface; all product actions go through existing public BaaS routes (SC-005).
- All new unit, adapter, contract, and resilience tests pass.
- No existing tests regress across the full `npm run test:unit`, `npm run test:adapters`, and `npm run test:contracts` suites.
- Authorization model and internal service map JSON artifacts are valid per their existing contract tests.
- Scope remains bounded to US-FN-03-T04; no sibling scope (T01/T02/T03/T05/T06) is absorbed.

## Expected Evidence

- New file `apps/control-plane/src/console-backend-functions.mjs` present and importable.
- Additive diffs to `services/adapters/src/openwhisk-admin.mjs` and `apps/control-plane/src/functions-admin.mjs` showing only the console backend extensions.
- Additive diffs to `services/internal-contracts/src/authorization-model.json` showing the `console_backend_activation` propagation target and the two denial scenario entries.
- Additive diff to `services/internal-contracts/src/internal-service-map.json` showing the `control_api` responsibility entry.
- New test files: `tests/unit/console-backend-functions.test.mjs`, `tests/contracts/console-backend-functions.contract.test.mjs`, `tests/resilience/console-backend-authorization.test.mjs`.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` captured before the PR is opened.
- Authorization model contract test (`tests/contracts/authorization-model.contract.test.mjs`) passes with the new entries.
- Activation annotation from a representative console backend invocation carries `initiating_surface: 'console_backend'`, `tenant_id`, `workspace_id`, `actor`, and `correlation_id`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Dedicated `console-backend-functions.mjs` module instead of adding console backend logic to `functions-admin.mjs` | Console backend identity and invocation concerns are distinct from the generic function administration surface; mixing them would make the intent of each module unclear and would increase the risk of scope creep in both directions | A single merged module would make it harder to audit which exports are console-specific and which are general, and would conflict with the `console-auth.mjs` precedent already established in the repo |
| New `console_backend_activation` propagation target in `authorization-model.json` instead of relying on existing propagation paths | The existing propagation targets do not include `initiating_surface`; without a named target, there is no contract basis for asserting that the field is required or for testing its presence in audit consumers | Leaving `initiating_surface` undocumented in the contract would mean tests asserting audit distinguishability have no stable contract anchor, making them brittle against future refactoring |
| Two explicit denial scenario entries (`AUTHZ-FN-CON-001`, `AUTHZ-FN-CON-002`) in the authorization model | These denial scenarios are product requirements (FR-005, FR-008) and must be machine-readable for the existing resilience test harness to assert them | Omitting them from the model would leave the negative scenario tests without a stable scenario ID and would make requirement traceability between spec, plan, and test harder to maintain |
