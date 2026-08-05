# Storage capacity quotas (bucket count and total bytes)

- **Document type:** Reference.
- **Intended personas:** P1 platform superadministrators, P3 platform operators/SREs, P4
  security/compliance auditors, P9 workspace operators, P10 scoped viewers/auditors, and P13 isolation
  reviewers.
- **Prerequisite knowledge:** Falcone workspace ownership, S3-compatible storage, and quota dimensions.
- **Outcome:** Interpret workspace storage capacity without confusing an absent/foreign workspace with
  a real empty workspace.

Status: existing v1 storage quota behavior plus the C-16 workspace-existence correction. C-16 is not a
new Preview surface and applies only to builds containing `fix-c16-scoped-resource-existence`. It adds
no migration, configuration, or deployment step. This update is based on static
implementation/contract evidence; it was not verified on a cluster.

Per-workspace storage capacity is bounded by two quota dimensions enforced in the control-plane
storage handlers: a **bucket-count** limit and an optional **total-bytes** limit. When a request
would exceed a configured limit it is rejected with `409 STORAGE_QUOTA_EXCEEDED`, and the workspace
usage API reports the effective limit and remaining capacity for each dimension.

Quota is a per-workspace governance control, layered on top of (and after) the existing
tenant/workspace ownership gates. It is **not** a tenant-isolation boundary, so enforcement
**fails open** (allows the operation) if the quota model or its inputs are unavailable — a
governance fault never blocks a legitimate storage operation.

## Configuration

The effective limits are deployment environment variables on the control-plane runtime, with safe
defaults:

| Variable | Dimension | Default | Meaning |
| --- | --- | --- | --- |
| `STORAGE_MAX_BUCKETS` | bucket count, per workspace | `8` | Maximum buckets a single workspace may provision. The default matches the product governance default `DEFAULT_STORAGE_BUCKET_LIMIT`. |
| `STORAGE_MAX_BYTES` | total stored bytes, per workspace | unset (unlimited) | Maximum total object bytes across all of a workspace's buckets. When **unset**, byte enforcement is off and the upload path performs **no** usage scan. |

A malformed value (non-numeric or negative) collapses that dimension to *unlimited* rather than
failing the request — fail open.

## Bucket-count admission

`POST /v1/storage/workspaces/{workspaceId}/buckets` (gateway operation `createStorage`,
`POST /v1/storage/buckets`) counts the caller's current workspace buckets **before** creating the
physical bucket. If provisioning one more would exceed `STORAGE_MAX_BUCKETS`, the request is
rejected with `409 STORAGE_QUOTA_EXCEEDED` and no bucket is created. The ownership `404` gate still
runs first, so a non-owner receives `404` (no existence leak), never `409`.

## Byte (total-bytes) admission

When `STORAGE_MAX_BYTES` is configured, `PUT /v1/storage/buckets/{bucketId}/objects/{objectKey}`
(gateway operation `uploadStorageObject`) computes the workspace's current total bytes (summing
objects across the workspace's buckets, the same scan the usage API uses) plus the size of the
incoming object — which is already buffered at the control-plane layer. If the result would exceed
the limit, the upload is rejected with `409 STORAGE_QUOTA_EXCEEDED` and the object is not stored.
When `STORAGE_MAX_BYTES` is unset, this scan is skipped entirely and uploads are never rejected for
total-bytes capacity.

## Usage reporting

Usage reporting first proves the workspace exists. The handler resolves the workspace through the
authoritative registry for **every** caller — including `superadmin` and `internal` — and returns
`404 WORKSPACE_NOT_FOUND` before listing buckets, scanning objects, or resolving limits/defaults. For a
constrained caller, a workspace owned by another tenant returns the **same** opaque `404` as an unknown
one, disclosing no ownership or existence distinction. A successful `200` therefore proves the
workspace exists; a real workspace with no buckets or objects still returns a truthful zero-valued
snapshot, while a failed registry read is a `5xx`, never a `404`. See
[Scoped resource existence](scoped-resource-existence.md).

`GET /v1/storage/workspaces/{workspaceId}/usage` reports each dimension as a
`StorageUsageDimensionStatus` with `used`, `limit`, `remaining`, and `utilizationPercent`:

- `bucketCount` always reports a non-null `limit` (the effective `STORAGE_MAX_BUCKETS`).
- `totalBytes` and `objectSizeBytes` report a non-null `limit` only when `STORAGE_MAX_BYTES` is
  configured; otherwise `limit` is `null`, denoting *unlimited*.
- `objectCount` has no configured limit and reports `limit: null`.
- For a limited dimension: `remaining = max(limit - used, 0)` and
  `utilizationPercent = round(used / limit * 100)`. For an unlimited dimension, `remaining` and
  `utilizationPercent` are `null` (so the API never reports a perpetual `null` when a limit is set).

## Error contract

`STORAGE_QUOTA_EXCEEDED` is returned as a standard `ErrorResponse` body with HTTP status `409` on
both the bucket-provision and (when byte enforcement is active) the object-upload operations. The
status and code are additive to those operations and backward compatible — no existing field,
status code, or success shape changes.

Workspace usage not-found and registry-failure results use the same closed C-02 `ErrorResponse`.
Handler-level `WORKSPACE_NOT_FOUND` becomes public `GW_WORKSPACE_NOT_FOUND`; a registry exception is
public `500 GW_CONTROL_PLANE_ERROR`, not an empty snapshot. API/SDK clients must branch on HTTP status
and the public `GW_*` code, retain request/correlation IDs for diagnosis, and never normalize
`404`/`500` into zero usage. The console clears its prior usage snapshot and shows the existing
error/retry state when the request fails.

## Implementation

- `apps/control-plane/storage-quota.mjs` — pure, injectable quota-decision helpers
  (`checkBucketQuota`, `checkByteQuota`, `usageLimits`, `dimensionStatus`). The kind-runtime image
  cannot statically import the product `packages/adapters` package, so the trivial admission math
  (`used + delta > limit`) is inlined here while reusing the product's canonical error code
  `STORAGE_QUOTA_EXCEEDED` and default bucket limit `8`.
- `apps/control-plane/storage-handlers.mjs` — `storageProvisionBucket` (bucket admission),
  `storagePutObject` (byte admission), and `storageWorkspaceUsage` (limit/remaining/utilization
  reporting) consume those helpers.

## Local validation, rollback, and cleanup

From the repository root, run:

```bash
node --test tests/blackbox/scoped-resource-existence-c16.test.mjs
node --test tests/blackbox/storage-quota-handlers.test.mjs
node --test tests/contracts/scoped-resource-existence.contract.test.mjs
pnpm --dir apps/web-console exec vitest run src/pages/ConsoleStoragePage.test.tsx
npm run validate:openapi
npm run validate:public-api
```

Expected result: every command exits zero; missing/foreign terminal cases perform no bucket/S3/quota
work, a real empty workspace keeps its zero-valued `200`, the console clears stale usage on `404`, and
the public operation retains its pre-existing canonical `404`. These commands use no credential or
cluster and create nothing requiring cleanup; reruns are idempotent.

Rollback is a code/contract revert with no data restoration or downgrade job, but it restores the
confirmed privileged-missing-workspace zero-usage defect. Prefer a forward fix. The authoritative
sources are `apps/control-plane/storage-handlers.mjs`, `apps/control-plane/storage-quota.mjs`, the
unified OpenAPI, and the linked scoped-existence reference.
