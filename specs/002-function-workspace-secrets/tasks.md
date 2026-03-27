# Tasks: Workspace Secrets and Secure Function Secret References

**Input**: Design documents from `/specs/002-function-workspace-secrets/`  
**Prerequisites**: `plan.md`, `spec.md`  
**Branch**: `002-function-workspace-secrets`  
**Story**: `US-FN-03-T02`

**Tests**: Unit, adapter, and contract coverage are required for this feature because workspace isolation, write-only secret semantics, and non-disclosure guarantees must remain verifiable through root quality gates.

**Organization**: Tasks are grouped by phase and user scenario so each increment remains independently testable.

## Format: `[ID] [P?] [Scenario] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependency overlap)
- **[Scenario]**: Which user scenario this task primarily addresses (`SC1`–`SC5`)
- Include exact file paths in every task

---

## Phase 1: Setup (Spec Artifact Finalization)

**Purpose**: Confirm the spec package is complete and the branch is ready for implementation.

- [x] T001 Confirm `specs/002-function-workspace-secrets/spec.md` is finalized and on the feature branch
- [x] T002 Confirm `specs/002-function-workspace-secrets/plan.md` is finalized and on the feature branch
- [ ] T003 Create the execution task list in `specs/002-function-workspace-secrets/tasks.md`

---

## Phase 2: Foundational (Blocking All Story Work)

**Purpose**: Establish the OpenAPI schema additions and route shape that all user scenarios and tests depend on. Nothing downstream can be written or validated until the operation IDs, schema names, and route paths are stable.

**⚠️ CRITICAL**: No user scenario is complete until these tasks land and `npm run generate:public-api` passes.

