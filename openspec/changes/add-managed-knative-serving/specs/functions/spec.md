## ADDED Requirements

### Requirement: Functions distinguish a disabled backend from an unavailable Knative runtime

When Functions are configured to use Knative and the selected runtime is not ready, every operation
that creates, updates, rolls back, or invokes a Knative Service SHALL fail without attempting a
partial mutation and SHALL return HTTP `503` with `code: "KNATIVE_UNAVAILABLE"`, the runtime state,
a stable operator-facing reason, and a correlation ID. A delete SHALL instead atomically mark the
Function `deletion_pending`, persist an idempotent cleanup obligation, and return HTTP `202` without
claiming that the Knative Service is gone. This SHALL remain distinct from the existing
`FUNCTIONS_DISABLED` response used when the Functions capability is intentionally off. Metadata
reads that do not require Knative SHALL remain available in degraded mode and SHALL expose the
dependency state without reporting the function workload as ready.

#### Scenario: Deploy fails explicitly while managed runtime is degraded

- **WHEN** a P8 function developer deploys a function while Knative mode is `managed` and runtime
  readiness is degraded or unavailable
- **THEN** the API returns `503 KNATIVE_UNAVAILABLE` with a correlation ID, creates no Knative
  Service, and does not report the function as deployed

#### Scenario: Invoke fails explicitly with an external incompatibility

- **WHEN** a function invocation requires an `external` Knative installation that failed
  compatibility or readiness validation
- **THEN** the API returns `503 KNATIVE_UNAVAILABLE` without attempting the invocation or recording
  a successful activation

#### Scenario: Disabled Functions preserve the existing error

- **WHEN** the Functions capability itself is intentionally disabled
- **THEN** a Functions request returns the existing `501 FUNCTIONS_DISABLED` response rather than
  `KNATIVE_UNAVAILABLE`

#### Scenario: Delete during an outage is accepted as pending cleanup

- **WHEN** an authorized caller deletes a Function while its configured Knative runtime is unavailable
- **THEN** the API atomically persists `deletion_pending` and its cleanup obligation, returns `202`
  with the correlation ID, performs no Knative mutation, and does not report deletion complete

#### Scenario: Degraded metadata read remains honest

- **WHEN** an authorized caller lists or reads stored function metadata while Knative is unavailable
- **THEN** the metadata response remains tenant-scoped, marks runtime readiness unavailable, and does
  not claim that an unverified Knative Service is ready

### Requirement: Managed Knative preserves function lifecycle and tenant isolation

Selecting `managed` or `external` Knative SHALL preserve the existing Function contract: each
deployed function maps to a tenant-and-workspace-scoped Knative Service, code changes create a new
revision, idle workloads scale to zero, invocation resolves only the caller-scoped workload, rollback
selects a retained compatible revision, and delete or tenant teardown removes the caller's Knative
resources idempotently. Runtime mode changes SHALL NOT make one tenant's names, source, revisions,
activations, logs, or endpoints visible or mutable by another tenant.

#### Scenario: Same names in adjacent tenants remain distinct

- **WHEN** two tenants deploy the same function name in same-named workspaces on the shared managed
  runtime
- **THEN** they receive distinct Knative Services and each tenant invokes only its own code

#### Scenario: Version and rollback preserve Function semantics

- **WHEN** a function developer deploys a new version and later rolls back while the Knative runtime
  is ready
- **THEN** Knative revisions implement the version change and rollback without changing the public
  Function API or exposing another tenant's revision

#### Scenario: Tenant teardown leaves no function workloads

- **WHEN** a tenant is deprovisioned and Knative is ready
- **THEN** all Knative Services owned by that tenant are removed idempotently and no other tenant's
  service is changed

#### Scenario: Teardown is deferred safely during an outage

- **WHEN** tenant teardown occurs while Knative is unavailable
- **THEN** Falcone atomically records the cleanup obligation, keeps the aggregate teardown pending,
  reports it to operators, retries after readiness, and never reports cleanup complete while owned
  Knative Services remain

### Requirement: Function dependency failures are audited and observable without tenant leakage

Falcone SHALL record secret-safe, tenant-scoped audit events and bounded metrics for Function deploy,
invoke, rollback, delete, and deferred cleanup failures caused by Knative availability. Error details
visible to P8 developers and P10 auditors SHALL be sufficient to correlate an incident but SHALL NOT
include another tenant's workload identity or cluster-administration data.

#### Scenario: Unavailable deploy has correlated evidence

- **WHEN** a function deployment returns `KNATIVE_UNAVAILABLE`
- **THEN** the response correlation ID resolves to an audit event and bounded metric carrying the
  caller's tenant/workspace, operation, runtime mode, and reason without source code or credentials

#### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads

- **WHEN** a P13 adjacent-tenant principal inspects its own Function error or status
- **THEN** the response exposes no Knative Service name, revision, endpoint, log, or owner from any
  other tenant
