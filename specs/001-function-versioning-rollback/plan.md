# Implementation Plan: Function Versioning and Rollback

**Branch**: `001-function-versioning-rollback` | **Date**: 2026-03-27 | **Spec**: `specs/001-function-versioning-rollback/spec.md`  
**Input**: Feature specification from `/specs/001-function-versioning-rollback/spec.md`

## Summary

Extend the governed `functions` surface so a logical function action can expose immutable version history and accept rollback requests to a prior version. Keep the increment limited to lifecycle contracts, helper modeling, validation rules, and executable tests that match the current monorepo maturity.

## Technical Context

**Language/Version**: Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets  
**Primary Dependencies**: Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules  
**Storage**: repository contract/helper artifacts only in this increment; lifecycle entities are defined as product data model inputs  
**Testing**: root validation scripts plus unit, adapter, and contract test suites  
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners  
**Project Type**: monorepo control-plane/API governance increment for a multi-tenant BaaS platform  
**Performance Goals**: lifecycle routes remain list/detail oriented and rollback stays asynchronous under the existing accepted mutation model  
**Constraints**: preserve tenant/workspace isolation, avoid secrets/quota/audit sibling scope, stay compatible with OpenWhisk-governed function administration, keep changes root-validated  
**Scale/Scope**: one function lifecycle contract extension, one lifecycle data model package, one rollback validation path, and matching tests/documentation

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — OpenAPI stays under `apps/control-plane`, reusable helper logic stays under `services/` and tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the work adds lifecycle contracts, helper logic, and tests without forcing full runtime infrastructure.
- **Kubernetes and OpenShift Compatibility**: PASS — no deployment artifacts or cluster assumptions are introduced by this increment.
- **Quality Gates at the Root**: PASS — the feature can be validated through existing root OpenAPI and test commands.
- **Documentation as Part of the Change**: PASS — spec, plan, research, data model, contract draft, quickstart, and task artifacts are included.

## Project Structure

### Documentation (this feature)

```text
specs/001-function-versioning-rollback/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── function-versioning.openapi.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
├── control-plane/
│   ├── openapi/
│   │   └── families/
│   │       └── functions.openapi.json
│   └── src/
│       └── functions-admin.mjs
└── web-console/
    └── src/

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs
└── internal-contracts/
    └── src/

tests/
├── adapters/
│   └── openwhisk-admin.test.mjs
├── contracts/
│   └── functions-versioning.contract.test.mjs
└── unit/
    └── functions-admin.test.mjs
```

**Structure Decision**: Keep the implementation anchored in the existing functions API family, reusable OpenWhisk helper module, and executable test suites. Do not introduce new top-level folders or speculative runtime services in this task.

## Target Architecture and Flow

1. The governed function action remains the logical product resource.
2. Each publish creates an immutable function version record linked to that logical action.
3. The action view exposes which version is active and whether rollback is currently available.
4. New version list/detail routes expose lifecycle history within the caller’s tenant/workspace scope.
5. A rollback mutation accepts a target version identifier and follows the same accepted/queued mutation semantics already used by governed function updates.
6. The OpenWhisk adapter helper normalizes version metadata and validates rollback guardrails without exposing native OpenWhisk admin primitives.

## Artifact-by-Artifact Change Plan

### `apps/control-plane/openapi/families/functions.openapi.json`

- Add lifecycle parameters/schemas for function version identifiers.
- Add `GET /v1/functions/actions/{resourceId}/versions`.
- Add `GET /v1/functions/actions/{resourceId}/versions/{versionId}`.
- Add `POST /v1/functions/actions/{resourceId}/rollback`.
- Extend `FunctionAction` with minimal lifecycle summary fields (`activeVersionId`, `versionCount`, `rollbackAvailable`, optional `latestRollbackAt`).
- Add new response/request schemas for version collection/detail and rollback acceptance.

### `apps/control-plane/src/functions-admin.mjs`

- Expose lifecycle routes through the public route helpers.
- Extend the summarized functions surface so version and rollback capabilities are discoverable.
- Add helper exports for version/rollback contracts if needed by tests.
- Keep compatibility summary aligned with the new lifecycle surface.

### `services/adapters/src/openwhisk-admin.mjs`

- Add immutable version metadata builders/normalizers for governed function actions.
- Add rollback request validation logic covering scope, eligibility, and invalid-target scenarios.
- Add helper projections for function version collection/detail and rollback accepted responses.
- Preserve current tenant/workspace naming and isolation guarantees.

### `services/internal-contracts/src/`

- Regenerate or align any derived contract helpers required after updating the public OpenAPI family.
- Keep route lookups and contract lookups synchronized with the updated `functions` family.

