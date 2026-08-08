# C-08 public route registration

## ADDED Requirements

### Requirement: Exact C-08 public inventory is served

The deployable control-plane SHALL register exactly the 25 C-08 operation IDs defined by this change as unique canonical method/path pairs and SHALL dispatch each pair to a packaged production handler.

#### Scenario: Production route parity

- **GIVEN** the unified OpenAPI, generated public route catalog, and production route assembly
- **WHEN** the C-08 inventory is compared after normalizing parameter names
- **THEN** all 25 operation IDs resolve to their published method and path exactly once
- **AND** all 25 resolve to an existing production handler/module included in the image
- **AND** none can fall through to `404 GW_NO_ROUTE`

#### Scenario: No alias or silent removal

- **WHEN** public artifacts are regenerated
- **THEN** every in-scope operation retains its existing `/v1` method, path, operation ID, and visibility
- **AND** no legacy/alternate alias is introduced
- **AND** no in-scope operation is silently removed, hidden, or deprecated to satisfy parity

### Requirement: Served operations use real bounded backends

Each in-scope handler SHALL authenticate and authorize the actor, validate the request, resolve the target scope/resource, and query or mutate the real bounded repository/adapter/provider required by the public contract before returning success. It SHALL NOT use a hard-coded empty, healthy, or success payload as a substitute for implementation.

#### Scenario: Authorized read with no records

- **GIVEN** an authorized actor and an existing permitted scope whose real backing query returns no records
- **WHEN** the actor invokes an in-scope GET operation
- **THEN** the handler returns the contract-valid empty outcome produced from that query
- **AND** the request is distinguishable in tests from a missing handler or hard-coded empty stub

#### Scenario: Billing keyset continuation is contractual

- **GIVEN** an authorized billing reader and more durable records than the requested page size
- **WHEN** a billing page is returned
- **THEN** the OpenAPI response exposes an opaque `pagination.nextCursor` usable as `page[after]`
- **AND** a malformed timestamp, UUID, or cross-scope cursor is rejected before SQL executes

#### Scenario: Dependency or capability unavailable

- **GIVEN** an existing permitted scope whose required plan capability or backend dependency is unavailable
- **WHEN** the actor invokes an affected metrics or Function-audit operation
- **THEN** the handler returns the contract-owned capability/dependency failure after dispatch
- **AND** it returns neither `GW_NO_ROUTE` nor a fabricated empty/healthy success

#### Scenario: Domain not found

- **GIVEN** an authorized actor and a valid-shaped unknown resource identifier
- **WHEN** the actor invokes an in-scope resource GET
- **THEN** the handler returns the operation's bounded not-found outcome after scope resolution
- **AND** it does not expose provider/datastore details

### Requirement: Existing authorization and isolation boundaries are preserved

The runtime SHALL enforce each operation's published audience, permission, plan capability, tenant binding, and workspace binding without expanding roles or trusting caller-supplied identity headers.

#### Scenario: Authentication precedes backend access

- **GIVEN** a missing or invalid credential
- **WHEN** any representative in-scope operation is requested
- **THEN** the canonical authentication failure is returned
- **AND** no repository, adapter, provider, resource-existence query, or domain mutation is invoked

#### Scenario: Constrained role is denied before domain effect

- **GIVEN** P4 or P10 with a valid credential but without the operation's published audience/permission
- **WHEN** the actor invokes an in-scope platform or Function-audit operation
- **THEN** the canonical denial is returned before protected backend access
- **AND** no product state changes and no sensitive metadata is disclosed

#### Scenario: Foreign scope is non-enumerable

- **GIVEN** P13 as a valid tenant-B actor and a real tenant-A/workspace-A/resource identifier
- **WHEN** P13 invokes a tenant/workspace-scoped C-08 operation or supplies forged identity headers
- **THEN** the verified credential scope cannot be widened
- **AND** no tenant-A data, count, correlation, metric, audit record, dashboard, billing record, or existence metadata is returned
- **AND** the observable result follows the operation's established foreign-versus-unknown non-enumeration policy

### Requirement: In-scope GET operations are read-only

All 20 C-08 GET operations SHALL be side-effect-free with respect to product resources and governance state, while preserving bounded existing HTTP telemetry and access/denial audit hooks.

#### Scenario: Platform and scoped reads do not mutate

- **GIVEN** authorized P1/P3/P7/P9/P14 actors and stable backing fixtures
- **WHEN** every in-scope GET is executed
- **THEN** it returns schema-valid success, empty, not-found, denial, capability, or dependency behavior from its real source
- **AND** before/after product datastore state is identical
- **AND** no resource, plan, quota policy, user, dashboard, or billing record is created, updated, or deleted

### Requirement: In-scope POST operations are validated, authorized, idempotent, and audited

