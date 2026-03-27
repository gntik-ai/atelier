# Tasks: Function and Package Import/Export with Web Action Visibility Policies

**Input**: Design documents from `/specs/005-function-import-export-visibility/`  
**Prerequisites**: `plan.md`, `spec.md`  
**Branch**: `005-function-import-export-visibility`  
**Story**: `US-FN-03-T05`

**Tests**: Unit, adapter, contract, and resilience coverage are required for this feature because tenant/workspace isolation, round-trip visibility preservation, and atomic import rejection must remain verifiable through the repo's quality gates.

**Organization**: Tasks are grouped by phase so the import/export increment remains independently testable and can be validated before PR handoff.

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependency overlap)
- Include exact file paths in every task

---

## Phase 1: Setup (Spec Artifact Finalization)

**Purpose**: Confirm the spec package is complete and the branch is ready for implementation.

- [x] T001 Confirm `specs/005-function-import-export-visibility/spec.md` is finalized and on the feature branch
- [x] T002 Confirm `specs/005-function-import-export-visibility/plan.md` is finalized and on the feature branch
- [x] T003 Note: no `checklists/` directory exists for this feature; `spec.md` and `plan.md` are the sole spec artifacts
- [x] T004 Create the execution task list in `specs/005-function-import-export-visibility/tasks.md`

---

## Phase 2: Foundational (Contract JSON Patches)

**Purpose**: Establish the authorization model extension, domain entities, service-map ownership, and route catalog entries that all import/export code depends on. Nothing downstream proceeds until denial scenario IDs and entity names are stable.

**⚠️ CRITICAL**: No import/export scenario is complete until the authorization-model and route-catalog validations pass with the new contract entries.

- [ ] T005 Patch `services/internal-contracts/src/domain-model.json` with five new entity definitions and two new business invariants:
  - entities: `FunctionExportBundle`, `PackageExportBundle`, `ImportBundle`, `WebActionVisibilityPolicy`, `DefinitionCollision`
  - invariants: `BI-FN-IMPORT-001` (round-trip visibility preserved verbatim) and `BI-FN-IMPORT-002` (fully atomic validation before any write)
  - do not modify existing entities, relationships, or invariants

- [ ] T006 [P] Patch `services/internal-contracts/src/authorization-model.json`:
  - add `propagation_targets.definition_import_context` with required fields `actor`, `tenant_id`, `workspace_id`, `correlation_id`, `bundle_version`, `import_operation`
  - add denial scenarios `AUTHZ-FN-IMP-001` (cross-tenant export attempt), `AUTHZ-FN-IMP-002` (cross-tenant import bundle), `AUTHZ-FN-IMP-003` (`IMPORT_COLLISION` before any write), `AUTHZ-FN-IMP-004` (`IMPORT_POLICY_CONFLICT` before any write)
  - do not alter existing role catalogs, permission matrices, `openwhisk_activation`, or `console_backend_activation` entries

- [ ] T007 [P] Patch `services/internal-contracts/src/internal-service-map.json` so `control_api` explicitly owns acceptance of authorized export requests (scope-safe serialization) and acceptance of authorized import requests (bundle validation and governed write), as two new responsibility entries.

- [ ] T008 [P] Add four new route entries to `services/internal-contracts/src/public-route-catalog.json`:
  - `exportFunctionDefinition`: `POST /v1/functions/workspaces/{workspaceId}/definitions/export`, `resourceType: 'function_definition_export'`, `family: 'functions'`, `tenantBinding: 'required'`, `workspaceBinding: 'required'`, `supportsIdempotencyKey: true`, `rateLimitClass: 'provisioning'`
  - `exportFunctionPackageDefinition`: `POST /v1/functions/workspaces/{workspaceId}/packages/{packageName}/export`, same profile
  - `importFunctionDefinition`: `POST /v1/functions/workspaces/{workspaceId}/definitions/import`, `resourceType: 'function_definition_import'`, same profile
  - `importFunctionPackageDefinition`: `POST /v1/functions/workspaces/{workspaceId}/packages/import`, same profile
  - match the existing functions route shape exactly; do not modify existing entries
  - immediately run `npm run test:unit` and `npm run test:contracts` to confirm no existing route-count assertion breaks; patch any exact-count assertion additively if needed

