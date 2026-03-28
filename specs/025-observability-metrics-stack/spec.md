# Feature Specification: US-OBS-01-T01 — Unified Observability Metrics Stack Integration

**Feature Branch**: `025-observability-metrics-stack`
**Task**: US-OBS-01-T01
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-01 — Métricas unificadas, dashboards y health checks
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017
**Dependencies**: US-DEP-01, US-GW-04
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

The BaaS platform is composed of multiple independently operated subsystems — APISIX (API Gateway),
Kafka (event backbone), PostgreSQL (RDBMS), MongoDB (NoSQL), OpenWhisk (serverless), an
S3-compatible object storage layer, and the control plane itself. Each subsystem produces its own
health signals and operational metrics, but today there is no unified observability plane that
collects, normalizes, and makes those signals available to operators and downstream consumers.

Without this task, platform teams must inspect each component independently to understand overall
system health. Incident detection is slow, correlation across subsystems is manual, and there is no
common metrics surface for dashboards, alerts, or health checks to build on.

This task delivers the **foundational metrics integration layer**: the configuration, conventions,
and collection surface that ensures every BaaS component reports health and operational metrics into
a single observability plane. It does **not** build dashboards, define health-check endpoints,
design business metrics, or create console views — those are covered by sibling tasks T02–T06.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **SRE and platform operators** need a single place to query operational metrics from every BaaS
  subsystem instead of connecting to each component's native monitoring independently.
- **Superadmins** need confidence that the platform's observability foundation is in place before
  enabling tenant-facing health or usage features.
- **Security teams** need assurance that observability data collection respects tenant isolation and
  does not leak cross-tenant operational details through shared metric labels.
- **Downstream sibling tasks (T02–T06)** need a reliable, normalized metrics surface to build
  dashboards, health checks, business metrics, console views, and smoke tests on top of.

### Value delivered

- Establishes a single observability plane that all BaaS components report into.
- Defines the metric naming, labeling, and multi-tenant tagging conventions that all downstream
  observability work depends on.
- Makes component health queryable from one surface, eliminating the need to inspect each subsystem
  in isolation.
- Enables the platform to detect cross-component degradation patterns that are invisible when
  monitoring each subsystem separately.
- Provides the prerequisite foundation for dashboards, alerts, health endpoints, and business
  metrics without coupling to any of those deliverables.

---

## 3. In-Scope Capability

This task covers the **integration of metrics from all BaaS subsystems into a common observability
collection plane**, including the conventions and multi-tenant considerations that make those metrics
safe and useful.

### In scope

- Define the set of BaaS subsystems whose metrics must be collected: APISIX, Kafka, PostgreSQL,
  MongoDB, OpenWhisk, S3-compatible storage, and the control plane.
- Establish metric naming and labeling conventions for the platform, including a mandatory tenant
  isolation label strategy that prevents cross-tenant metric leakage.
- Define what "reports health and metrics to the observability plane" means for each subsystem:
  which metric families are expected, at what granularity, and with what freshness.
- Specify the collection topology: how metrics flow from each subsystem to the central
  observability surface (scrape targets, push endpoints, or event-driven collection as appropriate
  per component).
- Specify the minimal metric categories per subsystem: availability/up status, request/operation
  throughput, error rates, and latency distributions.
- Establish conventions for metric metadata that supports multi-tenant filtering without exposing
  tenant-internal data to other tenants or to operators who lack the appropriate scope.
- Document the expected metric retention and resolution policy at the collection layer.

### Out of scope

- Building or configuring dashboards (US-OBS-01-T02).
- Implementing health, readiness, and liveness check endpoints (US-OBS-01-T03).
- Defining business-level product metrics beyond infrastructure observability (US-OBS-01-T04).
- Creating console views or alert rules for health and degradation (US-OBS-01-T05).
- Writing smoke tests for observability scraping and dashboard correctness (US-OBS-01-T06).
- Selecting or mandating a specific monitoring tool, time-series database, or visualization product.
- Changing the behavior or API surface of any BaaS subsystem.

---

## 4. User Scenarios & Testing

### User Story 1 — SRE queries unified metrics for all subsystems (Priority: P1)

An SRE needs to verify that every BaaS component is reporting operational metrics into the common
observability plane after a platform deployment or upgrade.

**Why this priority**: If metrics are not flowing from all components, no downstream observability
feature (dashboards, alerts, health checks) can function. This is the foundational integration
proof point.

