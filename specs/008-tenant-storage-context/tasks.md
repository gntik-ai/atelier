# Tasks: Tenant Storage Context and Lifecycle Bootstrap

**Input**: `specs/008-tenant-storage-context/spec.md`, `specs/008-tenant-storage-context/plan.md`
**Task**: US-STO-01-T02
**Branch**: `008-tenant-storage-context`

## Sequential execution plan

- [x] T001 Write `specs/008-tenant-storage-context/spec.md` with the bounded T02 feature specification.
- [x] T002 Write `specs/008-tenant-storage-context/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/008-tenant-storage-context/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-tenant-context.mjs` with deterministic namespace derivation, plan-aware quota assignment, lifecycle/provisioning status, secret-safe introspection, rotation previews, event builders, and workspace bootstrap previews.
- [x] T011 Extend `services/adapters/src/provider-catalog.mjs` to export tenant storage helper surfaces without regressing existing adapter views.
- [x] T012 Extend `apps/control-plane/src/storage-admin.mjs` to expose tenant storage summaries, route lookups, rotation previews, event builders, and workspace bootstrap previews.
- [x] T013 Extend `apps/control-plane/src/tenant-management.mjs` so tenant-management summaries can optionally project tenant storage context state.
- [x] T014 Update `services/internal-contracts/src/index.mjs` so `resolveInitialTenantBootstrap()` can gate `default_storage_bucket` on an explicitly supplied tenant storage context.
- [x] T015 Update `services/internal-contracts/src/domain-model.json` to add canonical quota metrics `tenant.storage.bytes.max` and `tenant.storage.buckets.max`.
- [x] T016 Update `services/internal-contracts/src/internal-service-map.json` to add tenant-storage-context capabilities and owning-service responsibilities.
- [x] T017 Update `services/internal-contracts/src/public-api-taxonomy.json` so `tenant_storage_context` is a first-class tenant-scoped resource type.
- [x] T018 Update `apps/control-plane/openapi/control-plane.openapi.json` so the generated tenant family publishes `GET /v1/tenants/{tenantId}/storage-context`, `POST /v1/tenants/{tenantId}/storage-context/credential-rotations`, and their additive schemas.
- [x] T019 Regenerate public API artifacts so `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/*.openapi.json`, and `docs/reference/api/*.md` reflect the new tenant storage routes.
- [x] T020 Update `charts/in-falcone/values.yaml` so the bootstrap governance quota catalog mirrors the canonical domain-model quota policy catalog after the new storage metrics were added.
- [x] T021 Extend `tests/unit/storage-admin.test.mjs` to cover tenant storage summaries, safe introspection, credential rotation, and workspace bootstrap gating.
- [x] T022 Extend `tests/unit/tenant-bootstrap.test.mjs` to cover `dependency_wait`, `blocked`, and restored `pending` behavior for `default_storage_bucket`.
- [x] T023 Extend `tests/adapters/provider-catalog.test.mjs` to cover tenant storage helper exports and secret-safe summaries.
- [x] T024 Extend `tests/contracts/storage-provider.contract.test.mjs` to cover additive OpenAPI schemas, route-catalog entries, and service-map capabilities for tenant storage context operations.

## Validation checklist

- [x] T030 Run `npm run generate:public-api`.
- [x] T031 Run `npm run validate:public-api`.
- [x] T032 Run `npm run validate:openapi`.
- [x] T033 Run `npm run validate:service-map`.
- [x] T034 Run `npm run validate:deployment-chart`.
- [x] T035 Run `npm run test:unit`.
- [x] T036 Run `npm run test:adapters`.
- [x] T037 Run `npm run test:contracts`.

## Delivery checklist

- [ ] T040 Review git diff for T02 scope compliance.
- [ ] T041 Commit the feature branch changes for `US-STO-01-T02`.
- [ ] T042 Push `008-tenant-storage-context` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