- [ ] T009 [P] Extend `tests/contracts/authorization-model.contract.test.mjs` and `tests/contracts/internal-service-map.contract.test.mjs` so the `definition_import_context` propagation target, the four denial scenario IDs, and the two new `control_api` responsibility entries are validated by the existing contract suite.

**Checkpoint**: Entity names, denial scenario IDs, and route catalog shape are stable enough for OpenAPI and adapter work.

---

## Phase 3: OpenAPI Surface

**Purpose**: Add the four new import/export operations and six new schema components to the functions OpenAPI family and regenerate the public contract artifacts.

- [ ] T010 Add four new operations and six new schema components to `apps/control-plane/openapi/families/functions.openapi.json`:
  - operations: `exportFunctionDefinition`, `exportFunctionPackageDefinition`, `importFunctionDefinition`, `importFunctionPackageDefinition`
  - schemas: `FunctionExportBundle`, `PackageExportBundle`, `FunctionImportRequest`, `PackageImportRequest`, `ImportResult`, `WebActionVisibilityPolicy`
  - all four operations must carry `tenantBinding: 'required'`, `workspaceBinding: 'required'`, `supportsIdempotencyKey: true`, audiences `workspace_owner`, `workspace_admin`, `workspace_developer`, `platform_team`, and `planCapabilityAnyOf: ['data.openwhisk.actions']`
  - `collisionPolicy` in import request schemas: enum `['reject']` only in this increment; any other value must produce `IMPORT_UNSUPPORTED_BUNDLE`
  - `web_action_visibility` field in `FunctionExportBundle` and `FunctionImportRequest`: optional, enum `['public', 'private']`; absent means the action is not a web action
  - do not modify any existing paths, operations, or schema components

- [ ] T011 Run `npm run generate:public-api` and `npm run validate:openapi` from the repo root; fix any schema or path drift before proceeding.

**Checkpoint**: OpenAPI family is valid and generated public artifacts are in sync.

---

## Phase 4: Adapter Extension

**Purpose**: Add the visibility constants, bundle version constant, serializer, deserializer, collision detector, and visibility policy checker to the OpenWhisk adapter layer.

- [ ] T012 Extend `services/adapters/src/openwhisk-admin.mjs` with additive exports only:
  - `OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY = Object.freeze(['public', 'private'])`
  - `OPENWHISK_DEFINITION_BUNDLE_VERSION = '1.0'`
  - `serializeDefinitionBundle(resource, options)`: strips activation records, secret values (`secretBindings`, `resolvedSecrets`, `authKey`, any field matching `forbiddenUserFields`), version history references, quota counters, and cross-tenant identifiers; preserves `web_action_visibility` when present
  - `deserializeDefinitionBundle(bundle)`: returns normalized internal representation plus any non-critical field anomaly warnings without throwing for non-critical warnings
  - `detectDefinitionCollision(existingResources, incomingBundle)`: returns `{ collision: true|false, collidingNames: [] }`
  - `checkVisibilityPolicySupport(bundle, workspacePolicy)`: returns `{ supported: true|false, unsupportedActions: [] }`
  - preserve all existing tenant invocation, quota, versioning, secret, and console-backend adapter behavior

- [ ] T013 [P] Add additive assertions to `tests/adapters/openwhisk-admin.test.mjs`:
  - `OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY` exports `['public', 'private']`
  - `OPENWHISK_DEFINITION_BUNDLE_VERSION` is a non-empty string
  - `serializeDefinitionBundle` strips activation records, quota state, secret values, and version history references from a representative input fixture
  - `serializeDefinitionBundle` preserves `web_action_visibility: 'public'` and `web_action_visibility: 'private'` from the input fixture
  - `deserializeDefinitionBundle` returns a normalized result for a valid export bundle
  - `detectDefinitionCollision` returns `collision: true` when the bundle name matches an existing workspace resource name
  - `checkVisibilityPolicySupport` returns `supported: false` with the conflicting action name for an unrecognized visibility value
  - no regression in existing adapter tests

