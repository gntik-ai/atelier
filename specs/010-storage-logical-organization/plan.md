# Implementation Plan: Storage Logical Organization by Tenant, Workspace, and Application

**Branch**: `010-storage-logical-organization` | **Date**: 2026-03-27 | **Spec**: `specs/010-storage-logical-organization/spec.md`  
**Task**: US-STO-01-T04  
**Input**: Feature specification from `/specs/010-storage-logical-organization/spec.md`

## Summary

Implement the bounded logical-organization layer for the storage family on top of the existing provider abstraction (`T01`), tenant storage context (`T02`), and bucket/object CRUD surface (`T03`). This increment introduces one canonical tenant → workspace → application organization strategy, explicit workspace-shared and application-bound prefixes, reserved platform prefixes for future presigned/multipart/event flows, and additive contract metadata on bucket/object surfaces so quota, audit, and later policy/event work can reuse one stable model.

The implementation remains additive and intentionally limited. It does **not** normalize provider-native runtime errors (`T05`), run the same suite across multiple providers (`T06`), or deliver full presigned/multipart/event functionality. It only defines and exposes the logical organization model that those future capabilities will consume.

## Technical Context

**Language/Version**: Node.js 20+ ESM modules, JSON OpenAPI/contracts, Markdown docs  
**Primary Dependencies**: existing storage helpers in `services/adapters`, public contract helpers in `services/internal-contracts`, control-plane helper surface in `apps/control-plane`, and public API generation scripts  
**Storage**: no new persistence engine; deterministic helper logic models logical organization and object placement without live provider I/O  
**Testing**: `node:test`, public API generation/validation, OpenAPI validation, service-map validation, markdown linting  
**Target Platform**: Helm-managed Kubernetes/OpenShift deployment with public contract published from `apps/control-plane/openapi`  
**Project Type**: monorepo control-plane + adapter contracts  
**Performance Goals**: synchronous deterministic organization/path resolution with no backend calls and stable outputs for repeated inputs  
**Constraints**: additive-only change set; preserve provider-agnostic semantics; keep tenant/workspace isolation explicit; use stable IDs for canonical roots; avoid leaking provider secrets or topology  
**Scale/Scope**: one new helper module, additive extensions to existing storage bucket/object helpers, additive OpenAPI/schema/service-map updates, regenerated public artifacts, and focused tests

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — logical organization helpers live in `services/adapters`; public contract exposure stays in `apps/control-plane`; shared route/resource metadata stays in `services/internal-contracts`.
- **Incremental Delivery First**: PASS — only T04 logical organization is added.
- **Kubernetes and OpenShift Compatibility**: PASS — no runtime or deployment-specific assumptions are introduced.
- **Quality Gates at the Root**: PASS — run generation, validation, and targeted test suites from the repo root.
- **Documentation as Part of the Change**: PASS — spec/plan/tasks and regenerated docs travel with code changes.
- **No Sibling Scope Absorption**: PASS — no error-taxonomy finalization or multi-provider matrix execution is added here.

## Project Structure

### Documentation (this feature)

```text
specs/010-storage-logical-organization/
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
    │   ├── control-plane.openapi.json                  ← additive: organization schemas/fields on storage contracts
    │   └── families/
    │       ├── storage.openapi.json                    ← regenerated
    │       └── *.openapi.json                          ← regenerated as needed
    └── src/
        └── storage-admin.mjs                           ← additive: organization previews and passthroughs

services/
├── adapters/
│   └── src/
│       ├── provider-catalog.mjs                        ← additive: export organization helpers
│       ├── storage-logical-organization.mjs            ← new: canonical tenant/workspace/application layout helpers
│       ├── storage-bucket-object-ops.mjs               ← additive: attach organization metadata to bucket/object contracts
│       ├── storage-provider-profile.mjs                ← unchanged dependency
│       └── storage-tenant-context.mjs                  ← unchanged dependency consumed by new helpers
└── internal-contracts/
    └── src/
        ├── internal-service-map.json                   ← additive: logical organization capabilities/responsibilities
        ├── public-api-taxonomy.json                    ← no new family; keep storage taxonomy compatible, only additive summary changes if needed
        └── public-route-catalog.json                   ← regenerated if contract descriptions shift

tests/
├── adapters/
│   └── provider-catalog.test.mjs                       ← additive: exported organization helper coverage
├── contracts/
│   └── storage-provider.contract.test.mjs              ← additive: schema/contract coverage for organization fields
└── unit/
    └── storage-admin.test.mjs                          ← additive: deterministic layout previews and object organization metadata
```

## Target Architecture and Flow

### Logical organization flow