- [ ] T004 Add five workspace-secret paths to `apps/control-plane/openapi/families/functions.openapi.json`:
  - `GET /v1/functions/workspaces/{workspaceId}/secrets` → `listFunctionWorkspaceSecrets`
  - `POST /v1/functions/workspaces/{workspaceId}/secrets` → `createFunctionWorkspaceSecret`
  - `GET /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `getFunctionWorkspaceSecret`
  - `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `updateFunctionWorkspaceSecret`
  - `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `deleteFunctionWorkspaceSecret`
  Apply `x-resource-type: function_workspace_secret` and `x-api-family: functions` to all five operations. Mark `createFunctionWorkspaceSecret` and `updateFunctionWorkspaceSecret` with `supportsIdempotencyKey: true`.

- [ ] T005 Add four component schemas to `apps/control-plane/openapi/families/functions.openapi.json`:
  - `FunctionWorkspaceSecret` — metadata-only read model (`secretName`, `workspaceId`, `tenantId`, `description`, `resolvedRefCount`, `timestamps`); **no `secretValue` property**
  - `FunctionWorkspaceSecretCollection` — paged list wrapper following the `FunctionAdminPage` pattern (`items[]`, `page.size`, `page.nextCursor`)
  - `FunctionWorkspaceSecretWriteRequest` — create/update request (`secretName`, `secretValue` with `writeOnly: true`, `description`)
  - `FunctionSecretReference` — reference from a function to a named workspace secret (`secretName`, `mountAlias`, `required`)

- [ ] T006 Extend `FunctionAction` in `apps/control-plane/openapi/families/functions.openapi.json` with:
  - `secretReferences` — `FunctionSecretReference[]`, always present (empty array when none)
  - `unresolvedSecretRefs` — `integer`, advisory count of references whose named secret is absent in the workspace; defaults to `0`

- [ ] T007 Extend `FunctionActionWriteRequest` in `apps/control-plane/openapi/families/functions.openapi.json` with:
  - `secretReferences` — `FunctionSecretReference[]`; validated server-side against the caller's workspace scope

- [ ] T008 Run `npm run generate:public-api` from the repo root after steps T004–T007 and confirm the five new operation IDs (`listFunctionWorkspaceSecrets`, `createFunctionWorkspaceSecret`, `getFunctionWorkspaceSecret`, `updateFunctionWorkspaceSecret`, `deleteFunctionWorkspaceSecret`) appear in `services/internal-contracts/src/public-route-catalog.json`

**Checkpoint**: OpenAPI additions are stable, route catalog is regenerated, and operation IDs are fixed for downstream work.

---

## Phase 3: Helper Modules (Can Parallelize After T004 Is Stable)

**Purpose**: Add the adapter and admin-surface helpers that encode validation rules, metadata projections, and surface summaries.

### 3a — `apps/control-plane/src/functions-admin.mjs`

- [ ] T009 [P] Add a `workspace_secret` entry to `summarizeFunctionsAdminSurface()` alongside the existing `action`, `package`, `trigger`, `rule`, and `inventory` entries. The entry must list actions: `list`, `create`, `get`, `update`, `delete`.

- [ ] T010 [P] Update `getOpenWhiskCompatibilitySummary()` in `apps/control-plane/src/functions-admin.mjs` to include `workspaceSecretsSupported: true` and a `secretGovernance` block (analogous to the existing `lifecycleGovernance` block) documenting `writeOnlyValue: true` and workspace-isolation semantics.

- [ ] T011 [P] Export a `FUNCTION_SECRET_NAME_PATTERN` constant from `apps/control-plane/src/functions-admin.mjs` — a `RegExp` matching the allowed name format: lowercase alphanumeric plus hyphens and underscores (consistent with the action name validation used in the adapter). Keep all existing exports unchanged.

### 3b — `services/adapters/src/openwhisk-admin.mjs`

- [ ] T012 [P] Add `OPENWHISK_ALLOWED_SECRET_REFERENCE_STATUSES` constant to `services/adapters/src/openwhisk-admin.mjs`: `['resolved', 'unresolved', 'pending']`.

- [ ] T013 [P] Add `validateFunctionWorkspaceSecretRequest({ action, payload, context })` to `services/adapters/src/openwhisk-admin.mjs`. Must validate:
  - Secret name format against `FUNCTION_SECRET_NAME_PATTERN`
  - Non-empty name
  - Workspace scope (context workspace must match)
  - Cross-tenant guard
  - Presence of `secretValue` only on `create` and `update` actions (reject on other actions)
  Returns `{ ok, violations, profile }` following the existing `validateOpenWhiskAdminRequest` pattern.

- [ ] T014 [P] Add `validateFunctionSecretReferences({ secretRefs, context })` to `services/adapters/src/openwhisk-admin.mjs`. Must validate:
  - Structural correctness of each `FunctionSecretReference` (valid `secretName`, valid `mountAlias`)
  - Unique `mountAlias` values across the array
  - Any `workspaceId` present on a reference must match `context.workspaceId`; if absent, infer from context
  - Valid `secretName` format
  Returns `{ ok, violations }`.

- [ ] T015 [P] Add `buildFunctionWorkspaceSecretProjection(payload, context)` to `services/adapters/src/openwhisk-admin.mjs`. Must return a safe metadata record: `secretName`, `workspaceId`, `tenantId`, `description`, `resolvedRefCount`, `timestamps`. The `secretValue` field must be absent from the return value regardless of what `payload` contains. Apply the same `compactDefined` and `normalizeObjectKeys` discipline used by `normalizeOpenWhiskAdminResource`.

- [ ] T016 [P] Add `buildFunctionWorkspaceSecretCollection({ items, nextCursor, size })` to `services/adapters/src/openwhisk-admin.mjs`. Returns a paged wrapper matching the shape of `buildOpenWhiskFunctionVersionCollection`.

- [ ] T017 [P] Extend `normalizeOpenWhiskAdminResource` in `services/adapters/src/openwhisk-admin.mjs` for `resourceKind === 'action'` to include `secretReferences` (from `payload.secretReferences`, defaulting to `[]`) and `unresolvedSecretRefs` (from `payload.unresolvedSecretRefs`, defaulting to `0`) in the normalized output. Apply the same `compactDefined` pass used by existing fields. Ensure all existing action/package/trigger/rule normalizations remain unchanged.

- [ ] T018 [P] Extend `buildOpenWhiskAdminAuditSummary` in `services/adapters/src/openwhisk-admin.mjs` to include `capturesSecretReferenceAudit: true` as a stable flag for the future `US-FN-03-T06` audit package.

**Checkpoint**: Helper modules encode all validation, projection, and surface summary behavior; existing exports are unaffected.

---

## Phase 4: User Scenario Tests

**Purpose**: Add the test coverage that validates each user scenario. Unit and adapter tests can begin once the exported names from Phase 3 are fixed. Contract tests require stable operation IDs and schema names from Phase 2.

### Scenario 1 — Workspace admin creates and lists secrets (SC1)

- [ ] T019 [P] [SC1] Add assertions in `tests/unit/functions-admin.test.mjs` that:
  - `summarizeFunctionsAdminSurface()` includes `workspace_secret` with actions `list`, `create`, `get`, `update`, `delete`
  - All five secret operation IDs are present in `listFunctionsAdminRoutes()`
  - `getOpenWhiskCompatibilitySummary()` returns `workspaceSecretsSupported: true` and `secretGovernance.writeOnlyValue: true`
  - `FUNCTION_SECRET_NAME_PATTERN` is exported and is a `RegExp`

- [ ] T020 [P] [SC1] Add coverage in `tests/adapters/openwhisk-admin.test.mjs` for `buildFunctionWorkspaceSecretProjection`:
  - Returns `secretName`, `workspaceId`, `tenantId`, `description`, `resolvedRefCount`, `timestamps`
  - Does **not** return `secretValue` regardless of what is passed as input

- [ ] T021 [P] [SC1] Add coverage in `tests/adapters/openwhisk-admin.test.mjs` for `buildFunctionWorkspaceSecretCollection`:
  - Empty items list → correct paged envelope
  - Non-empty items list → correct paged envelope with all items

- [ ] T022 [P] [SC1] Add contract assertions in `tests/contracts/workspace-secrets.contract.test.mjs`:
  - All five workspace-secret paths exist in the OpenAPI document
  - `x-resource-type` equals `function_workspace_secret` on all five operations
  - `FunctionWorkspaceSecretWriteRequest.secretValue` carries `writeOnly: true`
  - `FunctionWorkspaceSecret` schema has **no** `secretValue` property
  - `createFunctionWorkspaceSecret` returns `201` with a `FunctionWorkspaceSecret` body
  - All five operation IDs are discoverable through `getPublicRoute` after catalog regeneration

### Scenario 2 — Developer binds a secret reference to a function (SC2)

- [ ] T023 [P] [SC2] Add coverage in `tests/adapters/openwhisk-admin.test.mjs` for `validateFunctionSecretReferences`:
  - Empty array → `ok: true`
  - Valid references with unique `mountAlias` values → `ok: true`
  - Duplicate `mountAlias` → `ok: false` with violation message
  - Reference with `workspaceId` not matching context → `ok: false`
  - Malformed `secretName` → `ok: false`

- [ ] T024 [P] [SC2] Add contract assertions in `tests/contracts/functions-secrets.contract.test.mjs`:
  - `FunctionAction.properties.secretReferences` exists as an array schema
  - `FunctionAction.properties.unresolvedSecretRefs` exists as an integer schema
  - `FunctionActionWriteRequest` accepts `secretReferences` array
  - `updateFunctionWorkspaceSecret` uses `PUT` (full-replacement semantics)
  - `createFunctionWorkspaceSecret` and `updateFunctionWorkspaceSecret` require `Idempotency-Key` (`supportsIdempotencyKey: true`)

### Scenario 3 — Secure runtime resolution (SC3)

- [ ] T025 [P] [SC3] Add coverage in `tests/adapters/openwhisk-admin.test.mjs` for `normalizeOpenWhiskAdminResource('action', ...)`:
  - Payload with `secretReferences` populated → `secretReferences` present in normalized output
  - `secretValue` is absent from normalized output regardless of input
  - `unresolvedSecretRefs` defaults to `0` when not supplied in payload
  - Existing action normalization assertions continue to pass

### Scenario 4 — Unauthorized access blocked (SC4)

- [ ] T026 [P] [SC4] Add coverage in `tests/adapters/openwhisk-admin.test.mjs` for `validateFunctionWorkspaceSecretRequest`:
  - Valid create: name, value, workspace scope → `ok: true`
  - Invalid name format → `ok: false` with violation message
  - Empty name → `ok: false`
  - Cross-workspace scope mismatch → `ok: false`
  - Unsupported action (e.g., `read`) → `ok: false`
  - Non-create/update action with `secretValue` present → `ok: false`

- [ ] T027 [P] [SC4] Add contract assertions in `tests/contracts/workspace-secrets.contract.test.mjs`:
  - All secret mutation routes (`createFunctionWorkspaceSecret`, `updateFunctionWorkspaceSecret`, `deleteFunctionWorkspaceSecret`) are scoped to `workspaceId` path parameter
  - The OpenAPI document does not expose any route that returns `secretValue` as a response field

### Scenario 5 — Traceability without value disclosure (SC5)

- [ ] T028 [P] [SC5] Add coverage in `tests/adapters/openwhisk-admin.test.mjs` for `buildOpenWhiskAdminAuditSummary`:
  - Returns `capturesSecretReferenceAudit: true`
  - Existing audit summary assertions continue to pass

**Checkpoint**: All scenario-level tests are authored; no test should pass or fail based on implementation details that are still changing.

---

## Phase 5: Polish & Cross-Cutting Validation

**Purpose**: Final consistency pass, root validation evidence, and commit.

- [ ] T029 [P] Confirm `FUNCTION_SECRET_NAME_PATTERN` allows representative valid names (e.g., `my-secret`, `api_key_prod`, `secret123`) and rejects invalid ones (e.g., uppercase, special characters, empty string) by running unit tests or a quick inline check

- [ ] T030 Run the full root validation sequence and record/fix any regressions in affected files:

  ```bash
  npm run generate:public-api
  npm run validate:public-api
  npm run validate:openapi
  npm run test:unit
  npm run test:adapters
  npm run test:contracts
  npm run lint
  ```

  Fix any contract or test drift before proceeding. Files in scope: `apps/control-plane/openapi/families/functions.openapi.json`, `apps/control-plane/src/functions-admin.mjs`, `services/adapters/src/openwhisk-admin.mjs`, `services/internal-contracts/src/public-route-catalog.json`, `tests/unit/functions-admin.test.mjs`, `tests/adapters/openwhisk-admin.test.mjs`, `tests/contracts/functions-secrets.contract.test.mjs`, `tests/contracts/workspace-secrets.contract.test.mjs`

- [ ] T031 Confirm that all existing `US-FN-03-T01` tests continue to pass without modification (no regression to function versioning/rollback surface)

- [ ] T032 Commit the completed `US-FN-03-T02` implementation on branch `002-function-workspace-secrets`

---

## Dependencies & Execution Order

### Phase Dependencies

| Phase | Depends On | Blocks |
|-------|-----------|--------|
| Phase 1 (Setup) | — | Phase 2 |
| Phase 2 (Foundational) | Phase 1 | Phase 3, Phase 4 contract tests |
| Phase 3a (functions-admin.mjs) | Phase 2 operation IDs stable | Phase 4 unit tests |
| Phase 3b (openwhisk-admin.mjs) | Phase 2 schema/route names stable | Phase 4 adapter tests |
| Phase 4 (Tests) | Phase 2 stable; Phase 3 exported names fixed | Phase 5 |
| Phase 5 (Polish) | Phase 4 | — |

### Parallel Opportunities

- T004–T007 must be done sequentially (same file, building on each other).
- T008 must follow T004–T007.
- T009, T010, T011 can run in parallel with each other once T004 is stable (different exports, same file section).
- T012–T018 can all run in parallel with each other and with T009–T011 because they target a different file.
- Within Phase 4, all `[P]`-marked test tasks can run in parallel within their respective test files.
- T029 can run in parallel with T030 if T030 is split into individual commands.

### Critical Path

```text
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008
                                                    ↓
                                        T009–T011, T012–T018
                                                    ↓
                                        T019–T028
                                                    ↓
                                        T029 → T030 → T031 → T032
