# Implementation Plan: Workspace Secrets and Secure Function Secret References

**Branch**: `002-function-workspace-secrets` | **Date**: 2026-03-27 | **Spec**: `specs/002-function-workspace-secrets/spec.md`  
**Input**: Feature specification from `/specs/002-function-workspace-secrets/spec.md`

## Summary

Add a workspace-scoped secret resource to the governed functions surface so authorized workspace members can store opaque secrets and bind them to function actions by name reference. The secret value is write-once and never returned in any API response, function listing, activation record, or log. Functions can declare named secret references that the control-plane resolves at execution time without exposing raw material to callers. The increment is bounded to lifecycle contracts, helper modeling, OpenAPI schemas, validation rules, and executable tests that match the current monorepo maturity and remain fully compatible with the function lifecycle delivered in `US-FN-03-T01`.

## Technical Context

**Language/Version**: Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets  
**Primary Dependencies**: Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules, existing workspace model in `services/internal-contracts`  
**Storage**: repository contract and helper artifacts only in this increment; the secret store infrastructure layer is not provisioned here  
**Testing**: root validation scripts plus unit, adapter, and contract test suites  
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners  
**Project Type**: monorepo control-plane/API governance increment for a multi-tenant BaaS platform  
**Performance Goals**: secrets routes are workspace-scoped list/detail/write operations; no new paginated performance requirement beyond the established `FunctionAdminPage` pattern  
**Constraints**: preserve tenant/workspace isolation (the same boundary already enforced across functions, mongo, and postgres); never return raw secret values through any contract surface; stay compatible with the `US-FN-03-T01` function lifecycle; avoid speculative vault infrastructure or external secret-manager redesign  
**Scale/Scope**: one new API family extension (`functions` family), four new schema types, four new routes under `/v1/functions/workspaces/{workspaceId}/secrets`, one extended function action write/read surface, one new adapter helper group, and matching tests

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — OpenAPI stays under `apps/control-plane`, reusable helper logic stays under `services/`, and tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the work adds workspace-secret contracts, validation helpers, and tests without forcing runtime vault provisioning.
- **Kubernetes and OpenShift Compatibility**: PASS — no deployment artifacts or cluster assumptions are introduced by this increment.
- **Quality Gates at the Root**: PASS — the feature can be validated through existing root OpenAPI and test commands without new scripts.
- **Documentation as Part of the Change**: PASS — spec, plan, and task artifacts are included in the feature branch.
- **No Value Disclosure**: PASS — secret values are absent from all response schemas and helper projections; the constitution for this feature enforces write-only semantics at the contract layer.

## Project Structure

### Documentation (this feature)

```text
specs/002-function-workspace-secrets/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   └── families/
    │       └── functions.openapi.json          ← extend workspace paths + new secret schemas
    └── src/
        └── functions-admin.mjs                 ← expose secret routes, update surface summary

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs                 ← secret reference validation + projections
└── internal-contracts/
    └── src/
        ├── public-route-catalog.json           ← regenerated after OpenAPI update
        └── (other derived artifacts)

tests/
├── adapters/
│   └── openwhisk-admin.test.mjs               ← extend with secret validation coverage
├── contracts/
│   └── functions-secrets.contract.test.mjs    ← new contract test file
└── unit/
    └── functions-admin.test.mjs               ← extend with secret route/surface assertions
```

**Structure Decision**: Route the new workspace-secret surface under the existing `/v1/functions/workspaces/{workspaceId}/` prefix, consistent with how packages, triggers, rules, and inventory are already scoped in this family. Do not introduce a new top-level API family or a new top-level `services/` package; the existing `openwhisk-admin.mjs` helper is the correct place for secret reference validation primitives.

## Target Architecture and Flow

