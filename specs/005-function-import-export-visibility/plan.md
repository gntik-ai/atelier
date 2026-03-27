# Implementation Plan: Function and Package Import/Export with Web Action Visibility Policies

**Branch**: `005-function-import-export-visibility` | **Date**: 2026-03-27 | **Spec**: `specs/005-function-import-export-visibility/spec.md`
**Task**: US-FN-03-T05
**Input**: Feature specification from `/specs/005-function-import-export-visibility/spec.md`

## Summary

Extend the governed `functions` surface so authorized operators can export function and package definitions from a workspace and import them into a permitted target workspace, while preserving public/private visibility policies for web actions across the full round trip. The increment is bounded to: defining export and import bundle schemas, implementing scope-safe serialization and deserialization of function and package definitions, enforcing tenant/workspace isolation and access control on both operations, preserving `web_action_visibility` state through export and import, detecting and rejecting definition collisions and unsupported-policy combinations, and providing contract and unit evidence for all governed behaviors. No versioning, rollback, secret material, quota enforcement, activation history, console-backend execution, or expanded audit coverage is introduced. This task must remain compatible with US-FN-03-T01 (versioning), T02 (secrets), T03 (quota), and T04 (console backend execution) already delivered, and must not absorb T06 (expanded audit evidence).

## Technical Context

**Language/Version**: Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets
**Primary Dependencies**: Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules (`services/adapters/src/openwhisk-admin.mjs`), internal-contracts index (`services/internal-contracts/src/index.mjs`), `public-route-catalog.json`, `authorization-model.json`, `internal-service-map.json`, `domain-model.json`
**Storage**: repository contract and helper artifacts only in this increment; no new database tables or persistent storage schemas are introduced — import/export bundles are transient request/response payloads governed by the existing `control_api` surface
**Testing**: root validation scripts plus unit, adapter, contract, and resilience test suites running under Node `node:test`
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners
**Project Type**: monorepo control-plane/API governance increment for a multi-tenant BaaS platform
**Performance Goals**: export and import validation remain synchronous and pre-commit; no additional OpenWhisk cluster round-trips beyond the existing workspace-scoped resource read/write paths
**Constraints**: preserve tenant/workspace isolation enforced by T01/T02/T03/T04; avoid secrets, versioning, quota enforcement, activation history, and audit-expansion sibling scope; stay compatible with existing `OPENWHISK_ALLOWED_PACKAGE_VISIBILITY` constant (`['private', 'workspace_shared']`), existing `http_exposure` routes, and the existing `summarizeFunctionsAdminSurface()` compatibility tracking surface; keep changes root-validated
**Scale/Scope**: one new control-plane module, two additive extensions to existing adapter and admin modules, four additive patches to internal contract JSON artifacts, two new OpenAPI operation pairs in the `functions` family, and matching test suites across unit, adapter, contract, and resilience layers

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — the new `functions-import-export.mjs` module stays under `apps/control-plane/src/`; adapter extensions stay under `services/adapters/src/`; contract JSON patches stay under `services/internal-contracts/src/`; new OpenAPI operations stay in `apps/control-plane/openapi/families/functions.openapi.json`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the work adds import/export bundle schemas, visibility policy constants, scope validation helpers, and governed API routes without modifying the OpenWhisk cluster runtime or introducing new storage engines.
- **Kubernetes and OpenShift Compatibility**: PASS — no new deployment artifacts or cluster assumptions are introduced; all new routes follow the existing `functions` gateway route class and request validation profile.
- **Quality Gates at the Root**: PASS — the feature can be validated through existing root `generate:public-api`, `validate:public-api`, `validate:openapi`, `test:unit`, `test:adapters`, and `test:contracts` commands without new scripts.
- **Documentation as Part of the Change**: PASS — spec, plan, and task artifacts are included in the feature branch.
- **API Symmetry**: PASS — import and export routes follow the same tenant/workspace binding pattern, required headers, error envelope, and audience restrictions as the existing functions family routes; no separate privileged surface is introduced.
- **T01–T04 Non-Regression**: PASS — no existing exports from `functions-admin.mjs`, `openwhisk-admin.mjs`, or any contract JSON are modified; all changes are purely additive.

## Project Structure

### Documentation (this feature)

```text
specs/005-function-import-export-visibility/
├── spec.md
├── plan.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   └── families/
    │       └── functions.openapi.json          ← additive: two export operation pairs
    │                                              (exportFunctionDefinition, exportFunctionPackageDefinition)
    │                                              and two import operation pairs
    │                                              (importFunctionDefinition, importFunctionPackageDefinition);
    │                                              new schema components: FunctionExportBundle,
    │                                              PackageExportBundle, FunctionImportRequest,
    │                                              PackageImportRequest, ImportResult,
    │                                              WebActionVisibilityPolicy
    └── src/
        ├── functions-import-export.mjs          ← new file: import/export bundle logic, visibility
        │                                           policy constants, scope-safe serialization, and
        │                                           collision/policy-conflict detection
        └── functions-admin.mjs                  ← additive: re-exports import/export helpers,
                                                    extends summarizeFunctionsAdminSurface() to
                                                    include import/export resource types

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs                 ← additive: web action visibility policy constants
│                                                  (OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY),
│                                                  bundle serializer/deserializer helpers, and
│                                                  import collision detection logic
└── internal-contracts/
    └── src/
        ├── authorization-model.json            ← additive: four new negative scenario entries
        │                                          for cross-tenant import, cross-workspace export,
        │                                          collision rejection, and unsupported-policy rejection;
        │                                          one new propagation target: definition_import_context
        ├── internal-service-map.json           ← additive: two new responsibility entries for
        │                                          control_api covering import and export definition
        │                                          governance
        ├── public-route-catalog.json           ← additive: four new route entries for the import
        │                                          and export operations, matching the existing
        │                                          functions route shape
        └── domain-model.json                  ← additive: new entity definitions for
                                                   FunctionExportBundle, PackageExportBundle,
                                                   ImportBundle, WebActionVisibilityPolicy,
                                                   DefinitionCollision; new business invariants
                                                   for round-trip visibility preservation and
                                                   cross-scope rejection

tests/
├── unit/
│   └── functions-import-export.test.mjs       ← new file: unit tests for the new module
├── adapters/
│   └── openwhisk-admin.test.mjs               ← additive: assertions for visibility constants
│                                                  and bundle serialization/deserialization helpers
├── contracts/
│   └── functions-import-export.contract.test.mjs  ← new file: bundle schema contracts, visibility
│                                                      round-trip contracts, scope isolation contracts,
│                                                      collision rejection contracts
└── resilience/
    └── functions-import-export-authorization.test.mjs  ← new file: negative scenario tests for
                                                            the four new AUTHZ denial scenarios
```

