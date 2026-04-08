# Implementation Plan: Plan Entity & Tenant Plan Assignment

**Branch**: `097-plan-entity-tenant-assignment` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-PLAN-01-T01 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Input**: Feature specification from `/specs/097-plan-entity-tenant-assignment/spec.md`

## Summary

Design and implement the **Plan** entity and the **Plan Assignment** contract layer for the Falcone multi-tenant platform. This task covers the PostgreSQL schema, OpenWhisk action contracts (no UI), Kafka audit event definitions, and integration tests for the superadmin-managed plan catalog and tenant plan assignment flow. Enforcement, API/console UI, quota limits, and plan-change history analysis are explicitly out of scope and deferred to US-PLAN-01-T02 through T06.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrappers (established pattern in `services/provisioning-orchestrator`)  
**Storage**: PostgreSQL — relational plan catalog and assignment history  
**Testing**: `node:test` (Node 20 native runner), `node:assert`, `pg` (fixture queries), `kafkajs` (event verification), `undici` (HTTP contract tests against action endpoints)  
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless  
**Project Type**: Backend service — PostgreSQL data model + OpenWhisk actions + Kafka events  
**Performance Goals**: Single-tenant plan query < 50 ms p95; catalog listing of 100 plans < 200 ms p95 (SC-007)  
**Constraints**: Multi-tenant isolation enforced at query level; concurrent assignment serialized via `SELECT FOR UPDATE`; all mutations audited via Kafka  
**Scale/Scope**: Catalog supports ≥100 plans; ≥10,000 tenant assignments (SC-007)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | New logic lives under `services/provisioning-orchestrator`; migrations in `src/migrations/`; contracts in `specs/097-plan-entity-tenant-assignment/contracts/` |
| II. Incremental Delivery | ✅ PASS | This task delivers schema + action contracts only; enforcement, UI, and history analysis deferred to later tasks |
| III. K8s / OpenShift Compatibility | ✅ PASS | No new Helm charts; existing deployment pattern for provisioning-orchestrator actions applies |
| IV. Quality Gates | ✅ PASS | New `node:test` integration tests added; root CI scripts updated |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, data-model.md, contracts/, and migration SQL constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new frameworks introduced.

## Project Structure

### Documentation (this feature)

```text
specs/097-plan-entity-tenant-assignment/
├── plan.md              ← This file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output (entities, DDL, state machine)
├── quickstart.md        ← Phase 1 output (local dev and test execution)
├── contracts/
│   ├── plan-create.json           ← OpenWhisk action contract
│   ├── plan-update.json
│   ├── plan-lifecycle.json
│   ├── plan-list.json
│   ├── plan-get.json
│   ├── plan-assign.json
│   ├── plan-assignment-get.json
│   └── plan-assignment-history.json
└── tasks.md             ← Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── plan-create.mjs               ← NEW: create plan in catalog
│   │   ├── plan-update.mjs               ← NEW: update metadata / capabilities / quota dims
│   │   ├── plan-lifecycle.mjs            ← NEW: lifecycle transitions (draft→active→deprecated→archived)
│   │   ├── plan-list.mjs                 ← NEW: catalog listing with status filter + pagination
│   │   ├── plan-get.mjs                  ← NEW: get single plan by id or slug
│   │   ├── plan-assign.mjs               ← NEW: assign/reassign plan to tenant (atomic)
│   │   ├── plan-assignment-get.mjs       ← NEW: current plan for a tenant
│   │   └── plan-assignment-history.mjs   ← NEW: full assignment history for a tenant
│   ├── models/
│   │   ├── plan.mjs                      ← NEW: Plan entity model + validation
│   │   └── plan-assignment.mjs           ← NEW: PlanAssignment entity model + validation
│   ├── repositories/
│   │   ├── plan-repository.mjs           ← NEW: CRUD + lifecycle queries for plans
│   │   └── plan-assignment-repository.mjs ← NEW: atomic assignment swap + history queries
│   ├── events/
│   │   └── plan-events.mjs               ← NEW: Kafka event emitter for plan/assignment mutations
│   └── migrations/
│       └── 097-plan-entity-tenant-assignment.sql  ← NEW: DDL for plans, plan_assignments, plan_audit_events

tests/
└── integration/
    └── 097-plan-entity-tenant-assignment/
        ├── fixtures/
        │   ├── create-test-tenant.mjs    ← reuse or adapt from existing fixtures
        │   └── seed-plans.mjs
        ├── plan-catalog.test.mjs         ← FR-001, FR-002, FR-003, FR-013, FR-014, FR-015, FR-017
        ├── plan-assignment.test.mjs      ← FR-004, FR-005, FR-006, FR-007, FR-009
        ├── plan-lifecycle.test.mjs       ← FR-002, FR-008, FR-009
        ├── plan-audit.test.mjs           ← FR-012, SC-004
        └── plan-isolation.test.mjs       ← FR-016, SC-005
```