1. A workspace-scoped secret is a named, opaque resource owned by exactly one workspace.
2. Authorized workspace members create secrets via `POST /v1/functions/workspaces/{workspaceId}/secrets`; the response confirms creation metadata (name, workspaceId, timestamps) but never echoes the secret value.
3. The secret is retrievable by name for metadata inspection (`GET .../secrets/{secretName}`), listed within the workspace (`GET .../secrets`), updated with a new value (`PUT .../secrets/{secretName}`), and deleted (`DELETE .../secrets/{secretName}`). Value is absent from all read responses.
4. A function action declares zero or more named secret references in `secretReferences[]` during create or update. Each reference holds only the secret name and a mount alias; the raw value is never stored in the function resource.
5. When the control-plane builds an OpenWhisk adapter call for function invocation or deployment, it resolves each named reference within the same workspace context and injects the resolved value into the governed execution environment without exposing it to callers, activation records, or logs.
6. Workspace and tenant scope are enforced by the same `resolveOpenWhiskAdminProfile` and serverless context mechanisms already used for actions, packages, triggers, and rules — no new isolation primitive is needed.
7. Deletion of a secret while a function still holds a reference is modeled as an "unresolved reference" state, surfaced through the function's `unresolvedSecretRefs` count field (a metadata-only signal with no value disclosure).

## Artifact-by-Artifact Change Plan

### `apps/control-plane/openapi/families/functions.openapi.json`