**Structure Decision**: Keep import/export logic in a dedicated `functions-import-export.mjs` module following the established pattern of `console-backend-functions.mjs` for T04. Do not merge these concerns into the generic `functions-admin.mjs`. The adapter extension follows the same purely additive pattern used by T01/T02/T03/T04.

## Target Architecture and Flow

### Export flow

1. An authorized workspace operator sends `POST /v1/functions/workspaces/{workspaceId}/definitions/export` (function) or `POST /v1/functions/workspaces/{workspaceId}/packages/{packageName}/export` (package) carrying a bearer OIDC token, `Idempotency-Key`, `X-API-Version`, and `X-Correlation-Id`.
2. APISIX resolves `tenant_id` and `workspace_id` from gateway context headers and validates the caller has a `workspace_owner`, `workspace_admin`, or `workspace_developer` role within that tenant/workspace scope.
3. The `control_api` enforcement surface calls `functions-import-export.mjs → buildScopeValidatedExportRequest(context, resourceRef)`, which verifies the resource reference belongs to the caller's authorized tenant and workspace before producing a typed export command.
4. The adapter (`openwhisk-admin.mjs`) reads the governed resource definition (function action or package) from the workspace-scoped OpenWhisk namespace and passes the raw definition to `serializeDefinitionBundle(resource, options)`, which strips runtime-sensitive fields (activation records, quota state, secret values, version history references) and preserves definition-level fields including `web_action_visibility` where present.
5. The serialized `FunctionExportBundle` or `PackageExportBundle` is returned as the HTTP response body. It does not contain secrets, activation state, quota counters, version identifiers, or cross-tenant identifiers.
6. For packages, all contained function actions are included in the bundle with their individual `web_action_visibility` states serialized independently.

### Import flow

1. An authorized workspace operator sends `POST /v1/functions/workspaces/{workspaceId}/definitions/import` (function) or `POST /v1/functions/workspaces/{workspaceId}/packages/import` (package) with a `FunctionImportRequest` or `PackageImportRequest` body carrying the serialized bundle.
2. APISIX resolves `tenant_id` and `workspace_id` and validates authorization as above.
3. The `control_api` enforcement surface calls `functions-import-export.mjs → validateImportBundle(bundle, context)`, which performs: (a) tenant/workspace scope assertion — any bundle reference pointing outside the target tenant/workspace is rejected without revealing the foreign definition; (b) definition collision check — if a resource with the same name already exists in the target workspace, the import is rejected with a clear `IMPORT_COLLISION` error code; (c) visibility policy check — if a web action in the bundle carries an unsupported or policy-forbidden visibility state, the import is rejected with `IMPORT_POLICY_CONFLICT` before any partial write occurs.
4. If validation passes, the adapter applies the definitions to the workspace-scoped OpenWhisk namespace, preserving `web_action_visibility` as declared in the bundle.
5. An `ImportResult` response is returned describing the resources created and their final visibility states.

### Web action visibility policy

- The canonical visibility states for web actions are `public` and `private`.
- `public` means the action is intentionally exposed through the product's supported web-action surface (the existing `http-exposure` route family).
- `private` means the action is restricted and must not become broadly reachable merely because it was exported or imported.
- Visibility is carried as the `web_action_visibility` field inside `FunctionExportBundle` and `FunctionImportRequest`. It is preserved verbatim when the target workspace permits the declared policy. If the target workspace has a policy that disallows public exposure, a bundle carrying `web_action_visibility: 'public'` is rejected rather than silently downgraded.
- The existing `createFunctionHttpExposure` / `updateFunctionHttpExposure` routes (T01–T04-compatible) remain the sole mechanism for actually binding a web action to an external URL. Import/export governs the definition-level intent; binding activation is a separate step outside this task's scope.

### Cross-scope isolation

