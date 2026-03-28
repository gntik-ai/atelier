# Implementation Plan: US-STO-03-T01 — Scoped Programmatic Storage Credentials

**Feature Branch**: `019-storage-scoped-access-credentials`
**Spec**: `specs/019-storage-scoped-access-credentials/spec.md`
**Task**: US-STO-03-T01
**Epic**: EP-12 — Storage S3-compatible
**Status**: Implemented
**Created**: 2026-03-28
**Updated**: 2026-03-28

## 1. Scope summary

This task adds workspace-scoped programmatic storage credentials for direct S3-compatible access. The delivered slice is bounded to repo-local contracts, previews, and validation helpers:

- define a canonical storage programmatic credential record and one-time secret envelope
- constrain credential scopes to the existing storage policy action vocabulary
- expose create, list, read, rotate, and revoke control-plane surfaces
- publish the new routes through OpenAPI, family docs, and the generated public route catalog
- cover the feature with adapter, unit, and contract tests

This implementation stays additive and does not change previously delivered storage bucket, object, quota, event, or capability behavior.

## 2. Repo-local dependency map

| Concern | Path | Usage |
| --- | --- | --- |
| Storage policy action vocabulary | `services/adapters/src/storage-access-policy.mjs` | Reused for allowed scoped operations and principal types |
| Provider catalog exports | `services/adapters/src/provider-catalog.mjs` | Re-exports new credential helpers for repo-wide access |
| Storage admin aggregation | `apps/control-plane/src/storage-admin.mjs` | Publishes previews and route helpers for the control plane |
| Public OpenAPI source | `apps/control-plane/openapi/control-plane.openapi.json` | Adds storage credential schemas and routes |
| Generated route catalog | `services/internal-contracts/src/public-route-catalog.json` | Publishes discoverable storage credential routes |
| Public API taxonomy | `services/internal-contracts/src/public-api-taxonomy.json` | Adds `storage_credential` resource typing |
| Internal service map | `services/internal-contracts/src/internal-service-map.json` | Declares adapter capabilities for credential lifecycle management |
| Storage unit and contract tests | `tests/unit/storage-admin.test.mjs`, `tests/contracts/storage-provider.contract.test.mjs` | Extended to validate the new surface |

## 3. Implementation approach

### 3.1 Adapter layer

Add `services/adapters/src/storage-programmatic-credentials.mjs` as the feature-local source of truth for:

- canonical credential types and lifecycle states
- allowed storage actions for scoped credentials
- record creation and masking of access key identifiers
- one-time secret envelope generation
- collection builders for list responses
- rotation and revocation helpers
- bounded validation errors for invalid scope, invalid operations, and cross-workspace leakage

### 3.2 Control-plane aggregation

Extend `apps/control-plane/src/storage-admin.mjs` to:

- expose storage credential catalogs alongside existing storage admin catalogs
- surface storage credential routes through `listStorageAdminRoutes` and `getStorageAdminRoute`
- publish preview helpers for create, list, read, rotate, and revoke flows
- keep returned summaries secret-safe after issuance

### 3.3 Contract publication

Update `apps/control-plane/openapi/control-plane.openapi.json` with additive storage credential schemas and routes:

- `GET /v1/storage/workspaces/{workspaceId}/credentials`
- `POST /v1/storage/workspaces/{workspaceId}/credentials`
- `GET /v1/storage/workspaces/{workspaceId}/credentials/{credentialId}`
- `DELETE /v1/storage/workspaces/{workspaceId}/credentials/{credentialId}`
- `POST /v1/storage/workspaces/{workspaceId}/credentials/{credentialId}/rotations`

Then regenerate the published artifacts so the family document, route catalog, and public API surface docs remain aligned.

## 4. Files changed

### 4.1 Source files

- `services/adapters/src/storage-programmatic-credentials.mjs`
- `services/adapters/src/provider-catalog.mjs`
- `apps/control-plane/src/storage-admin.mjs`
- `services/internal-contracts/src/internal-service-map.json`
- `services/internal-contracts/src/public-api-taxonomy.json`

### 4.2 Published API artifacts

- `apps/control-plane/openapi/control-plane.openapi.json`
- `apps/control-plane/openapi/families/storage.openapi.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `docs/reference/architecture/public-api-surface.md`

### 4.3 Spec Kit artifacts

- `specs/019-storage-scoped-access-credentials/spec.md`
- `specs/019-storage-scoped-access-credentials/plan.md`
- `specs/019-storage-scoped-access-credentials/tasks.md`

### 4.4 Tests

- `tests/adapters/storage-programmatic-credentials.test.mjs`
- `tests/unit/storage-admin.test.mjs`
- `tests/unit/public-api.test.mjs`
- `tests/contracts/storage-provider.contract.test.mjs`

## 5. Validation plan

The implementation is considered ready when these checks pass:

- adapter tests for record creation, rotation, revocation, and validation errors
- storage admin unit tests for preview helpers and route discoverability
- contract tests for additive OpenAPI schemas, route metadata, taxonomy, and service-map coverage
- generated public API artifacts are in sync with the OpenAPI source
- repo markdown lint passes for the new Spec Kit artifacts

Validation command used during implementation:

- `npm test -- --test-concurrency=1 tests/adapters/storage-programmatic-credentials.test.mjs tests/unit/storage-admin.test.mjs tests/contracts/storage-provider.contract.test.mjs tests/unit/public-api.test.mjs tests/contracts/control-plane.openapi.test.mjs`

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| New storage routes drift from generated artifacts | Regenerate published API artifacts after OpenAPI changes |
| Credential scopes diverge from policy vocabulary | Reuse `storage-access-policy.mjs` action constants instead of duplicating semantics |
| Secret leakage in summaries | Return masked identifiers in records and full secrets only in one-time envelopes |
| Cross-workspace scope leakage | Reject scopes whose declared workspace differs from the credential workspace |

## 7. Rollback plan

If this increment needs to be reverted:

1. revert commit `feat(storage): add scoped programmatic credentials`
2. regenerate the public API artifacts if the revert is partial
3. rerun the same validation command and the default CI checks

## 8. Exit criteria

This task is complete when:

- the scoped credential spec, plan, and tasks artifacts exist
- the repo publishes additive storage credential contracts
- local validation is green
- the branch is pushed, a PR is opened, and CI is green for merge
