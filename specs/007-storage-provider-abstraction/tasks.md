# Tasks: S3-Compatible Storage Provider Abstraction Layer

**Input**: `specs/007-storage-provider-abstraction/spec.md`, `specs/007-storage-provider-abstraction/plan.md`
**Task**: US-STO-01-T01
**Branch**: `007-storage-provider-abstraction`

## Sequential execution plan

- [x] T001 Write `specs/007-storage-provider-abstraction/spec.md` with the bounded T01 feature specification.
- [x] T002 Write `specs/007-storage-provider-abstraction/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/007-storage-provider-abstraction/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-provider-profile.mjs` with supported provider inventory, provider-type normalization, capability manifest helpers, fail-safe unavailable profiles, and compatibility summaries.
- [x] T011 Extend `services/adapters/src/provider-catalog.mjs` to export storage provider profiles and compatibility helpers without regressing existing adapter views.
- [x] T012 Create `apps/control-plane/src/storage-admin.mjs` to expose storage-provider introspection helpers backed by the new adapter profile module.
- [x] T013 Update `apps/control-plane/openapi/control-plane.openapi.json` so the generated Platform family publishes `GET /v1/platform/storage/provider` plus `StorageCapabilityManifest`, `StorageProviderLimitation`, and `StorageProviderIntrospection` schemas.
- [x] T014 Regenerate `services/internal-contracts/src/public-route-catalog.json` so `getStorageProviderIntrospection` is discoverable in the generated public API catalog.
- [x] T015 Update `services/internal-contracts/src/internal-service-map.json` to add storage abstraction capabilities (`resolve_provider_profile`, `get_capability_manifest`, `get_provider_status`) and the control-plane responsibility for provider introspection.
- [x] T016 Update `charts/in-atelier/values.yaml` to declare `storage.config.inline.providerType` and `storage.config.inline.providerSelectionMode` for configuration-based provider selection.
- [x] T017 Add `tests/unit/storage-admin.test.mjs` for provider normalization, fail-safe behavior, and route/helper summaries.
- [x] T018 Extend `tests/adapters/provider-catalog.test.mjs` to cover supported storage providers and provider compatibility summaries.
- [x] T019 Add `tests/contracts/storage-provider.contract.test.mjs` for OpenAPI, route-catalog, and internal service-map coverage.

## Validation checklist

- [x] T020 Run `npm run generate:public-api`.
- [x] T021 Run `npm run validate:public-api`.
- [x] T022 Run `npm run validate:openapi`.
- [x] T023 Run `npm run validate:service-map`.
- [x] T024 Run `npm run validate:deployment-chart`.
- [x] T025 Run `npm run test:unit`.
- [x] T026 Run `npm run test:adapters`.
- [x] T027 Run `npm run test:contracts`.

## Delivery checklist

- [ ] T030 Review git diff for T01 scope compliance.
- [ ] T031 Commit the feature branch changes for `US-STO-01-T01`.
- [ ] T032 Push `007-storage-provider-abstraction` to origin.
- [ ] T033 Open a PR to `main`.
- [ ] T034 Monitor CI, fix failures if needed, and merge when green.
