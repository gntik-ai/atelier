# Tasks: Storage Bucket CRUD and Object Operations

**Input**: `specs/009-storage-bucket-object-ops/spec.md`, `specs/009-storage-bucket-object-ops/plan.md`  
**Task**: US-STO-01-T03  
**Branch**: `009-storage-bucket-object-ops`

## Sequential execution plan

- [x] T001 Write `specs/009-storage-bucket-object-ops/spec.md` with the bounded T03 feature specification.
- [x] T002 Write `specs/009-storage-bucket-object-ops/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/009-storage-bucket-object-ops/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-bucket-object-ops.mjs` with deterministic bucket/object contract helpers, deletion gating, list builders, and audit/event previews.
- [x] T011 Extend `services/adapters/src/provider-catalog.mjs` to export bucket/object helper surfaces.
- [x] T012 Extend `apps/control-plane/src/storage-admin.mjs` to expose route lookups and previews for bucket/object CRUD behavior.
- [x] T013 Update `services/internal-contracts/src/internal-service-map.json` to add storage bucket/object responsibilities and adapter capabilities.
- [x] T014 Update `services/internal-contracts/src/public-api-taxonomy.json` to add a storage object resource taxonomy entry.
- [x] T015 Update `apps/control-plane/openapi/control-plane.openapi.json` to publish additive bucket/object routes, parameters, and schemas.
- [x] T016 Regenerate public API artifacts so `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/*.openapi.json`, and `docs/reference/api/*.md` reflect the new storage routes.
- [x] T017 Extend `tests/unit/storage-admin.test.mjs` to cover bucket/object route discovery, previews, deletion gating, and metadata/download flows.
- [x] T018 Extend `tests/adapters/provider-catalog.test.mjs` to cover bucket/object helper exports and scope-safe contract builders.
- [x] T019 Extend `tests/contracts/storage-provider.contract.test.mjs` to cover additive OpenAPI schemas, route-catalog entries, resource taxonomy, and service-map capabilities for T03.

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

- [x] T040 Review git diff for T03 scope compliance.
- [ ] T041 Commit the feature branch changes for `US-STO-01-T03`.
- [ ] T042 Push `009-storage-bucket-object-ops` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
