# Implementation Plan: Plan Change History & Effective Quota Impact

**Branch**: `100-plan-change-impact-history` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-PLAN-01-T04 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Depends on**: US-PLAN-01-T01 (`097-plan-entity-tenant-assignment`), US-PLAN-01-T02 (`098-plan-base-limits`), US-PLAN-01-T03 (`099-plan-management-api-console`)  
**Input**: Feature specification from `specs/100-plan-change-impact-history/spec.md`

## Summary

Persist an **immutable plan change history** each time a tenant changes plan, capturing not only the before/after plan identifiers but also the **effective entitlement impact snapshot** that applied at commit time: quota deltas, capability deltas, observed usage, resulting post-change status (`within_limit`, `at_limit`, `over_limit`, `unknown`), actor, reason, and correlation metadata. The implementation extends the existing plan assignment flow from T01/T03 so that only successful committed changes create one history record, stores the snapshot in PostgreSQL for durable audit/query use, emits Kafka audit events, and exposes the results through OpenWhisk actions and the existing superadmin / tenant-owner console surfaces.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`), React 18 + TypeScript for console integrations  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (audit events), `undici` (integration/API tests), React Testing Library + vitest (console tests), Apache OpenWhisk action wrappers, existing APISIX + Keycloak auth layers  
**Storage**: PostgreSQL (`tenant_plan_assignments`, `plans`, `quota_dimension_catalog`, `plan_audit_events` + new history/snapshot tables), optional read-only usage collectors backed by PostgreSQL/MongoDB/service APIs, Kafka for audit fan-out  
**Testing**: `node:test`, `node:assert`, `pg`, `kafkajs`, `undici`, React Testing Library + vitest  
**Target Platform**: Kubernetes / OpenShift via Helm, Apache APISIX, Apache OpenWhisk, React admin console  
**Project Type**: Backend slice (schema + actions + events) with API/console extensions for audit/history visibility  
**Performance Goals**: history query for tenants with up to 500 changes < 5 s (SC-002); current entitlement summary visible to tenant owners < 10 s after committed change (SC-005); plan change write path adds < 300 ms p95 over the existing assignment transaction when usage collection succeeds  
**Constraints**: immutable snapshots; successful committed plan change produces exactly one history record; multi-tenant isolation; usage collection may be partially unavailable and must record `unknown` instead of failing the whole change unless transactional persistence itself fails; downgrade visibility only, no enforcement or auto-remediation  
**Scale/Scope**: ≥500 history entries per tenant, full snapshot across all registered quota dimensions and all declared plan capabilities, actor/date filtering and stable pagination for internal users

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | Backend changes stay under `services/provisioning-orchestrator`; gateway/API contracts under existing service/app folders; console updates stay under `apps/web-console`; docs remain in `specs/100-plan-change-impact-history/` |
| II. Incremental Delivery | ✅ PASS | This slice adds history persistence/query + entitlement summary visibility on top of T01-T03 without introducing billing, enforcement, remediation, or policy engines |
| III. K8s / OpenShift Compatibility | ✅ PASS | Reuses existing OpenWhisk/APISIX/Helm deployment patterns; no platform-specific APIs or privileged runtime assumptions |
| IV. Quality Gates | ✅ PASS | Adds unit/integration/contract/UI coverage plus observable audit checks to root validation entry points |
| V. Documentation as Part of the Change | ✅ PASS | This plan plus `research.md`, `data-model.md`, `quickstart.md`, and contracts document data, APIs, observability, and rollout expectations |

**No complexity violations.** The feature extends established plan-management patterns instead of introducing a new service boundary.

## Project Structure

### Documentation (this feature)

```text
specs/100-plan-change-impact-history/
├── plan.md                 ← This file
├── spec.md                 ← Feature specification (already present)
├── research.md             ← Phase 0 output
├── data-model.md           ← Phase 1 output
├── quickstart.md           ← Phase 1 output
├── contracts/
│   ├── plan-change-history-query.json
│   ├── plan-effective-entitlements-get.json
│   ├── plan-change-impact-event.json
│   └── console-impact-history-view-model.md
└── tasks.md                ← Phase 2 output (/speckit.tasks; not created here)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── plan-assign.mjs                          ← UPDATE: create history snapshot inside successful assignment flow
│   │   ├── plan-change-history-query.mjs           ← NEW: internal query with tenant/date/actor filters + pagination
│   │   ├── plan-effective-entitlements-get.mjs     ← NEW: current snapshot for tenant owner / superadmin views
│   │   └── plan-change-impact-recompute.mjs        ← NEW: shared internal helper/action for snapshot materialization only if existing patterns require action reuse
│   ├── models/
│   │   ├── plan-change-history-entry.mjs           ← NEW: validation + serialization for immutable history records
│   │   └── effective-entitlement-snapshot.mjs      ← NEW: quota/capability delta and usage status helpers
│   ├── repositories/
│   │   ├── plan-assignment-repository.mjs          ← UPDATE: single-transaction history persistence hooks
│   │   ├── plan-change-history-repository.mjs      ← NEW: insert/query immutable history entries and line items
│   │   ├── effective-entitlements-repository.mjs   ← NEW: compute current effective entitlement summary from current assignment + overrides/defaults
│   │   └── tenant-usage-snapshot-repository.mjs    ← NEW: collect per-dimension observed usage from authoritative stores/services
│   ├── events/
│   │   └── plan-change-impact-events.mjs           ← NEW: Kafka emission for persisted snapshots and downgrade risk telemetry
│   ├── observability/
│   │   └── plan-change-impact-metrics.mjs          ← NEW: counters/timers/log field helpers for snapshot generation/query paths
│   └── migrations/
│       └── 100-plan-change-impact-history.sql      ← NEW: durable history and snapshot tables/indexes

