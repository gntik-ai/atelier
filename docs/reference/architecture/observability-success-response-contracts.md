# Observability success-response contracts

This reference describes the public, read-only observability responses used by the tenant and workspace console
surfaces. It is intended for console/API integrators and operators validating a response without deploying a cluster.
The normative field definitions remain in `apps/control-plane-executor/openapi/control-plane.openapi.json` and the
schemas under `packages/internal-contracts/src/`.

## Scope and response map

All routes are under `/v1/metrics` and are authorized against the tenant or workspace in the path before a metrics
reader is called. A foreign tenant or resolved foreign workspace is `403`; an unknown workspace is `404`. These
guards are part of the isolation contract and apply equally when the metrics source is empty or temporarily
unavailable.

| Scope | Route | Successful `200` schema |
| --- | --- | --- |
| Tenant | `/v1/metrics/tenants/{tenantId}/quotas` | `QuotaPosture` |
| Workspace | `/v1/metrics/workspaces/{workspaceId}/quotas` | `QuotaPosture` |
| Tenant | `/v1/metrics/tenants/{tenantId}/overview` | `TenantQuotaUsageOverview` |
| Workspace | `/v1/metrics/workspaces/{workspaceId}/overview` | `WorkspaceQuotaUsageOverview` |
| Tenant | `/v1/metrics/tenants/{tenantId}/usage` | `UsageSnapshot` |
| Workspace | `/v1/metrics/workspaces/{workspaceId}/usage` | `UsageSnapshot` |
| Tenant/workspace | `/v1/metrics/{scope}/{id}/audit-records` | `AuditRecordCollectionResponse` |
| Tenant/workspace | `/v1/metrics/{scope}/{id}/audit-exports` | `AuditExportManifest` |

The audit routes use the canonical list projection. Detail-only fields are not added to list items. Export items are
also canonical records plus the explicit masking metadata required by `AuditExportManifest`.

## Freshness, degraded evidence, and empty results

Metric dimensions carry `freshnessStatus`: `fresh`, `degraded`, or `unavailable`. The overall quota posture follows
the published precedence, from most actionable to least actionable:

`hard_limit_reached` → `soft_limit_exceeded` → `warning_threshold_reached` → `evidence_unavailable` →
`evidence_degraded` → `within_limit` → `unbounded`.

An empty dimension set is `evidence_unavailable`; it is never `within_limit`/`healthy`. A reader failure may therefore
produce a contract-valid `200` with unavailable evidence, but must not claim that no dimensions means healthy service.
The overview exposes the same posture and includes provisioning-state detail for tenant scope. `UsageSnapshot` carries
`snapshotTimestamp`, an observation window, and `degradedDimensions`; the web console uses `snapshotTimestamp` when
present. `QuotaPosture.overallStatus` is the corresponding console-compatible status field.

## Audit normalization and export safety

Legacy audit rows are normalized before they cross the API boundary:

* stored `outcome: "error"` is exposed as `result.outcome: "failed"`;
* a legacy `NULL` outcome is conservatively exposed as `partial`, not `unknown`;
* actor, scope, resource, action, correlation, and emitting-service metadata are always populated with schema-safe
  values; no secret or raw detail is inferred for a list response.

Audit exports support `jsonl` and `csv`. Both the primary export builder and the inline fallback return a complete
`AuditExportManifest`, identify the masking profile, and keep records masked. The fallback redacts the full detail
field and records that masking was applied; it must never expose more data than the primary masking path.

## Compatibility boundaries

The workspace metric-series response is covered by the separate C-04 contract and is intentionally outside this
document. Advanced audit filters and correlation/detail contracts tracked by C-09 and C-10 are likewise outside this
change; this reference documents only the canonical list surface and its currently supported filter metadata.

## Local validation (no deployment required)

From the repository root, validate the contract and focused implementation locally:

```bash
openspec validate fix-c01-observability-success-schemas --strict
npm run validate:openapi
node --check apps/control-plane/metrics-handlers.mjs
node --check apps/control-plane/audit-store.mjs
node --test tests/blackbox/metrics-success-schema-conformance.test.mjs
```

These checks exercise schema conformance and scope/error ordering in-process. They do not deploy or mutate a
Kubernetes cluster.
