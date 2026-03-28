# Feature Specification: US-OBS-01-T03 — Component Health, Readiness, and Liveness Checks

**Feature Branch**: `027-observability-health-checks`
**Task**: US-OBS-01-T03
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-01 — Métricas unificadas, dashboards y health checks
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017
**Dependencies**: US-DEP-01, US-GW-04, US-OBS-01-T01, US-OBS-01-T02
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-01-T01` established the normalized observability metrics plane and `US-OBS-01-T02`
established the canonical dashboard hierarchy for `global`, `tenant`, and `workspace` health views.
What is still missing is the contract that turns raw subsystem posture into an operationally usable
health surface for orchestration and day-two operations.

Today the platform may collect metrics from APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk,
storage, and the control plane, but there is no single agreed definition of what each component
must report as **liveness**, **readiness**, and broader **health**. Without that contract,
orchestration systems cannot make consistent restart or rollout decisions, operators cannot compare
probe outcomes across components, and future console or alerting work risks reinterpreting health in
incompatible ways.

This task delivers the **behavioral contract for component health checks** across the seven required
BaaS subsystems. It defines which probe classes exist, what each one means, how component outcomes
are exposed for orchestration and operations, how sensitive dependency detail is masked or redacted,
and how the probe outcomes project into the observability plane. It does **not** implement live
alert rules, business KPIs, smoke verification, or console summary UI. It also does **not** claim a
public external API for health inspection; the exposure is an internal operational capability.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Kubernetes / OpenShift orchestration** needs liveness and readiness signals with stable,
  machine-readable semantics so restart and rollout behavior is based on one canonical contract.
- **SRE and platform operators** need a component-by-component operational health surface that is
  richer than process-up checks and that can explain degraded versus unavailable posture.
- **Superadmins and internal support roles** need a safe way to inspect component health without
  leaking secrets, raw credentials, or cross-tenant context.
- **Security and audit stakeholders** need traceable access to health surfaces and explicit rules
  for redacting sensitive dependency failures, topology hints, and credential-bearing error detail.
- **Downstream observability tasks (`US-OBS-01-T04` through `US-OBS-01-T06`)** need a canonical
  probe contract so business metrics, console summaries, internal alerts, and smoke tests reuse the
  same health semantics.

### Value delivered

- Defines one canonical meaning for `liveness`, `readiness`, and `health` across all seven
  subsystems.
- Makes component health consumable by orchestration and by operators without inventing one-off
  probe semantics per service.
- Preserves multi-tenant safety, masking, and traceability when health information is exposed.
- Connects probe outcomes to the existing observability plane so health can be queried, summarized,
  and correlated consistently.
- Creates a reusable baseline for future alerting, console, and smoke-test work without expanding
  scope into those tasks now.

---

## 3. In-Scope Capability

This task covers the **definition and bounded implementation surface of component liveness,
readiness, and health checks** for APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the
control plane.

### In scope

- Define three canonical probe classes for each required subsystem:
  - `liveness` — whether the component process or managed runtime is alive enough to avoid restart
    loops caused by transient dependency loss.
  - `readiness` — whether the component is able to serve its intended platform role safely right
    now.
  - `health` — the broader operational posture, including degraded-but-running states and important
    dependency outcomes.
- Define the machine-readable component health contract that operations and orchestration consume.
- Define the required component catalog for APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk,
  storage, and the control plane.
- Define the minimum response shape, status model, dependency reporting, timestamps, and
  correlation/audit fields for health probe results.
- Define the internal exposure model for aggregate platform checks and per-component checks used by
  orchestration and operators.
- Define how sensitive dependency detail, credentials, topology hints, and cross-tenant context are
  masked or redacted in health outputs.
- Define how component probe outcomes project into the observability plane and align with the
  existing metrics-stack baseline.
- Define how health signals interact with the dashboard semantics established in
  `US-OBS-01-T02`, especially around stale, degraded, unavailable, and inherited states.
- Define bounded helper surfaces and validation rules that keep the new health baseline discoverable
  and internally consistent.

### Out of scope

- Public external health APIs for tenant developers or end users.
- Business/product KPI definition (`US-OBS-01-T04`).
- Console-facing summary views and internal alert presentation (`US-OBS-01-T05`).
- Smoke tests for live scraping, probes, or dashboard rendering (`US-OBS-01-T06`).
- Pager duty, escalation, or incident-routing workflows.
- Full Kubernetes manifest generation or live deployment of probe handlers.
- Cross-service remediation automation triggered by probe failures.

---

## 4. User Scenarios & Testing

### User Story 1 — Orchestration consumes stable liveness/readiness semantics (Priority: P1)

A platform operator needs each required component to expose canonical liveness and readiness
semantics so Kubernetes/OpenShift can make safe restart and rollout decisions without component-
specific guesswork.

**Why this priority**: If liveness and readiness are inconsistent, the platform can flap, restart
healthy-but-dependent components unnecessarily, or route traffic to components that are not actually
ready.

**Independent Test**: Inspect the component health contract and verify that every required
subsystem defines `liveness`, `readiness`, and `health`, plus a consistent exposure model for
aggregate and per-component operational checks.

**Acceptance Scenarios**:

1. **Given** the observability health contract for the platform, **When** an operator inspects the
   component catalog, **Then** APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the
   control plane each define canonical liveness, readiness, and health behavior.
2. **Given** a dependency outage that should block traffic but not imply a dead process,
   **When** readiness is evaluated, **Then** the component may become `not_ready` or `degraded`
   without being misreported as failed liveness.
3. **Given** a component is alive but an internal prerequisite is missing for safe service,
   **When** orchestration consults readiness, **Then** the readiness outcome communicates that the
   component must not yet receive or continue serving workload.

---

### User Story 2 — Operations inspects safe component health details (Priority: P1)

An SRE needs a per-component health surface that explains whether a subsystem is healthy,
degraded, unavailable, or unknown, while masking secrets and preserving auditability.

**Why this priority**: Process-up checks alone are too shallow for operations. Operators need a
richer summary, but the platform cannot leak sensitive internal details in the process.

**Independent Test**: Inspect a component health definition and verify that it includes operational
status, dependency summaries, redaction rules, timestamps, and correlation/audit context.

**Acceptance Scenarios**:

1. **Given** a component suffers partial dependency degradation, **When** an operator inspects the
   component health result, **Then** the response distinguishes degraded operational posture from a
   fully unavailable component.
2. **Given** a dependency failure includes sensitive endpoint, credential, or topology detail,
   **When** the health result is exposed for operations, **Then** that detail is masked or reduced
   to safe error classes instead of leaking raw internals.
3. **Given** an operator requests component health, **When** the result is produced, **Then** the
   outcome remains attributable through actor, probe type, component, scope, and correlation
   context.

---

### User Story 3 — Observability consumers correlate health and dashboard posture (Priority: P2)

A downstream observability consumer needs component health probe outcomes to align with the common
metrics plane and dashboard semantics so health views do not drift from probe reality.

**Why this priority**: T03 must feed later observability work. If health checks and dashboard
semantics diverge, later alerting and console work will become inconsistent.

**Independent Test**: Verify that the health-check contract maps probe outcomes into the
observability plane and preserves the same subsystem set and status semantics expected by
`US-OBS-01-T02`.

**Acceptance Scenarios**:

1. **Given** the observability metrics-stack and dashboard contracts already exist, **When** the
   health-check contract is evaluated, **Then** the same subsystem catalog and compatible status
   semantics are reused rather than redefined independently.
2. **Given** a component health result is exposed to the observability plane, **When** dashboards or
   later alerting work consume it, **Then** they can distinguish current healthy, degraded,
   unavailable, and unknown/stale posture consistently.
3. **Given** a component does not support tenant/workspace-safe detail for a probe result,
   **When** the result is projected for narrower operational views, **Then** the projection keeps
   platform/tenant/workspace boundaries explicit and conservative.

---

### Edge Cases

- A component is live but not ready because a required dependency is unavailable; liveness and
  readiness must remain distinct.
- A component returns degraded health because one non-fatal dependency is impaired while primary
  traffic still flows.
- Probe collection is stale or missing; consumers must not confuse unknown/stale probe posture with
  confirmed healthy state.
- A probe failure includes sensitive hostnames, credentials, object keys, or tenant-specific
  identifiers; the exposed health detail must redact them.
- A subsystem supports only platform-global probe semantics, while tenant/workspace consumers still
  need safe inherited visibility without fabricated local precision.
- Orchestration needs a deterministic aggregate readiness or liveness summary across the seven
  required subsystems, even when one component is temporarily unknown.
- A suspended or deleted tenant/workspace should not cause the platform to imply healthy tenant- or
  workspace-scoped service behavior that is no longer active.
- Partial rollouts or maintenance windows may intentionally mark a component not ready while it
  remains live and observable.

---

## 5. Functional Requirements

- **FR-001**: The platform MUST define canonical `liveness`, `readiness`, and `health` probe
  semantics for APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the control plane.
- **FR-002**: The platform MUST expose both aggregate platform-level probe views and per-component
  probe views for internal orchestration and operational use.
- **FR-003**: Every component probe result MUST include a machine-readable component identifier,
  probe type, operational status, observed timestamp, and summary outcome.
- **FR-004**: The readiness contract MUST distinguish `alive but not ready` from `dead or
  unavailable` so orchestration behavior can remain safe.
- **FR-005**: The broader health contract MUST support at least `healthy`, `degraded`,
  `unavailable`, and `unknown` posture rather than collapsing all non-healthy states into one
  failure bucket.
- **FR-006**: Component health results MUST allow dependency-level summaries, but those summaries
  MUST remain redacted or normalized when raw detail would leak credentials, topology, or
  cross-tenant information.
- **FR-007**: Access to operational health outputs MUST preserve actor identity, requested probe
  type, component, scope context, and correlation context for audit and traceability.
- **FR-008**: The health-check capability MUST reuse the subsystem catalog from the unified
  observability metrics stack and MUST not define a conflicting set of components.
- **FR-009**: Probe outcomes MUST define how they project into the observability plane so later
  dashboards, alerting, and smoke checks consume one canonical health signal model.
- **FR-010**: The health-check capability MUST align with the dashboard semantics from
  `US-OBS-01-T02`, including conservative handling of degraded, unavailable, inherited, stale, and
  unknown states.
- **FR-011**: Internal operational exposures for health checks MUST remain clearly marked as
  internal/platform-only and MUST not imply a new public external API surface.
- **FR-012**: Aggregate platform readiness and liveness views MUST define deterministic behavior for
  mixed-state outcomes across components.
- **FR-013**: The contract MUST define how stale or missing probe results are represented so
  operations can distinguish telemetry failure from confirmed component failure.
- **FR-014**: Tenant/workspace-bounded operational views, when present, MUST preserve the same
  multi-tenant isolation rules established for the observability plane and dashboards.
- **FR-015**: The implementation artifacts for this task MUST include deterministic validation,
  discoverable documentation, and bounded helper surfaces so downstream work can consume the health
  baseline without reading raw contract files directly.

---

## 6. Business Rules and Governance

- Liveness is intentionally narrow. Dependency loss alone must not automatically mean a component is
  dead.
- Readiness governs whether a component should receive or continue serving work safely. It may fail
  before liveness fails.
- Health is broader than readiness and may surface degraded-but-serving states that remain valuable
  for operations.
- Sensitive failure detail must be masked, summarized, or normalized into stable error classes
  before exposure to shared operational consumers.
- Probe outputs are operationally significant and must preserve auditability through actor,
  correlation, component, and scope metadata.
- Health exposure must remain conservative for tenant/workspace views. Where workspace-safe or
  tenant-safe detail cannot be proven, the system should fall back to inherited or platform-level
  posture rather than fabricate local precision.
- Probe semantics must remain compatible with the observability dashboard model so later console and
  alerting work can reuse them without reinterpretation.
- The health baseline should remain additive and contract-driven. Future work may add rendering,
  alerts, or smoke tests, but should not replace the canonical health semantics defined here.

---

## 7. Acceptance Criteria

1. A canonical health-check contract exists for APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk,
   storage, and the control plane.
2. The contract defines distinct `liveness`, `readiness`, and `health` semantics for every required
   component.
3. The contract defines both aggregate platform exposures and per-component exposures for internal
   orchestration and operations.
4. Component health results include machine-readable identity, probe type, status, timestamps, and
   audit/correlation context requirements.
5. The contract defines how degraded, unavailable, unknown, and stale probe outcomes are
   represented without collapsing them into one ambiguous state.
6. Sensitive dependency details are explicitly masked or normalized before exposure.
7. The health-check baseline reuses the subsystem catalog from `US-OBS-01-T01` and remains
   compatible with the dashboard semantics from `US-OBS-01-T02`.
8. Probe outcomes define how they project into the observability plane for downstream consumers.
9. The bounded implementation remains internal/operational and does not introduce a new public API
   commitment.
10. Deterministic validation, discoverable documentation, and shared helper accessors are part of
    the delivered increment.
11. This task does not implement business metrics, console summary UI, alert routing, or smoke
    tests.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- `US-OBS-01-T01` remains the authoritative source for subsystem coverage and the observability
  metrics vocabulary.
- `US-OBS-01-T02` remains the authoritative source for scope hierarchy and dashboard health-state
  expectations.
- Not every subsystem will expose identical native dependency detail, so the contract must prefer a
  normalized platform-managed representation over vendor-specific raw responses.
- Downstream tasks will consume internal contracts and helpers instead of reading ad hoc probe
  output shapes directly.

### Risks

- **False restart risk**: if readiness is modeled too aggressively as liveness, orchestration could
  restart components that are merely dependency-blocked.
- **Information leak risk**: raw dependency failure detail can expose credentials, topology, or
  cross-tenant context if masking rules are weak.
- **Semantic drift risk**: dashboards, alerts, and smoke tests may later reinterpret health unless
  this task defines one canonical baseline.
- **Overclaim risk**: the repo could accidentally imply public or live runtime endpoint guarantees
  that are not yet implemented.

### Open Questions

- No blocker-level question prevents this specification from proceeding. The main implementation
  choice is how much of the health baseline should live in one dedicated health-check contract
  versus additive extensions to the metrics-stack contract; either way, downstream consumers must
  see one coherent source of truth.

---

## 9. Success Criteria

- **SC-001**: Platform orchestration can rely on one canonical definition of `liveness` and
  `readiness` across all seven required BaaS subsystems.
- **SC-002**: Operators can inspect per-component health posture without exposing secrets,
  credential-bearing errors, or cross-tenant operational detail.
- **SC-003**: Downstream observability consumers can reuse one health signal model that aligns with
  both the metrics plane and the dashboard hierarchy.
- **SC-004**: Mixed-state outcomes such as `alive but not ready`, `degraded but serving`, and
  `unknown because probe data is stale` are distinguishable to operations.
- **SC-005**: Future observability work can build alerts, console summaries, and smoke tests on top
  of this health baseline without redefining component probe semantics.
