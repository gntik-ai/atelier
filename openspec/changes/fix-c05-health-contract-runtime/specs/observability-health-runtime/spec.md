# observability-health-runtime

## ADDED Requirements

### Requirement: Control-plane serves the complete health contract
The control-plane internal HTTP listener SHALL instantiate and serve the checked-in observability health contract, including `/livez` and exactly six canonical internal aggregate/component exposures, while preserving `/healthz` and `/readyz` compatibility.

#### Scenario: Canonical routes are reachable
- **WHEN** an internal caller requests each canonical route
- **THEN** it receives a contract-valid JSON response, a correlation ID, and the route's documented HTTP status rather than 404
- **AND** `/healthz` and `/readyz` remain available with existing semantics and `schemaReadiness`

#### Scenario: Liveness is process-only
- **WHEN** PostgreSQL or another dependency is unavailable and `/livez` is requested
- **THEN** liveness evaluates only process/server health and does not perform or await a PostgreSQL check

### Requirement: Health evidence is dependency-aware and fail-closed
Health builders SHALL use injectable adapters for `control_plane`, PostgreSQL, and every declared component; an absent, timed-out, or failing adapter SHALL yield explicit sanitized `unknown` or `stale` evidence and SHALL NOT be represented as healthy or ready.

#### Scenario: Required dependency failure
- **WHEN** PostgreSQL times out during readiness
- **THEN** PostgreSQL is reported non-healthy with bounded error evidence, the aggregate is not ready, and the request completes within the configured timeout budget

#### Scenario: Missing optional component adapter
- **WHEN** a component has no adapter or only expired cached evidence
- **THEN** that component is reported as stable `unknown`/`stale`, never healthy, and aggregate precedence is applied deterministically

#### Scenario: Sanitized response
- **WHEN** an adapter returns an internal exception containing credentials, SQL, or host data
- **THEN** the response omits those details and exposes only contract-approved reason/status fields

### Requirement: Aggregation and response governance are canonical
The service SHALL apply the contract's documented status precedence and required-dependency rules, validate every response against the contract schema, propagate or generate a correlation ID, bound work and payload size, and perform read-only checks without datastore writes.

#### Scenario: Aggregate precedence
- **WHEN** evidence includes unhealthy, stale, unknown, and healthy components
- **THEN** the aggregate status follows canonical precedence (unhealthy/error, then stale, then unknown, then healthy), with readiness requiring all required dependencies healthy

#### Scenario: Correlated read-only audit
- **WHEN** an auditor performs a bounded probe with a correlation ID
- **THEN** the same ID is returned and no datastore mutation, audit write, or new metric family/label occurs

### Requirement: Internal exposure is not public API
Canonical internal routes SHALL be reachable only through the existing internal topology/network path and SHALL NOT be registered in APISIX or consumed by the SPA; the implementation SHALL NOT claim mTLS where none exists.

#### Scenario: Anonymous public-edge caller
- **WHEN** an anonymous caller reaches the public APISIX edge or SPA route catalog
- **THEN** no canonical internal health route is exposed or proxied

### Requirement: Packaging and deployment use one source of truth
Docker packaging SHALL include the contract and runtime validators, and deployment configuration SHALL map liveness/readiness probes to the canonical source-of-truth paths.

#### Scenario: Packaging regression
- **WHEN** the control-plane image is built
- **THEN** contract assets are present and validation fails if they are missing or stale

#### Scenario: Probe mapping
- **WHEN** deployment manifests are rendered
- **THEN** liveness maps to `/livez`, readiness maps to `/readyz`, and no internal canonical route is published through the gateway

## OUT OF SCOPE

C-07 metric families/labels, C-08 non-health routes, and live-cluster deployment changes are not modified by this change.