- All export and import requests must present a `tenantBinding: required` and `workspaceBinding: required` route contract, matching the existing functions family pattern.
- A bundle that references any `tenantId` or `workspaceId` not equal to the caller's authorized scope is rejected before any read or write of OpenWhisk resources.
- The rejection response must not reveal whether a definition exists in the foreign scope. The error must use a `GW_`-prefixed code consistent with the existing gateway error taxonomy.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/openwhisk-admin.mjs`

- Export a new constant `OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY = Object.freeze(['public', 'private'])` to give all consumers a stable, typo-safe set of supported visibility states, consistent with the existing `OPENWHISK_ALLOWED_PACKAGE_VISIBILITY` pattern.
- Export a new constant `OPENWHISK_DEFINITION_BUNDLE_VERSION = '1.0'` to anchor the serialization schema version in the adapter layer.
- Export a new function `serializeDefinitionBundle(resource, options)` that accepts a governed function action or package definition read from the workspace-scoped OpenWhisk namespace and returns a structured, runtime-sensitive-field-stripped object conforming to `FunctionExportBundle` or `PackageExportBundle`. Must not include activation records, secret values, version history references, quota counters, or cross-tenant identifiers. Must include `web_action_visibility` when present.
- Export a new function `deserializeDefinitionBundle(bundle)` that accepts a `FunctionImportRequest` or `PackageImportRequest` payload and returns a normalized, validated internal representation for comparison against the workspace's existing definitions. Returns a structured deserialization result including detected field anomalies without throwing for non-critical warnings.
- Export a new function `detectDefinitionCollision(existingResources, incomingBundle)` that takes the list of existing workspace resource names and the incoming bundle and returns a structured collision result (`{ collision: true|false, collidingNames: [] }`).
- Export a new function `checkVisibilityPolicySupport(bundle, workspacePolicy)` that validates each web action's declared `web_action_visibility` against the target workspace's allowed values. Returns a structured policy check result (`{ supported: true|false, unsupportedActions: [] }`).
- No changes to: existing tenant invocation paths, quota validation helpers, version/rollback helpers, secret resolution helpers, or console backend annotation logic introduced by T01/T02/T03/T04.

### `apps/control-plane/src/functions-import-export.mjs` (new file)

Follows the pattern established by `console-backend-functions.mjs`. Exports:

- `FUNCTION_IMPORT_EXPORT_BUNDLE_VERSION = '1.0'` — stable bundle version identifier for the import/export surface.
- `WEB_ACTION_VISIBILITY_STATES = Object.freeze(['public', 'private'])` — canonical visibility states for web actions in this feature.
- `IMPORT_ERROR_CODES = Object.freeze({ COLLISION: 'IMPORT_COLLISION', POLICY_CONFLICT: 'IMPORT_POLICY_CONFLICT', SCOPE_VIOLATION: 'IMPORT_SCOPE_VIOLATION', UNSUPPORTED_BUNDLE: 'IMPORT_UNSUPPORTED_BUNDLE' })` — stable error code identifiers for all rejection categories.
- `buildScopeValidatedExportRequest(context, resourceRef)` — validates that `resourceRef.tenantId` and `resourceRef.workspaceId` match the caller's authorized `context.tenantId` and `context.workspaceId`; returns a typed export command or throws a scope violation error.
- `buildScopeValidatedImportRequest(context, bundle)` — validates that the bundle's declared `tenantId` and `workspaceId` match the caller's authorized scope; returns a typed import command or throws a scope violation error.
- `validateImportBundle(bundle, context)` — orchestrates: scope assertion → collision check → visibility policy check → deserialization validation; returns a structured `ImportValidationResult` with a `valid` flag, an array of `violations` (each with `code`, `field`, and `detail`), and a `normalizedDefinitions` array for downstream commit.
- `buildImportResult(normalizedDefinitions, context)` — builds the `ImportResult` response body from the list of committed resources, including their final `web_action_visibility` states.
- `summarizeFunctionImportExportSurface()` — returns an introspectable surface summary for discoverability and admin inventory consumers.

### `apps/control-plane/src/functions-admin.mjs`

- Import and re-export `WEB_ACTION_VISIBILITY_STATES`, `IMPORT_ERROR_CODES`, `buildScopeValidatedExportRequest`, `buildScopeValidatedImportRequest`, and `validateImportBundle` from `functions-import-export.mjs` so control-plane consumers have a single import surface.
- Extend `summarizeFunctionsAdminSurface()` to include two new resource kind entries: `function_definition_export` (actions: `['export']`, routeCount from filtered catalog) and `function_definition_import` (actions: `['import']`, routeCount from filtered catalog). This keeps the surface summary aligned with the new route entries and maintains backward-compatible array ordering.
- Extend `getOpenWhiskCompatibilitySummary()` to add `definitionImportExportSupported: true` at the same level as `functionVersioningSupported` and `workspaceSecretsSupported`, giving compatibility consumers a stable query point.
- No changes to: existing route listing functions, console backend identity exports, or T01/T02/T03/T04 exports.

### `apps/control-plane/openapi/families/functions.openapi.json`

Add four new operation objects:

- `POST /v1/functions/workspaces/{workspaceId}/definitions/export` — `operationId: exportFunctionDefinition`; request body: `FunctionExportRequest` (contains `resourceId` reference, optional `includeWebActionVisibility: true`); response: `FunctionExportBundle`; audiences: `workspace_owner`, `workspace_admin`, `workspace_developer`, `platform_team`; tenant/workspace binding required; idempotency key required; `planCapabilityAnyOf: ['data.openwhisk.actions']`.
- `POST /v1/functions/workspaces/{workspaceId}/packages/{packageName}/export` — `operationId: exportFunctionPackageDefinition`; request body: empty or `PackageExportRequest`; response: `PackageExportBundle`; same audiences and bindings.
- `POST /v1/functions/workspaces/{workspaceId}/definitions/import` — `operationId: importFunctionDefinition`; request body: `FunctionImportRequest` (contains serialized `FunctionExportBundle` plus target scope confirmation); response: `ImportResult`; audiences: `workspace_owner`, `workspace_admin`, `workspace_developer`, `platform_team`; tenant/workspace binding required; idempotency key required.
- `POST /v1/functions/workspaces/{workspaceId}/packages/import` — `operationId: importFunctionPackageDefinition`; request body: `PackageImportRequest`; response: `ImportResult`; same audiences and bindings.

Add six new schema components:

- `FunctionExportBundle` — `definitionVersion`, `tenantId`, `workspaceId`, `name`, `runtime`, `sourceKind`, `executionPolicy`, `web_action_visibility` (optional, enum `['public', 'private']`), `annotations` (safe, non-secret), `bundleVersion`.
- `PackageExportBundle` — `definitionVersion`, `tenantId`, `workspaceId`, `packageName`, `visibility` (enum `['private', 'workspace_shared']`), `actions` (array of `FunctionExportBundle`), `bundleVersion`.
- `FunctionImportRequest` — `bundle` (`FunctionExportBundle`), `targetTenantId`, `targetWorkspaceId`, `collisionPolicy` (enum `['reject']`; only `reject` is supported in this increment).
- `PackageImportRequest` — `bundle` (`PackageExportBundle`), `targetTenantId`, `targetWorkspaceId`, `collisionPolicy`.
- `ImportResult` — `imported` (array of `{ name, resourceType, web_action_visibility }`), `skipped` (array, empty in this increment since only `reject` collision policy is supported), `errors` (array of `{ code, field, detail }`).
- `WebActionVisibilityPolicy` — standalone schema enum `['public', 'private']` for reuse across components.

No existing paths, operations, or schema components are modified.

### `services/internal-contracts/src/authorization-model.json`

- In `propagation_targets`, add one new entry `definition_import_context` listing the fields required when a definition import command is propagated: `actor`, `tenant_id`, `workspace_id`, `correlation_id`, `bundle_version`, `import_operation` (required). This follows the same structure as the existing `console_backend_activation` entry.
- In `negative_scenarios`, add four new denial entries:
  - `AUTHZ-FN-IMP-001`: Caller attempts to export a function definition from a workspace in a different tenant — must be denied without revealing whether the definition exists.
  - `AUTHZ-FN-IMP-002`: Caller attempts to import a bundle whose declared `tenantId` does not match the caller's authorized tenant — must be denied without revealing the foreign definition.
  - `AUTHZ-FN-IMP-003`: Import bundle contains a function or package name that already exists in the target workspace — must be rejected with `IMPORT_COLLISION` before any partial write.
  - `AUTHZ-FN-IMP-004`: Import bundle contains a web action with an unsupported or policy-forbidden `web_action_visibility` value — must be rejected with `IMPORT_POLICY_CONFLICT` before any partial write.
- No changes to: existing role catalog, enforcement surface definitions, permission matrix entries, `openwhisk_activation` propagation target, or `console_backend_activation` propagation target introduced by T01/T02/T03/T04.

### `services/internal-contracts/src/internal-service-map.json`

- In the `control_api` service responsibilities array, add two new entries:
  - `"Accept authorized function and package definition export requests from within the caller's tenant and workspace scope, serialize the definition without runtime-sensitive fields, and return a scope-safe export bundle."`
  - `"Accept authorized function and package definition import requests, validate bundle scope, detect name collisions and unsupported visibility-policy combinations, and apply the import only when all governance checks pass."`
- No other service definitions or ownership boundaries are changed.

### `services/internal-contracts/src/public-route-catalog.json`

Add four new route entries following the exact shape of existing `function_package` routes:

- `exportFunctionDefinition`: `POST /v1/functions/workspaces/{workspaceId}/definitions/export`, `resourceType: 'function_definition_export'`, `family: 'functions'`, `rateLimitClass: 'provisioning'`, `supportsIdempotencyKey: true`, `tenantBinding: 'required'`, `workspaceBinding: 'required'`, audiences and required headers matching existing functions routes.
- `exportFunctionPackageDefinition`: `POST /v1/functions/workspaces/{workspaceId}/packages/{packageName}/export`, `resourceType: 'function_definition_export'`, same profile.
- `importFunctionDefinition`: `POST /v1/functions/workspaces/{workspaceId}/definitions/import`, `resourceType: 'function_definition_import'`, same profile.
- `importFunctionPackageDefinition`: `POST /v1/functions/workspaces/{workspaceId}/packages/import`, `resourceType: 'function_definition_import'`, same profile.

No existing route entries are modified.

### `services/internal-contracts/src/domain-model.json`

- Add five new entity definitions under `entities`:
  - `FunctionExportBundle` — the governed output artifact of a function export operation.
  - `PackageExportBundle` — the governed output artifact of a package export operation.
  - `ImportBundle` — the governed input payload for a function or package import operation.
  - `WebActionVisibilityPolicy` — the policy rule governing whether a web action is public or private.
  - `DefinitionCollision` — a detected conflict between an incoming import bundle and an existing scoped resource name.
- Add two new business invariants:
  - `BI-FN-IMPORT-001`: A web action's declared `web_action_visibility` must be preserved verbatim in an import result when the target workspace permits the declared policy; no implicit downgrade or upgrade is permitted.
  - `BI-FN-IMPORT-002`: An import operation must be fully atomic at the validation layer; if any bundle member fails a scope, collision, or visibility-policy check, the entire import must be rejected before any resource is written.
- No existing entities, relationships, or invariants are modified.

### `tests/unit/functions-import-export.test.mjs` (new file)

Follows the pattern of `tests/unit/functions-admin.test.mjs`. Node `node:test`, no external dependencies. Covers:

- `WEB_ACTION_VISIBILITY_STATES` contains exactly `['public', 'private']`.
- `IMPORT_ERROR_CODES` exports all four required code identifiers.
- `buildScopeValidatedExportRequest` passes for matching tenant/workspace and throws for mismatched tenant.
- `buildScopeValidatedImportRequest` passes for matching scope and throws for cross-tenant and cross-workspace bundles.
- `validateImportBundle` returns `valid: true` for a well-formed single-function bundle.
- `validateImportBundle` returns `valid: false` with code `IMPORT_COLLISION` when a name collision is simulated.
- `validateImportBundle` returns `valid: false` with code `IMPORT_POLICY_CONFLICT` for an unsupported visibility value.
- `validateImportBundle` returns `valid: false` with code `IMPORT_SCOPE_VIOLATION` for a cross-tenant bundle reference.
- `buildImportResult` includes `web_action_visibility` for each imported resource.
- `summarizeFunctionImportExportSurface` returns a non-empty object.
- Package bundle with mixed-visibility actions preserves each action's declared state independently.

### `tests/adapters/openwhisk-admin.test.mjs` (additive)

Add assertions to the existing adapter test file for:

- `OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY` exports `['public', 'private']`.
- `OPENWHISK_DEFINITION_BUNDLE_VERSION` is exported as a non-empty string.
- `serializeDefinitionBundle` strips activation records, quota state, secret values, and version history references from a representative input fixture.
- `serializeDefinitionBundle` preserves `web_action_visibility: 'public'` and `web_action_visibility: 'private'` from the input fixture.
- `deserializeDefinitionBundle` returns a normalized result for a valid export bundle.
- `detectDefinitionCollision` returns `collision: true` when the incoming bundle name matches an existing workspace resource name.
- `checkVisibilityPolicySupport` returns `supported: false` with the conflicting action name when a bundle contains an unrecognized visibility value.

### `tests/contracts/functions-import-export.contract.test.mjs` (new file)

Follows the pattern of `tests/contracts/functions-versioning.contract.test.mjs`. Covers:

- `FunctionExportBundle` schema satisfies the `function_admin_result` contract baseline fields.
- A round-tripped bundle (serialize then deserialize) preserves `web_action_visibility: 'public'` without mutation.
- A round-tripped bundle preserves `web_action_visibility: 'private'` without mutation.
- An import rejection for `IMPORT_COLLISION` produces an `ErrorResponse`-compatible shape.
- An import rejection for `IMPORT_POLICY_CONFLICT` produces an `ErrorResponse`-compatible shape with a `GW_`-prefixed code.
- An import rejection for `IMPORT_SCOPE_VIOLATION` produces an `ErrorResponse`-compatible shape that does not reveal foreign resource details.
- `importFunctionDefinition` and `exportFunctionDefinition` route entries exist in `public-route-catalog.json` and satisfy `tenantBinding: 'required'` and `workspaceBinding: 'required'`.
- `definition_import_context` propagation target exists in `authorization-model.json` with `bundle_version` and `import_operation` marked required.
- `summarizeFunctionsAdminSurface()` includes `function_definition_export` and `function_definition_import` resource kinds.
- `getOpenWhiskCompatibilitySummary()` returns `definitionImportExportSupported: true`.

### `tests/resilience/functions-import-export-authorization.test.mjs` (new file)

Negative scenario tests covering the four new AUTHZ denial scenarios:

- `AUTHZ-FN-IMP-001`: Export attempt against a workspace belonging to a different tenant produces a denial without revealing the definition — expects `IMPORT_SCOPE_VIOLATION` or equivalent gateway denial.
- `AUTHZ-FN-IMP-002`: Import attempt with a bundle whose `tenantId` differs from the caller's authorized tenant produces a denial without revealing the foreign definition.
- `AUTHZ-FN-IMP-003`: Import of a bundle where the function name already exists in the target workspace produces `IMPORT_COLLISION` and no partial write.
- `AUTHZ-FN-IMP-004`: Import of a bundle containing a web action with an unsupported `web_action_visibility` value produces `IMPORT_POLICY_CONFLICT` and no partial write.
- Package bundle with one action having an unsupported visibility and one action having a valid visibility produces a single `IMPORT_POLICY_CONFLICT` and rejects the entire bundle (atomicity invariant `BI-FN-IMPORT-002`).
- Retry of a previously rejected import with the same `Idempotency-Key` produces the same rejection outcome (authorization re-evaluation on every request).

## Data Model and Metadata Impact

No new database tables or schema migrations are required. Export bundles are transient HTTP response payloads; import bundles are transient HTTP request payloads. The following governed concepts are introduced at the contract level:

| Entity | Role | Notable fields |
|--------|------|----------------|
| `FunctionExportBundle` | Scope-safe export payload for a single function action definition | `name`, `runtime`, `sourceKind`, `executionPolicy`, `web_action_visibility`, `bundleVersion`, `tenantId`, `workspaceId` |
| `PackageExportBundle` | Scope-safe export payload for a package and its contained actions | `packageName`, `visibility`, `actions` (array of `FunctionExportBundle`), `bundleVersion`, `tenantId`, `workspaceId` |
| `ImportBundle` | Unified input type for function or package import operations | `bundle` (typed union), `targetTenantId`, `targetWorkspaceId`, `collisionPolicy` |
| `WebActionVisibilityPolicy` | Canonical enum for web action exposure intent | `'public'` or `'private'` |
| `DefinitionCollision` | Detected conflict between incoming bundle and existing workspace resource | `collidingName`, `resourceType`, `existingTenantId`, `existingWorkspaceId` |
| `ImportResult` | Response payload for a successful import | `imported` (array with `name`, `resourceType`, `web_action_visibility`), `skipped`, `errors` |
| `ImportValidationResult` | Internal validation outcome before any write | `valid`, `violations` (array of `{ code, field, detail }`), `normalizedDefinitions` |

The authorization model JSON receives one new `definition_import_context` propagation target and four new negative scenario entries (`AUTHZ-FN-IMP-001` through `AUTHZ-FN-IMP-004`). These are backward-compatible: existing entries are untouched and all existing test coverage continues to pass without modification.

The `public-route-catalog.json` receives four new route entries with `resourceType: 'function_definition_export'` or `'function_definition_import'`. The `domain-model.json` receives five new entity definitions and two new business invariants. The `internal-service-map.json` receives two additive responsibility entries. All changes are additive and do not affect the existing route count assertions in `tests/contracts/public-api.catalog.test.mjs` beyond the natural increase in total route count.

## API and UX Considerations

- **New routes follow the existing functions family shape exactly**: `gatewayAuthMode: 'bearer_oidc'`, `gatewayRouteClass: 'functions'`, `internalRequestMode: 'validated_attestation'`, `errorEnvelope: 'ErrorResponse'`, `tenantBinding: 'required'`, `workspaceBinding: 'required'`, `supportsIdempotencyKey: true`, `idempotencyTtlSeconds: 86400`.
- **Import is fully synchronous in this increment**: the `ImportResult` is returned inline. Async or streaming import is not introduced and not needed to satisfy SC-001 through SC-006.
- **Collision policy is `reject`-only**: the `collisionPolicy` field exists in `FunctionImportRequest` and `PackageImportRequest` to make the API forward-compatible, but only the value `'reject'` is accepted in this increment. Any other value must be rejected with a clear `IMPORT_UNSUPPORTED_BUNDLE` error.
- **Visibility field is optional on export**: if the source action has no declared `web_action_visibility` (i.e., it is not a web action), the field is omitted from the bundle. Import of a bundle without `web_action_visibility` creates a non-web action in the target workspace; no implicit visibility is assumed.
- **No UI work required**: import and export are backend API operations. No web-console UI components are introduced or required in this increment.
- **Error responses are schema-stable**: all rejection responses must conform to the existing `ErrorResponse` envelope and use `GW_`-prefixed error codes consistent with the gateway error taxonomy already established for the functions family.
- **Export does not produce a downloadable file format**: the export bundle is returned as a structured JSON response body. No multipart, ZIP, or binary packaging is introduced. Consumers may persist the JSON independently.
- **Package export includes all contained actions**: the `PackageExportBundle.actions` array is always complete for the package at export time. Partial package exports are not supported in this increment.
- **Idempotency behavior**: a repeated export request with the same `Idempotency-Key` returns the same bundle content as the original response within the 24-hour replay window, consistent with existing function mutation idempotency rules.
- **No sibling scope creep**: this increment does not rework secrets, versioning, rollback, quota enforcement, activation history, console-backend execution, or audit expansion.

## Testing Strategy

### Unit

Route exposure, bundle schema, scope validation, and visibility policy checks in `tests/unit/functions-import-export.test.mjs`. Covers all exports from the new module with valid and invalid inputs across all rejection categories.

### Adapter

Visibility constants, serialization, deserialization, collision detection, and policy-support checks in `tests/adapters/openwhisk-admin.test.mjs` (additive). Covers round-trip field preservation and all four error code paths.

### Contract

OpenAPI schema compliance and contract alignment assertions in `tests/contracts/functions-import-export.contract.test.mjs`. Covers: export bundle schema compliance with `function_admin_result` baseline; import rejection shapes against `ErrorResponse`; round-trip visibility preservation at the schema level; route catalog consistency for the four new route entries; compatibility summary extension (`definitionImportExportSupported`); surface summary extension for the two new resource kinds.

### Resilience

Negative scenario tests in `tests/resilience/functions-import-export-authorization.test.mjs`. Covers all four `AUTHZ-FN-IMP-*` denial scenarios, atomicity invariant for mixed-action packages, and idempotency-key replay behavior for rejected imports.

### E2E

No new runtime E2E environment is required in this task. The `tests/e2e/` package should receive a describe-only scaffold for: (a) happy-path export and import of a function action with `web_action_visibility: 'public'` preserving visibility across the round trip; (b) happy-path export and import of a package with mixed-visibility actions preserving each action's state independently; (c) negative-path cross-tenant import attempt expecting HTTP 403 with an `ErrorResponse` body and no foreign resource disclosure.

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

- **Risk**: Export bundle accidentally includes secret references or resolved secret values from the workspace secrets feature (T02).
  **Mitigation**: `serializeDefinitionBundle` has an explicit field exclusion list covering `secretBindings`, `resolvedSecrets`, `authKey`, and any field name matching the `OPENWHISK_MINIMUM_ENGINE_POLICY.forbiddenUserFields` pattern; a unit test fixture asserts that a source action containing secret reference fields produces a bundle with those fields absent.

- **Risk**: Import of a `PackageExportBundle` partially succeeds — some actions are created in OpenWhisk before a later action's visibility check fails, leaving the workspace in an inconsistent state.
  **Mitigation**: `validateImportBundle` runs all checks (scope, collision, visibility) across all bundle members before any write is attempted; `BI-FN-IMPORT-002` is asserted by the contract test and the atomicity resilience test case.

- **Risk**: A bundle exported from a workspace with `web_action_visibility: 'public'` is imported into a workspace whose plan or operator policy disallows public web actions, silently widening exposure.
  **Mitigation**: `checkVisibilityPolicySupport` queries the target workspace's effective capabilities via `resolveWorkspaceEffectiveCapabilities` (already exported from the internal-contracts index); if the plan does not include `data.openwhisk.actions` or the workspace restricts public exposure, the import is rejected with `IMPORT_POLICY_CONFLICT` before any write; a resilience test covers this path explicitly.

- **Risk**: Cross-tenant error responses inadvertently reveal whether a matching definition exists in a foreign workspace (information disclosure).
  **Mitigation**: `buildScopeValidatedExportRequest` and `buildScopeValidatedImportRequest` perform scope assertion before any resource lookup; the error for a scope violation must be indistinguishable from a not-found response at the message level (no `EXISTS_IN_OTHER_TENANT` hints); a contract test asserts the rejection body does not contain foreign `tenantId` or `workspaceId` values.

- **Risk**: The `collisionPolicy` field is misread as implementing an `overwrite` or `merge` strategy in future increments without a formal scope review.
  **Mitigation**: The field is documented as `reject`-only in this increment; the `FunctionImportRequest` schema marks other enum values as invalid for this version; any extension of collision policy options requires a new spec increment.

- **Risk**: `summarizeFunctionsAdminSurface()` route count assertions in existing tests break because four new routes are added to `public-route-catalog.json`.
  **Mitigation**: The existing `tests/unit/functions-admin.test.mjs` and `tests/contracts/public-api.catalog.test.mjs` likely assert minimum counts or specific `operationId` presence rather than exact total counts; if any assertion uses an exact total, it must be updated additivly as part of this task's change plan; the implementation step for `public-route-catalog.json` must verify test stability immediately after the catalog change.

- **Risk**: T05 implementation drifts into sibling scope (versioning, secrets, quota, console backend execution, expanded audit).
  **Mitigation**: The constitution check and scope boundary in the spec are explicit; any artifact change outside the files listed in the change plan requires an explicit scope review before merging.

## Recommended Implementation Sequence

1. Patch `services/internal-contracts/src/domain-model.json` with the five new entity definitions and two new business invariants. Run `npm run test:contracts` to confirm domain model contract tests continue to pass.
2. Patch `services/internal-contracts/src/authorization-model.json` with the `definition_import_context` propagation target and the four new `AUTHZ-FN-IMP-*` denial scenarios. Run the authorization model contract test (`tests/contracts/authorization-model.contract.test.mjs`) to confirm backward compatibility.
3. Patch `services/internal-contracts/src/internal-service-map.json` with the two new `control_api` responsibility entries. Run `tests/contracts/internal-service-map.contract.test.mjs` to confirm.
4. Add the four new route entries to `services/internal-contracts/src/public-route-catalog.json`. Immediately run `npm run test:unit` and `npm run test:contracts` to verify no existing route count assertion breaks; patch any exact-count assertion additivly if needed.
5. Add the four new operations and six new schema components to `apps/control-plane/openapi/families/functions.openapi.json`. Run `npm run generate:public-api` and `npm run validate:openapi` to confirm the OpenAPI artifact remains valid.
6. Extend `services/adapters/src/openwhisk-admin.mjs` with the visibility constant, bundle version constant, serializer, deserializer, collision detector, and visibility policy support checker. Add additive assertions to `tests/adapters/openwhisk-admin.test.mjs`; all existing adapter tests must continue to pass.
7. Create `apps/control-plane/src/functions-import-export.mjs` with all exports listed in the change plan. Write `tests/unit/functions-import-export.test.mjs` covering all valid and invalid input paths. Run `npm run test:unit` to confirm green.
8. Extend `apps/control-plane/src/functions-admin.mjs` with the re-exports and the two compatibility summary extensions. Confirm `tests/unit/functions-admin.test.mjs` continues to pass without modification to existing assertions.
9. Write `tests/contracts/functions-import-export.contract.test.mjs` covering all schema compliance, round-trip visibility, and route catalog assertions. Run `npm run test:contracts` to confirm green.
10. Write `tests/resilience/functions-import-export-authorization.test.mjs` covering all four denial scenarios and the atomicity and idempotency replay cases. Run full test suite and fix any discovered gaps.
11. Add the E2E scaffold stubs in `tests/e2e/`.
12. Run all root validation commands; capture passing output before opening the PR.

## Parallelization Notes

- Steps 1, 2, and 3 (contract JSON patches) can proceed simultaneously once the entity and propagation target shapes are agreed; they are independent of each other.
- Step 4 (route catalog) depends on the entity names from Step 1 but not on Steps 2 or 3.
- Step 5 (OpenAPI) can begin as soon as Step 4 is merged and CI is green; it does not block Steps 6 or 7.
- Step 6 (adapter extension) can begin in parallel with Step 5 as long as the visibility constant names are stable.
- Step 7 (new control-plane module) depends on Step 6 adapter exports being stable but can begin in parallel with Step 5.
- Step 8 (`functions-admin.mjs` extension) depends on Step 7 being merged.
- Steps 9 and 10 (contract and resilience tests) can proceed in parallel once Steps 6, 7, and 8 are merged.
- Step 11 (E2E scaffold) can proceed at any time after Step 5.
- Step 12 (root validation gate) must be the last step before the PR is opened.

## Done Criteria

- An authorized user can export a function definition from their own workspace and the resulting `FunctionExportBundle` includes the correct `web_action_visibility` state when the source is a web action (SC-001).
- An authorized user can export a package definition including all contained actions with independently preserved `web_action_visibility` states (SC-001).
- An authorized user can import a `FunctionImportRequest` or `PackageImportRequest` into a permitted target workspace and the resulting resources reflect the declared `web_action_visibility` states without implicit mutation (SC-001, SC-002).
- A public web action remains public and a private web action remains private after a supported export/import round trip (SC-002).
- Import attempts that cross tenant or workspace boundaries are rejected without exposing hidden definitions (SC-003).
- Invalid imports with name collisions are rejected with `IMPORT_COLLISION` rather than applied partially or silently (SC-004).
- Invalid imports with unsupported or policy-forbidden visibility combinations are rejected with `IMPORT_POLICY_CONFLICT` before any partial write (SC-004).
- Definition exports do not include secrets, activation records, version history references, quota state, or lifecycle features outside this task's scope (SC-005).
- The four new route entries are present in `public-route-catalog.json` and the four new operations are present and valid in `functions.openapi.json` (SC-006).
- `getOpenWhiskCompatibilitySummary()` returns `definitionImportExportSupported: true`.
- `summarizeFunctionsAdminSurface()` includes `function_definition_export` and `function_definition_import` resource kinds.
- All new unit, adapter, contract, and resilience tests pass.
- No existing tests regress across the full `npm run test:unit`, `npm run test:adapters`, and `npm run test:contracts` suites.
- All four `AUTHZ-FN-IMP-*` denial scenarios are present in `authorization-model.json` and are covered by passing resilience tests.
- Scope remains bounded to US-FN-03-T05; no sibling scope (T01/T02/T03/T04/T06) is absorbed.

## Expected Evidence

- New file `apps/control-plane/src/functions-import-export.mjs` present and importable.
- Additive diff to `services/adapters/src/openwhisk-admin.mjs` showing only the visibility constant, bundle version constant, and the four new function exports.
- Additive diff to `apps/control-plane/src/functions-admin.mjs` showing the five new re-exports and the two compatibility summary extensions.
- Additive diff to `apps/control-plane/openapi/families/functions.openapi.json` showing the four new operation objects and six new schema components with no existing paths or schemas removed.
- Additive diffs to `services/internal-contracts/src/authorization-model.json` showing the `definition_import_context` propagation target and four new `AUTHZ-FN-IMP-*` denial scenario entries.
- Additive diff to `services/internal-contracts/src/internal-service-map.json` showing the two new `control_api` responsibility entries.
- Additive diff to `services/internal-contracts/src/public-route-catalog.json` showing the four new route entries.
- Additive diff to `services/internal-contracts/src/domain-model.json` showing five new entity definitions and two new business invariants.
- New test files: `tests/unit/functions-import-export.test.mjs`, `tests/contracts/functions-import-export.contract.test.mjs`, `tests/resilience/functions-import-export-authorization.test.mjs`.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` captured before the PR is opened.
- Authorization model contract test (`tests/contracts/authorization-model.contract.test.mjs`) passes with the four new denial scenario entries.
- A representative export bundle produced by `serializeDefinitionBundle` for a public web action contains `web_action_visibility: 'public'` and no secret, activation, or version-history fields.
- A representative `ImportResult` for the same bundle imported into a compatible workspace contains `web_action_visibility: 'public'` matching the exported state.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Dedicated `functions-import-export.mjs` module instead of adding import/export logic to `functions-admin.mjs` | Import/export concerns — bundle serialization, scope validation, collision detection, visibility policy enforcement — are distinct from the generic function administration surface; mixing them would obscure intent and increase sibling-scope drift risk | A single merged module would make it harder to audit which exports are import/export-specific and which are general function administration, and would conflict with the `console-backend-functions.mjs` separation precedent established by T04 |
| Four new route entries in `public-route-catalog.json` and four new OpenAPI operations | Export and import are distinct product actions with independent authorization semantics, idempotency keys, and request/response schemas; they cannot be expressed as parameters on an existing route without breaking the existing route contract shape | Reusing an existing route path with a mode parameter would require modifying existing route entries, which violates the additive-only constraint for this increment and introduces schema ambiguity |
| `collisionPolicy` field accepting only `'reject'` as a valid value | Making the field present with a single valid value keeps the API forward-compatible without implementing merge or overwrite semantics, which are explicitly out of scope | Omitting the field entirely would force a breaking schema change when collision policies are extended in a future increment; including it with a clear constraint is the lowest-risk forward-compatible design |
| Four new `AUTHZ-FN-IMP-*` denial scenarios in the authorization model | These scenarios correspond directly to functional requirements FR-003, FR-006, FR-007, and FR-009 and must be machine-readable for the resilience test harness to assert them with stable scenario IDs | Omitting them from the model would leave the negative scenario tests without a stable contract anchor and would make requirement traceability between spec, plan, and test harder to maintain across the feature branch lifecycle |
| New `definition_import_context` propagation target | The existing propagation targets do not include `bundle_version` or `import_operation`; without a named target, there is no contract basis for asserting that import-specific fields are required in the propagation chain or for testing their presence in downstream consumers | Leaving import context undocumented in the contract would mean tests asserting scope and bundle integrity have no stable contract anchor, making them brittle against future refactoring |
