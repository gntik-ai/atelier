# Implementation Plan: S3-Compatible Storage Provider Abstraction Layer

**Branch**: `007-storage-provider-abstraction` | **Date**: 2026-03-27 | **Spec**: `specs/007-storage-provider-abstraction/spec.md`
**Task**: US-STO-01-T01
**Input**: Feature specification from `/specs/007-storage-provider-abstraction/spec.md`

## Summary

Implement the first storage-specific platform abstraction for S3-compatible providers without coupling the control plane, provisioning flows, or future bucket/object features to a single backend. The increment is bounded to: storage provider configuration parsing and validation, deterministic provider selection by configuration, a uniform storage provider profile/capability manifest, fail-safe uninitialized behavior, provider introspection for internal/operator consumers, and additive contract/catalog changes that let later storage tasks build on one stable abstraction.

This task does **not** implement tenant storage context (T02), bucket/object CRUD (T03), logical organization (T04), cross-provider error normalization (T05), or multi-provider live verification suites (T06).

## Technical Context

**Language/Version**: Node.js 20+ ESM modules, JSON contract artifacts, Helm YAML
**Primary Dependencies**: existing repo-only helpers and contract readers; no new runtime SDK dependency required for T01
**Storage**: no new database tables; platform-level storage provider configuration is represented as chart/config values and pure control-plane/adapter metadata
**Testing**: root validation scripts, Node `node:test`, OpenAPI/public API generators already present in the repo
**Target Platform**: Helm deployment on Kubernetes/OpenShift
**Performance Goals**: configuration resolution and capability introspection are synchronous and deterministic; no network I/O is required in T01
**Constraints**: keep changes additive, keep scope at the platform/provider-abstraction layer, do not absorb bucket/object operations, do not leak secret material, preserve compatibility with existing `storage` adapter port and storage OpenAPI family
**Scale/Scope**: one new adapter helper module, one new control-plane helper module, additive updates to provider catalog, internal contracts, storage OpenAPI/public route catalog, chart values/schema, and matching tests

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — adapter logic stays under `services/adapters/src/`; control-plane summaries stay under `apps/control-plane/src/`; OpenAPI/public route/catalog changes stay in existing storage artifacts; chart config stays in `charts/in-atelier`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the task introduces only the abstraction contract and provider-selection metadata required by later storage work.
- **Kubernetes and OpenShift Compatibility**: PASS — configuration is expressed through existing chart values/schema patterns and does not assume provider-specific platform features.
- **Quality Gates at the Root**: PASS — all changes remain compatible with `generate:public-api`, `validate:public-api`, `validate:openapi`, `validate:service-map`, chart validation, and unit/contract tests.
- **Documentation as Part of the Change**: PASS — spec, plan, and tasks artifacts are maintained in the feature folder.
- **No Sibling Scope Absorption**: PASS — no bucket CRUD, presigned URL, multipart, quota, or tenant bootstrap implementation is included.

## Project Structure

### Documentation (this feature)

```text
specs/007-storage-provider-abstraction/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   ├── control-plane.openapi.json       ← additive: canonical provider introspection route + schemas
    │   └── families/
    │       └── platform.openapi.json        ← generated: platform family includes storage provider introspection
    └── src/
        └── storage-admin.mjs                ← new: provider introspection/profile summary helpers

services/
├── adapters/
│   └── src/
│       ├── provider-catalog.mjs            ← additive: storage provider abstraction inventory exports
│       └── storage-provider-profile.mjs    ← new: supported provider list, config resolution, capability manifest, fail-safe helpers
└── internal-contracts/
    └── src/
        ├── internal-service-map.json       ← additive: storage abstraction capabilities/responsibilities
        ├── public-route-catalog.json       ← additive: storage provider introspection route entry
        └── authorization-model.json        ← additive: provider introspection projection/negative scenario if needed by route tests

charts/
└── in-atelier/
    ├── values.yaml                         ← additive: platform storage provider selection values
    └── values.schema.json                  ← additive: schema for storage provider selection block

tests/
├── adapters/
│   └── provider-catalog.test.mjs          ← additive: storage abstraction inventory assertions
├── unit/
│   └── storage-admin.test.mjs             ← new: config parsing, capability manifests, fail-safe status, route summary helpers
└── contracts/
    └── storage-provider.contract.test.mjs ← new: OpenAPI + route catalog + service-map assertions
```