**Checkpoint**: Adapter exports are stable and test-covered; control-plane module can be written against them.

---

## Phase 5: Control-Plane Module and Unit Coverage

**Purpose**: Create the dedicated import/export control-plane module, extend the functions admin surface, and deliver full unit test coverage.

- [ ] T014 Create `apps/control-plane/src/functions-import-export.mjs` following the pattern of `apps/control-plane/src/console-backend-functions.mjs`:
  - `FUNCTION_IMPORT_EXPORT_BUNDLE_VERSION = '1.0'`
  - `WEB_ACTION_VISIBILITY_STATES = Object.freeze(['public', 'private'])`
  - `IMPORT_ERROR_CODES = Object.freeze({ COLLISION: 'IMPORT_COLLISION', POLICY_CONFLICT: 'IMPORT_POLICY_CONFLICT', SCOPE_VIOLATION: 'IMPORT_SCOPE_VIOLATION', UNSUPPORTED_BUNDLE: 'IMPORT_UNSUPPORTED_BUNDLE' })`
  - `buildScopeValidatedExportRequest(context, resourceRef)`: validates `resourceRef.tenantId` and `resourceRef.workspaceId` match caller's authorized `context`; returns typed export command or throws scope violation error
  - `buildScopeValidatedImportRequest(context, bundle)`: validates bundle's declared `tenantId` and `workspaceId` match caller's authorized scope; returns typed import command or throws scope violation error
  - `validateImportBundle(bundle, context)`: orchestrates scope assertion → collision check → visibility policy check → deserialization validation; returns `{ valid, violations: [{ code, field, detail }], normalizedDefinitions }`
  - `buildImportResult(normalizedDefinitions, context)`: returns `ImportResult` response body including `web_action_visibility` for each created resource
  - `summarizeFunctionImportExportSurface()`

- [ ] T015 [P] Extend `apps/control-plane/src/functions-admin.mjs` additively:
  - re-export `WEB_ACTION_VISIBILITY_STATES`, `IMPORT_ERROR_CODES`, `buildScopeValidatedExportRequest`, `buildScopeValidatedImportRequest`, `validateImportBundle` from `./functions-import-export.mjs`
  - extend `summarizeFunctionsAdminSurface()` to include `function_definition_export` (actions: `['export']`) and `function_definition_import` (actions: `['import']`) resource kind entries with routeCount from filtered catalog
  - extend `getOpenWhiskCompatibilitySummary()` to add `definitionImportExportSupported: true` at the same level as `functionVersioningSupported` and `workspaceSecretsSupported`
  - do not modify existing route listing functions, console backend exports, or T01/T02/T03/T04 exports

- [ ] T016 [P] Write `tests/unit/functions-import-export.test.mjs` (Node `node:test`, no external dependencies):
  - `WEB_ACTION_VISIBILITY_STATES` contains exactly `['public', 'private']`
  - `IMPORT_ERROR_CODES` exports all four required code identifiers
  - `buildScopeValidatedExportRequest` passes for matching tenant/workspace; throws for mismatched tenant
  - `buildScopeValidatedImportRequest` passes for matching scope; throws for cross-tenant and cross-workspace bundles
  - `validateImportBundle` returns `valid: true` for a well-formed single-function bundle
  - `validateImportBundle` returns `valid: false` with code `IMPORT_COLLISION` when a name collision is simulated
  - `validateImportBundle` returns `valid: false` with code `IMPORT_POLICY_CONFLICT` for an unsupported visibility value
  - `validateImportBundle` returns `valid: false` with code `IMPORT_SCOPE_VIOLATION` for a cross-tenant bundle reference
  - `buildImportResult` includes `web_action_visibility` for each imported resource
  - `summarizeFunctionImportExportSurface` returns a non-empty object
  - package bundle with mixed-visibility actions preserves each action's declared state independently

