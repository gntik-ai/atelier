# Implementation Plan: Tenant Storage Context and Lifecycle Bootstrap

**Branch**: `008-tenant-storage-context` | **Date**: 2026-03-27 | **Spec**: `specs/008-tenant-storage-context/spec.md`
**Task**: US-STO-01-T02
**Input**: Feature specification from `/specs/008-tenant-storage-context/spec.md`

## Summary

Implement the tenant-scoped logical storage context that sits between the platform-level provider abstraction from T01 and later bucket/object operations. The increment provisions one storage context per tenant, derives namespace and quota assignment from the tenant plan/governance catalog, exposes safe tenant/operator introspection, supports credential rotation and lifecycle transitions, and makes default workspace bucket bootstrap depend on an active tenant storage context instead of assuming storage is immediately available.

This task does **not** implement workspace bucket/object CRUD (T03), logical bucket organization and overlays (T04), cross-provider runtime error translation (T05), or live multi-provider verification suites (T06).

## Technical Context

**Language/Version**: Node.js 20+ ESM modules, JSON OpenAPI/contracts, Helm YAML
**Primary Dependencies**: existing repo-local helpers in `services/internal-contracts`, `services/adapters`, and `apps/control-plane`
**Storage**: no new persistence layer; the context is represented as deterministic control-plane/adapter state and contract metadata
**Testing**: root validation scripts, `node:test`, generated public API artifacts, OpenAPI/schema validation, deployment chart validation
**Target Platform**: Helm-managed Kubernetes/OpenShift deployment
**Performance Goals**: synchronous plan-aware context derivation and workspace bootstrap gating with no network I/O
**Constraints**: additive-only changes; secret-safe summaries; preserve T01 compatibility; keep tenant-scoped logic separate from future workspace bucket/object execution
**Scale/Scope**: one new adapter helper module, additive control-plane/helper updates, additive OpenAPI/contracts/service-map/chart metadata, and targeted unit/adapter/contract coverage

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — tenant storage derivation lives in `services/adapters/src/`; bootstrap gating stays in `services/internal-contracts/src/`; operator/tenant summaries stay in `apps/control-plane/src/`; generated/public artifacts remain under their existing folders.
- **Incremental Delivery First**: PASS — only the tenant storage context layer and its dependency handoff are implemented.
- **Kubernetes and OpenShift Compatibility**: PASS — all deployment-facing changes stay within existing chart/config conventions.
- **Quality Gates at the Root**: PASS — the task is validated with public API generation, OpenAPI validation, service-map validation, deployment-chart validation, and unit/adapter/contract suites.
- **Documentation as Part of the Change**: PASS — feature-local spec/plan/tasks remain updated.
- **No Sibling Scope Absorption**: PASS — no workspace bucket CRUD, object APIs, or provider SDK execution is introduced.

## Project Structure

### Documentation (this feature)

```text
specs/008-tenant-storage-context/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   ├── control-plane.openapi.json              ← additive: tenant storage-context routes + schemas
    │   └── families/
    │       └── tenants.openapi.json                ← generated: tenant family includes storage context operations
    └── src/
        ├── storage-admin.mjs                       ← additive: tenant storage summaries, rotation preview, bootstrap preview
        └── tenant-management.mjs                   ← additive: optional tenant-surface inclusion of storage context summary

services/
├── adapters/
│   └── src/
│       ├── provider-catalog.mjs                    ← additive: tenant storage helper exports
│       └── storage-tenant-context.mjs              ← new: namespace, quota, credential, lifecycle, event, bootstrap helpers
└── internal-contracts/
    └── src/
        ├── domain-model.json                       ← additive: storage quota metrics inside canonical quota policies
        ├── index.mjs                               ← additive: workspace bootstrap gating against tenant storage context
        ├── internal-service-map.json               ← additive: tenant-context storage capabilities and responsibilities
        ├── public-api-taxonomy.json                ← additive: tenant_storage_context resource taxonomy
        └── public-route-catalog.json               ← generated: tenant storage context routes discoverable

charts/
└── in-falcone/
    └── values.yaml                                 ← additive: bootstrap governance quota catalog mirrors new storage limits

tests/
├── adapters/
│   └── provider-catalog.test.mjs                   ← additive: tenant storage helper coverage
├── contracts/
│   └── storage-provider.contract.test.mjs          ← additive: tenant storage OpenAPI/route/service-map coverage
└── unit/
    ├── storage-admin.test.mjs                      ← additive: tenant storage summary, rotation, and bootstrap gating tests
    └── tenant-bootstrap.test.mjs                   ← additive: default bucket dependency-wait/blocked/pending coverage
```

## Target Architecture and Flow

### Tenant storage-context provisioning flow

1. Read the platform storage provider profile from T01.
2. Resolve the tenant’s plan and effective capabilities from the governance catalog.
3. Derive one deterministic tenant namespace and quota assignment for storage-capable plans.
4. Project an internal credential reference and lifecycle-safe status without exposing raw credentials.
5. Emit additive audit/event payloads for tenant storage transitions.