- Add four paths under `/v1/functions/workspaces/{workspaceId}/secrets`:
  - `GET /v1/functions/workspaces/{workspaceId}/secrets` → `listFunctionWorkspaceSecrets` (`function_workspace_secret`)
  - `POST /v1/functions/workspaces/{workspaceId}/secrets` → `createFunctionWorkspaceSecret` (`function_workspace_secret`)
  - `GET /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `getFunctionWorkspaceSecret` (`function_workspace_secret`)
  - `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `updateFunctionWorkspaceSecret` (`function_workspace_secret`)
  - `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `deleteFunctionWorkspaceSecret` (`function_workspace_secret`)
- Add four new component schemas:
  - `FunctionWorkspaceSecret` — metadata-only read model (secretName, workspaceId, description, timestamps, resolvedRefCount); `secretValue` property is absent
  - `FunctionWorkspaceSecretCollection` — paged list wrapper following the `FunctionAdminPage` pattern
  - `FunctionWorkspaceSecretWriteRequest` — create/update request (secretName, secretValue, description); secretValue is `writeOnly: true`
  - `FunctionSecretReference` — reference from a function to a named workspace secret (secretName, mountAlias, required)
- Extend `FunctionAction` with:
  - `secretReferences` — array of `FunctionSecretReference`, always present (empty array when none)
  - `unresolvedSecretRefs` — integer count of references whose named secret no longer exists in the workspace (metadata only; 0 when all are resolved)
- Extend `FunctionActionWriteRequest` with:
  - `secretReferences` — array of `FunctionSecretReference`; validated server-side against the caller's workspace scope
- Ensure `FunctionWorkspaceSecretWriteRequest.secretValue` carries `writeOnly: true` so OpenAPI validators and generated clients treat it as input-only and no tooling scaffolds it into read responses.
- Apply the same `x-resource-type` and `x-api-family` extension fields used by existing workspace-scoped routes.

### `apps/control-plane/src/functions-admin.mjs`

- Expose secret lifecycle route capabilities through `summarizeFunctionsAdminSurface()` by adding a `workspace_secret` entry alongside the existing `action`, `package`, `trigger`, `rule`, and `inventory` entries.
- Update `getOpenWhiskCompatibilitySummary()` to include `workspaceSecretsSupported: true` and a `secretGovernance` block (analogous to `lifecycleGovernance`) documenting the write-only and workspace-isolation semantics.
- Export a `FUNCTION_SECRET_NAME_PATTERN` constant (the allowed name format: lowercase alphanumeric plus hyphens/underscores, consistent with the action name validation already used in the adapter).
- Keep all existing exports and compatibility assertions unchanged.

### `services/adapters/src/openwhisk-admin.mjs`

- Add `OPENWHISK_ALLOWED_SECRET_REFERENCE_STATUSES` constant: `['resolved', 'unresolved', 'pending']`.
- Add `validateFunctionWorkspaceSecretRequest({ action, payload, context })` — validates create/update/delete secret requests: name format, workspace scope, absence of raw value in non-write actions, and cross-tenant guard. Returns `{ ok, violations, profile }` following the existing `validateOpenWhiskAdminRequest` pattern.
- Add `validateFunctionSecretReferences({ secretRefs, context })` — validates that an array of `FunctionSecretReference` objects attached to a function action write request are structurally correct (unique mount aliases, valid names, workspace match) without resolving actual values. Returns `{ ok, violations }`.
- Add `buildFunctionWorkspaceSecretProjection(payload, context)` — returns a safe metadata record (secretName, workspaceId, tenantId, description, resolvedRefCount, timestamps) with no `secretValue` field, following the same `compactDefined` and `normalizeObjectKeys` discipline used by `normalizeOpenWhiskAdminResource`.
- Add `buildFunctionWorkspaceSecretCollection({ items, nextCursor, size })` — paged wrapper matching `buildOpenWhiskFunctionVersionCollection`.
- Extend `normalizeOpenWhiskAdminResource` for `resourceKind === 'action'` to include `secretReferences` and `unresolvedSecretRefs` fields sourced from `payload.secretReferences` and `payload.unresolvedSecretRefs`, applying the same `compactDefined` pass.
- Extend `buildOpenWhiskAdminAuditSummary` to record `capturesSecretReferenceAudit: true` so downstream audit work has a stable flag to query.
- Preserve all current function, package, trigger, and rule resource normalizations unchanged.

### `services/internal-contracts/src/`

- Regenerate `public-route-catalog.json` after the OpenAPI family update using `npm run generate:public-api` so the five new secret operation IDs are discoverable through `getPublicRoute`.
- Confirm that derived artifacts (taxonomy JSON, catalog JSON) reflect the new `function_workspace_secret` resource type without manual edits — the generation script should handle this automatically.

### `tests/unit/functions-admin.test.mjs`

- Assert that `summarizeFunctionsAdminSurface()` includes a `workspace_secret` entry with the expected `list`, `create`, `get`, `update`, `delete` actions.
- Assert that all five secret operation IDs (`listFunctionWorkspaceSecrets`, `createFunctionWorkspaceSecret`, `getFunctionWorkspaceSecret`, `updateFunctionWorkspaceSecret`, `deleteFunctionWorkspaceSecret`) are present in `listFunctionsAdminRoutes()`.
- Assert that `getOpenWhiskCompatibilitySummary()` returns `workspaceSecretsSupported: true` and `secretGovernance.writeOnlyValue: true`.
- Assert that `FUNCTION_SECRET_NAME_PATTERN` is exported and is a `RegExp`.

### `tests/adapters/openwhisk-admin.test.mjs`

- Cover `validateFunctionWorkspaceSecretRequest` with:
  - Valid create: name, value, workspace scope → `ok: true`
  - Invalid name format → `ok: false` with violation message
  - Empty name → `ok: false`
  - Cross-workspace scope mismatch → `ok: false`
  - Unsupported action → `ok: false`
- Cover `validateFunctionSecretReferences` with:
  - Empty array → `ok: true`
  - Valid references with unique aliases → `ok: true`
  - Duplicate mount alias → `ok: false`
  - Reference pointing to a different workspaceId → `ok: false`
  - Malformed secretName → `ok: false`
- Cover `buildFunctionWorkspaceSecretProjection` to assert `secretValue` is not present in the returned object regardless of what is passed in.
- Cover `buildFunctionWorkspaceSecretCollection` for empty and non-empty item lists.
- Cover `normalizeOpenWhiskAdminResource('action', ...)` with `secretReferences` input to assert the field appears in the normalized output and `secretValue` is absent.
- Ensure existing adapter tests continue to pass.

### `tests/contracts/functions-secrets.contract.test.mjs`

- Validate via `SwaggerParser.validate` that the OpenAPI document exposes all five workspace-secret paths.
- Assert `x-resource-type` equals `function_workspace_secret` on all five operations.
- Assert `FunctionWorkspaceSecretWriteRequest.secretValue` carries `writeOnly: true`.
- Assert `FunctionWorkspaceSecret` has no `secretValue` property.
- Assert `FunctionAction.properties.secretReferences` exists and is an array schema.
- Assert `FunctionAction.properties.unresolvedSecretRefs` exists as an integer schema.
- Assert `createFunctionWorkspaceSecret` returns `201` with a `FunctionWorkspaceSecret` body.
- Assert `updateFunctionWorkspaceSecret` is `PUT` (full replacement of the opaque value).
- Assert all five routes are discoverable through `getPublicRoute` after catalog regeneration.
- Assert `createFunctionWorkspaceSecret` and `updateFunctionWorkspaceSecret` require `Idempotency-Key` in the route catalog (`supportsIdempotencyKey: true`).

## Data Model and Metadata Impact

Introduce the following governed entities for this feature increment:

| Entity | Role | Notable fields |
|--------|------|----------------|
| `FunctionWorkspaceSecret` | Workspace-owned opaque secret resource | `secretName`, `workspaceId`, `tenantId`, `description`, `resolvedRefCount`, `timestamps` — no `secretValue` |
| `FunctionWorkspaceSecretCollection` | Paged list of workspace secrets | `items[]`, `page.size`, `page.nextCursor` |
| `FunctionWorkspaceSecretWriteRequest` | Create/update input envelope | `secretName`, `secretValue` (`writeOnly: true`), `description` |
| `FunctionSecretReference` | Binding from a function action to a named secret | `secretName`, `mountAlias`, `required` |

Extend the `FunctionAction` read model with:

| Field | Type | Semantics |
|-------|------|-----------|
| `secretReferences` | `FunctionSecretReference[]` | Ordered list of named secret references; empty array when none |
| `unresolvedSecretRefs` | `integer` | Count of references whose named secret is absent in the workspace; 0 when all resolved |

Extend the `FunctionActionWriteRequest` input model with:

| Field | Type | Semantics |
|-------|------|-----------|
| `secretReferences` | `FunctionSecretReference[]` | Client-declared references validated against the caller's workspace at write time |

**Storage note**: `secretValue` is handled by the platform's write path only. The governance contract never models a read path for `secretValue`; any downstream implementation must enforce that boundary at the data-access layer, not merely at the API contract layer.

**Traceability**: The `buildOpenWhiskAdminAuditSummary` extension (`capturesSecretReferenceAudit: true`) provides a stable flag for the `US-FN-03-T06` audit package to query without requiring schema drift in the present increment.

## API and UX Considerations

- **Naming convention**: Secret names follow the same lowercase alphanumeric + hyphen/underscore pattern already used for action names and package names. Names are workspace-scoped; the same name may exist in different workspaces without collision.
- **Write-only value discipline**: `FunctionWorkspaceSecretWriteRequest.secretValue` carries `writeOnly: true` in the OpenAPI schema. Read endpoints (`GET /secrets` and `GET /secrets/{secretName}`) return `FunctionWorkspaceSecret` which has no `secretValue` property. This is the same pattern used by `MongoDataCredentialSecretEnvelope` in the mongo family.
- **Idempotency on mutations**: Create and update operations require `Idempotency-Key` in the request headers, consistent with the rollback and invocation patterns already in this family.
- **Duplicate name rejection**: `POST .../secrets` rejects a name that already exists in the same workspace with `409 Conflict`.
- **Error messages**: All error messages about failed secret resolution must be non-sensitive (no value hints, no cross-workspace details). The existing `normalizeOpenWhiskAdminError` error-code map is the right place to add a `secret_reference_unresolved` classification.
- **Unresolved reference semantics**: If a secret referenced by a function is deleted, the function continues to exist but `unresolvedSecretRefs` increases. Attempts to invoke the function with an unresolved reference fail deterministically with a non-sensitive error. The function can be updated to remove the stale reference without a full redeploy.
- **Audience alignment**: Secret administration routes (`create`, `update`, `delete`) target the same governed mutation audience as function create/update. Secret listing and get align with the function-read audience. No new role is required for this increment.
- **Console surface**: Console-facing behavior is represented through the API contract. No console UI implementation is part of this increment.

## Testing Strategy

### Unit

- Route exposure and workspace-secret surface summary checks in `tests/unit/functions-admin.test.mjs`.
- Confirm `FUNCTION_SECRET_NAME_PATTERN` is exported and correctly allows/rejects representative name strings.

### Adapter

- Secret request validation (name, scope, cross-workspace, empty value) in `tests/adapters/openwhisk-admin.test.mjs`.
- Secret reference array validation (duplicates, malformed names, cross-workspace).
- Metadata projection asserting `secretValue` absence.
- Action normalization with `secretReferences` payload.

### Contract

- OpenAPI contract assertions for new schemas, paths, and `writeOnly` discipline in `tests/contracts/functions-secrets.contract.test.mjs`.
- Route catalog discoverability assertions.

### E2E

- No new runtime E2E environment in this task. Console and runtime expectations are represented through contract and helper behavior only.

### Operational validation

```bash
npm run generate:public-api    # regenerate route catalog after OpenAPI update
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