**Independent Test**: After deployment, query the observability plane and confirm that metric
families exist for each of the seven declared subsystems, with recent timestamps.

**Acceptance Scenarios**:

1. **Given** a fully deployed BaaS environment, **When** the SRE queries the observability plane
   for APISIX metrics, **Then** request throughput, error rate, and latency metrics are present
   with data points fresher than the declared collection interval.
2. **Given** a fully deployed BaaS environment, **When** the SRE queries for Kafka, PostgreSQL,
   MongoDB, OpenWhisk, storage, and control-plane metrics, **Then** each subsystem has at least
   availability, throughput, error, and latency metric families present.
3. **Given** a subsystem that is temporarily unreachable, **When** the observability plane attempts
   collection, **Then** the collection failure is itself visible as a scrape or push error metric
   rather than silently missing data.

---

### User Story 2 — Operator filters metrics by tenant without cross-tenant leakage (Priority: P1)

A platform operator with tenant-scoped access needs to query metrics for a specific tenant without
seeing another tenant's operational data.

**Why this priority**: Multi-tenancy is a platform invariant. If the metrics layer leaks tenant
boundaries, the entire observability surface is unsafe for downstream use in tenant-facing
dashboards or console views.

**Independent Test**: Query the observability plane for tenant A's metrics and verify that no
metric series belonging to tenant B appears in the result set, and vice versa.

**Acceptance Scenarios**:

1. **Given** two tenants producing traffic through APISIX and storage, **When** the operator
   queries metrics filtered by tenant A's identifier, **Then** only tenant A's metric series are
   returned.
2. **Given** a metric that is inherently infrastructure-global (e.g., Kafka broker health),
   **When** the operator queries with a tenant filter, **Then** the global metric is either
   excluded from tenant-scoped views or clearly marked as platform-level.
3. **Given** a superadmin with platform-wide scope, **When** they query without a tenant filter,
   **Then** they can see aggregated metrics across all tenants.

---

### User Story 3 — Downstream task author uses documented conventions (Priority: P2)

A developer working on dashboards (T02), health checks (T03), or business metrics (T04) needs to
understand the metric naming, labeling, and collection conventions established by this task.

**Why this priority**: Convention documentation is the coordination surface between this task and
all sibling tasks. Without it, each downstream task would invent its own conventions.

**Independent Test**: Read the delivered conventions and verify that metric name format, required
labels, tenant-isolation strategy, and per-subsystem metric families are unambiguously defined.

**Acceptance Scenarios**:

1. **Given** the delivered metric conventions, **When** a developer looks up the expected metric
   name for APISIX request latency, **Then** the naming pattern, required labels, and histogram
   bucket strategy are documented.
2. **Given** the delivered collection topology, **When** a developer needs to add a new metric
   family for a subsystem, **Then** the conventions document explains how to register it
   consistently with existing metrics.

---

### Edge Cases

- A subsystem does not natively expose metrics in a common format and requires an exporter or
  adapter pattern to bridge into the observability plane.
- A subsystem produces high-cardinality labels (e.g., per-request-path metrics from APISIX) that
  could overwhelm the collection layer if not bounded.
- A tenant is created or deleted, and the metric label set must reflect the change without leaving
  orphaned series.
- The control plane itself is the source of metrics, creating a circular dependency between the
  observed system and the observer.
- Workspace-level metric segregation is desired but the subsystem only provides tenant-level
  granularity natively.
- Metrics collection infrastructure fails, and the platform must degrade gracefully without
  cascading failures into the data plane.

---

## 5. Functional Requirements

- **FR-001**: The observability plane MUST collect metrics from all seven declared BaaS subsystems:
  APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, S3-compatible storage, and the control plane.
- **FR-002**: Every collected metric MUST follow the platform's metric naming convention,
  documented as part of this task's deliverables.
- **FR-003**: Every tenant-attributable metric MUST carry a tenant isolation label that supports
  filtering and access control at the query layer.
- **FR-004**: Metrics that are inherently infrastructure-global MUST be distinguishable from
  tenant-scoped metrics through labeling or namespace conventions.
- **FR-005**: Each subsystem MUST report at minimum: an availability/up gauge, a request or
  operation throughput counter, an error rate counter, and a latency distribution (histogram or
  summary).
