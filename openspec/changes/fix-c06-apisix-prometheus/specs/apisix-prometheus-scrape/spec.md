## ADDED Requirements

### Requirement: Prometheus scrape route

The system SHALL serve the internal Prometheus client's `GET /apisix/prometheus/metrics` request through the existing APISIX gateway on port 9080 by proxying to the dedicated exporter at `127.0.0.1:9091`; the existing gateway network/access policy remains in force and no additional listener, Service, or Ingress is created.

#### Scenario: Successful scrape

- **WHEN** the internal Prometheus client sends GET to the exact route
- **THEN** APISIX returns HTTP 200 and the response contains `apisix_` metrics from the dedicated exporter.

#### Scenario: Method or path mismatch

- **WHEN** a request uses another method or path
- **THEN** the request is not proxied to 9091 and follows APISIX's normal routing or error behavior for that request.

### Requirement: Exporter isolation and security

The system SHALL bind the dedicated exporter only to loopback, SHALL not publish port 9091, and SHALL preserve the existing network/access policy for the already-routed 9080 gateway endpoint without adding credentials or PII.

#### Scenario: Direct exporter access

- **WHEN** an external actor attempts to connect to port 9091
- **THEN** the connection is unavailable; only the gateway's loopback proxy can reach it.

#### Scenario: Adversarial path probing

- **WHEN** a P13 adjacent/adversarial actor probes another path or method on the gateway
- **THEN** only the exact GET route is proxied to 9091; no additional exporter listener or route is exposed.

### Requirement: Bounded upstream failure and compatibility

The system SHALL return a bounded gateway error when the loopback exporter is unavailable, preserve the Prometheus target `falcone-apisix:9080`, and permit rollback to the prior route configuration without changing exporter settings.

#### Scenario: Exporter unavailable

- **WHEN** the loopback exporter refuses or times out
- **THEN** APISIX returns a documented 5xx/upstream error within configured timeout bounds and does not leak internal details.

#### Scenario: Docker deployment

- **WHEN** the stack is run with the supported Docker configuration
- **THEN** scraping `falcone-apisix:9080` succeeds and port 9091 remains unpublished.

### Requirement: Observability and documentation

The system SHALL document the gateway scrape endpoint, loopback exporter topology, expected success/error behavior, and rollback procedure for P3 primary operators/SREs, P4 constrained/read-only auditors, P13 adjacent/adversarial actors, and P18 installers. UI, backend, audit, and quota layers are out of scope because this is a gateway/exporter configuration contract.

#### Scenario: Read-only audit

- **WHEN** a constrained auditor inspects the documented surface
- **THEN** documentation identifies only the contracted :9080 endpoint and states that :9091 is loopback-only.