## Risks and Mitigations

- **Risk**: `secretValue` leaks into a read response through OpenAPI schema `$ref` reuse or accidental schema merging.  
  **Mitigation**: `FunctionWorkspaceSecret` (read model) and `FunctionWorkspaceSecretWriteRequest` (write model) are distinct schemas with no shared `$ref` for the value field. `FunctionWorkspaceSecret` must not contain `secretValue` at all, not even with `writeOnly: true`. Contract tests assert this explicitly.

- **Risk**: Cross-workspace secret reference passes validation because `workspaceId` is missing from a reference payload.  
  **Mitigation**: `validateFunctionSecretReferences` requires that any `workspaceId` present on a reference object matches the caller's workspace context. If absent, the adapter defaults to the context workspace and records the inference in the adapter call payload.

- **Risk**: Audit trail for secret administration inadvertently includes the raw value if a future helper copies `payload` naively.  
  **Mitigation**: `buildFunctionWorkspaceSecretProjection` strips `secretValue` using `compactDefined` before the record is returned. The adapter call builder must not include `secretValue` in the `payload.requestedResource` field; `validateFunctionWorkspaceSecretRequest` should reject requests where `action !== 'create' && action !== 'update'` include a `secretValue` field.

- **Risk**: The unresolved-reference count (`unresolvedSecretRefs`) becomes a timing-sensitive field that diverges from actual state during concurrent operations.  
  **Mitigation**: `unresolvedSecretRefs` is modeled as a metadata hint, not a guarantee. Its value is advisory for operators; invocation safety is enforced at execution time, not at listing time. This avoids over-constraining the governance contract.