## Target Architecture and Flow

### Platform configuration flow

1. Helm values declare a platform-level storage provider selection block with a provider key and optional provider-specific settings.
2. `storage-provider-profile.mjs` resolves the configured provider key into a normalized profile.
3. The normalized profile exposes:
   - provider identity,
   - supported capability manifest,
   - configuration requirements,
   - fail-safe availability status when configuration is missing/invalid.
4. All future storage consumers use the normalized provider profile instead of embedding provider assumptions directly.

### Control-plane/provider introspection flow

1. An authorized platform/operator consumer requests storage provider introspection from the storage family.
2. `apps/control-plane/src/storage-admin.mjs` returns a provider summary derived from `storage-provider-profile.mjs`.
3. The response includes provider identity, readiness state, capability manifest, and known limitations, without exposing secrets.
4. If no valid provider is configured, the surface reports a bounded `storage unavailable` profile instead of undefined behavior.

### Capability-boundary principles

- The abstraction is **platform-level**, not tenant-level.
- Capability manifests may declare future support areas (`bucketOperations`, `objectCrud`, `presignedUrls`, `multipartUpload`, `objectVersioning`) without implementing the operations themselves in T01.
- Provider-specific extensions are intentionally excluded from the common abstraction surface.
- Unknown/misconfigured providers resolve to a typed unavailable state rather than implicit fallback behavior.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/storage-provider-profile.mjs` (new file)

Create a pure helper module exporting:

- `SUPPORTED_STORAGE_PROVIDER_TYPES` — supported provider ids (at least two: `minio`, `ceph-rgw` or `seaweedfs`)
- `DEFAULT_STORAGE_PROVIDER_TYPE` — default provider selection if explicitly allowed by config rules
- `STORAGE_PROVIDER_CAPABILITY_FIELDS` — canonical capability field order
- `STORAGE_PROVIDER_ERROR_CODES` — e.g. `MISSING_PROVIDER_TYPE`, `UNKNOWN_PROVIDER_TYPE`, `AMBIGUOUS_PROVIDER_SELECTION`, `STORAGE_UNAVAILABLE`
- `resolveStorageProviderConfig(input)` — normalize chart/env/config input into `{ providerType, configured, source, options }`
- `buildStorageCapabilityManifest(providerType)` — return the provider’s common-capability manifest
- `buildStorageProviderProfile(input)` — return `{ providerType, status, capabilityManifest, limitations, configuredVia }`
- `buildStorageUnavailableProfile(reason)` — fail-safe profile for missing/invalid config
- `listSupportedStorageProviders()` — metadata inventory for tests/admin summaries

The module remains pure and deterministic. It does not perform network calls or provider SDK initialization in T01.

### `services/adapters/src/provider-catalog.mjs`

Extend provider-catalog exports to surface the storage abstraction metadata explicitly, for example:

- `listStorageProviderProfiles()` or equivalent inventory helper
- additive storage adapter metadata showing the abstraction is configuration-selectable and not single-provider bound

Do not remove or break the existing `storage` baseline adapter entry or provisioning/audit views.

### `apps/control-plane/src/storage-admin.mjs` (new file)

Create a control-plane helper module following the existing repo’s summary/helper pattern. Exports should include:

- `storageProviderIntrospectionRoute` / `listStorageAdminRoutes()`
- `summarizeStorageProviderSupport(input)`
- `summarizeStorageProviderIntrospection(input)`
- `getStorageCompatibilitySummary(input)`

This module consumes `storage-provider-profile.mjs` and internal-contract route helpers, and returns stable operator-facing summaries without implementing HTTP server plumbing.

### `apps/control-plane/openapi/control-plane.openapi.json` → generated `apps/control-plane/openapi/families/platform.openapi.json`

Add one additive platform/operator-facing route for provider introspection, keeping existing bucket routes unchanged. Implement it in the canonical aggregate OpenAPI document so the generated Platform family and route catalog stay aligned. Recommended shape:

- `GET /v1/platform/storage/provider`
- audience restricted to platform-level operators/superadmins
- response schema with `providerType`, `status`, `configuredVia`, `capabilityManifest`, `limitations`, `introspectedAt`
- `503`/`422` compatible failure schema for unconfigured/invalid provider selection when appropriate

Also add schema components:

- `StorageProviderIntrospection`
- `StorageCapabilityManifest`
- `StorageProviderLimitation`

### `services/internal-contracts/src/public-route-catalog.json`

Add the corresponding route catalog entry for the new storage provider introspection operation. Preserve the existing storage family entries for bucket operations.

### `services/internal-contracts/src/internal-service-map.json`

Additive changes only:

- extend the existing `storage` adapter port with abstraction-related capabilities such as `resolve_provider_profile`, `get_capability_manifest`, and `get_provider_status`
- add/extend `control_api` responsibilities so the service map explicitly owns exposing storage provider introspection and bounded fail-safe behavior

### `services/internal-contracts/src/authorization-model.json`

If route/contract tests require explicit authorization/context coverage, add the minimum additive authorization metadata for the provider-introspection route and any negative scenario covering unauthorized platform access. Keep scope minimal and platform-level.

### `charts/in-atelier/values.yaml`

Add a storage provider selection block consistent with the chart’s existing structure. Example fields:

- `storage.provider.type`
- `storage.provider.selectionMode`
- `storage.provider.endpointMode` or equivalent bounded metadata
- `storage.provider.capabilityProfile`

Do not move or rename the existing object-storage secret reference fields; T01 only adds the provider selection metadata needed by the abstraction.

### `charts/in-atelier/values.schema.json`

Add schema validation for the new provider-selection keys:

- require a supported provider type enum
- validate optional selection mode/config structure
- reject malformed provider config earlier in chart validation

### `tests/unit/storage-admin.test.mjs` (new file)

Add unit coverage for:

- supported provider inventory contains at least two provider types
- config resolution succeeds for known provider types
- missing provider type yields a typed unavailable profile / error code
- unknown provider type yields `UNKNOWN_PROVIDER_TYPE`
- capability manifests contain the full canonical field set
- unavailable profile does not expose secret/config internals
- control-plane summaries return stable route/profile metadata

### `tests/adapters/provider-catalog.test.mjs` (additive)

Extend existing assertions so the provider catalog reflects the new storage abstraction inventory exports and keeps storage listed as a first-class adapter surface.

### `tests/contracts/storage-provider.contract.test.mjs` (new file)

Add contract coverage for:

- provider introspection route exists in the storage OpenAPI family
- route is discoverable in `public-route-catalog.json`
- introspection schema includes required capability fields
- service map exposes abstraction-related storage capabilities
- unauthorized or misconfigured route behavior stays bounded by the declared schemas/catalog

## Data Model and Metadata Impact

### New metadata structures

**Storage Provider Profile**
- `providerType`
- `status` (`ready`, `unavailable`, `misconfigured`)
- `configuredVia`
- `capabilityManifest`
- `limitations`

**Storage Capability Manifest**
- `bucketOperations`
- `objectCrud`
- `presignedUrls`
- `multipartUpload`
- `objectVersioning`

**Storage Provider Limitation**
- `code`
- `summary`
- `affectsCapabilities`

### No persistence changes

- no database migrations
- no new Kafka contracts required in T01 if the repo keeps this abstraction purely descriptive at this stage
- no tenant data model changes

## API and UX Considerations

- The new route is platform/operator-facing, not tenant/workspace-facing.
- Existing `/v1/storage/buckets` routes remain untouched.
- The introspection response must be uniform across supported providers.
- Provider-specific details are reduced to metadata and limitations, not backend-specific operational verbs.
- Secrets or raw credential bindings never appear in route responses or helper outputs.

## Testing Strategy

### Unit

`tests/unit/storage-admin.test.mjs`
- provider config normalization
- capability manifest completeness
- unavailable-profile fail-safe behavior
- route summary helper coverage

### Adapter

`tests/adapters/provider-catalog.test.mjs`
- storage catalog still present
- storage abstraction inventory remains additive and separated from other provider consumers

### Contract

`tests/contracts/storage-provider.contract.test.mjs`
- OpenAPI path + operation id
- schema coverage for provider introspection and capability manifest
- public route catalog entry
- service map capability declarations

### Operational validation

From repo root:

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
npm run validate:service-map
npm run validate:deployment-chart
npm run test:unit
npm run test:adapters
npm run test:contracts
```