The five C-08 POST operations SHALL validate before mutation, require their existing platform authorization, apply the published idempotency contract, produce at most one domain effect for a semantic replay, and preserve the existing operation/audit correlation chain.

#### Scenario: Authorized idempotent mutation

- **GIVEN** authorized P1/P14, valid disposable input, and a valid idempotency key
- **WHEN** the same semantic request is submitted twice to an in-scope POST
- **THEN** exactly one durable domain resource/effect is produced
- **AND** replay returns the published replay outcome without a duplicate effect
- **AND** the resulting operation/audit evidence links verified actor, resource, result, request, and correlation

#### Scenario: Invalid request has no effect

- **GIVEN** an authorized actor
- **WHEN** an in-scope POST receives invalid input or a conflicting idempotency-key reuse
- **THEN** the request reaches the registered handler and returns the published validation/conflict outcome
- **AND** no successful domain event, duplicate resource, or partial write is produced
- **AND** the response is not `GW_NO_ROUTE`

#### Scenario: Function effect remains auditable when finalization fails

- **GIVEN** an authorized Function deploy, delete, or rollback that is about to invoke Knative
- **WHEN** the audit/outbox finalization fails after the external effect
- **THEN** a tenant/workspace-bound audit intent already exists durably from before that effect
- **AND** the retry worker converts the expired intent into immutable error evidence and a retryable `function.audit.events` outbox row
- **AND** the attempt cannot disappear merely because the client cannot safely repeat the domain action

#### Scenario: Function audit topic exists before publishing

- **GIVEN** a fresh Kafka installation with automatic topic creation disabled
- **WHEN** the Function audit publisher starts
- **THEN** it idempotently creates `function.audit.events` with explicit partitions, replication, and retention before connecting the producer
- **AND** an existing canonical topic is preserved without recreation

#### Scenario: Unauthorized mutation has no effect

- **GIVEN** a valid constrained or cross-tenant credential
- **WHEN** the actor invokes an in-scope POST
- **THEN** authorization fails before mutation
- **AND** no domain success audit/event is emitted

### Requirement: Contracts, gateway, clients, docs, and packaging remain coherent

The unified OpenAPI, generated family contracts, generated public catalog/reference, gateway reachability, runtime assembly, packaged modules, and existing SDK/console consumers SHALL describe and use the same canonical in-scope operations.

#### Scenario: Deterministic artifact generation

- **WHEN** public API artifacts are generated twice from the candidate source
- **THEN** the second generation produces no diff
- **AND** every in-scope operation has matching method/path/operation ID, request/response schemas, audiences, bindings, capabilities, QoS, retry, and idempotency metadata

#### Scenario: Production-shaped HTTP dispatch

- **GIVEN** the route assembly and module layout used by the control-plane image
- **WHEN** representative authenticated, unauthenticated, denied, not-found, success, and dependency-failure requests are issued across all in-scope families
- **THEN** requests reach the expected packaged handler and contractual outcome
- **AND** no in-scope request fails because a module/export/asset is absent

#### Scenario: Existing client and read-only experience

- **GIVEN** an existing SDK/console consumer of an in-scope operation
- **WHEN** the caller loads or changes tenant/workspace scope
- **THEN** it uses only the canonical path and distinguishes success, real empty, denial, not-found, capability, and dependency outcomes
- **AND** stale data from the prior scope is cleared or ignored
- **AND** an unauthorized read-only persona triggers no avoidable forbidden background call or enabled mutation affordance

#### Scenario: Complete documentation

- **WHEN** P3, P4, P7, P10, P11, or P14 follows the in-scope API reference/runbook
- **THEN** it identifies permissions, scope/capability prerequisites, success/empty/error behavior, pagination or idempotency, audit/correlation evidence, troubleshooting, rollback, and the local-only verification boundary

### Requirement: Route telemetry is bounded and safe

Existing request telemetry for the in-scope routes SHALL use registered route templates and bounded method/status labels, and SHALL NOT introduce C-07 metric families or raw identifiers as metric labels.

#### Scenario: Identifier-safe telemetry

- **GIVEN** requests containing distinct tenant, workspace, correlation, user, and resource IDs
- **WHEN** the in-scope routes emit HTTP metrics or bounded audit evidence
- **THEN** metrics use the canonical route template rather than raw identifiers
- **AND** no credential, secret, PII, tenant ID, workspace ID, correlation ID, or resource ID becomes a metric label

## OUT OF SCOPE

C-01/C-02/C-03/C-04/C-05/C-06/C-07/C-09/C-10/C-11/C-12/C-13/C-14/C-15/C-16/C-17; unrelated `NO_ROUTE` surfaces; role/audience changes; identity normalization; new UI pages; aliases; silent API removal/deprecation; and cluster deployment are not modified by this change.
