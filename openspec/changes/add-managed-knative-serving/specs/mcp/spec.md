## ADDED Requirements

### Requirement: Hosted MCP distinguishes disabled hosting from unavailable Knative

When MCP hosting is enabled but its selected Knative runtime is not ready, operations that deploy,
publish, activate, or invoke a hosted MCP Knative Service SHALL fail before partial mutation with the
typed dependency code `KNATIVE_UNAVAILABLE`, the runtime state, a stable reason, and a correlation
ID. HTTP management operations SHALL use status `503`. An ordinary delete SHALL instead atomically
mark the server `deletion_pending`, persist an idempotent cleanup obligation, and return HTTP `202`
without claiming that the Knative Service is gone.

For an authenticated and owner-scoped JSON-RPC request, runtime unavailability SHALL return HTTP
`200` with JSON-RPC error code `-32005`, message `Hosted MCP runtime is unavailable.`, and
`error.data` containing `code: "KNATIVE_UNAVAILABLE"`, the bounded runtime `state` and `reason`, and
`correlationId`; it SHALL not fabricate a tool result. Authentication SHALL still take precedence
with HTTP `401`, and foreign/missing server lookup SHALL preserve its not-found JSON-RPC behavior
before the dependency gate. An authenticated notification SHALL return HTTP `202` with no body,
invoke no tool, and record the correlated unavailable event. When MCP hosting is intentionally
disabled, the existing disabled/absent route behavior SHALL remain distinct. Stored server
definitions and audit reads that do not require Knative SHALL remain available in degraded mode and
SHALL not report a hosted server as ready.

#### Scenario: Publish fails explicitly while Knative is degraded

- **WHEN** a P7 MCP owner publishes a hosted server while the selected Knative runtime is unavailable
- **THEN** the management API returns `503 KNATIVE_UNAVAILABLE` with a correlation ID, creates or
  changes no Knative Service, and does not mark the server version active

#### Scenario: Consumer receives honest unavailable status

- **WHEN** a P12 MCP consumer invokes a published hosted server whose Knative runtime is unavailable
- **THEN** the authenticated request returns HTTP `200` with JSON-RPC error `-32005` and
  `error.data.code: "KNATIVE_UNAVAILABLE"`, state, reason, and correlation ID, and does not claim a
  tool result or route to another tenant's server

#### Scenario: Disabled hosting remains distinguishable

- **WHEN** MCP hosting is intentionally disabled for an installation
- **THEN** its existing disabled or unregistered-route behavior remains in force rather than being
  reported as a transient `KNATIVE_UNAVAILABLE` incident

#### Scenario: Delete during an outage is accepted as pending cleanup

- **WHEN** an authorized owner deletes a hosted MCP server while Knative is unavailable
- **THEN** the management API atomically persists `deletion_pending` and its cleanup obligation,
  returns HTTP `202` with the correlation ID, performs no Knative mutation, and does not report
  deletion complete

#### Scenario: Unavailable notification has no JSON-RPC body

- **WHEN** an authenticated owner sends a JSON-RPC notification to its hosted server while Knative
  is unavailable
- **THEN** Falcone returns HTTP `202` with no body, invokes no tool, and records the unavailable event

#### Scenario: Authentication and ownership precede dependency status

- **WHEN** a request has no verified identity or targets a server owned by another tenant while
  Knative is unavailable
- **THEN** Falcone returns the existing HTTP `401` or tenant-safe not-found JSON-RPC response and does
  not disclose `KNATIVE_UNAVAILABLE` for the foreign server

#### Scenario: Degraded audit read remains available

- **WHEN** an authorized MCP owner reads stored server metadata or audit while Knative is unavailable
- **THEN** the response remains tenant-scoped, exposes dependency readiness, and does not report the
  hosted workload as ready

### Requirement: Managed Knative preserves hosted MCP isolation and scale-to-zero semantics

Selecting `managed` or `external` Knative SHALL preserve the existing hosted MCP contract: each
server runs in its owning tenant namespace, is internal-only behind the Falcone gateway, scales to
zero when idle, cold-starts on demand, uses tenant-scoped RBAC and NetworkPolicies, and exposes no
direct cross-tenant route. The shared Knative control plane SHALL not weaken credential-derived
routing, OAuth scope enforcement, quotas, audit attribution, or egress isolation.

#### Scenario: Same server identity in two tenants remains isolated

- **WHEN** two tenants host servers with the same name on the shared managed Knative runtime
- **THEN** each server resolves only through its credential-derived tenant route and neither tenant
  can list, invoke, or inspect the other's workload

#### Scenario: Idle server scales down and cold-starts

- **WHEN** a hosted MCP server is idle and the Knative runtime remains ready
- **THEN** the workload scales to zero and a later authorized request cold-starts that same tenant's
  server without losing its published tool contract

#### Scenario: Direct or cross-namespace ingress remains denied

- **WHEN** a workload bypasses the gateway or probes a hosted MCP server in another tenant namespace
- **THEN** tenant NetworkPolicy and gateway routing deny the connection without returning MCP data

### Requirement: Hosted MCP teardown is idempotent and outage-safe

Deleting a hosted server, disabling MCP hosting, or deprovisioning a tenant SHALL remove its Knative
Services, revisions, routes, tenant RBAC, and NetworkPolicies idempotently without changing another
tenant's resources. If Knative is unavailable, an ordinary delete SHALL return the `202`
`deletion_pending` state defined above; capability disable and tenant teardown SHALL atomically retain
the same durable cleanup obligation and their aggregate operation SHALL remain pending. Falcone SHALL
surface the obligation to operators, retry after readiness, and SHALL NOT report teardown complete
while owned runtime resources remain.

#### Scenario: Tenant deprovision removes the complete MCP footprint

- **WHEN** a tenant with hosted MCP servers is deprovisioned while Knative is ready
- **THEN** its MCP Knative workloads and tenant runtime footprint are removed idempotently and no
  resource belonging to an adjacent tenant changes

#### Scenario: Runtime outage defers cleanup honestly

- **WHEN** hosted MCP teardown is requested while Knative is unavailable
- **THEN** the request records a correlated pending-cleanup state, retries after recovery, and does
  not report success while owned workload resources remain

#### Scenario: Retried cleanup is safe

- **WHEN** a previously deferred hosted MCP cleanup is retried one or more times
- **THEN** the final state contains no target server workload or orphaned tenant RBAC/NetworkPolicy
  and repeated deletion does not fail or affect another tenant

### Requirement: MCP dependency events are tenant-scoped, audited, and observable

Hosted MCP availability failures, deferred cleanup, and recovery SHALL emit secret-safe tenant audit
events and bounded operational metrics with a correlation ID. P7 owners, P12 consumers, and P10
auditors SHALL receive only the status appropriate to their role; P13 adjacent tenants SHALL learn
nothing about another tenant's server, tools, endpoint, logs, credentials, or cleanup queue.

#### Scenario: Hosted-server outage is correlated without secrets

- **WHEN** a hosted MCP request returns `KNATIVE_UNAVAILABLE`
- **THEN** its correlation ID resolves to an audit event and metric carrying tenant/workspace,
  server operation, runtime mode, and bounded reason without OAuth tokens, credentials, or tool data

#### Scenario: Adjacent tenant learns no hosted-server state

- **WHEN** a P13 principal probes an unavailable server owned by another tenant
- **THEN** Falcone preserves not-found isolation and discloses neither the dependency state nor any
  metadata for the other tenant's server