## Risks and Mitigations

- **Risk**: The abstraction accidentally encodes MinIO semantics as the generic model.
  **Mitigation**: require at least two provider profiles and keep the capability manifest limited to common fields.
- **Risk**: T01 drifts into operational SDK work or live-provider probing.
  **Mitigation**: keep the implementation pure and metadata-driven; live/provider verification belongs to T06.
- **Risk**: Chart config becomes inconsistent with service/profile helpers.
  **Mitigation**: validate through `values.schema.json` and contract/unit tests.
- **Risk**: Provider introspection leaks secret-adjacent information.
  **Mitigation**: expose only normalized provider metadata and capability flags.
- **Risk**: Future tasks need a different abstraction shape.
  **Mitigation**: keep manifests additive and provider-neutral; encode limitations separately from capabilities.

## Recommended Implementation Sequence

1. Add `storage-provider-profile.mjs` with provider inventory, config normalization, capability manifests, and fail-safe helpers.
2. Extend `provider-catalog.mjs` to expose the storage abstraction inventory without breaking existing adapter lists.
3. Add `apps/control-plane/src/storage-admin.mjs` summary/introspection helpers.
4. Patch `control-plane.openapi.json` with the provider introspection route and schemas, then regenerate the platform family artifacts.
5. Patch `public-route-catalog.json`, `internal-service-map.json`, and minimal authorization metadata as needed.
6. Patch `values.yaml` and `values.schema.json` with provider selection metadata.
7. Add unit and contract tests.
8. Run root validation commands and fix any schema/catalog drift.