**Structure Decision**: Extends `services/provisioning-orchestrator` following the established OpenWhisk action + repository + event pattern from features 073, 075, 089, 092, and 096. No new top-level directories required.

---

## Phase 0: Research Findings

### R-01 — Concurrent Assignment Serialization

**Decision**: Use `SELECT FOR UPDATE` on the `tenant_plan_assignments` row (or a per-tenant advisory lock) within a single PostgreSQL transaction that atomically updates `superseded_at` on the current assignment and inserts the new row.  
**Rationale**: Consistent with the established pattern in `075-idempotent-retry-dedup` for concurrent operation protection. `SELECT FOR UPDATE` on a tenant-scoped index scan avoids full table locks.  
**Alternatives considered**: Application-level mutex (rejected: not safe across multiple OpenWhisk activations), optimistic locking with retry (acceptable but adds retry complexity; `FOR UPDATE` is simpler for this write pattern).

### R-02 — Plan Immutability on Archive

**Decision**: Once a plan transitions to `archived`, all UPDATE operations are rejected at the repository layer before reaching PostgreSQL. The migration adds a CHECK constraint: `status = 'archived'` blocks further status updates via trigger.  
**Rationale**: Prevents accidental mutation of archived plans without requiring application-level guards everywhere.

### R-03 — Slug Uniqueness Enforcement

**Decision**: PostgreSQL UNIQUE INDEX on `plans(slug)` (case-insensitive, normalized to lowercase). Application normalizes slug to lowercase before insert.  
**Rationale**: FR-003 requires uniqueness across all lifecycle states including archived.

### R-04 — Audit Event Strategy

**Decision**: Audit events are emitted to Kafka after a successful DB transaction commit. The Kafka publish is fire-and-forget (aligned with 093/096 pattern). A `plan_audit_events` table in PostgreSQL serves as the queryable audit log (mirrors the established `scope_enforcement_denials` pattern).  
**Rationale**: Decouples audit persistence from request latency. Kafka provides durability; PostgreSQL provides queryability (SC-004).

### R-05 — Capabilities and Quota Dimensions Schema

**Decision**: Store capabilities as `JSONB` column `capabilities` (map of `string → boolean`) and quota dimensions as `JSONB` column `quota_dimensions` (map of `string → numeric`). No separate junction tables at this stage.  
**Rationale**: Declarative metadata only (FR-013, FR-014); schema flexibility needed as dimension keys are defined per product tier without a fixed catalog. Downstream enforcement tasks will validate keys.

### R-06 — No New Infrastructure

**Decision**: No new Kafka topics beyond what is defined in this plan; no new Helm chart changes; reuse existing `provisioning-orchestrator` deployment.  
**Rationale**: Incremental delivery (Constitution Principle II).

---

## Phase 1: Data Model

### Entity: `plans`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Stable identifier |
| `slug` | `VARCHAR(64)` | NOT NULL, UNIQUE | Lowercase alphanumeric + hyphens |
| `display_name` | `VARCHAR(255)` | NOT NULL | |
| `description` | `TEXT` | | Nullable |
| `status` | `VARCHAR(20)` | NOT NULL, CHECK IN (`draft`,`active`,`deprecated`,`archived`) | State machine enforced at app layer; transition direction enforced by trigger |
| `capabilities` | `JSONB` | NOT NULL, DEFAULT `'{}'` | `{ "webhooks_enabled": true, ... }` |
| `quota_dimensions` | `JSONB` | NOT NULL, DEFAULT `'{}'` | `{ "max_workspaces": 5, ... }` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | Updated via trigger |
| `created_by` | `VARCHAR(255)` | NOT NULL | Actor ID (superadmin) |
| `updated_by` | `VARCHAR(255)` | NOT NULL | Actor ID of last modifier |

