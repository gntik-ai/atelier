# Tasks: Storage Logical Organization by Tenant, Workspace, and Application

**Input**: `specs/010-storage-logical-organization/spec.md`, `specs/010-storage-logical-organization/plan.md`  
**Task**: US-STO-01-T04  
**Branch**: `010-storage-logical-organization`

## Sequential execution plan

- [x] T001 Write `specs/010-storage-logical-organization/spec.md` with the bounded T04 feature specification.
- [x] T002 Write `specs/010-storage-logical-organization/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/010-storage-logical-organization/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-logical-organization.mjs` with deterministic tenant/workspace/application layout helpers, reserved prefixes, and object placement metadata.
- [x] T011 Extend `services/adapters/src/storage-bucket-object-ops.mjs` to attach organization metadata to bucket/object contracts while preserving backward compatibility.
- [x] T012 Extend `services/adapters/src/provider-catalog.mjs` to export logical organization helper surfaces.
- [x] T013 Extend `apps/control-plane/src/storage-admin.mjs` to expose logical organization previews and enriched bucket/object metadata.
- [x] T014 Update `services/internal-contracts/src/internal-service-map.json` to document storage logical-organization responsibilities and adapter capabilities.
- [x] T015 Update `apps/control-plane/openapi/control-plane.openapi.json` to publish additive storage organization schemas/fields without changing route inventory.
- [x] T016 Regenerate public API artifacts so `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/*.openapi.json`, and `docs/reference/api/*.md` reflect the enriched storage schemas.
- [x] T017 Extend `tests/unit/storage-admin.test.mjs` to cover deterministic layout previews, workspace-shared vs application roots, and enriched object metadata.
- [x] T018 Extend `tests/adapters/provider-catalog.test.mjs` to cover logical organization helper exports and reserved-prefix handling.
- [x] T019 Extend `tests/contracts/storage-provider.contract.test.mjs` to cover additive OpenAPI schemas and storage organization contract metadata.

## Validation checklist

- [x] T030 Run `npm run generate:public-api`.
- [x] T031 Run `npm run validate:public-api`.
- [x] T032 Run `npm run validate:openapi`.
- [x] T033 Run `npm run validate:service-map`.
- [x] T034 Run `npm run lint:md`.
- [x] T035 Run `npm run test:unit`.
- [x] T036 Run `npm run test:adapters`.
- [x] T037 Run `npm run test:contracts`.

## Delivery checklist

- [ ] T040 Review git diff for T04 scope compliance.
- [ ] T041 Commit the feature branch changes for `US-STO-01-T04`.
- [ ] T042 Push `010-storage-logical-organization` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