- **FR-006**: The collection topology MUST document how each subsystem's metrics reach the
  observability plane (scrape, push, or event-driven), including the expected collection interval
  and acceptable staleness window.
- **FR-007**: The platform MUST expose a collection-health meta-metric that indicates whether
  scraping or ingestion from each subsystem is succeeding or failing.
- **FR-008**: Metric labels MUST NOT include high-cardinality unbounded values (such as raw request
  paths or user identifiers) without explicit cardinality bounding rules.
- **FR-009**: The metric conventions MUST define how workspace-level granularity is represented when
  the subsystem supports it, and how to handle subsystems that only support tenant-level
  granularity.
- **FR-010**: The delivered conventions document MUST be placed in the architecture reference set
  and linked from the repository documentation index.
- **FR-011**: Metric retention and resolution expectations at the collection layer MUST be
  documented as platform operating targets, not as external SLA commitments.

---

## 6. Business Rules and Governance

- Observability data collection must respect the platform's multi-tenant isolation model. No metric
  query path may return another tenant's operational data unless the caller has explicit
  platform-wide scope.
- Metric naming and labeling conventions are platform-level governance: all subsystems and future
  integrations must conform to the conventions established by this task.
- Metrics collection must not degrade the data-plane availability of any subsystem. Collection
  failures must be visible but must not cascade into service disruptions.
- Audit and traceability requirements from the platform's security model apply to the observability
  plane itself: access to tenant-scoped metrics is a security-relevant operation.
- The conventions delivered by this task are the authoritative input for sibling tasks T02–T06.
  Downstream tasks must not invent parallel naming or labeling schemes.

---

## 7. Acceptance Criteria

1. The observability plane collects metrics from all seven declared subsystems.
2. A documented metric naming and labeling convention exists in the architecture reference set.
3. Every tenant-attributable metric carries a tenant isolation label.
4. Infrastructure-global metrics are distinguishable from tenant-scoped metrics.
5. Each subsystem contributes at least availability, throughput, error, and latency metric families.
6. The collection topology per subsystem is documented, including collection intervals and
   staleness windows.
7. A collection-health meta-metric is defined for monitoring scrape/push success per subsystem.
8. Cardinality bounding rules for metric labels are documented.
9. Workspace-level granularity handling is specified.
10. The conventions document is linked from the architecture reference index.
11. Metric retention and resolution expectations are documented as internal operating targets.
12. No BaaS subsystem behavior or API surface is changed by this task.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- All seven subsystems either natively expose metrics or can be fronted by an exporter/adapter
  without modifying the subsystem's own API surface.
- The platform will adopt a pull-based (scrape) or push-based collection model, or a hybrid; this
  task specifies the conventions and topology but does not mandate a specific product.
- Tenant isolation at the metric layer can be enforced through label-based query filtering, which
  is a standard capability of common observability backends.
- Prior tasks in US-DEP-01 and US-GW-04 have established the deployment and gateway foundations
  that this task depends on for infrastructure availability.

### Risks

- **Exporter gaps**: Some subsystems (e.g., OpenWhisk, certain S3-compatible storage
  implementations) may have immature or incomplete native metrics exporters, requiring custom
  adapter work during implementation.
- **Cardinality explosion**: APISIX and Kafka can produce very high-cardinality metric series if
  labels are not carefully bounded. The conventions must address this explicitly.
- **Convention drift**: If downstream tasks begin implementation before the conventions from this
  task are finalized, inconsistent naming or labeling may emerge.
- **Circular observability**: The control plane observing itself introduces a dependency loop that
  must be handled gracefully during bootstrap and failure scenarios.

### Open Questions

- No blocker-level open question prevents specification from proceeding. The main follow-up during
  implementation will be confirming the exporter maturity for each subsystem and adjusting the
  collection topology accordingly.

---

## 9. Success Criteria

- **SC-001**: An operator can query one observability surface and retrieve recent metrics from all
  seven BaaS subsystems without connecting to any subsystem's native monitoring independently.
- **SC-002**: Tenant-scoped metric queries return only the requesting tenant's data, verified by
  cross-tenant query isolation tests.
- **SC-003**: The delivered conventions document is sufficient for sibling task authors (T02–T06)
  to build dashboards, health checks, and business metrics without ambiguity about metric names,
  labels, or collection topology.
- **SC-004**: Collection failures for any single subsystem are visible in the observability plane
  itself and do not cause silent data gaps.