**Indexes**: UNIQUE on `slug`; INDEX on `status` for catalog listing filters.

### Entity: `tenant_plan_assignments`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `VARCHAR(255)` | NOT NULL | FK reference to tenant domain |
| `plan_id` | `UUID` | NOT NULL, FK → `plans(id)` | |
| `effective_from` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | When the assignment took effect |
| `superseded_at` | `TIMESTAMPTZ` | | NULL = current assignment; set when superseded |
| `assigned_by` | `VARCHAR(255)` | NOT NULL | Actor ID (superadmin) |
| `assignment_metadata` | `JSONB` | NOT NULL, DEFAULT `'{}'` | Freeform context (reason, ticket ref, etc.) |

**Indexes**:
- UNIQUE partial: `(tenant_id) WHERE superseded_at IS NULL` — enforces FR-005 (at most one current assignment per tenant)
- INDEX on `(tenant_id, effective_from DESC)` for history queries
- INDEX on `plan_id` for archival guard (FR-008)

### Entity: `plan_audit_events`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `action_type` | `VARCHAR(64)` | NOT NULL | e.g., `plan.created`, `plan.lifecycle_transitioned`, `assignment.created`, `assignment.superseded` |
| `actor_id` | `VARCHAR(255)` | NOT NULL | |
| `tenant_id` | `VARCHAR(255)` | | NULL for plan-only events |
| `plan_id` | `UUID` | | FK → plans(id), nullable (for soft references to archived plans) |
| `previous_state` | `JSONB` | | Snapshot before mutation |
| `new_state` | `JSONB` | NOT NULL | Snapshot after mutation |
| `correlation_id` | `VARCHAR(255)` | | For distributed tracing |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | |

**Indexes**: INDEX on `(actor_id, created_at DESC)`; INDEX on `(tenant_id, created_at DESC)`; INDEX on `(action_type, created_at DESC)`.

### Plan Lifecycle State Machine

```text
draft ──► active ──► deprecated ──► archived
         (only forward transitions; no rollback)
```

Enforced by:
1. PostgreSQL trigger: rejects backward transitions (e.g., `active → draft`).
2. Application layer: validates next-state in `plan-lifecycle.mjs` before query.

### Kafka Topics

| Topic | Retention | Trigger |
|-------|-----------|---------|
| `console.plan.created` | 30d | Plan inserted |
| `console.plan.updated` | 30d | Plan metadata/capabilities/quotas changed |
| `console.plan.lifecycle_transitioned` | 30d | Status changed |
| `console.plan.assignment.created` | 30d | New assignment (initial or reassignment) |
| `console.plan.assignment.superseded` | 30d | Old assignment marked superseded |

All events follow the platform audit event envelope:

```json
{
  "eventType": "console.plan.created",
  "correlationId": "<uuid>",
  "actorId": "<actor>",
  "tenantId": "<tenant or null>",
  "timestamp": "<ISO8601>",
  "previousState": { ... },
  "newState": { ... }
}
```

---

## Phase 1: Action Contracts (Summary)

Full JSON contract files are generated in `specs/097-plan-entity-tenant-assignment/contracts/`.

### `plan-create`

- **Method**: OpenWhisk action invocation (POST via APISIX → OW)
- **Auth**: superadmin JWT
- **Input**: `{ slug, displayName, description?, capabilities?, quotaDimensions? }`
- **Output (201)**: `{ id, slug, displayName, status: "draft", ... }`
- **Errors**: `409 PLAN_SLUG_CONFLICT`, `400 INVALID_SLUG`, `403 FORBIDDEN`

### `plan-update`