1. Resolve the active tenant storage context from `storage-tenant-context.mjs`.
2. Derive one canonical tenant root and workspace root using stable identifiers.
3. Publish two user-content roots beneath the workspace: a workspace-shared root and an application root template.
4. Reserve dedicated platform-managed prefixes for presigned, multipart, and event-oriented internal flows.
5. Return organization metadata that stays provider-agnostic and reusable by bucket/object helpers, quota attribution, audit/event envelopes, and later sibling features.

### Object placement flow

1. Start from an authorized bucket contract.
2. If application context is present, resolve the application-owned prefix under the workspace root; otherwise resolve the workspace-shared prefix.
3. Join the caller-visible object key to the resolved logical root to produce a canonical logical path while preserving the public `objectKey` field.
4. Attach organization metadata to object contracts so downstream policy, quota, audit, and event logic has stable attribution inputs.

### Governance flow

1. Bucket summaries expose the governing organization strategy for the workspace bucket.
2. Object metadata exposes the concrete logical placement for the object.
3. Reserved prefixes remain visible as managed keyspace but unavailable for normal user-controlled content.
4. The service-map documents that the storage adapter can resolve logical organization and object placement without committing to one provider-native implementation.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/storage-logical-organization.mjs` (new file)

Create a pure helper module that:

- resolves a canonical organization strategy ID and layout version
- builds deterministic tenant/workspace/application roots from stable identifiers
- exposes a workspace-shared root plus an application root template
- defines reserved platform prefixes for presigned URLs, multipart staging, and storage events
- builds object-placement metadata for workspace-shared and application-owned objects
- emits quota attribution keys and audit resource keys derived from the same logical layout
- rejects or flags attempts to place user content directly under reserved prefixes

The module remains synchronous and performs no live storage-provider calls.

### `services/adapters/src/storage-bucket-object-ops.mjs`

Extend the existing bucket/object helper module to:

- attach organization metadata to bucket records and summaries
- attach object organization metadata, including canonical logical path and optional application binding, to object records and metadata summaries
- allow object builders/previews to accept application-aware placement hints while keeping the public API provider-agnostic
- keep existing CRUD preview behavior backward compatible for callers that do not provide application context

### `services/adapters/src/provider-catalog.mjs`

Export the logical organization helper surfaces so adapter consumers can access one stable catalog.

### `apps/control-plane/src/storage-admin.mjs`

Extend the storage helper surface to:

- expose logical organization preview helpers
- preserve compatibility with the existing bucket/object route helper functions
- include organization metadata in bucket/object preview results returned through the control-plane helper surface

### `services/internal-contracts/src/internal-service-map.json`

Additive changes only:

- extend `control_api` responsibilities to acknowledge application-aware storage placement hints and organization-safe bucket/object responses
- extend `provisioning_orchestrator` responsibilities to coordinate logical placement without bypassing the storage adapter boundary
- extend the `storage` adapter port with capabilities such as `resolve_logical_organization`, `resolve_workspace_storage_root`, and `resolve_application_storage_root`

### `apps/control-plane/openapi/control-plane.openapi.json`

Add additive schema fields only; route paths stay unchanged.

- extend `StorageBucket` with logical organization metadata
- extend `StorageObjectMetadata` with concrete object organization metadata
- extend `StorageObjectWriteRequest` with optional application binding hints needed to express application-attributed placement
- add supporting schemas for organization summary, reserved prefixes, and object placement

### Generated artifacts

Regenerate the route catalog, family OpenAPI slices, and reference docs with `npm run generate:public-api` so published artifacts include the enriched storage schemas.

### Tests

Add or extend coverage for:

- deterministic organization generation across repeated calls
- separation between workspace-shared and application-owned roots
- reserved-prefix visibility and collision prevention
- bucket/object metadata carrying organization information
- OpenAPI schemas exposing additive organization fields without changing route inventory
- provider-catalog exports for the new helpers

## Validation Plan

Run the bounded quality gates for this increment:

- `npm run generate:public-api`
- `npm run validate:public-api`
- `npm run validate:openapi`
- `npm run validate:service-map`
- `npm run lint:md -- specs/010-storage-logical-organization/*.md specs/010-storage-logical-organization/checklists/*.md docs/reference/api/*.md docs/reference/architecture/public-api-surface.md` *(fallback to full `npm run lint:md` if the scoped invocation is unsupported)*
- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`

## Delivery Plan

1. Review the diff for strict T04 scope compliance.
2. Commit the `010-storage-logical-organization` branch changes.
3. Push the branch to origin.
4. Open a PR to `main`.
5. Monitor CI, fix regressions if needed, and merge once green.

## Task Status

This plan describes the implementation and delivery work for `US-STO-01-T04`. Local execution, validation, and delivery follow the checklist in `tasks.md`.
