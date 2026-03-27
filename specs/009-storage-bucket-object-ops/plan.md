# Implementation Plan: Storage Bucket CRUD and Object Operations

**Branch**: `009-storage-bucket-object-ops` | **Date**: 2026-03-27 | **Spec**: `specs/009-storage-bucket-object-ops/spec.md`
**Task**: US-STO-01-T03
**Input**: Feature specification from `/specs/009-storage-bucket-object-ops/spec.md`

## Summary

Implement the bounded bucket/object operation layer for the storage family on top of the existing provider abstraction (`T01`) and tenant storage context (`T02`). This increment extends the storage public contract with bucket listing and deletion, object upload/download/list/delete/metadata routes, and deterministic helper modules that model bucket/object state, scope binding, quota-aware outcomes, and audit/event context without coupling the public API to one provider.

The implementation remains additive and intentionally limited. It does **not** introduce logical prefix organization (`T04`), final provider-error normalization (`T05`), or multi-provider verification suites (`T06`). Presigned URLs, multipart orchestration, and lifecycle/versioning controls remain future work.

## Technical Context

**Language/Version**: Node.js 20+ ESM modules, JSON OpenAPI/contracts, Markdown docs  
**Primary Dependencies**: existing repo-local helpers in `services/adapters`, `services/internal-contracts`, `apps/control-plane`, and public-artifact generation scripts  
**Storage**: no new persistence engine; deterministic bucket/object contract helpers model the control-plane surface while keeping provider-specific execution behind adapter ports  
**Testing**: root validation scripts, `node:test`, OpenAPI validation, public API generation/validation, service-map validation  
**Target Platform**: Helm-managed Kubernetes/OpenShift deployment with public contract surfaced from `apps/control-plane/openapi`  
**Project Type**: monorepo control-plane + adapter contracts  
**Performance Goals**: bounded synchronous contract/helper generation with deterministic pagination and no live provider I/O inside the helper layer  
**Constraints**: additive-only change set; preserve provider-agnostic public semantics; enforce tenant/workspace isolation and quota-aware outcomes; do not leak secrets or provider-private internals  
**Scale/Scope**: one new helper module, additive updates to storage admin/provider catalog/service-map/taxonomy/OpenAPI/tests/docs, and regenerated public API artifacts

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — adapter-facing bucket/object helper logic stays in `services/adapters`; public-contract exposure stays in `apps/control-plane`; shared metadata stays in `services/internal-contracts`; generated docs remain generated.
- **Incremental Delivery First**: PASS — only the bounded bucket/object CRUD layer for T03 is added.
- **Kubernetes and OpenShift Compatibility**: PASS — no platform-specific runtime assumptions are introduced.
- **Quality Gates at the Root**: PASS — run public API generation/validation, service-map validation, OpenAPI validation, markdown linting, and targeted unit/adapter/contract tests.
- **Documentation as Part of the Change**: PASS — spec/plan/tasks and generated public API docs are updated in the same change.
- **No Sibling Scope Absorption**: PASS — no logical prefix strategy, provider-error taxonomy finalization, or multi-provider execution matrix is implemented here.

## Project Structure

### Documentation (this feature)

```text
specs/009-storage-bucket-object-ops/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   ├── control-plane.openapi.json                  ← additive: storage bucket/object routes + schemas
    │   └── families/
    │       ├── storage.openapi.json                    ← generated
    │       └── *.openapi.json                          ← regenerated as needed
    └── src/
        └── storage-admin.mjs                           ← additive: bucket/object route helpers and previews

services/
├── adapters/
│   └── src/
│       ├── provider-catalog.mjs                        ← additive: export bucket/object helper surfaces
│       ├── storage-bucket-object-ops.mjs               ← new: deterministic bucket/object contract helpers
│       ├── storage-provider-profile.mjs                ← unchanged dependency
│       └── storage-tenant-context.mjs                  ← unchanged dependency consumed by new helpers
└── internal-contracts/
    └── src/
        ├── internal-service-map.json                   ← additive: bucket/object adapter capabilities + service responsibilities
        ├── public-api-taxonomy.json                    ← additive: object resource taxonomy entry
        └── public-route-catalog.json                   ← generated: new storage routes discoverable

docs/
└── reference/
    ├── api/                                            ← generated family/reference docs
    └── architecture/public-api-surface.md              ← generated route inventory summary

tests/
├── adapters/
│   └── provider-catalog.test.mjs                       ← additive: bucket/object helper export coverage
├── contracts/
│   └── storage-provider.contract.test.mjs              ← additive: OpenAPI/route/service-map coverage for T03 routes
└── unit/
    └── storage-admin.test.mjs                          ← additive: storage route lookup, previews, scope, and deletion rules
```

## Target Architecture and Flow

### Bucket contract flow

