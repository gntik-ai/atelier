# Change: Confirm scoped resource existence before metrics and storage usage

## Why

Confirmed audit finding C-16 shows that tenant metrics and privileged workspace storage-usage reads
can return credible-looking HTTP `200` bodies for tenants or workspaces that do not exist because the
runtime skips the authoritative scope-existence read. This conflates an absent resource with a real
but empty or degraded resource, misleads operators and auditors, and leaves the published metrics
contract unable to describe the corrected not-found outcome.

## What Changes

- Make all six tenant metrics handler families confirm the tenant exists after authentication and the
  existing own-tenant authorization, but before limits, defaults, provider, audit-query, or export
  work; an authorized request for an addressable missing tenant returns `404 TENANT_NOT_FOUND`.
- Preserve tenant non-enumeration: an unauthorized caller receives the same `403 FORBIDDEN` for a
  foreign existing tenant and an unrelated unknown tenant, without registry or provider work.
- Preserve workspace metrics behavior: a known foreign workspace remains `403 FORBIDDEN`, an unknown
  workspace remains `404 WORKSPACE_NOT_FOUND`, and the resolved tenant is not redundantly re-probed.
- Make workspace storage usage resolve the workspace for every actor, including `superadmin` and
  `internal`; an unknown workspace returns `404 WORKSPACE_NOT_FOUND`, while constrained callers keep
  opaque `404` results for both foreign and unknown workspaces, before bucket, S3, quota, or default
  work.
- Preserve every authorized real-resource success schema and the current honest empty/degraded `200`
  semantics and provider math.
- Add the canonical `404` `ErrorResponse` to exactly eleven published tenant/workspace metrics
  operations in the unified OpenAPI and regenerate the derived metrics family, route catalog, and
  public API documentation. Keep the runtime-only tenant series unpublished and leave the existing
  workspace-storage-usage `404` declaration unchanged.
- Cover backend ordering and short-circuits, cross-tenant opacity, existing-resource success fixtures,
  OpenAPI drift, and console stale/error handling without a production UI redesign or cluster
  deployment.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `observability`: Require authoritative tenant/workspace existence semantics, non-enumerating
  ordering, canonical not-found contracts, and honest console error handling for the affected metrics
  and storage-usage reads.

## Impact

- Runtime: the existing control-plane metrics scope guard and workspace storage-usage handler, reusing
  the current tenant/workspace store reads and canonical C-02 error normalization.
- Contract: the unified control-plane OpenAPI plus its generated metrics-family contract, public route
  catalog, and generated public API reference.
- Console: focused regressions for quota/observability/audit/storage clients and pages so a scope `404`
  clears stale success data and renders an unavailable/not-found state.
- Tests and documentation: pre-fix black-box tests, focused OpenAPI contract coverage, preserved-success
  fixtures, and architecture/API documentation. There is no new route, role, store, migration,
  deployment configuration, audit event, metric family, or quota/metering mutation.