### Tenant/operator introspection flow

1. Authorized tenant/platform callers read `GET /v1/tenants/{tenantId}/storage-context`.
2. Control-plane summaries return namespace, provider status, quota assignment, credential health, and dependency status.
3. Secret references stay internal; public summaries only expose health/presence metadata.
4. Credential rotation is initiated via `POST /v1/tenants/{tenantId}/storage-context/credential-rotations` and preserves namespace continuity.

### Workspace bootstrap dependency flow

1. Initial tenant bootstrap still enumerates `default_storage_bucket` as a managed bootstrap resource.
2. When an explicit tenant storage context is supplied and is not active, `default_storage_bucket` moves to `dependency_wait` or `blocked` instead of optimistic provisioning.
3. Once the context is active, default workspace bucket bootstrap returns to `pending` with namespace linkage.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/storage-tenant-context.mjs` (new file)

Create a pure helper module exporting deterministic tenant storage functions:

- namespace derivation for one provider-specific tenant context per tenant
- plan/quota-policy-based storage quota assignment
- internal context record generation with lifecycle/provisioning status
- secret-safe introspection summaries
- credential rotation projections
- audit/event payload builders
- workspace default-bucket dependency previews

The module stays synchronous and deterministic and does not call provider SDKs.

### `services/adapters/src/provider-catalog.mjs`

Extend the provider catalog with additive exports for tenant storage records, safe summaries, rotation previews, bootstrap previews, and event helpers so downstream control-plane/tests consume one stable surface.

### `apps/control-plane/src/storage-admin.mjs`

Extend the existing storage admin helper to:

- surface tenant storage context routes alongside platform/provider routes
- summarize tenant storage context safely
- preview credential rotation responses
- preview workspace bootstrap dependency state
- expose additive tenant storage error-code constants and event builders

### `apps/control-plane/src/tenant-management.mjs`

Allow tenant management summaries to optionally include a storage context projection when the caller passes one, without changing the existing route inventory semantics.

### `services/internal-contracts/src/index.mjs`

Keep `resolveInitialTenantBootstrap()` backward compatible while adding optional tenant-storage-context gating for `default_storage_bucket`:

- `pending` when the context is active and bucket provisioning is allowed
- `dependency_wait` when the context is missing/draft/pending
- `blocked` when the context is suspended, soft-deleted, or capability-unavailable

### `services/internal-contracts/src/domain-model.json`

Extend canonical quota policies with additive tenant storage metrics:

- `tenant.storage.bytes.max`
- `tenant.storage.buckets.max`

These values become the source of truth for tenant storage quota assignment.

### `apps/control-plane/openapi/control-plane.openapi.json`

Add additive tenant-scoped public operations and schemas:

- `GET /v1/tenants/{tenantId}/storage-context`
- `POST /v1/tenants/{tenantId}/storage-context/credential-rotations`
- `TenantStorageContext`
- `TenantStorageQuotaAssignment`
- `TenantStorageCredentialStatus`
- `TenantStorageProvisioningStatus`
- `TenantStorageCredentialRotationRequest`
- supporting managed-resource dependency schema

Then regenerate family docs and route catalog.

### `services/internal-contracts/src/internal-service-map.json`

Additive changes only:

- extend the `storage` adapter port with tenant-context capabilities such as `ensure_tenant_context`, `get_tenant_context_status`, `rotate_tenant_context_credentials`, and `revoke_tenant_context_credentials`
- extend `control_api` and `provisioning_orchestrator` responsibilities to cover tenant storage context status, rotation initiation, and bucket dependency management

### `services/internal-contracts/src/public-api-taxonomy.json`

Add `tenant_storage_context` so generated/public metadata has an explicit resource taxonomy entry aligned with tenant-scoped authorization semantics.

### `charts/in-falcone/values.yaml`

Mirror the canonical quota-policy catalog changes in the bootstrap governance catalog so deployment validation stays aligned with the domain model source of truth.

### Tests

Add or extend coverage for:

- tenant storage context creation, safe summaries, and event building
- credential rotation preserving namespace continuity and hiding secret refs
- workspace bootstrap dependency waiting/blocking behavior
- route/service-map/OpenAPI discoverability for the new tenant storage context operations
- governance/deployment chart drift detection staying green after additive quota changes

## Validation Plan

Run the root quality gates required by this increment:

- `npm run generate:public-api`
- `npm run validate:public-api`
- `npm run validate:openapi`
- `npm run validate:service-map`
- `npm run validate:deployment-chart`
- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`

## Delivery Plan

1. Review the diff for strict T02 scope compliance.
2. Commit the `008-tenant-storage-context` branch changes.
3. Push the branch to origin.
4. Open a PR to `main`.
5. Monitor CI, fix regressions if needed, and merge once green.

## Task Status

The implementation described in this plan has been completed locally and validated in-repo. Delivery steps (push/PR/CI/merge) are handled separately in the execution checklist.
