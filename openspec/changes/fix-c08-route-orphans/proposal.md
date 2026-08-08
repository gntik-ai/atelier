## Why

Falcone publishes a set of operations and observability APIs that the deployable control-plane cannot dispatch. The unified OpenAPI, generated family contracts, public route catalog, generated API reference, and gateway family policy advertise the operations, but neither `apps/control-plane/routes.mjs` nor `apps/control-plane/route-map.runtime.json` registers them. Authenticated requests therefore terminate at the generic route matcher with `404 GW_NO_ROUTE` before operation-specific authorization, scope resolution, backend access, or audit behavior can run.

The independently confirmed C-08 evidence used the shorthand “21 routes” for the AZO-DRIFT-01 enumeration and separately confirmed four Function-audit routes under OBS-CONTRACT-16. The deduplicated remediation boundary is therefore exactly 25 operation IDs: 20 GET operations and 5 POST operations.

## What Changes

- Define one checked-in C-08 inventory containing the exact 25 public method/path/operation-ID tuples and use it as the regression boundary for route assembly.
- Register every in-scope operation with a production handler backed by the real scoped repository, adapter, provider, or platform data source already implied by the public contract. A hard-coded empty, healthy, or success response is not an implementation.
- Preserve the published method, path, operation ID, request/response schema, audiences, authorization boundary, tenant/workspace bindings, plan-capability requirements, QoS, retry, and idempotency semantics.
- Make the 20 GET operations read-only and make the 5 POST operations validate before mutation, authorize at platform scope, replay idempotently, and preserve the existing domain audit/operation chain.
- Align unified/generated contracts, gateway reachability, runtime assembly, packaged modules, existing clients/console consumers, reference documentation, and route-level audit/metrics behavior.
- Add black-box HTTP, authorization/isolation, contract-parity, handler/repository, idempotency, packaging, and documentation regression coverage. CI fails if any in-scope public operation is unregistered, resolves to a missing/test-only handler, or falls through to `GW_NO_ROUTE`.

## Exact remediation inventory

### Metrics and correlation (5 GET)

- `getTenantAuditCorrelation`
- `getWorkspaceAuditCorrelation`
- `getWorkspaceEventDashboards`
- `getWorkspaceGatewayStreamMetrics`
- `getWorkspaceKafkaTopicMetrics`

### Function audit (4 GET)

- `listFunctionDeploymentAudit`
- `listFunctionQuotaEnforcement`
- `listFunctionRollbackEvidence`
- `getFunctionAuditCoverage`

### Billing (2 GET)

- `listBillingUsageRecords`
- `listTenantBillingUsageRecords`

### Platform control and discovery (13 operations)

- `createDeploymentProfileRecord`
- `getDeploymentProfileRecord`
- `createCommercialPlan`
- `getCommercialPlan`
- `createQuotaPolicy`
- `getQuotaPolicy`
- `createProviderCapabilityRecord`
- `getProviderCapabilityRecord`
- `createPlatformUser`
- `getPlatformUser`
- `getRouteCatalog`
- `getStorageProviderIntrospection`
- `listTopologyRegions`

### Tenant governance (1 GET)

- `getTenantGovernanceDashboard`

## Persona impact

- Primary: P1 platform superadministrator, P3 platform operator/SRE, P7 workspace owner/admin, P9 workspace operator, and P14 plan/entitlement/quota governor.
- Constrained/read-only: P4 platform security/compliance auditor and P10 tenant/workspace viewer or auditor.
- Adjacent API actors: P11 external integrator and P12 service workload/AI agent.
- Adversarial: P13 valid tenant-B actor attempting to address tenant-A resources.

The change does not equate route reachability with permission. Existing audiences, capabilities, verified credential scope, and tenant/workspace bindings remain authoritative.

## Impact

- Affected capability: operations and observability, with platform-control, Functions, tenant-governance, billing, storage-provider, and API-discovery integration points.
- Affected layers: unified and generated public contracts; public catalog/reference; gateway route reachability; control-plane route assembly and handlers; repositories/adapters; authorization and isolation; idempotency and audit; HTTP metrics; image packaging; existing SDK/console consumers; operator/integrator documentation; tests.
- Database work is additive only if a published mutation lacks durable storage on the current base. Any such migration must include ownership/RLS/indexing, forward compatibility, and rollback guidance; destructive backfill is prohibited.
- No cluster deployment is part of this change. Runtime verification remains local and hermetic until an explicitly authorized later rollout.

## Out of scope

- C-01/C-02/C-03/C-04/C-05/C-06/C-07/C-09/C-10/C-11/C-12/C-13/C-14/C-15/C-16/C-17 and any other audit finding.
- Existing quota/overview/usage/series, audit-record list/export, async-operation, privilege-domain audit, Flow event-stream, health, Prometheus, or business-metric semantics.
- New roles, changed audiences/permissions, identity-normalization changes, new console pages, legacy aliases, or silent removal/deprecation of an existing `/v1` operation.
- Deployment to, mutation of, or evidence collection from a Kubernetes cluster.