- **Auth**: superadmin JWT
- **Input**: `{ planId, displayName?, description?, capabilities?, quotaDimensions? }`
- **Constraint**: Rejected if plan status is `archived`
- **Output (200)**: Updated plan object
- **Errors**: `404 PLAN_NOT_FOUND`, `409 PLAN_ARCHIVED`, `403 FORBIDDEN`

### `plan-lifecycle`

- **Auth**: superadmin JWT
- **Input**: `{ planId, targetStatus }`
- **Constraint**: Forward transitions only; `archived` blocked if tenants still assigned (FR-008)
- **Output (200)**: `{ planId, previousStatus, newStatus }`
- **Errors**: `409 INVALID_TRANSITION`, `409 PLAN_HAS_ACTIVE_ASSIGNMENTS`, `403 FORBIDDEN`

### `plan-list`

- **Auth**: superadmin JWT
- **Input**: `{ status?, page?, pageSize? }`
- **Output (200)**: `{ plans: [...], total, page, pageSize }`

### `plan-get`

- **Auth**: superadmin or tenant owner JWT
- **Input**: `{ planId? | slug? }`
- **Output (200)**: Full plan object including capabilities and quota dimensions

### `plan-assign`

- **Auth**: superadmin JWT
- **Input**: `{ tenantId, planId, assignedBy, assignmentMetadata? }`
- **Constraint**: Target plan must be `active`; atomic supersede of previous assignment
- **Output (200)**: `{ assignmentId, tenantId, planId, effectiveFrom, previousPlanId? }`
- **Errors**: `409 PLAN_NOT_ACTIVE`, `409 CONCURRENT_ASSIGNMENT_CONFLICT`, `404 TENANT_NOT_FOUND`

### `plan-assignment-get`

- **Auth**: superadmin or tenant owner JWT (tenant owner sees only their own)
- **Input**: `{ tenantId }`
- **Output (200)**: Current assignment + plan metadata; `{ noAssignment: true }` if none

### `plan-assignment-history`

- **Auth**: superadmin JWT
- **Input**: `{ tenantId, page?, pageSize? }`
- **Output (200)**: Chronological list of all assignments with `effectiveFrom`, `supersededAt`, `assignedBy`

---

## Testing Strategy

### Unit Tests

- `plan.mjs` model validation: slug format, capability value types, quota dimension value types, lifecycle transition guard
- `plan-assignment.mjs` model: null `superseded_at` = current, immutability checks

### Integration Tests (node:test)

- `plan-catalog.test.mjs`: CRUD lifecycle, slug conflict (FR-001, FR-003), JSONB capability/quota round-trip (FR-013, FR-014), pagination (FR-017)
- `plan-assignment.test.mjs`: assign to unassigned tenant, reassign (previous superseded), concurrent assignment with `SELECT FOR UPDATE` (SC-006), reject draft/deprecated/archived plan assignment (FR-007)
- `plan-lifecycle.test.mjs`: full state machine traversal, backward transition rejection, archive guard with blocking tenants (FR-008)
- `plan-audit.test.mjs`: every mutation produces a `plan_audit_events` row + Kafka event (FR-012, SC-004)
- `plan-isolation.test.mjs`: tenant owner cannot read another tenant's assignment (FR-016)

### Contract Tests

- Validate OpenWhisk action response shapes against JSON schemas in `contracts/`
- Verify error codes for each rejection scenario

### Observability Validation

- Kafka event emission verified in integration tests via `kafkajs` consumer with timeout
- `plan_audit_events` rows verified via `pg` direct query in test assertions

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Concurrent assignment race condition corrupts state | Low | High | `SELECT FOR UPDATE` + UNIQUE partial index on `(tenant_id) WHERE superseded_at IS NULL`; integration test with parallel inserts |
| Backward lifecycle transition bug | Medium | Medium | PostgreSQL trigger + application guard; both must reject independently |
| `quota_dimensions` key naming divergence with future enforcement | Medium | Medium | Document reserved key conventions in `data-model.md`; downstream tasks validate |
| Kafka publish failure after DB commit | Low | Low | Fire-and-forget (aligned with platform pattern); Kafka failures do not roll back DB; audit trail preserved in `plan_audit_events` |
| Slug normalization inconsistency | Low | Medium | Single normalization point in `plan.mjs` model constructor; test with mixed-case input |