- **Risk**: The `FunctionActionWriteRequest.secretReferences` array could be used to reference secrets from sibling workspaces by a caller who controls both workspaces.  
  **Mitigation**: `validateFunctionSecretReferences` enforces same-workspace scope at the adapter layer. The contract test asserts the adapter rejects cross-workspace references.

- **Risk**: Adding `secretReferences` to `FunctionAction` breaks existing tests that do strict shape assertions on the action schema.  
  **Mitigation**: `secretReferences` defaults to an empty array (not `undefined`) in `normalizeOpenWhiskAdminResource('action', ...)`. Tests that do not supply the field still pass because the default is present.

- **Risk**: The contract test file name (`functions-secrets.contract.test.mjs`) diverges from the convention used by the first feature (`functions-versioning.contract.test.mjs`).  
  **Mitigation**: The name is chosen to be parallel and consistent with the convention; no glob pattern in `package.json` is affected because all `.test.mjs` files under `tests/contracts/` are matched.

## Recommended Implementation Sequence

1. **Finalize plan and task artifacts** (`specs/002-function-workspace-secrets/plan.md`, `tasks.md`).
2. **Extend the OpenAPI family** — add secret schemas and workspace-secret paths in `apps/control-plane/openapi/families/functions.openapi.json`; extend `FunctionAction` and `FunctionActionWriteRequest`.
3. **Regenerate derived contract artifacts** — run `npm run generate:public-api` and confirm the five new operation IDs appear in `services/internal-contracts/src/public-route-catalog.json`.
4. **Update `functions-admin.mjs`** — expose secret route surface summary, export `FUNCTION_SECRET_NAME_PATTERN`, and update the compatibility summary.
5. **Update `openwhisk-admin.mjs`** — add `validateFunctionWorkspaceSecretRequest`, `validateFunctionSecretReferences`, `buildFunctionWorkspaceSecretProjection`, `buildFunctionWorkspaceSecretCollection`; extend action normalization and audit summary builder.
6. **Add/extend unit, adapter, and contract tests** — cover the new surface in all three test suites.
7. **Run root validation commands** — `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, `npm run lint` — and fix any contract or test drift before committing.

## Parallelization Notes

- Steps 4 and 5 (helper module updates) can start in parallel with each other once the intended schema and route names from step 2 are stabilized.
- Contract tests (step 6) require stable operation IDs and schema names from step 2 before assertions can be written without rework.
- Unit tests for `functions-admin.mjs` can be authored independently of the adapter tests as long as the exported names from step 4 are fixed.
- Adapter tests for `openwhisk-admin.mjs` can be written alongside step 5 once the function signatures are decided.
- `npm run generate:public-api` (step 3) must complete before the contract test that validates route catalog discoverability can pass.
- No work from this branch should start on `US-FN-03-T03` through `US-FN-03-T06` until this branch's validation commands pass cleanly.

## Done Criteria

- The `functions` API family exposes five governed workspace-secret routes under `/v1/functions/workspaces/{workspaceId}/secrets`.
- `FunctionWorkspaceSecret`, `FunctionWorkspaceSecretCollection`, `FunctionWorkspaceSecretWriteRequest`, and `FunctionSecretReference` schemas are present in the OpenAPI document.
- `FunctionWorkspaceSecretWriteRequest.secretValue` is `writeOnly: true`; `FunctionWorkspaceSecret` has no `secretValue` property.
- `FunctionAction` exposes `secretReferences` and `unresolvedSecretRefs`; `FunctionActionWriteRequest` accepts `secretReferences`.
- The five secret operation IDs are discoverable through `getPublicRoute` after catalog regeneration.
- `functions-admin.mjs` surface summary includes `workspace_secret` with the correct action list and `workspaceSecretsSupported: true` in the compatibility summary.
- `openwhisk-admin.mjs` exports `validateFunctionWorkspaceSecretRequest`, `validateFunctionSecretReferences`, `buildFunctionWorkspaceSecretProjection`, and `buildFunctionWorkspaceSecretCollection`.
- Automated tests cover secret validation (valid and invalid paths), metadata projection (value absence), and OpenAPI contract assertions.
- `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` all pass without regressions to the existing function lifecycle surface from `US-FN-03-T01`.
- Scope remains bounded to `US-FN-03-T02`; no quota enforcement, console-backend execution, import/export, or audit package expansion is introduced.

## Expected Evidence

- Updated OpenAPI family diff showing new paths, schemas, and `FunctionAction` field extensions.
- Updated helper-module diffs for `functions-admin.mjs` and `openwhisk-admin.mjs`.
- New contract test file `tests/contracts/functions-secrets.contract.test.mjs`.
- Extended test diffs for `tests/unit/functions-admin.test.mjs` and `tests/adapters/openwhisk-admin.test.mjs`.
- Passing output from `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` captured before the PR is opened.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Separate `FunctionWorkspaceSecret` read schema and `FunctionWorkspaceSecretWriteRequest` write schema instead of a single reusable schema | `secretValue` must be absent from all read responses; sharing a schema would require conditional field omission which is harder to validate contractually | A single schema with `readOnly`/`writeOnly` markers on fields cannot be enforced by the existing contract test infrastructure without custom logic; two schemas make the guarantee explicit and auditable |
| Five new routes instead of a single CRUD sub-resource with method variations | The repo pattern for workspace-scoped resources uses explicit path+method combinations with per-operation `x-resource-type` annotations; diverging from this would break `filterPublicRoutes` behavior | Collapsing all secret CRUD into fewer paths would reduce route-catalog visibility and complicate the surface summary in `summarizeFunctionsAdminSurface` |
| `unresolvedSecretRefs` as an advisory integer rather than a list of unresolved names | Returning unresolved reference names would leak the existence of named secrets (even deleted ones) and the names themselves, which crosses the non-disclosure boundary | An integer count provides actionable signal (go fix your function configuration) without disclosing which secrets are missing or what they were named |
