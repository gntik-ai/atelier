# Quickstart: Function Versioning and Rollback

## Purpose

Use this package when implementing or reviewing governed OpenWhisk function lifecycle work for `US-FN-03-T01`.

## Read in this order

1. `specs/001-function-versioning-rollback/spec.md`
2. `specs/001-function-versioning-rollback/plan.md`
3. `specs/001-function-versioning-rollback/research.md`
4. `specs/001-function-versioning-rollback/data-model.md`
5. `specs/001-function-versioning-rollback/contracts/function-versioning.openapi.md`
6. `apps/control-plane/openapi/families/functions.openapi.json`
7. `apps/control-plane/src/functions-admin.mjs`
8. `services/adapters/src/openwhisk-admin.mjs`

## Implementation rules downstream work must inherit

- Every deployable function change creates a recoverable immutable version record.
- Exactly one version may be active for a logical function action at a time.
- Rollback targets must remain inside the same tenant and workspace scope as the logical action.
- Rollback must preserve lifecycle history rather than erasing newer versions.
- Read visibility for version history and mutation visibility for rollback must respect the governed functions audience model.
- This task must not introduce secrets, quotas, import/export, or broader audit/reporting features reserved for sibling tasks.

## Minimal validation flow

Run from the repository root after implementation:

```bash
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

## Expected implementation evidence

- OpenAPI family updated with versioning and rollback routes/schemas.
- Functions admin helper exposes the new lifecycle surface.
- OpenWhisk adapter helper models version and rollback metadata without leaking cross-tenant access.
- Automated tests cover lifecycle surface summary, contract exposure, and rollback validation rules.