services/gateway-config/
├── routes/
│   └── plan-management-routes.yaml                 ← UPDATE: expose history/effective entitlement endpoints if not already proxied

apps/web-console/src/
├── services/
│   └── planManagementApi.ts                        ← UPDATE: typed methods for history + effective entitlements
├── components/console/
│   ├── PlanImpactHistoryTable.tsx                  ← NEW: paginated timeline with filters
│   ├── PlanImpactSummaryCard.tsx                   ← NEW: snapshot header (actor, plans, timestamp, correlation, reason)
│   ├── PlanQuotaImpactTable.tsx                    ← NEW: per-dimension before/after/usage/status rendering
│   └── PlanCapabilityImpactTable.tsx               ← NEW: capability delta rendering
└── pages/
    ├── ConsoleTenantPlanPage.tsx                   ← UPDATE: superadmin history tab + impact drilldown
    └── ConsoleTenantPlanOverviewPage.tsx           ← UPDATE: tenant-owner current effective entitlement summary + over-limit indicators

tests/
├── integration/
│   └── 100-plan-change-impact-history/
│       ├── fixtures/
│       │   ├── seed-plan-history.mjs               ← NEW: starter/professional downgrade-upgrade fixtures
│       │   ├── seed-tenant-usage.mjs               ← NEW: observed usage fixture loader
│       │   └── mock-usage-unavailable.mjs          ← NEW: partial usage failure scenarios
│       ├── plan-change-history-write.test.mjs      ← NEW
│       ├── plan-change-history-query.test.mjs      ← NEW
│       ├── effective-entitlements-get.test.mjs     ← NEW
│       ├── downgrade-overlimit.test.mjs            ← NEW
│       └── plan-change-history-auth.test.mjs       ← NEW
└── contract/
    └── 100-plan-change-impact-history/
        ├── plan-change-history-query.contract.test.mjs
        └── plan-effective-entitlements-get.contract.test.mjs