1. Resolve the active storage provider profile from `storage-provider-profile.mjs`.
2. Resolve or consume the active tenant storage context from `storage-tenant-context.mjs`.
3. Build a deterministic bucket contract bound to tenant + workspace + provider/namespace.
4. Surface create/list/get/delete contract behavior through `storage-admin.mjs` and the public OpenAPI surface.
5. Preserve quota, scope, and audit metadata in the contract shape without exposing provider secrets.

### Object contract flow

1. Start from an authorized bucket contract.
2. Build deterministic object contracts keyed by bucket + object key.
3. Expose upload/download/list/delete/metadata route summaries through the storage family.
4. Return bounded, scope-safe object metadata and download envelopes while leaving provider-specific execution abstracted behind the storage adapter port.

### Governance flow

1. Public contract routes remain workspace-scoped inside the storage family.
2. Tenant storage context remains the prerequisite for bucket/object activity.
3. Storage adapter capabilities expand to include bucket/object CRUD semantics.
4. Audit/event previews remain additive and correlation-safe for later execution wiring.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/storage-bucket-object-ops.mjs` (new file)

Create a pure helper module that:

- validates/bounds bucket names and object keys for the common S3-compatible baseline used by the public contract
- builds deterministic bucket records tied to tenant/workspace/storage-context scope
- builds bucket collection responses with `PageInfo`
- builds deterministic object records and collection responses
- previews bucket deletion eligibility (empty vs non-empty/protected)
- previews object upload/download/delete and metadata responses in a provider-agnostic way
- emits bounded audit/event envelopes for bucket/object operations

The module remains synchronous and performs no live provider I/O.

### `services/adapters/src/provider-catalog.mjs`

Extend the catalog to export the new bucket/object helper functions so downstream tests and control-plane helpers consume one stable adapter-facing surface.

### `apps/control-plane/src/storage-admin.mjs`

Extend the storage helper surface to:

- expose new bucket/object operation routes from the public route catalog
- summarize bucket/object compatibility including route IDs
- preview bucket records, bucket collections, bucket deletion outcomes, object records, object collections, metadata, downloads, and deletes
- keep provider and tenant-context helper behavior backward compatible

### `services/internal-contracts/src/internal-service-map.json`

Additive changes only:

- extend `control_api` responsibilities to cover storage bucket inventory/detail/delete and object upload/download/list/delete/metadata
- extend `provisioning_orchestrator` responsibilities to coordinate these requests without bypassing the storage adapter boundary
- extend the `storage` adapter port with capabilities such as `list_buckets`, `get_bucket_metadata`, `delete_bucket`, `put_object`, `get_object`, `get_object_metadata`, `list_objects`, and `delete_object`

### `services/internal-contracts/src/public-api-taxonomy.json`

Add a workspace-scoped object resource taxonomy entry for the storage family (`bucket_object`) while preserving existing bucket taxonomy.

### `apps/control-plane/openapi/control-plane.openapi.json`

Add additive storage routes and schemas:

- `GET /v1/storage/buckets` → list buckets
- `DELETE /v1/storage/buckets/{resourceId}` → delete bucket
- `GET /v1/storage/buckets/{resourceId}/objects` → list objects in a bucket
- `PUT /v1/storage/buckets/{resourceId}/objects/{objectKey}` → upload/replace one object
- `GET /v1/storage/buckets/{resourceId}/objects/{objectKey}` → download one object
- `DELETE /v1/storage/buckets/{resourceId}/objects/{objectKey}` → delete one object
- `GET /v1/storage/buckets/{resourceId}/objects/{objectKey}/metadata` → fetch object metadata only

New schemas should include bucket collections, object write/download/metadata contracts, object collections, and the `ObjectKey` parameter.

### Generated artifacts

Regenerate the route catalog, family OpenAPI slices, and reference docs with `npm run generate:public-api` so all published artifacts reflect the new routes.

### Tests

Add or extend coverage for:

- route lookup and previews in `storage-admin.mjs`
- provider-catalog exports for bucket/object helpers
- deletion gating for non-empty buckets
- object metadata/download/list shape and scope binding
- OpenAPI route existence, resource taxonomy, route-catalog discoverability, and service-map capability coverage

## Validation Plan

Run the bounded quality gates for this increment:

- `npm run generate:public-api`
- `npm run validate:public-api`
- `npm run validate:openapi`
- `npm run validate:service-map`
- `npm run lint:md -- specs/009-storage-bucket-object-ops/*.md specs/009-storage-bucket-object-ops/checklists/*.md docs/reference/api/*.md docs/reference/architecture/public-api-surface.md` *(fallback to full `npm run lint:md` if the scoped invocation is unsupported)*
- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`

## Delivery Plan

1. Review the diff for strict T03 scope compliance.
2. Commit the `009-storage-bucket-object-ops` branch changes.
3. Push the branch to origin.
4. Open a PR to `main`.
5. Monitor CI, fix regressions if needed, and merge once green.

## Task Status

This plan describes the implementation and delivery work for `US-STO-01-T03`. Local execution, validation, and delivery follow the checklist in `tasks.md`.