- [ ] T017 [P] Extend `tests/unit/functions-admin.test.mjs` with additive assertions for:
  - `function_definition_export` and `function_definition_import` resource kinds present in `summarizeFunctionsAdminSurface()` output
  - `getOpenWhiskCompatibilitySummary()` returns `definitionImportExportSupported: true`
  - five re-exported import/export identifiers are present and match expected shapes
  - no regression in existing admin surface assertions

**Checkpoint**: Control-plane module and functions admin surface are covered at the unit layer.

---

## Phase 6: Contract Tests, Resilience Tests, E2E Scaffold, and Validation Gate

**Purpose**: Prove schema compliance, round-trip visibility preservation, all four denial scenarios, atomicity invariant, and idempotency replay; then validate the branch is ready for PR/CI handoff.

- [ ] T018 Write `tests/contracts/functions-import-export.contract.test.mjs` following the pattern of `tests/contracts/functions-versioning.contract.test.mjs`:
  - `FunctionExportBundle` schema satisfies the `function_admin_result` contract baseline fields
  - round-tripped bundle (serialize then deserialize) preserves `web_action_visibility: 'public'` without mutation
  - round-tripped bundle preserves `web_action_visibility: 'private'` without mutation
  - `IMPORT_COLLISION` rejection produces an `ErrorResponse`-compatible shape
  - `IMPORT_POLICY_CONFLICT` rejection produces an `ErrorResponse`-compatible shape with a `GW_`-prefixed code
  - `IMPORT_SCOPE_VIOLATION` rejection body does not contain foreign `tenantId` or `workspaceId` values
  - `importFunctionDefinition` and `exportFunctionDefinition` route entries exist in `services/internal-contracts/src/public-route-catalog.json` with `tenantBinding: 'required'` and `workspaceBinding: 'required'`
  - `definition_import_context` propagation target exists in `services/internal-contracts/src/authorization-model.json` with `bundle_version` and `import_operation` marked required
  - `summarizeFunctionsAdminSurface()` includes `function_definition_export` and `function_definition_import` resource kinds
  - `getOpenWhiskCompatibilitySummary()` returns `definitionImportExportSupported: true`

- [ ] T019 [P] Write `tests/resilience/functions-import-export-authorization.test.mjs`:
  - `AUTHZ-FN-IMP-001`: export attempt against a different-tenant workspace is denied without revealing the definition; expects `IMPORT_SCOPE_VIOLATION` or equivalent gateway denial
  - `AUTHZ-FN-IMP-002`: import with a bundle whose `tenantId` differs from the caller's authorized tenant is denied without revealing foreign definition details
  - `AUTHZ-FN-IMP-003`: import where the function name already exists in the target workspace produces `IMPORT_COLLISION` and no partial write
  - `AUTHZ-FN-IMP-004`: import containing a web action with an unsupported `web_action_visibility` value produces `IMPORT_POLICY_CONFLICT` and no partial write
  - package bundle with one action having an unsupported visibility and one action having a valid visibility produces a single `IMPORT_POLICY_CONFLICT` rejecting the entire bundle (atomicity invariant `BI-FN-IMPORT-002`)
  - retry of a previously rejected import with the same `Idempotency-Key` produces the same rejection outcome

- [ ] T020 [P] Add a describe-only E2E scaffold in `tests/e2e/functions/functions-import-export.test.mjs`:
  - happy path: authorized export and import of a function with `web_action_visibility: 'public'` preserves visibility across the round trip
  - happy path: authorized export and import of a package with mixed-visibility actions preserves each action's state independently
  - negative path: cross-tenant import attempt expects HTTP 403 with an `ErrorResponse` body and no foreign resource disclosure