## Parallelization Notes

- Steps 1 and 2 can proceed together once the provider profile shape is fixed.
- Step 3 depends on Step 1.
- Step 4 can proceed in parallel with Step 5 once the response schema shape is stable.
- Step 6 can proceed independently once the provider-selection keys are agreed.
- Step 7 begins after Steps 1–6 define the final shapes.
- Validation is last.

## Done Criteria

- The repo contains a storage provider abstraction helper with at least two supported provider profiles.
- A normalized capability manifest exists for the active provider profile.
- Misconfigured or unknown providers resolve to a typed unavailable state.
- The control plane exposes a documented provider introspection surface.
- The public route catalog and service map reflect the new storage abstraction surface.
- Chart values/schema support selecting the provider by configuration.
- Unit, adapter, and contract tests pass without regressing existing storage routes.
- Scope remains strictly bounded to T01.

## Expected Evidence

- New file `services/adapters/src/storage-provider-profile.mjs`
- New file `apps/control-plane/src/storage-admin.mjs`
- Additive diff to `services/adapters/src/provider-catalog.mjs`
- Additive diff to `apps/control-plane/openapi/control-plane.openapi.json` plus regenerated `apps/control-plane/openapi/families/platform.openapi.json`
- Additive diffs to `services/internal-contracts/src/public-route-catalog.json`, `internal-service-map.json`, and minimal authorization metadata if required
- Additive diffs to `charts/in-atelier/values.yaml` and `values.schema.json`
- New tests `tests/unit/storage-admin.test.mjs` and `tests/contracts/storage-provider.contract.test.mjs`
- Passing outputs from public API, OpenAPI, service-map, chart, unit, adapter, and contract validations

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Dedicated `storage-provider-profile.mjs` module | Keeps provider selection/capability logic isolated and reusable by later tasks | Hiding the logic inside `provider-catalog.mjs` would blur adapter inventory and active-provider resolution concerns |
| Platform/operator introspection route | Needed to satisfy provider identity/capability introspection without overloading bucket routes | Reusing bucket endpoints would conflate provider metadata with runtime bucket operations |
| At least two provider profiles in metadata | Required to prove the abstraction is not single-provider semantic coupling | A one-provider abstraction would provide no meaningful decoupling signal for later tasks |