---

## Dependencies & Sequencing

### Prerequisites

- **US-DOM-02** (tenant domain model): Tenant identifier must be resolvable. Assumed satisfied per spec assumptions.
- **Migration ordering**: This migration (`097`) must run after `096-security-hardening-tests` has been applied.

### Parallelizable Work

- DDL migration + model/repository layer can be developed in parallel with contract schema definitions
- Integration test fixtures can be developed independently once migration is applied locally

### Recommended Implementation Sequence

1. Write and apply migration `097-plan-entity-tenant-assignment.sql`
2. Implement `plan.mjs` model + `plan-repository.mjs` (core CRUD, lifecycle, slug uniqueness)
3. Implement `plan-assignment.mjs` model + `plan-assignment-repository.mjs` (atomic swap, history)
4. Implement `plan-events.mjs` (Kafka emit with envelope)
5. Implement OpenWhisk actions (plan-create, plan-update, plan-lifecycle, plan-list, plan-get)
6. Implement OpenWhisk actions (plan-assign, plan-assignment-get, plan-assignment-history)
7. Write contract JSON files in `specs/097.../contracts/`
8. Write integration tests; run against local PostgreSQL + Kafka fixtures
9. Update `AGENTS.md` with new env vars and Kafka topics

### New Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAN_KAFKA_TOPIC_CREATED` | `console.plan.created` | Kafka topic for plan.created events |
| `PLAN_KAFKA_TOPIC_UPDATED` | `console.plan.updated` | Kafka topic for plan.updated events |
| `PLAN_KAFKA_TOPIC_LIFECYCLE` | `console.plan.lifecycle_transitioned` | Kafka topic for lifecycle events |
| `PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED` | `console.plan.assignment.created` | Kafka topic for new assignments |
| `PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED` | `console.plan.assignment.superseded` | Kafka topic for superseded assignments |
| `PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS` | `5000` | Timeout for `SELECT FOR UPDATE` lock acquisition |

---

## Criteria of Done

| ID | Criterion | Evidence |
|----|-----------|---------|
| DOD-01 | Migration `097-plan-entity-tenant-assignment.sql` applied cleanly to a fresh DB | `psql` schema dump shows `plans`, `tenant_plan_assignments`, `plan_audit_events` tables |
| DOD-02 | All 8 OpenWhisk actions respond with correct shapes for happy-path scenarios | Integration test suite green |
| DOD-03 | Slug conflict rejected with `409 PLAN_SLUG_CONFLICT` | `plan-catalog.test.mjs` assertion |
| DOD-04 | Draft/deprecated/archived plan assignment rejected with `409 PLAN_NOT_ACTIVE` | `plan-assignment.test.mjs` assertion |
| DOD-05 | Archive blocked when tenants assigned; error lists blocking tenants | `plan-lifecycle.test.mjs` assertion |
| DOD-06 | Concurrent assignment for same tenant: exactly one succeeds, one fails gracefully | `plan-assignment.test.mjs` parallel test |
| DOD-07 | Every mutation produces a `plan_audit_events` row with correct action_type, actor, state diff | `plan-audit.test.mjs` direct DB assertion |
| DOD-08 | Every mutation emits a Kafka event on the correct topic | `plan-audit.test.mjs` Kafka consumer assertion |
| DOD-09 | Tenant owner cannot read another tenant's assignment (403 or empty) | `plan-isolation.test.mjs` assertion |
| DOD-10 | Contract JSON files present for all 8 actions | Files exist in `specs/097.../contracts/` |
| DOD-11 | `data-model.md` and `quickstart.md` present and accurate | Files present in `specs/097.../` |
| DOD-12 | `AGENTS.md` updated with new env vars and Kafka topics | `AGENTS.md` diff includes new section |
| DOD-13 | Unrelated untracked artifacts preserved: `specs/070-saga-compensation-workflows/plan.md`, `specs/070-saga-compensation-workflows/tasks.md`, `specs/072-workflow-e2e-compensation/tasks.md` | `git status` confirms untracked, unmodified |

---

## Complexity Tracking

No constitution violations. No complexity exceptions required.