```

**Structure Decision**: Extend the existing `services/provisioning-orchestrator` plan-management backend and current console pages instead of creating a separate quota/history service. This keeps the plan assignment transaction, snapshot persistence, audit events, and UI read models within the same bounded context and follows the repository/action/event structure already used in features 097-099.

## Phase 0: Research

### R-01 — Where to persist the immutable impact snapshot

**Decision**: Store history in dedicated PostgreSQL tables rather than overloading `tenant_plan_assignments.assignment_metadata` or `plan_audit_events.new_state`. Use one header row per committed plan change plus normalized quota/capability snapshot rows (or JSONB arrays if existing repository patterns strongly prefer document payloads, but header + rows remains the default).  
**Rationale**: The feature needs immutable, queryable, filterable history with stable ordering, actor/date filters, and preservation of unchanged dimensions. Dedicated storage avoids audit-log bloat, enables targeted indexes, and keeps past snapshots independent from later plan edits.  
**Alternatives considered**: storing everything in `plan_audit_events` JSONB (rejected: poor query ergonomics and pagination cost), embedding snapshot in `tenant_plan_assignments` (rejected: current-assignment table would mix mutable/current concerns with immutable history).

### R-02 — How to guarantee “exactly one history entry per successful plan change”

**Decision**: Persist the history record within the same PostgreSQL transaction that supersedes the old `tenant_plan_assignments` row and inserts the new one. The history insert uses the new assignment id as a unique foreign key and a `UNIQUE(plan_assignment_id)` constraint to guard idempotency on retries.  
**Rationale**: FR-013 and SC-001 require durable linkage only for committed changes. Same-transaction persistence prevents orphaned history or double entries under retries/concurrency.  
**Alternatives considered**: asynchronous outbox consumer after assignment commit (rejected for this slice because eventual creation could produce gaps/duplicates during retry races unless extra orchestration is added).

### R-03 — Effective entitlement resolution source of truth

**Decision**: Resolve effective quota values at change time from: `quota_dimension_catalog.default_value` + target plan `quota_dimensions` overrides + any tenant-level supported adjustments/overrides available in the existing domain model. Capabilities are resolved from plan capabilities plus any current override mechanism already supported by the platform. The snapshot stores the final resolved values, not the rule chain.  
**Rationale**: FR-006 and FR-009 require point-in-time truth even if defaults or plans later change. Storing only references would force retrospective recomputation and break historical fidelity.  
**Alternatives considered**: storing only plan ids and recalculating on read (rejected: violates immutability and historical accuracy).

### R-04 — Usage posture collection strategy

**Decision**: Collect observed usage synchronously during the assignment transaction preparation phase using a repository abstraction that queries authoritative stores per dimension (e.g. workspaces from control-plane store, API keys from IAM metadata, storage usage from metering read model). Each dimension returns either `{ observedUsage, sourceTimestamp }` or `{ status: 'unknown', reasonCode }`. Failure to collect one dimension must not abort the entire plan change unless the source is classified as mandatory for transactional integrity.  
**Rationale**: The spec explicitly allows unavailable usage. The record must say `unknown` rather than guess, and the history must still exist when the plan change succeeds.  
**Alternatives considered**: post-commit async enrichment (rejected because the feature needs the posture “at change time” and immutable snapshots, not later-estimated values).

### R-05 — Comparison semantics for finite, zero, absent, and unlimited values

**Decision**: Normalize each quota value before comparison into a canonical typed form: `{ kind: 'bounded', value: number }`, `{ kind: 'unlimited' }`, or `{ kind: 'missing' }` during internal calculation, but persist API-friendly representations with `effectiveValue` + `effectiveValueKind` so the UI and contracts distinguish `-1`/unlimited from `0` and inherited absence. Comparison classes remain `increased | decreased | unchanged | added | removed`.  
**Rationale**: Edge cases in the spec require explicit handling of unlimited and missing values. Canonical comparison helpers avoid inconsistent downgrade classification.  
**Alternatives considered**: raw integer comparison only (rejected because `-1` is semantically special and cannot be compared numerically against bounded quotas without domain rules).

### R-06 — Current effective entitlement summary source

**Decision**: Expose tenant-owner and superadmin summary reads from a dedicated `plan-effective-entitlements-get` action that computes the current effective posture from the current assignment and current resolved limits, while also returning the latest persisted history entry id/timestamp for traceability. It does not read only from history because current summary must reflect current overrides even when no new plan change has occurred since a later override rollout.  
**Rationale**: FR-011 asks for current effective state after a plan change, not merely the last snapshot. Returning both current posture and last change linkage keeps the UI clear.  
**Alternatives considered**: read only last history entry (rejected because tenant adjustments after the change would make it stale for “current” entitlements).

### R-07 — Observability and sensitive-data handling

**Decision**: Emit structured logs, Kafka audit events, and metrics with correlation id, tenant id, plan ids, change direction, number of dimensions over-limit, and usage-source completeness counts. Do not log raw reasons if they may contain sensitive free text beyond existing audit policy; mask internal note fields and omit detailed resource identifiers from emitted events. Dashboards focus on snapshot write success, query latency, over-limit downgrade count, and usage-source unknown rate.  
**Rationale**: The task explicitly asks for telemetry, dashboards, correlation, masking, and observable success criteria.  
**Alternatives considered**: logging full snapshot payloads (rejected: high-cardinality and potential sensitive leakage).

## Phase 1: Design & Contracts

### Architecture / flow

```text
Superadmin UI / API caller
        │
        ▼
