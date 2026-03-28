# Feature Specification: US-OBS-01-T05 — Console Health Summaries and Internal Degradation Alerts

**Feature Branch**: `029-observability-console-alerts`
**Task**: US-OBS-01-T05
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-01 — Métricas unificadas, dashboards y health checks
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017
**Dependencies**: US-DEP-01, US-GW-04, US-OBS-01-T01, US-OBS-01-T02, US-OBS-01-T03, US-OBS-01-T04
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-01-T01` established the unified metrics stack. `US-OBS-01-T02` defined the canonical
dashboard hierarchy at global, tenant, and workspace scopes. `US-OBS-01-T03` delivered the
component health, readiness, and liveness contract. `US-OBS-01-T04` defined the business and
product metrics vocabulary.

What is still missing is the **console-facing summary layer** and the **internal alerting
capability** that turn those foundations into actionable health and degradation awareness for
operators and tenant owners using the administrative console.

Today the platform can answer granular questions about component health and metric trends through
the observability plane, but no capability synthesizes that information into **at-a-glance health
summaries** suitable for console display or generates **internal alerts** when the platform or a
tenant environment enters a degraded state.

Without this task:

- console users must navigate full dashboards and interpret raw observability data to understand
  whether the platform or their tenant is healthy,
- degradation goes unnoticed until an operator manually inspects health endpoints or dashboard
  panels,
- there is no defined contract for how the console presents aggregated health posture — each view
  risks inventing its own summary semantics,
- and internal teams have no structured alert surface for proactive awareness of health transitions.

This task defines the **console health summary contract** — what summaries must communicate, how
they aggregate health and business signals into a condensed posture, and how they respect scope
boundaries — and the **internal alert contract** — what conditions produce alerts, who receives
them, how they are scoped, and how they avoid noise without hiding genuine degradation.

This task does **not** define the underlying metrics collection, dashboard definitions, health
check contracts, business metric families, or smoke-test verification. It also does **not** define
external public alerting APIs, commercial SLA reporting, or end-user notification channels. It
consumes the T01–T04 foundations and produces the summary and alert layer that sits between those
foundations and the administrative console experience.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Superadmins** need a platform-wide health summary in the console that shows at a glance whether
  the BaaS platform is healthy, partially degraded, or experiencing significant failures — without
  navigating into per-component dashboards first.
- **Tenant owners** need a tenant-scoped health summary that communicates whether their services are
  operating normally or experiencing issues, and whether those issues are tenant-specific or
  platform-wide.
- **SRE and platform operators** need internal degradation alerts that notify them proactively when
  health transitions occur — component unavailability, sustained error rate increases, freshness
  staleness, or business metric anomalies — so they can respond before tenant-visible impact grows.
- **Security and audit stakeholders** need confidence that summary views and alert content respect
  multi-tenant isolation, mask sensitive detail, and produce auditable access records.
- **Downstream smoke-test work (`US-OBS-01-T06`)** needs a stable summary and alert contract to
  verify that console summaries and internal alerts behave as specified.

### Value delivered

- Bridges the gap between raw observability data and actionable console-level health awareness.
- Gives console users immediate posture understanding through condensed, scope-appropriate health
  summaries.
- Enables proactive internal response to degradation through structured alerts instead of manual
  polling of dashboards or health endpoints.
- Preserves multi-tenant isolation at the summary and alert layer, not just at the metric and
  dashboard layers.
- Creates a reusable summary and alert contract for future console evolution, notification
  integrations, and operational runbooks.

---

## 3. In-Scope Capability

This task covers two complementary capabilities: **console health summaries** and **internal
degradation alerts**.

### In scope

#### Console health summary user stories

- Define what a health summary must communicate for each supported scope: platform-global, tenant,
  and workspace.
- Define the aggregation model: how component health states, dashboard signals, and business metric
  posture are synthesized into a single summary status per scope.
- Define the summary status vocabulary — the set of states a summary can report and what each one
  means operationally.
- Define what supporting detail a summary must include beyond the top-level status: degraded
  subsystems, affected capabilities, time since degradation, and freshness of the underlying
  observability data.
- Define how summary freshness is communicated so console users know when the summary itself is
  stale.
- Define scope isolation rules: a tenant summary must not reveal cross-tenant health, platform-only
  degradation detail, or internal component topology.

#### Internal alert user stories

- Define the alert model: what constitutes an alertable health transition versus normal fluctuation.
- Define alert categories aligned with the observability plane: component availability transitions,
  sustained error rate thresholds, freshness staleness, and significant business metric deviations.
- Define alert scoping: which alerts are platform-wide, which are tenant-attributable, and which
  are workspace-attributable.
- Define alert audience and routing rules: who can receive which alert categories based on their
  platform role.
- Define alert lifecycle: acknowledgment, resolution, and suppression semantics so repeated
  degradation does not flood operators.
- Define alert content rules: what information an alert must include, what it must mask or redact,
  and how it references the underlying observability evidence.

### Out of scope

- Underlying metrics collection, scraping, or push topology (T01).
- Dashboard layout, panel definitions, or dashboard navigation (T02).
- Health check endpoint contracts, liveness/readiness probes (T03).
- Business metric families or product signal vocabulary (T04).
- Smoke-test verification of summaries and alerts (T06).
- External public alerting APIs or webhook integrations for end users.
- Commercial SLA calculations, uptime percentages, or billing-related availability reporting.
- Specific UI component design, CSS, or frontend framework decisions.
- Alert threshold numeric values — this task defines the categories and semantics; threshold
  tuning is an operational concern.

---

## 4. User Scenarios & Testing

### User Story 1 — Platform health summary for superadmins (Priority: P1)

As a superadmin viewing the administrative console, I need a platform-wide health summary that
immediately tells me whether the BaaS platform is healthy, degraded, or experiencing critical
failures, so I can decide whether to investigate further or continue with other tasks.

**Why this priority**: The platform-level summary is the single most important entry point for
operational awareness in the console. Without it, every health check requires drilling into
per-component detail.

**Independent Test**: A reviewer can verify that the spec defines mandatory summary fields,
aggregation rules, and status vocabulary for the platform scope, and that the summary is
independently meaningful without requiring navigation into dashboards.

**Acceptance Scenarios**:

1. **Given** all BaaS components report healthy status, **when** the platform health summary is
   generated, **then** it reports a healthy overall status with no degraded subsystems listed.
2. **Given** one or more components report degraded health, **when** the platform health summary is
   generated, **then** it reports a degraded status, lists the affected subsystems and capability
   areas, and includes time-since-degradation information.
3. **Given** the underlying observability data is stale beyond the defined freshness threshold,
   **when** the platform health summary is generated, **then** it clearly indicates that the
   summary is based on stale data and cannot confirm current health.

---

### User Story 2 — Tenant-scoped health summary (Priority: P1)

As a tenant owner viewing my tenant's console area, I need a health summary scoped to my tenant
that tells me whether my services are operating normally, and if not, whether the issue is specific
to my tenant or related to broader platform conditions.

**Why this priority**: Tenant-scoped summaries are essential for multi-tenant trust. Tenant owners
should not need platform-wide visibility or operator skills to understand their own service health.

**Independent Test**: A reviewer can verify that tenant summaries are bounded to tenant-safe signals
only, never reveal cross-tenant information, and distinguish between tenant-local and
platform-attributed degradation.

**Acceptance Scenarios**:

1. **Given** all services within a tenant are healthy, **when** the tenant health summary is
   generated, **then** it reports healthy status for that tenant without exposing any information
   about other tenants.
2. **Given** a platform-wide degradation affects the tenant's services, **when** the tenant health
   summary is generated, **then** it reports degraded status and attributes the cause to platform
   conditions without revealing which specific platform components are affected or exposing internal
   topology.
3. **Given** a tenant-specific issue exists while the platform is otherwise healthy, **when** the
   tenant health summary is generated, **then** it reports degraded status scoped to the tenant
   without implying platform-wide problems.

---

### User Story 3 — Internal degradation alerts for operators (Priority: P1)

As an SRE or platform operator, I need to receive internal alerts when the platform transitions
into a degraded state so I can investigate proactively instead of discovering degradation through
manual dashboard inspection or tenant complaints.

**Why this priority**: Proactive alerting is the primary mechanism for reducing time-to-detection
on degradation incidents. Without it, the observability plane is passive and useful only when
actively inspected.

**Independent Test**: A reviewer can verify that the spec defines alert categories, trigger
conditions, audience routing, and lifecycle rules that are independently meaningful and testable
without the console summary layer.

**Acceptance Scenarios**:

1. **Given** a BaaS component transitions from healthy to degraded or unavailable, **when** the
   alert system evaluates the transition, **then** an internal alert is generated with the affected
   component, scope, severity, and timestamp.
2. **Given** an alert has been generated and the underlying condition resolves, **when** the alert
   system evaluates the resolution, **then** it produces a resolution notification linked to the
   original alert.
3. **Given** a component is oscillating between healthy and degraded, **when** repeated transitions
   occur within a short window, **then** the alert system suppresses duplicate alerts and reports
   the oscillation pattern instead of flooding operators.

---

### User Story 4 — Workspace-level health summary (Priority: P2)

As a workspace operator or delegated support role, I need a workspace-scoped health summary that
highlights the health of services attributable to my workspace so I can distinguish workspace-local
issues from broader tenant or platform conditions.

**Why this priority**: Workspace summaries provide the finest safe granularity but depend on the
same aggregation contract as tenant and platform summaries. They are valuable but secondary to the
broader scope summaries.

**Independent Test**: A reviewer can verify that workspace summaries only include signals safely
attributable to a workspace and do not leak tenant-wide or platform-wide internal detail.

**Acceptance Scenarios**:

1. **Given** workspace-attributable signals are healthy, **when** the workspace summary is
   generated, **then** it reports healthy status limited to workspace-safe observations.
2. **Given** a workspace-attributable signal is degraded while the tenant is otherwise healthy,
   **when** the workspace summary is generated, **then** it reports degraded status scoped to the
   workspace without implying broader tenant or platform issues.

---

### User Story 5 — Tenant-scoped degradation alerts (Priority: P2)

As a tenant owner, I need to receive alerts scoped to my tenant when my services degrade so I can
take action or contact support without waiting for platform operators to notice.

**Why this priority**: Tenant-level alerting extends the internal alert contract to tenant owners
and closes the gap between operator-only awareness and tenant self-service health governance.

**Independent Test**: A reviewer can verify that tenant alerts never expose cross-tenant data,
platform topology, or operator-internal alert detail.

**Acceptance Scenarios**:

1. **Given** a tenant-attributable degradation occurs, **when** the alert system evaluates tenant
   health, **then** a tenant-scoped alert is produced and routed only to authorized recipients
   within that tenant.
2. **Given** a platform-wide degradation is already alerting operators, **when** the same condition
   affects a tenant, **then** the tenant receives a tenant-safe alert that acknowledges degradation
   without revealing platform-internal root cause detail.

---

### Edge Cases

- The observability data feeding the summary is partially stale: some components report fresh
  metrics while others have stopped reporting. The summary must reflect partial staleness
  explicitly instead of presenting the last-known state as current.
- A component is in a degraded-but-not-unavailable state for an extended period. The summary must
  continue to reflect degradation rather than normalizing it after a timeout.
- An alert condition triggers at exactly the boundary of the suppression window. The alert system
  must define deterministic behavior for boundary cases in suppression logic.
- A tenant summary is requested for a tenant with no active workspaces or minimal activity. The
  summary must still produce a valid status rather than erroring or reporting unknown.
- An alert references a component whose health check contract distinguishes degraded from
  unavailable. The alert content must preserve that distinction rather than collapsing both into a
  single failure category.
- A workspace-level summary is requested but the underlying metric cannot be safely attributed to
  workspace scope. The summary must exclude or clearly mark that signal instead of guessing
  workspace ownership.
- Multiple overlapping alerts for related components trigger simultaneously. The alert system must
  allow correlation without merging distinct alerts into a single indistinguishable notification.
- The alert system itself becomes unavailable or delayed. Downstream consumers must not interpret
  the absence of alerts as a confirmation of platform health.

---

## 5. Functional Requirements

### Console health summary requirements

- **FR-001**: The system MUST provide a console health summary at platform-global scope that
  synthesizes component health, dashboard signals, and business metric posture into a single
  aggregated status.
- **FR-002**: The system MUST provide a console health summary at tenant scope that reports only
  tenant-safe signals and never reveals cross-tenant health, component topology, or platform-only
  operational detail.
- **FR-003**: The system MUST provide a console health summary at workspace scope that includes only
  signals safely attributable to a specific workspace.
- **FR-004**: Every health summary MUST use a defined status vocabulary with at minimum three
  states: healthy, degraded, and unavailable, each with documented operational meaning.
- **FR-005**: Every health summary MUST include supporting detail alongside the top-level status:
  the list of degraded subsystems or capability areas, time since the most recent status transition,
  and the number of affected components or signals.
- **FR-006**: Every health summary MUST report the freshness of the underlying observability data
  so consumers know when the summary may be based on stale evidence.
- **FR-007**: When the underlying observability data for any component is stale beyond the defined
  freshness threshold, the summary MUST reflect this explicitly as an unknown or stale-data
  condition rather than reporting the last-known state as current.
- **FR-008**: The summary aggregation model MUST define deterministic rules for how individual
  component health outcomes combine into the overall summary status — including which components
  cause degraded versus unavailable and whether a single degraded component makes the whole summary
  degraded.
- **FR-009**: Tenant-scoped summaries MUST distinguish between tenant-local degradation and
  degradation attributed to platform-wide conditions, without revealing which platform components
  are affected.
- **FR-010**: Workspace-scoped summaries MUST exclude signals that cannot be safely attributed to
  the workspace and MUST NOT infer workspace ownership from ambiguous metric scoping.

### Internal alert requirements

- **FR-011**: The system MUST define an internal alert contract that specifies alert categories,
  trigger semantics, audience routing, content rules, and lifecycle management.
- **FR-012**: Alert categories MUST include at minimum: component availability transitions
  (healthy → degraded, healthy → unavailable, degraded → unavailable), sustained error rate
  breaches, observability data freshness staleness, and significant business metric deviations.
- **FR-013**: Every alert MUST include: alert category, affected scope (platform / tenant /
  workspace), affected component or signal family, severity, timestamp, and a reference to the
  underlying observability evidence.
- **FR-014**: Alert scoping MUST be explicit: platform-wide alerts route to platform operators and
  superadmins, tenant-scoped alerts route only to authorized actors within that tenant, and
  workspace-scoped alerts route only to authorized actors within that workspace.
- **FR-015**: The alert system MUST support suppression of duplicate alerts within a configurable
  suppression window so that oscillating or sustained conditions do not flood recipients.
- **FR-016**: The alert system MUST support resolution notifications: when the triggering condition
  clears, a resolution event linked to the original alert MUST be produced.
- **FR-017**: Alert content MUST respect multi-tenant isolation: tenant-scoped alerts MUST NOT
  reveal cross-tenant detail, platform topology, or operator-internal diagnostic information.
- **FR-018**: Alert content MUST mask or redact sensitive information including credentials, secret
  references, raw user identifiers, and internal infrastructure addresses.

### Shared requirements

- **FR-019**: Both summaries and alerts MUST consume the existing observability contracts from
  T01–T04 as their data sources and MUST NOT bypass those contracts to read raw subsystem metrics
  directly.
- **FR-020**: Access to health summaries and internal alerts MUST be auditable: the system MUST
  record who accessed which summary or received which alert, with tenant and scope context.
- **FR-021**: The summary and alert contracts MUST be consumable through shared internal readers or
  helper interfaces so downstream console and verification work does not parse raw alert or summary
  storage directly.
- **FR-022**: The summary and alert contracts MUST be validated deterministically for scope safety,
  content masking, and alignment with the upstream observability contracts.

### Key Entities

- **Health Summary**: An aggregated posture snapshot at a given scope (platform, tenant, or
  workspace). Attributes: scope, status, degraded components, last transition time, data freshness,
  supporting detail.
- **Internal Alert**: A structured notification produced by a health transition or threshold
  breach. Attributes: category, scope, severity, affected component, timestamp, content, lifecycle
  state (active / acknowledged / resolved / suppressed), linked observability evidence.
- **Alert Suppression Rule**: A scoped time-window constraint that prevents duplicate alerts for
  the same condition within a defined interval.
- **Summary Aggregation Rule**: A deterministic function that maps individual component health
  states to an overall summary status at a given scope.

---

## 6. Business Rules and Governance

- Console health summaries are an operational convenience layer over the existing observability
  plane. They do not replace dashboards, health endpoints, or the underlying metrics contracts.
- Summaries must always be derived from the T01–T04 contracts. No summary may introduce a new
  metric source or health interpretation that is not grounded in those contracts.
- Internal alerts are an internal operational capability. They are not a public API, a commercial
  SLA tool, or an end-user notification system.
- Tenant-scoped summaries and alerts must apply the same least-privilege, isolation, and masking
  rules as the underlying dashboard and health contracts.
- The absence of an alert must never be interpreted as a guarantee of health. Summaries and
  dashboards remain the primary health inspection tools; alerts augment them with proactive
  transitions.
- Alert suppression must balance noise reduction with visibility: suppressed alerts must still be
  queryable and must not silently hide sustained degradation.
- Platform-only summary detail (such as which infrastructure components are affected) must never
  appear in tenant-scoped or workspace-scoped summaries or alerts.
- Summary freshness reporting must be honest. If the system cannot confirm freshness, the summary
  must reflect uncertainty rather than confidence.

---

## 7. Acceptance Criteria

- **AC-001**: A console health summary contract exists that defines summary semantics for
  platform-global, tenant, and workspace scopes.
- **AC-002**: The summary status vocabulary is defined with at least three documented states and
  deterministic aggregation rules.
- **AC-003**: Every summary includes data freshness reporting and handles stale-data conditions
  explicitly.
- **AC-004**: Tenant-scoped summaries distinguish tenant-local from platform-attributed degradation
  without revealing platform internals.
- **AC-005**: Workspace-scoped summaries exclude signals that cannot be safely attributed to the
  workspace.
- **AC-006**: An internal alert contract exists that defines categories, trigger semantics,
  severity, audience routing, and content rules.
- **AC-007**: Alert suppression and resolution lifecycle rules are defined and deterministic.
- **AC-008**: Alert content respects multi-tenant isolation and masks sensitive information.
- **AC-009**: Both summaries and alerts consume only the T01–T04 observability contracts as data
  sources.
- **AC-010**: Access to summaries and alert events is auditable with tenant and scope context.
- **AC-011**: Shared internal readers or helpers expose the summary and alert contracts for
  downstream consumption.
- **AC-012**: Validation exists to detect scope safety, masking, and upstream alignment drift.
- **AC-013**: Architecture documentation is added and discoverable from the reference index.
- **AC-014**: The story task summary documents the delivered scope and residual observability work.

---

## 8. Risks, Assumptions, and Open Questions

### Risks

- **Risk**: Summary aggregation rules become too coarse, hiding real degradation behind a healthy
  overall status.
  - **Mitigation**: require summaries to list degraded subsystems and capability areas alongside the
    top-level status so detail is always available within the summary itself.
- **Risk**: Alert categories expand into commercial SLA or external notification territory.
  - **Mitigation**: keep strict scope boundary — internal alerts only, no public API, no billing
    integration.
- **Risk**: Suppression logic silently hides sustained degradation from operators.
  - **Mitigation**: require suppressed alerts to remain queryable and require the summary layer to
    reflect sustained degradation independently of alert delivery.
- **Risk**: Tenant summaries inadvertently reveal platform topology through degradation attribution.
  - **Mitigation**: require tenant summaries to attribute degradation as platform-condition without
    naming specific internal components or infrastructure detail.

### Assumptions

- The metrics-stack (T01), dashboard (T02), health-check (T03), and business-metrics (T04)
  contracts are stable and available as input surfaces for this task.
- Internal alerts are delivered through an internal channel and do not require external webhook,
  email, or SMS integration in this task.
- Specific numeric thresholds for alert triggering are an operational tuning concern and will be
  configured at deployment time, not specified in this contract.
- The console backend may execute on OpenWhisk, but this spec does not prescribe runtime
  architecture.

### Open questions

- No blocking open questions. Specific threshold values, alert routing channel infrastructure,
  and console UI component design are intentionally deferred to planning and implementation phases.

---

## 9. Success Criteria

- **SC-001**: Console users at platform, tenant, and workspace scopes can obtain an at-a-glance
  health summary from the defined contract without navigating into full dashboards.
- **SC-002**: Internal operators receive proactive degradation alerts when health transitions occur,
  with alert content that is actionable, scoped, and free of sensitive leakage.
- **SC-003**: Tenant-scoped summaries and alerts preserve full multi-tenant isolation and never
  reveal cross-tenant or platform-internal detail.
- **SC-004**: Summary freshness reporting honestly reflects the age and completeness of the
  underlying observability data.
- **SC-005**: The summary and alert contracts are reusable foundations for downstream console
  evolution, smoke-test verification, and future notification integrations.