- [ ] T021 Run the full root validation suite and fix any contract or test drift before proceeding to push/PR work:
  - `npm run generate:public-api`
  - `npm run validate:public-api`
  - `npm run validate:openapi`
  - `npm run test:unit`
  - `npm run test:adapters`
  - `npm run test:contracts`
  - `npm run test:resilience`
  - `npm run lint`

---

## Parallelization Notes

- T006, T007, T008, and T009 can all proceed in parallel once the entity names and denial scenario IDs from T005 are agreed.
- T010 can begin as soon as T008 (route catalog shape) is stable; it does not block T012.
- T011 must follow T010.
- T012 and T013 can begin in parallel with T010 once the visibility constant names are stable.
- T014 depends on the adapter exports from T012 being stable but can proceed in parallel with T010 and T011.
- T015, T016, and T017 can proceed in parallel once the module shape from T014 is stable.
- T018 and T019 can proceed in parallel once T012, T014, and T015 are merged.
- T020 can proceed at any time after T010.
- T021 must be the last step before the PR is opened.

## Done Criteria

- An authorized user can export a function or package definition from their own workspace and the resulting bundle includes the correct `web_action_visibility` state for each contained web action (SC-001).
- An authorized user can import a `FunctionImportRequest` or `PackageImportRequest` into a permitted target workspace and the resulting resources reflect the declared `web_action_visibility` states without implicit mutation (SC-001, SC-002).
- A public web action remains public and a private web action remains private after a supported export/import round trip (SC-002).
- Import attempts that cross tenant or workspace boundaries are rejected without exposing hidden definitions (SC-003).
- Invalid imports with name collisions are rejected with `IMPORT_COLLISION`; unsupported visibility combinations are rejected with `IMPORT_POLICY_CONFLICT`; both reject before any partial write (SC-004).
- Definition exports do not include secrets, activation records, version history references, quota state, or lifecycle features outside this task's scope (SC-005).
- The four new route entries are present in `public-route-catalog.json` and the four new operations are valid in `functions.openapi.json` (SC-006).
- `getOpenWhiskCompatibilitySummary()` returns `definitionImportExportSupported: true`.
- `summarizeFunctionsAdminSurface()` includes `function_definition_export` and `function_definition_import` resource kinds.
- All new unit, adapter, contract, and resilience tests pass; no existing tests regress.
- All four `AUTHZ-FN-IMP-*` denial scenarios are in `authorization-model.json` and covered by passing resilience tests.
- Scope remains bounded to US-FN-03-T05; no sibling scope (T01/T02/T03/T04/T06) is absorbed.

## Expected Evidence

- New file `apps/control-plane/src/functions-import-export.mjs` present and importable.
- Additive diff to `services/adapters/src/openwhisk-admin.mjs` showing only the two constants and four new function exports.
- Additive diff to `apps/control-plane/src/functions-admin.mjs` showing the five re-exports and the two compatibility summary extensions.
- Additive diff to `apps/control-plane/openapi/families/functions.openapi.json` showing the four new operations and six new schema components; no existing paths or schemas removed.
- Additive diffs to `services/internal-contracts/src/authorization-model.json` showing `definition_import_context` propagation target and four new `AUTHZ-FN-IMP-*` denial scenarios.
- Additive diff to `services/internal-contracts/src/internal-service-map.json` showing two new `control_api` responsibility entries.
- Additive diff to `services/internal-contracts/src/public-route-catalog.json` showing four new route entries.
- Additive diff to `services/internal-contracts/src/domain-model.json` showing five new entity definitions and two new business invariants.
- New test files: `tests/unit/functions-import-export.test.mjs`, `tests/contracts/functions-import-export.contract.test.mjs`, `tests/resilience/functions-import-export-authorization.test.mjs`, `tests/e2e/functions/functions-import-export.test.mjs` (scaffold only).
- A representative export bundle from `serializeDefinitionBundle` for a public web action contains `web_action_visibility: 'public'` and no secret, activation, or version-history fields.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, `npm run test:resilience`, and `npm run lint` captured before the PR is opened.