### `tests/unit/functions-admin.test.mjs`

- Assert the new lifecycle route operation IDs exist.
- Assert summarized functions admin surface includes version listing/detail and rollback capabilities.
- Assert compatibility helpers still advertise governed OpenWhisk lifecycle controls.

### `tests/adapters/openwhisk-admin.test.mjs`

- Cover version metadata normalization and rollback validation rules.
- Add negative-path tests for already-active targets, missing prior versions, and cross-scope or unauthorized rollback inputs.
- Ensure current guardrails for tenant isolation remain intact after lifecycle additions.

### `tests/contracts/functions-versioning.contract.test.mjs`

- Validate the updated OpenAPI family exposes the version/rollback endpoints and schemas.
- Assert the rollback mutation uses the accepted mutation envelope and required headers.
- Assert version routes stay under `/v1/functions/actions/{resourceId}`.

## Data Model and Metadata Impact

- Introduce `FunctionActionLifecycle`, `FunctionVersion`, `FunctionVersionTimelineEntry`, and `RollbackRequest` as the governing lifecycle entities for this task.
- Extend the logical function action representation with active-version and rollback-availability metadata.
- Preserve immutable snapshots for `source`, `execution`, and `activationPolicy` at version level.
- Record rollback relationships so future audit work can explain restore provenance.

## API and UX Considerations

- Public API remains the primary integration contract for this increment.
- Console-facing behavior is represented through lifecycle list/detail/rollback routes rather than a new UI implementation in this task.
- Read visibility for version history should align with existing function-read audiences; rollback visibility should align with governed mutation audiences.
- Empty states must be representable: no prior versions, only one version, rollback unavailable, target already active.

## Testing Strategy

### Unit

- Route exposure and lifecycle surface summary checks in `tests/unit/functions-admin.test.mjs`.

### Adapter

- Validation and normalization tests for version metadata and rollback semantics in `tests/adapters/openwhisk-admin.test.mjs`.

### Contract

- OpenAPI contract assertions for new routes, schemas, and accepted mutation semantics in `tests/contracts/functions-versioning.contract.test.mjs`.

### E2E

- No new runtime E2E environment in this task. Console expectations are represented through contract and helper behavior only.

### Operational validation

- `npm run validate:public-api`
- `npm run validate:openapi`
- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`
- `npm run lint`

## Risks and Mitigations

- **Risk**: Rollback semantics become ambiguous if timeline and active-version state are mixed.  
  **Mitigation**: Keep immutable version records and explicit rollback request/acceptance modeling.

- **Risk**: The contract grows too wide and pulls in sibling features like secrets or quotas.  
  **Mitigation**: Limit scope to lifecycle metadata, version list/detail, and rollback only.

- **Risk**: Existing tests assume the older functions surface and miss new lifecycle routes.  
  **Mitigation**: Update unit and contract tests to assert the expanded route map explicitly.

- **Risk**: Rollback visibility or targeting could leak cross-workspace lifecycle metadata.  
  **Mitigation**: Reuse existing tenant/workspace context validation patterns in the OpenWhisk helper.

## Recommended Implementation Sequence

1. Finalize lifecycle design artifacts (`research.md`, `data-model.md`, contract draft, quickstart).
2. Extend the OpenAPI family with version and rollback schemas/routes.
3. Update `functions-admin.mjs` to surface lifecycle capabilities.
4. Update `openwhisk-admin.mjs` with version/rollback normalization and validation helpers.
5. Add/extend unit, adapter, and contract tests.
6. Run root validation commands and fix any contract/test drift.

## Parallelization Notes

- OpenAPI contract updates and helper-module updates can begin in parallel once lifecycle entities are fixed.
- Contract tests should start after route/schema names are stabilized.
- No sibling task work should proceed in this branch until T01 validation passes.

## Done Criteria

- The repo exposes governed version list/detail and rollback routes for function actions in the `functions` API family.
- The functions admin helper and OpenWhisk adapter helper model lifecycle metadata consistently.
- Automated tests cover the new lifecycle surface and negative rollback paths.
- Root validation commands pass without breaking existing governed functions behavior.
- Scope remains bounded to `US-FN-03-T01`.

## Expected Evidence

- Updated OpenAPI family diff.
- Updated helper-module/test diffs.
- Passing validation/test command output recorded before PR.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Add explicit version subresources | Lifecycle history needs list/detail semantics separate from the base action | Embedding all history in `FunctionAction` would make the API harder to page, test, and evolve |
| Add rollback acceptance contract | Governed function mutations already use accepted asynchronous semantics | A synchronous rollback response would diverge from the current control-plane mutation model |