```

---

## Parallel Example: Phase 4 (tests can start simultaneously per file)

```bash
# In parallel:
# tests/unit/functions-admin.test.mjs
Task T019: "Add workspace_secret surface summary and route assertions"

# tests/adapters/openwhisk-admin.test.mjs
Task T020: "Cover buildFunctionWorkspaceSecretProjection — no secretValue"
Task T021: "Cover buildFunctionWorkspaceSecretCollection"
Task T023: "Cover validateFunctionSecretReferences"
Task T025: "Cover normalizeOpenWhiskAdminResource with secretReferences"
Task T026: "Cover validateFunctionWorkspaceSecretRequest"
Task T028: "Cover buildOpenWhiskAdminAuditSummary"

# tests/contracts/workspace-secrets.contract.test.mjs
Task T022: "OpenAPI contract assertions for secret schemas and routes"
Task T027: "Cross-scope rejection and no-value-disclosure assertions"

# tests/contracts/functions-secrets.contract.test.mjs
Task T024: "FunctionAction secretReferences/unresolvedSecretRefs contract assertions"
```

---

## Implementation Strategy

### Foundational First

1. Complete Phase 1 (spec artifacts) and Phase 2 (OpenAPI additions).
2. Run `npm run generate:public-api` and confirm route catalog.
3. Proceed to Phase 3 helper modules in parallel across `functions-admin.mjs` and `openwhisk-admin.mjs`.

### Test-Alongside

1. Write tests as each helper function signature is fixed — do not batch tests to the end.
2. Adapter tests can be written alongside Phase 3b once function signatures are decided.
3. Unit tests for `functions-admin.mjs` can be authored independently of adapter tests.
4. Contract tests require stable operation IDs and schema names from Phase 2; author them after T008 passes.

### Validation Before Commit

1. Run `npm run validate:openapi` after every OpenAPI change.
2. Run `npm run generate:public-api` before running contract tests that assert route catalog discoverability.
3. Confirm no regression to `US-FN-03-T01` surface before opening the PR.

---

## Done Criteria

- [ ] The `functions` API family exposes five governed workspace-secret routes under `/v1/functions/workspaces/{workspaceId}/secrets`
- [ ] `FunctionWorkspaceSecret`, `FunctionWorkspaceSecretCollection`, `FunctionWorkspaceSecretWriteRequest`, and `FunctionSecretReference` schemas are present in the OpenAPI document
- [ ] `FunctionWorkspaceSecretWriteRequest.secretValue` carries `writeOnly: true`; `FunctionWorkspaceSecret` has no `secretValue` property
- [ ] `FunctionAction` exposes `secretReferences` and `unresolvedSecretRefs`; `FunctionActionWriteRequest` accepts `secretReferences`
- [ ] All five secret operation IDs are discoverable through `getPublicRoute` after catalog regeneration
- [ ] `functions-admin.mjs` surface summary includes `workspace_secret` with `list`, `create`, `get`, `update`, `delete` and `getOpenWhiskCompatibilitySummary()` returns `workspaceSecretsSupported: true`
- [ ] `openwhisk-admin.mjs` exports `validateFunctionWorkspaceSecretRequest`, `validateFunctionSecretReferences`, `buildFunctionWorkspaceSecretProjection`, and `buildFunctionWorkspaceSecretCollection`
- [ ] `buildOpenWhiskAdminAuditSummary` returns `capturesSecretReferenceAudit: true`
- [ ] Automated tests cover: secret request validation (valid and invalid), secret reference array validation (duplicates, cross-workspace, malformed), metadata projection (`secretValue` absent), action normalization with `secretReferences`, surface summary and route assertions, and OpenAPI contract assertions
- [ ] `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` all pass without regressions to the `US-FN-03-T01` surface
- [ ] Scope remains bounded to `US-FN-03-T02`; no quota enforcement, console-backend execution, import/export, or audit package expansion is introduced

---

## Notes

- Keep scope strictly bounded to `US-FN-03-T02`. Do not introduce quota enforcement, console-backend execution in OpenWhisk, import/export of functions or packages, or audit-package expansion.
- The `secretValue` non-disclosure guarantee must be enforced at the schema layer (distinct read/write schemas, no shared `$ref` for the value field). Contract tests must assert this explicitly, not rely on convention.
- `unresolvedSecretRefs` is advisory metadata only — it is not a runtime safety guarantee. Execution-time safety is enforced by the resolution layer, not by this field.
- The `capturesSecretReferenceAudit: true` flag in `buildOpenWhiskAdminAuditSummary` is a forward-compatibility anchor for `US-FN-03-T06`. Do not expand audit behavior beyond this flag in this story.
- Workspace and tenant isolation reuse the `resolveOpenWhiskAdminProfile` and serverless context mechanisms already present; no new isolation primitive is introduced.