APISIX route + Keycloak auth
        │
        ▼
OpenWhisk action: plan-assign
        │
        ├── validate actor scope, tenant, target plan lifecycle
        ├── lock current tenant assignment row (SELECT ... FOR UPDATE)
        ├── load previous effective entitlements
        ├── load target plan + catalog + supported tenant overrides
        ├── collect observed usage per quota dimension
        ├── compute quota and capability diff snapshot
        ├── supersede old assignment + insert new assignment
        ├── insert immutable plan_change_history header
        ├── insert quota/capability impact rows
        ├── insert audit row / outbox metadata
        └── commit transaction
                │
                ├── emit Kafka event `console.plan.change-impact-recorded`
                └── update metrics/logs with correlation id

Read paths
  • plan-change-history-query → superadmin/internal filtered history timeline
  • plan-effective-entitlements-get → tenant-owner/self-service + superadmin current summary
```

### Core design choices

1. **History write belongs to the assignment commit path** so concurrency and idempotency are inherited from T01.
2. **Snapshot persistence is immutable and normalized** to support filtering and rendering complete posture, including unchanged dimensions.
3. **Usage status is best-effort per dimension** and explicitly encoded as `within_limit`, `at_limit`, `over_limit`, or `unknown`.
4. **Downgrade risk is informational**: writes succeed even when new limits are below current usage, but the snapshot and event make that visible.
5. **Current summary read model is computed live** from current assignment state, not reconstructed exclusively from the last history entry.

### Proposed implementation phases

#### Phase A — Persistence and domain helpers

- Add migration `100-plan-change-impact-history.sql`.
- Add domain models/helpers for value normalization, diff classification, usage status classification, and immutable serialization.
- Add repository methods for inserting/querying history and for collecting observed usage.

#### Phase B — Assignment flow integration

- Update `plan-assign.mjs` / repository transaction to:
  - resolve previous and target effective entitlements,
  - collect usage snapshots,
  - create one history entry tied to the new assignment,
  - emit auditable event after commit.
- Preserve existing semantics for no-op/equivalent plan changes: still record a change if the assignment changes, but mark quota/capability items as `unchanged` when effective values do not differ.

#### Phase C — Query/API surface

- Add `plan-change-history-query` action and gateway route(s).
- Add `plan-effective-entitlements-get` action for tenant/self-service and superadmin views.
- Update public contracts and API client typing.

#### Phase D — UI and observability

- Add timeline/history tab and drilldown components in admin console.
- Extend tenant-owner summary view with effective entitlements and over-limit indicators.
- Add metrics, dashboards, alerts, and operational runbook notes.

## Projected artifacts by area

### Backend actions and repositories

| Artifact | Change | Purpose |
|----------|--------|---------|
| `services/provisioning-orchestrator/src/actions/plan-assign.mjs` | Update | materialize immutable history during successful plan changes |
| `services/provisioning-orchestrator/src/actions/plan-change-history-query.mjs` | New | authorized query path with filters/pagination |
| `services/provisioning-orchestrator/src/actions/plan-effective-entitlements-get.mjs` | New | current effective entitlement summary |
| `services/provisioning-orchestrator/src/repositories/plan-change-history-repository.mjs` | New | insert/query history headers and snapshot rows |
| `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` | New | resolve effective quotas/capabilities from plans/defaults/overrides |
| `services/provisioning-orchestrator/src/repositories/tenant-usage-snapshot-repository.mjs` | New | gather observed usage by dimension with explicit unknown handling |
| `services/provisioning-orchestrator/src/events/plan-change-impact-events.mjs` | New | publish audit event(s) and downgrade risk counters |
| `services/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs` | New | reusable metric names and structured fields |

### Data / migration changes

| Artifact | Change | Purpose |
|----------|--------|---------|
| `services/provisioning-orchestrator/src/migrations/100-plan-change-impact-history.sql` | New | create durable immutable history storage and indexes |
| existing `plan_audit_events` usage | Update | add new `action_type` values and correlation linkage |

### API / gateway / contracts

| Artifact | Change | Purpose |
|----------|--------|---------|
| `services/gateway-config/routes/plan-management-routes.yaml` | Update | expose superadmin history query + tenant/self current summary |
| `apps/control-plane/openapi/...` or equivalent public API artifacts | Update | contract publication for new endpoints |
| `specs/100-plan-change-impact-history/contracts/*.json` | New | source-of-truth request/response examples |

### Console/UI

| Artifact | Change | Purpose |
|----------|--------|---------|
| `apps/web-console/src/services/planManagementApi.ts` | Update | typed client methods |
| `ConsoleTenantPlanPage.tsx` | Update | admin history tab and filters |
| `ConsoleTenantPlanOverviewPage.tsx` | Update | current entitlements + over-limit messaging |
| `PlanImpactHistoryTable.tsx`, `PlanQuotaImpactTable.tsx`, `PlanCapabilityImpactTable.tsx`, `PlanImpactSummaryCard.tsx` | New | focused rendering for history and current posture |

## Test strategy

### Unit

- Value normalization helpers for bounded/unlimited/missing comparisons.
- Diff classification for quota/capability line items.
- Usage status mapping: `within_limit`, `at_limit`, `over_limit`, `unknown`.
- Data masking helpers for logs/events.

### Integration

- Successful upgrade writes exactly one history entry and event.
- Successful downgrade with over-limit usage flags affected dimensions correctly.
- Equivalent effective entitlements still create a record with all `unchanged` deltas.
- Partial usage unavailability records `unknown` without blocking commit.
- Concurrent plan changes only persist the winning committed history entry.
- Old snapshots remain unchanged after editing plan defaults/definitions later.

### Contract / API

- `GET /v1/tenants/{tenantId}/plan/history-impact` (or chosen path) pagination, filters, auth errors.
- `GET /v1/tenant/plan/effective-entitlements` response shape and isolation.
- Stable ordering and envelope structure for up to 500 rows.

### UI

- History timeline filters (actor/date), empty/loading/error states.
- Drilldown tables show unchanged, increased, decreased, added, removed dimensions distinctly.
- Tenant summary indicates over-limit dimensions without implying enforced blocking.
- Accessibility checks for badges/tables and long snapshot rendering.

### Operational validation

- Kafka event observed on `console.plan.change-impact-recorded` for every committed change.
- Dashboard panels show write success rate, query latency, unknown-usage ratio, downgrade-over-limit count.
- Structured logs correlate assignment id, history id, tenant id, actor id, correlation id.

## Risks, compatibility, rollback, and safety

### Main risks

1. **Usage collection latency or inconsistency** could slow plan changes.
   - Mitigation: bounded per-source timeouts, partial `unknown` handling, per-source metrics.
2. **Schema/query bloat** if snapshots are stored only as large JSON documents.
   - Mitigation: normalized header + line-item tables with targeted indexes.
3. **Incorrect handling of unlimited or inherited values** may misclassify downgrades.
   - Mitigation: canonical normalization helpers with exhaustive tests.
4. **Cross-tenant leakage in query endpoints/UI**.
   - Mitigation: explicit auth scopes, tenant-owner route separation, isolation tests.

### Migration / compatibility

- Backward compatible with T01/T03 assignment APIs if history creation is added behind the existing action response envelope.
- No backfill required for this task unless product wants legacy assignments represented; if needed later, a one-off backfill must mark entries as `source=backfill` and may have `usageStatus=unknown`.
- Query endpoints should be additive and versioned within the existing plan-management API family.

### Rollback

- Safe rollback path: revert gateway/UI routes first, then backend action reads, then stop emitting the new Kafka topic, while preserving already-written immutable data.
- DB rollback should not delete valid audit history in production; if code rollback is needed, leave tables in place and disable usage.

### Idempotency

- `UNIQUE(plan_assignment_id)` on history header prevents duplicate snapshot rows for the same committed assignment.
- Event emission should derive from persisted history id; producer retries must use the same event key to prevent consumer duplication issues.

### Security / privacy

- Enforce actor authorization using existing superadmin / tenant-owner separation.
- Never expose another tenant’s history to tenant owners.
- Mask internal note fields or resource identifiers in logs/events where not strictly needed.
- Treat `reason/source` as potentially sensitive free text; expose only to authorized internal viewers if policy requires.

## Observability plan

### Metrics

- `plan_change_history_write_total{result=success|failure}`
- `plan_change_history_write_duration_ms`
- `plan_change_history_query_duration_ms`
- `plan_change_history_over_limit_dimensions_total`
- `plan_change_history_usage_unknown_total{dimensionKey}`
- `plan_change_history_event_publish_total{result}`

### Logs

Structured fields:
- `correlationId`
- `tenantId`
- `previousPlanId`
- `newPlanId`
- `assignmentId`
- `historyEntryId`
- `actorId`
- `overLimitDimensionCount`
- `usageUnknownDimensionCount`
- `changeDirection` (`upgrade|downgrade|lateral|equivalent`)

### Dashboards / alerts

- **Dashboard panels**: write success %, p95 write latency, history query p95, over-limit downgrade count per day, unknown-usage rate by dimension/source.
- **Alerts**: write failure ratio > 1% over 15 min, unknown usage spike > baseline for mandatory dimensions, query latency p95 > 5 s, event publish failure backlog.

### Observable success criteria

- Every committed plan change can be correlated across DB row, Kafka event, and structured log via `historyEntryId` / `correlationId`.
- Downgrade-over-limit events are countable without manual SQL reconstruction.
- No sensitive resource-level identifiers appear in default logs/events.

## Dependencies, sequencing, and parallelization

### Preconditions

- T01 schema/actions for plans and assignments are merged.
- T02 quota catalog/default semantics are merged.
- T03 API/console plan management flow is merged so assignment UI exists.
- Authoritative usage sources per quota dimension are discoverable, even if some return `unknown`.

### Recommended sequence

1. Migration + domain models/helpers.
2. Effective entitlement resolver + usage snapshot repository.
3. Assignment transaction integration and idempotency guard.
4. Kafka audit event + observability hooks.
5. History query / current summary actions and contracts.
6. Gateway/OpenAPI wiring.
7. Console UI updates.
8. Integration/contract/UI test completion and operational smoke checks.

### Parallelizable work

- UI components can start once contracts/view models are stable.
- Observability/dashboard work can proceed after event schema is fixed.
- Contract tests and backend implementation can progress in parallel after migration + route naming freeze.

## Definition of Done

A task implementation is done when all of the following are true:

1. A successful plan change writes exactly one immutable history entry tied to the committed assignment.
2. The persisted snapshot includes all quota dimensions and capabilities, including unchanged items.
3. Usage posture is captured per dimension as `within_limit`, `at_limit`, `over_limit`, or `unknown`.
4. Historical entries remain unchanged after later plan/catalog edits.
5. Internal operators can query filtered, paginated history with stable chronological ordering.
6. Tenant owners can view their current effective entitlement summary for their own tenant only.
7. Kafka audit event(s), structured logs, and metrics exist and support correlation.
8. Automated unit, integration, contract, and UI tests pass.
9. Quickstart documentation describes how to validate the slice locally.

## Expected implementation evidence

- Migration file and repository/action code merged.
- Contract artifacts updated and consumable.
- Integration test outputs showing upgrade, downgrade, equivalent, and partial-unknown scenarios.
- UI screenshots or test snapshots for history tab and tenant-owner entitlement summary.
- Sample Kafka event and dashboard reference for observability.
