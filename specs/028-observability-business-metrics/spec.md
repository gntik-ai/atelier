# Feature Specification: US-OBS-01-T04 — Business and Product Metrics in the Observability Plane

**Feature Branch**: `028-observability-business-metrics`
**Task**: US-OBS-01-T04
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-01 — Métricas unificadas, dashboards y health checks
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017
**Dependencies**: US-DEP-01, US-GW-04, US-OBS-01-T01, US-OBS-01-T02, US-OBS-01-T03
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-01-T01` established the common observability plane for infrastructure and control-plane
signals. `US-OBS-01-T02` defined how that plane is consumed through global, tenant, and workspace
health dashboards. `US-OBS-01-T03` defined the canonical component liveness, readiness, and health
baseline.

What is still missing is the **business and product signal layer** for the same plane.
Today the platform can describe whether APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage,
and the control plane are healthy, but it cannot yet describe whether the product is being used,
how usage is distributed across tenants and workspaces, or whether business activity is shifting in
a way that matters to operations, product, quota, metering, or billing flows.

Without this task:

- the observability plane remains infrastructure-centric,
- downstream quota, metering, and billing work must invent its own usage vocabulary,
- product-impact analysis during incidents stays manual,
- tenant owners cannot inspect safe, scoped usage trends from the same observability baseline,
- and the story-level expectation of “technical and business observability in one plane” remains
  incomplete.

This task defines the **business and product metrics contract** for the BaaS platform. It specifies
which business signals must exist, how they are categorized, how they respect tenant/workspace
scope, how they avoid sensitive or high-cardinality leakage, and how they remain compatible with the
existing observability metrics, dashboards, and health semantics.

This task does **not** define dashboards, alert thresholds, console widgets, health endpoints,
runtime smoke checks, or commercial billing logic. It defines the business signal vocabulary that
those later capabilities must consume.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Superadmins** need platform-wide business posture signals such as active tenants, active
  workspaces, workload mix, API consumption, function activity, and storage usage trends.
- **Tenant owners** need tenant-bounded visibility into their own usage and adoption without seeing
  any cross-tenant activity.
- **SRE and platform operators** need to correlate technical degradation with product-level impact,
  such as a drop in request throughput, workspace activity, or serverless execution volume.
- **Security and audit stakeholders** need confidence that product metrics preserve masking,
  traceability, and least-privilege scope in the same way as technical observability signals.
- **Metering, quota, and billing-oriented flows** need a normalized, reusable usage vocabulary rather
  than reading raw subsystem metrics directly.
- **Downstream observability tasks (`US-OBS-01-T05` and `US-OBS-01-T06`)** need a stable business
  metrics baseline for summaries, alerts, and smoke verification.

### Value delivered

- Extends the unified observability plane from technical health into product and consumption health.
- Creates one canonical vocabulary for business usage signals across API, data, storage, events,
  auth, and workspace lifecycle activity.
- Preserves multi-tenant isolation and bounded-cardinality rules for product metrics.
- Enables later quota, metering, and console work to build on an agreed contract instead of
  reinventing signal definitions.
- Improves incident triage by allowing operators to correlate business impact with infrastructure
  posture from the same observability plane.

---

## 3. In-Scope Capability

This task covers the **definition of business and product metric families** for the observability
plane.

### In scope

- Define business metric categories for:
  - tenant lifecycle and activation,
  - workspace lifecycle and activity,
  - API usage and request mix,
  - authentication and authorization activity,
  - serverless/function execution usage,
  - PostgreSQL and MongoDB product consumption,
  - storage usage and transfer activity,
  - realtime and event activity.
- Define how those metrics align with the existing scope model: `platform`, `tenant`, and
  `workspace`.
- Define which product metrics are allowed to be platform-only, tenant-attributable, or
  workspace-attributable.
- Define naming, required labels, and safe aggregation rules for business metrics.
- Define rules that distinguish business metrics from infrastructure-only metrics.
- Define freshness, audit, masking, and traceability expectations for business metrics.
- Define how business metrics become consumable by downstream dashboards, summaries, alerts,
  metering, and smoke verification.

### Out of scope

- Dashboard layout, widgets, and navigation behavior.
- Alert thresholds or alert routing.
- Public APIs or new console UI endpoints.
- Runtime billing calculations, invoices, or quota enforcement actions.
- Detailed data warehouse or long-term analytics exports.
- Smoke tests or live observability verification.

---

## 4. User Scenarios & Testing

### User Story 1 — Platform business posture (Priority: P1)

As a superadmin, I need platform-level business metrics in the same observability plane so I can
see whether the platform is being actively used and whether product activity shifts during incidents
or releases.

**Why this priority**: Without a platform-wide business view, the observability plane only answers
whether systems are technically up, not whether the product is active or impacted.

**Independent Test**: A platform operator can inspect the contract and identify required business
metric families, their categories, their scope rules, and their required labels without needing any
other feature.

**Acceptance Scenarios**:

1. **Given** the observability business metrics contract, **when** a platform operator inspects the
   defined categories, **then** the contract lists business metrics for tenant/workspace lifecycle,
   API activity, auth activity, functions, storage, data services, and realtime/events.
2. **Given** a platform-only business signal, **when** it is declared in the contract, **then** it
   is explicitly marked as platform scope and is not implied to be tenant-visible.

### User Story 2 — Tenant-bounded usage visibility (Priority: P1)

As a tenant owner, I need tenant-safe business metrics so I can understand usage and growth inside
my tenant without learning anything about other tenants.

**Why this priority**: Tenant-bounded usage visibility is required for multi-tenant trust and for
future governance, quota, and commercial workflows.

**Independent Test**: A reviewer can verify that tenant-attributable metrics always require tenant
scope labels and cannot expose cross-tenant or raw per-user identifiers.

**Acceptance Scenarios**:

1. **Given** a tenant-attributable business metric, **when** its contract entry is reviewed,
   **then** it requires `tenant_id` and uses only safe, bounded labels.
2. **Given** a workspace-attributable business metric, **when** its contract entry is reviewed,
   **then** it may include `workspace_id` only when workspace ownership is explicit and safe.

### User Story 3 — Incident impact correlation (Priority: P2)

As an SRE, I need business metrics aligned with technical observability so I can correlate platform
health changes with product impact instead of inferring that impact manually.

**Why this priority**: Technical incidents are easier to prioritize when operators can see whether
usage, activation, or workload activity dropped in the same plane.

**Independent Test**: A reviewer can verify that the business metrics contract references the same
scope model, naming conventions, and freshness semantics used by the technical observability plane.

**Acceptance Scenarios**:

1. **Given** the business metrics contract, **when** it is compared to the metrics-stack contract,
   **then** the naming prefix, scope model, and guardrails are aligned.
2. **Given** a downstream consumer, **when** it reads the contract, **then** it can distinguish
   business metrics from infrastructure metrics without ambiguity.

### User Story 4 — Reusable metering vocabulary (Priority: P2)

As a platform engineer working on quotas or billing, I need a reusable business usage vocabulary so
I do not have to derive consumption semantics directly from raw subsystem metrics.

**Why this priority**: Raw component signals are too low-level and inconsistent for later metering
and commercial workflows.

**Independent Test**: A reviewer can identify which business metrics are intended as usage inputs
for later quota, metering, or billing-related capabilities.

**Acceptance Scenarios**:

1. **Given** the defined business categories, **when** metering-oriented consumers inspect them,
   **then** they can identify usage families for API, functions, storage, data services, and
   realtime/events.

### Edge Cases

- A business metric is only meaningful at platform scope and must not be misrepresented as
  tenant-scoped.
- A subsystem can technically attribute data to a tenant but not safely to a workspace; the metric
  must stop at tenant scope.
- A proposed business metric depends on a raw identifier such as user id, request id, object key,
  or unnormalized route; the contract must reject it.
- A later consumer attempts to treat technical health metrics as business usage metrics or vice
  versa; the contract must preserve the distinction.
- A metric source becomes stale or unavailable; downstream consumers must not treat missing business
  evidence as normal healthy activity.
- Sensitive authentication or audit events require business-level counting but must not expose raw
  principal identifiers, secrets, or authorization artifacts.

---

## 5. Functional Requirements

- **FR-001**: The system MUST define a dedicated business/product metrics contract within the same
  observability plane used for technical metrics.
- **FR-002**: The business metrics contract MUST classify metrics by product domain at minimum for
  tenant lifecycle, workspace lifecycle, API usage, auth activity, function usage, storage usage,
  data-service usage, and realtime/event activity.
- **FR-003**: Every business metric family MUST declare whether it is platform-scoped,
  tenant-attributable, workspace-attributable, or some safe subset of those scopes.
- **FR-004**: Tenant-attributable business metrics MUST require `tenant_id` and MUST NOT rely on
  wildcard tenant values.
- **FR-005**: Workspace-attributable business metrics MUST only include `workspace_id` when
  workspace ownership is explicit and safe for that metric family.
- **FR-006**: Business metric families MUST follow the observability naming prefix and labeling
  conventions already established by `US-OBS-01-T01`.
- **FR-007**: The contract MUST distinguish business metrics from infrastructure-only metrics so
  downstream consumers can interpret them correctly.
- **FR-008**: The contract MUST define required labels and bounded label dimensions for each
  business metric family.
- **FR-009**: The contract MUST forbid raw identifiers and other high-cardinality dimensions such as
  raw paths, request ids, user ids, object keys, or secret-bearing values.
- **FR-010**: The contract MUST define safe aggregation semantics for platform, tenant, and
  workspace views where supported.
- **FR-011**: The contract MUST define at least one usage-oriented metric family for API, functions,
  storage, data services, and realtime/event workloads.
- **FR-012**: The contract MUST define lifecycle/adoption-oriented metric families for tenant and
  workspace creation, activation, and active-state posture.
- **FR-013**: The contract MUST define how business metrics align with freshness/staleness handling
  from the observability plane so stale evidence is not presented as current usage.
- **FR-014**: The contract MUST define audit and traceability expectations for access to scoped
  business metrics and summaries.
- **FR-015**: The contract MUST define masking/redaction expectations for auth-related and
  security-sensitive product metrics.
- **FR-016**: The contract MUST be consumable through shared internal readers and helper summaries
  so downstream work does not parse raw files directly.
- **FR-017**: The contract MUST be validated deterministically for scope safety, cardinality rules,
  documentation discoverability, and alignment with the existing observability contracts.
- **FR-018**: The architecture/reference documentation MUST explain the purpose, categories, scope
  boundaries, and downstream use of business metrics.
- **FR-019**: The story task summary MUST record the delivered business-metrics slice and clarify
  that dashboards, alerting, console summaries, and smoke verification remain outside this task.

---

## 6. Business Rules and Governance

- Business metrics extend the existing observability plane; they do not replace or reinterpret the
  technical metrics baseline.
- A business metric may only be narrower than platform scope when the ownership boundary is explicit
  and safe.
- Business metrics must prefer normalized business dimensions such as lifecycle state, feature area,
  workspace environment, quota/metering category, or operation family over raw identifiers.
- Metrics that could reveal sensitive security posture must be aggregated and masked so they remain
  useful without exposing principals, credentials, or secret-bearing context.
- Platform-only metrics remain visible only to platform-wide actors and must not appear in tenant
  query surfaces unless explicitly aggregated by an authorized platform operator.
- Tenant/workspace-scoped business metrics must preserve the same least-privilege and audit
  expectations as the technical dashboard and health baselines.
- Business metrics must remain additive and reusable by downstream console, alerting, metering, and
  smoke-test work.

---

## 7. Acceptance Criteria

- **AC-001**: A machine-readable contract exists for business/product metrics in the observability
  plane.
- **AC-002**: The contract defines business metric families across the required product domains.
- **AC-003**: Every metric family declares supported scopes and safe required labels.
- **AC-004**: Tenant/workspace attribution rules are explicit and preserve multi-tenant isolation.
- **AC-005**: Cardinality guardrails explicitly prohibit unsafe raw identifiers.
- **AC-006**: The contract differentiates business metrics from infrastructure metrics.
- **AC-007**: Shared readers and helper summaries expose the contract for downstream consumers.
- **AC-008**: Validation exists to catch scope, naming, and discoverability drift.
- **AC-009**: Architecture documentation is added and discoverable from the reference index.
- **AC-010**: The story summary documents the delivered scope and residual observability work.

---

## 8. Risks, Assumptions, and Open Questions

### Risks

- **Risk**: business metrics drift into billing design or dashboard design.
  - **Mitigation**: keep this task contract-first and explicitly bounded to signal vocabulary.
- **Risk**: unsafe labels create tenant leakage or high-cardinality explosions.
  - **Mitigation**: require explicit scope support and forbidden-label validation.
- **Risk**: business and technical metrics overlap ambiguously.
  - **Mitigation**: require category/type distinctions and document downstream usage boundaries.

### Assumptions

- The metrics-stack, dashboard, and health-check contracts from T01–T03 remain the authoritative
  baseline for scope, freshness, and observability-plane semantics.
- Later tasks will consume this contract for summaries, alerts, and smoke verification rather than
  redefining business metrics independently.

### Open questions

- No blocking open questions. Specific thresholds, dashboard presentation, and commercial billing
  interpretation are intentionally deferred.

---

## 9. Success Criteria

- **SC-001**: Reviewers can identify all required business metric categories and supported scopes
  from one machine-readable contract.
- **SC-002**: Every tenant-attributable and workspace-attributable metric family has explicit safe
  scoping and bounded-label rules.
- **SC-003**: Downstream consumers can read the business metrics baseline through shared helpers
  without parsing raw JSON directly.
- **SC-004**: Validation detects misaligned scope, naming, or discoverability changes before merge.
- **SC-005**: The business metrics baseline is documented as a reusable contract for later quota,
  metering, console-summary, alerting, and smoke-test work.
